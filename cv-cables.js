// cv-cables.js — patch cables drawn in world coordinates (SPEC-canvas §2.9; contract: docs/canvas/IMPL-1b.md §4.5).
// Stage 1b: DERIVED, READ-ONLY audio cables (instrument → FX module → OUT; a Serum's route label). Two SVG layers in
// #world: `svg.cv-cables` under the modules (z-index 0: audio cables, mod-cable bodies) and `svg.cv-cable-ends` above
// them (z-index 10000: mod-cable ends and amount badges, empty until 2a). Stroke widths come from --ik (CSS), never
// from vector-effect. Owner: MODULES lane.
// Rules: plain ES module, no DOM at module top level, survives tests/main-sim.mjs's DOM stub; imports carry ?v=9.
//   cablePath(x1, y1, x2, y2)   the cubic of one cable (horizontal tangents)
//   deriveCables(track)         the stage-1b track's cables (pure)
//   routeLabel(s, fx)           a Serum's own-FX route label (pure: reads state only)
//   cablesOf(track)             (1e) a v2 track's cables: its wires (editable) + each Serum's own-FX route (read-only) (pure)
//   jackPort / portJack         (1e) canvas jack id ↔ model port ('i2/fx.out' ↔ 'i2.out' for a Serum; inner jacks: null)
//   createCables(worldEl, o)    the two layers; set / layout / highlight / select / live / destroy; (1e) editable cables:
//                               tap selects (a floating × Disconnect at the midpoint), long-press / right-click menu,
//                               Escape clears, Delete / Backspace disconnects
//   createCableDrag(world, o)   (1e) patching from a jack: live bézier, compatible jacks glow (cv-ok) / others dim with
//                               the reason (cv-no), 32 px snap, a module body's first compatible jack, re-patch by
//                               dragging a cable's end off its input, tap = "Connect to…" (also Enter / Space on a jack)
// Each SVG sits at its cables' bounding box (+ PAD) with overflow visible: hit testing outside an SVG's own box is not
// reliable across engines, and a box per layer keeps the painted area small. No viewBox: one user unit = one world px.
import { DESTS, DEST_INDEX } from './serum-core.js?v=9';
import * as wk from './wk.js?v=9';

/** Minimum horizontal tangent length of a cable's cubic (world px). */
export const TANGENT_MIN = 40;
/** Margin of a layer's box around its cables (world px): strokes, labels and the hit path's half width. */
export const PAD = 48;
/** (1e) A cable drag snaps to a compatible jack this close (screen px, SPEC §2.9 / §4.5); a press that moves less than
 * TAP_PX (screen px) before it lifts is a tap ("Connect to…" on a jack, select on a cable). */
export const SNAP_PX = 32, TAP_PX = 8;

const SVG = 'http://www.w3.org/2000/svg';
const fin = x => typeof x === 'number' && isFinite(x);
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const r2 = v => Math.round(v * 100) / 100;

/**
 * @typedef {{
 *   id: string, a: string, b: string, kind: 'audio' | 'mod',
 *   label?: string, dim?: boolean, readonly?: boolean, color?: string,
 *   wire?: string, from?: string, src?: string[], g?: number,
 * }} Cable  a / b: '<moduleId>.<jackId>' (e.g. 'i1.out', 'fx1.in', 'out.in'; a Serum: 'i1.out' → 'i1/fx.in');
 *   color (addition): the source instrument's colour (§2.9 table), CSS var --cc on the cable's group;
 *   (1e) wire: the track.wires id of an editable cable (= its id); from: the wire's model end a (a Serum's 'i2.out' is
 *   drawn from 'i2/fx.out'); src: the instruments it carries; dim: every one of them silent (powered off or not the
 *   soloed one) → .cv-off (grey); g: the wire's level when ≠ 1 (its label: dB)
 */

/** Cubic bézier with horizontal tangents d = max(TANGENT_MIN, |x2 − x1| / 2): 'M x1 y1 C x1+d y1, x2−d y2, x2 y2'.
 * @returns {string} an SVG path `d` */
export function cablePath(x1, y1, x2, y2) {
  const d = Math.max(TANGENT_MIN, Math.abs(x2 - x1) / 2);
  return `M ${r2(x1)} ${r2(y1)} C ${r2(x1 + d)} ${r2(y1)}, ${r2(x2 - d)} ${r2(y2)}, ${r2(x2)} ${r2(y2)}`;
}

/** The derived cables of a stage-1b track: classic i1.out → fx1.in → out.in; Serum i1.out → i1/fx.in (label: the
 * Serum's routes, routeLabel) → out.in. @param {{model: string, vals?: object, fx?: object}} track @returns {Cable[]} */
export function deriveCables(track) {
  const t = isObj(track) ? track : {}, color = typeof t.color === 'string' ? t.color : undefined;
  const sx = t.model === 'serum', fx = sx ? 'i1/fx' : 'fx1';
  const c = (a, b, label) => {
    const o = { id: a + '>' + b, a, b, kind: 'audio', readonly: true };
    if (label) o.label = label;
    if (color) o.color = color;
    return o;
  };
  return [c('i1.out', fx + '.in', sx ? routeLabel(isObj(t.vals) ? t.vals.s : null, t.fx) : ''), c(fx + '.out', 'out.in')];
}

const isSx = (D, id) => isObj(D[id]) && D[id].kind === 'synth' && D[id].model === 'serum';
const devOf = p => (typeof p === 'string' ? p.slice(0, p.lastIndexOf('.')) : '');
/** (1e) The model port behind a canvas jack of a v2 track: a Serum's own-FX out ('i2/fx.out') is the Serum's 'i2.out'; the
 * jacks inside a Serum (its 'out' → its own FX's 'in') are not patchable (null); a jack of an unknown device: null.
 * @param {{dev?: object}} track @param {string} jack @returns {string | null} */
export function jackPort(track, jack) {
  const D = isObj(track) && isObj(track.dev) ? track.dev : null;
  if (!D || typeof jack !== 'string' || jack.lastIndexOf('.') < 1) return null;
  const d = devOf(jack), j = jack.slice(d.length + 1), sl = d.indexOf('/');
  if (sl > 0) return d.slice(sl + 1) === 'fx' && isSx(D, d.slice(0, sl)) && j === 'out' ? d.slice(0, sl) + '.out' : null;
  if (!isObj(D[d])) return null;
  return isSx(D, d) ? null : jack;
}
/** (1e) The canvas jack a model port is drawn at (a Serum's 'i2.out' → 'i2/fx.out'). @returns {string} */
export function portJack(track, port) {
  const D = isObj(track) && isObj(track.dev) ? track.dev : null, d = devOf(port);
  return D && isSx(D, d) && port === d + '.out' ? d + '/fx.out' : port;
}
// the instruments that sound (cv-graph powered: on, and the soloed ones when any is)
function sounding(D) {
  const ins = Object.keys(D).filter(id => isObj(D[id]) && D[id].kind === 'synth' && D[id].on !== false);
  return new Set(ins.some(id => D[id].solo) ? ins.filter(id => D[id].solo) : ins);
}
const dB = g => (g > 0 ? (Math.round(20 * Math.log10(g) * 10) / 10).toFixed(1).replace('-', '−') + ' dB' : '−∞ dB');
/**
 * (1e) The audio cables of a v2 track (SPEC §2.9): one per track.wires entry (editable: id = the wire id; a Serum's wire
 * leaves from its own FX module, 'iN/fx.out'), plus the read-only 'iN.out → iN/fx.in' inside every Serum (route label).
 * Colour: the source instrument's (dev.color), else the track's. dim: every instrument the cable carries is silent
 * (powered off, or another instrument is soloed) — a panel's output carries what reaches the panel. A track without
 * dev (v1): deriveCables. Pure. @param {{dev?: object, wires?: Array, color?: string}} track @returns {Cable[]}
 */
export function cablesOf(track) {
  const t = isObj(track) ? track : {}, D = isObj(t.dev) ? t.dev : null;
  if (!D) return deriveCables(t);
  const tc = typeof t.color === 'string' ? t.color : undefined, on = sounding(D);
  const wires = (Array.isArray(t.wires) ? t.wires : []).filter(w => isObj(w) && typeof w.id === 'string' && typeof w.a === 'string' && typeof w.b === 'string');
  const srcs = new Map(); // device id → the instruments reaching its output (panels: their inputs; one level, panel → panel is stage 4)
  for (const id of Object.keys(D)) if (isObj(D[id]) && D[id].kind === 'synth') srcs.set(id, [id]);
  for (let pass = 0; pass < 4; pass++) {
    for (const w of wires) {
      const a = devOf(w.a), b = devOf(w.b);
      if (!isObj(D[b]) || D[b].kind === 'synth' || D[b].kind === 'out' || !srcs.has(a)) continue;
      const L = srcs.get(b) || [];
      for (const s of srcs.get(a)) if (!L.includes(s)) L.push(s);
      srcs.set(b, L);
    }
  }
  const colorOf = S => { const d = S.length === 1 && D[S[0]]; return (d && typeof d.color === 'string' && d.color) || tc; };
  const mk = (o, S) => {
    o.kind = 'audio'; o.src = S.slice();
    const c = colorOf(S);
    if (c) o.color = c;
    if (S.length && S.every(id => !on.has(id))) o.dim = true;
    return o;
  };
  const out = [];
  for (const id of Object.keys(D)) {
    if (!isSx(D, id)) continue;
    const lab = routeLabel(isObj(D[id].vals) ? D[id].vals.s : null, D[id].fx), o = { id: id + '.out>' + id + '/fx.in', a: id + '.out', b: id + '/fx.in', readonly: true };
    if (lab) o.label = lab;
    out.push(mk(o, [id]));
  }
  for (const w of wires) {
    const o = { id: w.id, wire: w.id, a: portJack(t, w.a), b: w.b, from: w.a };
    if (typeof w.g === 'number' && isFinite(w.g) && w.g !== 1) { o.g = w.g; o.label = dB(w.g); }
    out.push(mk(o, srcs.get(devOf(w.a)) || []));
  }
  return out;
}

// a Serum destination's base value (stored, else its default)
function base(s, id) {
  if (isObj(s.p) && fin(s.p[id])) return s.p[id];
  const i = DEST_INDEX[id];
  return i === undefined ? 0 : DESTS[i].def;
}
// a source / filter's route (sx-ui-mix routeOf: sources 0 Filter · 1 Main · 2 Direct · 3 None; filters 0 the other
// filter · 1 Main · 2 Direct · 3 None; a missing route: OSC A → Filter, the rest → Main)
function routeOf(o, dflt) { return isObj(o) && fin(o.route) ? Math.max(0, Math.min(3, Math.round(o.route))) : dflt; }
const STRIPS = [['a', s => (Array.isArray(s.osc) ? s.osc[0] : null), 0], ['b', s => (Array.isArray(s.osc) ? s.osc[1] : null), 1],
  ['c', s => (Array.isArray(s.osc) ? s.osc[2] : null), 1], ['s', s => s.sub, 1], ['n', s => s.noise, 1],
  ['f', s => (Array.isArray(s.filter) ? s.filter[0] : null), 1], ['f2', s => (Array.isArray(s.filter) ? s.filter[1] : null), 1]];

/** A Serum's own-FX route label: its non-empty racks and Direct, e.g. 'Main · Bus 1 · Direct' ('' for a classic
 * track). Reads the Serum state and its FX state only. Direct: a powered source or filter routed Direct, or a non-empty
 * bus routed Direct. @param {object|null} s @param {object|null} fx @returns {string} */
export function routeLabel(s, fx) {
  if (!isObj(s)) return '';
  const racks = isObj(fx) && fx.v >= 2 && Array.isArray(fx.racks) ? fx.racks : [];
  const full = k => isObj(racks[k]) && Array.isArray(racks[k].mods) && racks[k].mods.length > 0;
  let direct = false;
  for (const [P, get, dflt] of STRIPS) if (base(s, P + '.on') >= 0.5 && routeOf(get(s), dflt) === 2) { direct = true; break; }
  for (const k of [1, 2]) if (full(k) && fin(racks[k].route) && Math.round(racks[k].route) === 1) direct = true;
  const out = [];
  ['Main', 'Bus 1', 'Bus 2'].forEach((n, k) => { if (full(k)) out.push(n); });
  if (direct) out.push('Direct');
  return out.join(' · ');
}

/**
 * The two SVG layers in `worldEl` and their paths (a visible path plus a wider transparent hit path per cable;
 * stroke widths calc(… * var(--ik)) from the cv-module CSS section). Read-only cables take no pointer events (CSS:
 * [data-ro]), so a press on one pans the camera like the empty canvas around it.
 * (1e) Editable cables (no readonly): a tap selects (.cv-sel; o.onSelect(id | null)) and shows a floating × at its
 * midpoint (button.cv-cable-x in worldEl: o.onAction(id, 'disconnect')); a long-press (wk.menuSource) or right-click opens
 * a wk menu (Disconnect, then o.menu(id)'s items); while one is selected Escape clears it and Delete / Backspace
 * disconnects it (document keydown, capture phase: consumed). A cable's dim (its source silent) → .cv-off (grey).
 * live(spec) draws the cable being patched in the upper layer; hide(id, on) fades the one being re-patched (.cv-lift).
 * @param {HTMLElement} worldEl  #world
 * @param {{doc?: Document, onSelect?: (id: string | null) => void, onAction?: (id: string, action: string) => void,
 *   menu?: (id: string) => Array<object>}} [o]
 */
export function createCables(worldEl, o) {
  const O0 = o || {}, doc = O0.doc || (worldEl && worldEl.ownerDocument) || globalThis.document;
  const svg = (cls, z) => {
    const e = doc.createElementNS(SVG, 'svg');
    e.setAttribute('class', cls);
    e.setAttribute('aria-hidden', 'true');
    e.setAttribute('width', '0'); e.setAttribute('height', '0');
    e.style.zIndex = String(z);
    const g = doc.createElementNS(SVG, 'g');
    e.append(g);
    return { e, g, box: '' };
  };
  const U = svg('cv-cables', 0), O = svg('cv-cable-ends', 10000);
  if (worldEl) { worldEl.append(U.e); worldEl.append(O.e); }
  let list = [], ports = null, hl = null, sel = null, xb = null, press = null, keyOff = null, liveP = null, dead = false;
  const items = new Map(); // id → {c, g, vis, hit, lab, d, lx, ly, mx, my}
  const node = (tag, cls) => { const e = doc.createElementNS(SVG, tag); if (cls) e.setAttribute('class', cls); return e; };
  const listen = (t, type, fn, opt) => { t.addEventListener(type, fn, opt); return () => t.removeEventListener(type, fn, opt); };
  const editable = id => { const it = items.get(id); return !!it && !it.c.readonly; };
  function set(cables) {
    list = Array.isArray(cables) ? cables.filter(c => isObj(c) && typeof c.id === 'string') : [];
    const keep = new Set(list.map(c => c.id));
    for (const [id, it] of items) if (!keep.has(id)) { it.g.remove(); items.delete(id); }
    for (const c of list) {
      let it = items.get(c.id);
      if (!it) {
        const g = node('g', 'cv-cable-g'), hit = node('path', 'cv-cable-hit'), vis = node('path', 'cv-cable');
        g.append(hit, vis);
        U.g.append(g);
        it = { c, g, vis, hit, lab: null, d: '', lx: NaN, ly: NaN, mx: NaN, my: NaN };
        items.set(c.id, it);
      }
      it.c = c;
      it.g.setAttribute('data-cable', c.id);
      it.g.setAttribute('data-kind', c.kind || 'audio');
      if (c.readonly) it.g.setAttribute('data-ro', ''); else it.g.removeAttribute('data-ro');
      if (c.color) it.g.style.setProperty('--cc', c.color); else if (it.g.style.removeProperty) it.g.style.removeProperty('--cc');
      if (c.dim) it.g.classList.add('cv-off'); else it.g.classList.remove('cv-off');
      if (c.label) {
        if (!it.lab) { it.lab = node('text', 'cv-cable-lab'); it.lab.setAttribute('text-anchor', 'middle'); it.g.append(it.lab); }
        if (it.lab.textContent !== c.label) it.lab.textContent = c.label;
      } else if (it.lab) { it.lab.remove(); it.lab = null; }
    }
    paintHl();
    if (sel && !editable(sel)) select(null); // (disconnected, or now read-only)
    if (ports) layout(ports);
  }
  // ports: Map | object 'mod.jack' → {x, y} (world px)
  function layout(p) {
    ports = p || null;
    const at = k => (!ports ? null : typeof ports.get === 'function' ? ports.get(k) : ports[k]) || null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const it of items.values()) {
      const A = at(it.c.a), B = at(it.c.b), show = !!(A && B && fin(A.x) && fin(A.y) && fin(B.x) && fin(B.y));
      it.g.style.display = show ? '' : 'none';
      if (!show) { it.mx = NaN; continue; }
      const d = cablePath(A.x, A.y, B.x, B.y);
      if (d !== it.d) { it.d = d; it.vis.setAttribute('d', d); it.hit.setAttribute('d', d); }
      // the cubic's midpoint (t = ½) is the chord's midpoint for these symmetric tangents: the label sits above it, the × on it
      it.mx = r2((A.x + B.x) / 2); it.my = r2((A.y + B.y) / 2);
      if (it.lab) {
        const lx = it.mx, ly = r2(it.my - 10);
        if (lx !== it.lx || ly !== it.ly) { it.lx = lx; it.ly = ly; it.lab.setAttribute('x', lx); it.lab.setAttribute('y', ly); }
      }
      x0 = Math.min(x0, A.x, B.x); y0 = Math.min(y0, A.y, B.y); x1 = Math.max(x1, A.x, B.x); y1 = Math.max(y1, A.y, B.y);
    }
    place(U, x0, y0, x1, y1);
    place(O, x0, y0, x1, y1);
    placeX();
  }
  function place(L, x0, y0, x1, y1) {
    const ok = x1 >= x0 && y1 >= y0;
    const x = ok ? Math.floor(x0 - PAD) : 0, y = ok ? Math.floor(y0 - PAD) : 0;
    const w = ok ? Math.ceil(x1 + PAD) - x : 0, h = ok ? Math.ceil(y1 + PAD) - y : 0, key = x + ',' + y + ',' + w + ',' + h;
    if (key === L.box) return;
    L.box = key;
    L.e.style.left = x + 'px'; L.e.style.top = y + 'px';
    L.e.setAttribute('width', String(w)); L.e.setAttribute('height', String(h));
    L.g.setAttribute('transform', `translate(${-x} ${-y})`);
  }
  function paintHl() {
    for (const [id, it] of items) {
      const on = !!hl && hl.has(id);
      it.g.classList.toggle('cv-hl', on);
      it.g.classList.toggle('cv-dim', !!hl && !on);
    }
  }
  /* ---- (1e) selection, the floating ×, the menu */
  const act = (id, a) => { if (id && typeof O0.onAction === 'function') O0.onAction(id, a); };
  function placeX() {
    const it = sel ? items.get(sel) : null;
    if (!xb) return;
    const show = !!it && fin(it.mx) && fin(it.my);
    xb.hidden = !show;
    if (show) { xb.style.left = it.mx + 'px'; xb.style.top = it.my + 'px'; }
  }
  function select(id) {
    const want = id && editable(id) ? id : null;
    if (want === sel) return;
    if (sel && items.get(sel)) items.get(sel).g.classList.remove('cv-sel');
    sel = want;
    if (sel) {
      items.get(sel).g.classList.add('cv-sel');
      if (!xb && worldEl) {
        xb = doc.createElement('button');
        xb.className = 'cv-cable-x'; xb.type = 'button'; xb.textContent = '×';
        xb.setAttribute('aria-label', 'Disconnect cable'); xb.title = 'Disconnect (Delete)';
        xb.addEventListener('pointerdown', e => e.stopPropagation()); // (never the world's press)
        xb.addEventListener('click', e => { e.stopPropagation(); act(sel, 'disconnect'); });
        worldEl.append(xb);
      }
      if (!keyOff) {
        // a tap anywhere else (the canvas, a module, a tray) clears it: document capture phase, so nothing can swallow it
        let tp = null;
        const offK = listen(doc, 'keydown', onKey, true);
        const offD = listen(doc, 'pointerdown', e => { const t = e.target; tp = cableAt(t) || (xb && xb.contains(t)) ? null : { pid: e.pointerId, x: e.clientX, y: e.clientY }; }, true);
        const offU = listen(doc, 'pointerup', e => { const P = tp; tp = null; if (P && e.pointerId === P.pid && Math.hypot(e.clientX - P.x, e.clientY - P.y) <= TAP_PX) select(null); }, true);
        keyOff = () => { offK(); offD(); offU(); };
      }
    } else if (keyOff) { keyOff(); keyOff = null; }
    placeX();
    if (typeof O0.onSelect === 'function') O0.onSelect(sel);
  }
  const typing = t => !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') || t.isContentEditable === true);
  function onKey(e) { // while a cable is selected: Escape clears it, Delete / Backspace disconnects it (one thing per key)
    if (!sel) return;
    if (e.key === 'Escape') select(null);
    else if ((e.key === 'Delete' || e.key === 'Backspace') && !typing(e.target)) act(sel, 'disconnect');
    else return;
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
  }
  function openMenu(id, x, y) {
    const extra = typeof O0.menu === 'function' ? O0.menu(id) || [] : [];
    const L = [{ label: 'Disconnect', action: () => act(id, 'disconnect') }];
    if (extra.length) L.push({ sep: true }, ...extra);
    return wk.contextMenu(x, y, L);
  }
  const cableAt = t => {
    for (let n = t; n && n !== U.e && typeof n.getAttribute === 'function'; n = n.parentNode) {
      const id = n.getAttribute('data-cable');
      if (id != null) return editable(id) ? id : null;
    }
    return null;
  };
  // (U13) a press on a cable is the canvas's pan (cv-module isBackground: the world captures the pointer) unless it is a
  // tap: no capture here, its moves and lift followed on the document (capture phase: retargeted to the viewport too)
  const offs = [
    listen(U.e, 'pointerdown', e => {
      const id = cableAt(e.target);
      if (!id || (e.button != null && e.button !== 0)) return;
      press = { id, pid: e.pointerId, x: e.clientX, y: e.clientY, ctx: false, moved: false };
    }),
    listen(doc, 'pointermove', e => { if (press && e.pointerId === press.pid && Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_PX) press.moved = true; }, { capture: true, passive: true }),
    listen(doc, 'pointerup', e => {
      const P = press;
      if (!P || e.pointerId !== P.pid) return;
      press = null;
      if (!P.ctx && !P.moved && Math.hypot(e.clientX - P.x, e.clientY - P.y) <= TAP_PX) select(P.id);
    }, true),
    listen(doc, 'pointercancel', e => { if (press && e.pointerId === press.pid) press = null; }, true),
    listen(U.e, 'contextmenu', e => { // right-click, a touch long-press (wk.menuSource)
      if (press && press.moved) { if (e.preventDefault) e.preventDefault(); return; } // (a pan's long-press timer: no menu)
      const id = cableAt(e.target) || (press && press.id);
      if (!id) return;
      if (e.preventDefault) e.preventDefault();
      if (press) press.ctx = true;
      select(id);
      openMenu(id, e.clientX, e.clientY);
    }),
  ];
  const menuOff = wk.menuSource(U.e, { keys: false });
  function hide(id, on) { const it = items.get(id); if (it) it.g.classList.toggle('cv-lift', !!on); }
  // the cable being patched (world px; always out → in), drawn above the modules; null removes it
  function live(sp) {
    if (!sp || ![sp.x1, sp.y1, sp.x2, sp.y2].every(fin)) { if (liveP) { liveP.remove(); liveP = null; } return; }
    if (!liveP) { liveP = node('path', 'cv-cable cv-cable-live'); O.g.append(liveP); }
    liveP.setAttribute('d', cablePath(sp.x1, sp.y1, sp.x2, sp.y2));
    if (sp.color) liveP.style.setProperty('--cc', sp.color);
    liveP.setAttribute('class', 'cv-cable cv-cable-live' + (sp.snap ? ' cv-snap' : ''));
  }
  return {
    under: U.e, over: O.e,
    set,
    layout,
    highlight(ids) { hl = Array.isArray(ids) ? new Set(ids) : null; paintHl(); },
    /** (addition) the current cables and the box of the under layer 'x,y,w,h' — for tests and the world's fit */
    list: () => list.slice(),
    box: () => U.box,
    /** (1e) select an editable cable (null clears); the selected id; Escape for a caller's chain → was one selected */
    select, selected: () => sel,
    escape: () => { if (!sel) return false; select(null); return true; },
    openMenu, hide, live,
    destroy() {
      if (dead) return;
      dead = true;
      if (keyOff) keyOff();
      keyOff = null; sel = null;
      for (const f of offs) f();
      menuOff();
      if (xb) xb.remove();
      if (liveP) liveP.remove();
      U.e.remove(); O.e.remove(); items.clear(); list = []; ports = null;
    },
  };
}

/**
 * (1e) Patching from the jacks (SPEC §2.9, §4.1, §4.6): installed as the world's jack hook (cv-world setJackHook), so a
 * press on a [data-cv-jack] is never a pan and a second finger cancels it. Jacks are canvas ids ('i1.out', 'fx1.in',
 * 'i2/fx.out'); o.port maps one to its model port (cv-cables jackPort; null = not patchable: the press is not taken).
 *   A press on an out, or on a free in: a new cable; a press on an in that a cable arrives at: that cable's end lifts off
 *   (re-patch — its source stays); past TAP_PX (screen) the live bézier follows (edge auto-pan: world.dragPointer;
 *   re-projected on camera frames), compatible jacks get .cv-ok, the others .cv-no with the reason as their title, the
 *   fixed one .cv-from; within SNAP_PX of a compatible jack the end snaps to it (.cv-hot), over a module body its first
 *   compatible jack is the target. Release on a target: o.onConnect(outPort, inPort) / o.onRepatch(wireId, outPort,
 *   inPort) (callbacks get model ports); elsewhere nothing (a lifted end goes back: Disconnect is the cable's ×; near an
 *   incompatible jack: o.onRefuse(a, b, why)). A tap, Enter / Space or a right-click on a jack opens "Connect to…"
 *   (o.onDisconnect(wireId) adds Disconnect items). Escape, a pointercancel, a second finger (the world) cancel.
 * @param {object} world  cv-world World (toClient, toWorld, dragPointer, on, setJackHook, el)
 * @param {{
 *   ports: () => Map<string, {x: number, y: number}>,
 *   jacks?: () => Array<{id: string, el?: Element, dir?: 'in' | 'out', mod?: string, label?: string}>,
 *   rects?: () => Object<string, {x: number, y: number, w: number, h: number}>,
 *   port?: (jack: string) => string | null,
 *   wires?: () => Array<{wire: string, a: string, b: string}>,
 *   canConnect: (a: string, b: string) => {ok: boolean, why?: string},
 *   onConnect: (a: string, b: string) => void, onRepatch: (wireId: string, a: string, b: string) => void,
 *   onDisconnect?: (wireId: string) => void, onRefuse?: (a: string, b: string, why: string) => void,
 *   cables?: object, label?: (jack: string) => string, color?: string | (() => string), doc?: Document,
 * }} o
 * @returns {{press: (e: PointerEvent, jackEl: Element) => false | {cancel: () => void},
 *   menu: (jack: string, x?: number, y?: number) => object | null, cancel: () => void, active: () => boolean, destroy: () => void}}
 */
export function createCableDrag(world, o) {
  const W = world || null, Op = o || {};
  const doc = Op.doc || (W && W.el && W.el.ownerDocument) || globalThis.document;
  const own = Op.cables ? null : W && W.el ? createCables(W.el, { doc }) : null, C = Op.cables || own;
  const call = (f, ...a) => { if (typeof f !== 'function') return undefined; try { return f(...a); } catch (err) { console.error(err); return undefined; } };
  const listen = (t, type, fn, opt) => { t.addEventListener(type, fn, opt); return () => t.removeEventListener(type, fn, opt); };
  const portOf = j => (typeof Op.port === 'function' ? call(Op.port, j) || null : j || null);
  // (U12) a read-only jack (data-ro: inside a Serum) takes no press and opens no menu, whatever its model port; it stays a
  // drop target (its own FX input stands for the Serum: an output dropped there meets the own-FX refusal and its fix)
  const ro = el => !!el && typeof el.hasAttribute === 'function' && el.hasAttribute('data-ro');
  const dirOf = j => (/\.in$/.test(j) ? 'in' : /\.out$/.test(j) ? 'out' : null);
  const modOf = j => j.slice(0, j.lastIndexOf('.'));
  const at = (p, k) => (p && (typeof p.get === 'function' ? p.get(k) : p[k])) || null;
  const toClient = (x, y) => (W && typeof W.toClient === 'function' ? W.toClient(x, y) : { x, y });
  const toWorld = (x, y) => (W && typeof W.toWorld === 'function' ? W.toWorld(x, y) : { x, y });
  function jacks() { // [{id, el, dir, mod, label}]: o.jacks, else every [data-cv-jack] in the world
    let L = call(Op.jacks);
    if (!Array.isArray(L)) {
      L = [];
      const walk = n => { for (const c of n.children || []) { const id = c.getAttribute && c.getAttribute('data-cv-jack'); if (id) L.push({ id, el: c }); else walk(c); } };
      if (W && W.el) walk(W.el);
    }
    return L.filter(j => j && typeof j.id === 'string').map(j => ({ id: j.id, el: j.el || null, dir: j.dir || dirOf(j.id), mod: j.mod || modOf(j.id), label: j.label }));
  }
  const labelOf = (j, d) => {
    const L = call(Op.label, j);
    if (L) return String(L);
    if (d && d.label) return d.label;
    const el = d && d.el;
    return (el && (el.getAttribute('aria-label') || el.title)) || j;
  };
  const wires = () => { const L = Op.wires ? call(Op.wires) : C ? C.list() : []; return (Array.isArray(L) ? L : []).filter(c => isObj(c) && typeof c.wire === 'string' && !c.readonly); };
  const colorOf = () => (typeof Op.color === 'function' ? call(Op.color) : Op.color) || undefined;
  // can out-jack a feed in-jack b? → {ok, why} (model ports through o.canConnect)
  function check(a, b) {
    const pa = portOf(a), pb = portOf(b);
    if (!pa || !pb) return { ok: false, why: 'Inside its instrument: not patchable' };
    const r = call(Op.canConnect, pa, pb);
    if (r && typeof r === 'object') return { ok: !!r.ok, why: r.why ? String(r.why) : '' };
    return { ok: r !== false, why: '' };
  }
  let D = null, dead = false, unhook = null;
  /* ---- the press (the world's jack hook) */
  function press(e, el) {
    if (D || dead || !el || typeof el.getAttribute !== 'function' || ro(el) || (e.button != null && e.button !== 0)) return false;
    const j = el.getAttribute('data-cv-jack'), dir = j && dirOf(j);
    if (!dir || !portOf(j)) return false;
    const ws = dir === 'in' ? wires().filter(c => c.b === j) : [], w = ws.length ? ws[ws.length - 1] : null;
    D = { pid: e.pointerId, type: e.pointerType || 'mouse', el, grab: j, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, on: false,
      mode: w ? 'repatch' : 'new', wire: w ? w.wire : null, fixed: w ? w.a : j, want: w || dir === 'out' ? 'in' : 'out',
      lift: w ? [w.wire] : dir === 'out' ? wires().filter(c => c.a === j).map(c => c.wire) : [],
      marks: new Map(), tgt: null, body: false, near: null, offs: [], camOff: null };
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
    D.offs.push(listen(doc, 'pointermove', move, { passive: true }), listen(doc, 'pointerup', up), listen(doc, 'pointercancel', pcancel),
      listen(doc, 'keydown', key, true), listen(el, 'lostpointercapture', lost));
    return { cancel };
  }
  function move(e) {
    if (!D || e.pointerId !== D.pid) return;
    if (D.type === 'mouse' && e.buttons === 0) { up(e); return; } // (a swallowed pointerup)
    D.x = e.clientX; D.y = e.clientY;
    if (!D.on) {
      if (Math.hypot(D.x - D.x0, D.y - D.y0) <= (D.type === 'mouse' ? 4 : TAP_PX)) return;
      begin();
    }
    follow();
    if (W && typeof W.dragPointer === 'function') W.dragPointer({ x: D.x, y: D.y, pointerType: D.type });
  }
  function begin() {
    D.on = true;
    for (const J of jacks()) {
      if (!J.el) continue;
      let cls = 'cv-no', why = '';
      if (J.id === D.fixed) cls = 'cv-from';
      else if (J.dir !== D.want) why = D.want === 'in' ? 'Connect an output to an input' : 'Connect an input to an output';
      else if (D.mode === 'repatch' && J.id === D.grab) cls = 'cv-ok';
      else { const r = D.want === 'in' ? check(D.fixed, J.id) : check(J.id, D.fixed); if (r.ok) cls = 'cv-ok'; else why = r.why || 'Not compatible'; }
      D.marks.set(J.id, { J, cls, why, title: J.el.getAttribute('title') });
      J.el.classList.add(cls);
      if (cls === 'cv-no' && why) J.el.setAttribute('title', why);
    }
    if (W && W.el) W.el.setAttribute('data-cv-patching', '');
    if (C) for (const id of D.lift) C.hide(id, true);
    D.rects = call(Op.rects) || {}; // (world rects: read once — the camera moves, the modules do not)
    if (W && typeof W.on === 'function') D.camOff = W.on('camera', () => { if (D && D.on) follow(); }); // (an edge pan under a still pointer)
  }
  function follow() { // the target under the pointer (snap, else a module body's first compatible jack) and the live cable
    const P = call(Op.ports);
    let best = null, bd = Infinity, near = null, nd = Infinity;
    for (const [id, m] of D.marks) {
      if (m.cls === 'cv-from' || m.J.dir !== D.want) continue;
      const p = at(P, id);
      if (!p) continue;
      const c = toClient(p.x, p.y), d = Math.hypot(c.x - D.x, c.y - D.y);
      if (d > SNAP_PX) continue;
      if (m.cls === 'cv-ok') { if (d < bd) { bd = d; best = id; } } else if (d < nd) { nd = d; near = id; }
    }
    let body = false;
    if (!best) {
      const w = toWorld(D.x, D.y), R = D.rects;
      for (const k of Object.keys(R)) {
        const r = R[k];
        if (!r || !(w.x >= r.x && w.x <= r.x + r.w && w.y >= r.y && w.y <= r.y + r.h)) continue;
        for (const [id, m] of D.marks) if (m.cls === 'cv-ok' && m.J.mod === k && id !== D.grab) { best = id; body = true; break; }
        if (!best && !near && k !== modOf(D.fixed)) for (const [id, m] of D.marks) if (m.J.mod === k && m.J.dir === D.want && m.cls === 'cv-no') { near = id; break; }
        break;
      }
    }
    if (best !== D.tgt) {
      const o1 = D.tgt && D.marks.get(D.tgt), o2 = best && D.marks.get(best);
      if (o1) o1.J.el.classList.remove('cv-hot');
      if (o2) o2.J.el.classList.add('cv-hot');
      D.tgt = best;
    }
    D.body = body; D.near = best ? null : near;
    const F = at(P, D.fixed), T = best && !body ? at(P, best) : toWorld(D.x, D.y);
    if (!C || !F || !T) return;
    const a = D.want === 'in' ? F : T, b = D.want === 'in' ? T : F;
    C.live({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: colorOf(), snap: !!best });
  }
  function finish() { // every trace of the drag goes; D → null
    const d = D;
    if (!d) return null;
    D = null;
    for (const f of d.offs) f();
    if (d.camOff) d.camOff();
    for (const m of d.marks.values()) {
      m.J.el.classList.remove(m.cls, 'cv-hot');
      if (m.cls === 'cv-no' && m.why) { if (m.title == null) m.J.el.removeAttribute('title'); else m.J.el.setAttribute('title', m.title); }
    }
    if (d.on) {
      if (W && W.el) W.el.removeAttribute('data-cv-patching');
      if (C) { for (const id of d.lift) C.hide(id, false); C.live(null); }
      if (W && typeof W.dragPointer === 'function') W.dragPointer(null);
    }
    try { d.el.releasePointerCapture(d.pid); } catch (err) { /* released */ }
    return d;
  }
  function up(e) {
    if (!D || e.pointerId !== D.pid) return;
    D.x = e.clientX; D.y = e.clientY;
    if (!D.on) { // a tap: "Connect to…"
      const d = finish();
      if (Math.hypot(d.x - d.x0, d.y - d.y0) <= TAP_PX) menu(d.grab, e.clientX, e.clientY);
      return;
    }
    follow();
    const d = finish(), t = d.tgt;
    if (!t) {
      if (d.near) {
        const a = d.want === 'in' ? d.fixed : d.near, b = d.want === 'in' ? d.near : d.fixed;
        call(Op.onRefuse, portOf(a), portOf(b), check(a, b).why);
      }
      return;
    }
    if (d.mode === 'repatch') { if (t !== d.grab) call(Op.onRepatch, d.wire, portOf(d.fixed), portOf(t)); return; }
    if (d.want === 'in') call(Op.onConnect, portOf(d.fixed), portOf(t)); else call(Op.onConnect, portOf(t), portOf(d.fixed));
  }
  function pcancel(e) { if (D && e.pointerId === D.pid) finish(); } // (a second finger's flagged cancel, the browser's)
  function lost(e) { if (D && e.pointerId === D.pid && !D.on) finish(); } // (the jack went: a sync rebuilt its module)
  function key(e) {
    if (!D || e.key !== 'Escape') return;
    if (e.preventDefault) e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    finish();
  }
  function cancel() { finish(); }
  /* ---- "Connect to…": a tap, Enter / Space or a right-click on a jack */
  function menu(j, x, y) {
    const dir = dirOf(j || '');
    if (!dir || !portOf(j) || dead) return null;
    const L = jacks(), me = L.find(J => J.id === j) || { id: j, el: null };
    if (ro(me.el)) return null;
    const items = [{ label: 'Connect ' + labelOf(j, me) + ' to…', disabled: true }];
    let n = 0;
    for (const J of L) {
      if (J.dir === dir || J.id === j || !portOf(J.id)) continue;
      const r = dir === 'out' ? check(j, J.id) : check(J.id, j);
      if (!r.ok) continue;
      n++;
      items.push({ label: labelOf(J.id, J), action: () => { if (dir === 'out') call(Op.onConnect, portOf(j), portOf(J.id)); else call(Op.onConnect, portOf(J.id), portOf(j)); } });
    }
    if (!n) items.push({ label: 'Nothing to connect to', disabled: true });
    if (typeof Op.onDisconnect === 'function') {
      const ws = wires().filter(c => (dir === 'in' ? c.b === j : c.a === j));
      if (ws.length) items.push({ sep: true });
      for (const c of ws) {
        const other = dir === 'in' ? c.a : c.b, OJ = L.find(J => J.id === other);
        items.push({ label: 'Disconnect ' + labelOf(other, OJ), action: () => call(Op.onDisconnect, c.wire) });
      }
    }
    if (x == null || y == null) { const r = me.el && me.el.getBoundingClientRect ? me.el.getBoundingClientRect() : null; x = r ? r.left + r.width / 2 : 0; y = r ? r.bottom + 4 : 0; }
    return wk.contextMenu(x, y, items, me.el ? { anchor: me.el } : undefined);
  }
  const jackEl = t => { for (let n = t; n && typeof n.getAttribute === 'function'; n = n.parentNode) { if (n.getAttribute('data-cv-jack') != null) return n; if (n.getAttribute('data-cv-mod') != null) return null; } return null; };
  const offs = [];
  if (W && W.el) {
    offs.push(listen(W.el, 'keydown', e => {
      const je = (e.key === 'Enter' || e.key === ' ') && jackEl(e.target);
      if (!je || je !== e.target) return;
      if (e.preventDefault) e.preventDefault();
      menu(je.getAttribute('data-cv-jack'));
    }));
    offs.push(listen(W.el, 'contextmenu', e => {
      const je = jackEl(e.target);
      if (!je) return;
      if (e.preventDefault) e.preventDefault();
      menu(je.getAttribute('data-cv-jack'), e.clientX, e.clientY);
    }));
  }
  if (W && typeof W.setJackHook === 'function') unhook = W.setJackHook(press, cancel);
  else if (W && W.hooks) { W.hooks.jack = press; W.hooks.jackCancel = cancel; unhook = () => { if (W.hooks.jack === press) { W.hooks.jack = null; W.hooks.jackCancel = null; } }; }
  return {
    press, menu, cancel,
    active: () => !!(D && D.on),
    destroy() {
      if (dead) return;
      finish();
      dead = true;
      for (const f of offs) f();
      if (unhook) unhook();
      if (own) own.destroy();
    },
  };
}
