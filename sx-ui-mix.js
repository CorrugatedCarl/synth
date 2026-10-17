// sx-ui-mix.js — the MIX page of the Serum-style instrument (SPEC-serum2 §1, §6.12, §11.14, §13.4; inv B1, B13).
// Owner U3.
//
// Strips, left → right: A, B, C, SUB, NOISE, FILTER 1, FILTER 2, BUS 1, BUS 2, MAIN, DIRECT.
//   A / B / C / SUB / NOISE   header (power; name = the kit's module menu and drag handle: dropped on another module
//                             label of the same kind it swaps the two (incl. mods), Alt copies, Shift-Alt copies with
//                             mods — kit.panel, as on the OSC page), route menu (Filter · Main · Direct · None), Filter:
//                             balance knob (k.fbal, F1 ← → F2); Main / Direct: ENV toggle; BUS 1 / BUS 2 sends, PAN,
//                             vertical level fader with a peak meter
//   FILTER 1 / 2              header (power, type), mini response display (drag: cutoff x, resonance y), route menu
//                             (other filter · Main · Direct · None) + ENV toggle, BUS 1 / 2, PAN, MIX, level fader
//   BUS 1 / 2                 route menu (Main · Direct · other bus), FX bypass (red, fx.racks[k].byp; Alt-click
//                             toggles every module of that bus), level fader (g.bus1v / g.bus2v)
//   MAIN                      Main FX bypass (red), master fader (g.master)
//   DIRECT                    direct fader (g.direct)
// A switched-off module shows a collapsed strip (header only); a tap on it switches the module on everywhere. Meters read
// the snapshot's `mix` (Float32Array(11): channel peaks in dBFS, order A, B, C, Noise, Sub, F1, F2, Bus1, Bus2, Main,
// Direct, §6.20). Routing loops are resolved by the most recent choice: a filter routed into the other filter while that
// one feeds it sends the other one to Main (§2.2.5); likewise the two buses (§2.5).
//
// The page never sees the main.js host's edit path: it receives serum-ui's binding kit (makeKit, §11.14 — the `host`
// argument of the MixerPage(root, host) signature is that kit): destination widgets (kit.knob / menu / toggle) with halos,
// drag-to-modulate drops, knob menus, MIDI learn and locks; Serum-state edits through kit.edit, FX-state edits (bus
// routes, rack bypass) through kit.editFx. A v1 (Phase-1) FX state has no buses and no rack bypass: the first such edit
// converts it to v2 in place (§2.6.3 migrateFx1 with the Serum state as refs, as the FX page does) when the main.js host
// keeps v2 states (kit.host.v2Fx: true or a function); without that flag those controls are disabled with a notice (a
// host that drops v2 states would lose the whole rack). Alt-click on MAIN's bypass switches the modules of a v1 state in
// the v1 state itself (no conversion needed).
// The SUB fader's dB scale follows the sub level law of the mode: n in S1 mode, n² in S2 mode (§6.11.1).
//
//   new MixerPage(root, kit)      builds the strips into root (.el = the mixer row); destroy()
//   channelStrips(s, fx)          pure: the strip descriptors (ids, route, visibility rules) for a state
//   routeMenuItems(s, ch, fx?)    pure: route menu items [{v, label, checked}] of strip key `ch` (fx needed for buses)
//
// Browser ES module: nothing touches document / window / storage at module top level (node imports it for tests).
import * as core from './serum-core.js?v=8';
import * as wk from './wk.js?v=8';

/* ================================================================ small helpers */

const fin = x => typeof x === 'number' && isFinite(x);
const arr = x => (Array.isArray(x) ? x : []);
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const clamp01 = x => (x > 0 ? (x < 1 ? x : 1) : 0);
const isV2Fx = fx => isObj(fx) && fin(fx.v) && fx.v >= 2 && Array.isArray(fx.racks);
const warned = new Set();
const warnOnce = (k, ...a) => { if (!warned.has(k)) { warned.add(k); console.warn(...a); } };
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
const destOf = id => { const i = core.DEST_INDEX[id]; return i === undefined ? null : core.DESTS[i]; };

/* ================================================================ strip table */

// key, label, kind ('src' | 'filt' | 'bus' | 'main' | 'direct'), module (MODULE_FIELDS key), destination prefix,
// structured path of route / env, snapshot `mix` index, channel colour token
const STRIPS = Object.freeze([
  { key: 'a', label: 'OSC A', kind: 'src', module: 'oscA', p: 'a', path: ['osc', 0], meter: 0, color: '--sx-osc-a' },
  { key: 'b', label: 'OSC B', kind: 'src', module: 'oscB', p: 'b', path: ['osc', 1], meter: 1, color: '--sx-osc-b' },
  { key: 'c', label: 'OSC C', kind: 'src', module: 'oscC', p: 'c', path: ['osc', 2], meter: 2, color: '--sx-osc-c' },
  { key: 'sub', label: 'SUB', kind: 'src', module: 'sub', p: 's', path: ['sub'], meter: 4, color: '--sx-sub' },
  { key: 'noise', label: 'NOISE', kind: 'src', module: 'noise', p: 'n', path: ['noise'], meter: 3, color: '--sx-noise' },
  { key: 'f1', label: 'FILTER 1', kind: 'filt', module: 'filter', p: 'f', path: ['filter', 0], meter: 5, color: '--sx-f1' },
  { key: 'f2', label: 'FILTER 2', kind: 'filt', module: 'filter2', p: 'f2', path: ['filter', 1], meter: 6, color: '--sx-f2' },
  { key: 'bus1', label: 'BUS 1', kind: 'bus', rack: 1, level: 'g.bus1v', meter: 7, color: '--sx-bus1' },
  { key: 'bus2', label: 'BUS 2', kind: 'bus', rack: 2, level: 'g.bus2v', meter: 8, color: '--sx-bus2' },
  { key: 'main', label: 'MAIN', kind: 'main', rack: 0, level: 'g.master', meter: 9, color: '--sx-accent' },
  { key: 'direct', label: 'DIRECT', kind: 'direct', level: 'g.direct', meter: 10, color: '--sx-mute' },
].map(Object.freeze));
const STRIP = Object.fromEntries(STRIPS.map(x => [x.key, x]));
const SRC_ROUTES = ['Filter', 'Main', 'Direct', 'None'];
const routeOf = (s, ch) => {
  const T = STRIP[ch];
  if (!T || !T.path || !isObj(s)) return 0;
  const o = T.path.length === 2 ? arr(s[T.path[0]])[T.path[1]] : s[T.path[0]];
  return isObj(o) && fin(o.route) ? clamp(Math.round(o.route), 0, 3) : (T.kind === 'src' && T.key === 'a' ? 0 : 1);
};
const envOf = (s, ch) => {
  const T = STRIP[ch];
  if (!T || !T.path || !isObj(s)) return 1;
  const o = T.path.length === 2 ? arr(s[T.path[0]])[T.path[1]] : s[T.path[0]];
  return isObj(o) && o.env !== undefined ? (o.env ? 1 : 0) : 1;
};
// a Phase-1 (v1) FX state has no buses and no rack bypass: without a host that keeps v2 states those controls say so
const V1_NOTE = 'The FX buses need the Serum 2 FX rack, which this track does not support yet';
const V1_MAIN = 'Main FX bypass needs the Serum 2 FX rack, which this track does not support yet (Alt-click still switches the Main modules)';
const busRoute = (fx, k) => (isV2Fx(fx) && isObj(fx.racks[k]) && fin(fx.racks[k].route) ? clamp(Math.round(fx.racks[k].route), 0, 2) : 0);
const s1Of = s => !!(isObj(s) && isObj(s.global) && s.global.s1);
const baseOn = (s, id) => {
  const d = destOf(id);
  const v = isObj(s) && isObj(s.p) && fin(s.p[id]) ? s.p[id] : d ? d.def : 0;
  return v >= 0.5;
};

/* ================================================================ pure helpers (§11.14, §15.12) */

// Strip descriptors in display order for state s (and FX state fx): {key, label, kind, module, color, meter (snapshot
// `mix` index), power (destination id | null), on, collapsed, level, pan, fbal, mix, bus: [id, id], type (filter type
// destination: Filter 1 in S1 mode = f.type, else f.type2), cutoff, res, route, routeLabel, env, showBal (route Filter),
// showEnv (route Main / Direct), rack (bus / main racks), byp (rack FX bypass), fxV2 (bus controls available)}.
export function channelStrips(s, fx) {
  const v2 = isV2Fx(fx), out = [];
  for (const T of STRIPS) {
    const o = { key: T.key, label: T.label, kind: T.kind, module: T.module || null, color: T.color, meter: T.meter, power: null, on: true, collapsed: false,
      level: null, pan: null, fbal: null, mix: null, bus: [], type: null, cutoff: null, res: null, route: null, routeLabel: '', env: null, showBal: false,
      showEnv: false, rack: T.rack === undefined ? -1 : T.rack, byp: 0, fxV2: v2 };
    if (T.kind === 'src' || T.kind === 'filt') {
      const P = T.p;
      o.power = P + '.on';
      o.on = baseOn(s, o.power);
      o.collapsed = !o.on;
      o.level = P + '.level';
      o.pan = P + '.pan';
      o.bus = [P + '.bus1', P + '.bus2'];
      o.route = routeOf(s, T.key);
      o.env = envOf(s, T.key);
      if (T.kind === 'src') {
        o.fbal = P + '.fbal';
        o.routeLabel = SRC_ROUTES[o.route];
        o.showBal = o.route === 0;
        o.showEnv = o.route === 1 || o.route === 2;
      } else {
        o.mix = P + '.mix';
        o.cutoff = P + '.cutoff';
        o.res = P + '.res';
        o.type = T.key === 'f2' ? 'f2.type' : s1Of(s) ? 'f.type' : 'f.type2';
        o.routeLabel = o.route === 0 ? (T.key === 'f1' ? 'Filter 2' : 'Filter 1') : SRC_ROUTES[o.route];
        o.showEnv = o.route === 1 || o.route === 2;
      }
    } else {
      o.level = T.level;
      if (T.kind === 'bus') {
        o.route = busRoute(fx, T.rack);
        o.routeLabel = ['Main', 'Direct', T.rack === 1 ? 'Bus 2' : 'Bus 1'][o.route];
      }
      if (T.kind === 'bus' || T.kind === 'main') o.byp = v2 && isObj(fx.racks[T.rack]) && fx.racks[T.rack].byp ? 1 : 0;
    }
    out.push(o);
  }
  return out;
}

// Route menu items of strip `ch` ('a' 'b' 'c' 'sub' 'noise' 'f1' 'f2' 'bus1' 'bus2'): [{v, label, checked}] with v the
// route enum value (sources: 0 Filter · 1 Main · 2 Direct · 3 None; filters: 0 the other filter · 1 Main · 2 Direct ·
// 3 None; buses: 0 Main · 1 Direct · 2 the other bus). [] for strips without a route (MAIN, DIRECT, unknown keys).
export function routeMenuItems(s, ch, fx) {
  const T = STRIP[ch];
  if (!T) return [];
  if (T.kind === 'src') { const r = routeOf(s, ch); return SRC_ROUTES.map((label, v) => ({ v, label, checked: v === r })); }
  if (T.kind === 'filt') {
    const r = routeOf(s, ch), other = ch === 'f1' ? 'Filter 2' : 'Filter 1';
    return [other, 'Main', 'Direct', 'None'].map((label, v) => ({ v, label, checked: v === r }));
  }
  if (T.kind === 'bus') {
    const r = busRoute(fx, T.rack);
    return ['Main', 'Direct', T.rack === 1 ? 'Bus 2' : 'Bus 1'].map((label, v) => ({ v, label, checked: v === r }));
  }
  return [];
}

// level of a fader destination in dB at n (its law's gain; −Infinity at silence). The sub level's law is linear (the
// S1-mode gain n); S2 mode applies n² (§6.11.1, §6.21 item 2): s2 = true gives that scale
function dbOf(id, n, s2) {
  const x = clamp01(n);
  if (id === 's.level' && s2) return x > 0 ? 40 * Math.log10(x) : -Infinity;
  const v = core.lawValue(id, x);
  return v > 0 ? 20 * Math.log10(v) : -Infinity;
}

/* ================================================================ styles */

const CSS = `
.sxm-mixer { display: flex; align-items: stretch; gap: 6px; min-width: 0; padding-bottom: 6px; overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x proximity; }
.sxm-strip { flex: 0 0 76px; display: flex; flex-direction: column; min-width: 0; padding: 4px 4px 6px; scroll-snap-align: start; border-top: 3px solid var(--sxm-c, var(--sx-line, #2a333d)); }
.sxm-strip > .sx-ptitle { flex-wrap: wrap; justify-content: center; gap: 2px 4px; min-height: 0; }
.sxm-strip .sx-tname { font-size: 10px; letter-spacing: 0.06em; }
.sxm-strip > .sx-pbody { display: flex; flex: 1 1 auto; flex-direction: column; align-items: center; gap: 4px; }
.sxm-strip .wk-menu { width: 100%; }
.sxm-strip .wk-menu > .wk-lab { display: none; }
.sxm-strip .wk-menu .wk-arr { display: none; }
.sxm-strip .wk-mbtn { width: 100%; min-width: 0; padding: 2px 3px; font-size: 10px; }
.sxm-row { display: flex; justify-content: center; gap: 2px; width: 100%; }
.sxm-strip .wk-knob { --wk-d: 26px; }
.sxm-strip .wk-fader { flex: 1 1 auto; min-height: 140px; }
.sxm-off { flex-basis: 34px; cursor: pointer; }
.sxm-off > .sx-pbody { display: none; }
.sxm-off > .sx-ptitle { flex-direction: column; }
.sxm-off .sx-tname { writing-mode: vertical-rl; transform: rotate(180deg); }
.sxm-off .sxm-type { display: none; }
.sxm-gap { flex: 0 0 4px; }
.sxm-env, .sxm-byp { min-height: 22px; padding: 1px 6px; font-size: 10px; }
.sxm-byp.wk-on { color: #fff; background: var(--sx-warn, #ff6a4a); border-color: var(--sx-warn, #ff6a4a); }
.sxm-fdisp { height: 44px; cursor: crosshair; }
.sxm-drop { box-shadow: 0 0 0 2px var(--sx-accent, #4fb3ff); }
.sxm-hide { display: none !important; }
`;
// §13.1 touch rules: under `@media (pointer: coarse)` and again under `.wk-touch` (wk marks <html> at the first touch: an
// iPad with a trackpad reports a fine pointer). ENV / FX BYP are wk toggles: wk's touch rules give them a 44 px hit box
// (HIT44 ::before); the strip only grows them visually
const TOUCH = [
  ['.sxm-strip', 'flex-basis: 88px;'],
  ['.sxm-off', 'flex-basis: 44px;'],
  ['.sxm-env, .sxm-byp', 'min-height: 34px;'],
];
function touchCSS() {
  const pre = sel => sel.split(',').map(x => '.wk-touch ' + x.trim()).join(', ');
  return '@media (pointer: coarse) {\n' + TOUCH.map(([sel, b]) => '  ' + sel + ' { ' + b + ' }').join('\n') + '\n}\n'
    + TOUCH.map(([sel, b]) => pre(sel) + ' { ' + b + ' }').join('\n') + '\n';
}
function injectMixStyles(d) {
  if (!d || !d.head || (typeof d.getElementById === 'function' && d.getElementById('sxm-css'))) return;
  const st = d.createElement('style');
  st.id = 'sxm-css';
  st.textContent = CSS + touchCSS();
  d.head.appendChild(st);
}

/* ================================================================ MixerPage */

// Mini response display of a filter strip: SerumDSP.filterImpulse at 48 kHz (4096 taps: low resonant cutoffs ring for
// longer than a short window; the new types ≥ 96 with the filter's X / Y and PZ SVF corners, as the OSC page's display),
// magnitude on a 20 Hz–20 kHz log axis
const F_LO = 20, F_HI = 20000, IMP_N = 4096;
function magAt(imp, f, fs) {
  const w = 2 * Math.PI * f / fs, c = Math.cos(w), s = Math.sin(w);
  let re = 0, im = 0, cr = 1, ci = 0;
  for (let i = 0; i < imp.length; i++) {
    const v = imp[i];
    re += v * cr; im -= v * ci;
    const t = cr * c - ci * s; ci = cr * s + ci * c; cr = t;
  }
  return Math.hypot(re, im);
}

export class MixerPage {
  constructor(root, kit) {
    this.kit = kit;
    this.doc = kit.doc || (root && root.ownerDocument) || globalThis.document;
    this.strips = [];
    this.meters = [];
    this.offs = [];
    this.dead = false;
    injectMixStyles(this.doc);
    this.el = this.build();
    if (root) root.appendChild(this.el);
  }
  build() {
    const K = this.kit, d = this.doc, row = mk(d, 'div', 'sxm-mixer');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Mixer');
    for (const T of STRIPS) {
      if (T.key === 'f1' || T.key === 'bus1' || T.key === 'main') row.appendChild(mk(d, 'span', 'sxm-gap'));
      const S = T.kind === 'src' ? this.srcStrip(T) : T.kind === 'filt' ? this.filtStrip(T) : this.outStrip(T);
      S.el.setAttribute('data-strip', T.key);
      S.el.style.setProperty('--sxm-c', 'var(' + T.color + ')');
      this.strips.push(Object.assign(S, { T }));
      row.appendChild(S.el);
    }
    K.live(shown => this.meterFrame(shown));
    return row;
  }
  s() { return this.kit.s(); }
  fx() { return this.kit.fx(); }
  info(key) { return channelStrips(this.s(), this.fx()).find(x => x.key === key); }
  // whether the main.js host keeps a v2 FX state written into its v1 object (kit.host.v2Fx: true or a function)
  v2ok() {
    const H = this.kit.host || {}, o = H.v2Fx;
    try { return typeof o === 'function' ? !!o.call(H) : !!o; } catch (err) { return false; }
  }
  // the rack bypasses and bus routes are available: a v2 FX state, or a v1 one the host lets the page convert
  canRack() { return isV2Fx(this.fx()) || (isObj(this.fx()) && this.v2ok()); }
  // an FX-state edit that needs the v2 shape (rack bypass, bus route): a v1 state is converted to v2 in place first
  // (§2.6.3: migrateFx1 with the Serum state as refs, as fx-ui does) — never without v2ok
  editRack(fn, label) {
    if (!this.canRack()) return false;
    const s = this.s();
    this.kit.editFx(fx => {
      if (!isObj(fx)) return;
      if (!isV2Fx(fx)) {
        if (!this.v2ok()) return;
        const V = core.normalizeFx2(fx, s);
        for (const k of Object.keys(fx)) delete fx[k];
        Object.assign(fx, V);
      }
      fn(fx);
    }, { label });
    return true;
  }

  /* ---------------------------------------------------------- strip parts */
  // the panel shell of the source / filter strips (kit.panel: power, module menu, lock mark; its name label is the
  // module drag handle — swap / copy onto another label of the same kind — so the mixer adds no gesture of its own: a
  // second drag handler on the label would run every swap twice); a tap on a collapsed strip switches it on
  shell(T) {
    const K = this.kit, P = T.p, { el, head, body, name } = K.panel(T.label, T.module, P + '.on', 'sxm-strip');
    if (name) name.setAttribute('data-sxm-module', T.module);
    K.custom(() => { const on = baseOn(this.s(), P + '.on'); el.classList.toggle('sxm-off', !on); });
    el.addEventListener('click', e => {
      if (!el.classList.contains('sxm-off')) return;
      for (let n = e.target; n && n !== el; n = n.parentNode) if (n.classList && n.classList.contains('wk-tog')) return;   // the power button itself
      K.setN(P + '.on', 1, 'set');
    });
    return { el, head, body, name };
  }
  routeMenu(T) {
    const K = this.kit, isBus = T.kind === 'bus';
    // (bus routes live in the v2 FX state: a v1 state is converted by the first route edit, or — when the host cannot
    // keep v2 states — the items are disabled)
    const w = wk.menu({ label: T.label + ' route', arrows: false, wheel: true,
      items: () => routeMenuItems(this.s(), T.key, this.fx()).map(x => ({ v: x.v, label: x.label, disabled: isBus && !this.canRack() })),
      get: () => (isBus ? busRoute(this.fx(), T.rack) : routeOf(this.s(), T.key)),
      set: v => this.setRoute(T, v) });
    w.el.classList.add('sxm-route');
    if (isBus) K.custom(() => w.el.classList.toggle('wk-dis', !this.canRack()));
    return K.bind(w);
  }
  setRoute(T, v) {
    const K = this.kit, r = clamp(Math.round(+v || 0), 0, T.kind === 'bus' ? 2 : 3);
    if (T.kind === 'bus') {
      if (!this.canRack()) { K.notify(V1_NOTE); return; }
      const k = T.rack, o = k === 1 ? 2 : 1;
      this.editRack(fx => {
        fx.racks[k].route = r;
        if (r === 2 && fx.racks[o].route === 2) fx.racks[o].route = 0;   // both buses into each other: the other → Main
      }, T.label + ' route');
      return;
    }
    const [a, i] = T.path;
    K.edit(s => {
      const o = i === undefined ? s[a] : arr(s[a])[i];
      if (!isObj(o)) return;
      o.route = r;
      if (T.kind === 'filt' && r === 0) { const f = arr(s.filter)[1 - i]; if (isObj(f) && f.route === 0) f.route = 1; }   // no F1 ↔ F2 loop
    }, { label: T.label + ' route' });
  }
  envToggle(T) {
    const K = this.kit, [a, i] = T.path;
    const w = K.bind(wk.toggle({ label: 'ENV', kind: 'btn', get: () => envOf(this.s(), T.key),
      set: v => K.edit(s => { const o = i === undefined ? s[a] : arr(s[a])[i]; if (isObj(o)) o.env = v ? 1 : 0; }, { label: T.label + ' ENV 1' }) }));
    w.el.classList.add('sxm-env');
    w.el.title = 'ENV: ENV 1 shapes this channel (off: the level is held while the voice lasts)';
    return w;
  }
  // s2: the S2-mode dB scale of the sub level (n²; dbOf)
  fader(id, label, meter, s2) {
    const K = this.kit, d = destOf(id);
    const ctx = () => ({ s: this.s(), fx: this.fx() });
    const w = wk.fader({ dest: id, label, get: () => K.getN(id), set: (n, ph) => K.setN(id, n, ph), def: d ? d.def : 0,
      db: n => dbOf(id, n, s2), fmt: n => core.fmtParam(id, n, ctx()), parse: t => core.parseParam(id, t, ctx()),
      meter: meter >= 0 ? { ch: 1, floor: -60, top: 6 } : false });
    if (typeof wk.tooltip === 'function') wk.tooltip(w.el, () => (d ? d.label : label) + ': ' + core.fmtParam(id, K.getN(id), ctx()));
    if (meter >= 0) this.meters.push({ w, i: meter });
    return K.bind(w);
  }
  kn(id, label) { return this.kit.knob(id, { label, size: 'sm' }); }

  /* ---------------------------------------------------------- strips */
  srcStrip(T) {
    const K = this.kit, d = this.doc, S = this.shell(T), P = T.p;
    const bal = this.kn(P + '.fbal', 'BAL'), env = this.envToggle(T);
    K.custom(() => {
      const r = routeOf(this.s(), T.key);
      bal.el.classList.toggle('sxm-hide', r !== 0);
      env.el.classList.toggle('sxm-hide', r !== 1 && r !== 2);
    });
    const r1 = mk(d, 'div', 'sxm-row'), r2 = mk(d, 'div', 'sxm-row'), r3 = mk(d, 'div', 'sxm-row');
    r1.append(bal.el, env.el);
    r2.append(this.kn(P + '.bus1', 'BUS 1').el, this.kn(P + '.bus2', 'BUS 2').el);
    r3.append(this.kn(P + '.pan', 'PAN').el);
    S.body.append(this.routeMenu(T).el, r1, r2, r3);
    if (T.key !== 'sub') S.body.append(this.fader(P + '.level', T.label + ' level', T.meter).el);
    else {
      // SUB: the fader's scale (ticks, dB text) follows the mode's level law — S1 n, S2 n² (§6.11.1); wk.fader draws its
      // ticks once, so both scales are built and the S1 checkbox shows one
      const f1 = this.fader('s.level', T.label + ' level', T.meter, false), f2 = this.fader('s.level', T.label + ' level', T.meter, true);
      K.custom(() => { const s1 = s1Of(this.s()); f1.el.classList.toggle('sxm-hide', !s1); f2.el.classList.toggle('sxm-hide', s1); });
      S.body.append(f1.el, f2.el);
    }
    return S;
  }
  filtStrip(T) {
    const K = this.kit, d = this.doc, S = this.shell(T), P = T.p;
    const list = n => core.FILTERS.slice(0, n).map((f, k) => ({ v: k / (n - 1), label: f.name, group: f.cat }));
    const typeMenus = T.key === 'f1' ? [['f.type', 96], ['f.type2', 108]] : [['f2.type', 108]];
    for (const [id, n] of typeMenus) {
      const m = K.menu(id, () => list(n), { label: T.label + ' type' });
      m.el.classList.add('sxm-type', 'sx-grow');
      if (T.key === 'f1') K.custom(() => m.el.classList.toggle('sxm-hide', (id === 'f.type') !== s1Of(this.s())));
      S.head.appendChild(m.el);
    }
    const disp = this.filterDisplay(T);
    const env = this.envToggle(T);
    K.custom(() => { const r = routeOf(this.s(), T.key); env.el.classList.toggle('sxm-hide', r !== 1 && r !== 2); });
    const r1 = mk(d, 'div', 'sxm-row'), r2 = mk(d, 'div', 'sxm-row'), r3 = mk(d, 'div', 'sxm-row');
    r1.append(env.el);
    r2.append(this.kn(P + '.bus1', 'BUS 1').el, this.kn(P + '.bus2', 'BUS 2').el);
    r3.append(this.kn(P + '.pan', 'PAN').el, this.kn(P + '.mix', 'MIX').el);
    S.body.append(disp, this.routeMenu(T).el, r1, r2, r3, this.fader(P + '.level', T.label + ' level', T.meter).el);
    return S;
  }
  typeIdx(T) {
    const s = this.s(), id = T.key === 'f2' ? 'f2.type' : s1Of(s) ? 'f.type' : 'f.type2';
    return Math.round(core.lawValue(id, this.kit.getN(id)));
  }
  // the PZ SVF corners of filter strip T (12 values: 4 corners × 3) or null
  pzOf(T) {
    const s = this.s(), F = isObj(s) ? arr(s.filter)[T.key === 'f2' ? 1 : 0] : null, pz = isObj(F) ? [].concat(...arr(F.pz).map(c => arr(c))) : [];
    return pz.length === 12 && pz.every(fin) ? pz : null;
  }
  filterDisplay(T) {
    const K = this.kit, P = T.p;
    const cv = K.canvas('sxm-fdisp', () => {
      const type = this.typeIdx(T), k = [type, K.getN(P + '.cutoff').toFixed(4), K.getN(P + '.res').toFixed(3), K.getN(P + '.drive').toFixed(3),
        K.getN(P + '.var').toFixed(3), K.getN(P + '.on'), globalThis.SerumDSP ? 1 : 0];
      if (type >= 96) k.push(K.getN(P + '.x').toFixed(3), K.getN(P + '.y').toFixed(3), JSON.stringify(this.pzOf(T)));
      return k.join('|');
    }, (g, w, h, dpr) => this.drawFilter(T, g, w, h, dpr));
    const c = cv.el;
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', T.label + ' response: drag sets cutoff (x) and resonance (y)');
    K.dropTarget(c, P + '.cutoff');
    // relative drag, like a knob (no jump on the press): x moves the cutoff along the display's log axis (its width =
    // 1000 : 1, as 20 Hz–20 kHz; the value stays inside the cutoff law's own 8.18 Hz–22.05 kHz, so a drag without
    // horizontal travel keeps the cutoff exactly), y the resonance (its height = the full range); Shift / Fine latch
    // ×0.1; nothing is edited before 3 px of travel
    let g = null;
    const fine = e => !!(e.shiftKey || (wk.modifierBar && typeof wk.modifierBar.mods === 'function' && wk.modifierBar.mods(e).fine));
    const put = (e, ph) => {
      const r = c.getBoundingClientRect(), w = Math.max(16, r.width), hh = Math.max(8, r.height), f = g.fine ? 0.1 : 1;
      const dx = e.clientX - g.x, dy = g.y - e.clientY, lo = core.lawValue(P + '.cutoff', 0), hi = core.lawValue(P + '.cutoff', 1);
      const cut = dx === 0 || !(g.hz0 > 0) ? g.cut0 : clamp01(core.lawNorm(P + '.cutoff', clamp(g.hz0 * Math.pow(F_HI / F_LO, dx * f / w), lo, hi)));
      const res = dy === 0 ? g.res0 : clamp01(g.res0 + dy * f / hh);
      K.edit(s => { s.p[P + '.cutoff'] = cut; s.p[P + '.res'] = res; }, { label: T.label + ' cutoff / res', phase: ph });
    };
    c.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, fine: fine(e), cut0: K.getN(P + '.cutoff'),
        hz0: core.lawValue(P + '.cutoff', K.getN(P + '.cutoff')), res0: K.getN(P + '.res') };
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
    });
    c.addEventListener('pointermove', e => {
      if (!g || e.pointerId !== g.id) return;
      if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 3) { g.moved = true; put(e, 'start'); }
      if (g.moved) put(e, 'move');
    });
    const up = e => {
      if (!g || e.pointerId !== g.id) return;
      const G = g;
      g = null;
      // gesture.js's two-finger cancel (a second finger made this a pan / pinch): cutoff / res as at the press; the
      // modifier latches stay for the next gesture
      if (e.gesture === 'two-finger') { if (G.moved) K.edit(s => { s.p[P + '.cutoff'] = G.cut0; s.p[P + '.res'] = G.res0; }, { label: T.label + ' cutoff / res', phase: 'end' }); return; }
      if (G.moved) { g = G; put(e, 'end'); g = null; }
      if (wk.modifierBar && typeof wk.modifierBar.consume === 'function') wk.modifierBar.consume();
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    return c;
  }
  drawFilter(T, g, w, h, dpr) {
    const K = this.kit, P = T.p, S = globalThis.SerumDSP, on = K.getN(P + '.on') >= 0.5;
    g.fillStyle = '#0a0d10'; g.fillRect(0, 0, w, h);
    const type = this.typeIdx(T), fc = core.lawValue(P + '.cutoff', K.getN(P + '.cutoff'));
    const xc = Math.log(clamp(fc, F_LO, F_HI) / F_LO) / Math.log(F_HI / F_LO) * w;
    g.fillStyle = '#ffd84a'; g.fillRect(xc - dpr / 2, h - 4 * dpr, dpr, 4 * dpr);
    if (!S || typeof S.filterImpulse !== 'function') return;
    let imp = null;
    const nw = type >= 96;   // the new types: the filter's X / Y and PZ SVF corners (§6.13.4)
    try {
      imp = S.filterImpulse(type, fc, K.getN(P + '.res'), K.getN(P + '.drive'), K.getN(P + '.var'), 48000, IMP_N,
        nw ? K.getN(P + '.x') : 0, nw ? K.getN(P + '.y') : 0, nw ? this.pzOf(T) : null);
    } catch (err) { warnOnce('fimp', 'sx-ui-mix: filterImpulse', err); return; }
    if (!imp || !imp.length) return;
    g.beginPath();
    const N = Math.max(16, Math.min(96, Math.round(w / (3 * dpr))));
    for (let i = 0; i <= N; i++) {
      const x = i / N * w, f = F_LO * Math.pow(F_HI / F_LO, i / N), db = 20 * Math.log10(Math.max(1e-6, magAt(imp, f, 48000)));
      const y = h * (18 - clamp(db, -42, 18)) / 60;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.strokeStyle = on ? '#59c2ff' : '#7f8b98'; g.lineWidth = 1.4 * dpr; g.stroke();
  }
  // BUS 1 / BUS 2 / MAIN / DIRECT
  outStrip(T) {
    const d = this.doc, el = mk(d, 'section', 'sx-panel sxm-strip');
    el.setAttribute('aria-label', T.label);
    const head = mk(d, 'div', 'sx-ptitle'), body = mk(d, 'div', 'sx-pbody');
    head.appendChild(mk(d, 'span', 'sx-tname', T.label));
    el.append(head, body);
    if (T.kind === 'bus') body.appendChild(this.routeMenu(T).el);
    if (T.kind === 'bus' || T.kind === 'main') body.appendChild(this.bypassBtn(T));
    body.appendChild(this.fader(T.level, T.label + ' level', T.meter).el);
    return { el, head, body, name: null };
  }
  // FX bypass of rack k (red; Alt-click toggles every module of the rack, inv B14.1)
  bypassBtn(T) {
    const K = this.kit, k = T.rack, nm = k ? T.label : 'Main';
    const get = () => { const fx = this.fx(); return isV2Fx(fx) && isObj(fx.racks[k]) && fx.racks[k].byp ? 1 : 0; };
    const w = K.bind(wk.toggle({ label: nm + ' FX bypass', text: 'FX BYP', kind: 'btn', get,
      disabled: () => !this.canRack(),
      set: v => { if (!this.editRack(fx => { if (isObj(fx.racks[k])) fx.racks[k].byp = v ? 1 : 0; }, nm + ' FX bypass')) K.notify(k ? V1_NOTE : V1_MAIN); } }));
    w.el.classList.add('sxm-byp');
    const tip = 'FX bypass: the ' + nm + ' rack passes its input (Alt-click: every module of the rack on / off)';
    K.custom(() => { const t = this.canRack() ? tip : k ? V1_NOTE : V1_MAIN; if (w.el.title !== t) w.el.title = t; });
    const box = mk(this.doc, 'span', 'sxm-bypbox');
    box.appendChild(w.el);
    box.addEventListener('click', e => {
      const m = wk.modifierBar && typeof wk.modifierBar.mods === 'function' ? wk.modifierBar.mods(e) : { alt: !!e.altKey };
      if (!m.alt) return;
      e.preventDefault();
      e.stopPropagation();
      this.toggleRackModules(k, T.label);
      if (wk.modifierBar && typeof wk.modifierBar.consume === 'function') wk.modifierBar.consume();
    }, true);
    return box;
  }
  // every module of rack k (top level and branches) on, or off when any is on. A v1 FX state (one rack, no buses): the
  // modules of its v2 view (the ones that exist for the user: enabled, edited or referenced) are switched in the v1
  // state itself (fx.p['fx.<m>.on']); its buses are empty
  toggleRackModules(k, label) {
    const K = this.kit, fx = this.fx();
    if (!isObj(fx)) return;
    const v1 = !isV2Fx(fx);
    if (v1 && k > 0 && !this.v2ok()) { K.notify(V1_NOTE); return; }
    const view = v1 ? core.normalizeFx2(fx, this.s()) : fx, all = [];
    const visit = I => { if (!isObj(I)) return; all.push(I); if (Array.isArray(I.br)) for (const B of I.br) for (const c of arr(B)) visit(c); };
    for (const I of arr(view.racks[k] && view.racks[k].mods)) visit(I);
    if (!all.length) { K.notify('The ' + label + ' rack is empty'); return; }
    const anyOn = all.some(I => isObj(I.p) && I.p.on >= 0.5), on = anyOn ? 0 : 1, ids = all.map(I => I.id);
    K.editFx(F => {
      if (!isObj(F)) return;
      if (!isV2Fx(F)) { if (isObj(F.p)) for (const id of ids) if (('fx.' + id + '.on') in F.p) F.p['fx.' + id + '.on'] = on; return; }
      const go = I => { if (!isObj(I)) return; if (isObj(I.p) && I.p.on !== undefined) I.p.on = on; if (Array.isArray(I.br)) for (const B of I.br) for (const c of arr(B)) go(c); };
      for (const I of arr(F.racks[k] && F.racks[k].mods)) go(I);
    }, { label: (on ? 'Enable' : 'Disable') + ' all ' + label + ' modules' });
  }

  /* ---------------------------------------------------------- meters (snapshot `mix`, §6.20) */
  // kit.live: every repaint and snapshot frame; nothing is painted while the MIX page is hidden (shown = false, §13.1) —
  // the meters catch up with the next frame on screen
  meterFrame(shown) {
    if (this.dead || shown === false) return;
    const sn = this.kit.snap(), mix = sn && sn.mix && typeof sn.mix.length === 'number' ? sn.mix : null;
    for (const m of this.meters) {
      const v = mix && m.i < mix.length ? +mix[m.i] : -Infinity;
      if (m.last === v) continue;
      m.last = v;
      if (m.w && m.w.meter) m.w.meter(v);
    }
  }
  destroy() {
    if (this.dead) return;
    this.dead = true;
    for (const f of this.offs) f();
    this.el.remove();
  }
}
