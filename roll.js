// PianoRoll — canvas note editor for one track. All edits go through host.edit / host.beginEdit+changed+endEdit.
// The specifier must match main.js's song import exactly: a different query string loads a second copy of song.js with its own note-id counter.
// (7a, IMPL-7a §4.2) A drum track's rows: host.drumRows(track) → [{ n, name }] (its sounds' primary notes, kick first) |
// null. The roll's row ↔ note conversions go through one row table — this.rows: null = the piano (row r = note 127 − r,
// 128 rows); the compact drum rows (on by default: setDrumRows, the toolbar's "Drum rows"; host.drumRowsOn the saved
// choice): row 0 "Other" (every note no row names), rows 1…K the named notes, kick at the bottom — so compact mode is a
// table (_row, _noteAt, _rowN, _nRows, _lab), not a fork. On either layout the gutter (GUT_D wide) names the drum rows
// and the piano dims the rows no sound plays; a vertical drag moves between drum rows; the velocity lane draws the
// normal (100) and accent (127) lines. drumRowsOf(dev) builds the rows from a drum machine's device record (drum-core).
import { PPQ, barTicks, beatTicks, fmtBBT, snapTick, sortNotes, songEnd, copyNotes, pasteNotes, newId } from './song.js?v=9';
import { drumRows, PERS } from './drum-core.js?v=9';

const GUT_P = 64, GUT_D = 120, RUL = 24, VEL = 72, MAXPPT = 1.5, BW = 38;
const BG = '#0c0d0f', ACC = '#f2a33a', TEXT = '#e9e7e2', MUTE = '#8d8b86', LINE = '#24262b';
// (R, IMPL-R §3) a lit key / drum row, a sounding note's wash; LONG_T: a note longer is kept apart (_sIndex)
// ((review R-14) LIT_K: a lit compact drum row's note number, dimmer than its name)
const LIT = 'rgba(242,163,58,0.85)', LIT_N = 'rgba(255,255,255,0.42)', LIT_K = 'rgba(12,13,15,0.6)', LONG_T = PPQ * 8;
const FONT = "'JetBrains Mono', ui-monospace, Menlo, monospace";
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLK = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
const AUTO_X = new Set(['marquee', 'move', 'resizeR', 'resizeL', 'create', 'erase', 'ruler', 'loopEdge', 'velpaint']);
const DBL = 6, HOLD = 90;   // double-click slop (px); touch delay (ms) before Draw/Erase act, so a pinch can start first
// row heights (px): pinch / Alt-wheel / Keys −/+ range; Fit's cap (mouse, touch); automatic sizing never goes below
// ROW_AUTO_T on touch (the roll scrolls instead); the default (mouse, touch); the Keys −/+ steps
const ROW_MIN = 5, ROW_MAX = 56, ROW_FIT = 32, ROW_FIT_T = 44, ROW_AUTO_T = 14, ROW_DEF = 12, ROW_DEF_T = 18;
const ROW_STEPS = [5, 6, 7, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 56];
const PZ_ENGAGE = 6;        // px the finger spread must change before a two-finger gesture zooms (until then it only pans)
// Touch / pen editing (a mouse keeps the legacy _hit and thresholds): grab zones (px) per pointer type and tool — inR / inL
// inside a note's end / start (at most 45 % / 25 % of a selected note, 40 % of an unselected one), outR / outL past a
// SELECTED note's end / start and slopY off its row, outU / slopU for an unselected note (modest: one finger still
// scrolls between notes), minL the narrowest note with a start zone. Draw: reach past a note only from the grid cell
// it ends in (_hitZ), so the next cell stays drawable
const ZONES = {
  touch: { select: { inR: 14, inL: 10, outR: 22, outL: 12, slopY: 8, outU: 6, slopU: 4, minL: 28 },
    draw: { inR: 12, inL: 8, outR: 10, outL: 6, slopY: 3, outU: 3, slopU: 3, minL: 28 },
    erase: { inR: 0, inL: 0, outR: 2, outL: 0, slopY: 2, outU: 2, slopU: 2, minL: 1e9 } },
  pen: { select: { inR: 8, inL: 6, outR: 8, outL: 4, slopY: 2, outU: 4, slopU: 2, minL: 18 },
    draw: { inR: 6, inL: 4, outR: 4, outL: 2, slopY: 1, outU: 2, slopU: 1, minL: 18 },
    erase: { inR: 0, inL: 0, outR: 1, outL: 0, slopY: 1, outU: 1, slopU: 1, minL: 1e9 } },
};
// TROW: rows are a touch target of about this height (the vertical slop shrinks as rows grow); HWIN: a selected note's
// handle beats a neighbour's body only this close; drag thresholds (touch, touch on a handle, pen); double-tap reach
// (touch, pen) and the wobble a touch tap may have; hold before a finger's select box / chord select (and its slack);
// auto-scroll zone at the right edge on touch; velocity-stem / loop-edge reach (touch, pen)
const TROW = 28, HWIN = 6, TSLOP = 8, TSLOP_RZ = 5, PSLOP = 4, TDBL = 24, PDBL = 12, TTAP = 12, LONG = 500, LONG_SLOP = 8, TEDGE = 28;
const TSTEM = 14, PSTEM = 8, TLOOP = 14, PLOOP = 8, CHORD_TOL = PPQ / 16;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const AUTO_Y = new Set(['marquee', 'move', 'create', 'erase']);
const TOOLS = ['select', 'draw', 'erase'];

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const noteName = n => NAMES[n % 12] + (Math.floor(n / 12) - 1);
// ((R) the lights draw names and numbers every frame: no string built per frame)
const NN = Array.from({ length: 128 }, (_, n) => noteName(n)), NUMS = Array.from({ length: 128 }, (_, n) => String(n));
/** (7a) The drum rows of an instrument device ({ model, drum }): a drum machine's mapped primaries, kick first, as
 * host.drumRows wants them ([{ n, name }]); null for any other model. (7b) The TR-606's are its seven (Kick, Snare, Low tom,
 * Hi tom, Cymbal, Open hat, Closed hat); a map without a `drum` record is the machine's default. */
export function drumRowsOf(dev) {
  if (!dev || typeof dev !== 'object' || typeof dev.model !== 'string' || !Object.prototype.hasOwnProperty.call(PERS, dev.model)) return null;
  return drumRows(dev.drum && typeof dev.drum === 'object' ? dev.drum.map : undefined, dev.model).map(e => ({ n: e.n, name: e.name })); // (7b: by the machine — the 606's seven sounds, the 808's sixteen)
}
const isBlk = n => BLK[((n % 12) + 12) % 12] === 1;
const rgb = s => {
  s = String(s || '').replace('#', '');
  if (s.length === 3) s = s.replace(/./g, '$&$&');
  const v = parseInt(s, 16);
  return s.length !== 6 || isNaN(v) ? [242, 163, 58] : [v >> 16 & 255, v >> 8 & 255, v & 255];
};
const css = c => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const mix = (a, b, k) => a.map((x, i) => x + (b[i] - x) * k);
const lum = c => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
const clipList = c => (!c ? [] : Array.isArray(c.notes) ? c.notes : c.tracks ? (Object.values(c.tracks).find(v => v && Array.isArray(v.notes) && v.notes.length) || { notes: [] }).notes : []);
function rr(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
}
function removeIds(arr, ids) { let j = 0; for (const x of arr) if (!ids.has(x.id)) arr[j++] = x; const k = arr.length - j; arr.length = j; return k; }
const uid = used => { let i = newId(); while (used.has(i)) i = newId(); used.add(i); return i; };
const svgCur = (svg, x, y, fb) => `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, ${fb}`;
const PENCIL = svgCur('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path d="M2 18l1.2-4.6L13.6 3a1.6 1.6 0 0 1 2.3 0l1.1 1.1a1.6 1.6 0 0 1 0 2.3L6.6 16.8z" fill="#f2a33a" stroke="#0c0d0f" stroke-width="1.3" stroke-linejoin="round"/><path d="M2 18l1.2-4.6 3.4 3.4z" fill="#e9e7e2" stroke="#0c0d0f" stroke-width="1" stroke-linejoin="round"/></svg>', 2, 18, 'crosshair');
const ERASER = svgCur('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><g transform="rotate(-45 10 10)"><rect x="3" y="6.5" width="14" height="7" rx="1.5" fill="#e9e7e2" stroke="#0c0d0f" stroke-width="1.3"/><rect x="3" y="6.5" width="5" height="7" rx="1.5" fill="#e2402f" stroke="#0c0d0f" stroke-width="1.3"/></g></svg>', 5, 15, 'cell');

export class PianoRoll {
  constructor(container, host) {
    this.box = container; this.host = host;
    const c = this.el = document.createElement('canvas');
    c.tabIndex = 0; c.className = 'proll';
    c.setAttribute('role', 'application'); c.setAttribute('aria-label', 'Piano roll note editor');
    c.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block;touch-action:none;outline:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent';
    try { if (getComputedStyle(container).position === 'static') container.style.position = 'relative'; } catch { /* no layout */ }
    container.appendChild(c);
    this.ctx = c.getContext('2d');
    this.back = document.createElement('canvas'); this.bctx = this.back.getContext('2d');
    this.W = 0; this.H = 0; this.dpr = 1;
    const p = host.getProject();
    this.ppt = 220 / (p ? barTicks(p) : PPQ * 4);
    // rowPref: the row height the user chose on this device (host.rollRowH; pinch, Keys −/+, Alt-wheel) — kept on track
    // switches; without one, opening a track sizes rows to its range (from rowBase down, never below ROW_AUTO_T on touch)
    const r0 = +host.rollRowH;
    this.rowBase = host.touch ? ROW_DEF_T : ROW_DEF; this.rowPref = Number.isFinite(r0) && r0 > 0 ? clamp(r0, ROW_MIN, ROW_MAX) : null;
    this.rowHf = this.rowPref || this.rowBase; this.rowH = Math.round(this.rowHf); this.sx = 0; this.sy = 0; this.syr = 0; this.tseen = false;
    this.tool = 'select'; this.drawLen = 0; this.lastLen = 0; this.follow = false; this.ghosts = true;
    // (7a) the row table (null: the piano), the drum names (note → name; null: no drum rows), the compact choice, the key
    this.rows = null; this.dn = null; this.dlist = null; this.dcomp = host.drumRowsOn !== false; this.rkey = ''; this.gut = GUT_P;
    this.coarse = !!host.touch; // the last pointer was a finger or pen (a touch device until then): handles on selected notes
    this.sel = new Set(); this.ins = null; this.ph = +host.getPlayhead() || 0;
    this.g = null; this.hover = null; this.keys = new Set(); this.touches = new Map(); this.lastTap = null;
    this.pals = new Map(); this.raf = 0; this.autoRaf = 0; this.dirty = true; this.cur = ''; this.focused = false;
    this.want = { type: 'center', lo: 48, hi: 72 };
    // (R) the lights: hk the held notes (setHeld), play whether the song plays the track (setPlayhead), fl the chase floor
    // (setPlayhead: _keyOn), the sounding notes (_sound: sAct[0…sCnt) — sAI their indices —, the cursor sI, the index sN /
    // sLen / sV of render's version nv, sMax / sLong (sLI) / sOk, sNx / sPit / sOwn a pitch's takeover), lrow / lst a row lit
    // once a frame, dfont the drum names' font, nfont / ncw the in-block names' font and character width (the scene's)
    this.hk = new Uint8Array(128); this.play = false; this.nv = 0; this.fl = -Infinity;
    this.sAct = []; this.sCnt = 0; this.sI = 0; this.sPh = NaN; this.sN = null; this.sLen = -1; this.sV = -1; this.sMax = 0; this.sLong = []; this.sOk = true;
    this.sAI = new Int32Array(0); this.sLI = new Int32Array(0); this.sNx = new Float64Array(0); this.sPit = new Int32Array(128); this.sOwn = Array.from({ length: 128 }, () => null);
    this.lrow = new Uint32Array(130); this.lst = 0; this.dfont = `12px ${FONT}`; this.nfont = `9px ${FONT}`; this.ncw = 5.6;
    for (const k of ['_down', '_move', '_up', '_cancel', '_lost', '_leave', '_wheel', '_frame', '_autoTick', '_focus', '_menu', '_gest']) this[k] = this[k].bind(this);
    this._ls = [['pointerdown', this._down], ['pointermove', this._move], ['pointerup', this._up], ['pointercancel', this._cancel], ['lostpointercapture', this._lost],
      ['pointerleave', this._leave], ['wheel', this._wheel, { passive: false }], ['focus', this._focus], ['blur', this._focus], ['contextmenu', this._menu]];
    // WebKit's GestureEvents (desktop Safari's trackpad pinch; iPad pinches send them beside the pointers): see _gest
    if (typeof window !== 'undefined' && 'GestureEvent' in window) for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) this._ls.push([ev, this._gest, { passive: false }]);
    for (const [ev, fn, o] of this._ls) c.addEventListener(ev, fn, o);
    if (typeof ResizeObserver !== 'undefined') { this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(container); }
    else { this.ro = null; this._wr = () => this.resize(); window.addEventListener('resize', this._wr); }
    try { document.fonts.ready.then(() => this._view()); } catch { /* no font loading API */ }
    this._syncRows(true);
    this.resize();
  }

  /* ---------------------------------------------------------- geometry */
  get gw() { return Math.max(0, this.W - this.gut); }
  get gb() { return this.H - VEL - 1; }
  get gh() { return Math.max(0, this.gb - RUL); }
  t2x(t) { return this.gut + (t - this.sx) * this.ppt; }
  x2t(x) { return this.sx + (x - this.gut) / this.ppt; }
  n2y(n) { return this.r2y(this._row(n)); }
  y2n(y) { const r = this.y2r(y); return this.rows ? this._noteAt(clamp(r, 0, this.rows.at.length - 1)) : 127 - r; }
  r2y(r) { return RUL + r * this.rowH - this.syr; }
  y2r(y) { return Math.floor((y - RUL + this.syr) / this.rowH); }
  // the row table: a note's row, a row's note (−1: "Other"), the note a press / drag on row r gives (the piano: 0…127; the
  // drum rows: the nearest named row), the row count, a note's label (a drum row's name)
  _row(n) { return this.rows ? this.rows.n[n] || 0 : 127 - n; }
  _noteAt(r) { return this.rows ? (r >= 1 && r < this.rows.at.length ? this.rows.at[r] : -1) : 127 - r; }
  _rowN(r) { return this.rows ? this.rows.at[clamp(r, 1, this.rows.at.length - 1)] : clamp(127 - r, 0, 127); }
  _nRows() { return this.rows ? this.rows.at.length : 128; }
  _lab(n) { return n < 0 ? 'Other' : this.dn && this.dn.has(n) ? this.dn.get(n) + ' ' + n : noteName(n); }
  _nlab(n) { return this.dn && this.dn.has(n) ? this.dn.get(n) : noteName(n); } // (a note's body)
  // a vertical move of whole drum rows dr (> 0: down) for notes ns, clamped: a note on a named row stays on them (1…K),
  // one in "Other" may move onto them; _rowNote: a note dr rows away (0 rows: itself — "Other" keeps its pitch)
  _rowClamp(ns, dr) {
    const K = this._nRows() - 1;
    let lo = -Infinity, hi = Infinity;
    for (const n of ns) { const r = this._row(n); lo = Math.max(lo, (r ? 1 : 0) - r); hi = Math.min(hi, K - r); }
    return lo > hi ? 0 : clamp(dr, lo, hi);
  }
  _rowNote(n, dr) { if (!dr) return n; const r = this._row(n) + dr; return r ? this._noteAt(r) : n; }
  // (re)reads host.drumRows for the track: the table, the names, the gutter; → whether anything changed
  _syncRows(force) {
    const tr = this.host.getTrack(), L = tr && typeof this.host.drumRows === 'function' ? this.host.drumRows(tr) : null, list = [], seen = new Set();
    if (Array.isArray(L)) for (const e of L) if (e && Number.isInteger(e.n) && e.n >= 0 && e.n <= 127 && !seen.has(e.n)) { seen.add(e.n); list.push({ n: e.n, name: String(e.name || noteName(e.n)).slice(0, 24) }); }
    const key = list.length ? (this.dcomp ? 'c' : 'p') + list.map(e => e.n + ':' + e.name).join('|') : '';
    if (!force && key === this.rkey) return false;
    this.rkey = key;
    this.dlist = list.length ? list : null;
    this.dn = list.length ? new Map(list.map(e => [e.n, e.name])) : null;
    if (list.length && this.dcomp) {
      const K = list.length, n = new Int16Array(128), at = new Int16Array(K + 1);
      at[0] = -1;
      list.forEach((e, i) => { const r = K - i; at[r] = e.n; n[e.n] = r; }); // (kick at the bottom)
      this.rows = { n, at };
    } else this.rows = null;
    this.gut = list.length ? GUT_D : GUT_P;
    this.clampX(); this.clampY();
    return true;
  }
  v2y(v) { return this.H - VEL + 6 + (1 - v / 127) * (VEL - 12); }
  y2v(y) { return clamp(Math.round(127 * (1 - (y - (this.H - VEL + 6)) / (VEL - 12))), 1, 127); }
  _maxTick() {
    const p = this.host.getProject(), tr = this.host.getTrack();
    if (!p) return PPQ * 64;
    let e = songEnd(p);
    if (tr) for (const x of tr.notes) if (x.t + x.d > e) e = x.t + x.d;
    return e + 4 * barTicks(p);
  }
  _minPpt() { return Math.min(MAXPPT, Math.max(1e-4, this.gw / this._maxTick())); }
  clampX() { this.sx = clamp(this.sx, 0, Math.max(0, this._maxTick() - this.gw / this.ppt)); }
  clampY() { this.sy = clamp(this.sy, 0, Math.max(0, this._nRows() * this.rowH - this.gh)); this.syr = Math.round(this.sy); }
  _snap() { return Math.max(0, +this.host.getSnap() || 0); }
  _len() { return Math.max(1, Math.round(this.drawLen || this._snap() || this.lastLen || PPQ / 4)); }
  _ids() { const s = new Set(), p = this.host.getProject(); if (p) for (const t of p.tracks) for (const x of t.notes || []) s.add(x.id); return s; }
  _pos(e) { const r = this.el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  _region(x, y) {
    if (y < RUL) return x < this.gut ? 'corner' : 'ruler';
    if (y >= this.H - VEL) return x < this.gut ? 'velg' : 'vel';
    if (y >= this.gb) return 'div';
    return x < this.gut ? 'keys' : 'grid';
  }

  /* ------------------------------------------------------- public API */
  resize() {
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const W = Math.round(this.box.clientWidth), H = Math.round(this.box.clientHeight), tall = H !== this.H;
    if (W !== this.W || H !== this.H || dpr !== this.dpr) {
      this.W = W; this.H = H; this.dpr = dpr;
      for (const cv of [this.el, this.back]) { cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr)); }
    }
    this._applyWant();
    if (tall && !this.g && this._drumFit()) this.sy = 0; // ((7a review 2 #8) the compact drum rows refit a new height)
    this.clampX(); this.clampY(); this._view();
  }
  render() { this.dirty = true; this.nv++; this._req(); } // ((R) nv: the notes may have changed — _sound re-reads them)
  // ((review R-16) a redraw for the view alone — a scroll, a zoom, a tool —: the notes are as they were, the lights' index kept)
  _view() { this.dirty = true; this._req(); }
  _req() { if (!this.raf && !this.dead) this.raf = requestAnimationFrame(this._frame); }
  setTrack() {
    if (this.g) this._finish(false);
    this.sel.clear(); this.ins = null; this.lastTap = null; this.hover = null; this._notify();
    if (this.host.heldNotes) this.setHeld(this.host.heldNotes()); // ((R) the new track's held notes)
    this._syncRows(true); this._centre(); this.render();
  }
  // (R, IMPL-R §3) the held notes that reached the track (the keys, MIDI, pads: the host's), lit on the key strip — a frame
  // only when they change
  setHeld(ns) {
    const H = new Uint8Array(128);
    if (ns) for (const n of ns) if (n >= 0 && n <= 127) H[n | 0] = 1;
    for (let i = 0; i < 128; i++) if (H[i] !== this.hk[i]) { this.hk = H; this._req(); return; }
  }
  // the notes under the playhead now (a copy: their blocks lit) and the keys lit — held, auditioned, the song's the engine
  // plays (_keyOn) — sorted (the page, tests)
  sounding() { this._sound(this.host.getTrack()); return this.sAct.slice(0, this.sCnt); }
  litKeys() {
    const L = new Set(this.keys);
    for (let n = 0; n < 128; n++) if (this.hk[n]) L.add(n);
    this._sound(this.host.getTrack());
    for (let j = 0; j < this.sCnt; j++) if (this._keyOn(this.sAct[j], this.sAI[j])) L.add(this.sAct[j].n);
    return [...L].sort((a, b) => a - b);
  }
  _centre() {
    const tr = this.host.getTrack();
    let lo = 48, hi = 72;
    if (tr && tr.notes.length) { lo = 127; hi = 0; for (const x of tr.notes) { if (x.n < lo) lo = x.n; if (x.n > hi) hi = x.n; } }
    this.want = { type: 'center', lo, hi }; this._applyWant();
  }
  // (7a) the drum rows: on = compact (the named rows only, "Other" on top), off = the full keyboard with the names — for
  // every drum track; isDrum() — the track has drum rows (the toolbar shows its toggle, Transpose asks first); drumRows()
  // the table shown ({ on, rows: [{ n, name }] } | null); refreshRows() re-reads host.drumRows (a map edit; a frame also
  // notices a change)
  setDrumRows(on) {
    on = !!on;
    if (on === this.dcomp) return;
    this.dcomp = on;
    if (!this.dlist) return; // (not a drum track: kept for the next one)
    if (this.g) this._finish(false);
    this._syncRows(true); this._centre(); this.render();
  }
  isDrum() { return !!this.dlist; }
  drumRows() { return this.dlist ? { on: !!this.rows, rows: this.dlist.map(e => ({ n: e.n, name: e.name })) } : null; }
  refreshRows() { if (this.g) return; if (this._syncRows()) { this._centre(); this.render(); } }
  setTool(name) { if (TOOLS.includes(name)) { this.tool = name; this._view(); } }
  setDrawLength(t) { this.drawLen = Math.max(0, Math.round(+t || 0)); this._req(); }
  zoomX(f, cx) {
    let ax;
    if (cx != null) ax = cx - this.el.getBoundingClientRect().left;
    else { const px = this.t2x(this.ph); ax = px >= this.gut && px <= this.W ? px : this.gut; }
    ax = clamp(ax, this.gut, Math.max(this.gut, this.W));
    const t = this.x2t(ax);
    this.ppt = clamp(this.ppt * (+f || 1), this._minPpt(), MAXPPT);
    this.sx = t - (ax - this.gut) / this.ppt; this.clampX();
    if (this.g) { this._apply(); this.render(); } else this._view(); // (a gesture may move notes with the view)
  }
  // row height (the keys' size) by factor f about client y cy (default: the grid's middle): a user choice, kept (_rowsChosen)
  zoomY(f, cy) { this._rows(this.rowHf * (+f || 1), cy); }
  // Keys −/+: the next ROW_STEPS step up (dir > 0) or down — fixed steps, so − undoes + exactly
  zoomRows(dir, cy) {
    const r = this.rowH;
    let nx = 0;
    for (const s of ROW_STEPS) if (dir > 0 ? s > r && !nx : s < r) nx = s;
    if (nx) this._rows(nx, cy);
  }
  _rows(hf, cy) {
    const ay = cy != null ? clamp(cy - this.el.getBoundingClientRect().top - RUL, 0, this.gh) : this.gh / 2;
    const row = (this.sy + ay) / this.rowH, was = this.rowHf;
    this.rowHf = clamp(hf, ROW_MIN, ROW_MAX); this.rowH = Math.round(this.rowHf);
    this.sy = row * this.rowH - ay; this.clampY();
    if (this.rowHf !== was) this._rowsChosen();
    if (this.g) { this._apply(); this.render(); } else this._view();
  }
  _rowsChosen() { this.rowPref = this.rowHf; if (this.host.onRows) this.host.onRows(this.rowH); }
  // (7a review 2 #8) the compact drum rows fill the grid's height (no chosen row height): up to Fit's caps (32 px with a
  // mouse, 44 on touch), never below the touch minimum; → whether it applied (the piano: never)
  _drumFit() {
    if (!this.rows || this.rowPref || this.gh < 10) return false;
    const tc = this._touch();
    this.rowHf = clamp(Math.floor(this.gh / this._nRows()), tc ? ROW_AUTO_T : ROW_MIN, tc ? ROW_FIT_T : ROW_FIT); this.rowH = Math.round(this.rowHf);
    return true;
  }
  _touch() { return !!this.host.touch || this.tseen; } // a touch device, or a finger seen on the roll
  fit() { this.want = { type: 'fit' }; this._applyWant(); this._view(); }
  _applyWant() {
    const w = this.want;
    if (!w || this.gw < 10 || this.gh < 10) return;
    this.want = null;
    if (w.type === 'center') {
      // from the default size each time (rows grow back after a wide track); a chosen size is kept, the view scrolls. The
      // drum rows: all of them
      const r0 = this.rows ? 0 : 127 - w.hi, r1 = this.rows ? this._nRows() - 1 : 127 - w.lo, rows = r1 - r0 + 1, b = this.rowBase;
      if (!this._drumFit()) {
        this.rowHf = this.rowPref || clamp(rows * b > this.gh ? Math.floor(this.gh / (rows + 1)) : b, this._touch() ? ROW_AUTO_T : ROW_MIN, b);
        this.rowH = Math.round(this.rowHf);
      }
      this.sy = ((r0 + r1) / 2 + 0.5) * this.rowH - this.gh / 2; this.clampY();
      return;
    }
    const p = this.host.getProject(), tr = this.host.getTrack();
    if (!p) return;
    let t0, t1, r0, r1; // (the rows of the notes: the piano's 127 − hi … 127 − lo)
    if (tr && tr.notes.length) {
      t0 = Infinity; t1 = 0; r0 = Infinity; r1 = -Infinity;
      for (const x of tr.notes) { const r = this._row(x.n); t0 = Math.min(t0, x.t); t1 = Math.max(t1, x.t + x.d); r0 = Math.min(r0, r); r1 = Math.max(r1, r); }
    } else {
      const lp = p.loop || {};
      t0 = +lp.start || 0; t1 = lp.end > t0 ? lp.end : t0 + barTicks(p) * 4;
      r0 = this.rows ? 0 : 127 - 72; r1 = this.rows ? this._nRows() - 1 : 127 - 48;
    }
    t1 = Math.max(t1, t0 + beatTicks(p));
    const span = t1 - t0;
    this.ppt = clamp(this.gw / (span * 1.08), this._minPpt(), MAXPPT);
    this.sx = t0 - span * 0.04; this.clampX();
    const tc = this._touch();
    this.rowHf = clamp(Math.floor(this.gh / (r1 - r0 + 5)), tc ? ROW_AUTO_T : ROW_MIN, tc ? ROW_FIT_T : ROW_FIT); this.rowH = Math.round(this.rowHf);
    this.sy = ((r0 + r1) / 2 + 0.5) * this.rowH - this.gh / 2; this.clampY();
  }
  setFollow(on) { this.follow = !!on; if (this.follow) this.setPlayhead(this.ph); }
  setGhosts(on) { this.ghosts = !!on; this._view(); }
  // sync: the caller is a frame callback (main.js frame()) — draw in this frame; a frame requested from inside one only
  // runs in the next, so the playhead would show a value one frame old (as arrange.js; `now` is the clock helper above).
  // (R) play: the song plays the track and it is heard (main: the heard tick, not muted / soloed out) — its notes under the
  // playhead light; false once it stops; left out: as it was. (Review R-11) floor: the chase floor — the engine starts no song
  // note before it (main: a start's / seek's anchor tick, the loop start after a wrap, a panic's tick), so none earlier lights
  // its key (_keyOn; its block still brightens); left out: as it was, null: none
  setPlayhead(t, sync, play, floor) {
    this.ph = +t || 0;
    if (play !== undefined) this.play = !!play;
    if (floor !== undefined) this.fl = typeof floor === 'number' && floor === floor ? floor : -Infinity;
    if (this.follow && !this.g && this.gw > 0) {
      const x = this.t2x(this.ph);
      if (x > this.W - 12 || x < this.gut) { const o = this.sx; this.sx = this.ph - this.gw * 0.04 / this.ppt; this.clampX(); if (this.sx !== o) this.dirty = true; }
    }
    if (!sync || this.dead) { this._req(); return; }
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    this._frame();
  }
  getInsertPoint() { return this.ins; }
  // bring tick t into view (the arrangement's double-tapped bar): scrolled to just before it unless it already shows
  reveal(t) {
    t = Math.max(0, +t || 0);
    if (this.gw < 10) return;
    const x = this.t2x(t);
    if (x >= this.gut && x <= this.gut + this.gw * 0.75) return;
    this.sx = t - this.gw * 0.04 / this.ppt; this.clampX(); this._view();
  }
  _notes() { const tr = this.host.getTrack(); return tr ? tr.notes : []; }
  _setSel(ids) { this.sel = new Set(ids); this._notify(); this.render(); }
  selectAll() { this._setSel(this._notes().map(x => x.id)); }
  selectNone() { this._setSel([]); }
  invertSelection() { this._setSel(this._notes().filter(x => !this.sel.has(x.id)).map(x => x.id)); }
  selectPitch(n) { this._setSel(this._notes().filter(x => x.n === n).map(x => x.id)); }
  _selRow(r) { this._setSel(this._notes().filter(x => this._row(x.n) === r).map(x => x.id)); } // ((7a) a drum row: "Other" holds many notes)
  getSelection() { return this.sel.size ? this._notes().filter(x => this.sel.has(x.id)) : []; }
  getTargetNotes() { const s = this.getSelection(); return s.length ? s : this._notes().slice(); }
  deleteSelected(label = 'Delete notes') {
    if (!this.host.getTrack() || !this.sel.size) return 0;
    const ids = new Set(this.sel); let k = 0;
    this.host.edit(label, () => { const tr = this.host.getTrack(); if (tr) k = removeIds(tr.notes, ids); });
    this.sel.clear(); this._notify(); this.render();
    return k;
  }
  copy() { const s = this.getSelection(); return s.length ? copyNotes(s) : null; }
  cut() { const clip = this.copy(); if (clip) this.deleteSelected('Cut notes'); return clip; }
  paste(clip, at, label = 'Paste notes') {
    const list = clipList(clip);
    if (!this.host.getTrack() || !list.length) return [];
    if (at == null) at = this.ins != null ? this.ins : this.host.getPlayhead();
    at = Math.max(0, Math.round(+at || 0));
    let ins = [];
    this.host.edit(label, () => {
      const tr = this.host.getTrack();
      if (!tr) return;
      const used = this._ids();
      ins = pasteNotes(tr, clip, at);
      for (const x of ins) { if (used.has(x.id)) x.id = uid(used); else used.add(x.id); }
      sortNotes(tr.notes);
    });
    let span = 0, ss = 0;
    for (const x of list) { span = Math.max(span, x.t + x.d); ss = Math.max(ss, x.t); }
    this.ins = at + (clip.kind === 'range' && clip.len > 0 ? clip.len : this._repLen(span, ss));
    this.sel = new Set(ins.map(x => x.id)); this._notify(); this.render();
    return ins;
  }
  duplicate() {
    const s = this.getSelection();
    if (!s.length) return [];
    let a = Infinity, b = 0, c = 0;
    for (const x of s) { a = Math.min(a, x.t); b = Math.max(b, x.t + x.d); c = Math.max(c, x.t); }
    return this.paste(copyNotes(s), a + this._repLen(b - a, c - a), 'Duplicate notes');
  }
  // musical repeat length for a phrase `len` ticks long whose last note starts `ss` after its first:
  // whole bars for phrases >= half a bar, beats for short motifs, else snap steps. A release tail of up to
  // a 16th (or a quarter unit) past the unit doesn't add a unit, but every copy starts after the last original start.
  _repLen(len, ss = 0) {
    const p = this.host.getProject();
    if (!p || len <= 0) return Math.max(1, len);
    const bar = barTicks(p), beat = beatTicks(p), u = len >= bar / 2 ? bar : len >= beat ? beat : this._snap() || 1;
    const tol = Math.min(u / 4, PPQ / 4);
    return u * Math.max(1, Math.ceil((len - tol) / u - 1e-9), Math.floor(Math.max(0, ss) / u) + 1);
  }
  nudge(dt, dn) {
    const s = this.getSelection();
    if (!s.length) return;
    let a = Infinity, lo = 127, hi = 0;
    for (const x of s) { a = Math.min(a, x.t); lo = Math.min(lo, x.n); hi = Math.max(hi, x.n); }
    // (the drum rows: dn rows up)
    dt = Math.max(Math.round(+dt || 0), -a); dn = this.rows ? 0 - this._rowClamp(s.map(x => x.n), -Math.round(+dn || 0)) : clamp(Math.round(+dn || 0), -lo, 127 - hi);
    if (!dt && !dn) return;
    this.host.edit('Nudge notes', () => { for (const x of s) { x.t += dt; x.n = this.rows ? this._rowNote(x.n, -dn) : x.n + dn; } const tr = this.host.getTrack(); if (tr) sortNotes(tr.notes); });
    if (dn && s.length === 1) this._blip(s[0].n, s[0].v);
    this.render();
  }
  destroy() {
    if (this.g) this._finish(false);
    for (const n of [...this.keys]) this._audOff(n);
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.autoRaf) cancelAnimationFrame(this.autoRaf);
    this.raf = this.autoRaf = 0;
    for (const [ev, fn, o] of this._ls) this.el.removeEventListener(ev, fn, o);
    if (this.ro) this.ro.disconnect(); else window.removeEventListener('resize', this._wr);
    this.el.remove();
    this.dead = true;
  }

  /* ------------------------------------------------------- internals */
  _notify() { if (this.host.onSelect) this.host.onSelect(this.sel.size); }
  _aud(n, v) { this.host.audition(n, clamp(Math.round(v) || 100, 1, 127)); this.keys.add(n); this._req(); }
  _audOff(n) { if (n == null) return; this.host.auditionOff(n); this.keys.delete(n); this._req(); }
  _blip(n, v) { this._aud(n, v); setTimeout(() => { if (!this.dead) this._audOff(n); }, 170); }
  _cursor(c) { if (c !== this.cur) { this.cur = c; this.el.style.cursor = c; } }
  _focus(e) { this.focused = e.type === 'focus'; this._req(); }
  _menu(e) { e.preventDefault(); }
  _pal(col) {
    let p = this.pals.get(col);
    if (p) return p;
    // ((review R-13) lit: the names' ink on a block under the lights' wash — the same rule on the washed colour)
    const c = rgb(col), fill = [], sel = [], edge = [], txt = [], lit = [], W = [255, 255, 255];
    const ink = (b, s) => [lum(b) < 0.42 ? 'rgba(255,255,255,0.78)' : 'rgba(10,11,13,0.78)', lum(s) < 0.42 ? 'rgba(255,255,255,0.85)' : 'rgba(10,11,13,0.82)'];
    for (let i = 0; i < 16; i++) {
      const b = c.map(x => x * (0.36 + 0.64 * i / 15)), s = mix(b, W, 0.3);
      fill.push(css(b)); sel.push(css(s)); edge.push(css(b.map(x => x * 0.5)));
      txt.push(ink(b, s)); lit.push(ink(mix(b, W, 0.42), mix(s, W, 0.42)));
    }
    p = { c, fill, sel, edge, txt, lit, stem: css(c.map(x => x * 0.7)), head: css(c), ghost: `rgba(${c[0]},${c[1]},${c[2]},0.22)`, line: `rgba(${c[0]},${c[1]},${c[2]},0.6)` };
    this.pals.set(col, p);
    return p;
  }
  // modifiers of a gesture: the event's keys or the host's touch latches (Fine = no snap, Alt = copy / paint, Shift = add)
  _mods(e) { const h = this.host; return h.mods ? h.mods(e) : { fine: !!(e && e.shiftKey), alt: !!(e && e.altKey), shift: !!(e && e.shiftKey) }; }
  _zones(pk, tool) { return (pk && ZONES[pk] && ZONES[pk][tool]) || null; }
  // z: a touch / pen zone table (_zones), else (mouse) the legacy test below, unchanged
  _hit(x, y, z) {
    if (z) return this._hitZ(x, y, z);
    const tr = this.host.getTrack();
    if (!tr || y < RUL || y >= this.gb || x < this.gut) return null;
    const r = this.y2r(y);
    let best = null, bp = -1;
    for (const nt of tr.notes) {
      if (this._row(nt.n) !== r) continue;
      const x0 = this.t2x(nt.t), x1 = Math.max(x0 + 2, this.t2x(nt.t + nt.d));
      if (x < x0 - 1 || x > x1 + 2) continue;
      const pr = (x >= x0 && x <= x1 ? 2 : 0) + (this.sel.has(nt.id) ? 1 : 0);
      if (pr >= bp) { bp = pr; best = { note: nt, x0, x1 }; }
    }
    if (!best) return null;
    const w = best.x1 - best.x0;
    if (w < 10) best.part = x > best.x1 ? 'r' : 'b';
    else { const rz = w >= 18 ? 6 : 3, lz = w >= 18 ? 4 : 2; best.part = x >= best.x1 - rz ? 'r' : x <= best.x0 + lz ? 'l' : 'b'; }
    return best;
  }
  // Touch / pen hit test: notes within the zones of z (rows above / below too), best first by class k — 3 a selected
  // note's handle within HWIN of the note (wins over an unselected neighbour's body: back-to-back notes stay grabbable)
  // or a selected note's body (at d 0 it beats a selected neighbour's outer handle: a selected run moves), 2 inside an
  // unselected note, 1.5 a selected note's handle farther out, 1 within reach — then by distance dx + 2·dy, then the
  // later note
  _hitZ(x, y, z) {
    const tr = this.host.getTrack();
    if (!tr || y < RUL || y >= this.gb || x < this.gut) return null;
    const rh = this.rowH, room = Math.max(0, (TROW - rh) / 2), sy = Math.min(z.slopY, room), su = Math.min(z.slopU, room);
    const rTop = this.y2r(Math.max(RUL, y - sy)), rBot = this.y2r(Math.min(this.gb - 1, y + sy));
    // Draw: outside a note only from the grid cell(s) it ends / starts in; 3 px elsewhere and with snap Off
    const snap = this._snap(), cell = z === ZONES.touch.draw || z === ZONES.pen.draw ? (snap ? snapTick(this.x2t(x), snap, 'floor') : -1) : null;
    let best = null, bk = -1, bd = Infinity;
    for (const nt of tr.notes) {
      const nr = this._row(nt.n);
      if (nr < rTop || nr > rBot) continue;
      const sel = this.sel.has(nt.id), ry = this.r2y(nr), dy = y < ry ? ry - y : y >= ry + rh ? y - (ry + rh) + 1 : 0;
      if (dy > (sel ? sy : su)) continue;
      const x0 = this.t2x(nt.t), x1 = Math.max(x0 + 2, this.t2x(nt.t + nt.d)), w = x1 - x0;
      let oR = sel ? z.outR : z.outU, oL = sel ? z.outL : 0;
      if (cell != null && !(cell >= 0 && cell < nt.t + nt.d && cell + snap > nt.t)) { oR = Math.min(oR, 3); oL = Math.min(oL, 3); }
      if (x < x0 - oL || x > x1 + oR) continue;
      const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
      const ri = Math.min(z.inR, w * (sel ? 0.45 : 0.4)), li = w >= z.minL ? Math.min(z.inL, w * 0.25) : 0;
      const part = x >= x1 - ri ? 'r' : li && x <= x0 + li ? 'l' : 'b';
      const k = sel && part !== 'b' ? (dx <= HWIN ? 3 : 1.5) : !dx && !dy ? (sel ? 3 : 2) : 1, d = dx + 2 * dy;
      if (k > bk || (k === bk && d <= bd)) { bk = k; bd = d; best = { note: nt, x0, x1, part, k }; }
    }
    return best;
  }
  _stemAt(x, y, reach = 5) {
    let best = null, bs = Infinity;
    for (const nt of this._notes()) {
      const dx = Math.abs(this.t2x(nt.t) - x);
      if (dx > reach) continue;
      const s = dx + Math.abs(this.v2y(nt.v) - y) * 0.25 - (this.sel.has(nt.id) ? 1 : 0);
      if (s < bs) { bs = s; best = nt; }
    }
    return best;
  }
  _loopEdge(x, reach = 5) {
    const p = this.host.getProject(), lp = p && p.loop;
    if (!lp || !(lp.end > lp.start)) return null;
    const near = t => { const ex = this.t2x(t); return ex >= this.gut && ex <= this.W && Math.abs(x - ex) <= reach; };
    return near(lp.end) ? 'end' : near(lp.start) ? 'start' : null;
  }
  // the row under client y (r) and its note (n; −1: the drum rows' "Other")
  _hrow(hv, y) { hv.r = clamp(this.y2r(y), 0, this._nRows() - 1); hv.n = this.rows && !hv.r ? -1 : this._rowN(hv.r); }
  // pk 'pen': a hovering Pencil sees the pen's zones
  _hover(x, y, quiet, pk) {
    const reg = this._region(x, y), hv = { reg, x, y, pk }, pen = pk === 'pen';
    let cur = 'default';
    if (reg === 'grid') {
      this._hrow(hv, y); hv.t = Math.max(0, this.x2t(x));
      const h = this._hit(x, y, pen ? this._zones('pen', this.tool) : null); hv.hit = h;
      cur = this.tool === 'erase' ? ERASER : h ? (h.part === 'b' ? 'move' : 'ew-resize') : this.tool === 'draw' ? PENCIL : 'crosshair';
    } else if (reg === 'keys') { this._hrow(hv, y); cur = 'pointer'; }
    else if (reg === 'ruler') { hv.t = Math.max(0, this.x2t(x)); cur = this._loopEdge(x, pen ? PLOOP : 5) ? 'ew-resize' : 'pointer'; }
    else if (reg === 'vel') { hv.t = Math.max(0, this.x2t(x)); hv.stem = this._stemAt(x, y, pen ? PSTEM : 5); cur = hv.stem ? 'ns-resize' : 'crosshair'; }
    this.hover = hv; this._cursor(cur);
    if (!quiet) this._req();
  }

  /* ---------------------------------------------------------- pointer */
  _down(e) {
    const [x, y] = this._pos(e);
    if (this.g && this.g.id === e.pointerId) this._finish(false, false, true); // this pointer's earlier pointerup never reached us
    if (e.pointerType === 'touch') {
      this.tseen = true; this.gfing = true;
      // a primary touch means no other finger is down: drop entries whose pointerup we missed
      if (e.isPrimary) { this.touches.clear(); if (this.g && (this.g.touch || this.g.type === 'pinch')) this._finish(false, false, true); }
      this.touches.set(e.pointerId, { x, y, reg: this._region(x, y) });
      if (this.touches.size === 2) {
        // a key the first finger sounds on the strip plays on until the pinch is confirmed (_pinchApply)
        const k = this.g && this.g.type === 'keys' ? this.g.key : null;
        if (k != null) this.g.key = null;
        if (this.g) this._finish(false, true, true); // undo whatever the first finger started; keep its capture
        for (const id of this.touches.keys()) try { this.el.setPointerCapture(id); } catch { /* pointer gone */ }
        this._pinchStart(); this.g.kaud = k; return;
      }
      if (this.touches.size > 2) return;
    }
    if (this.g) return;
    const btn = e.button;
    if (btn !== 0 && btn !== 1 && btn !== 5) return;
    e.preventDefault();
    try { this.el.focus({ preventScroll: true }); } catch { /* older browsers */ }
    try { this.el.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    // pk: 'touch' | 'pen' get their zones and thresholds per event; a mouse (or '') keeps the legacy ones
    const pk = e.pointerType === 'touch' || e.pointerType === 'pen' ? e.pointerType : null;
    if (pk && !this.coarse) { this.coarse = true; this._view(); }
    const reg = this._region(x, y), ts = e.timeStamp || Date.now(), lt = this.lastTap, m = this._mods(e);
    const tool = btn === 5 ? 'erase' : this.tool, tr = this.host.getTrack(), z = this._zones(pk, tool);
    // the hit first (hit / near: what a drag grabs): a double-tap counts only on the same target both times (a note, the
    // empty grid or a key), so two quick taps on neighbouring notes delete nothing. Touch / pen: the target is the note
    // under the press (ih: zero reach); a selected note's handle window counts only for a second tap off every note (t2:
    // a finger's wobble past a narrow note), so a double-tap beside / above a selected note or on its neighbour never
    // deletes it; dn: the note a double-tap deletes
    const hit = reg === 'grid' && tr && tool !== 'erase' ? this._hit(x, y, z) : null, near = !!hit && (!z || hit.k >= 2);
    const ih = z && hit ? this._hitZ(x, y, { ...z, outR: 0, outL: 0, outU: 0, slopY: 0, slopU: 0 }) : near ? hit : null;
    const tgt = reg === 'grid' ? (ih ? ih.note.id : 'empty') : reg === 'keys' ? 'k' + (this.rows ? 'r' + clamp(this.y2r(y), 0, this._nRows() - 1) : clamp(this.y2n(y), 0, 127)) : reg;
    const t2 = reg === 'grid' && !ih && near ? hit.note.id : tgt;
    const dz = pk === 'touch' ? TDBL : pk === 'pen' ? PDBL : DBL;
    const dbl = !!lt && btn === 0 && ts - lt.ts < 350 && Math.abs(x - lt.x) < dz && Math.abs(y - lt.y) < dz && lt.reg === reg && (lt.tgt === tgt || lt.tgt === t2);
    const dn = dbl && reg === 'grid' ? (ih ? ih.note : lt.tgt === t2 && t2 !== 'empty' ? hit.note : null) : null;
    this.lastTap = dbl ? null : { ts, x, y, reg, tgt };
    // sh: no snap (Shift / Fine; the event's Shift is re-read per move, fl keeps the latch); add: Shift (add to the
    // selection); alt: Alt (copy / paint)
    const g = this.g = { id: e.pointerId, type: 'none', x0: x, y0: y, x, y, dmax: 0, sh: m.fine, fl: this._mods(null).fine, add: m.shift, alt: m.alt,
      moved: false, began: false, touch: pk === 'touch', pen: pk === 'pen', z, ze: this._zones(pk, 'erase') };
    // touch gestures can turn into a pinch: keep what's needed to roll their edits back
    if (g.touch && tr && (reg === 'grid' || reg === 'vel')) g.orig = { tr, list: tr.notes.slice(), vals: tr.notes.map(o => [o.t, o.d, o.n, o.v]), sel: new Set(this.sel) };
    this.hover = null;
    if (btn === 1) return this._panStart(g);
    if (reg === 'ruler') return this._rulerDown(g, x);
    if (reg === 'keys') return this._keysDown(g, x, y, dbl);
    if (!tr) { if (g.touch && reg === 'grid') this._panStart(g); return; }
    if (reg === 'vel') return this._velDown(g, x, y, g.alt);
    if (reg !== 'grid') return;
    if (g.touch && (tool === 'erase' || (tool === 'draw' && !hit))) {
      g.type = 'hold'; g.tool = tool;
      g.timer = setTimeout(() => { if (this.g === g) { this._holdGo(); this._apply(); } }, HOLD);
      return;
    }
    if (tool === 'erase') return this._eraseStart(g, x, y);
    if (dn) { g.type = 'none'; this._delNote(dn); return; }
    if (dbl && tool === 'select') { g.type = 'none'; this._dblCreate(x, y, g.sh); return; }
    if (hit) return this._noteDown(g, hit, e);
    if (tool === 'draw') return this._createStart(g, x, y);
    if (g.touch) {
      // a finger scrolls the roll; held still (LONG ms, LONG_SLOP px) it draws a select box instead
      g.tap = true; this._panStart(g);
      g.timer = setTimeout(() => { if (this.g === g && g.dmax < LONG_SLOP) this._lpMarquee(g); }, LONG);
      return;
    }
    g.type = 'marquee'; g.base = g.add ? new Set(this.sel) : new Set();
    g.ct0 = this.x2t(x); g.cy0 = y - RUL + this.syr;
    if (!g.add && this.sel.size) { this.sel.clear(); this._notify(); }
    this._setIns(x);
    this._cursor('crosshair'); this.render();
  }
  // a finger held still on the empty grid: undo any wobble scroll, select from the press point (Shift latch: add)
  _lpMarquee(g) {
    clearTimeout(g.timer); g.timer = 0;
    this.sx = g.sx0; this.sy = g.sy0; this.clampX(); this.clampY();
    g.type = 'marquee'; g.tap = false; g.moved = true; g.lp = now(); this.lastTap = null;
    g.base = g.add ? new Set(this.sel) : new Set();
    if (!g.add && this.sel.size) { this.sel.clear(); this._notify(); }
    g.ct0 = this.x2t(g.x0); g.cy0 = g.y0 - RUL + this.syr;
    this._setIns(g.x0); this._marquee(); this.render();
  }
  // a finger held still on a note: select its chord (every note starting with it, within CHORD_TOL, so a played chord
  // counts), which then moves / resizes as one; Shift latch: added to the selection
  _chordSel(g) {
    g.timer = 0;
    const t0 = g.note.t, ids = this._notes().filter(o => Math.abs(o.t - t0) <= CHORD_TOL).map(o => o.id);
    this.sel = new Set(g.add ? [...this.sel, ...ids] : ids); this.sel.add(g.note.id);
    g.solo = g.toggleOff = false; g.lp = now(); this.lastTap = null;
    this._notify(); this.render();
  }
  _setIns(x) { const s = this._snap(), t = Math.max(0, this.x2t(x)); this.ins = Math.max(0, s ? snapTick(t, s) : Math.round(t)); }
  _move(e) {
    const tp = e.pointerType === 'touch' && this.touches.get(e.pointerId);
    if (tp) [tp.x, tp.y] = this._pos(e);
    const g = this.g;
    // a pinch is applied once per frame (_frame), from both fingers' latest positions: one touch event's fingers arrive
    // as separate pointermoves, and the spread measured between them is off by one finger's step
    if (g && g.type === 'pinch') { g.pend = true; this._req(); return; }
    if (g) { if (g.id === e.pointerId) this._dragMove(e); return; }
    if (e.pointerType !== 'touch' && !e.buttons) {
      if (e.pointerType === 'mouse' && this.coarse) { this.coarse = false; this._view(); } // a mouse / trackpad again: no handles
      const [x, y] = this._pos(e); this._hover(x, y, false, e.pointerType);
    }
  }
  // a finger lifts: a pinch first catches up with the moves still waiting for a frame
  _tdel(e) {
    if (e.pointerType !== 'touch') return;
    if (this.g && this.g.type === 'pinch' && this.g.pend) { this._pinchApply(); this._req(); }
    this.touches.delete(e.pointerId);
  }
  _up(e) {
    this._tdel(e);
    const g = this.g;
    if (!g) return;
    if (g.type === 'pinch') { if (this.touches.size < 2) this._finish(false); return; }
    if (g.id !== e.pointerId) return;
    if (g.type === 'hold') { this._holdGo(); g.late = true; } // quick tap: draw / erase at the press point now
    this._finish(true);
  }
  _cancel(e) {
    this._tdel(e);
    const g = this.g;
    if (!g) return;
    if (g.type === 'pinch') { if (this.touches.size < 2) this._finish(false); return; }
    if (g.id === e.pointerId) this._finish(false, true);
  }
  _lost(e) {
    this._tdel(e);
    const g = this.g;
    if (!g) return;
    if (g.type === 'pinch') { if (this.touches.size < 2) this._finish(false); return; }
    if (g.id === e.pointerId) this._finish(false, false, true); // capture taken away mid-gesture: its pointerup may never come
  }
  _leave() { if (!this.g && this.hover) { this.hover = null; this._req(); } }
  _wheel(e) {
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? (this.H || 400) : 1;
    let dx = e.deltaX * k, dy = e.deltaY * k;
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.zoomX(Math.exp(-clamp(dy || dx, -60, 60) * 0.008), e.clientX); return; }
    if (e.altKey) { e.preventDefault(); this.zoomY(Math.exp(-clamp(dy || dx, -60, 60) * 0.008), e.clientY); return; }
    if (e.shiftKey && Math.abs(dy) > Math.abs(dx)) { dx = dy; dy = 0; }
    const ox = this.sx, oy = this.sy;
    this.sx += dx / this.ppt; this.sy += dy; this.clampX(); this.clampY();
    const ch = this.sx !== ox || this.sy !== oy;
    if (ch || Math.abs(dx) >= Math.abs(dy)) e.preventDefault(); // let the page scroll once the roll hits its vertical limit
    if (ch) { if (this.g) { this._apply(); this.render(); } else this._view(); }
  }
  // WebKit GestureEvents: always preventDefault (else Safari zooms the page). A gesture with a finger on the roll (gfing:
  // set by any touch pointerdown) is the pointers' pinch; without, it's a trackpad pinch: time, Shift = the keys
  _gest(e) {
    e.preventDefault();
    if (e.type === 'gesturestart') { this.gs = 1; this.gfing = this.touches.size > 0; return; }
    if (e.type !== 'gesturechange' || this.gfing || this.touches.size || !(e.scale > 0)) return;
    const f = e.scale / (this.gs || 1); this.gs = e.scale;
    if (e.shiftKey) this.zoomY(f, Number.isFinite(e.clientY) ? e.clientY : null); else this.zoomX(f, Number.isFinite(e.clientX) ? e.clientX : null);
  }
  _dragMove(e) {
    const g = this.g, [x, y] = this._pos(e);
    g.x = x; g.y = y; g.sh = !!e.shiftKey || g.fl;
    const d = Math.hypot(x - g.x0, y - g.y0);
    if (d > g.dmax) g.dmax = d;
    const thr = g.touch ? (g.type === 'resizeR' || g.type === 'resizeL' ? TSLOP_RZ : TSLOP) : g.pen ? PSLOP : 3;
    if (!g.moved && d >= thr) { g.moved = true; this._startDrag(); }
    this._apply();
    if (!this.autoRaf && this._autoDir().some(v => v)) this.autoRaf = requestAnimationFrame(this._autoTick);
  }
  _startDrag() {
    const g = this.g;
    if (g.type === 'hold') return this._holdGo();
    if (g.type !== 'move' && g.type !== 'resizeR' && g.type !== 'resizeL') return;
    const tr = this.host.getTrack();
    if (!tr) { g.type = 'none'; return; }
    const list = this.getSelection();
    if (!list.includes(g.note)) list.push(g.note);
    g.items = list.map(o => [o, o.t, o.d, o.n]); g.mt = g.note.t; g.md = g.note.d;
    let a = Infinity, lo = 127, hi = 0;
    for (const o of list) { a = Math.min(a, o.t); lo = Math.min(lo, o.n); hi = Math.max(hi, o.n); }
    g.minT = a; g.minN = lo; g.maxN = hi; g.ns = list.map(o => o.n); // ((7a) the drum rows clamp by rows: _rowClamp)
  }
  // first real change of a move/resize: only now open the undo step (and make the Alt copies), so a jittery click stays a click
  _edit0() {
    const g = this.g;
    if (g.began) return;
    this._begin(g.type === 'move' ? (g.dup ? 'Duplicate notes' : 'Move notes') : 'Resize notes');
    const tr = this.host.getTrack();
    if (!g.dup || !tr) return;
    const used = this._ids(), k = g.items.findIndex(it => it[0] === g.note);
    g.items = g.items.map(([o, t, d, n]) => { const c = { ...o, t, d, n, id: uid(used) }; tr.notes.push(c); return [c, t, d, n]; });
    g.note = g.items[k][0];
    this.sel = new Set(g.items.map(it => it[0].id)); this._notify();
  }
  _begin(label) { const g = this.g; if (g && !g.began) { g.began = true; this.host.beginEdit(label); } }
  _holdGo() {
    const g = this.g;
    if (!g || g.type !== 'hold') return;
    clearTimeout(g.timer); g.timer = 0;
    if (g.tool === 'erase') this._eraseStart(g, g.x0, g.y0); else this._createStart(g, g.x0, g.y0);
  }
  _rollback(g) {
    // a ruler / loop-edge drag a second finger took over: the loop as at the press (its on flag too: setLoop turns it on)
    const L = g.loop0;
    if (L && g.looped) { if (this.host.restoreLoop) this.host.restoreLoop(L); else if (L.end > L.start) this.host.setLoop(L.start, L.end); }
    const o = g.orig, tr = this.host.getTrack();
    if (!o || tr !== o.tr) return;
    if (g.began) { tr.notes.length = 0; o.list.forEach((x, i) => { [x.t, x.d, x.n, x.v] = o.vals[i]; tr.notes.push(x); }); }
    this.sel = o.sel; this._notify();
  }
  _apply() {
    const g = this.g;
    if (!g) return;
    switch (g.type) {
      case 'pan': // a finger scrolls once past its drag threshold (a still finger may yet become a select box)
        if (!g.touch || g.moved) { this.sx = g.sx0 - (g.x - g.x0) / this.ppt; this.sy = g.sy0 - (g.y - g.y0); this.clampX(); this.clampY(); this._view(); }
        break;
      case 'marquee': if (g.moved) this._marquee(); break;
      case 'move': if (g.moved) this._moveApply(); break;
      case 'resizeR': case 'resizeL': if (g.moved) this._resizeApply(); break;
      case 'create': this._createApply(); break;
      case 'erase': this._eraseApply(); break;
      case 'vel': this._velApply(); break;
      case 'velpaint': this._paintApply(); break;
      case 'keys': this._keysApply(); break;
      case 'ruler': if (g.moved) this._loopApply(); break;
      case 'loopEdge': if (g.moved) this._edgeApply(); break;
    }
  }
  // click: ended by pointerup; abort: cut short (pinch / pointercancel) so a touch gesture's edits are rolled back; keep: leave pointer capture alone
  _finish(click, abort = false, keep = false) {
    const g = this.g;
    if (!g) return;
    this.g = null;
    if (g.timer) clearTimeout(g.timer);
    if (this.autoRaf) { cancelAnimationFrame(this.autoRaf); this.autoRaf = 0; }
    if (g.type === 'pinch') return this._pinchEnd(g);
    if (!keep) try { this.el.releasePointerCapture(g.id); } catch { /* already released */ }
    if (abort) this._rollback(g);
    if (g.began || g.lp || g.dmax >= (g.touch ? TTAP : DBL)) this.lastTap = null; // a drag (or a hold) isn't the first half of a double-click
    // a latched (not locked) modifier served this gesture; a scroll or the key strip reads none: kept for the next edit
    if (!abort && this.host.consumeMods && !(g.type === 'pan' && g.moved) && g.type !== 'keys') this.host.consumeMods();
    switch (g.type) {
      case 'move': case 'resizeR': case 'resizeL':
        if (!g.began && click) {
          if (g.toggleOff) this.sel.delete(g.note.id);
          else if (g.solo) this.sel = new Set([g.note.id]);
          this._notify();
        } else if (g.began && !abort && g.type !== 'move' && g.items && g.items.length === 1) this.lastLen = g.note.d;
        this._audOff(g.aud); break;
      case 'create': {
        if (g.sized && !abort) this.lastLen = g.note.d;
        const n = g.aud;
        if (g.late && !abort) setTimeout(() => { if (!this.dead) this._audOff(n); }, 170); else this._audOff(n);
        break;
      }
      case 'keys': this._audOff(g.key); break;
      case 'pan':
        if (g.tap && !g.moved && click) { if (!g.sh && !g.add && this.sel.size) { this.sel.clear(); this._notify(); } this._setIns(g.x0); }
        break;
      case 'ruler': case 'loopEdge':
        // a press that never changed the loop and barely moved is a click: set the playhead where it was pressed
        if (click && !g.looped && g.dmax < (g.touch ? 12 : 8)) {
          const s = g.sh ? 0 : this._snap(), t = Math.max(0, g.rt0);
          this.ph = Math.max(0, s ? snapTick(t, s) : Math.round(t)); this.host.setPlayhead(this.ph);
        }
        break;
    }
    if (g.began) { const tr = this.host.getTrack(); if (tr) sortNotes(tr.notes); this.host.endEdit(); }
    if (!g.touch) this._hover(g.x, g.y, true, g.pen ? 'pen' : undefined);
    if (g.began) this.render(); else this._view(); // ((review R-16) a scroll's end: the notes as they were)
  }
  _autoDir() {
    const g = this.g;
    if (!g || !g.moved || !AUTO_X.has(g.type)) return [0, 0];
    // a finger gets wider zones (it hides what it nears); one that pressed inside a zone scrolls only once it moves on
    // toward that edge (a resize grabbed near the right edge doesn't run off at once)
    const t = g.touch, R = this.W - (t ? TEDGE : 6), L = this.gut + (t ? 12 : 0), T = RUL + (t ? 10 : 0), B = this.gb - (t ? 10 : 0);
    let vx = 0, vy = 0;
    if (g.x > R && (!t || g.x0 <= R || g.x > g.x0 + 4)) vx = g.x - R + 1; else if (g.x < L && (!t || g.x0 >= L || g.x < g.x0 - 4)) vx = g.x - L - 1;
    if (AUTO_Y.has(g.type)) {
      if (g.y < T && (!t || g.y0 >= T || g.y < g.y0 - 4)) vy = g.y - T - 1;
      else if (g.y > B && (!t || g.y0 <= B || g.y > g.y0 + 4)) vy = g.y - B + 1;
    }
    return [vx, vy];
  }
  _autoTick() {
    this.autoRaf = 0;
    const [vx, vy] = this._autoDir();
    if (!vx && !vy) return;
    const sp = v => Math.sign(v) * Math.min(30, 2 + Math.abs(v) * 0.5), ox = this.sx, oy = this.sy;
    this.sx += sp(vx) / this.ppt; this.sy += sp(vy); this.clampX(); this.clampY();
    if (ox === this.sx && oy === this.sy) return;
    this._apply(); this.render();
    this.autoRaf = requestAnimationFrame(this._autoTick);
  }

  /* -------------------------------------------------------- gestures */
  _panStart(g) { g.type = 'pan'; g.sx0 = this.sx; g.sy0 = this.sy; this._cursor('grabbing'); }
  // Two fingers zoom and pan; the tick and pitch under their midpoint stay under it. Zone and axis are chosen once, from
  // where and at what angle the fingers land: on the key strip (midpoint < GUT+16 px, ≥ 45° from horizontal) the rows
  // (the keys' size), time held; from the ruler, velocity lane or a corner, time; on the grid rows when steeper than 60°,
  // else time. prev: the pinch this one continues (another finger took over) — its start row height and pending key.
  _pinchStart(prev) {
    const ids = [...this.touches.keys()].slice(0, 2), [a, b] = ids.map(i => this.touches.get(i)), r = a.reg;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, ang = Math.atan2(Math.abs(a.y - b.y), Math.abs(a.x - b.x)) * 180 / Math.PI;
    const zone = mx < this.gut + 16 && ang >= 45 ? 'keys' : r === 'ruler' || r === 'corner' || r === 'vel' || r === 'velg' ? 'time' : 'grid';
    this.lastTap = null; // its first finger is no first half of a double-tap
    this.g = { type: 'pinch', ids, zone, ax: zone === 'keys' || (zone === 'grid' && ang > 60) ? 'y' : 'x', on: false, pend: false,
      d0: Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), mx0: mx, my0: my, ppt0: this.ppt, rowHf0: this.rowHf, sx0: this.sx,
      tm: this.x2t(mx), row: (this.sy + my - RUL) / this.rowH, rh0: prev ? prev.rh0 : this.rowHf, kaud: prev ? prev.kaud : null };
  }
  _pinchApply() {
    let g = this.g;
    g.pend = false;
    const ids = [...this.touches.keys()].slice(0, 2);
    if (ids.length < 2) return;
    if (ids[0] !== g.ids[0] || ids[1] !== g.ids[1]) { this._pinchStart(g); g = this.g; } // a palm / third finger took over: restart from this view
    const [a, b] = ids.map(i => this.touches.get(i)), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, d = Math.max(20, Math.hypot(a.x - b.x, a.y - b.y));
    // the zoom engages after PZ_ENGAGE px of spread change, rebased there (no jump): a two-finger pan stays a pure pan
    if (!g.on && Math.abs(d - g.d0) >= PZ_ENGAGE) { g.on = true; g.d0 += Math.sign(d - g.d0) * PZ_ENGAGE; }
    // a confirmed pinch (zooming, or panned PZ_ENGAGE px) stops the first finger's key
    if (g.kaud != null && (g.on || Math.hypot(mx - g.mx0, my - g.my0) >= PZ_ENGAGE)) { this._audOff(g.kaud); g.kaud = null; }
    if (g.on && g.ax === 'x') this.ppt = clamp(g.ppt0 * d / g.d0, this._minPpt(), MAXPPT);
    else if (g.on) { this.rowHf = clamp(g.rowHf0 * d / g.d0, ROW_MIN, ROW_MAX); this.rowH = Math.round(this.rowHf); }
    this.sx = g.zone === 'keys' ? g.sx0 : g.tm - (mx - this.gut) / this.ppt;
    this.sy = g.row * this.rowH - (my - RUL);
    this.clampX(); this.clampY(); this.dirty = true;
  }
  // every pinch ends here (_finish): a changed row height is the user's choice for this device
  _pinchEnd(g) {
    if (g.kaud != null) this._audOff(g.kaud);
    if (this.rowHf !== g.rh0) this._rowsChosen();
    this._view();
  }
  _rulerDown(g, x) {
    const edge = this._loopEdge(x, g.touch ? TLOOP : g.pen ? PLOOP : 5), p = this.host.getProject(), lp = p && p.loop;
    g.rt0 = this.x2t(x);
    if (g.touch && lp) g.loop0 = { start: lp.start, end: lp.end, on: !!lp.on }; // (_rollback: a second finger took over)
    if (edge) { g.type = 'loopEdge'; g.edge = edge; g.et0 = p.loop[edge]; this._cursor('ew-resize'); }
    else g.type = 'ruler';
  }
  _keysDown(g, x, y, dbl) {
    // ((7a) the drum rows: "Other" sounds nothing; a double-tap selects the row)
    const r = clamp(this.y2r(y), 0, this._nRows() - 1);
    g.type = 'keys'; g.key = this._keyAt(y); g.kv = clamp(Math.round(40 + 87 * x / (this.gut - 8)), 1, 127);
    if (g.key != null) this._aud(g.key, g.kv);
    if (dbl) { if (this.rows) this._selRow(r); else this.selectPitch(g.key); }
  }
  _keyAt(y) { const r = this.y2r(y); return this.rows && r < 1 ? null : this._rowN(r); }
  _keysApply() {
    const g = this.g, n = this._keyAt(g.y);
    if (n !== g.key) { this._audOff(g.key); g.key = n; if (n != null) this._aud(n, g.kv); }
  }
  _noteDown(g, hit, e) {
    const nt = hit.note, was = this.sel.has(nt.id);
    if (g.add) { if (was) g.toggleOff = true; else this.sel.add(nt.id); }
    else if (!was) this.sel = new Set([nt.id]);
    else if (this.sel.size > 1) g.solo = true;
    this._notify();
    g.type = hit.part === 'r' ? 'resizeR' : hit.part === 'l' ? 'resizeL' : 'move';
    g.note = nt; g.dup = g.alt && g.type === 'move';
    // pitch counts from the note's own row (a touch / pen press may land beside it: yo is that offset, 0 for a mouse);
    // touch: from the press's content row instead, with hysteresis (_rowsMoved)
    const ry = this.n2y(nt.n); g.yo = g.y0 - clamp(g.y0, ry, ry + this.rowH - 1);
    g.ct0 = this.x2t(g.x0); g.row0 = clamp(this.y2r(g.y0 - g.yo), 0, this._nRows() - 1); g.r0 = (g.y0 - RUL + this.syr) / this.rowH;
    g.aud = nt.n; this._aud(nt.n, nt.v);
    // a finger held still on the note selects its chord; not on a note of a larger selection (a pause to aim before
    // dragging it would drop the rest), unless Shift adds
    if (g.touch && (g.add || !was || this.sel.size < 2)) g.timer = setTimeout(() => { if (this.g === g && !g.moved && !g.began) this._chordSel(g); }, LONG);
    this._cursor(g.type === 'move' ? (g.dup ? 'copy' : 'move') : 'ew-resize');
    this.render();
  }
  // touch: whole rows the finger moved from the press, once ¾ of a row away (a sideways drag's drift keeps the pitch)
  _rowsMoved(g) {
    const k = g.r0 - (g.y - RUL + this.syr) / this.rowH;
    if (!g.dnOn && Math.abs(k) >= 0.75) g.dnOn = true;
    return g.dnOn ? Math.round(k) : 0;
  }
  _moveApply() {
    const g = this.g, snap = g.sh ? 0 : this._snap(), raw = this.x2t(g.x) - g.ct0, ax = Math.abs(raw * this.ppt);
    let dt = 0;
    // time follows after 4 px (touch: 10 px of a mostly sideways move, so a pitch drag's drift keeps the start)
    if (g.dtOn || (g.touch ? ax >= 10 && ax >= 0.5 * Math.abs(g.y - g.y0) : ax >= 4)) { g.dtOn = true; dt = snap ? snapTick(g.mt + raw, snap) - g.mt : Math.round(raw); }
    dt = Math.max(dt, -g.minT);
    // whole rows up from the press (the piano: semitones; the drum rows: rows, between named rows)
    const k = g.touch ? this._rowsMoved(g) : g.row0 - this.y2r(g.y - g.yo), dn = this.rows ? 0 - this._rowClamp(g.ns, -k) : clamp(k, -g.minN, 127 - g.maxN);
    if ((!g.began && !dt && !dn) || (dt === g.dt && dn === g.dn)) return;
    this._edit0();
    g.dt = dt; g.dn = dn;
    for (const [o, t, , n] of g.items) { o.t = t + dt; o.n = this.rows ? this._rowNote(n, -dn) : n + dn; }
    if (g.note.n !== g.aud) { this._audOff(g.aud); g.aud = g.note.n; this._aud(g.aud, g.note.v); }
    this.host.changed(); this.render();
  }
  _resizeApply() {
    const g = this.g, snap = g.sh ? 0 : this._snap(), raw = this.x2t(g.x) - g.ct0, mt = g.mt, me = g.mt + g.md;
    let dd;
    if (g.type === 'resizeR') {
      let end = snap ? snapTick(me + raw, snap) : Math.round(me + raw);
      if (end <= mt) end = snap ? snapTick(mt + 1, snap, 'ceil') : mt + 1;
      dd = end - me;
      if ((!g.began && !dd) || dd === g.dd) return;
      this._edit0();
      for (const [o, , d] of g.items) o.d = Math.max(1, Math.min(d, snap || 1), d + dd);
    } else {
      let st = snap ? snapTick(mt + raw, snap) : Math.round(mt + raw);
      if (st >= me) st = snap ? snapTick(me - 1, snap, 'floor') : me - 1;
      dd = st - mt;
      if ((!g.began && !dd) || dd === g.dd) return;
      this._edit0();
      for (const [o, t, d] of g.items) { const e = t + d, s = clamp(t + dd, 0, e - Math.max(1, Math.min(d, snap || 1))); o.t = s; o.d = e - s; }
    }
    g.dd = dd; this.host.changed(); this.render();
  }
  _createStart(g, x, y) {
    if (this.rows && this.y2r(y) < 1) { g.type = 'none'; return; } // ((7a) the drum rows' "Other": no pitch to draw at)
    const tr = this.host.getTrack(), snap = g.sh ? 0 : this._snap(), t0 = Math.max(0, this.x2t(x));
    const t = Math.max(0, snap ? snapTick(t0, snap, 'floor') : Math.round(t0)), n = this._rowN(this.y2r(y));
    this._begin('Draw note');
    const nt = { id: uid(this._ids()), t, d: this._len(), n, v: 100 };
    tr.notes.push(nt);
    this.sel = new Set([nt.id]); this._notify();
    this.lastTap = null; // a second click on the note just drawn mustn't count as a double-click (delete)
    g.type = 'create'; g.note = nt; g.t0 = t; g.aud = n; this._aud(n, nt.v);
    g.row0 = this._row(n); g.r0 = (y - RUL + this.syr) / this.rowH;
    this._cursor(PENCIL); this.host.changed(); this.render();
  }
  _createApply() {
    const g = this.g, nt = g.note, snap = g.sh ? 0 : this._snap();
    let ch = false;
    if (!g.sized && Math.abs(g.x - g.x0) >= (g.touch ? 10 : 4)) g.sized = true; // a finger's wobble is no resize
    if (g.sized) {
      const tt = this.x2t(g.x), end = snap ? snapTick(tt, snap, 'ceil') : Math.round(tt), d = Math.max(snap || 1, end - g.t0);
      if (d !== nt.d) { nt.d = d; ch = true; }
    }
    const n = this._rowN(g.touch ? g.row0 - this._rowsMoved(g) : this.y2r(g.y));
    if (n !== nt.n) { nt.n = n; ch = true; this._audOff(g.aud); g.aud = n; this._aud(n, nt.v); }
    if (ch) { this.host.changed(); this.render(); }
  }
  _dblCreate(x, y, noSnap) {
    if (this.rows && this.y2r(y) < 1) return; // ((7a) "Other": no pitch)
    const snap = noSnap ? 0 : this._snap(), t0 = Math.max(0, this.x2t(x));
    const nt = { id: uid(this._ids()), t: Math.max(0, snap ? snapTick(t0, snap, 'floor') : Math.round(t0)), d: this._len(), n: this._rowN(this.y2r(y)), v: 100 };
    this.host.edit('Add note', () => { const tr = this.host.getTrack(); if (tr) { tr.notes.push(nt); sortNotes(tr.notes); } });
    this.sel = new Set([nt.id]); this._notify(); this._blip(nt.n, nt.v); this.render();
  }
  _delNote(nt) {
    this.host.edit('Delete note', () => { const tr = this.host.getTrack(), i = tr ? tr.notes.indexOf(nt) : -1; if (i >= 0) tr.notes.splice(i, 1); });
    if (this.sel.delete(nt.id)) this._notify();
    this.render();
  }
  _eraseStart(g, x, y) { g.type = 'erase'; g.lx = x; g.ly = y; this._cursor(ERASER); this._eraseAt(x, y); }
  _eraseAt(x, y) {
    const h = this._hit(x, y, this.g && this.g.ze), tr = this.host.getTrack();
    if (!h || !tr) return;
    const i = tr.notes.indexOf(h.note);
    if (i < 0) return;
    this._begin('Erase notes');
    tr.notes.splice(i, 1);
    if (this.sel.delete(h.note.id)) this._notify();
    this.host.changed(); this.render();
  }
  _eraseApply() {
    const g = this.g, dx = g.x - g.lx, dy = g.y - g.ly, k = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 3));
    for (let i = 1; i <= k; i++) this._eraseAt(g.lx + dx * i / k, g.ly + dy * i / k);
    g.lx = g.x; g.ly = g.y;
  }
  // every tool grabs the stem under the press; Alt, a press away from stems, or a sideways sweep paints a line
  _velDown(g, x, y, paint) {
    const st = paint ? null : this._stemAt(x, y, g.touch ? TSTEM : g.pen ? PSTEM : 5);
    g.vt0 = this.x2t(x);
    if (st) {
      g.type = 'vel'; g.note = st; g.v0 = st.v;
      g.items = this.sel.has(st.id) && this.sel.size > 1 ? this.getSelection().map(o => [o, o.v]) : [[st, st.v]];
      this._cursor('ns-resize');
    } else this._paintStart(g);
    this._apply(); this._req();
  }
  _paintStart(g) { g.type = 'velpaint'; g.pt0 = g.vt0; g.py0 = g.y0; g.items = this._notes().map(o => [o, o.v]); this._cursor('crosshair'); }
  _velApply() {
    const g = this.g, ax = Math.abs(g.x - g.x0);
    if (ax >= 10 && ax > 1.5 * Math.abs(g.y - g.y0)) {
      let ch = false;
      for (const [o, ov] of g.items) if (o.v !== ov) { o.v = ov; ch = true; }
      if (ch) this.host.changed();
      this._paintStart(g); this._paintApply(); return;
    }
    const v = this.y2v(g.y), dv = v - g.v0, one = g.items.length === 1;
    let ch = false;
    for (const [o, ov] of g.items) {
      const nv = one ? v : clamp(Math.round(ov + dv), 1, 127);
      if (nv !== o.v) { this._begin('Set velocity'); o.v = nv; ch = true; }
    }
    if (ch) { this.host.changed(); this.render(); } else this._req();
  }
  _paintApply() {
    const g = this.g, t1 = this.x2t(g.x), tol = 2 / this.ppt, span = t1 - g.pt0;
    const a = Math.min(g.pt0, t1) - tol, b = Math.max(g.pt0, t1) + tol;
    let ch = false;
    for (const [o, ov] of g.items) {
      let nv = ov;
      if (o.t >= a && o.t <= b) nv = this.y2v(g.py0 + (g.y - g.py0) * (Math.abs(span) < 1e-6 ? 1 : clamp((o.t - g.pt0) / span, 0, 1)));
      if (nv !== o.v) { this._begin('Paint velocity'); o.v = nv; ch = true; }
    }
    if (ch) { this.host.changed(); this.render(); } else this._req();
  }
  _marquee() {
    const g = this.g, tr = this.host.getTrack();
    if (!tr) return;
    const t1 = this.x2t(g.x), cy1 = g.y - RUL + this.syr;
    const ta = Math.min(g.ct0, t1), tb = Math.max(g.ct0, t1);
    const rTop = Math.floor(Math.min(g.cy0, cy1) / this.rowH), rBot = Math.floor(Math.max(g.cy0, cy1) / this.rowH);
    const s = new Set(g.base);
    for (const nt of tr.notes) { const r = this._row(nt.n); if (r >= rTop && r <= rBot && nt.t < tb && nt.t + nt.d > ta) s.add(nt.id); }
    const ch = s.size !== this.sel.size;
    this.sel = s;
    if (ch) this._notify();
    this._view(); // ((review R-16) the selection only)
  }
  // ruler drags only touch the loop once they're clearly drags (8px mouse / 12px touch); shorter wobbles stay playhead clicks
  _loopWait(g) { return !g.looped && Math.abs(g.x - g.x0) < (g.touch ? 12 : 8); }
  _loopApply() {
    const g = this.g;
    if (this._loopWait(g)) return;
    const snap = g.sh ? 0 : this._snap(), sn = t => Math.max(0, snap ? snapTick(t, snap) : Math.round(t)), m = snap || 1;
    const a = sn(g.rt0), b = sn(this.x2t(g.x));
    if (!g.looped && a === b) return;
    let s = Math.min(a, b), e = Math.max(a, b);
    if (e - s < m) { if (b >= a) e = s + m; else { s = Math.max(0, e - m); e = s + m; } }
    if (s === g.ls && e === g.le) return;
    g.ls = s; g.le = e; g.looped = true; this.host.setLoop(s, e); this.render();
  }
  _edgeApply() {
    const g = this.g, p = this.host.getProject(), lp = p && p.loop;
    if (!lp || this._loopWait(g)) return;
    // move the edge by the pointer's travel from the grab point, then snap
    const snap = g.sh ? 0 : this._snap(), m = snap || 1, raw = Math.max(0, g.et0 + this.x2t(g.x) - g.rt0), t = snap ? snapTick(raw, snap) : Math.round(raw);
    let s = lp.start, e = lp.end;
    if (g.edge === 'start') s = clamp(t, 0, Math.max(0, e - m)); else e = Math.max(t, s + m);
    if (s !== lp.start || e !== lp.end) { g.looped = true; this.host.setLoop(s, e); this.render(); }
  }

  /* ---------------------------------------------------------- drawing */
  _frame() {
    this.raf = 0;
    if (this.g && this.g.type === 'pinch' && this.g.pend) this._pinchApply();
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    if (dpr !== this.dpr) { this.resize(); return; }
    if (this.W < 2 || this.gh < 4) return;
    if (this.dirty && !this.g && this._syncRows()) this._centre(); // ((7a) a drum map edited elsewhere)
    if (this.want) this._applyWant();
    if (this.dirty) {
      this.dirty = false;
      if (this.hover && !this.g) this._hover(this.hover.x, this.hover.y, true, this.hover.pk);
      this._scene(this.bctx);
    }
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(this.back, 0, 0);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._overlay(c);
  }
  _vlines(c, y0, y1, bar, beat, snap, a) {
    const ppt = this.ppt, t0 = Math.max(0, this.x2t(this.gut)), t1 = this.x2t(this.W), h = y1 - y0;
    const lines = (step, skip, style) => {
      c.beginPath();
      for (let k = Math.ceil(t0 / step - 1e-9); k * step <= t1; k++) {
        const t = k * step;
        if (skip && Math.abs(t / skip - Math.round(t / skip)) < 1e-6) continue;
        c.rect(Math.round(this.t2x(t)), y0, 1, h);
      }
      c.fillStyle = style; c.fill();
    };
    let bs = bar;
    while (bs * ppt < 8) bs *= 2;
    const sub = snap > 0 ? (snap < beat ? snap : 0) : beat / 4; // snap of a beat or more: beat & bar lines already show it
    if (sub && sub * ppt >= 6) lines(sub, beat, `rgba(255,255,255,${0.028 * a})`);
    if (beat * ppt >= 5 && beat < bar) lines(beat, bar, `rgba(255,255,255,${0.06 * a})`);
    lines(bs, 0, `rgba(255,255,255,${0.13 * a})`);
  }
  _scene(c) {
    const { W, H, dpr, ppt, rowH } = this, gb = this.gb, gw = this.gw, p = this.host.getProject(), tr = this.host.getTrack();
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = BG; c.fillRect(0, 0, W, H);
    if (!p) return;
    const bar = barTicks(p), beat = beatTicks(p), snap = this._snap(), lp = p.loop || {};
    const GUT = this.gut, t0 = this.x2t(GUT), t1 = this.x2t(W);
    // the rows in view (the row table: the piano's 128 or the drum rows), bottom first — the piano's notes ascending; a
    // drum row is shaded every other one ("Other" too); dn: the drum names (the piano dims the rows they leave out)
    const nR = this._nRows(), D = this.rows, dn = this.dn, rTop = clamp(this.y2r(RUL), 0, nR - 1), rBot = clamp(this.y2r(gb - 1), 0, nR - 1);
    const rowsIn = f => { for (let r = rBot; r >= rTop; r--) f(r, this._noteAt(r)); }, dshade = r => r === 0 || ((nR - 1 - r) & 1) === 1;
    const loopOk = lp.end > lp.start, lx0 = this.t2x(lp.start), lx1 = this.t2x(lp.end);

    // grid background, rows, loop tint, time lines
    c.save(); c.beginPath(); c.rect(GUT, RUL, gw, gb - RUL); c.clip();
    c.fillStyle = '#15161a'; c.fillRect(GUT, RUL, gw, gb - RUL);
    c.beginPath(); rowsIn((r, n) => { if (D ? dshade(r) : isBlk(n)) c.rect(GUT, this.r2y(r), gw, rowH); });
    c.fillStyle = '#0f1013'; c.fill();
    const yEnd = this.r2y(nR);
    if (yEnd < gb) { c.fillStyle = BG; c.fillRect(GUT, yEnd, gw, gb - yEnd); }
    if (D) { // a line under every drum row, a brighter one under "Other"
      c.beginPath(); rowsIn(r => { c.rect(GUT, this.r2y(r) + rowH - 1, gw, 1); });
      c.fillStyle = 'rgba(255,255,255,0.05)'; c.fill();
      c.fillStyle = 'rgba(255,255,255,0.14)'; c.fillRect(GUT, this.r2y(0) + rowH - 1, gw, 1);
    } else {
      c.beginPath(); rowsIn((r, n) => { if (n % 12 === 0) c.rect(GUT, this.r2y(r) + rowH - 1, gw, 1); });
      c.fillStyle = 'rgba(255,255,255,0.075)'; c.fill();
      c.beginPath(); rowsIn((r, n) => { if (n % 12 === 5) c.rect(GUT, this.r2y(r) + rowH - 1, gw, 1); });
      c.fillStyle = 'rgba(255,255,255,0.03)'; c.fill();
      if (dn) { c.beginPath(); rowsIn((r, n) => { if (!dn.has(n)) c.rect(GUT, this.r2y(r), gw, rowH); }); c.fillStyle = 'rgba(0,0,0,0.32)'; c.fill(); }
    }
    if (loopOk && lp.on) { c.fillStyle = 'rgba(242,163,58,0.045)'; c.fillRect(lx0, RUL, lx1 - lx0, gb - RUL); }
    this._vlines(c, RUL, gb, bar, beat, snap, 1);

    // ghost notes from the other tracks
    if (this.ghosts) {
      c.beginPath();
      for (const o of p.tracks) {
        if (o === tr || !o.notes) continue;
        for (const x of o.notes) {
          const r = this._row(x.n);
          if (x.t >= t1 || x.t + x.d <= t0 || r < rTop || r > rBot || (D && !r)) continue; // ((7a) not in "Other")
          const a = Math.max(GUT - 2, this.t2x(x.t)), b = Math.min(W + 2, this.t2x(x.t + x.d));
          c.rect(Math.round(a), this.r2y(r) + 1, Math.max(1.5, Math.round(b) - Math.round(a)), rowH - 1);
        }
      }
      c.fillStyle = 'rgba(141,139,134,0.25)'; c.fill();
    }

    // notes, bucketed by velocity level to keep state changes low
    const sel = this.sel, un = [], se = [];
    let present = 0;
    if (tr) {
      const pal = this._pal(tr.color);
      for (let i = 0; i < 16; i++) { un.push([]); se.push([]); }
      for (const x of tr.notes) {
        const s = sel.size > 0 && sel.has(x.id);
        if (s) present++;
        const r = this._row(x.n);
        if (x.t >= t1 || x.t + x.d <= t0 || r < rTop || r > rBot) continue;
        (s ? se : un)[Math.min(15, (x.v * 16 / 128) | 0)].push(x);
      }
      if (tr.mute) c.globalAlpha = 0.5;
      const rect = x => {
        const a = Math.round(Math.max(GUT - 4, this.t2x(x.t))), b = Math.max(a + 2, Math.round(Math.min(W + 4, this.t2x(x.t + x.d))));
        return [a, this.n2y(x.n), b - a];
      };
      const drawSet = (sets, fills, edge) => {
        for (let i = 0; i < 16; i++) {
          const L = sets[i];
          if (!L.length) continue;
          c.beginPath();
          for (const x of L) { const [a, y, w] = rect(x); rr(c, a + 0.5, y + 1.5, w - 1, rowH - 2, rowH >= 8 ? 2.5 : 1); }
          c.fillStyle = fills[i]; c.fill();
          c.lineWidth = 1; c.strokeStyle = edge || pal.edge[i]; c.stroke();
        }
      };
      drawSet(un, pal.fill, null);
      drawSet(se, pal.sel, '#ffffff');
      // touch / pen: grab tabs on the selected notes' ends (and starts, where a note is long enough for a start zone)
      let ns = 0;
      for (const L of se) ns += L.length;
      if (this.coarse && ns && ns <= 256) {
        const minL = ZONES.touch.select.minL, grips = [];
        c.beginPath();
        for (const L of se) for (const x of L) {
          const [a, y, w] = rect(x);
          rr(c, a + w - 3, y - 2, 7, rowH + 4, 3); grips.push(a + w, y);
          if (w >= minL) { rr(c, a - 4, y - 2, 7, rowH + 4, 3); grips.push(a - 1, y); }
        }
        c.fillStyle = 'rgba(255,255,255,0.92)'; c.fill(); c.lineWidth = 1; c.strokeStyle = BG; c.stroke();
        c.beginPath();
        for (let i = 0; i < grips.length; i += 2) c.rect(grips[i], grips[i + 1] + 3, 1, Math.max(1, rowH - 6));
        c.fillStyle = 'rgba(12,13,15,0.55)'; c.fill();
      }
      if (rowH >= 10) {
        const fs = clamp(Math.round(rowH * 0.4), 9, 14), cw = this.ncw = fs * 5.6 / 9; // names grow with tall (touch) rows
        c.font = this.nfont = `${fs}px ${FONT}`; c.textBaseline = 'middle'; c.textAlign = 'left'; // ((R) nfont / ncw: a lit note's name)
        for (const [sets, k] of [[un, 0], [se, 1]]) for (let i = 0; i < 16; i++) {
          if (!sets[i].length) continue;
          c.fillStyle = pal.txt[i][k];
          for (const x of sets[i]) {
            const [a, y, w] = rect(x), nm = this._nlab(x.n), vis = Math.min(a + w, W) - Math.max(a, GUT);
            if (vis >= nm.length * cw + 8) c.fillText(nm, Math.max(a, GUT) + 4, y + (rowH >> 1) + 1); // ((R) whole pixels: the lights draw it again)
          }
        }
      }
      c.globalAlpha = 1;
    }
    c.font = `11px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#5c5a56';
    if (!tr) c.fillText('No track selected', GUT + gw / 2, RUL + (gb - RUL) / 2);
    else if (!tr.notes.length) {
      const tip = this.coarse ? (this.tool === 'draw' ? 'Tap or drag to draw notes' : 'Double-tap to add a note (or pick Draw), or arm the track and record')
        : this.tool === 'draw' ? 'Click and drag to draw notes' : 'Double-click to add a note, or arm the track and record';
      c.fillText(tip, GUT + gw / 2, RUL + (gb - RUL) / 2);
    }
    c.restore();
    if (tr && present < sel.size && !this.g) { const ids = new Set(); for (const x of tr.notes) if (sel.has(x.id)) ids.add(x.id); this.sel = ids; this._notify(); }

    // velocity lane
    const vt = H - VEL;
    c.fillStyle = '#101114'; c.fillRect(GUT, vt, gw, VEL);
    c.save(); c.beginPath(); c.rect(GUT, vt, gw, VEL); c.clip();
    if (loopOk && lp.on) { c.fillStyle = 'rgba(242,163,58,0.035)'; c.fillRect(lx0, vt, lx1 - lx0, VEL); }
    this._vlines(c, vt, H, bar, beat, snap, 0.7);
    c.fillStyle = 'rgba(255,255,255,0.045)';
    for (const v of [32, 64, 96, 127]) c.fillRect(GUT, Math.round(this.v2y(v)), gw, 1);
    if (dn) { c.fillStyle = 'rgba(242,163,58,0.3)'; for (const v of [100, 127]) c.fillRect(GUT, Math.round(this.v2y(v)), gw, 1); } // ((7a) normal, accent)
    if (tr) {
      const pal = this._pal(tr.color), y0 = Math.round(this.v2y(0)), us = [], ss = [];
      for (const x of tr.notes) {
        const sx = this.t2x(x.t);
        if (sx < GUT - 3 || sx > W + 3) continue;
        (sel.has(x.id) ? ss : us).push(x);
      }
      const stems = (L, line, head) => {
        if (!L.length) return;
        c.beginPath(); for (const x of L) { const sx = Math.round(this.t2x(x.t)), y = Math.round(this.v2y(x.v)); c.rect(sx, y, 1, y0 - y + 1); }
        c.fillStyle = line; c.fill();
        c.beginPath(); for (const x of L) { const sx = Math.round(this.t2x(x.t)), y = Math.round(this.v2y(x.v)); c.rect(sx - 2, y - 1, 5, 3); }
        c.fillStyle = head; c.fill();
      };
      if (tr.mute) c.globalAlpha = 0.5;
      stems(us, pal.stem, pal.head); stems(ss, 'rgba(255,255,255,0.7)', '#ffffff');
      c.globalAlpha = 1;
    }
    c.restore();
    c.fillStyle = LINE; c.fillRect(0, gb, W, 1);

    // ruler
    c.fillStyle = '#111215'; c.fillRect(GUT, 0, gw, RUL);
    c.save(); c.beginPath(); c.rect(GUT, 0, gw, RUL); c.clip();
    if (loopOk) {
      c.fillStyle = lp.on ? 'rgba(242,163,58,0.2)' : 'rgba(141,139,134,0.12)'; c.fillRect(lx0, 0, lx1 - lx0, RUL - 1);
      c.fillStyle = lp.on ? ACC : '#5b5852'; c.fillRect(lx0, 0, lx1 - lx0, 3);
      c.fillRect(Math.round(lx0), 0, 1, RUL - 1); c.fillRect(Math.round(lx1) - 1, 0, 1, RUL - 1);
    }
    const bt0 = Math.max(0, t0);
    if (beat * ppt >= 6 && beat < bar) {
      c.beginPath();
      for (let k = Math.ceil(bt0 / beat - 1e-9); k * beat <= t1; k++) if ((k * beat) % bar) c.rect(Math.round(this.t2x(k * beat)), RUL - 6, 1, 5);
      c.fillStyle = '#3a3c42'; c.fill();
    }
    let stride = 1;
    while (bar * stride * ppt < 34) stride *= 2;
    const b0 = Math.floor(bt0 / bar), b1 = Math.ceil(t1 / bar);
    if (stride > 1 && bar * ppt >= 4) {
      c.beginPath(); for (let b = b0; b <= b1; b++) if (b % stride) c.rect(Math.round(this.t2x(b * bar)), RUL - 6, 1, 5);
      c.fillStyle = '#3a3c42'; c.fill();
    }
    c.beginPath(); for (let b = b0 - (b0 % stride); b <= b1; b += stride) c.rect(Math.round(this.t2x(b * bar)), 5, 1, RUL - 6);
    c.fillStyle = '#4a4c53'; c.fill();
    c.font = `10px ${FONT}`; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = '#a3a09a';
    for (let b = b0 - (b0 % stride); b <= b1; b += stride) c.fillText(String(b + 1), Math.round(this.t2x(b * bar)) + 4, 13);
    if (beat * ppt >= 60 && beat < bar) {
      c.font = `9px ${FONT}`; c.fillStyle = '#5f5d58';
      for (let k = Math.ceil(bt0 / beat - 1e-9); k * beat <= t1; k++) {
        const t = k * beat, r = t % bar;
        if (r) c.fillText(`${Math.floor(t / bar) + 1}.${Math.round(r / beat) + 1}`, Math.round(this.t2x(t)) + 4, 13);
      }
    }
    c.restore();
    c.fillStyle = LINE; c.fillRect(0, RUL - 1, W, 1);

    // key gutter
    c.save(); c.beginPath(); c.rect(0, RUL, GUT, gb - RUL); c.clip();
    c.fillStyle = BG; c.fillRect(0, RUL, GUT, gb - RUL);
    const ky0 = Math.max(RUL, this.r2y(0)), ky1 = Math.min(gb, yEnd);
    if (D) { // (7a) the drum rows: a name per row ("Other" on top), its note at the right
      c.fillStyle = '#1b1c20'; c.fillRect(0, ky0, GUT - 1, ky1 - ky0);
      c.beginPath(); rowsIn(r => { if (dshade(r)) c.rect(0, this.r2y(r), GUT - 1, rowH); });
      c.fillStyle = '#141518'; c.fill();
      c.beginPath(); rowsIn(r => { c.rect(0, this.r2y(r) + rowH - 1, GUT - 1, 1); });
      c.fillStyle = '#2a2c31'; c.fill();
      if (rowH >= 8) {
        c.font = this.dfont = `${clamp(Math.round(rowH * 0.45), 9, 12)}px ${FONT}`; c.textBaseline = 'middle'; // ((R) dfont: a lit row's name)
        rowsIn((r, n) => {
          const y = this.r2y(r) + (rowH >> 1) + 1;
          c.textAlign = 'left'; c.fillStyle = r ? '#d9d6ce' : MUTE; c.fillText(r ? dn.get(n) : 'Other', 6, y);
          if (r) { c.textAlign = 'right'; c.fillStyle = '#7a776f'; c.fillText(String(n), GUT - 5, y); }
        });
      }
    } else {
      c.fillStyle = '#cfccc4'; c.fillRect(0, ky0, GUT - 1, ky1 - ky0);
      c.beginPath(); rowsIn((r, n) => { if (isBlk(n)) c.rect(0, this.r2y(r), BW, rowH); });
      c.fillStyle = '#1d1e22'; c.fill();
      if (rowH >= 7) {
        c.beginPath(); rowsIn((r, n) => { if (isBlk(n)) c.rect(BW - 5, this.r2y(r) + 1, 3, rowH - 2); });
        c.fillStyle = '#35373d'; c.fill();
      }
      c.beginPath();
      rowsIn((r, n) => {
        const m = n % 12;
        if (m === 4 || m === 11) c.rect(0, this.r2y(r), GUT - 1, 1);
        else if (isBlk(n)) c.rect(BW, Math.round(this.r2y(r) + rowH / 2), GUT - 1 - BW, 1);
      });
      c.fillStyle = '#9f9c94'; c.fill();
      // C labels; every white key once rows are 18 px (the touch default) or taller; (7a) a drum row's name instead
      c.font = `${clamp(Math.round(rowH * 0.4), 9, 12)}px ${FONT}`; c.textAlign = 'right'; c.textBaseline = 'middle';
      rowsIn((r, n) => { if (!(dn && dn.has(n)) && (n % 12 === 0 || (rowH >= 18 && !isBlk(n)))) { c.fillStyle = n === 60 ? '#b4721c' : n % 12 ? '#8a877f' : '#69665f'; c.fillText(noteName(n), GUT - 5, this.r2y(r) + rowH / 2 + 0.5); } });
      if (dn) { // the rows no sound plays dimmed; the named ones on a plate right of the black keys (the number when it fits)
        c.beginPath(); rowsIn((r, n) => { if (!dn.has(n)) c.rect(0, this.r2y(r), GUT - 1, rowH); });
        c.fillStyle = 'rgba(12,13,15,0.38)'; c.fill();
        c.beginPath(); rowsIn((r, n) => { if (dn.has(n)) c.rect(BW, this.r2y(r) + 1, GUT - 1 - BW, Math.max(1, rowH - 1)); });
        c.fillStyle = '#26272c'; c.fill();
        if (rowH >= 8) {
          const fs = clamp(Math.round(rowH * 0.4), 9, 11), cw = fs * 5.6 / 9;
          c.font = `${fs}px ${FONT}`; c.textAlign = 'left';
          rowsIn((r, n) => {
            if (!dn.has(n)) return;
            const nm = dn.get(n), lab = (nm.length + 1 + String(n).length) * cw + 8 <= GUT - 1 - BW ? nm + ' ' + n : nm;
            c.fillStyle = '#e2ded5'; c.fillText(lab, BW + 4, this.r2y(r) + rowH / 2 + 0.5);
          });
        }
      }
    }
    c.restore();
    c.fillStyle = '#050506'; c.fillRect(GUT - 1, RUL, 1, gb - RUL);

    // corners
    c.fillStyle = '#111215'; c.fillRect(0, 0, GUT, RUL - 1); c.fillRect(0, vt, GUT, VEL);
    c.fillStyle = LINE; c.fillRect(GUT - 1, 0, 1, RUL); c.fillRect(GUT - 1, vt, 1, VEL);
    c.font = `9px ${FONT}`; c.textBaseline = 'middle'; c.textAlign = 'left'; c.fillStyle = MUTE; c.fillText('VEL', 8, vt + 12);
    c.textAlign = 'right'; c.fillStyle = '#4d4b47';
    c.fillText('127', GUT - 6, this.v2y(127) + 1);
    if (dn) c.fillText('100', GUT - 6, this.v2y(100)); else c.fillText('64', GUT - 6, this.v2y(64)); // ((7a) normal / accent)
  }
  /* (R, IMPL-R §3) the lights — no allocation per frame: fixed lists, counts, stamps */
  // the track's notes sounding at the playhead while the song plays (sAct[0…sCnt)). Notes are sorted by start (main's
  // changed() sorts them): a frame moving forward walks a cursor over the starts it passed (sI) and drops the ended; a jump
  // (back: a loop pass, a seek; far ahead) finds them again by a binary search over the starts — back by the longest short
  // note (sMax), the long ones (> LONG_T) kept apart (sLong). An edit (render: nv) re-reads the lengths and the order; a
  // dragged note may leave it unsorted until its edit ends — every frame scans then
  // ((review R-12) sAI: each one's index in the clip, for _keyOn)
  _sound(tr) {
    const L = this.play && tr ? tr.notes : null, ph = this.ph, A = this.sAct;
    if (!L || !L.length) { if (this.sN) { this.sLong.length = 0; this.sOwn.fill(null); } this.sCnt = 0; this.sN = null; return; } // (no clip held once none plays)
    if (L !== this.sN || L.length !== this.sLen || this.nv !== this.sV) this._sIndex(L);
    const n = L.length, I = this.sAI;
    let k = 0;
    if (!this.sOk) { // (and the last started of each pitch, in the song's order: by start, the array's for equal ones)
      const O = this.sOwn;
      O.fill(null);
      for (let i = 0; i < n; i++) {
        const x = L[i];
        if (x.t > ph) continue;
        const o = O[x.n];
        if (o === null || x.t >= o.t) O[x.n] = x;
        if (ph < x.t + x.d) { I[k] = i; A[k++] = x; }
      }
    } else if (ph >= this.sPh && ph - this.sPh <= Math.max(this.sMax, PPQ * 4)) {
      for (let j = 0; j < this.sCnt; j++) { const x = A[j]; if (ph < x.t + x.d) { I[k] = I[j]; A[k++] = x; } }
      let i = this.sI;
      for (; i < n; i++) { const x = L[i]; if (x.t > ph) break; if (ph < x.t + x.d) { I[k] = i; A[k++] = x; } }
      this.sI = i;
    } else {
      let lo = 0, hi = n;
      while (lo < hi) { const m = (lo + hi) >> 1; if (L[m].t <= ph) lo = m + 1; else hi = m; }
      const e = lo, t0 = ph - this.sMax;
      lo = 0; hi = e;
      while (lo < hi) { const m = (lo + hi) >> 1; if (L[m].t <= t0) lo = m + 1; else hi = m; }
      for (let i = lo; i < e; i++) { const x = L[i]; if (x.d <= LONG_T && ph < x.t + x.d) { I[k] = i; A[k++] = x; } }
      const G = this.sLong, GI = this.sLI;
      for (let j = 0; j < G.length; j++) { const x = G[j]; if (x.t <= ph && ph < x.t + x.d) { I[k] = GI[j]; A[k++] = x; } }
      this.sI = e;
    }
    this.sPh = ph; this.sCnt = k;
  }
  // (an edit: one pass over the clip — the longest short note, the long ones (sLong, sLI their indices), the order, and (review
  // R-12) sNx: where the next note of each one's pitch starts, in the song's order (sPit: the last index of each pitch so far;
  // Infinity: none) — typed arrays, grown only when the clip outgrows them)
  _sIndex(L) {
    const n = L.length, G = this.sLong, P = this.sPit;
    if (this.sNx.length < n) { const c = n + (n >> 1) + 16; this.sNx = new Float64Array(c); this.sAI = new Int32Array(c); this.sLI = new Int32Array(c); }
    const X = this.sNx, GI = this.sLI;
    let m = 0, ok = true, pt = -Infinity, g = 0;
    P.fill(-1);
    for (let i = 0; i < n; i++) {
      const x = L[i], t = x.t, j = P[x.n];
      if (x.d > LONG_T) { GI[g] = i; G[g++] = x; } else if (x.d > m) m = x.d;
      if (t < pt) ok = false;
      pt = t;
      if (j >= 0) X[j] = t;
      P[x.n] = i; X[i] = Infinity;
    }
    G.length = g;
    this.sN = L; this.sLen = n; this.sV = this.nv; this.sMax = m; this.sOk = ok; this.sPh = NaN; this.sCnt = 0;
  }
  // (review R-11 / R-12) a sounding note (index i in the clip) lights its key only while the engine plays it (engine.js
  // songEvents): started at or after the chase floor (fl), and not taken over — the next note of its pitch in the song's order
  // (by start, then pitch, stable: main's songData) not started yet (a new note of a sounding pitch owns it, its end the pitch's;
  // equal starts: the later). No read of the clip; unsorted mid-drag: the frame's scan found each pitch's last started (sOwn)
  _keyOn(x, i) { return x.t >= this.fl && (this.sOk ? this.sNx[i] > this.ph : this.sOwn[x.n] === x); }
  // the sounding notes' blocks brightened: a white wash inside the scene's rect and its edge (whole pixels: no number boxed
  // per call); (review R-13) their names drawn again over it — where, as and when the scene draws them (rows ≥ 10 px, a name
  // that fits) — in the washed block's ink (pal.lit)
  _litNotes(c, pal) {
    const A = this.sAct, h = this.rowH, W = this.W, G = this.gut, gb = this.gb, rad = h >= 8 ? 2 : 0;
    c.beginPath();
    for (let i = 0; i < this.sCnt; i++) {
      const x = A[i], y = this.n2y(x.n);
      if (y + h <= RUL || y >= gb || h < 4) continue;
      const a = Math.round(Math.max(G - 4, this.t2x(x.t))), b = Math.max(a + 2, Math.round(Math.min(W + 4, this.t2x(x.t + x.d))));
      if (b < G || a > W || b - a < 3) continue;
      rr(c, a + 1, y + 2, b - a - 2, h - 3, rad);
    }
    c.fillStyle = LIT_N; c.fill();
    if (h < 10) return;
    const cw = this.ncw, dn = this.dn, sel = this.sel;
    c.font = this.nfont; c.textBaseline = 'middle'; c.textAlign = 'left';
    for (let i = 0; i < this.sCnt; i++) {
      const x = A[i], y = this.n2y(x.n);
      if (y + h <= RUL || y >= gb) continue;
      const a = Math.round(Math.max(G - 4, this.t2x(x.t))), b = Math.max(a + 2, Math.round(Math.min(W + 4, this.t2x(x.t + x.d))));
      const nm = dn !== null && dn.has(x.n) ? dn.get(x.n) : NN[x.n];
      if (nm === undefined || Math.min(b, W) - Math.max(a, G) < nm.length * cw + 8) continue;
      c.fillStyle = pal.lit[Math.min(15, (x.v * 16 / 128) | 0)][sel.size > 0 && sel.has(x.id) ? 1 : 0];
      c.fillText(nm, Math.max(a, G) + 4, y + (h >> 1) + 1); // (whole pixels, as the scene: V8 boxes a fraction at each call)
    }
  }
  // the key strip: each lit row once (lrow stamped with this frame's lst) — the auditioned, the held, the sounding
  _litKeys(c) {
    const st = ++this.lst, H = this.hk, A = this.sAct;
    if (this.keys.size) for (const n of this.keys) this._litRow(c, this._row(n), st);
    for (let n = 0; n < 128; n++) if (H[n]) this._litRow(c, this._row(n), st);
    for (let j = 0; j < this.sCnt; j++) { const x = A[j], r = this._row(x.n); if (this.lrow[r] !== st && this._keyOn(x, this.sAI[j])) this._litRow(c, r, st); }
  }
  // a lit row: the piano's key (a black key its own width; (review R-14) a drum row named on the piano: the key left of its
  // name plate, the plate and its name kept), a drum row's plate with its name and note drawn again over it ("Other")
  _litRow(c, r, st) {
    if (this.lrow[r] === st) return;
    this.lrow[r] = st;
    const y = this.r2y(r), h = this.rowH, D = this.rows;
    if (y + h <= RUL || y >= this.gb) return;
    c.fillStyle = LIT;
    if (!D) {
      if (isBlk(127 - r)) c.fillRect(0, y, BW, h);
      else c.fillRect(0, y + 1, this.dn !== null && this.dn.has(127 - r) ? BW : this.gut - 1, h - 1);
      return;
    }
    c.fillRect(0, y + 1, this.gut - 1, h - 1);
    if (h < 8) return;
    const ty = y + (h >> 1) + 1; // (whole pixels, as the scene's names)
    c.font = this.dfont; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = BG;
    c.fillText(r ? this.dn.get(D.at[r]) : 'Other', 6, ty);
    if (r) { c.textAlign = 'right'; c.fillStyle = LIT_K; c.fillText(NUMS[D.at[r]], this.gut - 5, ty); }
  }
  _info() {
    const p = this.host.getProject(), g = this.g, hv = this.hover;
    if (!p) return null;
    const bbt = t => { try { return fmtBBT(p, Math.max(0, Math.round(t))); } catch { return ''; } };
    const len = d => { const bar = barTicks(p), beat = beatTicks(p), b = Math.floor(d / bar), r = d - b * bar, k = Math.floor(r / beat); return `${b}.${k}.${String(Math.round(r - k * beat)).padStart(3, '0')}`; };
    if (g) {
      if (g.note && (g.type === 'resizeR' || (g.type === 'create' && g.sized))) return [this._lab(g.note.n), 'L ' + len(g.note.d)];
      if (g.note && (g.type === 'move' || g.type === 'resizeL' || g.type === 'create')) return [this._lab(g.note.n), bbt(g.note.t)];
      if (g.type === 'keys') return [g.key == null ? 'Other' : this._lab(g.key), ''];
      if (g.type === 'ruler' || g.type === 'loopEdge') return ['', bbt(this.x2t(g.x))];
      return null;
    }
    if (!hv) return null;
    if (hv.hit) return [this._lab(hv.hit.note.n) + ' ' + hv.hit.note.v, bbt(hv.hit.note.t)];
    if (hv.reg === 'grid') return [this._lab(hv.n), bbt(hv.t)];
    if (hv.reg === 'keys') return [this._lab(hv.n), ''];
    if (hv.reg === 'ruler' || hv.reg === 'vel') return ['', bbt(hv.t)];
    return null;
  }
  _overlay(c) {
    const { W, H, rowH } = this, gb = this.gb, gw = this.gw, g = this.g, hv = this.hover, tr = this.host.getTrack(), GUT = this.gut;
    const pal = tr ? this._pal(tr.color) : this._pal(ACC);
    this._sound(tr);
    // grid overlays
    c.save(); c.beginPath(); c.rect(GUT, RUL, gw, gb - RUL); c.clip();
    if (this.sCnt) this._litNotes(c, pal);
    if (hv && !g && (hv.reg === 'grid' || hv.reg === 'keys')) { c.fillStyle = 'rgba(255,255,255,0.035)'; c.fillRect(GUT, this.r2y(hv.r), gw, rowH); }
    if (this.ins != null) {
      const x = Math.round(this.t2x(this.ins));
      if (x >= GUT && x <= W) { c.fillStyle = 'rgba(233,231,226,0.28)'; for (let y = RUL; y < gb; y += 6) c.fillRect(x, y, 1, 3); }
    }
    if (hv && !g && hv.reg === 'grid') {
      if (hv.hit) {
        const h = hv.hit, a = Math.round(Math.max(GUT - 4, h.x0)), w = Math.max(2, Math.round(Math.min(W + 4, h.x1)) - a);
        c.beginPath(); rr(c, a + 0.5, this.n2y(h.note.n) + 1.5, w - 1, rowH - 2, rowH >= 8 ? 2.5 : 1);
        c.lineWidth = 1; c.strokeStyle = this.tool === 'erase' ? '#ff5a45' : 'rgba(255,255,255,0.6)'; c.stroke();
        if (this.tool === 'erase') { c.fillStyle = 'rgba(226,64,47,0.25)'; c.fill(); }
      } else if (this.tool === 'draw' && tr && hv.n >= 0) {
        const s = this._snap(), t = Math.max(0, s ? snapTick(hv.t, s, 'floor') : Math.round(hv.t)), a = Math.round(this.t2x(t));
        const w = Math.max(2, Math.round(this.t2x(t + this._len())) - a);
        c.beginPath(); rr(c, a + 0.5, this.n2y(hv.n) + 1.5, w - 1, rowH - 2, rowH >= 8 ? 2.5 : 1);
        c.fillStyle = pal.ghost; c.fill(); c.strokeStyle = pal.line; c.lineWidth = 1; c.stroke();
      }
    }
    if (g && g.type === 'marquee' && g.moved) {
      const x0 = this.t2x(g.ct0), y0 = g.cy0 + RUL - this.syr, x1 = clamp(g.x, GUT, W), y1 = clamp(g.y, RUL, gb);
      const a = Math.round(Math.min(x0, x1)) + 0.5, b = Math.round(Math.min(y0, y1)) + 0.5, w = Math.round(Math.abs(x1 - x0)), h = Math.round(Math.abs(y1 - y0));
      c.fillStyle = 'rgba(242,163,58,0.08)'; c.fillRect(a, b, w, h);
      c.strokeStyle = 'rgba(242,163,58,0.8)'; c.lineWidth = 1; c.strokeRect(a, b, w, h);
    }
    const fing = g && (g.touch || g.pen);
    // touch / pen: a guide line at the edge being placed (the finger hides the note itself)
    if (fing && g.note && (g.type === 'create' || (g.moved && (g.type === 'move' || g.type === 'resizeR' || g.type === 'resizeL')))) {
      const t = g.type === 'resizeR' || (g.type === 'create' && g.sized) ? g.note.t + g.note.d : g.note.t, x = Math.round(this.t2x(t));
      if (x >= GUT && x <= W) { c.fillStyle = 'rgba(242,163,58,0.75)'; c.fillRect(x, RUL, 1, gb - RUL); }
    }
    c.restore();
    // a hold that selected (box or chord): a ring closing on the press point (no haptics on the web)
    if (g && g.lp) {
      const k = (now() - g.lp) / 280;
      if (k < 1) {
        c.beginPath(); c.arc(g.x0, g.y0, 10 + 22 * (1 - k), 0, Math.PI * 2);
        c.strokeStyle = `rgba(242,163,58,${(0.9 * (1 - k)).toFixed(3)})`; c.lineWidth = 2; c.stroke();
        this._req();
      }
    }

    // pressed / hovered keys; (R) every note sounding on the track, lit once: auditioned, held, under the playhead
    c.save(); c.beginPath(); c.rect(0, RUL, GUT - 1, gb - RUL); c.clip();
    if (hv && !g && (hv.reg === 'grid' || hv.reg === 'keys')) { // (the hovered row; (R) no closure per frame)
      const y = this.r2y(hv.r);
      c.fillStyle = 'rgba(242,163,58,0.3)';
      if (!this.rows && isBlk(this._noteAt(hv.r))) c.fillRect(0, y, BW, rowH); else c.fillRect(0, y + 1, GUT - 1, rowH - 1);
    }
    this._litKeys(c);
    c.restore();

    // velocity lane overlays
    const vt = H - VEL;
    c.save(); c.beginPath(); c.rect(GUT, vt, gw, VEL); c.clip();
    const stem = g && g.type === 'vel' ? g.note : hv && !g ? hv.stem : null;
    if (stem) {
      const x = Math.round(this.t2x(stem.t)), y = Math.round(this.v2y(stem.v));
      c.strokeStyle = ACC; c.lineWidth = 1; c.strokeRect(x - 3.5, y - 2.5, 8, 6);
    }
    if (g && g.type === 'velpaint') {
      c.strokeStyle = ACC; c.lineWidth = 1.5; c.beginPath(); c.moveTo(this.t2x(g.pt0), g.py0); c.lineTo(g.x, clamp(g.y, vt, H)); c.stroke();
    }
    c.restore();
    if (stem) { c.font = `600 12px ${FONT}`; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = TEXT; c.fillText(String(stem.v), 8, H - 16); }

    // insert point marker, playhead
    if (this.ins != null) {
      const x = Math.round(this.t2x(this.ins));
      if (x >= GUT && x <= W) { c.fillStyle = 'rgba(233,231,226,0.7)'; c.beginPath(); c.moveTo(x - 3.5, RUL - 1); c.lineTo(x + 4.5, RUL - 1); c.lineTo(x + 0.5, RUL - 6); c.closePath(); c.fill(); }
    }
    const px = Math.round(this.t2x(this.ph));
    if (px >= GUT && px <= W) {
      c.fillStyle = ACC; c.fillRect(px, RUL, 1, H - RUL);
      c.beginPath(); c.moveTo(px - 5, RUL - 10); c.lineTo(px + 6, RUL - 10); c.lineTo(px + 0.5, RUL - 1); c.closePath(); c.fill();
    }

    // readout: in the corner (mouse), or floating above the finger / pen (the corner is under the hand)
    const info = this._info();
    if (info && fing) this._float(c, g, info.filter(Boolean).join('  '));
    else if (info) {
      c.font = `9px ${FONT}`; c.textAlign = 'left'; c.textBaseline = 'middle';
      if (info[0]) { c.fillStyle = TEXT; c.fillText(info[0], 6, 8); }
      if (info[1]) { c.fillStyle = MUTE; c.fillText(info[1], 6, 18); }
    }
    if (this.focused) { c.strokeStyle = 'rgba(242,163,58,0.35)'; c.lineWidth = 1; c.strokeRect(0.5, 0.5, W - 1, H - 1); }
  }
  // the readout pill 64 px above the touch point (below it near the top), kept inside the roll
  _float(c, g, s) {
    if (!s) return;
    const fs = 12, w = Math.round(s.length * fs * 0.62) + 14, h = 22;
    const x = clamp(g.x - w / 2, this.gut + 4, Math.max(this.gut + 4, this.W - w - 4));
    let y = g.y - 64;
    if (y < RUL + 4) y = Math.min(this.H - h - 4, g.y + 40);
    c.beginPath(); rr(c, x, y, w, h, 6);
    c.fillStyle = 'rgba(12,13,15,0.9)'; c.fill(); c.strokeStyle = 'rgba(242,163,58,0.6)'; c.lineWidth = 1; c.stroke();
    c.font = `600 ${fs}px ${FONT}`; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillStyle = TEXT;
    c.fillText(s, x + 7, y + h / 2 + 0.5);
  }
}
