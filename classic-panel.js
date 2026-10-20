// classic-panel.js — a classic instrument's panel as an instance (SPEC-canvas §10 stage 1c): today's renderPanel, control,
// widgets, drag, preset plate and TB-303 sequencer, de-globalised. Each ClassicPanel holds its own track, model, value
// updaters (`ui`) and sequencer / step elements, so two instances never share state; destroy() empties its root (the
// module body remounts by building a new one from the track, where every value lives).
//   new ClassicPanel(root, { track, model, layout, host })
//     layout   a cv-panel layout (the Hardware panel, IMPL-panels) or null (the Simple panel: today's flowing sections)
//     host     the page's services (main.js classicHost): changed(track, id) after a value write (preset → Custom, the
//              patch, autosave, the DX7 chart), presetTouched(track) (the rollback put a preset name back), kit (track,
//              pressOrTap, noMenu, hoverable, wheelIn, wheelStep, tip, untip), presets (list / cur / load / step / save /
//              del / init, each given the track), chip(key) (the module chip follows a preset change), presetNo(track),
//              seq (of, send, running, toggle, toRoll, hw), dx(track), doc, perf (1i: perf.api(track)), drum (7a: a drum
//              machine's drumHost — api().drum = drum.api(track) on a drums-family model only)
//   .ui (id → updater), .hw (the rendered hardware panel or null), set(id, v), update(id), refresh(), syncPreset(key),
//   seqStep(i), seqRunUI(on), destroy()
// Every control carries data-ctl and data-dest = its models.js id (the module root carries data-dev: canvas modulation
// drops resolve [data-dest] inside [data-dev], SPEC §4.6). Plain ES module: no DOM at module top level.
// Stage 2b (IMPL-2b §6.2, SPEC §7.11): halos and the mod menu on classic controls.
//   setMods(rowsByDest, eff)  rowsByDest: { ctlId: [{ id, src, kind?, amt, bi, byp, out }] } — the canvas rows on each
//            control (host.rowsOf(dev) grouped by param); eff: { ctlId: value in knob units } | null — the live modulated
//            values (the engine's classic eff snapshot through the host). Paints: a knob an arc ring (svg.cp-halo in the
//            knob: one path.cp-arc.k-<kind> per row in the source kind's colour, MOD_COLOR; circle.cp-live at the live
//            value when it differs from the base by > 0.002), a slider a range bar (div.cp-range + div.cp-livemk in
//            .slider), a numBox / selector / toggle / hardware switch a badge (span.cp-mbadge in its wrap: ∿ and the
//            row count). Ranges: haloRanges(c, v, rows) (pure, exported). Only the host calls it (throttled at the monitor
//            rate, for on-screen modules); the panel repaints a control's halo itself when its base value moves.
//   setLive(eff)  the live dots alone (the monitor path between row changes; fixer C P7: paintLive writes the dot / mark /
//            badge ring only — the arcs are repainted on rows and base changes). A slider's bars are thin, beside the
//            groove, the i-th stepped aside (--cp-i; U13), the cap above them.
//   host.changed(track, id, ph)  ph 'move' for a drag's writes, 'end' once at its lift after a move (gestureEnd; the host
//            coalesces a cabled knob's transfer reposts), nothing for a key / wheel / typed / reset write (U2).
//   modMenu(ctlId, x, y, el)  the press-and-hold / right-click menu (wk.contextMenu): the host's rows (Bypass / Disconnect
//            each), Connect to…, Reset Control, Enter Value… (knobs; the knob-unit number prefilled, U12), the host's extra
//            items. Opened by dragB (every knob,
//            slider, numBox and hardware control: wk.menuSource — a 500 ms touch long-press ≤ 8 px, a right-click, the
//            ContextMenu key / Shift+F10) and by selectors / toggles. The 1g / 1h data-tip hit-test is untouched (the halo
//            nodes take no pointer events).
//   host.modMenu (lane D's; every member optional): { rows(track, ctlId) → [{ id, src, label, byp }], bypass(track, rowId,
//            on), disconnect(track, rowId), connect(track, ctlId, anchorEl), canMod(track, ctlId) → false disables Connect
//            to…, extra(track, ctlId, el) → wk items appended }. Without host.modMenu the menu holds Reset / Enter Value.
import * as cvPanel from './cv-panel.js?v=9';
import * as wk from './wk.js?v=9';
import { MOD_COLOR, srcKind } from './cv-cables.js?v=9';

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export function fmt(c, v) { return c.fmt ? c.fmt(v) : c.t === 'k' ? (+v).toFixed(1) : String(v); }
export function toPos(c, v) { return (v - c.min) / (c.max - c.min); }
export function fromPos(c, p) {
  let v = c.min + clamp(p, 0, 1) * (c.max - c.min);
  if (c.step) v = Math.round(v / c.step) * c.step;
  return +v.toFixed(4);
}
// empties an element (a browser's replaceChildren; the node test DOMs' fallbacks)
export function clearEl(el) { if (typeof el.replaceChildren === 'function') el.replaceChildren(); else { el.innerHTML = ''; while (el.firstChild) el.removeChild(el.firstChild); } }
const posB = (b, v) => (v - b.min) / ((b.max - b.min) || 1);
function fromPosB(b, p) {
  let v = b.min + clamp(p, 0, 1) * (b.max - b.min);
  if (b.step) v = Math.round(v / b.step) * b.step;
  return +v.toFixed(4);
}
const fin = x => typeof x === 'number' && isFinite(x), r4 = v => Math.round(v * 1e4) / 1e4;
const call = (f, ...a) => { try { return typeof f === 'function' ? f(...a) : undefined; } catch (err) { console.error(err); return undefined; } };
const SVG = 'http://www.w3.org/2000/svg';
/** (2b) The bipolar source kinds (Serum's srcPol: bend and chaos swing both ways; every other 2b source is unipolar). */
const SRC_BI = new Set(['bend', 'chaos']);
/**
 * (2b, SPEC §7.11) The halo arcs of a classic control: rows {src, kind?, amt, bi, byp, out, id} over control c (models.js:
 * t 'k' / 's' / 'b', min / max / opts) at value v → [{from, to, kind, id, byp, neg}] in the control's normalised range
 * (Serum's haloArcs rule: a bipolar row [base ± |a|/2], a bipolar source [base ± |a|], else [base, base + a], a = amt·out;
 * zero rows draw nothing; bypassed ones carry byp for a dimmed arc). Pure.
 */
export function haloRanges(c, v, rows) {
  if (!c || typeof c !== 'object') return [];
  const base = c.t === 'k' ? clamp(toPos(c, +v), 0, 1) : c.t === 's' ? (Array.isArray(c.opts) && c.opts.length > 1 ? clamp((+v || 0) / (c.opts.length - 1), 0, 1) : 0) : v ? 1 : 0;
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== 'object') continue;
    const kind = r.kind || srcKind(r.src) || 'other', a = (fin(+r.amt) ? +r.amt : 0) * (r.out == null ? 1 : fin(+r.out) ? +r.out : 1), m = Math.abs(a);
    if (!m) continue;
    let lo, hi;
    if (r.bi) { lo = base - m / 2; hi = base + m / 2; } else if (SRC_BI.has(kind)) { lo = base - m; hi = base + m; } else { lo = Math.min(base, base + a); hi = Math.max(base, base + a); }
    out.push({ from: r4(clamp(lo, 0, 1)), to: r4(clamp(hi, 0, 1)), kind, id: r.id, byp: !!r.byp, neg: a < 0 });
  }
  return out;
}
/** (2b) A classic knob's dial point at normalised n (sweep sw degrees, centred on the top) in its 64 × 64 box, radius r. */
export function dialPt(n, r, sw) { const a = (-sw / 2 + sw * n) * Math.PI / 180; return [32 + r * Math.sin(a), 32 - r * Math.cos(a)]; }
/** (2b) An SVG arc from n0 to n1 (normalised) along a classic knob's dial of sweep sw at radius r ('' when empty). */
export function dialArc(n0, n1, r, sw) {
  if (n1 < n0) { const t = n0; n0 = n1; n1 = t; }
  n0 = clamp(n0, 0, 1); n1 = clamp(n1, 0, 1);
  if (n1 - n0 < 1e-4) return '';
  const p0 = dialPt(n0, r, sw), p1 = dialPt(n1, r, sw);
  return `M${p0[0].toFixed(2)} ${p0[1].toFixed(2)}A${r} ${r} 0 ${sw * (n1 - n0) > 180 ? 1 : 0} 1 ${p1[0].toFixed(2)} ${p1[1].toFixed(2)}`;
}
const TICKS = (() => {
  let s = '';
  for (let i = 0; i <= 10; i++) {
    const a = (-135 + 27 * i) * Math.PI / 180;
    const x1 = 32 + Math.sin(a) * 28.5, y1 = 32 - Math.cos(a) * 28.5, x2 = 32 + Math.sin(a) * 31.5, y2 = 32 - Math.cos(a) * 31.5;
    s += `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`;
  }
  return s;
})();
/* TB-303 pattern data (the panel's sequencer and main.js seqOf share it) */
export const SEQ_NOTES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B', 'C′'];
const st = (n, o, a, sl, g = 1) => ({ n, o, a, s: sl, g });
export const SEQ_DEF = {
  bpm: 128, swing: 0, sync: false,
  pat: [st(0, 0, 1, 0), st(0, 0, 0, 0), st(12, 0, 0, 1), st(0, 0, 0, 0), st(3, 0, 1, 0), st(0, 0, 0, 1), st(10, 0, 0, 0), st(0, 0, 0, 0, 0),
    st(0, 0, 1, 0), st(7, 0, 0, 1), st(5, 0, 0, 0), st(3, 0, 0, 0), st(12, 0, 1, 1), st(0, 1, 0, 0), st(5, 0, 0, 0), st(6, 0, 1, 0)],
};
export function seqRandom(q) {
  const scale = [0, 0, 3, 5, 7, 7, 10, 12];
  q.pat = q.pat.map(() => st(scale[(Math.random() * scale.length) | 0], Math.random() < 0.18 ? 1 : Math.random() < 0.08 ? -1 : 0,
    Math.random() < 0.3 ? 1 : 0, Math.random() < 0.22 ? 1 : 0, Math.random() < 0.82 ? 1 : 0));
  q.pat[0].g = 1;
}

export class ClassicPanel {
  constructor(root, ctx) {
    const c = ctx || {};
    this.root = root; this.track = c.track; this.model = c.model; this.host = c.host || {};
    this.kit = this.host.kit || {};
    this.doc = this.host.doc || (root && root.ownerDocument) || globalThis.document;
    this.ui = new Map(); this.hw = null; this.stepEls = []; this.plateSync = null; this.seq = null; this.dead = false;
    this.layout = c.layout || null;
    // (2b) the live widgets by id (knob / slider / numBox / selector / toggle), the controls by id, the halos (id → rows),
    // their nodes, the live snapshot, the wraps index (built on demand)
    this.els = new Map(); this.ctls = new Map((this.model && this.model.controls || []).map(c0 => [c0.id, c0]));
    this.halos = new Map(); this.hnodes = new Map(); this.eff = null; this.wraps = null;
    this.render();
  }
  get vals() { return this.track.vals; }
  h(tag, cls, txt) { const e = this.doc.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  // a value write: the widget(s) of id, then the page (the preset becomes Custom, the patch, autosave); ph (2b U2): 'move'
  // during a drag, 'end' at its lift (gestureEnd: once, after a move), nothing for a key / wheel / typed / reset write —
  // the host throttles a cabled knob's transfer repost while 'move' holds
  set(id, v, ph) {
    if (this.dead) return;
    this.vals[id] = v;
    this.update(id);
    if (this.host.changed) this.host.changed(this.track, id, ph);
  }
  gestureEnd(id) { if (!this.dead && this.host.changed) this.host.changed(this.track, id, 'end'); }
  update(id) { const u = this.ui.get(id); if (u) u(); if (this.halos.has(id)) this.paintHalo(id); } // ((2b) the halo follows the base)
  refresh() { for (const u of this.ui.values()) u(); for (const id of this.halos.keys()) this.paintHalo(id); }
  syncPreset(key) { // the preset changed: the plate, the module chip and a hardware preset display (the host's chip sync calls it)
    if (this.plateSync) this.plateSync(key);
    if (this.host.chip) this.host.chip(key); else this.update('@preset');
  }

  render() {
    const root = this.root, m = this.model, th = m.theme, L = this.layout;
    root.setAttribute('data-dev', this.track.prim || 'i1');
    root.className = `inst ctl-${th.ctl} knob-${th.knob}${th.wood ? ' wood' : ''} m-${m.id}`;
    const vars = { panel: th.panel, face: th.face, ink: th.ink, label: th.label, accent: th.accent, cap: th.cap || '#eee', capline: th.capLine || '#111' };
    for (const k in vars) root.style.setProperty('--' + k, vars[k]);
    clearEl(root);
    this.els.clear(); this.hnodes.clear(); this.wraps = null; // ((2b) a re-render: halos painted again on the next setMods)
    if (L) { this.hw = cvPanel.render(root, L, m, this.api()); return; } // presets: the module's chip (◀ ▶) and its ⋯ menu
    const h = (a, b, t) => this.h(a, b, t), plate = h('div', 'plate'), nm = h('div', 'nameplate');
    nm.append(h('div', 'maker', m.maker), h('div', 'mname', m.name), h('div', 'mmodel', `${m.model} · ${m.year} · track “${this.track.name}”`));
    if (th.stripes) { const s = h('div', 'stripes'); for (const c of th.stripes) { const i = h('i'); i.style.background = c; s.append(i); } nm.append(s); }
    plate.append(nm, h('div', 'tag', m.tag), this.presetPlate());
    const secs = h('div', 'secs');
    let ops = null; // DX7 operator rows share one horizontal scroller so row 1's labels stay over every column
    m.sections.forEach((s, si) => {
      const se = h('div', 'sec' + (s.wide ? ' wide' : '') + (s.op ? ' op' : ''));
      se.append(h('h3', null, s.title));
      const cs = h('div', 'ctls');
      for (const c of s.c) cs.append(this.control(c, si));
      se.append(cs);
      if (s.op) { if (!ops) { ops = h('div', 'opswrap'); secs.append(ops); } ops.append(se); }
      else secs.append(se);
    });
    root.append(plate, secs);
    if (m.id === 'tb303') secs.append(this.seqUI());
  }
  destroy() {
    if (this.dead) return;
    this.dead = true;
    if (this.hw) { try { this.hw.destroy(); } catch (err) { console.warn(err); } this.hw = null; }
    this.ui.clear(); this.stepEls.length = 0; this.plateSync = null;
    this.els.clear(); this.halos.clear(); this.hnodes.clear(); this.wraps = null; this.eff = null;
    const el = this.root;
    clearEl(el);
    for (const a of ['style', 'data-hw', 'data-ptr', 'data-knurl', 'data-cap', 'data-dev']) el.removeAttribute(a);
  }

  /* ---- controls */
  control(c, si) {
    const th = this.model.theme, wrap = this.h('div', 'ctl t-' + c.t);
    wrap.setAttribute('data-ctl', c.id); // (one live widget per models.js id in either layout: presets, undo, 2b's mod menus)
    wrap.setAttribute('data-dest', c.id);
    let el;
    if (c.t === 'k') el = th.ctl === 'slider' ? this.slider(c, si) : th.ctl === 'num' ? this.numBox(c) : this.knob(c);
    else if (c.t === 's') el = this.selector(c);
    else el = this.toggle(c);
    wrap.append(el, this.h('label', null, c.label));
    return wrap;
  }
  ariaVal(el, c) {
    const v = this.vals[c.id];
    el.setAttribute('aria-valuemin', c.min); el.setAttribute('aria-valuemax', c.max);
    el.setAttribute('aria-valuenow', v); el.setAttribute('aria-valuetext', fmt(c, v));
  }
  knob(c) { // c.sweep (a hardware panel's printed dial, deg; default 270); c.hw (a hardware panel's: no tick ring or shine — its
    // art prints the dial and style.css hid them there: 13 elements a knob, 7a review 2 #3)
    const el = this.h('div', 'knob'), sw = c.sweep > 0 ? +c.sweep : 270;
    el.tabIndex = 0; el.setAttribute('role', 'slider'); el.setAttribute('aria-label', c.label);
    el.innerHTML = c.hw
      ? '<svg viewBox="0 0 64 64"><circle class="skirt" cx="32" cy="32" r="25"/><g class="rot"><circle class="cap" cx="32" cy="32" r="17.5"/><line class="ind" x1="32" y1="9" x2="32" y2="21"/></g></svg>'
      : `<svg viewBox="0 0 64 64"><g class="ticks">${TICKS}</g><circle class="skirt" cx="32" cy="32" r="25"/><g class="rot"><circle class="cap" cx="32" cy="32" r="17.5"/><circle class="shine" cx="32" cy="32" r="17.5"/><line class="ind" x1="32" y1="9" x2="32" y2="21"/></g></svg>`;
    const rot = typeof el.querySelector === 'function' ? el.querySelector('.rot') : null; // (null in a node test DOM)
    const upd = () => {
      if (rot) rot.setAttribute('transform', `rotate(${(-sw / 2 + sw * toPos(c, this.vals[c.id])).toFixed(2)} 32 32)`);
      this.ariaVal(el, c);
    };
    this.ui.set(c.id, upd); upd();
    this.els.set(c.id, el);
    this.drag(el, c);
    return el;
  }
  slider(c, si) { // c.orient 'h' (the cap moves along x), c.invert (minimum at the top / right), c.capColor, c.hw (a hardware panel's:
    // no printed ticks — the art has its own ladder and style.css hid them there, 7a review 2 #3)
    const th = this.model.theme, el = this.h('div', 'slider');
    el.tabIndex = 0; el.setAttribute('role', 'slider'); el.setAttribute('aria-label', c.label);
    if (c.orient === 'h') el.setAttribute('data-orient', 'h');
    const cap = this.h('div', 'cap');
    if (c.capColor) cap.style.background = c.capColor;
    else if (th.capColors && !c.hw) cap.style.background = th.capColors[si % th.capColors.length];
    if (c.hw) el.append(this.h('div', 'groove'), cap);
    else {
      const ticks = this.h('div', 'sticks');
      for (let i = 0; i <= 10; i++) ticks.append(this.h('i'));
      el.append(this.h('div', 'groove'), ticks, cap);
    }
    const upd = () => { // the cap's travel: the slot less the cap (--cap-h on a hardware panel, 14 px here)
      const p = toPos(c, this.vals[c.id]), q = (c.invert ? 1 - p : p).toFixed(4);
      if (c.orient === 'h') cap.style.left = `calc(${q} * (100% - var(--cap-h, 14px)))`; else cap.style.bottom = `calc(${q} * (100% - var(--cap-h, 14px)))`;
      this.ariaVal(el, c);
    };
    this.ui.set(c.id, upd); upd();
    this.els.set(c.id, el);
    this.drag(el, c);
    return el;
  }
  numBox(c) {
    const el = this.h('div', 'num');
    el.tabIndex = 0; el.setAttribute('role', 'slider'); el.setAttribute('aria-label', c.label);
    const upd = () => { el.textContent = fmt(c, this.vals[c.id]); this.ariaVal(el, c); };
    this.ui.set(c.id, upd); upd();
    this.els.set(c.id, el);
    this.drag(el, c);
    return el;
  }
  selector(c) {
    const el = this.h('div', 'sel' + (c.opts.length <= 2 ? ' two' : ''));
    el.setAttribute('role', 'radiogroup'); el.setAttribute('aria-label', c.label);
    const bs = c.opts.map((o, i) => {
      const b = this.h('button', 'opt'); b.type = 'button'; b.setAttribute('role', 'radio');
      b.append(this.h('span', 'led'), this.h('span', 'txt', o));
      b.onclick = () => this.set(c.id, i);
      el.append(b);
      return b;
    });
    const upd = () => bs.forEach((b, i) => { const on = this.vals[c.id] === i; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
    el.addEventListener('keydown', e => { // radio group: one tab stop, arrows move the selection
      const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault(); e.stopPropagation();
      const i = (this.vals[c.id] + d + c.opts.length) % c.opts.length;
      this.set(c.id, i); bs[i].focus();
    });
    this.ui.set(c.id, upd); upd();
    this.els.set(c.id, el);
    this.menuOn(el, c.id);
    return el;
  }
  toggle(c) {
    const b = this.h('button', 'tog'); b.type = 'button'; b.setAttribute('aria-label', c.label);
    b.append(this.h('span', 'led'));
    b.onclick = () => this.set(c.id, this.vals[c.id] ? 0 : 1);
    const upd = () => { b.classList.toggle('on', !!this.vals[c.id]); b.setAttribute('aria-pressed', this.vals[c.id] ? 'true' : 'false'); };
    this.ui.set(c.id, upd); upd();
    this.els.set(c.id, b);
    this.menuOn(b, c.id);
    return b;
  }

  /* ---- drag (IMPL-panels §5.4): a Binding read and written by a drag, the wheel and the keys */
  // snap() / restore(token): the two-finger rollback (the value and the preset name back)
  binding(c) {
    return {
      id: c.id, label: c.label, min: c.min, max: c.max, step: c.step, def: c.def, axis: c.orient === 'h' ? 'x' : 'y', invert: !!c.invert,
      get: () => this.vals[c.id], set: (v, ph) => this.set(c.id, v, ph), end: () => this.gestureEnd(c.id), fmt: v => fmt(c, v),
      snap: () => ({ iv: this.track, v0: this.vals[c.id], pre0: this.track.preset }),
      restore: k => {
        if (this.dead || this.track !== k.iv) return;
        if (this.vals[c.id] !== k.v0) this.set(c.id, k.v0);
        if (k.iv.preset !== k.pre0) { k.iv.preset = k.pre0; if (this.host.presetTouched) this.host.presetTouched(k.iv); } // (its device view's preset name)
      },
    };
  }
  tipB(el, b) { if (this.kit.tip) this.kit.tip(el, `${b.label}: ${b.fmt(b.get())}`); }
  untip(ms) { if (this.kit.untip) this.kit.untip(ms); }
  drag(el, c) { this.dragB(el, this.binding(c)); }
  // relative travel along b.axis (y: up = more; x: right = more; b.invert flips it) accumulated per move, Shift = fine, the
  // tip, double-click = b.def, the wheel (wheelIn / wheelStep with the canvas veto), arrow / Page / Home / End keys (b.invert
  // flips the arrows and Page keys too, so ArrowUp moves an inverted lever up as the pointer does: 7a review 2 #7), a
  // two-finger pointercancel → b.restore. o.tap: a press that ends where it began (≤ 4 px mouse, 10 px touch) without a
  // change — a hardware switch steps on it.
  dragB(el, b, o = {}) {
    const K = this.kit;
    let dragging = false, cancelled = false, menued = false; // menued: the long-press opened the menu — the held finger drags no more
    K.noMenu(el); K.hoverable(el);
    if (b.id && this.ctls.has(b.id)) this.menuOn(el, b.id, () => { menued = true; });
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.ctrlKey) return;
      e.preventDefault(); el.focus({ preventScroll: true });
      dragging = true; cancelled = false; menued = false;
      const X = b.axis === 'x', at = ev => (X ? ev.clientX : -ev.clientY) * (b.invert ? -1 : 1);
      let p = posB(b, b.get()), prev = at(e); // accumulate per move, so pressing Shift mid-drag doesn't rescale what was already dragged
      const range = b.step ? (b.max - b.min) / b.step : 100;
      const base = range > 40 ? 0.0045 : Math.max(0.0045, 1 / (range * 22));
      this.tipB(el, b);
      const k = b.snap(), v0 = b.get(), x0 = e.clientX, y0 = e.clientY, slop = e.pointerType === 'touch' ? 10 : 4;
      let far = false, moved = false;
      K.track(el, e, ev => {
        if (menued) return;
        if (!far && Math.hypot(ev.clientX - x0, ev.clientY - y0) > slop) far = true;
        const a = at(ev);
        p = clamp(p + (a - prev) * (ev.shiftKey ? base * 0.2 : base), 0, 1); prev = a;
        const v = fromPosB(b, p);
        if (v !== b.get()) { moved = true; b.set(v, 'move'); } // ((2b U2) a move's write: the host coalesces its reposts)
        this.tipB(el, b);
      }, () => {
        dragging = false; this.untip(400);
        if (moved && typeof b.end === 'function') b.end(); // (the gesture's end: the host posts what the moves held back)
        if (o.tap && !far && !cancelled && b.get() === v0) o.tap();
      }, () => { b.restore(k); if (moved && typeof b.end === 'function') b.end(); });
    });
    if (o.tap) el.addEventListener('pointercancel', () => { cancelled = true; }, true); // (a cancelled press is never a tap)
    el.addEventListener('dblclick', () => { b.set(b.def); this.tipB(el, b); this.untip(800); });
    el.addEventListener('wheel', e => {
      const w = K.wheelIn(el, e); if (!w) return;
      let v;
      if (b.step) { const n = K.wheelStep(el, w); if (!n) return; v = clamp(Math.round(b.get() / b.step + n) * b.step, b.min, b.max); v = +v.toFixed(4); }
      else v = fromPosB(b, posB(b, b.get()) + (w.notch ? -Math.sign(w.px) * 0.01 : clamp(-w.px * 0.001, -0.02, 0.02)) * (e.shiftKey ? 0.2 : 1));
      if (v !== b.get()) b.set(v);
      this.tipB(el, b); this.untip(700);
    }, { passive: false });
    el.addEventListener('keydown', e => {
      const sg = b.invert ? -1 : 1, stp = sg * (b.step ? b.step / ((b.max - b.min) || 1) : (e.shiftKey ? 0.002 : 0.02)), k = e.key;
      let v;
      if (k === 'ArrowUp' || k === 'ArrowRight') v = fromPosB(b, posB(b, b.get()) + stp);
      else if (k === 'ArrowDown' || k === 'ArrowLeft') v = fromPosB(b, posB(b, b.get()) - stp);
      else if (k === 'PageUp' || k === 'PageDown') v = fromPosB(b, posB(b, b.get()) + (k === 'PageUp' ? sg : -sg) * Math.max(Math.abs(stp), 0.1));
      else if (k === 'Home') v = b.min;
      else if (k === 'End') v = b.max;
      else if (o.tap && (k === 'Enter' || k === ' ')) { e.preventDefault(); o.tap(); return; }
      else return;
      e.preventDefault(); e.stopPropagation();
      b.set(v);
      this.tipB(el, b); this.untip(700);
    });
    el.addEventListener('pointerenter', () => { if (!dragging) this.tipB(el, b); });
    el.addEventListener('pointerleave', () => { if (!dragging) this.untip(); });
    el.addEventListener('blur', () => { if (!dragging) this.untip(); });
  }

  /* ---- (2b) halos (SPEC §7.11) and the mod menu (IMPL-2b §6.2) */
  // the wrap ([data-ctl] = the control's id: .ctl in the Simple layout, .hw-c on a hardware panel) of a control: the
  // widget's parent, else the root walked once (cached until the next render)
  wrapOf(id) {
    const el = this.els.get(id), p = el && el.parentNode;
    if (p && p.getAttribute && p.getAttribute('data-ctl') === id) return p;
    if (!this.wraps) {
      this.wraps = new Map();
      const kids = n => { const c = n.childNodes; return c && typeof c === 'object' && typeof c.length === 'number' ? c : Array.isArray(n.children) ? n.children : []; }; // (a test DOM without childNodes)
      const walk = n => { for (const ch of kids(n)) { if (ch.nodeType !== 1) continue; const k = ch.getAttribute && ch.getAttribute('data-ctl'); if (k && !this.wraps.has(k)) this.wraps.set(k, ch); walk(ch); } };
      walk(this.root);
    }
    return this.wraps.get(id) || null;
  }
  // the live value's normalised position (null: none, or within 0.002 of the base — wk's liveOf rule)
  liveN(id, c) {
    const e = this.eff ? this.eff[id] : undefined;
    if (!fin(e)) return null;
    const n = c.t === 'k' ? clamp(toPos(c, e), 0, 1) : c.t === 's' ? (c.opts.length > 1 ? clamp(e / (c.opts.length - 1), 0, 1) : 0) : e ? 1 : 0;
    const b = c.t === 'k' ? clamp(toPos(c, this.vals[id]), 0, 1) : c.t === 's' ? (c.opts.length > 1 ? clamp(this.vals[id] / (c.opts.length - 1), 0, 1) : 0) : this.vals[id] ? 1 : 0;
    return Math.abs(n - b) <= 0.002 ? null : n;
  }
  setMods(rowsByDest, eff) {
    if (this.dead) return;
    const R = rowsByDest && typeof rowsByDest === 'object' ? rowsByDest : {};
    this.eff = eff && typeof eff === 'object' ? eff : null;
    for (const id of [...this.halos.keys()]) if (!(Array.isArray(R[id]) && R[id].length)) this.clearHalo(id);
    for (const id of Object.keys(R)) {
      const rows = R[id];
      if (!Array.isArray(rows) || !rows.length || !this.ctls.has(id)) continue;
      this.halos.set(id, rows);
      this.paintHalo(id);
    }
  }
  setLive(eff) {
    if (this.dead) return;
    this.eff = eff && typeof eff === 'object' ? eff : null;
    for (const id of this.halos.keys()) this.paintLive(id); // ((P7) the dots alone at the monitor rate; the arcs on rows / base changes)
  }
  // the live dot / mark / badge ring of a painted control (nothing else written: the monitor path's whole cost)
  paintLive(id) {
    const H = this.hnodes.get(id), c = this.ctls.get(id);
    if (!H || !c || this.dead) return;
    const live = this.liveN(id, c);
    if (H.mode === 'knob') {
      if (live == null) { if (H.dot.getAttribute('display') !== 'none') H.dot.setAttribute('display', 'none'); }
      else { const q = dialPt(live, H.R, H.sw); H.dot.setAttribute('cx', q[0].toFixed(2)); H.dot.setAttribute('cy', q[1].toFixed(2)); if (H.dot.hasAttribute('display')) H.dot.removeAttribute('display'); }
    } else if (H.mode === 'slider') {
      if (live == null) H.mark.hidden = true;
      else { H.mark.hidden = false; const s = `calc(${(H.inv ? 1 - live : live).toFixed(4)} * (100% - ${H.cap}) + ${H.cap} / 2 - 1px)`; if (H.X) H.mark.style.left = s; else H.mark.style.bottom = s; }
    } else H.badge.classList.toggle('cp-live', live != null);
  }
  clearHalo(id) {
    const H = this.hnodes.get(id);
    if (H) { for (const n of H.nodes) if (n && n.parentNode) n.parentNode.removeChild(n); if (H.wrap && H.wrap.classList) H.wrap.classList.remove('cp-modded'); }
    this.hnodes.delete(id); this.halos.delete(id);
  }
  paintHalo(id) {
    const rows = this.halos.get(id), c = this.ctls.get(id);
    if (!rows || !c || this.dead) return;
    const el = this.els.get(id), wrap = this.wrapOf(id), d = this.doc;
    const arcs = haloRanges(c, this.vals[id], rows), cls = el && el.classList ? el.className : '';
    const mode = c.t === 'k' && /\bknob\b/.test(cls) ? 'knob' : c.t === 'k' && /\bslider\b/.test(cls) ? 'slider' : 'badge';
    let H = this.hnodes.get(id);
    if (H && H.mode !== mode) { this.hnodes.delete(id); for (const n of H.nodes) if (n.parentNode) n.parentNode.removeChild(n); H = null; }
    const color = k => MOD_COLOR[k] || '#9aa4b2';
    if (mode === 'knob') { // an arc ring between the skirt and the ticks, the live dot on it (paintLive)
      const sw = c.sweep > 0 ? +c.sweep : 270, R = 27;
      if (!H) {
        const svg = d.createElementNS(SVG, 'svg'); svg.setAttribute('class', 'cp-halo'); svg.setAttribute('viewBox', '0 0 64 64'); svg.setAttribute('aria-hidden', 'true');
        const dot = d.createElementNS(SVG, 'circle'); dot.setAttribute('class', 'cp-live'); dot.setAttribute('r', '2.4'); dot.setAttribute('display', 'none');
        svg.append(dot);
        el.append(svg);
        H = { mode, nodes: [svg], svg, dot, paths: [], wrap, R, sw };
        this.hnodes.set(id, H);
      }
      for (let i = 0; i < Math.max(arcs.length, H.paths.length); i++) {
        if (i >= arcs.length) { H.paths[i].setAttribute('display', 'none'); continue; }
        if (!H.paths[i]) { const p = d.createElementNS(SVG, 'path'); H.svg.insertBefore(p, H.dot); H.paths[i] = p; }
        const a = arcs[i], p = H.paths[i];
        p.setAttribute('class', 'cp-arc k-' + a.kind + (a.byp ? ' cp-byp' : ''));
        p.setAttribute('d', dialArc(a.from, a.to, R, sw)); p.setAttribute('stroke', color(a.kind));
        if (p.hasAttribute('display')) p.removeAttribute('display');
      }
    } else if (mode === 'slider') { // (U13) thin range bars beside the groove along the cap's travel (--cp-i: the i-th bar steps aside), a live mark
      const X = c.orient === 'h', inv = !!c.invert, cap = 'var(--cap-h, 14px)';
      if (!H) {
        const bars = [], mark = this.h('div', 'cp-livemk');
        el.append(mark);
        H = { mode, nodes: [mark], bars, mark, wrap, X, inv, cap };
        this.hnodes.set(id, H);
      }
      const pos = n => (inv ? 1 - n : n);
      for (let i = 0; i < Math.max(arcs.length, H.bars.length); i++) {
        if (i >= arcs.length) { H.bars[i].hidden = true; continue; }
        if (!H.bars[i]) { const b = this.h('div', 'cp-range'); b.style.setProperty('--cp-i', String(i)); el.insertBefore(b, H.mark); H.bars[i] = b; H.nodes.push(b); }
        const a = arcs[i], b = H.bars[i], lo = Math.min(pos(a.from), pos(a.to)), len = Math.abs(a.to - a.from);
        b.hidden = false; b.className = 'cp-range k-' + a.kind + (a.byp ? ' cp-byp' : ''); b.style.background = color(a.kind);
        const s = `calc(${lo.toFixed(4)} * (100% - ${cap}) + ${cap} / 2)`, l = `calc(${len.toFixed(4)} * (100% - ${cap}))`;
        if (X) { b.style.left = s; b.style.width = l; } else { b.style.bottom = s; b.style.height = l; }
      }
    } else { // a badge on the wrap: ∿ and the row count, the first source's colour
      if (!wrap) return;
      if (!H) { const b = this.h('span', 'cp-mbadge'); b.setAttribute('aria-hidden', 'true'); wrap.append(b); H = { mode, nodes: [b], badge: b, wrap }; this.hnodes.set(id, H); }
      const n = rows.length, t = '∿' + (n > 1 ? n : '');
      if (H.badge.textContent !== t) H.badge.textContent = t;
      H.badge.style.background = color(arcs.length ? arcs[0].kind : (rows[0].kind || srcKind(rows[0].src) || 'other'));
      H.badge.title = rows.map(r => r.label || r.src).join(', ');
    }
    this.paintLive(id);
    if (wrap && wrap.classList) wrap.classList.add('cp-modded');
  }
  // the press-and-hold / right-click menu source on a control (wk.menuSource: a 500 ms touch long-press ≤ 8 px, the
  // ContextMenu key / Shift+F10, a right-click — one contextmenu each); onOpen: the control's drag stops following
  menuOn(el, id, onOpen) {
    if (!el || !id || !el.addEventListener) return;
    wk.menuSource(el, { keys: true });
    el.addEventListener('contextmenu', e => {
      if (this.dead) return;
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
      if (onOpen) onOpen();
      this.modMenu(id, e.clientX, e.clientY, el);
    });
  }
  menuItems(id, el) {
    const H = this.host.modMenu || {}, tr = this.track, c = this.ctls.get(id), items = [];
    const rows = (call(H.rows, tr, id) || []).filter(r => r && typeof r === 'object' && r.id != null);
    const sep = () => { if (items.length && !items[items.length - 1].sep) items.push({ sep: true }); };
    for (const r of rows) items.push({ label: 'Bypass ' + (r.label || r.src || 'cable'), kind: 'bypass', checked: !!r.byp, action: () => call(H.bypass, tr, r.id, !r.byp) });
    for (const r of rows) items.push({ label: 'Disconnect ' + (r.label || r.src || 'cable'), kind: 'disconnect', action: () => call(H.disconnect, tr, r.id) });
    sep();
    const can = typeof H.connect === 'function' && call(H.canMod, tr, id) !== false;
    items.push({ label: 'Connect to…', kind: 'connect', disabled: !can, action: () => call(H.connect, tr, id, el) });
    sep();
    if (c) items.push({ label: 'Reset Control', kind: 'reset', action: () => this.set(id, c.def) });
    if (c && c.t === 'k') items.push({ label: 'Enter Value…', kind: 'enter', action: () => this.enterValue(id) });
    const extra = call(H.extra, tr, id, el);
    if (Array.isArray(extra) && extra.length) { sep(); items.push(...extra); }
    return items;
  }
  modMenu(id, x, y, el) {
    if (this.dead || !this.ctls.has(id)) return null;
    const items = this.menuItems(id, el);
    return wk.contextMenu(x, y, items, { anchor: el || null });
  }
  // Enter Value… on a knob: a typed number in the control's units (the knob-unit number prefilled — U12: not the display
  // text, whose "1.39 kHz" would read as 1.39 of 10), clamped and stepped
  enterValue(id) {
    const c = this.ctls.get(id);
    if (!c || c.t !== 'k') return;
    const t = wk.ask(c.label + ' (' + c.min + '…' + c.max + ')', String(r4(+this.vals[id])));
    if (t == null) return;
    const m = /-?\d+(?:[.,]\d+)?/.exec(String(t));
    if (!m) return;
    let v = clamp(parseFloat(m[0].replace(',', '.')), c.min, c.max);
    if (c.step) v = Math.round(v / c.step) * c.step;
    v = +v.toFixed(4);
    if (v !== this.vals[id]) this.set(id, v);
  }

  /* ---- the hardware panel's view of this instance (cv-panel render: IMPL-panels §4.4) */
  api() {
    const K = this.kit, H = this.host, tr = this.track, m = this.model;
    return {
      doc: this.doc, model: m,
      get: id => this.vals[id], set: (id, v) => this.set(id, v),
      watch: (id, fn) => { const prev = this.ui.get(id); this.ui.set(id, prev ? () => { prev(); fn(); } : fn); }, // (set, refresh, presets, undo)
      bind: c => this.binding(c), knob: c => this.knob(c), slider: (c, si) => this.slider(c, si), selector: c => this.selector(c), toggle: c => this.toggle(c),
      dragB: (el, b, o) => this.dragB(el, b, o), track: K.track, noMenu: K.noMenu, hoverable: K.hoverable, wheelIn: K.wheelIn, wheelStep: K.wheelStep,
      tap: (el, fn) => { // a mouse at the press, a finger on its tap's release; Enter / Space (a keyboard click: detail 0)
        K.pressOrTap(el, e => e.button === 0 && !e.ctrlKey, fn);
        el.addEventListener('click', e => { if (e.detail === 0) fn(e); });
        K.noMenu(el);
      },
      tip: (el, text) => { if (K.tip) K.tip(el, text); }, untip: ms => this.untip(ms),
      fmt: (c, v) => fmt(c, v),
      presetNo: () => (H.presetNo ? H.presetNo(tr) : null), // the factory number (1-based)
      seq: m.id === 'tb303' ? this.seqHw() : null,
      dx: m.id === 'dx7' && H.dx ? H.dx(tr) : null,
      perf: H.perf ? H.perf.api(tr) : null, // (1i, IMPL-1i §6.1: every model's keys and controllers; null: drawn, silent)
      drum: H.drum && m.family === 'drums' ? H.drum.api(tr) : null, // (7a, IMPL-7a §10.1: a drum machine's sequencer and pads — cv-drum drumHost; null: drawn, silent)
    };
  }
  // the TB-303's hardware step entry (IMPL-panels §6.2): a step cursor and PITCH / TIME mode per track (session only: the
  // host keeps them across rebuilds) over seqParts; onChange: the face's LEDs follow every pattern edit
  seqHw() {
    const st0 = this.host.seq.hw(this.track), fns = new Set(), changed = () => { for (const f of fns) f(); };
    const P = this.seqParts({ cursor: { get: () => st0.cur, set: i => { st0.cur = i; P.redraw(); changed(); } }, onChange: changed });
    return Object.assign(P, { state: st0, changed, onChange: fn => fns.add(fn) });
  }

  /* ---- the Simple panel's preset plate (the preset actions are the host's, shared with the chip and the ⋯ menu) */
  presetPlate() {
    const h = (a, b, t) => this.h(a, b, t), P = this.host.presets, tr = this.track, m = this.model;
    const w = h('div', 'presets'), sel = h('select'); sel.setAttribute('aria-label', 'Preset');
    const fill = () => {
      sel.innerHTML = '';
      const o0 = h('option', null, '— Presets —'); o0.value = ''; sel.append(o0);
      let grp = null, gname = '';
      for (const p of P.list(m)) {
        if (p.group !== gname) { grp = h('optgroup'); grp.label = p.group; gname = p.group; sel.append(grp); }
        const o = h('option', null, p.name); o.value = p.key; grp.append(o);
      }
    };
    fill();
    const del = h('button', null, 'Delete'); del.type = 'button'; del.title = 'Delete the selected saved sound';
    const delUI = () => { del.hidden = !/^u\d+$/.test(sel.value); };
    this.plateSync = key => { // the entry just loaded (key), else the first one with the track's preset name
      if (key && P.touch) P.touch(tr, key);
      fill();
      const p = P.cur(tr);
      sel.value = p ? p.key : ''; delUI();
    };
    sel.onchange = () => { P.load(tr, sel.value); delUI(); };
    const btn = (txt, title, fn) => { const b = h('button', null, txt); b.type = 'button'; if (title) b.title = title; b.onclick = fn; return b; };
    del.onclick = () => P.del(tr);
    w.append(btn('◀', 'Previous preset', () => P.step(tr, -1)), sel, btn('▶', 'Next preset', () => P.step(tr, 1)), btn('Save', null, () => P.save(tr)), del,
      btn('Init', 'Reset every control to its default', () => P.init(tr)));
    this.plateSync();
    return w;
  }

  /* ---- TB-303 sequencer (IMPL-panels §6.2): the Simple panel composes the parts as today (seqUI: same DOM, ids,
     classes); the Hardware panel puts RUN / TEMPO / CLEAR and the step keys on the face (cv-panel through api().seq) and
     the rest in its extras strip. o.cursor {get(), set(i)}: the hardware step cursor; o.onChange: after any pattern edit */
  seqStep(i) { this.stepEls.forEach((e, k) => e.classList.toggle('now', k === i)); }
  seqRunUI(on) {
    const b = this.seq && this.seq.run;
    if (b) { b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.lastChild.textContent = on ? 'Stop' : 'Run'; }
    if (!on) for (const e of this.stepEls) e.classList.remove('now');
    const u = this.ui.get('@seqrun'); if (u) u(); // (a hardware panel's RUN LED)
  }
  seqParts(o = {}) {
    const S = this.host.seq, K = this.kit, tr = this.track, h = (a, b, t) => this.h(a, b, t);
    this.stepEls.length = 0;
    const q = S.of(tr);
    const send = () => S.send(tr);
    const running = S.running(tr);
    const run = h('button', 'seqbtn run'); run.id = 'seqrun'; run.type = 'button';
    run.append(h('span', 'led'), h('span', null, running ? 'Stop' : 'Run'));
    run.setAttribute('aria-pressed', running ? 'true' : 'false');
    run.disabled = !!q.sync;
    run.onclick = () => S.toggle(tr, !S.running(tr));
    const sync = h('button', 'seqbtn'); sync.type = 'button';
    sync.title = 'Lock the pattern to the song transport: it plays whenever the song plays, at the song tempo';
    const syncDraw = () => { sync.textContent = q.sync ? '⛓ Synced to song' : 'Sync to song'; sync.classList.toggle('on', !!q.sync); run.disabled = !!q.sync; const u = this.ui.get('@seqrun'); if (u) u(); };
    syncDraw();
    sync.onclick = () => { q.sync = !q.sync; if (q.sync) S.toggle(tr, false); syncDraw(); send(); };
    const numCtl = (label, get, set, min, max, unit) => {
      const w = h('div', 'seqnum'); const box = h('div', 'num'); box.tabIndex = 0;
      box.setAttribute('role', 'slider'); box.setAttribute('aria-label', label);
      box.setAttribute('aria-valuemin', min); box.setAttribute('aria-valuemax', max);
      const upd = () => { box.textContent = get() + unit; box.setAttribute('aria-valuenow', get()); box.setAttribute('aria-valuetext', get() + unit); };
      const put = v => { v = clamp(Math.round(v), min, max); if (v !== get()) { set(v); upd(); send(); } };
      upd(); K.noMenu(box); K.hoverable(box);
      box.addEventListener('pointerdown', e => {
        if (e.button !== 0 || e.ctrlKey) return;
        e.preventDefault(); box.focus({ preventScroll: true });
        let acc = get(), yPrev = e.clientY; // accumulated, so Shift mid-drag only changes the rate from here on
        const v0 = get();
        K.track(box, e, ev => { acc = clamp(acc + (yPrev - ev.clientY) / (ev.shiftKey ? 8 : 2), min, max); yPrev = ev.clientY; put(acc); }, null, () => put(v0));
      });
      box.addEventListener('wheel', e => { const wv = K.wheelIn(box, e); if (wv) put(get() + K.wheelStep(box, wv)); }, { passive: false });
      box.addEventListener('keydown', e => {
        const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
        if (d == null && e.key !== 'Home' && e.key !== 'End') return;
        e.preventDefault(); e.stopPropagation();
        put(e.key === 'Home' ? min : e.key === 'End' ? max : get() + d);
      });
      w.append(box, h('label', null, label));
      return w;
    };
    const steps = h('div', 'steps');
    const redraw = [];
    const all = () => { redraw.forEach(f => f()); if (o.onChange) o.onChange(); };
    const clear = () => { q.pat = q.pat.map(() => st(0, 0, 0, 0, 1)); all(); send(); };
    const rnd = h('button', 'seqbtn', 'Randomise'); rnd.type = 'button'; rnd.onclick = () => { seqRandom(q); all(); send(); };
    const clr = h('button', 'seqbtn', 'Clear'); clr.type = 'button';
    clr.onclick = clear;
    const dflt = h('button', 'seqbtn', 'Demo'); dflt.type = 'button';
    dflt.onclick = () => { q.pat = JSON.parse(JSON.stringify(SEQ_DEF.pat)); all(); send(); };
    const toRoll = h('button', 'seqbtn', '→ Piano roll'); toRoll.type = 'button';
    toRoll.title = 'Write this pattern into the track as notes (1 bar at the playhead) so you can edit and arrange it';
    toRoll.onclick = () => S.toRoll(tr, q);
    const tempo = numCtl('Tempo', () => q.bpm, v => { q.bpm = v; }, 40, 220, ''), swing = numCtl('Swing', () => q.swing, v => { q.swing = v; }, 0, 50, '%');
    const hint = h('span', 'seqhint', 'Drag a note up/down · ACC = accent · SLD = slide into next step · click the LED to make a rest');
    q.pat.forEach((s, i) => {
      const col = h('div', 'step' + (i % 4 === 0 ? ' beat' : ''));
      const led = h('button', 'sled'); led.type = 'button'; led.title = 'Note / rest';
      const note = h('div', 'snote'); note.tabIndex = 0;
      note.setAttribute('role', 'slider'); note.setAttribute('aria-label', `Step ${i + 1} note`);
      note.setAttribute('aria-valuemin', 0); note.setAttribute('aria-valuemax', 12);
      const mk = (txt, key, val) => { const b = h('button', 'sbtn', txt); b.type = 'button'; b.onclick = () => { s[key] = s[key] === val ? 0 : val; draw(); send(); if (o.onChange) o.onChange(); }; return b; };
      const up = mk('UP', 'o', 1), dn = mk('DN', 'o', -1), acc = mk('ACC', 'a', 1), sld = mk('SLD', 's', 1);
      led.onclick = () => { s.g = s.g ? 0 : 1; draw(); send(); if (o.onChange) o.onChange(); };
      const num = h('span', 'snum', String(i + 1));
      const draw = () => {
        s = q.pat[i]; // (Clear / Demo / Randomise replace the pattern's steps)
        note.textContent = s.g ? SEQ_NOTES[s.n] : '—';
        note.setAttribute('aria-valuenow', s.n); note.setAttribute('aria-valuetext', s.g ? SEQ_NOTES[s.n] : 'rest');
        col.classList.toggle('rest', !s.g);
        up.classList.toggle('on', s.o === 1); dn.classList.toggle('on', s.o === -1);
        acc.classList.toggle('on', !!s.a); sld.classList.toggle('on', !!s.s);
        if (o.cursor) col.classList.toggle('cur', o.cursor.get() === i);
      };
      K.noMenu(note); K.hoverable(note);
      note.addEventListener('pointerdown', e => {
        if (e.button !== 0 || e.ctrlKey) return;
        e.preventDefault(); note.focus({ preventScroll: true });
        let a = s.n, yPrev = e.clientY;
        const n0 = s.n, g0 = s.g; // (a two-finger rollback puts back the pitch and a rest the drag turned into a note)
        K.track(note, e, ev => { a = clamp(a + (yPrev - ev.clientY) / 9, 0, 12); yPrev = ev.clientY; const v = Math.round(a); if (v !== s.n) { s.n = v; s.g = 1; draw(); send(); if (o.onChange) o.onChange(); } },
          null, () => { if (s.n !== n0 || s.g !== g0) { s.n = n0; s.g = g0; draw(); send(); if (o.onChange) o.onChange(); } });
      });
      const nudge = d => { const v = clamp(s.n + d, 0, 12); if (v !== s.n) { s.n = v; s.g = 1; draw(); send(); if (o.onChange) o.onChange(); } }; // a rest only becomes a note when the pitch actually moves
      note.addEventListener('wheel', e => { const wv = K.wheelIn(note, e); if (wv) nudge(K.wheelStep(note, wv)); }, { passive: false });
      note.addEventListener('keydown', e => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault(); e.stopPropagation();
        nudge(e.key === 'ArrowUp' ? 1 : -1);
      });
      if (o.cursor) { // the hardware cursor: a tap on the column's number or its background selects the step
        const pick = e => { if (e.target === col || e.target === num) { o.cursor.set(i); } };
        col.addEventListener('click', pick);
      }
      draw(); redraw.push(draw);
      col.append(num, led, note, up, dn, acc, sld);
      this.stepEls.push(col);
      steps.append(col);
    });
    this.seq = { q, send, run, sync, tempo, swing, rnd, demo: dflt, clear: clr, doClear: clear, toRoll, hint, steps, redraw: () => redraw.forEach(f => f()),
      toggle: on => S.toggle(tr, on), running: () => S.running(tr) };
    return this.seq;
  }
  seqUI() { // the Simple panel's sequencer (today's DOM)
    const P = this.seqParts(), sec = this.h('div', 'sec seq'), bar = this.h('div', 'seqbar');
    sec.append(this.h('h3', null, 'Pattern Sequencer'));
    bar.append(P.run, P.sync, P.tempo, P.swing, P.rnd, P.demo, P.clear, P.toRoll, P.hint);
    sec.append(bar, P.steps);
    return sec;
  }
}
