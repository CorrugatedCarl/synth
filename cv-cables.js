// cv-cables.js — patch cables drawn in world coordinates (SPEC-canvas §2.9; contract: docs/canvas/IMPL-1b.md §4.5).
// Stage 1b: DERIVED, READ-ONLY audio cables (instrument → FX module → OUT; a Serum's route label). Two SVG layers in
// #world: `svg.cv-cables` under the modules (z-index 0: audio cables, mod-cable bodies) and `svg.cv-cable-ends` above
// them (z-index 10000: mod-cable ends and amount badges, empty until 2a). Stroke widths come from --ik (CSS), never
// from vector-effect. Owner: MODULES lane.
// Rules: plain ES module, no DOM at module top level, survives tests/main-sim.mjs's DOM stub; imports carry ?v=9.
//   cablePath(x1, y1, x2, y2)   the cubic of one cable (horizontal tangents)
//   deriveCables(track)         the stage-1b track's cables (pure)
//   routeLabel(s, fx)           a Serum's own-FX route label (pure: reads state only)
//   createCables(worldEl, o)    the two layers; set / layout / highlight / destroy
// Each SVG sits at its cables' bounding box (+ PAD) with overflow visible: hit testing outside an SVG's own box is not
// reliable across engines, and a box per layer keeps the painted area small. No viewBox: one user unit = one world px.
import { DESTS, DEST_INDEX } from './serum-core.js?v=9';

/** Minimum horizontal tangent length of a cable's cubic (world px). */
export const TANGENT_MIN = 40;
/** Margin of a layer's box around its cables (world px): strokes, labels and the hit path's half width. */
export const PAD = 48;

const SVG = 'http://www.w3.org/2000/svg';
const fin = x => typeof x === 'number' && isFinite(x);
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const r2 = v => Math.round(v * 100) / 100;

/**
 * @typedef {{
 *   id: string, a: string, b: string, kind: 'audio' | 'mod',
 *   label?: string, dim?: boolean, readonly?: boolean, color?: string,
 * }} Cable  a / b: '<moduleId>.<jackId>' (e.g. 'i1.out', 'fx1.in', 'out.in'; a Serum: 'i1.out' → 'i1/fx.in');
 *   color (addition): the source instrument's colour (§2.9 table), CSS var --cc on the cable's group
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
 * @param {HTMLElement} worldEl  #world
 * @param {{doc?: Document}} [o]
 */
export function createCables(worldEl, o) {
  const doc = (o && o.doc) || (worldEl && worldEl.ownerDocument) || globalThis.document;
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
  let list = [], ports = null, hl = null;
  const items = new Map(); // id → {c, g, vis, hit, lab, d, lx, ly}
  const node = (tag, cls) => { const e = doc.createElementNS(SVG, tag); if (cls) e.setAttribute('class', cls); return e; };
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
        it = { c, g, vis, hit, lab: null, d: '', lx: NaN, ly: NaN };
        items.set(c.id, it);
      }
      it.c = c;
      it.g.setAttribute('data-cable', c.id);
      it.g.setAttribute('data-kind', c.kind || 'audio');
      if (c.readonly) it.g.setAttribute('data-ro', ''); else it.g.removeAttribute('data-ro');
      if (c.color) it.g.style.setProperty('--cc', c.color); else if (it.g.style.removeProperty) it.g.style.removeProperty('--cc');
      if (c.label) {
        if (!it.lab) { it.lab = node('text', 'cv-cable-lab'); it.lab.setAttribute('text-anchor', 'middle'); it.g.append(it.lab); }
        if (it.lab.textContent !== c.label) it.lab.textContent = c.label;
      } else if (it.lab) { it.lab.remove(); it.lab = null; }
    }
    paintHl();
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
      if (!show) continue;
      const d = cablePath(A.x, A.y, B.x, B.y);
      if (d !== it.d) { it.d = d; it.vis.setAttribute('d', d); it.hit.setAttribute('d', d); }
      if (it.lab) {
        // the cubic's midpoint (t = ½) is the chord's midpoint for these symmetric tangents; the label sits above it
        const lx = r2((A.x + B.x) / 2), ly = r2((A.y + B.y) / 2 - 10);
        if (lx !== it.lx || ly !== it.ly) { it.lx = lx; it.ly = ly; it.lab.setAttribute('x', lx); it.lab.setAttribute('y', ly); }
      }
      x0 = Math.min(x0, A.x, B.x); y0 = Math.min(y0, A.y, B.y); x1 = Math.max(x1, A.x, B.x); y1 = Math.max(y1, A.y, B.y);
    }
    place(U, x0, y0, x1, y1);
    place(O, x0, y0, x1, y1);
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
  return {
    under: U.e, over: O.e,
    set,
    layout,
    highlight(ids) { hl = Array.isArray(ids) ? new Set(ids) : null; paintHl(); },
    /** (addition) the current cables and the box of the under layer 'x,y,w,h' — for tests and the world's fit */
    list: () => list.slice(),
    box: () => U.box,
    destroy() { U.e.remove(); O.e.remove(); items.clear(); list = []; ports = null; },
  };
}
