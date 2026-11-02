// sx-ui-mix.js — the output strips of the wavetable engine (SPEC-serum2 §1, §6.12, §11.14, §13.4; inv B1, B13): BUS 1 /
// BUS 2 / MAIN / DIRECT, the Amplifier face's outputs (rig-ui), and the pure strip helpers of the old MIX page. Owner U3.
//
//   BUS 1 / 2                 route menu (Main · Direct · other bus), FX bypass (red, fx.racks[k].byp; Alt-click
//                             toggles every module of that bus), level fader (g.bus1v / g.bus2v)
//   MAIN                      Main FX bypass (red), master fader (g.master)
//   DIRECT                    direct fader (g.direct)
// Meters read the snapshot's `mix` (Float32Array(11): channel peaks in dBFS, order A, B, C, Noise, Sub, F1, F2, Bus1, Bus2,
// Main, Direct, §6.20). Routing loops are resolved by the most recent choice: the two buses into each other send the other
// one to Main (§2.5).
//
// The strips never see the main.js host's edit path: they receive the host's binding kit (makeKit, §11.14 — the `kit`
// argument): destination widgets (kit.knob / menu / toggle) with halos, drag-to-modulate drops, knob menus, MIDI learn and
// locks; FX-state edits (bus routes, rack bypass) through kit.editFx. A v1 (Phase-1) FX state has no buses and no rack
// bypass: the first such edit converts it to v2 in place (§2.6.3 migrateFx1 with the state as refs, as fx-ui does) — every
// host keeps v2 states (SX0: the "no v2" words of a host without v2Fx went with the bundled panel). Alt-click on MAIN's
// bypass switches the modules of a v1 state in the v1 state itself (no conversion needed).
//
//   new OutputsPanel(root, kit)   (SYNTH Canvas milestone 3) the BUS 1 / BUS 2 / MAIN / DIRECT strips (.el = the row); destroy()
//   MixerPage                     its base: the shared strips, edits and meters (SX0: the MIX page's own build and its source /
//                                 filter strips went with the bundled panel)
//   channelStrips(s, fx)          pure: the strip descriptors (ids, route, visibility rules) for a state
//   routeMenuItems(s, ch, fx?)    pure: route menu items [{v, label, checked}] of strip key `ch` (fx needed for buses)
//
// Browser ES module: nothing touches document / window / storage at module top level (node imports it for tests).
import * as core from './serum-core.js?v=9';
import * as wk from './wk.js?v=9';

/* ================================================================ small helpers */

const fin = x => typeof x === 'number' && isFinite(x);
const arr = x => (Array.isArray(x) ? x : []);
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const clamp01 = x => (x > 0 ? (x < 1 ? x : 1) : 0);
const isV2Fx = fx => isObj(fx) && fin(fx.v) && fx.v >= 2 && Array.isArray(fx.racks);
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

// level of a fader destination in dB at n (its law's gain; −Infinity at silence)
function dbOf(id, n) {
  const x = clamp01(n);
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
  s() { return this.kit.s(); }
  fx() { return this.kit.fx(); }
  info(key) { return channelStrips(this.s(), this.fx()).find(x => x.key === key); }
  // the rack bypasses and bus routes are available: an FX state (a v1 one is converted by the first edit)
  canRack() { return isObj(this.fx()); }
  // an FX-state edit that needs the v2 shape (rack bypass, bus route): a v1 state is converted to v2 in place first
  // (§2.6.3: migrateFx1 with the state as refs, as fx-ui does)
  editRack(fn, label) {
    if (!this.canRack()) return false;
    const s = this.s();
    this.kit.editFx(fx => {
      if (!isObj(fx)) return;
      if (!isV2Fx(fx)) {
        const V = core.normalizeFx2(fx, s);
        for (const k of Object.keys(fx)) delete fx[k];
        Object.assign(fx, V);
      }
      fn(fx);
    }, { label });
    return true;
  }

  /* ---------------------------------------------------------- strip parts */
  routeMenu(T) {
    const K = this.kit, isBus = T.kind === 'bus';
    // (bus routes live in the v2 FX state: a v1 state is converted by the first route edit; without an FX state the items
    // are disabled)
    const w = wk.menu({ label: T.label + ' route', arrows: false, wheel: true,
      items: () => routeMenuItems(this.s(), T.key, this.fx()).map(x => ({ v: x.v, label: x.label, disabled: isBus && !this.canRack() })),
      get: () => (isBus ? busRoute(this.fx(), T.rack) : routeOf(this.s(), T.key)),
      set: v => this.setRoute(T, v) });
    w.el.classList.add('sxm-route');
    if (isBus) K.custom(() => w.el.classList.toggle('wk-dis', !this.canRack()));
    return K.bind(w);
  }
  // a bus route (the only strips with a route menu here)
  setRoute(T, v) {
    if (T.kind !== 'bus') return;
    const r = clamp(Math.round(+v || 0), 0, 2), k = T.rack, o = k === 1 ? 2 : 1;
    this.editRack(fx => {
      fx.racks[k].route = r;
      if (r === 2 && fx.racks[o].route === 2) fx.racks[o].route = 0;   // both buses into each other: the other → Main
    }, T.label + ' route');
  }
  fader(id, label, meter) {
    const K = this.kit, d = destOf(id);
    const ctx = () => ({ s: this.s(), fx: this.fx() });
    const w = wk.fader({ dest: id, label, get: () => K.getN(id), set: (n, ph) => K.setN(id, n, ph), def: d ? d.def : 0,
      db: n => dbOf(id, n), fmt: n => core.fmtParam(id, n, ctx()), parse: t => core.parseParam(id, t, ctx()),
      meter: meter >= 0 ? { ch: 1, floor: -60, top: 6 } : false });
    if (typeof wk.tooltip === 'function') wk.tooltip(w.el, () => (d ? d.label : label) + ': ' + core.fmtParam(id, K.getN(id), ctx()));
    if (meter >= 0) this.meters.push({ w, i: meter });
    return K.bind(w);
  }
  /* ---------------------------------------------------------- strips */
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
      set: v => { this.editRack(fx => { if (isObj(fx.racks[k])) fx.racks[k].byp = v ? 1 : 0; }, nm + ' FX bypass'); } }));
    w.el.classList.add('sxm-byp');
    const tip = 'FX bypass: the ' + nm + ' rack passes its input (Alt-click: every module of the rack on / off)';
    K.custom(() => { if (w.el.title !== tip) w.el.title = tip; });
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
  // kit.frame (FR Cut B §4.3; a kit without it: kit.live): every painted frame of the host's tick while the fast lane is live (the
  // view's mix at the heard frame), every repaint and snapshot frame otherwise; nothing is painted while the strips are hidden
  // (shown = false, §13.1) — the meters catch up with the next frame on screen
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

// OutputsPanel(root, kit): the output strips — BUS 1 / BUS 2 (route, FX bypass, level), MAIN (Main FX bypass, master),
// DIRECT — the Amplifier face's outputs (SYNTH Canvas milestone 3, IMPL-3 §2.2; rig-ui): outStrip / bypassBtn / fader
export class OutputsPanel extends MixerPage {
  build() {
    const K = this.kit, d = this.doc, row = mk(d, 'div', 'sxm-mixer sxm-outs');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Outputs');
    for (const T of STRIPS) {
      if (T.kind !== 'bus' && T.kind !== 'main' && T.kind !== 'direct') continue;
      if (T.key === 'main') row.appendChild(mk(d, 'span', 'sxm-gap'));
      const S = this.outStrip(T);
      S.el.setAttribute('data-strip', T.key);
      S.el.style.setProperty('--sxm-c', 'var(' + T.color + ')');
      this.strips.push(Object.assign(S, { T }));
      row.appendChild(S.el);
    }
    (K.frame || K.live)(shown => this.meterFrame(shown));
    return row;
  }
}
