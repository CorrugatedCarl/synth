// master-ui.js — the master OUT and the Master row (stage M, docs/canvas/IMPL-M.md §3, §5.1, §5.3, §9 O1 / O3; lane U).
//
// createMasterOut(el, o) → the master OUT's body: a scope (wave / spectrum / IMAGE — a rotated M/S dot cloud), the loudness
//   numbers M / S / I / LRA with the short-term bar and the target tick (a menu: −9 / −14 / −16 / −23 / off), true peak L / R
//   bars with the max-hold number (red ≥ −1 dBTP; a tap resets), the correlation bar (red below 0), A/B (shows the match gain)
//   and Mono, the safety limiter. Returns { el, update(summary), clear(), setBypass(on, gainDb, lim), setMono(on), setSafe(on),
//   setLimit(gr), setLive(on), draw(t?), drawImage(L, R), setMode(m), mode(), setTarget(t), target(), state(), destroy() }.
// createMasterRow(el, o) → the Master row of the track list's footer (§5.1): "Master", a stereo peak meter, the short-term
//   LUFS number (the safety limiter's "−2.5 LIM" in its place while that acts), A/B, Mono, the open chevron. Returns { el,
//   update(summary), clear(), setBypass(on, gainDb, lim), setMono(on), setSafe(on), setLimit(gr), setActive(on), setLive(on),
//   destroy() }.
// The safety limiter (engine.js 'synth-safe', after the Volume): o.safe its state at build (absent: on); the OUT's button is its
// switch (o.onSafe(on) a tap); setSafe(on) silent; setLimit(gr) its report {t: 'safe', gr} (dB of reduction) — "limiting" with the
// reduction for LIM_MS after the last report (the OUT: "Limiting −2.5 dB", the row: "−2.5 LIM"), amber; ignored while off; clear()
// drops it.
// The A/B's match as MASTER's { t: 'ab', on, g, lim } has it: g null = pending ("A/B …": no valid match yet), a number = the
// frozen gain in dB ("A/B +2.1 dB"), lim = the boost was capped by the input's headroom ("(peak-limited)"; the row abbreviates
// to "A/B +2.1*" and spells it in its title). clear() = silence at once (the engine went off): readouts "—", bars empty.
//
// The summary is MASTER's `mmon` (§1.3, O3): { m, s, i, lra, tp: [l, r], tpMax, pk: [l, r], corr, lat } — dB / LUFS / LU as
// numbers (−Infinity for silence; NaN or junk reads as silence), corr −1…+1 or NaN (one side silent), pk the gap-free sample
// peak in dBFS, tp the true peak in dBTP, tpMax the max-hold (a number; an array reads as its larger entry), lat in frames
// (not shown). Anything missing shows "—".
//
// Budgets (G5, §5.3): one 2D canvas for the meters, repainted only when a new summary arrived and at most every METER_MS
// (30 Hz); the scope canvas at most every SCOPE_MS, and not at all while the signal stays silent; the numbers are DOM text,
// written at most every TEXT_MS (10 Hz) and only when they changed; nothing is drawn, written or read from the host while
// not live (on screen, unfolded); no shadowBlur; no layout read anywhere (every size is a constant of this file — the module
// is fixed-size —, canvases go through wk.fitCanvas: the device ratio and the canvas world's zoom, repainted at a zoom end
// through wk.onRescale). Plain ES module, no DOM at module top level, no main.js import.
// The host drives it: update() with every summary, draw() from its frame loop, setLive() when the module goes on / off screen.
// The scope's data is pulled: o.read(mode, bufs) fills bufs (td: 8192 floats of the time domain, fd: 4096 dB of the spectrum,
// L / R: 2048 floats each) for the mode shown and returns the sample rate (falsy: no source — a flat line); it is called
// only from draw(), only while live, at most every SCOPE_MS.
// Accessibility: real buttons with aria-pressed / aria-expanded / labels; every number is DOM text with a hidden full name;
// the canvases are decoration (aria-hidden); the row's bars are role=meter.
import { fitCanvas, onRescale, addTransient } from './wk.js?v=9';

/** The OUT's body size (world px; the module adds its 40 px bar): fixed, nothing is resizable. */
export const OUT_W = 420, OUT_H = 236;
export const MODES = Object.freeze(['wave', 'spectrum', 'image']);
export const TARGETS = Object.freeze([-9, -14, -16, -23, null]);
/** O1: the image mode never draws more points than this. */
export const MAX_POINTS = 2048;
/** Redraw floors (ms): the meters canvas, the scope canvas, the DOM numbers (10 Hz). */
export const METER_MS = 30, SCOPE_MS = 30, TEXT_MS = 100;
/** Scales (dB / LUFS): the short-term bar, the true-peak bars, the row's peak bars; red from TP_RED up. */
export const LU_LO = -40, LU_HI = 0, TP_LO = -48, TP_HI = 3, TP_RED = -1, PK_LO = -60;
export const RED = '#ff4a2a';
/** How fast the true-peak bars fall (dB per second); the row's peak bars fall at the same pace. */
export const TP_REL = 24;
/** How long "limiting" shows after the safety limiter's last report (ms; engine.js synth-safe reports every ≥ 0.1 s while it acts). */
export const LIM_MS = 1000;

const MINUS = '−', DASH = '—';
const GREEN = '#7cffb5', AMBER = '#f2a33a', TRACK = '#050607', TICK = 'rgba(233,231,226,0.3)', GRID = 'rgba(124,255,181,0.07)';
const fin = v => typeof v === 'number' && isFinite(v);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/* ---------------------------------------------------------------------------------------------------- pure helpers */
/** A level with d decimals and a true minus sign; "—" for silence (−Infinity), NaN, junk. −0.04 reads "0.0". */
export function fmtDb(x, d = 1) {
  if (!fin(x)) return DASH;
  const k = Math.pow(10, d), r = Math.round(Math.abs(x) * k);
  return (x < 0 && r > 0 ? MINUS : '') + (r / k).toFixed(d);
}
/** A loudness (LUFS): "—" at or under BS.1770's absolute gate (−70) — a stop posts tiny finite M / S, never −Infinity. */
export const fmtLufs = l => (fin(l) && l > -70 ? fmtDb(l) : DASH);
/** A gain in dB, signed ("+1.5", "−3.2", "0.0"); "—" when not a number. */
export function fmtGain(g) {
  if (!fin(g)) return DASH;
  const r = Math.round(Math.abs(g) * 10);
  return (g > 0 && r > 0 ? '+' : g < 0 && r > 0 ? MINUS : '') + (r / 10).toFixed(1);
}
/** The A/B button's words: the OUT's full label and the row's short one. g: null pending, a number the match, else plain. */
export const abFull = (g, lim) => (g === null ? 'A/B …' : fin(g) ? 'A/B ' + fmtGain(g) + ' dB' + (lim ? ' (peak-limited)' : '') : 'A/B');
export const abShort = (g, lim) => (g === null ? 'A/B …' : fin(g) ? 'A/B ' + fmtGain(g) + (lim ? '*' : '') : 'A/B');
const AB_TIP = 'A/B: hear the mix without the master effects, level-matched';
const abTip = (g, lim) => (g === null ? AB_TIP + ' (waiting for enough signal to match)' : fin(g) ? 'A/B ' + fmtGain(g) + ' dB' + (lim ? ' (peak-limited: the boost stops short of full scale)' : '') + ': the mix without the master effects, level-matched' : AB_TIP);
/** The safety limiter's reduction gr (dB, > 0) as the row shows it ("−2.5" — any report reads as a cut) and as the OUT spells it. */
export const limShort = gr => MINUS + (Math.round(Math.abs(gr) * 10) / 10).toFixed(1);
export const limFull = gr => 'Limiting ' + limShort(gr) + ' dB';
const SAFE_ON = 'Safety limiter: on — nothing over −1 dBFS reaches the speakers (a mix over 0 dBFS would crackle). Tap to turn it off';
const SAFE_OFF = 'Safety limiter: off — a mix over 0 dBFS clips at the output (crackles, pops). Tap to turn it on';
const limTip = gr => 'Safety limiter: limiting ' + fmtDb(gr) + ' dB — the mix is too loud; pull some faders down';
const safeTip = (on, gr) => (!on ? SAFE_OFF : fin(gr) ? limTip(gr) + '. Tap to turn it off' : SAFE_ON);
// the limiter's state as the buttons show it: on, the last report (gr) and until when it shows; limiting(T) — on and within the hold
function limState(on) {
  const L = { on: on !== false, gr: NaN, until: -Infinity };
  L.at = T => (L.on && T < L.until ? L.gr : NaN);
  L.set = (gr, T) => { if (!L.on || typeof gr !== 'number' || !(gr > 0) || !isFinite(gr)) return false; L.gr = gr; L.until = T + LIM_MS; return true; };
  return L;
}
/** The setBypass arguments as state: undefined keeps; null pending; a number the match (lim only with one); anything else plain. */
const abGain = g => (g === null ? null : fin(g) ? g : NaN);
/** The correlation, signed with two decimals ("+0.82", "−1.00"); "—" for NaN (a side is silent). */
export function fmtCorr(c) {
  if (!fin(c)) return DASH;
  const r = Math.round(Math.abs(clamp(c, -1, 1)) * 100);
  return (c > 0 && r > 0 ? '+' : c < 0 && r > 0 ? MINUS : '') + (r / 100).toFixed(2);
}
const frac = (v, lo, hi) => (v > lo ? (v < hi ? (v - lo) / (hi - lo) : 1) : 0); // NaN, −Infinity, below lo → 0
/** 0…1 along the short-term bar (LU_LO…LU_HI); the target tick sits at lufsFrac(target). */
export const lufsFrac = l => frac(l, LU_LO, LU_HI);
/** 0…1 along a true-peak bar (TP_LO…TP_HI). */
export const tpFrac = db => frac(db, TP_LO, TP_HI);
/** 0…1 along the row's peak bar (PK_LO…0 dBFS). */
export const pkFrac = db => frac(db, PK_LO, 0);
/** The true-peak number goes red from −1 dBTP up. */
export const isOver = db => fin(db) && db >= TP_RED;
/** The true-peak bar's zones, [lo, hi) in dBTP and their colours; the last is the red one (≥ −1). */
export const TP_ZONES = Object.freeze([[TP_LO, -18, '#3fae5a'], [-18, -6, '#9bd16a'], [-6, TP_RED, '#f5d22e'], [TP_RED, TP_HI, RED]]);
/** The coloured segments a true peak of db fills, from the bar's left: [{ lo, hi, color }] (clipped at db). */
export function zonesFor(db) {
  const out = [];
  if (!(db > TP_LO)) return out;
  for (const [lo, hi, color] of TP_ZONES) { if (db <= lo) break; out.push({ lo, hi: Math.min(hi, db, TP_HI), color }); }
  return out;
}
/** The correlation bar's fill: { from, to, bad } in −1…+1 (the bar runs from the centre; red = below 0), or null for NaN. */
export function corrBar(c) {
  if (!fin(c)) return null;
  c = clamp(c, -1, 1);
  return c >= 0 ? { from: 0, to: c, bad: false } : { from: c, to: 0, bad: true };
}
const R2 = Math.SQRT2;
/** One sample pair as the image scope's unit coordinates: x = Side to the right (R − L)/√2, y = Mid up (L + R)/√2 — a mono
 * signal is a vertical line, an anti-phase one a horizontal line, L alone leans up-left, R alone up-right. */
export function imageXY(l, r) { return [(r - l) / R2, (l + r) / R2]; }
const lvl = v => (typeof v === 'number' && v === v ? v : -Infinity); // NaN / junk → silence
const pair = v => (Array.isArray(v) ? [lvl(v[0]), lvl(v[1])] : typeof v === 'number' ? [lvl(v), lvl(v)] : [-Infinity, -Infinity]);
const top = v => (Array.isArray(v) ? Math.max(lvl(v[0]), lvl(v[1])) : lvl(v));
/** The summary as numbers only (see the header): never throws, whatever it is given. */
export function norm(s) {
  const a = s && typeof s === 'object' ? s : {};
  return { m: lvl(a.m), s: lvl(a.s), i: lvl(a.i), lra: lvl(a.lra), tp: pair(a.tp), tpMax: top(a.tpMax), pk: pair(a.pk), corr: fin(a.corr) ? clamp(a.corr, -1, 1) : NaN };
}

/* ---------------------------------------------------------------------------------------------------- DOM kit */
const mk = (d, tag, cls, txt) => { const e = d.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const at = (e, x, y, w, h) => { const s = e.style; s.left = x + 'px'; s.top = y + 'px'; if (w != null) s.width = w + 'px'; if (h != null) s.height = h + 'px'; return e; };
const button = (d, cls, txt, label) => { const b = mk(d, 'button', cls, txt); b.type = 'button'; if (label) b.setAttribute('aria-label', label); return b; };
const attr = (e, k, v) => { v = String(v); if (e.getAttribute(k) !== v) e.setAttribute(k, v); };
const flag = (e, c, on) => { if (e.classList.contains(c) !== !!on) e.classList.toggle(c, !!on); };
const listen = (t, type, fn, opt) => { t.addEventListener(type, fn, opt); return () => t.removeEventListener(type, fn, opt); };
const defaultNow = () => (globalThis.performance && typeof performance.now === 'function' ? performance.now() : Date.now());
const safe = (f, ...a) => { if (typeof f !== 'function') return; try { f(...a); } catch (err) { console.error(err); } };
// a control: a tap (click) and nothing else — the press itself bubbles on (the world pans only from a background target, BG_SEL; the
// kit's popups close on any press)
const control = (b, fn, offs) => { offs.push(listen(b, 'click', fn)); };
/** A readout: a hidden full name, the letter (none: ''), the value, the unit — { el, v: the value element }. */
function readout(d, tag, name, letter, unit, cls) {
  const e = mk(d, tag, 'mo-n' + (cls ? ' ' + cls : '')), v = mk(d, 'span', 'mo-nv', DASH);
  if (tag === 'button') e.type = 'button';
  e.append(mk(d, 'span', 'cv-sr', name));
  if (letter) { const l = mk(d, 'span', 'mo-nl', letter); l.setAttribute('aria-hidden', 'true'); e.append(l); }
  e.append(v);
  if (unit) { const u = mk(d, 'span', 'mo-nu', unit); u.setAttribute('aria-hidden', 'true'); e.append(u); }
  return { el: e, v };
}
const targetText = t => (t === null ? 'off' : fmtDb(t, t % 1 ? 1 : 0) + ' LUFS');

/* ---------------------------------------------------------------------------------------------------- the OUT */
// the geometry (body px): the scope, the correlation row, the right column's bars; the DOM is placed by the same numbers
const G = Object.freeze({ modes: [10, 8, 256, 24], scope: [10, 36, 256, 134], corr: [44, 178, 178, 12], sbar: [276, 88, 134, 10], tpL: [292, 166, 118, 10], tpR: [292, 180, 118, 10] });
const SW = G.scope[2], SH = G.scope[3];
/** The scope's size (body px). */
export const SCOPE_W = SW, SCOPE_H = SH;

export function createMasterOut(host, o) {
  const O = o && typeof o === 'object' ? o : {};
  const d = O.doc || (host && host.ownerDocument) || globalThis.document;
  const now = typeof O.now === 'function' ? O.now : defaultNow;
  const reader = typeof O.read === 'function' ? O.read : null;
  const offs = [];
  let dead = false, live = false, bypass = false, gain = NaN, limited = false, mono = false, menuOpen = false;
  let mode = MODES.includes(O.mode) ? O.mode : 'wave';
  let target = O.target === null ? null : fin(O.target) ? O.target : -14;
  let cur = norm(null), accTp = [-Infinity, -Infinity], tpLv = [TP_LO, TP_LO], lastTp = -Infinity;
  let dirty = true, textDirty = true, scopeDirty = true, lastMeter = -Infinity, lastText = -Infinity, lastScope = -Infinity, lastState = '';
  let bufs = null, binSr = 0, bins = null, warned = false;
  const sig = {}; // the last text written per readout (no read-back of the DOM)

  /* ---- DOM */
  const root = mk(d, 'div', 'cv-mout cv-out');
  root.setAttribute('role', 'group'); root.setAttribute('aria-label', 'Master output: scope, loudness and peak meters');
  root.style.width = OUT_W + 'px'; root.style.height = OUT_H + 'px';
  const mt = mk(d, 'canvas', 'mo-mt'); mt.setAttribute('aria-hidden', 'true'); mt.style.width = OUT_W + 'px'; mt.style.height = OUT_H + 'px';
  const box = at(mk(d, 'div', 'scope mo-scope'), G.scope[0], G.scope[1], SW, SH);
  const sc = mk(d, 'canvas', 'mo-sc'); sc.setAttribute('aria-hidden', 'true'); sc.style.width = SW + 'px'; sc.style.height = SH + 'px';
  const modes = at(mk(d, 'div', 'mo-modes'), G.modes[0], G.modes[1], G.modes[2], G.modes[3]); modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', 'Scope view');
  const modeBtn = {};
  for (const m of MODES) {
    const b = button(d, 'mo-mode', m === 'wave' ? 'Wave' : m === 'spectrum' ? 'Spectrum' : 'Image');
    b.setAttribute('data-mode', m);
    b.title = m === 'wave' ? 'Waveform' : m === 'spectrum' ? 'Spectrum' : 'Stereo image: left against right, rotated to Mid / Side';
    modeBtn[m] = b; modes.append(b);
    control(b, () => { if (setMode(m)) safe(O.onMode, m); }, offs);
  }
  box.append(sc);
  const corrLab = at(mk(d, 'span', 'mo-lab', 'CORR'), 10, 176, 34, 16); corrLab.title = 'Phase correlation: +1 in phase, 0 unrelated, below 0 out of phase';
  const corr = readout(d, 'span', 'Phase correlation', '', '', 'mo-corr'); at(corr.el, 224, 176, 42, 16);
  const rm = readout(d, 'div', 'Momentary loudness', 'M', 'LUFS'), rs = readout(d, 'div', 'Short-term loudness', 'S', 'LUFS');
  const ri = readout(d, 'button', 'Integrated loudness (tap to reset)', 'I', 'LUFS', 'mo-reset'), rl = readout(d, 'div', 'Loudness range', 'LRA', 'LU');
  at(rm.el, 276, 10, 66, 34); at(rs.el, 344, 10, 66, 34); at(ri.el, 276, 46, 66, 34); at(rl.el, 344, 46, 66, 34);
  ri.el.title = 'Tap to reset the integrated loudness, the range and the peak hold';
  rl.el.title = 'Loudness range (EBU Tech 3342), since the last reset';
  const tgBtn = at(button(d, 'mo-btn mo-target', ''), 276, 106, 134, 24);
  tgBtn.setAttribute('aria-haspopup', 'menu'); tgBtn.setAttribute('aria-expanded', 'false'); tgBtn.title = 'The loudness target: where the tick sits on the short-term bar';
  const tpLab = at(mk(d, 'span', 'mo-lab', 'TP'), 276, 139, 18, 16);
  const hold = readout(d, 'button', 'True peak max hold (tap to reset)', 'MAX', 'dBTP', 'mo-hold'); at(hold.el, 296, 136, 114, 22);
  hold.el.title = 'True-peak max hold, red from −1 dBTP. Tap to reset';
  const labL = at(mk(d, 'span', 'mo-lab', 'L'), 276, 164, 14, 14), labR = at(mk(d, 'span', 'mo-lab', 'R'), 276, 178, 14, 14);
  labL.setAttribute('aria-hidden', 'true'); labR.setAttribute('aria-hidden', 'true'); tpLab.title = 'True peak, left and right';
  const abBtn = at(button(d, 'mo-btn mo-ab', 'A/B'), 10, 198, 200, 28), monoBtn = at(button(d, 'mo-btn mo-mono', 'Mono'), 218, 198, 70, 28); // (A/B: room for "A/B +2.1 dB (peak-limited)")
  abBtn.setAttribute('aria-pressed', 'false'); monoBtn.setAttribute('aria-pressed', 'false');
  monoBtn.title = 'Mono check: both ears hear the sum of left and right';
  const safeBtn = at(button(d, 'mo-btn mo-safe', 'Safety limiter'), 296, 198, 114, 28), LS = limState(O.safe); // (the safety limiter: after the Volume, before the speakers)
  const menu = at(mk(d, 'div', 'mo-menu'), 276, 34, 134, 150);
  menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Loudness target'); menu.hidden = true;
  const items = TARGETS.map(t => {
    const b = button(d, 'mo-mi', t === null ? 'Off' : fmtDb(t, 0) + ' LUFS');
    b.setAttribute('role', 'menuitemradio'); b.setAttribute('aria-checked', 'false'); b._t = t;
    menu.append(b); return b;
  });
  root.append(mt, modes, box, corrLab, corr.el, rm.el, rs.el, ri.el, rl.el, tgBtn, tpLab, hold.el, labL, labR, abBtn, monoBtn, safeBtn, menu);
  const hostEl = host && typeof host.appendChild === 'function' ? host : null;
  if (hostEl) hostEl.appendChild(root);

  /* ---- state the buttons show */
  const sync = () => {
    for (const m of MODES) { attr(modeBtn[m], 'aria-pressed', m === mode); flag(modeBtn[m], 'on', m === mode); }
    attr(abBtn, 'aria-pressed', bypass); flag(abBtn, 'on', bypass);
    const ab = bypass ? abFull(gain, limited) : 'A/B';
    if (sig.ab !== ab) { sig.ab = ab; abBtn.textContent = ab; }
    const tip = (bypass ? abTip(gain, limited) : AB_TIP) + '. Tap again to come back';
    if (sig.abt !== tip) { sig.abt = tip; abBtn.title = tip; }
    attr(monoBtn, 'aria-pressed', mono); flag(monoBtn, 'on', mono);
    const tt = 'Target ' + targetText(target);
    if (sig.tg !== tt) { sig.tg = tt; tgBtn.textContent = tt; }
    for (const b of items) { const on = b._t === target; attr(b, 'aria-checked', on); flag(b, 'on', on); }
    syncSafe(live ? now() : -Infinity);
  };
  // the safety limiter's button: on / off, and "Limiting −2.5 dB" (amber) while a report is within its hold — written live only
  const syncSafe = T => {
    const g = LS.at(T), txt = fin(g) ? limFull(g) : 'Safety limiter', tip = safeTip(LS.on, g);
    attr(safeBtn, 'aria-pressed', LS.on); flag(safeBtn, 'act', fin(g));
    if (sig.sf !== txt) { sig.sf = txt; safeBtn.textContent = txt; }
    if (sig.sft !== tip) { sig.sft = tip; safeBtn.title = tip; }
  };
  sync();

  /* ---- the target menu */
  const closeMenu = refocus => {
    if (!menuOpen) return;
    menuOpen = false; menu.hidden = true; attr(tgBtn, 'aria-expanded', false);
    d.removeEventListener('pointerdown', onOutside, true); d.removeEventListener('keydown', onKey, true);
    if (refocus) tgBtn.focus();
  };
  const onOutside = e => { const t = e && e.target; if (!t || (!menu.contains(t) && !tgBtn.contains(t))) closeMenu(false); };
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault && e.preventDefault(); e.stopPropagation && e.stopPropagation(); closeMenu(true); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const i = items.indexOf(d.activeElement), n = items.length;
    items[((i < 0 ? (e.key === 'ArrowDown' ? -1 : 0) : i) + (e.key === 'ArrowDown' ? 1 : n - 1)) % n].focus();
    e.preventDefault && e.preventDefault();
  };
  const openMenu = () => {
    if (menuOpen) return;
    menuOpen = true; menu.hidden = false; attr(tgBtn, 'aria-expanded', true);
    d.addEventListener('pointerdown', onOutside, true); d.addEventListener('keydown', onKey, true);
    (items.find(b => b._t === target) || items[0]).focus();
  };
  control(tgBtn, () => (menuOpen ? closeMenu(false) : openMenu()), offs);
  for (const b of items) control(b, () => { const was = target; setTarget(b._t); closeMenu(true); if (target !== was) safe(O.onTarget, target); }, offs);
  offs.push(addTransient(() => closeMenu(false))); // (a camera move closes it, as the kit's popups)

  /* ---- the controls */
  control(abBtn, () => { bypass = !bypass; if (!bypass) { gain = NaN; limited = false; } sync(); safe(O.onBypass, bypass); }, offs);
  control(monoBtn, () => { mono = !mono; sync(); safe(O.onMono, mono); }, offs);
  control(safeBtn, () => { LS.on = !LS.on; sync(); safe(O.onSafe, LS.on); }, offs);
  const reset = () => {
    cur.i = cur.tpMax = cur.lra = -Infinity;
    dirty = textDirty = true; lastText = -Infinity;
    safe(O.onReset);
  };
  control(hold.el, reset, offs); control(ri.el, reset, offs);

  /* ---- painting */
  const paintMeters = T => {
    const dt = isFinite(lastTp) ? clamp((T - lastTp) / 1000, 0, 1) : 1e3; // (a peak falls TP_REL dB/s)
    lastTp = T;
    for (let c = 0; c < 2; c++) tpLv[c] = Math.max(accTp[c], tpLv[c] - TP_REL * dt, TP_LO);
    accTp = [-Infinity, -Infinity];
    const g = fitCanvas(mt, OUT_W, OUT_H);
    if (!g) return;
    g.clearRect(0, 0, OUT_W, OUT_H);
    // short-term loudness: the bar (amber when it passes the target by more than 1 LU), the target tick, a scale
    let [x, y, w, h] = G.sbar;
    g.fillStyle = TRACK; g.fillRect(x, y, w, h);
    const f = lufsFrac(cur.s);
    if (f > 0) { g.fillStyle = target !== null && cur.s > target + 1 ? AMBER : GREEN; g.fillRect(x, y, w * f, h); }
    g.fillStyle = TICK;
    for (const l of [-30, -20, -10]) g.fillRect(Math.round(x + w * lufsFrac(l)), y + h, 1, 3);
    if (target !== null) { g.fillStyle = AMBER; g.fillRect(Math.round(x + w * lufsFrac(target)) - 1, y - 3, 2, h + 6); }
    // true peak L / R: zoned fills, the −1 dBTP line
    for (const [r, db] of [[G.tpL, tpLv[0]], [G.tpR, tpLv[1]]]) {
      [x, y, w, h] = r;
      g.fillStyle = TRACK; g.fillRect(x, y, w, h);
      for (const z of zonesFor(db)) { const x0 = x + w * tpFrac(z.lo), x1 = x + w * tpFrac(z.hi); g.fillStyle = z.color; g.fillRect(x0, y, x1 - x0, h); }
      g.fillStyle = TICK; g.fillRect(Math.round(x + w * tpFrac(TP_RED)), y - 2, 1, h + 4);
    }
    // correlation: from the centre, red below 0
    [x, y, w, h] = G.corr;
    g.fillStyle = TRACK; g.fillRect(x, y, w, h);
    const b = corrBar(cur.corr);
    if (b) { g.fillStyle = b.bad ? RED : GREEN; const x0 = x + w * (b.from + 1) / 2, x1 = x + w * (b.to + 1) / 2; g.fillRect(x0, y, Math.max(1, x1 - x0), h); }
    g.fillStyle = TICK; g.fillRect(Math.round(x + w / 2), y - 2, 1, h + 4);
  };
  const writeText = () => {
    const t = (k, el, s) => { if (sig[k] !== s) { sig[k] = s; el.textContent = s; } };
    t('m', rm.v, fmtLufs(cur.m)); t('s', rs.v, fmtLufs(cur.s)); t('i', ri.v, fmtLufs(cur.i)); t('l', rl.v, cur.lra === 0 && !(cur.i > -Infinity) ? DASH : fmtDb(cur.lra)); // (nothing integrated: the 0 posted at boot / after a reset is no measurement)
    t('h', hold.v, fmtDb(cur.tpMax)); t('c', corr.v, fmtCorr(cur.corr));
    flag(hold.el, 'mo-over', isOver(cur.tpMax)); flag(corr.el, 'mo-bad', corrBar(cur.corr) !== null && cur.corr < 0);
  };
  const grid = (g, mid) => {
    g.fillStyle = '#07090a'; g.fillRect(0, 0, SW, SH);
    g.strokeStyle = GRID; g.lineWidth = 1;
    if (mid) {
      const cx = SW / 2, cy = SH / 2, rb = Math.min(SW, SH) / 2 - 8;
      g.beginPath(); g.moveTo(cx + 0.5, 0); g.lineTo(cx + 0.5, SH); g.moveTo(0, cy + 0.5); g.lineTo(SW, cy + 0.5);
      g.moveTo(cx - rb, cy + rb); g.lineTo(cx + rb, cy - rb); g.moveTo(cx - rb, cy - rb); g.lineTo(cx + rb, cy + rb); g.stroke();
      g.beginPath(); g.arc(cx, cy, rb, 0, Math.PI * 2); g.stroke();
      g.fillStyle = 'rgba(124,255,181,0.45)'; g.font = '10px JetBrains Mono, monospace';
      g.fillText('L', cx - rb * 0.75 - 10, cy - rb * 0.75 - 2); g.fillText('R', cx + rb * 0.75 + 4, cy - rb * 0.75 - 2); g.fillText('M', cx + 4, cy - rb - 2); g.fillText('S', cx + rb + 4, cy - 4);
      return;
    }
    g.beginPath();
    for (let i = 1; i < 10; i++) { const x = Math.round(SW * i / 10) + 0.5; g.moveTo(x, 0); g.lineTo(x, SH); }
    for (let i = 1; i < 6; i++) { const y = Math.round(SH * i / 6) + 0.5; g.moveTo(0, y); g.lineTo(SW, y); }
    g.stroke();
  };
  const idleLine = g => { g.strokeStyle = GREEN; g.lineWidth = 1.6; g.beginPath(); g.moveTo(0, SH / 2); g.lineTo(SW, SH / 2); g.stroke(); };
  const paintImage = (g, L, R, n) => {
    grid(g, true);
    const cx = SW / 2, cy = SH / 2, k = (Math.min(SW, SH) / 2 - 8) / R2;
    g.fillStyle = 'rgba(124,255,181,0.38)';
    for (let i = 0; i < n; i++) {
      const l = L[i], r = R[i];
      if (!(l === l && r === r)) continue; // (NaN)
      g.fillRect(cx + (r - l) / R2 * k - 0.65, cy - (l + r) / R2 * k - 0.65, 1.3, 1.3);
    }
  };
  const paintWave = (g, td, sr) => {
    grid(g, false);
    g.strokeStyle = GREEN; g.lineWidth = 1.6; g.beginPath();
    const span = Math.max(2, Math.min(2048, Math.round(sr * 0.025)));
    let t0 = 0;
    for (let i = 1; i < 4096; i++) if (td[i - 1] <= 0 && td[i] > 0) { t0 = i; break; }
    for (let i = 0; i < span; i++) { const x = i / (span - 1) * SW, y = SH / 2 - td[t0 + i] * SH * 0.45; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  };
  const paintSpectrum = (g, fd, sr) => {
    grid(g, false);
    const ny = sr / 2, n = fd.length, lo = Math.log(20), hi = Math.log(Math.min(ny, 24000));
    if (binSr !== sr || !bins) { // (the pixel → bin table, once per rate)
      binSr = sr; bins = new Uint16Array(SW + 1);
      for (let px = 0; px <= SW; px++) bins[px] = Math.min(n - 1, Math.round(Math.exp(lo + (hi - lo) * px / SW) / ny * n));
    }
    g.strokeStyle = GREEN; g.lineWidth = 1.6; g.beginPath();
    for (let px = 0; px <= SW; px++) { const db = Math.max(-130, fd[bins[px]]), y = SH * (-db / 130); px ? g.lineTo(px, y) : g.moveTo(px, y); }
    g.stroke();
    g.fillStyle = 'rgba(124,255,181,0.45)'; g.font = '10px JetBrains Mono, monospace';
    for (const f of [100, 1000, 10000]) g.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), (Math.log(f) - lo) / (hi - lo) * SW + 3, SH - 6);
    for (const db of [-30, -60, -90, -120]) g.fillText(db + ' dB', 6, SH * (-db / 130) - 3);
  };
  const loud = (a, n, lim) => { for (let i = 0; i < n; i++) if (a[i] > lim || a[i] < -lim) return true; return false; };
  const above = (a, n, lim) => { for (let i = 0; i < n; i++) if (a[i] > lim) return true; return false; };
  // one scope frame: pull the host's data for the mode shown, paint — unless nothing would change (silence stays silence)
  const scopeFrame = () => {
    let sr = 0;
    if (reader) {
      if (!bufs) bufs = { td: new Float32Array(8192), fd: new Float32Array(4096), L: new Float32Array(MAX_POINTS), R: new Float32Array(MAX_POINTS) };
      try { sr = +reader(mode, bufs) || 0; } catch (err) { sr = 0; if (!warned) { warned = true; console.error(err); } }
    }
    const sound = () => (mode === 'wave' ? loud(bufs.td, 8192, 1e-9) : mode === 'spectrum' ? above(bufs.fd, 4096, -129) : loud(bufs.L, MAX_POINTS, 1e-9) || loud(bufs.R, MAX_POINTS, 1e-9));
    const state = !(sr > 0) ? 'idle' : sound() ? 'live' : 'quiet';
    if (!scopeDirty && sc.width > 0 && state !== 'live' && state === lastState) return false; // (a store released at 0 × 0 — wk.releaseCanvases — is painted again)
    lastState = state; scopeDirty = false;
    const g = fitCanvas(sc, SW, SH);
    if (!g) return false;
    if (state === 'idle') { grid(g, mode === 'image'); if (mode !== 'image') idleLine(g); return true; }
    if (mode === 'wave') paintWave(g, bufs.td, sr); else if (mode === 'spectrum') paintSpectrum(g, bufs.fd, sr);
    else paintImage(g, bufs.L, bufs.R, MAX_POINTS);
    return true;
  };

  /* ---- the API */
  function setMode(m) {
    if (dead || !MODES.includes(m) || m === mode) return false;
    mode = m; scopeDirty = true; sync(); return true;
  }
  function setTarget(t) {
    if (dead) return;
    const v = t === null ? null : fin(t) ? t : target;
    if (v === target) return;
    target = v; dirty = true; sync();
  }
  function update(s) {
    if (dead) return;
    const n = norm(s);
    // the held peaks of the interval: a peak between two paints is not lost
    cur = n; accTp = [Math.max(accTp[0], n.tp[0]), Math.max(accTp[1], n.tp[1])];
    dirty = textDirty = true;
  }
  // silence at once (the engine went off): every readout "—", the bars empty without waiting for their fall; the controls stay
  function clear() {
    if (dead) return;
    cur = norm(null); accTp = [-Infinity, -Infinity]; tpLv = [TP_LO, TP_LO]; lastTp = -Infinity;
    dirty = textDirty = true; lastMeter = lastText = -Infinity;
    LS.until = -Infinity; syncSafe(-Infinity);
  }
  function setLive(on) {
    if (dead) return;
    on = !!on;
    if (on === live) return;
    live = on;
    if (on) { dirty = textDirty = scopeDirty = true; lastMeter = lastText = lastScope = -Infinity; } else closeMenu(false);
  }
  function draw(t) {
    if (dead || !live) return false;
    const T = typeof t === 'number' ? t : now();
    let did = false;
    syncSafe(T); // (the limiter's hold runs out on a frame)
    if ((dirty || !(mt.width > 0)) && T - lastMeter >= METER_MS) { dirty = false; lastMeter = T; paintMeters(T); did = true; }
    if ((scopeDirty || reader || !(sc.width > 0)) && T - lastScope >= SCOPE_MS) { lastScope = T; if (scopeFrame()) did = true; }
    if (textDirty && T - lastText >= TEXT_MS) { textDirty = false; lastText = T; writeText(); }
    return did;
  }
  // the image scope on its own: L / R as the host has them (≤ MAX_POINTS points are drawn), now, whatever the throttle
  function drawImage(L, R) {
    if (dead || !live || !L || !R) return false;
    const g = fitCanvas(sc, SW, SH);
    if (!g) return false;
    paintImage(g, L, R, Math.min(MAX_POINTS, L.length | 0, R.length | 0));
    return true;
  }
  offs.push(onRescale(mt, () => { dirty = scopeDirty = true; lastMeter = lastScope = -Infinity; if (live) draw(); })); // (a zoom end: both canvases at the new density)

  return {
    el: root,
    update, clear,
    setBypass(on, gainDb, lim) {
      if (dead) return;
      bypass = !!on;
      if (!bypass) { gain = NaN; limited = false; } else if (gainDb !== undefined) { gain = abGain(gainDb); limited = !!lim && fin(gain); }
      sync();
    },
    setMono(on) { if (dead) return; mono = !!on; sync(); },
    // the safety limiter: on / off as the host has it (silent); setLimit(gr) — its report, dB of reduction (ignored while off)
    setSafe(on) { if (dead) return; LS.on = !!on; sync(); },
    setLimit(gr) { if (dead) return; const T = now(); if (LS.set(gr, T) && live) syncSafe(T); },
    setLive, draw, drawImage, setMode, setTarget,
    mode: () => mode,
    target: () => target,
    state: () => { const g = LS.at(now()); return { live, bypass, gain, limited, mono, mode, target, menu: menuOpen, safe: LS.on, limiting: fin(g), gr: g }; },
    destroy() {
      if (dead) return;
      closeMenu(false); dead = true; live = false;
      for (const f of offs.splice(0)) { try { f(); } catch (err) { console.error(err); } }
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}

/* ---------------------------------------------------------------------------------------------------- the row */
const BAR_MS = 30, OVER_MS = 800;
const chevron = d => {
  const s = d.createElementNS('http://www.w3.org/2000/svg', 'svg'), p = d.createElementNS('http://www.w3.org/2000/svg', 'path');
  s.setAttribute('viewBox', '0 0 10 10'); s.setAttribute('aria-hidden', 'true'); p.setAttribute('d', 'M3.5 1.5 L7 5 L3.5 8.5');
  s.appendChild(p); return s;
};

export function createMasterRow(host, o) {
  const O = o && typeof o === 'object' ? o : {};
  const d = O.doc || (host && host.ownerDocument) || globalThis.document;
  const now = typeof O.now === 'function' ? O.now : defaultNow;
  const offs = [];
  let dead = false, live = O.live !== false, bypass = false, gain = NaN, limited = false, mono = false, active = false;
  let cur = norm(null), accPk = [-Infinity, -Infinity], accTp = -Infinity, lv = [PK_LO, PK_LO], overUntil = 0, lastBar = -Infinity, lastText = -Infinity, textDirty = true;
  const sig = {};

  const root = mk(d, 'div', 'cv-mastrow');
  root.setAttribute('role', 'group'); root.setAttribute('aria-label', 'Master');
  const name = button(d, 'mr-name', 'Master', 'Open the master canvas'); name.title = 'Open the master canvas: the effects on the whole mix';
  const meter = mk(d, 'div', 'mr-meter'), bars = [], covers = [];
  for (const side of ['Left', 'Right']) {
    const b = mk(d, 'div', 'mr-bar'), c = mk(d, 'i');
    b.setAttribute('role', 'meter'); b.setAttribute('aria-label', 'Master ' + side.toLowerCase() + ' peak level');
    b.setAttribute('aria-valuemin', String(PK_LO)); b.setAttribute('aria-valuemax', '0'); b.setAttribute('aria-valuenow', String(PK_LO)); b.setAttribute('aria-valuetext', 'silent');
    b.appendChild(c); meter.appendChild(b); bars.push(b); covers.push(c);
  }
  const lufs = mk(d, 'span', 'mr-lufs'), lval = mk(d, 'span', 'mr-lv', DASH), lunit = mk(d, 'span', 'mr-lu', 'LUFS');
  lunit.setAttribute('aria-hidden', 'true'); lufs.title = 'Short-term loudness (3 s)';
  lufs.append(mk(d, 'span', 'cv-sr', 'Short-term loudness'), lval, lunit);
  // the safety limiter's indicator (no switch here: its switch is on the OUT — the row has no room for a fourth button at 44 px
  // touch targets): "−2.5 LIM" in the LUFS number's place while it acts, so the row's width never changes
  const lim = mk(d, 'span', 'mr-lim'), limv = mk(d, 'span', 'mr-limv'), limu = mk(d, 'span', 'mr-limu', 'LIM'), LS = limState(O.safe);
  limu.setAttribute('aria-hidden', 'true'); lim.hidden = true;
  lim.append(mk(d, 'span', 'cv-sr', 'Safety limiter, limiting'), limv, limu);
  const ab = button(d, 'mr-btn mr-ab', 'A/B'), mo = button(d, 'mr-btn mr-mono', 'Mono'), open = button(d, 'mr-open', '', 'Open the master canvas');
  ab.setAttribute('aria-pressed', 'false'); mo.setAttribute('aria-pressed', 'false'); open.setAttribute('aria-expanded', 'false'); open.appendChild(chevron(d));
  ab.title = AB_TIP; mo.title = 'Mono check: both ears hear the sum of left and right';
  root.append(name, meter, lufs, lim, ab, mo, open);
  if (host && typeof host.appendChild === 'function') host.appendChild(root);

  const doOpen = () => safe(O.open);
  control(name, doOpen, offs); control(open, doOpen, offs);
  control(ab, () => { bypass = !bypass; if (!bypass) { gain = NaN; limited = false; } sync(); safe(O.onBypass, bypass); }, offs);
  control(mo, () => { mono = !mono; sync(); safe(O.onMono, mono); }, offs);
  // the indicator: shown (the LUFS number hidden: the row .limiting) while a report is within its hold — written only while live
  const syncSafe = T => {
    const g = LS.at(T), on = fin(g);
    if (lim.hidden === on) lim.hidden = !on;
    flag(root, 'limiting', on);
    if (!on) return;
    const v = limShort(g), tip = limTip(g) + ' (its switch: on the master canvas)';
    if (sig.lm !== v) { sig.lm = v; limv.textContent = v; }
    if (sig.lmt !== tip) { sig.lmt = tip; lim.title = tip; }
  };
  const sync = () => {
    attr(ab, 'aria-pressed', bypass); flag(ab, 'on', bypass); attr(mo, 'aria-pressed', mono); flag(mo, 'on', mono);
    const txt = bypass ? abShort(gain, limited) : 'A/B', tip = bypass ? abTip(gain, limited) : AB_TIP;
    if (sig.ab !== txt) { sig.ab = txt; ab.textContent = txt; }
    if (sig.abt !== tip) { sig.abt = tip; ab.title = tip; }
    const lab = bypass && gain === null ? 'A/B, waiting for enough signal to match' : bypass && fin(gain) ? abFull(gain, limited).replace(' (peak-limited)', ', peak-limited') : null;
    if (sig.abl !== lab) { sig.abl = lab; if (lab === null) ab.removeAttribute('aria-label'); else ab.setAttribute('aria-label', lab); }
    flag(root, 'on', active); attr(open, 'aria-expanded', active);
    if (active) name.setAttribute('aria-current', 'true'); else name.removeAttribute('aria-current');
    syncSafe(live ? now() : -Infinity);
  };
  syncSafe(-Infinity);
  const renderBars = T => {
    const dt = clamp((T - lastBar) / 1000, 0, 1) || 0, rel = isFinite(lastBar) ? TP_REL * dt : 1e3;
    for (let c = 0; c < 2; c++) {
      lv[c] = clamp(Math.max(accPk[c], lv[c] - rel), PK_LO, 6);
      const q = Math.round(pkFrac(lv[c]) * 100), s = 'translateX(' + q + '%)';
      if (sig['q' + c] !== s) { sig['q' + c] = s; covers[c].style.transform = s; }
    }
    if (isOver(accTp)) overUntil = T + OVER_MS;
    for (const b of bars) flag(b, 'over', T < overUntil);
    accPk = [-Infinity, -Infinity]; accTp = -Infinity; lastBar = T;
  };
  const renderText = () => {
    const s = fmtLufs(cur.s);
    if (sig.s !== s) { sig.s = s; lval.textContent = s; }
    for (let c = 0; c < 2; c++) { attr(bars[c], 'aria-valuenow', Math.round(lv[c])); attr(bars[c], 'aria-valuetext', lv[c] <= PK_LO ? 'silent' : fmtDb(lv[c]) + ' dB'); }
  };
  const run = () => {
    const T = now();
    if (T - lastBar >= BAR_MS) renderBars(T);
    if (textDirty && T - lastText >= TEXT_MS) { textDirty = false; lastText = T; renderText(); }
    syncSafe(T); // (the limiter's hold runs out on a refresh)
  };

  return {
    el: root,
    update(s) {
      if (dead) return;
      const n = norm(s);
      cur = n; accPk = [Math.max(accPk[0], n.pk[0]), Math.max(accPk[1], n.pk[1])]; accTp = Math.max(accTp, n.tp[0], n.tp[1]);
      textDirty = true;
      if (live) run();
    },
    setBypass(on, gainDb, lim) {
      if (dead) return;
      bypass = !!on;
      if (!bypass) { gain = NaN; limited = false; } else if (gainDb !== undefined) { gain = abGain(gainDb); limited = !!lim && fin(gain); }
      sync();
    },
    setMono(on) { if (dead) return; mono = !!on; sync(); },
    // silence at once (the engine went off): the LUFS number "—", both bars empty, the over glow gone; nothing is written while not live
    clear() {
      if (dead) return;
      cur = norm(null); accPk = [-Infinity, -Infinity]; accTp = -Infinity; lv = [PK_LO, PK_LO]; overUntil = 0;
      lastBar = lastText = -Infinity; textDirty = true; LS.until = -Infinity;
      if (live) run(); else syncSafe(-Infinity);
    },
    setActive(on) { if (dead) return; active = !!on; sync(); },
    // the safety limiter: on / off as the host has it (silent); setLimit(gr) — its report, dB of reduction (ignored while off)
    setSafe(on) { if (dead) return; LS.on = !!on; sync(); },
    setLimit(gr) { if (dead) return; const T = now(); if (LS.set(gr, T) && live) syncSafe(T); },
    setLive(on) {
      if (dead) return;
      on = !!on;
      if (on === live) return;
      live = on;
      if (on) { lastText = -Infinity; textDirty = true; run(); }
    },
    state: () => { const g = LS.at(now()); return { live, bypass, gain, limited, mono, active, safe: LS.on, limiting: fin(g), gr: g }; },
    destroy() {
      if (dead) return;
      dead = true; live = false;
      for (const f of offs.splice(0)) { try { f(); } catch (err) { console.error(err); } }
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
