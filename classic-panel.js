// classic-panel.js — a classic instrument's panel as an instance (SPEC-canvas §10 stage 1c): today's renderPanel, control,
// widgets, drag, preset plate and TB-303 sequencer, de-globalised. Each ClassicPanel holds its own track, model, value
// updaters (`ui`) and sequencer / step elements, so two instances never share state; destroy() empties its root (the
// module body remounts by building a new one from the track, where every value lives).
//   new ClassicPanel(root, { track, model, layout, host })
//     layout   a cv-panel layout (the Hardware panel, IMPL-panels) or null (the Resizable panel: today's flowing sections)
//     host     the page's services (main.js classicHost): changed(track, id) after a value write (preset → Custom, the
//              patch, autosave, the DX7 chart), presetTouched(track) (the rollback put a preset name back), kit (track,
//              pressOrTap, noMenu, hoverable, wheelIn, wheelStep, tip, untip), presets (list / cur / load / step / save /
//              del / init, each given the track), chip(key) (the module chip follows a preset change), presetNo(track),
//              seq (of, send, running, toggle, toRoll, hw), dx(track), doc
//   .ui (id → updater), .hw (the rendered hardware panel or null), set(id, v), update(id), refresh(), syncPreset(key),
//   seqStep(i), seqRunUI(on), destroy()
// Every control carries data-ctl and data-dest = its models.js id (the module root carries data-dev: canvas modulation
// drops resolve [data-dest] inside [data-dev], SPEC §4.6). Plain ES module: no DOM at module top level.
import * as cvPanel from './cv-panel.js?v=9';

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
    this.render();
  }
  get vals() { return this.track.vals; }
  h(tag, cls, txt) { const e = this.doc.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  // a value write: the widget(s) of id, then the page (the preset becomes Custom, the patch, autosave)
  set(id, v) {
    if (this.dead) return;
    this.vals[id] = v;
    this.update(id);
    if (this.host.changed) this.host.changed(this.track, id);
  }
  update(id) { const u = this.ui.get(id); if (u) u(); }
  refresh() { for (const u of this.ui.values()) u(); }
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
  knob(c) { // c.sweep (a hardware panel's printed dial, deg; default 270)
    const el = this.h('div', 'knob'), sw = c.sweep > 0 ? +c.sweep : 270;
    el.tabIndex = 0; el.setAttribute('role', 'slider'); el.setAttribute('aria-label', c.label);
    el.innerHTML = `<svg viewBox="0 0 64 64"><g class="ticks">${TICKS}</g><circle class="skirt" cx="32" cy="32" r="25"/><g class="rot"><circle class="cap" cx="32" cy="32" r="17.5"/><circle class="shine" cx="32" cy="32" r="17.5"/><line class="ind" x1="32" y1="9" x2="32" y2="21"/></g></svg>`;
    const rot = typeof el.querySelector === 'function' ? el.querySelector('.rot') : null; // (null in a node test DOM)
    const upd = () => {
      if (rot) rot.setAttribute('transform', `rotate(${(-sw / 2 + sw * toPos(c, this.vals[c.id])).toFixed(2)} 32 32)`);
      this.ariaVal(el, c);
    };
    this.ui.set(c.id, upd); upd();
    this.drag(el, c);
    return el;
  }
  slider(c, si) { // c.orient 'h' (the cap moves along x), c.invert (minimum at the top / right), c.capColor, c.hw (a hardware panel's)
    const th = this.model.theme, el = this.h('div', 'slider');
    el.tabIndex = 0; el.setAttribute('role', 'slider'); el.setAttribute('aria-label', c.label);
    if (c.orient === 'h') el.setAttribute('data-orient', 'h');
    const ticks = this.h('div', 'sticks');
    for (let i = 0; i <= 10; i++) ticks.append(this.h('i'));
    const cap = this.h('div', 'cap');
    if (c.capColor) cap.style.background = c.capColor;
    else if (th.capColors && !c.hw) cap.style.background = th.capColors[si % th.capColors.length];
    el.append(this.h('div', 'groove'), ticks, cap);
    const upd = () => { // the cap's travel: the slot less the cap (--cap-h on a hardware panel, 14 px here)
      const p = toPos(c, this.vals[c.id]), q = (c.invert ? 1 - p : p).toFixed(4);
      if (c.orient === 'h') cap.style.left = `calc(${q} * (100% - var(--cap-h, 14px)))`; else cap.style.bottom = `calc(${q} * (100% - var(--cap-h, 14px)))`;
      this.ariaVal(el, c);
    };
    this.ui.set(c.id, upd); upd();
    this.drag(el, c);
    return el;
  }
  numBox(c) {
    const el = this.h('div', 'num');
    el.tabIndex = 0; el.setAttribute('role', 'slider'); el.setAttribute('aria-label', c.label);
    const upd = () => { el.textContent = fmt(c, this.vals[c.id]); this.ariaVal(el, c); };
    this.ui.set(c.id, upd); upd();
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
    return el;
  }
  toggle(c) {
    const b = this.h('button', 'tog'); b.type = 'button'; b.setAttribute('aria-label', c.label);
    b.append(this.h('span', 'led'));
    b.onclick = () => this.set(c.id, this.vals[c.id] ? 0 : 1);
    const upd = () => { b.classList.toggle('on', !!this.vals[c.id]); b.setAttribute('aria-pressed', this.vals[c.id] ? 'true' : 'false'); };
    this.ui.set(c.id, upd); upd();
    return b;
  }

  /* ---- drag (IMPL-panels §5.4): a Binding read and written by a drag, the wheel and the keys */
  // snap() / restore(token): the two-finger rollback (the value and the preset name back)
  binding(c) {
    return {
      id: c.id, label: c.label, min: c.min, max: c.max, step: c.step, def: c.def, axis: c.orient === 'h' ? 'x' : 'y', invert: !!c.invert,
      get: () => this.vals[c.id], set: v => this.set(c.id, v), fmt: v => fmt(c, v),
      snap: () => ({ tr: this.track, v0: this.vals[c.id], pre0: this.track.preset }),
      restore: k => {
        if (this.dead || this.track !== k.tr) return;
        if (this.vals[c.id] !== k.v0) this.set(c.id, k.v0);
        if (k.tr.preset !== k.pre0) { k.tr.preset = k.pre0; if (this.host.presetTouched) this.host.presetTouched(k.tr); }
      },
    };
  }
  tipB(el, b) { if (this.kit.tip) this.kit.tip(el, `${b.label}: ${b.fmt(b.get())}`); }
  untip(ms) { if (this.kit.untip) this.kit.untip(ms); }
  drag(el, c) { this.dragB(el, this.binding(c)); }
  // relative travel along b.axis (y: up = more; x: right = more; b.invert flips it) accumulated per move, Shift = fine, the
  // tip, double-click = b.def, the wheel (wheelIn / wheelStep with the canvas veto), arrow / Page / Home / End keys, a
  // two-finger pointercancel → b.restore. o.tap: a press that ends where it began (≤ 4 px mouse, 10 px touch) without a
  // change — a hardware switch steps on it.
  dragB(el, b, o = {}) {
    const K = this.kit;
    let dragging = false, cancelled = false;
    K.noMenu(el); K.hoverable(el);
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.ctrlKey) return;
      e.preventDefault(); el.focus({ preventScroll: true });
      dragging = true; cancelled = false;
      const X = b.axis === 'x', at = ev => (X ? ev.clientX : -ev.clientY) * (b.invert ? -1 : 1);
      let p = posB(b, b.get()), prev = at(e); // accumulate per move, so pressing Shift mid-drag doesn't rescale what was already dragged
      const range = b.step ? (b.max - b.min) / b.step : 100;
      const base = range > 40 ? 0.0045 : Math.max(0.0045, 1 / (range * 22));
      this.tipB(el, b);
      const k = b.snap(), v0 = b.get(), x0 = e.clientX, y0 = e.clientY, slop = e.pointerType === 'touch' ? 10 : 4;
      let far = false;
      K.track(el, e, ev => {
        if (!far && Math.hypot(ev.clientX - x0, ev.clientY - y0) > slop) far = true;
        const a = at(ev);
        p = clamp(p + (a - prev) * (ev.shiftKey ? base * 0.2 : base), 0, 1); prev = a;
        const v = fromPosB(b, p);
        if (v !== b.get()) b.set(v);
        this.tipB(el, b);
      }, () => {
        dragging = false; this.untip(400);
        if (o.tap && !far && !cancelled && b.get() === v0) o.tap();
      }, () => b.restore(k));
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
      const stp = b.step ? b.step / ((b.max - b.min) || 1) : (e.shiftKey ? 0.002 : 0.02), k = e.key;
      let v;
      if (k === 'ArrowUp' || k === 'ArrowRight') v = fromPosB(b, posB(b, b.get()) + stp);
      else if (k === 'ArrowDown' || k === 'ArrowLeft') v = fromPosB(b, posB(b, b.get()) - stp);
      else if (k === 'PageUp' || k === 'PageDown') v = fromPosB(b, posB(b, b.get()) + (k === 'PageUp' ? 1 : -1) * Math.max(stp, 0.1));
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
    };
  }
  // the TB-303's hardware step entry (IMPL-panels §6.2): a step cursor and PITCH / TIME mode per track (session only: the
  // host keeps them across rebuilds) over seqParts; onChange: the face's LEDs follow every pattern edit
  seqHw() {
    const st0 = this.host.seq.hw(this.track), fns = new Set(), changed = () => { for (const f of fns) f(); };
    const P = this.seqParts({ cursor: { get: () => st0.cur, set: i => { st0.cur = i; P.redraw(); changed(); } }, onChange: changed });
    return Object.assign(P, { state: st0, changed, onChange: fn => fns.add(fn) });
  }

  /* ---- the Resizable panel's preset plate (the preset actions are the host's, shared with the chip and the ⋯ menu) */
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

  /* ---- TB-303 sequencer (IMPL-panels §6.2): the Resizable panel composes the parts as today (seqUI: same DOM, ids,
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
  seqUI() { // the Resizable panel's sequencer (today's DOM)
    const P = this.seqParts(), sec = this.h('div', 'sec seq'), bar = this.h('div', 'seqbar');
    sec.append(this.h('h3', null, 'Pattern Sequencer'));
    bar.append(P.run, P.sync, P.tempo, P.swing, P.rnd, P.demo, P.clear, P.toRoll, P.hint);
    sec.append(bar, P.steps);
    return sec;
  }
}
