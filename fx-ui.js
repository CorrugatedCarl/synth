// fx-ui.js — FX rack UI (SPEC-serum §8.7.2, §9.6, inv A20) used by every track's FX tab and, embedded, by Serum's
// FX page. Left: the 10 module tiles in processing order (enable LED bound to `fx.<m>.on`, name = scroll to the
// module, ≡ = drag to reorder, Alt+↑/↓). Right: the enabled modules in order, each with a header (title, module
// preset menu ▾, power button = temporary bypass `fx.byp[m]`) and every control of §9.6; displays (distortion
// filter and transfer curve, delay filter, EQ response, FX filter response, compressor GR) use the real DSP code
// (FXDSP via wk.loadDSP, §0.3 deviation 7). Pure helpers (moveModule, ladderLabel, moduleTitle,
// modulePresetPayload, applyModulePreset, svfDb, impulseDb) are node-testable; nothing touches the DOM at module
// top level.
//
// Host contract additions (for the integrator; to be recorded in §8.7.2):
//   · editFx options may carry `seed: true` — loading an effect chain, a module preset, Init Module or Reset Rack
//     asks the host to compile that patch with `seed` (§4.2, §9.6);
//   · optional `host.tip(destId) → string | null`: the tooltip text of a DEST-bound control (§9.4: `<Label>: <value>`
//     plus one line per modulator). SerumUI's adapter supplies it from its tipText; without it (or when it returns
//     null) the rack shows `<Label>: <value>`.
// Effect-chain files (§9.6) use the library form { type: 'synth.fxchains', v: 1, chains: [{ name, fx }] } (one
// element for "Export Effect Chain…"); import always merges into synth.fxchains (old single-chain files and bare fx
// states are accepted too); loading stays a separate action of the Load menu.
import { knob, numBox, menu, toggle, seg, slider, contextMenu, tooltip, injectStyles, loadDSP, menuSource, theme, fitCanvas, frame,
  saveFile, pickFile, ask, wheelGate } from './wk.js?v=5';
import { CurveEditor, shapeLib } from './graph.js?v=5';
import * as core from './serum-core.js?v=5';

const { DESTS, DEST_INDEX, FX_MODULES, FX_ORDER_DEFAULT, MODFX_LADDER, DLY_LADDER, DIST_MODES, DLY_MODES, REV_LABELS,
  EQ_TYPES_L, EQ_TYPES_H, CMP_RATIO_DETENTS, FILTERS, fmtParam, lawValue, lawNorm, defaultFx, normalizeFx,
  compileFx, compileFxT, varLabel } = core;

const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const fin = x => typeof x === 'number' && isFinite(x);
const Doc = () => globalThis.document || null;
const MODS = FX_ORDER_DEFAULT.slice();
const SUBS = { dist: 1, cho: 1, rev: 1 }; // modules with structured (non-DEST) state saved in module presets
const FS = 48000; // display sample rate
const deep = v => JSON.parse(JSON.stringify(v));

/* ================================================================ pure helpers (§8.7.2) */

// New order with module `id` moved so that it ends up at index `toIndex` (clamped). Unknown id → a copy.
export function moveModule(order, id, toIndex) {
  const a = Array.isArray(order) ? order.slice() : [];
  const i = a.indexOf(id);
  if (i < 0) return a;
  a.splice(i, 1);
  a.splice(clamp(Math.round(+toIndex || 0), 0, a.length), 0, id);
  return a;
}

// Ladder label at normalised n: 'modfx' = Flanger/Phaser/Chorus RATE with BPM on (§3.10, 31 entries),
// 'dly' = Delay TIME with BPM on (12 entries).
export function ladderLabel(kind, n) {
  const L = kind === 'dly' ? DLY_LADDER : MODFX_LADDER;
  return L[clamp(Math.round(clamp(+n || 0, 0, 1) * (L.length - 1)), 0, L.length - 1)].label;
}

export function moduleTitle(id) {
  const m = FX_MODULES.find(x => x.id === id);
  return m ? m.label : String(id);
}

// DEST ids a module preset carries: every FX dest of the module except its enable (Hyper also Dimension).
const PRESET_IDS = {};
for (const m of MODS) {
  PRESET_IDS[m] = DESTS.filter(d => (d.id.startsWith('fx.' + m + '.') || (m === 'hyper' && d.id.startsWith('fx.dim.'))) && d.id !== 'fx.' + m + '.on').map(d => d.id);
}
const defOf = id => DESTS[DEST_INDEX[id]].def;
function modOf(payload) {
  if (payload && MODS.includes(payload.m)) return payload.m;
  const P = payload && payload.p && typeof payload.p === 'object' ? payload.p : {};
  for (const k of Object.keys(P)) {
    const x = /^fx\.([a-z]+)\./.exec(k);
    if (x) return x[1] === 'dim' ? 'hyper' : MODS.includes(x[1]) ? x[1] : null;
  }
  return null;
}
function lockTest(locked) {
  if (typeof locked === 'function') return id => !!locked(id);
  if (locked instanceof Set) return id => locked.has(id);
  if (Array.isArray(locked)) return id => locked.includes(id);
  return () => false;
}

// Module preset payload (§9.6): { name, m, p: { fx.<m>.* except .on (Hyper: + fx.dim.*) }, sub?: deep copy of fx[m] }.
export function modulePresetPayload(fx, m, name) {
  const P = fx && fx.p && typeof fx.p === 'object' ? fx.p : {};
  const p = {};
  for (const id of PRESET_IDS[m] || []) p[id] = fin(P[id]) ? P[id] : defOf(id);
  const out = { name: String(name == null ? '' : name), m, p };
  if (SUBS[m] && fx && fx[m] && typeof fx[m] === 'object') out.sub = deep(fx[m]);
  return out;
}

// Applies a module preset (§9.6) and returns a NEW normalised fx: the module's values and structured state from the
// payload, except locked dest ids; enable, bypass, rack order and every other module unchanged.
export function applyModulePreset(fx, payload, lockedIds) {
  const out = normalizeFx(fx);
  const m = modOf(payload);
  if (!m) return out;
  const locked = lockTest(lockedIds), P = payload.p && typeof payload.p === 'object' ? payload.p : {};
  for (const id of PRESET_IDS[m]) if (!locked(id) && fin(P[id])) out.p[id] = P[id];
  const sub = payload.sub && typeof payload.sub === 'object' ? payload.sub : null;
  if (sub && m === 'dist') { if (Array.isArray(sub.xa)) out.dist.xa = sub.xa; if (Array.isArray(sub.xb)) out.dist.xb = sub.xb; }
  if (sub && m === 'cho' && sub.mono != null) out.cho.mono = sub.mono;
  if (sub && m === 'rev' && sub.type != null) out.rev.type = sub.type;
  return normalizeFx(out);
}

// Magnitude (dB) of the distortion module's TPT SVF at f: bilinear analog prototype with the LP/BP/HP morph of
// §8.5.3 (band-pass normalised to unity peak). Display helper.
export function svfDb(F, Q, lbh, f, fs) {
  const g = Math.tan(Math.PI * Math.min(F, 0.49 * fs) / fs), W = Math.tan(Math.PI * Math.min(f, 0.4999 * fs) / fs) / g;
  const dr = 1 - W * W, di = W / Q, den = dr * dr + di * di;
  let nr, ni;
  if (lbh <= 0.5) { const a = 2 * lbh; nr = 1 - a; ni = a * W / Q; } else { const b = 2 * lbh - 1; nr = -b * W * W; ni = (1 - b) * W / Q; }
  return 10 * Math.log10((nr * nr + ni * ni) / den + 1e-30);
}

// Magnitude (dB) of an impulse response at the given frequencies (direct DFT; display helper for filterImpulse).
export function impulseDb(imp, fs, freqs) {
  const out = new Float64Array(freqs.length), n = imp.length;
  for (let k = 0; k < freqs.length; k++) {
    const w = 2 * Math.PI * freqs[k] / fs, c = Math.cos(w), s = Math.sin(w);
    let re = 0, im = 0, cr = 1, ci = 0;
    for (let i = 0; i < n; i++) {
      const v = imp[i];
      re += v * cr; im -= v * ci;
      const t = cr * c - ci * s; ci = cr * s + ci * c; cr = t;
      if ((i & 255) === 255) { const m = Math.hypot(cr, ci); cr /= m; ci /= m; } // keep the rotator on the unit circle
    }
    out[k] = 10 * Math.log10(re * re + im * im + 1e-30);
  }
  return out;
}

// Fallback typed-value parser while serum-core has no parseParam yet (accepts the display units of §3.2).
const NUM = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)/;
function fallbackParse(id, text, ctx) {
  const i = DEST_INDEX[id];
  if (i == null) return null;
  const d = DESTS[i], t = String(text).trim().toLowerCase().replace(/,/g, '.').replace(/\s+/g, ' ');
  if (!t) return null;
  const grid = d.law === 'int' || d.law === 'enum' || d.law === 'bool' ? d.hi - d.lo : d.fmt === 'modRate' ? 30 : d.fmt === 'dlyTime' ? 11 : 0;
  if (grid) for (let k = 0; k <= grid; k++) if (fmtParam(id, k / grid, ctx).toLowerCase() === t) return k / grid; // labels
  if (d.fmt === 'ratio' && t.startsWith('lim')) return 1;
  if (d.fmt === 'fpan') { if (t === 'c') return 0.5; const m = /^([lr])\s*(\d+(?:\.\d*)?)/.exec(t); if (m) return clamp(0.5 + (m[1] === 'l' ? -1 : 1) * parseFloat(m[2]) / 200, 0, 1); }
  const m = NUM.exec(t);
  if (!m) return null;
  let v = parseFloat(m[0]);
  const unit = t.slice(m.index + m[0].length).trim();
  switch (d.fmt) {
    case 'pct': case 'lbh': return clamp(v / 100, 0, 1);
    case 'pct1': return lawNorm(id, v / 100);
    case 'hz': case 'modRate': return lawNorm(id, /^k/.test(unit) ? v * 1000 : v);
    case 'ms': case 'msFloor': case 'cmpAtt': case 'dlyTime': return lawNorm(id, /^s/.test(unit) ? v * 1000 : v);
    case 'db': return lawNorm(id, Math.pow(10, v / 20));
    case 'dbtrim': return clamp(Math.pow(10, v / 40) / 2, 0, 1);
    case 'revT': {
      const plate = ctx && ctx.fx && ctx.fx.rev && ctx.fx.rev.type < 0.5;
      return plate ? clamp((/^s/.test(unit) ? v * 1000 : v) / 200, 0, 1) : clamp(((/^ms/.test(unit) ? v / 1000 : v) - 0.8) / 11.2, 0, 1);
    }
    case 'var': {
      const ty = Math.round(lawValue('fx.fil.type', ctx && ctx.fx ? ctx.fx.p['fx.fil.type'] : 0));
      if (FILTERS[ty] && FILTERS[ty].family === 'eq') { // inverse of the EQ gain law
        return clamp(v >= 0 ? 0.5 + v / 48 : Math.pow(10, v / 40) / 2, 0, 1);
      }
      return clamp(v / 100, 0, 1);
    }
    default: return lawNorm(id, v);
  }
}

/* ================================================================ FXRackUI */
function h(tag, cls, text) {
  const e = Doc().createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function btn(cls, text, label) {
  const b = h('button', cls, text);
  b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  return b;
}
const show = (e, on) => { e.hidden = !on; };
const logX = (f, w, pad) => pad + Math.log(f / 20) / Math.log(1000) * (w - 2 * pad);
const fAtX = (x, w, pad) => 20 * Math.pow(1000, clamp((x - pad) / (w - 2 * pad), 0, 1));

export class FXRackUI {
  constructor(root, host, opts) {
    injectStyles();
    this.host = host || {};
    this.opts = opts || {};
    this.embedded = !!this.opts.embedded;
    this.dsp = this.opts.dsp || null;
    this.knobs = new Map();
    this.widgets = [];
    this.displays = [];
    this.panels = {};
    this.tiles = {};
    this.offs = [];
    this.dead = false;
    this.pending = null;
    this.xs = null;
    this.shapes = shapeLib(this.host.storage);
    this.build(root);
    // displays follow size changes (window resize, the 700 px layout switch, the rack becoming visible): redraw()
    // keys each display on its width, so only changed ones repaint
    const RO = globalThis.ResizeObserver;
    if (typeof RO === 'function') {
      const ro = new RO(() => { if (!this.dead) { this.redraw(); if (!this.panels.cmp.el.hidden) this.drawGr(); } });
      ro.observe(this.rack);
      this.offs.push(() => ro.disconnect());
    }
    if (!this.dsp) {
      loadDSP().then(r => { if (!this.dead && r && r.FXDSP) { this.dsp = r.FXDSP; this.redraw(true); } }, () => {});
    }
    this.refresh();
    const sel = this.fx().ui && this.fx().ui.sel;
    if (sel) this.scrollTo(sel, false);
  }

  /* ---------------------------------------------------------- state access */
  fx() { const f = this.host.fx ? this.host.fx() : null; return f && f.p ? f : (this.defFx || (this.defFx = defaultFx())); }
  bpm() { const b = this.host.bpm ? +this.host.bpm() : 120; return b > 0 ? b : 120; }
  ctx() { return { fx: this.fx(), bpm: this.bpm() }; }
  val(id) { const v = this.fx().p[id]; return fin(v) ? v : defOf(id); }
  on(id) { return this.val(id) >= 0.5; }
  edit(fn, label, phase, extra) {
    if (this.host.editFx) this.host.editFx(fn, Object.assign({ label, phase: phase || 'set' }, extra || {}));
    this.schedule();
  }
  setP(id, n, phase) { this.edit(fx => { fx.p[id] = n; }, DESTS[DEST_INDEX[id]].label, phase); }
  parse(id, t) {
    const ctx = this.ctx();
    if (typeof core.parseParam === 'function') { const v = core.parseParam(id, t, ctx); return v == null ? null : v; }
    return fallbackParse(id, t, ctx);
  }
  lockedIds() {
    if (typeof this.host.locked !== 'function') return [];
    return DESTS.filter((d, i) => i >= core.NS && d.id !== 'g.master' && d.id !== 'g.bypass' && this.host.locked(d.id)).map(d => d.id);
  }
  notify(t) { if (this.host.notify) this.host.notify(t); }
  storeGet(k, d) { try { const s = this.host.storage; const v = s && s.get ? s.get(k, d) : d; return v == null ? d : v; } catch (err) { return d; } }
  storeSet(k, v) { try { const s = this.host.storage; if (s && s.set) s.set(k, v); } catch (err) { /* storage full */ } }

  /* ---------------------------------------------------------- widget factories */
  reg(id, w) { this.knobs.set(id, w); this.widgets.push(w); this.tip(w, () => id); return w; }
  tip(w, idFn) {
    tooltip(w.el, () => {
      const id = idFn();
      if (!id) return '';
      if (typeof this.host.tip === 'function') { try { const t = this.host.tip(id); if (t != null && t !== '') return String(t); } catch (err) { /* host fallback */ } }
      return core.destLabel(id, null, this.fx()) + ': ' + fmtParam(id, this.val(id), this.ctx());
    });
  }
  kn(id, label, o) {
    const d = DESTS[DEST_INDEX[id]], stepped = d.law === 'int' || d.law === 'enum' || d.law === 'bool';
    return this.reg(id, knob(Object.assign({
      dest: id, label, get: () => this.val(id), set: (n, ph) => this.setP(id, n, ph), def: d.def,
      fmt: n => fmtParam(id, n, this.ctx()), parse: t => this.parse(id, t), steps: stepped ? d.hi - d.lo : 0, bipolar: !!d.ctr, size: 'md',
    }, o || {})));
  }
  tg(id, label, kind, text) {
    return this.reg(id, toggle({ dest: id, label, text, kind: kind || 'btn', get: () => (this.on(id) ? 1 : 0), set: (v, ph) => this.setP(id, v ? 1 : 0, ph) }));
  }
  sg(id, items, label) {
    return this.reg(id, seg({ dest: id, label, items, get: () => Math.round(lawValue(id, this.val(id))), set: k => this.setP(id, lawNorm(id, k), 'set') }));
  }
  mn(id, items, label) {
    return this.reg(id, menu({ dest: id, label, items: () => items, get: () => Math.round(lawValue(id, this.val(id))), set: v => this.setP(id, lawNorm(id, v), 'set') }));
  }
  sl(id, label, o) {
    const d = DESTS[DEST_INDEX[id]];
    return this.reg(id, slider(Object.assign({ dest: id, label, get: () => this.val(id), set: (n, ph) => this.setP(id, n, ph), def: d.def,
      fmt: n => fmtParam(id, n, this.ctx()), parse: t => this.parse(id, t), bipolar: !!d.ctr, orient: 'h' }, o || {})));
  }
  // MIX knob whose label flips to LEVEL (fx.ui.lvl[key], inv A20.2). `knobs` holds both ids; each id's halo is
  // kept and drawn only while that id is bound.
  mix(pre, key) {
    const mixId = 'fx.' + pre + '.mix', lvlId = 'fx.' + pre + '.level';
    const lvl = () => { const u = this.fx().ui; return !!(u && u.lvl && u.lvl[key]); };
    const cur = () => (lvl() ? lvlId : mixId);
    const stash = new Map();
    const w = knob({
      dest: cur, label: 'MIX', size: 'md',
      labelToggle: { alt: 'LEVEL', get: () => (lvl() ? 1 : 0), set: v => {
        this.edit(fx => { fx.ui = fx.ui || {}; fx.ui.lvl = fx.ui.lvl || {}; fx.ui.lvl[key] = v ? 1 : 0; }, 'Mix / Level', 'set', { ui: true });
        w.setMod(stash.get(cur()) || null);
      } },
      get: () => this.val(cur()), set: (n, ph) => this.setP(cur(), n, ph), def: () => defOf(cur()),
      fmt: n => fmtParam(cur(), n, this.ctx()), parse: t => this.parse(cur(), t),
    });
    for (const id of [mixId, lvlId]) {
      this.knobs.set(id, { el: w.el, update: () => w.update(), focus: () => w.focus(), edit: () => w.edit(), destroy: () => w.destroy(),
        setMod: m => { stash.set(id, m); if (cur() === id) w.setMod(m); } });
    }
    this.widgets.push(w);
    this.tip(w, cur);
    return w;
  }

  /* ---------------------------------------------------------- DOM */
  build(parent) {
    const root = this.el = h('div', 'fxr-root' + (this.embedded ? ' fxr-embedded' : ''));
    const side = this.side = h('div', 'fxr-side');
    const head = h('div', 'fxr-shead');
    head.append(h('span', 'fxr-stitle', 'FX'));
    const more = this.moreBtn = btn('fxr-more', '⋯', 'Rack menu');
    more.setAttribute('aria-haspopup', 'menu');
    more.addEventListener('click', () => { const r = more.getBoundingClientRect(); contextMenu(r.left, r.bottom + 2, this.rackMenu(), { anchor: more }); });
    head.append(more);
    const list = this.list = h('div', 'fxr-tiles');
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', 'FX modules (processing order)');
    this.ins = h('div', 'fxr-ins');
    this.ins.hidden = true;
    list.append(this.ins);
    side.append(head, list);
    const rack = this.rack = h('div', 'fxr-rack');
    this.empty = h('div', 'fxr-empty', 'No module is on. Switch one on with its LED on the left.');
    rack.append(this.empty);
    root.append(side, rack);
    for (const m of MODS) { this.buildTile(m); this.buildPanel(m); }
    if (!this.embedded) root.addEventListener('contextmenu', e => this.ctlMenu(e));
    if (parent) parent.appendChild(root);
  }
  buildTile(m) {
    const t = h('div', 'fxr-tile');
    t.setAttribute('role', 'listitem');
    const led = this.tg('fx.' + m + '.on', moduleTitle(m) + ' on', 'led', '');
    led.el.classList.add('fxr-led');
    const name = btn('fxr-tname', moduleTitle(m));
    name.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
    name.addEventListener('click', () => this.select(m));
    const grip = h('span', 'fxr-grip', '≡');
    grip.setAttribute('aria-hidden', 'true');
    grip.title = 'Drag to reorder (Alt+↑/↓)';
    grip.addEventListener('pointerdown', e => this.gripDown(e, m));
    grip.addEventListener('pointermove', e => this.gripMove(e));
    grip.addEventListener('pointerup', e => this.gripUp(e));
    grip.addEventListener('pointercancel', e => this.gripUp(e, true));
    t.append(led.el, name, grip);
    t.addEventListener('keydown', e => {
      if (!e.altKey || !/^Arrow(Up|Down|Left|Right)$/.test(e.key)) return;
      e.preventDefault();
      this.nudge(m, e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1, e.target);
    });
    menuSource(name);
    t.addEventListener('contextmenu', e => {
      if (led.el.contains(e.target)) return; // the LED is a DEST control: its menu belongs to the mod layer / ctlMenu
      e.preventDefault();
      e.stopPropagation();
      contextMenu(e.clientX, e.clientY, this.rackMenu(), { anchor: name });
    });
    this.tiles[m] = { el: t, led, name, grip };
    this.list.append(t);
  }
  buildPanel(m) {
    const sec = h('section', 'fxr-mod fxr-m-' + m);
    sec.setAttribute('aria-label', moduleTitle(m));
    const hd = h('div', 'fxr-mhead');
    const title = h('h3', 'fxr-mtitle', moduleTitle(m));
    const pre = btn('fxr-pre', '▾', moduleTitle(m) + ' presets');
    pre.setAttribute('aria-haspopup', 'menu');
    pre.addEventListener('click', () => { const r = pre.getBoundingClientRect(); contextMenu(r.left, r.bottom + 2, this.modMenu(m), { anchor: pre }); });
    const pw = toggle({ label: moduleTitle(m) + ' power (bypass)', kind: 'power', get: () => (this.fx().byp && this.fx().byp[m] ? 0 : 1),
      set: v => this.edit(fx => { fx.byp = fx.byp || {}; fx.byp[m] = v ? 0 : 1; }, (v ? 'Activate ' : 'Bypass ') + moduleTitle(m)) });
    pw.el.classList.add('fxr-pw');
    this.widgets.push(pw);
    tooltip(pw.el, () => (this.fx().byp && this.fx().byp[m] ? 'Bypassed — click to activate' : 'Active — click to bypass'));
    hd.append(title, pre, pw.el);
    const body = h('div', 'fxr-mbody');
    sec.append(hd, body);
    this.panels[m] = { el: sec, body, head: hd };
    this['mod_' + m](body);
    this.rack.append(sec);
  }
  row(parent, cls) { const r = h('div', 'fxr-row' + (cls ? ' ' + cls : '')); parent.append(r); return r; }
  group(parent, title) {
    const g = h('div', 'fxr-grp');
    if (title) g.append(h('div', 'fxr-gt', title));
    const r = h('div', 'fxr-row');
    g.append(r);
    parent.append(g);
    return r;
  }

  /* ---------------------------------------------------------- module panels */
  mod_hyper(b) {
    const hy = this.group(b, 'HYPER');
    hy.append(this.kn('fx.hyper.rate', 'RATE').el, this.kn('fx.hyper.detune', 'DETUNE').el);
    const col = h('div', 'fxr-col');
    const uni = this.reg('fx.hyper.unison', numBox({ dest: 'fx.hyper.unison', label: 'UNISON', steps: 7, get: () => this.val('fx.hyper.unison'),
      set: (n, ph) => this.setP('fx.hyper.unison', n, ph), def: defOf('fx.hyper.unison'), fmt: n => fmtParam('fx.hyper.unison', n),
      parse: t => this.parse('fx.hyper.unison', t) }));
    col.append(uni.el, this.tg('fx.hyper.retrig', 'RETRIG').el);
    hy.append(col, this.mix('hyper', 'hyper').el);
    const dm = this.group(b, 'DIMENSION');
    dm.append(this.kn('fx.dim.size', 'SIZE').el, this.mix('dim', 'dim').el);
  }
  mod_dist(b) {
    const r1 = this.row(b);
    const items = DIST_MODES.map((label, v) => ({ v, label }));
    r1.append(this.mn('fx.dist.mode', items, 'MODE').el);
    const ea = btn('fxr-xs', 'Edit A', 'Edit X-Shaper curve A'), eb = btn('fxr-xs', 'Edit B', 'Edit X-Shaper curve B');
    ea.addEventListener('click', () => this.openXs('xa'));
    eb.addEventListener('click', () => this.openXs('xb'));
    this.xsBtns = [ea, eb];
    const xsw = h('div', 'fxr-col fxr-xsb');
    xsw.append(ea, eb);
    r1.append(xsw, this.sg('fx.dist.filt', ['OFF', 'PRE', 'POST'], 'FILTER').el);
    const r2 = this.row(b);
    r2.append(this.distFilterDisplay().el);
    const fq = h('div', 'fxr-col');
    fq.append(this.kn('fx.dist.freq', 'F', { size: 'sm' }).el, this.kn('fx.dist.q', 'Q', { size: 'sm' }).el);
    r2.append(fq, this.sl('fx.dist.lbh', 'LP/BP/HP', { orient: 'v' }).el, this.transferDisplay().el,
      this.kn('fx.dist.drive', 'DRIVE').el, this.mix('dist', 'dist').el);
  }
  mod_flg(b) {
    const r = this.row(b);
    r.append(this.tg('fx.flg.bpm', 'BPM').el, this.rate('flg'), this.kn('fx.flg.depth', 'DEPTH').el, this.kn('fx.flg.feed', 'FEED').el,
      this.kn('fx.flg.phase', 'PHASE').el, this.mix('flg', 'flg').el);
  }
  mod_phs(b) {
    const r = this.row(b);
    r.append(this.tg('fx.phs.bpm', 'BPM').el, this.rate('phs'), this.kn('fx.phs.depth', 'DEPTH').el, this.kn('fx.phs.freq', 'FREQ').el,
      this.kn('fx.phs.feed', 'FEED').el, this.kn('fx.phs.phase', 'PHASE').el, this.mix('phs', 'phs').el);
  }
  mod_cho(b) {
    const r = this.row(b);
    const mono = toggle({ label: 'MONO', kind: 'btn', get: () => (this.fx().cho && this.fx().cho.mono ? 1 : 0),
      set: v => this.edit(fx => { fx.cho = fx.cho || {}; fx.cho.mono = v ? 1 : 0; }, 'Chorus Mono') });
    tooltip(mono.el, () => 'Mono: left and right chorus LFOs in phase');
    this.widgets.push(mono);
    const col = h('div', 'fxr-col');
    col.append(this.tg('fx.cho.bpm', 'BPM').el, mono.el);
    r.append(col, this.rate('cho'), this.kn('fx.cho.dly1', 'DELAY 1').el, this.kn('fx.cho.dly2', 'DELAY 2').el, this.kn('fx.cho.depth', 'DEPTH').el,
      this.kn('fx.cho.feed', 'FEED').el, this.kn('fx.cho.lpf', 'LPF').el, this.mix('cho', 'cho').el);
  }
  rate(m) { return this.kn('fx.' + m + '.rate', 'RATE', { steps: () => (this.on('fx.' + m + '.bpm') ? 30 : 0) }).el; }
  mod_dly(b) {
    const r1 = this.row(b);
    const sw = h('div', 'fxr-col');
    sw.append(this.tg('fx.dly.bpm', 'BPM').el, this.tg('fx.dly.link', 'LINK').el);
    r1.append(this.kn('fx.dly.feed', 'FEED').el, sw, this.sg('fx.dly.mode', DLY_MODES.slice(), 'MODE').el);
    const r2 = this.row(b);
    const steps = () => (this.on('fx.dly.bpm') ? 11 : 0), dets = [0.25, 0.5, 4 / 3 - 0.5, 1];
    const linked = () => this.on('fx.dly.link');
    const L = this.group(r2, 'LEFT'), R = this.group(r2, 'RIGHT');
    L.append(this.kn('fx.dly.timeL', 'TIME', { steps }).el, this.kn('fx.dly.offL', 'OFFSET', { detents: dets, size: 'sm' }).el);
    R.append(this.kn('fx.dly.timeR', 'TIME', { steps, disabled: linked }).el, this.kn('fx.dly.offR', 'OFFSET', { detents: dets, size: 'sm', disabled: linked }).el);
    const r3 = this.row(b);
    r3.append(this.delayDisplay().el, this.kn('fx.dly.freq', 'F').el, this.kn('fx.dly.q', 'Q').el, this.mix('dly', 'dly').el);
  }
  mod_cmp(b) {
    const r1 = this.row(b);
    r1.append(this.kn('fx.cmp.thr', 'THRESH').el, this.kn('fx.cmp.ratio', 'RATIO', { detents: CMP_RATIO_DETENTS }).el, this.kn('fx.cmp.att', 'ATTACK').el,
      this.kn('fx.cmp.rel', 'RELEASE').el, this.kn('fx.cmp.gain', 'GAIN').el, this.mix('cmp', 'cmp').el);
    const r2 = this.row(b, 'fxr-cmp2');
    r2.append(this.tg('fx.cmp.mb', 'MULTIBAND').el);
    const mb = this.mbBox = h('div', 'fxr-mb');
    mb.append(this.sl('fx.cmp.mbH', 'H').el, this.sl('fx.cmp.mbM', 'M').el, this.sl('fx.cmp.mbL', 'L').el);
    const gr = this.grCv = h('canvas', 'fxr-gr');
    gr.setAttribute('role', 'img');
    gr.setAttribute('aria-label', 'Gain reduction');
    r2.append(mb, gr);
  }
  mod_rev(b) {
    const r1 = this.row(b);
    const ty = seg({ label: 'TYPE', items: ['PLATE', 'HALL'], get: () => (this.fx().rev && this.fx().rev.type < 0.5 ? 0 : 1),
      set: k => this.edit(fx => { fx.rev = fx.rev || {}; fx.rev.type = k ? 1 : 0; }, 'Reverb Type') });
    this.widgets.push(ty);
    r1.append(ty.el);
    const r2 = this.row(b);
    const lab = slot => () => REV_LABELS[this.fx().rev && this.fx().rev.type < 0.5 ? 0 : 1][slot];
    r2.append(this.kn('fx.rev.size', lab(0)).el, this.kn('fx.rev.t', lab(1)).el, this.kn('fx.rev.locut', lab(2)).el, this.kn('fx.rev.c', lab(3)).el,
      this.kn('fx.rev.hicut', lab(4)).el, this.kn('fx.rev.w', lab(5)).el, this.mix('rev', 'rev').el);
  }
  mod_eq(b) {
    const r1 = this.row(b);
    r1.append(this.eqDisplay().el);
    const r2 = this.row(b, 'fxr-eq2');
    const L = this.group(r2, 'LOW'), H = this.group(r2, 'HIGH');
    L.append(this.sg('fx.eq.typeL', EQ_TYPES_L.slice(), 'TYPE').el, this.kn('fx.eq.freqL', 'FREQ').el, this.kn('fx.eq.qL', 'Q').el,
      this.kn('fx.eq.gainL', 'GAIN', { disabled: () => Math.round(lawValue('fx.eq.typeL', this.val('fx.eq.typeL'))) === 2 }).el);
    H.append(this.sg('fx.eq.typeH', EQ_TYPES_H.slice(), 'TYPE').el, this.kn('fx.eq.freqH', 'FREQ').el, this.kn('fx.eq.qH', 'Q').el,
      this.kn('fx.eq.gainH', 'GAIN', { disabled: () => Math.round(lawValue('fx.eq.typeH', this.val('fx.eq.typeH'))) === 2 }).el);
  }
  mod_fil(b) {
    const r1 = this.row(b);
    const items = FILTERS.map((f, v) => ({ v, label: f.name, group: f.cat }));
    r1.append(this.mn('fx.fil.type', items, 'TYPE').el);
    const r2 = this.row(b);
    const ty = () => Math.round(lawValue('fx.fil.type', this.val('fx.fil.type')));
    r2.append(this.filterDisplay().el, this.kn('fx.fil.cutoff', 'CUTOFF', { size: 'lg' }).el, this.kn('fx.fil.res', 'RES').el, this.kn('fx.fil.drive', 'DRIVE').el,
      this.kn('fx.fil.var', () => varLabel(ty()) || 'VAR', { disabled: () => !varLabel(ty()) }).el, this.kn('fx.fil.pan', 'PAN').el, this.mix('fil', 'fil').el);
  }

  /* ---------------------------------------------------------- displays */
  // A canvas display redrawn when key() changes; drag(P0, P, phase, e) for 2-parameter drags.
  display(m, cls, label, hgt, draw, key, drag) {
    const wrap = h('div', 'fxr-disp ' + cls), cv = h('canvas');
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', label);
    wrap.style.height = hgt + 'px';
    wrap.append(cv);
    const D = { m, el: wrap, cv, hgt, draw, key, last: null };
    if (drag) {
      let g = null;
      const pos = e => { // canvas coordinates: the canvas fills the wrapper's padding box (inside its 1 px border)
        const r = wrap.getBoundingClientRect(), b = this.box(D);
        return { x: e.clientX - r.left - (wrap.clientLeft || 0), y: e.clientY - r.top - (wrap.clientTop || 0), w: b.w, h: b.h };
      };
      wrap.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault();
        g = { id: e.pointerId, P0: pos(e), started: false };
        try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
        g.started = drag(g.P0, g.P0, 'start', e) !== false;
      });
      wrap.addEventListener('pointermove', e => { if (g && e.pointerId === g.id && g.started) drag(g.P0, pos(e), 'move', e); });
      const end = e => { if (!g || e.pointerId !== g.id) return; const G = g; g = null; if (G.started) drag(G.P0, pos(e), 'end', e); };
      wrap.addEventListener('pointerup', end);
      wrap.addEventListener('pointercancel', end);
    }
    this.displays.push(D);
    return D;
  }
  // CSS size of a display's canvas = the wrapper's padding box (clientWidth / clientHeight; nominal height minus the
  // 1 px borders before layout)
  box(D) {
    const el = D.el, r = el.getBoundingClientRect();
    return { w: Math.max(40, el.clientWidth || (r.width ? r.width - 2 : 200)), h: Math.max(16, el.clientHeight || D.hgt - 2) };
  }
  canvas(D) {
    const b = this.box(D), ctx = fitCanvas(D.cv, b.w, b.h);
    return ctx ? { ctx, w: b.w, h: b.h } : null;
  }
  frameAxes(c, T, dbMax, dbMin, pad) {
    const { ctx, w, h: H } = c;
    ctx.clearRect(0, 0, w, H);
    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, w, H);
    ctx.strokeStyle = T.line; ctx.lineWidth = 1;
    ctx.beginPath();
    for (const f of [100, 1000, 10000]) { const x = Math.round(logX(f, w, pad)) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    const Y = db => pad + (dbMax - db) / (dbMax - dbMin) * (H - 2 * pad);
    for (let db = Math.ceil(dbMin / 12) * 12; db <= dbMax; db += 12) { const y = Math.round(Y(db)) + 0.5; ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    return Y;
  }
  freqs(w, pad) {
    const n = clamp(Math.round(w / 2), 32, 256), out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = fAtX(pad + (w - 2 * pad) * i / (n - 1), w, pad);
    return out;
  }
  plot(c, fr, db, Y, pad, col, fill) {
    const { ctx, w, h: H } = c;
    ctx.beginPath();
    for (let i = 0; i < fr.length; i++) { const x = logX(fr[i], w, pad), y = clamp(Y(db[i]), -2, H + 2); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    if (fill) { ctx.save(); ctx.lineTo(w - pad, H); ctx.lineTo(pad, H); ctx.closePath(); ctx.globalAlpha = 0.14; ctx.fillStyle = col; ctx.fill(); ctx.restore(); ctx.beginPath(); for (let i = 0; i < fr.length; i++) { const x = logX(fr[i], w, pad), y = clamp(Y(db[i]), -2, H + 2); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); } }
    ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.lineJoin = 'round'; ctx.stroke();
  }
  note(c, T, text) {
    const { ctx, w, h: H } = c;
    ctx.fillStyle = T.mute; ctx.font = '500 10px ' + T.ui; ctx.textAlign = 'center';
    if (ctx.fillText) ctx.fillText(text, w / 2, H / 2 + 3);
    ctx.textAlign = 'left';
  }
  // 2-parameter display drag, relative like a knob: x moves the frequency dest along the log axis (the display's
  // width = 20 Hz–20 kHz), y moves the second dest (the plot height = full range, up = more); Shift = ×0.1. Nothing
  // is edited until the pointer has moved 3 px, so a plain click never changes the patch.
  dragXY(xId, yId, label, pad) {
    let st = null;
    return (P0, P, phase, e) => {
      if (phase === 'start') { st = { x0: this.val(xId), y0: this.val(yId), live: false, px: P0.x, py: P0.y, ax: 0, ay: 0 }; return true; }
      if (!st) return false;
      if (!st.live) {
        if (phase !== 'end' && Math.hypot(P.x - P0.x, P.y - P0.y) >= 3) {
          st.live = true;
          this.edit(fx => { fx.p[xId] = st.x0; fx.p[yId] = st.y0; }, label, 'start');
        } else { if (phase === 'end') st = null; return true; }
      }
      const f = e && e.shiftKey ? 0.1 : 1, f0 = clamp(lawValue(xId, st.x0), 20, 20000);
      st.ax = clamp(st.ax + (P.x - st.px) * f / Math.max(1, P.w - 2 * pad), Math.log(20 / f0) / Math.log(1000), Math.log(20000 / f0) / Math.log(1000));
      st.ay = clamp(st.ay + (st.py - P.y) * f / Math.max(1, P.h - 2 * pad), -st.y0, 1 - st.y0);
      st.px = P.x; st.py = P.y;
      const nx = clamp(lawNorm(xId, f0 * Math.pow(1000, st.ax)), 0, 1), ny = clamp(st.y0 + st.ay, 0, 1);
      this.edit(fx => { fx.p[xId] = nx; fx.p[yId] = ny; }, label, phase === 'end' ? 'end' : 'move');
      if (phase === 'end') st = null;
      this.redraw();
      return true;
    };
  }
  distFilterDisplay() {
    const pad = 6;
    return this.display('dist', 'fxr-dfil', 'Distortion filter response', 74, D => {
      const c = this.canvas(D); if (!c) return;
      const T = theme(this.el), Y = this.frameAxes(c, T, 24, -36, pad), fr = this.freqs(c.w, pad);
      const F = lawValue('fx.dist.freq', this.val('fx.dist.freq')), Q = lawValue('fx.dist.q', this.val('fx.dist.q')), lbh = this.val('fx.dist.lbh');
      const db = fr.map(f => svfDb(F, Q, lbh, f, FS));
      const active = Math.round(lawValue('fx.dist.filt', this.val('fx.dist.filt'))) > 0;
      this.plot(c, fr, db, Y, pad, active ? T.neg : T.mute, active);
    }, () => ['fx.dist.freq', 'fx.dist.q', 'fx.dist.lbh', 'fx.dist.filt'].map(id => this.val(id)).join(), this.dragXY('fx.dist.freq', 'fx.dist.q', 'Distortion Filter', pad));
  }
  transferDisplay() {
    return this.display('dist', 'fxr-xfer', 'Distortion transfer curve', 74, D => {
      const c = this.canvas(D); if (!c) return;
      const T = theme(this.el), { ctx, w, h: H } = c, s = Math.min(w, H) - 8, x0 = (w - s) / 2, y0 = (H - s) / 2;
      ctx.clearRect(0, 0, w, H); ctx.fillStyle = T.bg; ctx.fillRect(0, 0, w, H);
      ctx.strokeStyle = T.line; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, y0 + 0.5, s, s);
      ctx.beginPath(); ctx.moveTo(x0, y0 + s / 2); ctx.lineTo(x0 + s, y0 + s / 2); ctx.moveTo(x0 + s / 2, y0); ctx.lineTo(x0 + s / 2, y0 + s); ctx.stroke();
      const dsp = this.dsp;
      if (!dsp || typeof dsp.distCurve !== 'function') { this.note(c, T, '—'); return; }
      const fx = this.fx(), mode = Math.round(lawValue('fx.dist.mode', this.val('fx.dist.mode'))), drive = lawValue('fx.dist.drive', this.val('fx.dist.drive'));
      let y = null;
      try { const t = compileFxT(fx); y = dsp.distCurve(mode, drive, t.xsA, t.xsB, 129); } catch (err) { y = null; }
      if (!y || !y.length) { this.note(c, T, '—'); return; }
      ctx.beginPath();
      for (let i = 0; i < y.length; i++) {
        const px = x0 + s * i / (y.length - 1), py = y0 + s / 2 - clamp(+y[i] || 0, -1.1, 1.1) * s / 2;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.lineWidth = 2; ctx.strokeStyle = T.graph; ctx.stroke();
    }, () => [this.val('fx.dist.mode'), this.val('fx.dist.drive'), compileFxT(this.fx()).key, !!this.dsp].join());
  }
  delayDisplay() {
    const pad = 6;
    return this.display('dly', 'fxr-dlyf', 'Delay filter response', 74, D => {
      const c = this.canvas(D); if (!c) return;
      const T = theme(this.el), Y = this.frameAxes(c, T, 6, -36, pad), fr = this.freqs(c.w, pad);
      const dsp = this.dsp;
      if (!dsp || typeof dsp.delayFilterResponse !== 'function') { this.note(c, T, '—'); return; }
      let db = null;
      try { db = dsp.delayFilterResponse(lawValue('fx.dly.freq', this.val('fx.dly.freq')), lawValue('fx.dly.q', this.val('fx.dly.q')), fr, FS); } catch (err) { db = null; }
      if (db && db.length === fr.length) this.plot(c, fr, db, Y, pad, T.graph, true); else this.note(c, T, '—');
    }, () => [this.val('fx.dly.freq'), this.val('fx.dly.q'), !!this.dsp].join(), this.dragXY('fx.dly.freq', 'fx.dly.q', 'Delay Filter', pad));
  }
  eqHandles(c, pad, Y) {
    return ['L', 'H'].map(b => {
      const f = lawValue('fx.eq.freq' + b, this.val('fx.eq.freq' + b)), type = Math.round(lawValue('fx.eq.type' + b, this.val('fx.eq.type' + b)));
      const db = type === 2 ? 0 : lawValue('fx.eq.gain' + b, this.val('fx.eq.gain' + b));
      return { b, x: logX(f, c.w, pad), y: Y(db), pass: type === 2 };
    });
  }
  eqDisplay() {
    const pad = 8, dbMax = 24, dbMin = -24;
    let grab = null;
    const D = this.display('eq', 'fxr-eqd', 'EQ response', 110, D2 => {
      const c = this.canvas(D2); if (!c) return;
      const T = theme(this.el), Y = this.frameAxes(c, T, dbMax, dbMin, pad), fr = this.freqs(c.w, pad), dsp = this.dsp;
      let db = null;
      if (dsp && typeof dsp.eqResponse === 'function') {
        try { const fxp = compileFx(this.fx(), { bpm: this.bpm() }); db = dsp.eqResponse(fxp, fxp.base, fr, FS); } catch (err) { db = null; }
      }
      if (db && db.length === fr.length) this.plot(c, fr, db, Y, pad, T.graph, true);
      else this.note(c, T, '—');
      const { ctx } = c;
      for (const hd of this.eqHandles(c, pad, Y)) {
        ctx.beginPath(); ctx.arc(hd.x, clamp(hd.y, pad, c.h - pad), 6, 0, Math.PI * 2);
        ctx.fillStyle = T.bg; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = grab && grab.b === hd.b ? T.accent : T.ink; ctx.stroke();
        ctx.fillStyle = T.ink; ctx.font = '700 8px ' + T.ui; ctx.textAlign = 'center';
        if (ctx.fillText) ctx.fillText(hd.b, hd.x, clamp(hd.y, pad, c.h - pad) + 3);
        ctx.textAlign = 'left';
      }
    }, () => ['typeL', 'freqL', 'qL', 'gainL', 'typeH', 'freqH', 'qH', 'gainH'].map(k => this.val('fx.eq.' + k)).join() + !!this.dsp,
    (P0, P, phase, e) => {
      const Y = db => pad + (dbMax - db) / (dbMax - dbMin) * (P.h - 2 * pad);
      if (phase === 'start') {
        const hs = this.eqHandles({ w: P.w, h: P.h }, pad, Y);
        let best = null, bd = Infinity;
        for (const hd of hs) { const d = Math.hypot(hd.x - P0.x, hd.y - P0.y); if (d < bd) { bd = d; best = hd; } }
        if (!best || bd > 40) { grab = null; return false; }
        grab = { b: best.b, pass: best.pass, q0: this.val('fx.eq.q' + best.b), dy: best.y - P0.y, dx: best.x - P0.x };
      }
      if (!grab) return false;
      const b = grab.b, nf = lawNorm('fx.eq.freq' + b, fAtX(P.x + grab.dx, P.w, pad));
      const ny = grab.pass ? clamp(grab.q0 + (P0.y - P.y) / 120 * (e && e.shiftKey ? 0.1 : 1), 0, 1)
        : lawNorm('fx.eq.gain' + b, dbMax - ((P.y + grab.dy) - pad) / (P.h - 2 * pad) * (dbMax - dbMin));
      const yId = grab.pass ? 'fx.eq.q' + b : 'fx.eq.gain' + b;
      this.edit(fx => { fx.p['fx.eq.freq' + b] = nf; fx.p[yId] = ny; }, 'EQ ' + (b === 'L' ? 'Low' : 'High') + ' Band', phase);
      if (phase === 'end') grab = null;
      this.redraw();
      return true;
    });
    // wheel over the display = Q of the nearest band, with the widgets' rules (wk.wheelGate): only after the pointer
    // has rested on it ≥ 300 ms, trackpad travel accumulated (40 px per 0.02 step); otherwise the rack scrolls
    const take = wheelGate(D.el);
    this.offs.push(take.destroy);
    D.el.addEventListener('wheel', e => {
      if (this.dead) return;
      const k = take(e);
      if (k == null) return;
      e.preventDefault();
      if (!k) return;
      const r = D.el.getBoundingClientRect(), w = this.box(D).w, x = e.clientX - r.left - (D.el.clientLeft || 0);
      const fL = logX(lawValue('fx.eq.freqL', this.val('fx.eq.freqL')), w, pad), fH = logX(lawValue('fx.eq.freqH', this.val('fx.eq.freqH')), w, pad);
      const id = Math.abs(x - fL) <= Math.abs(x - fH) ? 'fx.eq.qL' : 'fx.eq.qH';
      const n = clamp(this.val(id) + k * (e.shiftKey ? 0.002 : 0.02), 0, 1);
      if (n === this.val(id)) return;
      this.setP(id, n, 'set');
      this.redraw();
    }, { passive: false });
    return D;
  }
  filterDisplay() {
    const pad = 6;
    return this.display('fil', 'fxr-fild', 'Filter response', 96, D => {
      const c = this.canvas(D); if (!c) return;
      const T = theme(this.el), Y = this.frameAxes(c, T, 24, -48, pad), fr = this.freqs(c.w, pad), dsp = this.dsp;
      const ty = Math.round(lawValue('fx.fil.type', this.val('fx.fil.type'))), fam = FILTERS[ty] ? FILTERS[ty].family : '';
      const fc = lawValue('fx.fil.cutoff', this.val('fx.fil.cutoff'));
      const { ctx } = c;
      const xc = logX(clamp(fc, 20, 20000), c.w, pad);
      ctx.strokeStyle = T.mute; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(xc, 0); ctx.lineTo(xc, c.h); ctx.stroke();
      if (fam === 'ring' || fam === 'snh') { this.note(c, T, fam === 'ring' ? 'Ring Mod' : 'Sample & Hold'); return; }
      if (!dsp || typeof dsp.filterImpulse !== 'function') { this.note(c, T, '—'); return; }
      let imp = null;
      try { imp = dsp.filterImpulse(ty, fc, this.val('fx.fil.res'), this.val('fx.fil.drive'), this.val('fx.fil.var'), FS, 2048); } catch (err) { imp = null; }
      if (!imp || !imp.length) { this.note(c, T, '—'); return; }
      this.plot(c, fr, impulseDb(imp, FS, fr), Y, pad, T.graph, true);
    }, () => ['type', 'cutoff', 'res', 'drive', 'var'].map(k => this.val('fx.fil.' + k)).join() + !!this.dsp, this.dragXY('fx.fil.cutoff', 'fx.fil.res', 'Filter', pad));
  }
  redraw(force) {
    for (const D of this.displays) {
      const P = this.panels[D.m];
      if (!P || P.el.hidden) continue;
      const r = D.el.getBoundingClientRect(), k = D.key() + '|' + Math.round(D.el.clientWidth || r.width || 0);
      if (!force && k === D.last) continue;
      D.last = k;
      try { D.draw(D); } catch (err) { console.warn('fx-ui: display failed', err); }
    }
  }
  drawGr() {
    const cv = this.grCv;
    if (!cv) return;
    // the canvas has its own 1 px border: draw into its padding box (64 px CSS height − 2)
    const r = cv.getBoundingClientRect(), w = Math.max(40, cv.clientWidth || (r.width ? r.width - 2 : 120)), H = Math.max(16, cv.clientHeight || 62), ctx = fitCanvas(cv, w, H);
    if (!ctx) return;
    const T = theme(this.el), g = this.host.gr ? this.host.gr() : null, mb = this.on('fx.cmp.mb');
    ctx.clearRect(0, 0, w, H); ctx.fillStyle = T.bg; ctx.fillRect(0, 0, w, H);
    const rows = mb ? [['H', 3], ['M', 2], ['L', 1]] : [['GR', 0]], rh = (H - 8) / rows.length, x0 = 22, span = w - x0 - 34;
    ctx.font = '600 9px ' + T.ui;
    rows.forEach(([lab, k], j) => {
      const y = 4 + j * rh, v = g && fin(g[k]) ? g[k] : 0, cx = mb ? x0 + span / 2 : x0, scale = mb ? span / 2 / 24 : span / 24;
      ctx.fillStyle = T.panel2; ctx.fillRect(x0, y + 2, span, rh - 4);
      const len = clamp(v, mb ? -24 : 0, 24) * scale;
      ctx.fillStyle = v >= 0 ? T.accent : T.on; // reduction (blue) / upward gain (green)
      if (mb) ctx.fillRect(len >= 0 ? cx - len : cx, y + 2, Math.abs(len), rh - 4); else ctx.fillRect(x0, y + 2, len, rh - 4);
      ctx.fillStyle = T.mute;
      if (ctx.fillText) { ctx.fillText(lab, 3, y + rh / 2 + 3); ctx.fillText((v > 0 ? '-' : v < 0 ? '+' : '') + Math.abs(v).toFixed(1), w - 32, y + rh / 2 + 3); }
    });
  }
  rendered() { const el = this.el; return el.isConnected && !(typeof el.getClientRects === 'function' && el.getClientRects().length === 0); }
  grLoop() { // ≤ 30 fps while the compressor is shown; stops when hidden (refresh() restarts it)
    const want = !!(this.host.gr && this.grCv && !this.panels.cmp.el.hidden && this.rendered());
    if (!want) { if (this.grStop) { this.grStop(); this.grStop = null; } this.drawGr(); return; }
    if (this.grStop) return;
    let last = 0;
    const tick = t => {
      this.grStop = null;
      if (this.dead || !this.rendered() || this.panels.cmp.el.hidden) return;
      if (t - last >= 33) { last = t; this.drawGr(); }
      this.grStop = frame(tick);
    };
    this.grStop = frame(tick);
  }

  /* ---------------------------------------------------------- X-Shaper popover */
  openXs(key) {
    this.closeXs();
    const A = key === 'xb' ? 'B' : 'A';
    const pop = h('div', 'fxr-xpop');
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'X-Shaper ' + A);
    const hd = h('div', 'fxr-xhead');
    hd.append(h('span', 'fxr-xtitle', 'X-SHAPER ' + A));
    const close = btn('fxr-x', '✕', 'Close');
    close.addEventListener('click', () => this.closeXs(true));
    hd.append(close);
    pop.append(hd);
    const ed = new CurveEditor(pop, {
      kind: 'xshape', label: 'X-Shaper ' + A, height: 180,
      get: () => this.fx().dist[key], set: (p, ph) => this.edit(fx => { fx.dist[key] = p; }, 'X-Shaper ' + A, ph),
      grid: () => ({ x: 8, y: 8 }), shapes: this.shapes,
    });
    pop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeXs(true); } });
    this.panels.dist.el.append(pop);
    const opener = this.xsBtns[key === 'xb' ? 1 : 0], d = Doc();
    const outside = e => { // a press outside the popover (and outside its menus / its opener) closes it
      for (let n = e.target; n; n = n.parentNode) if (n === pop || n === opener || (n.classList && n.classList.contains('wk-ctx'))) return;
      this.closeXs(false);
    };
    d.addEventListener('pointerdown', outside, true);
    this.xs = { pop, ed, key, opener, off: () => d.removeEventListener('pointerdown', outside, true) };
    ed.root.focus({ preventScroll: true });
    ed.refresh();
  }
  closeXs(refocus) {
    const x = this.xs;
    if (!x) return;
    this.xs = null;
    x.off();
    x.ed.destroy();
    x.pop.remove();
    if (refocus && x.opener && x.opener.focus) x.opener.focus({ preventScroll: true });
  }

  /* ---------------------------------------------------------- rack order */
  gripDown(e, m) {
    if (e.button !== 0 || this.drag) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
    this.drag = { m, id: e.pointerId, from: this.fx().order.indexOf(m), gap: -1, moved: false, x0: e.clientX, y0: e.clientY };
    this.tiles[m].el.classList.add('fxr-dragging');
  }
  gripMove(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 4) return;
    d.moved = true;
    const order = this.fx().order, rects = order.map(m => this.tiles[m].el.getBoundingClientRect());
    const horiz = rects.length > 1 && Math.abs(rects[1].top - rects[0].top) < 2 && rects[1].left > rects[0].left;
    let gap = 0;
    for (const r of rects) if ((horiz ? r.left + r.width / 2 : r.top + r.height / 2) < (horiz ? e.clientX : e.clientY)) gap++;
    d.gap = gap;
    const lr = this.list.getBoundingClientRect(), last = rects[rects.length - 1], ins = this.ins;
    ins.hidden = false;
    ins.classList.toggle('fxr-ins-v', horiz);
    if (horiz) { ins.style.left = ((gap < rects.length ? rects[gap].left : last.right) - lr.left - 1 + (this.list.scrollLeft || 0)) + 'px'; ins.style.top = (rects[0].top - lr.top) + 'px'; }
    else { ins.style.top = ((gap < rects.length ? rects[gap].top : last.bottom) - lr.top - 1 + (this.list.scrollTop || 0)) + 'px'; ins.style.left = '0px'; }
  }
  gripUp(e, cancel) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    this.ins.hidden = true;
    this.tiles[d.m].el.classList.remove('fxr-dragging');
    if (cancel || !d.moved || d.gap < 0) return;
    const to = d.gap > d.from ? d.gap - 1 : d.gap;
    if (to !== d.from) { this.edit(fx => { fx.order = moveModule(fx.order, d.m, to); }, 'Move FX Module'); this.refresh(); }
  }
  nudge(m, dir, focusEl) {
    const order = this.fx().order, i = order.indexOf(m), to = clamp(i + dir, 0, order.length - 1);
    if (to === i) return;
    this.edit(fx => { fx.order = moveModule(fx.order, m, to); }, 'Move FX Module');
    this.refresh();
    if (focusEl && focusEl.focus) focusEl.focus({ preventScroll: true });
  }

  /* ---------------------------------------------------------- selection / scroll */
  select(m) {
    this.edit(fx => { fx.ui = fx.ui || {}; fx.ui.sel = m; }, 'Select FX Module', 'set', { ui: true });
    this.scrollTo(m, true);
  }
  scrollTo(m, flash) {
    const P = this.panels[m];
    if (!P) return;
    if (P.el.hidden) { const t = this.tiles[m]; if (t) { t.el.classList.add('fxr-flash'); setTimeout(() => t.el.classList.remove('fxr-flash'), 600); } return; }
    const top = P.el.offsetTop;
    if (fin(top)) this.rack.scrollTop = Math.max(0, top - 4);
    if (flash) { P.el.classList.add('fxr-flash'); setTimeout(() => P.el.classList.remove('fxr-flash'), 600); }
  }

  /* ---------------------------------------------------------- menus */
  ctlMenu(e) { // non-embedded racks only: a minimal control menu (Serum's mod layer brings the full one, §9.4)
    if (e.defaultPrevented) return;
    let n = e.target, id = null;
    for (; n && n !== this.el; n = n.parentNode) if (n.getAttribute && n.getAttribute('data-dest')) { id = n.getAttribute('data-dest'); break; }
    const w = id && this.knobs.get(id);
    if (!w) return;
    e.preventDefault();
    const inst = w.el.wk;
    const items = [{ label: 'Reset Control', action: () => { this.setP(id, defOf(id), 'set'); this.refresh(); } }];
    if (inst && typeof inst.edit === 'function') items.push({ label: 'Enter Value…', action: () => inst.edit() });
    contextMenu(e.clientX, e.clientY, items, { anchor: w.el });
  }
  chains() {
    const l = this.storeGet('synth.fxchains', []);
    return Array.isArray(l) ? l.filter(c => c && typeof c.name === 'string' && c.fx && typeof c.fx === 'object') : [];
  }
  rackMenu() {
    const fx = this.fx(), chains = this.chains();
    // Factory ▸ = serum-core FACTORY_CHAINS (read-only, never stored), then the user's library
    const fac = core.FACTORY_CHAINS ? core.FACTORY_CHAINS.chains : [];
    const load = fac.length ? [{ label: 'Factory', sub: fac.map(c => ({ label: c.name, action: () => this.loadChain(c.fx, c.name) })) }, { sep: true }] : [];
    for (const c of chains) load.push({ label: c.name, action: () => this.loadChain(c.fx, c.name) });
    if (chains.length) load.push({ sep: true });
    load.push({ label: 'Import from File…', action: () => this.importChain() });
    if (chains.length) load.push({ label: 'Export All to File…', action: () => this.exportAll() });
    const items = [
      { label: 'Lock FX Rack', checked: !!fx.lock, action: () => { this.edit(f => { f.lock = f.lock ? 0 : 1; }, 'Lock FX Rack', 'set'); this.refresh(); } },
      { sep: true },
      { label: 'Load Effect Chain…', sub: load },
      { label: 'Save Effect Chain…', action: () => this.saveChain() },
      { label: 'Export Effect Chain…', action: () => this.exportChain() },
    ];
    if (chains.length) items.push({ label: 'Delete Effect Chain', sub: chains.map(c => ({ label: c.name, action: () => this.delChain(c.name) })) });
    items.push({ sep: true }, { label: 'Reset Rack', action: () => this.resetRack() });
    return items;
  }
  chainCopy(fx) { const c = normalizeFx(fx); delete c.ui; delete c.lock; return c; }
  // §9.6: replaces everything but ui / lock and compiles with seed; locked FX parameters (Serum's parameter locks,
  // host.locked) keep their values, as with module presets, preset loads (applyPresetFx) and SerumUI's main-menu command
  loadChain(src, name) {
    const n = normalizeFx(src), locked = this.lockedIds();
    this.edit(fx => {
      const ui = fx.ui, lock = fx.lock, keep = {};
      for (const id of locked) if (fx.p && Number.isFinite(fx.p[id])) keep[id] = fx.p[id];
      for (const k of Object.keys(fx)) delete fx[k];
      Object.assign(fx, n);
      Object.assign(fx.p, keep);
      if (ui !== undefined) fx.ui = ui;
      if (lock !== undefined) fx.lock = lock;
    }, 'Load Effect Chain', 'set', { seed: true });
    this.refresh();
    if (name) this.notify('Effect chain “' + name + '” loaded');
  }
  saveChain() {
    const name = ask('Save effect chain as', '');
    if (!name || !name.trim()) return;
    const nm = name.trim().slice(0, 48), list = this.chains().filter(c => c.name !== nm);
    list.push({ name: nm, fx: this.chainCopy(this.fx()) });
    list.sort((a, b) => a.name.localeCompare(b.name));
    this.storeSet('synth.fxchains', list);
    this.notify('Effect chain “' + nm + '” saved');
  }
  delChain(name) { this.storeSet('synth.fxchains', this.chains().filter(c => c.name !== name)); this.notify('Effect chain “' + name + '” deleted'); }
  // Effect-chain files: the library form { type: 'synth.fxchains', v: 1, chains: [{ name, fx }] } (the same format
  // as SerumUI's "Export All to File…"); "Export Effect Chain…" writes the current rack as a one-element library.
  chainFile(chains) { return JSON.stringify({ type: 'synth.fxchains', v: 1, chains }, null, 1); }
  exportChain() {
    const base = (ask('Export effect chain as', 'Effect Chain') || '').trim().slice(0, 48);
    if (!base) return;
    saveFile(base.replace(/[\\/:*?"<>|]+/g, '_') + '.fxchains.json', this.chainFile([{ name: base, fx: this.chainCopy(this.fx()) }]));
  }
  exportAll() { saveFile('effect-chains.json', this.chainFile(this.chains())); }
  importChain() {
    return pickFile('.json,application/json').then(f => (f && typeof f.text === 'function' ? f.text().then(t => this.importText(t, f.name)) : null))
      .catch(err => { this.notify('Could not import the effect chain'); console.warn('fx-ui: import failed', err); });
  }
  // Merges the chains of a file into synth.fxchains by name (never loads one: that is the Load menu's job). Accepts
  // the library form ({ chains: [{ name, fx }] }) and, for older files, a single chain ({ name, fx }, named after the
  // file when nameless) or a bare fx state. Returns the number of chains added; throws when the file has none.
  importText(t, fileName) {
    const j = JSON.parse(t), ok = c => c && typeof c.fx === 'object' && c.fx && typeof c.fx.p === 'object' && c.fx.p;
    const fileBase = String(fileName || '').replace(/(\.fxchains?)?\.json$/i, '').trim() || 'Imported Chain';
    let add;
    if (j && Array.isArray(j.chains)) add = j.chains.filter(c => ok(c) && typeof c.name === 'string' && c.name.trim());
    else if (ok(j)) add = [{ name: typeof j.name === 'string' && j.name.trim() ? j.name : fileBase, fx: j.fx }];
    else if (j && typeof j === 'object' && j.p && typeof j.p === 'object') add = [{ name: fileBase, fx: j }];
    else add = [];
    if (!add.length) throw new Error('no effect chains in that file');
    const m = new Map(this.chains().map(c => [c.name, c]));
    for (const c of add) { const name = c.name.trim().slice(0, 48); m.set(name, { name, fx: this.chainCopy(c.fx) }); }
    this.storeSet('synth.fxchains', [...m.values()].sort((a, b) => a.name.localeCompare(b.name)));
    this.notify(add.length === 1 ? 'Effect chain “' + add[0].name.trim().slice(0, 48) + '” imported' : add.length + ' effect chains imported');
    return add.length;
  }
  // §9.6: defaultFx() keeping only `ui` (the rack lock is reset too)
  resetRack() {
    const d = defaultFx();
    this.edit(fx => {
      const ui = fx.ui;
      for (const k of Object.keys(fx)) delete fx[k];
      Object.assign(fx, d);
      if (ui !== undefined) fx.ui = ui;
    }, 'Reset Rack', 'set', { seed: true });
    this.refresh();
  }
  modPresets(m) {
    const l = this.storeGet('synth.fxmod.' + m, []);
    return Array.isArray(l) ? l.filter(p => p && typeof p.name === 'string' && p.p && typeof p.p === 'object') : [];
  }
  modMenu(m) {
    const list = this.modPresets(m), items = [{ label: 'Save Effect Settings…', action: () => this.saveModPreset(m) }];
    if (list.length) {
      items.push({ sep: true }, ...list.map(p => ({ label: p.name, action: () => this.applyModPreset(m, p) })),
        { label: 'Delete Settings', sub: list.map(p => ({ label: p.name, action: () => this.storeSet('synth.fxmod.' + m, this.modPresets(m).filter(q => q.name !== p.name)) })) });
    }
    items.push({ sep: true }, { label: 'Init Module', action: () => this.applyModPreset(m, modulePresetPayload(defaultFx(), m, 'Init')) });
    return items;
  }
  saveModPreset(m) {
    const name = ask('Save ' + moduleTitle(m) + ' settings as', '');
    if (!name || !name.trim()) return;
    const nm = name.trim().slice(0, 48), list = this.modPresets(m).filter(p => p.name !== nm);
    list.push(modulePresetPayload(this.fx(), m, nm));
    list.sort((a, b) => a.name.localeCompare(b.name));
    this.storeSet('synth.fxmod.' + m, list);
    this.notify(moduleTitle(m) + ' settings “' + nm + '” saved');
  }
  applyModPreset(m, payload) {
    const locked = this.lockedIds();
    this.edit(fx => {
      const n = applyModulePreset(fx, Object.assign({}, payload, { m }), locked);
      fx.p = n.p;
      if (SUBS[m]) fx[m] = n[m];
    }, payload.name === 'Init' ? 'Init ' + moduleTitle(m) : 'Load ' + moduleTitle(m) + ' Settings', 'set', { seed: true });
    this.refresh();
  }

  /* ---------------------------------------------------------- refresh / lifecycle */
  schedule() {
    if (this.pending || this.dead) return;
    this.pending = frame(() => { this.pending = null; this.refresh(); });
  }
  refresh() {
    if (this.dead) return;
    if (this.pending) { this.pending(); this.pending = null; }
    const fx = this.fx(), order = Array.isArray(fx.order) && fx.order.length === MODS.length ? fx.order : MODS;
    // DOM order follows fx.order (tiles before the insertion marker; panels after the empty notice)
    const tiles = order.map(m => this.tiles[m].el), panels = order.map(m => this.panels[m].el);
    const kids = Array.from(this.list.children);
    if (tiles.some((t, i) => kids[i] !== t)) { const f = Doc().activeElement; for (const t of tiles) this.list.insertBefore(t, this.ins); if (f && f.focus && this.el.contains(f)) f.focus({ preventScroll: true }); }
    const rk = Array.from(this.rack.children);
    if (panels.some((p, i) => rk[i + 1] !== p)) for (const p of panels) this.rack.append(p);
    let any = false;
    for (const m of MODS) {
      const on = this.on('fx.' + m + '.on'), byp = !!(fx.byp && fx.byp[m]), P = this.panels[m], T = this.tiles[m];
      any = any || on;
      show(P.el, on);
      P.el.classList.toggle('fxr-byp', byp);
      T.el.classList.toggle('fxr-on', on);
      T.el.classList.toggle('fxr-byp', byp);
      T.el.classList.toggle('fxr-sel', !!(fx.ui && fx.ui.sel === m));
    }
    show(this.empty, !any);
    const mode = Math.round(lawValue('fx.dist.mode', this.val('fx.dist.mode'))), xsOn = mode === 11 || mode === 12;
    for (const b of this.xsBtns) { b.disabled = !xsOn; b.classList.toggle('wk-dis', !xsOn); }
    if (!xsOn && this.xs) this.closeXs();
    show(this.mbBox, this.on('fx.cmp.mb'));
    for (const w of this.widgets) w.update();
    if (this.xs) this.xs.ed.refresh();
    this.redraw();
    this.grLoop();
  }
  destroy() {
    if (this.dead) return;
    this.dead = true;
    if (this.pending) this.pending();
    if (this.grStop) this.grStop();
    this.closeXs();
    for (const w of this.widgets) if (w.destroy) w.destroy();
    for (const f of this.offs) f();
    this.knobs.clear();
    this.el.remove();
  }
}
