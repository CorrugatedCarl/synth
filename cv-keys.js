// cv-keys.js — the hardware keyboards and performance controls of the classic synths (docs/canvas/IMPL-1i.md §4–§6; lane K).
// Pure maths first (node-tested, no DOM): a bed's key geometry in mm of the real instrument (bedLayout), the hit test with its
// tolerances (keyAt: black keys widened at small zooms, the front band) and the velocity of a press by where the key is
// touched (velOf: the back of a key soft, the front edge loud — the bottom tray's velAt curve). cv-panel.js builds every
// bed's art, overlays and hit box from bedLayout (geometry's o.bed: one source); the pointer engine reads the same numbers.
// Plain ES module: no DOM / window / storage at module top level (node imports it: tests, tools/panel-check.mjs). Imports
// nothing of cv-panel (cv-panel imports this file).

/** Key geometry (§1.1, mm): the white gap; a black key's width and visible length as fractions of the white pitch / length. */
export const KEY_GAP = 0.6, BLACK_W = 0.583, BLACK_L = 0.62;
/** Black-key centres in white pitches from the octave's C (C♯ D♯ F♯ G♯ A♯): the "equal top widths" layout — C…E in fifths
 * of 3 pitches, F…B in sevenths of 4 — by pitch class (null: a white key). */
export const BLACK_AT = Object.freeze([null, 1.5 * 3 / 5, null, 3.5 * 3 / 5, null, null, 3 + 1.5 * 4 / 7, null, 3 + 3.5 * 4 / 7, null, 3 + 5.5 * 4 / 7, null]);
/** The front band (§4.1): mm of the lip / rail in front of the keys that still plays the white key under x at full velocity
 * (default and maximum; cv-panel's geometry clamps it to the room below the bed). */
export const FRONT_MM = 8;
/** A black key's hit width (§4.1): at least BLACK_PX screen px (the art's own width at most; ≤ BLACK_CAP · pitch). */
export const BLACK_PX = 20, BLACK_CAP = 0.8;
/** Velocity by depth (§4.2): v = min(1, lo + span · f), f = 0 at the key's back edge … 1 at its front (the tray's velAt). */
export const KEY_VEL = Object.freeze({ lo: 0.3, span: 0.75, min: 0.05 });

const WHITE_IX = [0, -1, 1, -1, 2, 3, -1, 4, -1, 5, -1, 6];
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const pc = n => ((n % 12) + 12) % 12;
const fin = x => typeof x === 'number' && isFinite(x);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** A white key? (MIDI note) */
export const isWhite = n => Number.isInteger(n) && WHITE_IX[pc(n)] >= 0;
/** The white keys from lo to hi (both included). */
export const whitesIn = (lo, hi) => { let k = 0; for (let n = lo; n <= hi; n++) if (WHITE_IX[pc(n)] >= 0) k++; return k; };
/** 'C4' style name (C4 = 60). */
export const noteName = n => NAMES[pc(n)] + (Math.floor(n / 12) - 1);
// a white key's index counted from C0 (MIDI 0)
const wAbs = n => 7 * Math.floor(n / 12) + WHITE_IX[pc(n)];

/**
 * The key geometry of a bed (`c`: the layout's keys control, IMPL-1i §2): mm, origin = the lowest white key's back-left
 * corner, y toward the player. White key i at x = i · pitch, pitch − KEY_GAP wide (its gap on its right: it plays), len long;
 * a black key centred at its BLACK_AT offset, black.w × black.len. `front` (mm): the band in front of the keys — the
 * argument (geometry's clamped value) or c.front, default FRONT_MM, within 0…FRONT_MM. Keys in note order.
 * wn: the white notes left to right.
 * @returns {{lo: number, hi: number, n: number, whites: number, wn: number[], pitch: number, len: number, bw: number, bl: number,
 *   w: number, h: number, front: number, keys: {note: number, black: boolean, x: number, y: number, w: number, h: number}[]}}
 */
export function bedLayout(c, front) {
  const n = c.n | 0, lo = c.lo | 0, hi = lo + n - 1, pitch = +c.pitch, len = +c.len;
  const bk = c.black && typeof c.black === 'object' ? c.black : {};
  const bw = fin(bk.w) ? bk.w : BLACK_W * pitch, bl = fin(bk.len) ? bk.len : BLACK_L * len;
  const f0 = fin(front) ? front : fin(c.front) ? c.front : FRONT_MM;
  const w0 = wAbs(lo), keys = [], wn = [];
  for (let k = lo; k <= hi; k++) {
    const b = BLACK_AT[pc(k)];
    if (b == null) { keys.push({ note: k, black: false, x: wn.length * pitch, y: 0, w: pitch - KEY_GAP, h: len }); wn.push(k); }
    else { const cx = (7 * Math.floor(k / 12) - w0 + b) * pitch; keys.push({ note: k, black: true, x: cx - bw / 2, y: 0, w: bw, h: bl }); }
  }
  return { lo, hi, n, whites: wn.length, wn, pitch, len, bw, bl, w: wn.length * pitch, h: len, front: clamp(f0, 0, FRONT_MM), keys };
}

/** The key of `note` in a bed (null: not on it). */
const keyOf = (B, note) => B.keys[note - B.lo] || null;

/**
 * Velocity 0…1 of a press at depth y (mm from the bed's back edge) on `note`: f = y / the key's visible length (a black key:
 * its own), clamped 0…1; the front band (y > len) is f = 1. v = min(1, KEY_VEL.lo + KEY_VEL.span · f): 0.30 at the back,
 * 1 over the front 7 % and the band.
 */
export function velOf(B, note, y) {
  const k = keyOf(B, note);
  const f = !fin(y) ? 0 : y > B.h ? 1 : clamp(y / (k && k.black ? B.bl : B.h), 0, 1);
  return Math.max(KEY_VEL.min, Math.min(1, KEY_VEL.lo + KEY_VEL.span * f));
}

/**
 * The key under a point (x, y mm in the bed's frame) and its velocity, or null outside the bed and its band. s: on-screen
 * px per mm (the bed element's rect width / B.w, per event). In order: outside (x < 0, x ≥ w, y < 0, y > len + front) →
 * null; a black key when y ≤ its length and |x − its centre| ≤ clamp(BLACK_PX / s, its width, BLACK_CAP · pitch) / 2 (the
 * hit grows toward 20 px at small zooms; the art never changes); else the white key under x (a gap belongs to its left key);
 * the front band (len < y ≤ len + front): the white key under x, v = 1.
 * @returns {{note: number, v: number} | null}
 */
export function keyAt(B, x, y, s) {
  if (!(x >= 0 && x < B.w && y >= 0 && y <= B.h + B.front)) return null;
  if (y <= B.bl) {
    const hw = clamp(s > 0 && isFinite(s) ? BLACK_PX / s : 0, B.bw, BLACK_CAP * B.pitch) / 2;
    for (const k of B.keys) if (k.black && Math.abs(x - (k.x + k.w / 2)) <= hw) return { note: k.note, v: velOf(B, k.note, y) };
  }
  const note = B.wn[Math.min(B.whites - 1, Math.floor(x / B.pitch))];
  return { note, v: velOf(B, note, y) };
}

/* ---------------------------------------------------------------- the models, the TB-303's keys */
/** The synths whose original was touch-sensitive (§3.2, the user's answer 1: the engine reads velocity on these, plus the
 * 303's accent); the others record and send it, as the bed says. */
export const VEL_MODELS = Object.freeze(['cs80', 'dx7']);
/** The bed's spoken / hover note on velocity (§3.2). */
export const velNote = id => (VEL_MODELS.includes(id) ? 'touch-sensitive: the front edge is loudest' : 'not touch-sensitive, like the original (velocity is recorded and sent)');
/** The TB-303's pattern pitch (§6.4): the one root of the `seq` payload and of seqToRoll; a step's note and velocity as the
 * worklet's seqFire plays them. */
export const SEQ_ROOT = 48;
export const seqNote = s => SEQ_ROOT + (s.n | 0) + 12 * (s.o | 0);
export const seqVel = s => (s.a ? 1 : 0.62);

/* ---------------------------------------------------------------- shared helpers of the DOM parts */
const rafOf = o => (o && typeof o.raf === 'function' ? o.raf : f => (typeof globalThis.requestAnimationFrame === 'function' ? globalThis.requestAnimationFrame(f) : setTimeout(() => f(Date.now()), 16)));
const nowOf = o => (o && typeof o.now === 'function' ? o.now : () => (globalThis.performance && typeof globalThis.performance.now === 'function' ? globalThis.performance.now() : Date.now()));
const tsOf = e => (fin(e && e.timeStamp) ? e.timeStamp : undefined);
/** Pointer tracking with capture (main.js track's contract, for a host without one: tests, a stub api): move per pointermove,
 * end once at pointerup / pointercancel / lostpointercapture / a mouse move without a button; abort first when the
 * two-finger layer cancels (pointercancel with e.gesture 'two-finger'). */
export function trackLocal(el, e, move, end, abort) {
  let done = false;
  const mv = ev => { if (ev.pointerId !== e.pointerId) return; if (ev.pointerType === 'mouse' && !(ev.buttons & 1)) return fin(); move(ev); };
  const fin = ev => {
    if (done || (ev && ev.pointerId !== e.pointerId)) return;
    done = true;
    for (const [t, f] of L) el.removeEventListener(t, f);
    try { el.releasePointerCapture(e.pointerId); } catch (err) { /* released */ }
    if (abort && ev && ev.type === 'pointercancel' && ev.gesture === 'two-finger') abort();
    if (end) end();
  };
  const L = [['pointermove', mv], ['pointerup', fin], ['pointercancel', fin], ['lostpointercapture', fin]];
  try { el.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
  for (const [t, f] of L) el.addEventListener(t, f);
}

/* ---------------------------------------------------------------- the bed's pointer engine (§4.1, §4.4) */
/** Pencil pressure → channel aftertouch (§4.4): at = clamp((pressure − AT_FROM) / (1 − AT_FROM), 0, 1). */
export const AT_FROM = 0.15;
/**
 * One bed's touch, mouse and Pencil play (wk.pianoKeys' pointer logic with the true geometry). el: the bed's element (its box
 * = the keys + the front band; its rect, read per event, scales mm on screen under the camera); B: bedLayout with the clamped
 * front. o = { on(n, v, ts), off(n, ts), at: fn(v) | null (the bed's `at: true`), shade(n, on) (a pressed key's dip), raf? }.
 * Each pointer plays its own note; notes are reference-counted over the pointers (two fingers on one key: one note, off when
 * the last leaves); moving onto another key releases the note and plays the new one at the entry velocity (glissando), off
 * the bed it keeps its note; up / cancel / lost capture end it. Mouse: button 0 without Ctrl only; no context menu. A pen
 * with `at` sends its pressure ≤ once a frame, 0 at the last pen lift; fingers and the mouse never. A shade shows while a
 * pointer of this bed or the host (lit) holds its note. release(): every pointer ends (one off per note), captures dropped,
 * shades cleared; a stale event afterwards finds no record and posts nothing.
 * @returns {{lit: (n: number, on: boolean) => void, release: () => void, destroy: () => void, held: () => number[]}}
 */
export function bed(el, B, o) {
  const raf = rafOf(o), ptrs = new Map(), cnt = new Map(), host = new Set(), shown = new Set();
  let dead = false, atQ = null, atDue = false;
  const shade = n => {
    const on = cnt.has(n) || host.has(n);
    if (on === shown.has(n)) return;
    if (on) shown.add(n); else shown.delete(n);
    if (o.shade) o.shade(n, on);
  };
  const press = (n, v, ts) => { const c = cnt.get(n) || 0; cnt.set(n, c + 1); if (!c) o.on(n, v, ts); shade(n); };
  const unpress = (n, ts) => { const c = cnt.get(n) || 0; if (c > 1) { cnt.set(n, c - 1); return; } cnt.delete(n); if (c) o.off(n, ts); shade(n); };
  const hit = e => {
    const r = el.getBoundingClientRect(), s = r.width / B.w;
    if (!(s > 0)) return null;
    return keyAt(B, (e.clientX - r.left) / s, (e.clientY - r.top) / s, s);
  };
  const pens = () => { for (const p of ptrs.values()) if (p.pen) return true; return false; };
  const atOf = e => clamp(((+e.pressure || 0) - AT_FROM) / (1 - AT_FROM), 0, 1);
  function sendAt(v) { // ≤ once per frame (the last value of the frame)
    atQ = v;
    if (atDue) return;
    atDue = true;
    raf(() => { atDue = false; if (atQ == null || dead) return; const x = atQ; atQ = null; o.at(x); });
  }
  function lift(id, ts) {
    const p = ptrs.get(id);
    if (!p) return;
    ptrs.delete(id);
    unpress(p.n, ts);
    if (p.pen && o.at && !pens()) { atQ = null; o.at(0); }
  }
  function down(e) {
    if (dead || ptrs.has(e.pointerId) || e.button !== 0 || e.ctrlKey) return;
    const h = hit(e);
    if (!h) return;
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
    const pen = e.pointerType === 'pen';
    ptrs.set(e.pointerId, { n: h.note, pen });
    press(h.note, h.v, tsOf(e));
    if (pen && o.at) sendAt(atOf(e));
  }
  function move(e) {
    const p = ptrs.get(e.pointerId);
    if (!p || dead) return;
    if (e.pointerType !== 'touch' && !(e.buttons & 1)) { lift(e.pointerId, tsOf(e)); return; } // (a mouse / pen up we never saw)
    if (p.pen && o.at) sendAt(atOf(e));
    const h = hit(e);
    if (!h || h.note === p.n) return; // (off the bed: the note stays; within a key: nothing)
    const n0 = p.n;
    p.n = h.note;
    unpress(n0, tsOf(e));
    press(h.note, h.v, tsOf(e));
  }
  const up = e => lift(e.pointerId, tsOf(e));
  const menu = e => e.preventDefault(); // (a long press plays, never opens a menu)
  const L = [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', up], ['lostpointercapture', up], ['contextmenu', menu]];
  for (const [t, f] of L) el.addEventListener(t, f);
  function release() {
    const hadPen = pens();
    for (const id of [...ptrs.keys()]) try { el.releasePointerCapture(id); } catch (err) { /* released */ }
    ptrs.clear();
    for (const n of [...cnt.keys()]) { cnt.delete(n); o.off(n); }
    host.clear();
    for (const n of [...shown]) shade(n);
    atQ = null;
    if (hadPen && o.at) o.at(0);
  }
  return {
    lit(n, on) { if (dead) return; if (on) host.add(n); else host.delete(n); shade(n); },
    release, held: () => [...cnt.keys()],
    destroy() { if (dead) return; release(); dead = true; for (const [t, f] of L) el.removeEventListener(t, f); },
  };
}

/* ---------------------------------------------------------------- the controllers (§5) */
/** The bend range (st) every model keeps (I1); the ribbon's semitones over its length and the pad's rise (s) by default. */
export const BEND_ST = 2, RIBBON_SPAN = 12, PAD_RISE = 0.25;
/** The originals' pitch range where §5.3 states it (the tooltip: "±2 semitones (the original: …)"; a control's `tip` wins). */
export const BEND_ORIG = Object.freeze({ prophet5: 'about ± a fifth', obxa: '±1 octave, ±2 st with NARROW', cs80: 'about an octave along the ribbon',
  dx7: '0–12 semitones per patch', ms20: 'a patch source, CONTROL WHEEL OUT' });
/** Keyboard steps (§4.5): the arrows move a controller by KEY_STEP. */
export const KEY_STEP = 0.1;
/** What a perf token drives: 'bend' (−1…1) | 'wheel' (the Mod Wheel, 0…1) | null. */
export const ctlKind = id => (id === 'perf:bend' ? 'bend' : id === 'perf:mod' ? 'wheel' : null);
/** Does the controller return to rest on release (§5.1): every bend control, a lever (the OB-Xa's mod paddle), the pad. */
export const springs = (c, kind) => kind === 'bend' || c.kind === 'lever' || c.kind === 'pad';
/** The value after a drag (§5.1, relative to the press): v0 the value at the press, dx / dy the pointer's travel in mm of
 * the control (screen axes, y down). A wheel: away from the player (screen up; 'h': right) raises it, Δv = 2Δ / h (bend) or
 * Δ / h (mod); a lever: along `up`, the slot's length; the ribbon: Δx · span / (w · BEND_ST). Clamped to the range. */
export function dragValue(c, kind, v0, dx, dy) {
  const lo = kind === 'bend' ? -1 : 0, k = kind === 'bend' ? 2 : 1;
  let d = 0, len = 1;
  if (c.kind === 'wheel') { const h = c.orient === 'h'; d = h ? dx : -dy; len = h ? c.w : c.h; }
  else if (c.kind === 'lever') { const ax = c.axis === 'x'; d = (ax ? dx : dy) * (c.up === '-y' ? -1 : 1); len = ax ? c.w : c.h; }
  else if (c.kind === 'ribbon') { d = dx; len = k * c.w * BEND_ST / (c.span > 0 ? c.span : RIBBON_SPAN); }
  return clamp(v0 + k * d / len, lo, 1);
}
/** Where a moving part sits at v, as a fraction of its travel along the raising direction: bend centred, mod from rest. */
export const partAt = (kind, v) => (kind === 'bend' ? 0.5 + 0.5 * clamp(v, -1, 1) : clamp(v, 0, 1));
/** aria-valuetext: "+1.2 st" | "45 %". */
export const ctlText = (kind, v) => (kind === 'bend' ? (v > 0 ? '+' : v < 0 ? '-' : '') + Math.abs(v * BEND_ST).toFixed(1) + ' st' : Math.round(v * 100) + ' %');
/**
 * One controller's behaviour (§5.1, §4.5): el the widget (its rect / c.w = screen px per mm), c its layout control, o = {
 * perf (api.perf), track (api.track or trackLocal), show(v, touch) (the moving part; touch: the ribbon's marker x in mm or
 * null), raf?, now? }. Drags are relative; one finger per controller (a second press is ignored); moves post ≤ once a frame,
 * the end at once (a spring's rest, the mod wheel's last value); the two-finger abort puts back 0 (bend) or the value at the
 * press (mod, pad). The pad ramps to 1 over `rise` while touched, 0 at release. The view follows perf.view echoes of the
 * selected track except while dragged. Keys (only once focused from the keyboard: a press-focused controller gives the page
 * its Space / Home / arrows back, main.js's kbFocus rule): arrows ± KEY_STEP, Home / End; a spring returns at keyup and
 * blur; the pad: Space / Enter held. release(): a drag or a held key ended as at its release.
 * @returns {{release: () => void, destroy: () => void, value: () => number}}
 */
export function controller(el, c, o) {
  const P = o.perf, kind = ctlKind(c.id), raf = rafOf(o), now = nowOf(o), track = typeof o.track === 'function' ? o.track : trackLocal;
  const lo = kind === 'bend' ? -1 : 0, spring = springs(c, kind), pad = c.kind === 'pad', rise = (c.rise > 0 ? c.rise : PAD_RISE) * 1000;
  const send = v => { if (kind === 'bend') P.bend(v); else P.mod(v); };
  let cur = P.value(kind), drag = null, keyHeld = null, q = null, due = false, dead = false, byPtr = false; // (byPtr: focused by a press, not Tab)
  const show = (v, touch) => { cur = v; o.show(v, touch == null ? null : touch); };
  const flush = () => { due = false; if (q == null || dead) return; const v = q; q = null; send(v); };
  const post = v => { q = v; if (!due) { due = true; raf(flush); } };
  const now1 = v => { q = null; send(v); }; // (an end: at once)
  const offView = P.view(kind, v => { if (!drag && !keyHeld && !dead) show(v); });
  // the pad: from the value at the press to 1 over `rise`, posted from the frame callbacks while it climbs (≤ one a frame;
  // d: the press or the held key)
  function ramp(d) {
    if (dead || d.done || (drag !== d && keyHeld !== d)) return;
    const v = d.v0 + (1 - d.v0) * clamp((now() - d.t0) / rise, 0, 1);
    if (v !== d.last) { d.last = v; d.sent = true; show(v); now1(v); }
    if (v < 1) raf(() => ramp(d));
  }
  function finish(d, aborted) {
    if (d.done) return;
    d.done = true;
    if (drag === d) drag = null;
    if (keyHeld === d) keyHeld = null;
    if (pad && o.pressed) o.pressed(false);
    const v = aborted ? (kind === 'bend' ? 0 : d.v0) : spring ? 0 : cur;
    show(v);
    if (d.sent || v !== d.v0) now1(v); else q = null; // (a touch that moved nothing posts nothing: the ribbon, §5.1)
  }
  el.addEventListener('pointerdown', e => {
    if (dead || drag || e.button !== 0 || e.ctrlKey) return; // (one finger per controller)
    e.preventDefault();
    const r = el.getBoundingClientRect(), s = r.width / c.w;
    if (!(s > 0)) return;
    const v0 = P.value(kind), d = drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, s, v0, last: v0, t0: now(), done: false };
    if (!(el.ownerDocument && el.ownerDocument.activeElement === el)) byPtr = true; // (a Tab-focused one stays the keyboard's)
    try { el.focus({ preventScroll: true }); } catch (err) { /* inert */ }
    if (c.kind === 'ribbon') show(cur, (e.clientX - r.left) / s);
    if (pad) { if (o.pressed) o.pressed(true); ramp(d); }
    track(el, e, ev => {
      if (drag !== d || d.done || pad) return;
      const v = dragValue(c, kind, d.v0, (ev.clientX - d.x0) / d.s, (ev.clientY - d.y0) / d.s);
      if (c.kind === 'ribbon') { const r2 = el.getBoundingClientRect(); show(v, (ev.clientX - r2.left) / d.s); } else show(v);
      if (v !== d.last) { d.last = v; d.sent = true; post(v); }
    }, () => finish(d, false), () => finish(d, true));
  });
  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('keydown', e => {
    if (dead || drag || byPtr) return; // (main.js kbFocus's rule: a pointer-focused control gives Space / Home / the arrows back to the page)
    const k = e.key;
    if (pad) {
      if (k !== ' ' && k !== 'Enter') return;
      e.preventDefault();
      if (keyHeld || e.repeat) return;
      const v0 = P.value(kind);
      keyHeld = { v0, last: v0, t0: now(), done: false };
      if (o.pressed) o.pressed(true);
      ramp(keyHeld);
      return;
    }
    let v;
    if (k === 'ArrowUp' || k === 'ArrowRight') v = cur + KEY_STEP;
    else if (k === 'ArrowDown' || k === 'ArrowLeft') v = cur - KEY_STEP;
    else if (k === 'Home') v = lo;
    else if (k === 'End') v = 1;
    else return;
    e.preventDefault(); e.stopPropagation();
    v = clamp(Math.round(v * 1000) / 1000, lo, 1);
    if (spring && !keyHeld) keyHeld = { v0: cur, done: false, sent: true }; // (held: it returns to rest at the keyup)
    show(v); now1(v);
  });
  const keyEnd = () => { if (keyHeld) finish(keyHeld, false); };
  el.addEventListener('keyup', e => { if (!pad || e.key === ' ' || e.key === 'Enter') keyEnd(); });
  el.addEventListener('blur', () => { byPtr = false; keyEnd(); });
  function release() { const d = drag; if (d) { try { el.releasePointerCapture(d.id); } catch (err) { /* released */ } finish(d, false); } keyEnd(); }
  return {
    value: () => cur, release,
    destroy() { if (dead) return; release(); dead = true; q = null; offView(); },
  };
}

/* ---------------------------------------------------------------- the host (§6.1) */
/**
 * The performance host main.js wires (§6.1, §6.2): deps = { noteOn(n, v, ts), noteOff(n, ts), ctl(kind, v), live(kind),
 * held(), bendUI(v), modUI(v), sel(trackView) }. api(trackView) is a panel's api.perf: its keys and controllers post only
 * while that track is the selected one (a stale panel plays nothing), a note that is no integer 0–127 never; lit(n, on)
 * (keyVis) reaches every mounted bed; live(kind, v) (a ctl that reached the selected track) every view; release() every
 * mounted bed and controller (panic, power off, a hidden page, a blur).
 * @returns {{api: (tv: object) => object, lit: (n: number, on: boolean) => void, live: (kind: string, v: number) => void, release: () => void}}
 */
export function perfHost(deps) {
  const lits = new Set(), views = { bend: new Set(), wheel: new Set(), at: new Set() }, beds = new Set();
  const noteOk = n => Number.isInteger(n) && n >= 0 && n <= 127;
  const each = (S, f) => { for (const x of [...S]) { try { f(x); } catch (err) { console.error(err); } } };
  return {
    api(tv) {
      const sel = () => !!deps.sel(tv);
      return {
        on(n, v, ts) { if (noteOk(n) && sel()) deps.noteOn(n, clamp(+v || 0, 0, 1), ts); },
        off(n, ts) { if (noteOk(n) && sel()) deps.noteOff(n, ts); },
        bend(v) { if (!sel()) return; deps.ctl('bend', v); if (deps.bendUI) deps.bendUI(v); },
        mod(v) { if (!sel()) return; deps.ctl('wheel', v); if (deps.modUI) deps.modUI(v); },
        at(v) { if (sel()) deps.ctl('at', v); },
        value: kind => { const v = +deps.live(kind); return fin(v) ? v : 0; },
        view(kind, fn) { const S = views[kind]; if (!S) return () => {}; S.add(fn); return () => S.delete(fn); },
        lit(fn) { lits.add(fn); return () => lits.delete(fn); },
        held: () => (deps.held ? deps.held() || [] : []),
        bed(rel) { beds.add(rel); return () => beds.delete(rel); },
      };
    },
    lit(n, on) { each(lits, f => f(n, !!on)); },
    live(kind, v) { if (views[kind]) each(views[kind], f => f(v)); },
    release() { each(beds, f => f()); },
  };
}

/* ---------------------------------------------------------------- CSS (one <style> per document, wk's pattern) */
const CSS_ID = 'cv-keys-css';
const CSS = `
.inst.hw .hw-c > .hw-keys, .inst.hw .hw-c > .hw-wheel, .inst.hw .hw-c > .hw-lever, .inst.hw .hw-c > .hw-ribbon, .inst.hw .hw-c > .hw-pad {
  pointer-events: auto; touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
.inst.hw .hw-c > [aria-disabled="true"], .inst.hw .hw-c > [aria-disabled="true"]::before { pointer-events: none; }
.inst.hw .hw-kd { position: absolute; pointer-events: none; background: linear-gradient(rgba(0, 0, 0, 0.36), rgba(0, 0, 0, 0.36) 2px, rgba(0, 0, 0, 0.18) 2px); }
.inst.hw .hw-kd[hidden] { display: none; }
.inst.hw .hw-wheel, .inst.hw .hw-lever { overflow: hidden; background: var(--pf-slot, #050505); cursor: ns-resize; }
.inst.hw .hw-wheel[data-orient="h"], .inst.hw .hw-lever[data-axis="x"] { cursor: ew-resize; }
.inst.hw .hw-ws { position: absolute; pointer-events: none; background: repeating-linear-gradient(var(--pf-dir, 180deg), var(--pf-ridge, #161616) 0 var(--pf-rw, 1.2px), var(--pf-surface, #2b2b2b) var(--pf-rw, 1.2px) var(--pf-rp, 6px)); }
.inst.hw .hw-wm, .inst.hw .hw-lc, .inst.hw .hw-rm, .inst.hw .hw-pl { position: absolute; pointer-events: none; }
.inst.hw .hw-wm { background: var(--pf-mark, #d8d8d8); }
.inst.hw .hw-lc { background: var(--pf-cap, #cfcfcf); border-radius: 1px; }
.inst.hw .hw-ribbon { cursor: ew-resize; }
.inst.hw .hw-rm { top: 0; bottom: 0; width: 3px; margin-left: -1.5px; background: var(--pf-lit, #ffd36a); }
.inst.hw .hw-rm[hidden] { display: none; }
.inst.hw .hw-pad { cursor: pointer; }
.inst.hw .hw-pl { inset: 0; border-radius: inherit; background: var(--pf-lit, #ff6a3a); opacity: 0; }
`;
const styledDocs = new WeakSet();
/** The keys' and controllers' CSS, injected once per document (lane C's style.css untouched this stage, §3.2). */
export function ensureCSS(doc) {
  if (!doc || typeof doc.createElement !== 'function') return null;
  let s = typeof doc.getElementById === 'function' ? doc.getElementById(CSS_ID) : null;
  const at = doc.head || doc.documentElement;
  if (!s && !styledDocs.has(doc) && at && typeof at.appendChild === 'function') { // (a stub DOM without a head: nothing)
    s = doc.createElement('style');
    s.id = CSS_ID; s.textContent = CSS;
    at.appendChild(s);
    styledDocs.add(doc);
  }
  return s;
}
