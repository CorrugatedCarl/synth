// rig-ui.js — the rig's module faces (docs/canvas/IMPL-WC.md §3.0, §3.1, §3.2, §3.8, §11.1; stage WC lane F): one layout system for
// every module, so the family reads as one — the RIG grid's numbers (GRID: the ONE place a layout number lives — rig-grid.js since the
// Effects panel's faces share it (FX look, 2026-10-26), re-exported here; the injected CSS is generated from it, a recipe never carries a
// pixel, a skin never a number), the row recipes per module kind (FACE), the face
// builder over the rig's SerumHost, the jack row, the ⚙ drawer and the jack row's tap menu (the cord drag is cv-cables', lane C).
//   GRID            unit 8 · column 64 · side padding 16 (width 64·n + 32) · top 12 / bottom 16 · row gap 12 · rows head 32,
//                   screen 112 | 128, knobs 76, switches 32, jacks 56 · the knob cell 64 × 76 (a 40 px knob 4 px from the top, 6 px,
//                   an 11 px label in a 14 px line, a 10 px value in a 12 px line) · a box (num / toggle / menu) 28 px tall at the
//                   knob's centre line · a jack 28 px 4 px from the row top, 6 px, a 12 px line of 10 px text, 6 px · hits 44 px
//   FACE[kind]      { cols, rows: [{ t: 'head' | 'screen' | 'knobs' | 'switches' | 'jacks', h (px, from GRID), items }] } — items
//                   are the widgets by data-dest ('@' = the slot's prefix: 'a' / 'f2' / 'e3' / 'l7'), '#name' a named piece of
//                   the kind's builder, 'x|y' alternates sharing one cell (a cell whose every member is hidden shows its first one
//                   dimmed: never a hole), ':n' a span of n columns, a trailing '*' a head item that grows, '<port' / '>port' a
//                   jack (input / output). Variants: 'osc.sample', 'osc.kit' (multi / granular / spectral: the kit's type view in
//                   the screen frame until WC-2), 'env.amp' (Envelope 1: no START / END)
//   layoutOf(recipe) → { w, h, rows: [{ t, top, h, cells: [{ items, col, span, cx }] }] }     the geometry, pure (the tests' and G11's)
//   rigHost(deps)   → { face(kind, root, args) → View, jackMenu(jack, el, x, y) → handle | null (cv-cables' createCableDrag option),
//                       press(e, el) → false (declines: the drag is cv-cables'), applySkin(worldEl, id), FACE, GRID, sizeOf(kind, part)
//                       → { w, h }, layoutOf, endOf / jackKey }
//     face args     { host: the rig's SerumHost (main.js's record), part ('voice' | 'oscB' | 'filter2' | 'env3' | 'lfo7' | 'sub' |
//                   'noise' | 'macros'), shown: () => on screen (cv-module's plan), dev ('i1'), opts (kit options; the Macros' tiles
//                   are 'jack' always), levelPlugged?: () => an Envelope holds the Amplifier's LEVEL (default: ENV 1 is not the gate) }
//     View          the host's View (sx-host mount) + { el: the face, face: { kind, variant, cols, w, h }, jacks: Map(port → el),
//                   dests(): the face's data-dest ids, drawer: { open(), close(), el } | null }
//   The widgets come from the kit's panel classes, built as donors on the face's page (OscPanel, SubPanel, NoisePanel, FilterPanel,
//   EnvPanel, LfoPanel, MacrosPanel, VoicingPanel, OutputsPanel): the same bindings (data-dest, halos, knob menus, MIDI learn,
//   locks, panel undo), the same extra menus, alternates and label functions; every data-dest the stage-3 panel shows is on the face
//   (G11's parity) — the panels' own compositions (rows, sizes, heads, panes) are discarded. A control the grid has no place for goes
//   into the head's ⚙ drawer (built with the face, inside it and hidden until opened: never dropped). A few knobs are made fresh where a
//   knob reads better on the grid than the kit's widget (the Filter's LEVEL slider, the outputs' faders) or the kit has none (the
//   Amplifier's LEVEL = g.amp, the unison WIDTH); the donor's own widget then stays outside the face (bound, never shown).
//   Jacks: span.rig-jack.cv-jack.cv-fjack[data-jack=<port>][data-cv-awake] at the column centre — cv-module's inline anchors (rigJacks /
//   measureInline: the jack's data-cv-jack / data-kind / data-dir / data-cord / data-sig moved onto it) — with the label line under it (a Σ input's label ends in Σ; the Amplifier's LEVEL prints its normal, KEYS, struck through while an
//   Envelope is plugged). The Amplifier's OUT is cv-module's right-edge jack (its line to the FX panel attaches at the edge, as every
//   line does): its four inputs fill its four columns.
// Browser ES module: nothing touches document / window at module top level (node-tested on the fake DOM: tests/rig-ui.test.mjs; the
// layout gate in headless Chrome: tests/ui-layout-wc.mjs).
import * as wk from './wk.js?v=9';
import * as core from './serum-core.js?v=9';
import * as OSC from './sx-ui-osc.js?v=9';
import * as MOD from './sx-ui-mod.js?v=9';
import * as RC from './rig-core.js?v=9';
import { GRID, rowH, faceW, layoutOf, cssText, CSS_ID, ensureRigCSS, gridVars, deepFreeze } from './rig-grid.js?v=9';
export { GRID, rowH, faceW, layoutOf, cssText, CSS_ID, ensureRigCSS, gridVars };

const fin = x => typeof x === 'number' && isFinite(x);
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const arr = x => (Array.isArray(x) ? x : []);
const call = (f, ...a) => { if (typeof f !== 'function') return undefined; try { return f(...a); } catch (err) { console.error(err); return undefined; } };
const listen = (t, type, fn, opt) => { t.addEventListener(type, fn, opt); return () => t.removeEventListener(type, fn, opt); };

/* ================================================================ the recipes (§3.1) — on the RIG grid (§3.8: rig-grid.js, re-exported above) */
const R = (t, items, h) => (h ? { t, h, items } : { t, items });
// the rows the three Oscillator variants share (only the type cells differ: T1 row 1 col 5, T2 / T3 row 2 cols 4–5)
const OSC_ROWS = (t1, t2, t3) => [R('knobs', ['@.oct|#src', '@.semi|@.ratio', '@.fine', '@.crs', t1]), R('knobs', ['@.uni', '@.det', '@.blend', t2, t3]),
  R('knobs', ['@.warp', '@.warp2', '@.uniw', '@.pan', '@.level'])];
const RECIPES = {
  // ((WC, lane H) no '#voices' in the head: the engine's oscillator-voice count "0 / 400" (poly × 16-voice unison × sources) means nothing on a rig face)
  amp: { cols: 4, rows: [R('head', ['#undo', '#redo', '#meter*', '#gear']), R('knobs', ['#poly', 'g.porta', 'g.curve', 'g.amp']),
    R('switches', ['#mono', '#legato', '#always', '#scaled']), R('knobs', ['g.master', 'g.direct', 'g.bus1v', 'g.bus2v']), R('jacks', ['<main', '<direct', '<note', '<level'])] },
  osc: { cols: 5, rows: [R('head', ['#type', '#name*', '#edit', '#gear']), R('screen', ['#display', '#warps'], 'L'), ...OSC_ROWS('@.wt', '@.phase', '@.rand'), R('jacks', ['<warp', '>out'])] },
  'osc.sample': { cols: 5, rows: [R('head', ['#type', '#name*', '#load', '#missing', '#gear']), R('screen', ['#display', '#warps'], 'L'),
    ...OSC_ROWS('@.scan|@.lenrate', '@.sstart', '@.send'), R('knobs', ['#loop', '@.lstart', '@.lend', '@.xfade', '@.slice']), R('jacks', ['<warp', '>out'])] },
  'osc.kit': { cols: 5, rows: [R('head', ['#type', '#name*', '#gear']), R('screen', ['#view', '#warps'], 'K'), ...OSC_ROWS('@.hz', '@.rwarp', '@.rwarp2'), R('jacks', ['<warp', '>out'])] },
  sub: { cols: 3, rows: [R('head', ['#shape*', '#glyph']), R('knobs', ['@.oct', '@.crs', '@.phase']), R('knobs', ['@.track', '@.pan', '@.level']),
    R('knobs', ['@.fbal', '@.bus1', '@.bus2']), R('jacks', ['>out'])] },
  noise: { cols: 3, rows: [R('head', ['#source*', '#oneshot', '#gear']), R('knobs', ['@.pitch', '@.fine', '@.phase|@.stereo']), R('knobs', ['@.rand|@.color', '@.pan', '@.level']),
    R('knobs', ['@.fbal', '@.bus1', '@.bus2']), R('jacks', ['>out'])] },
  filter: { cols: 5, rows: [R('head', ['#type*', '#pz', '#clean', '#gear']), R('screen', ['#display']), R('knobs', ['@cutoff', '@res', '@drive', '@var', '@mix']),
    R('knobs', ['#key', '@x', '@y', '@pan', '@level']), R('switches', ['#srcA', '#srcB', '#srcC', '#srcN', '#srcS']), R('jacks', ['<in', '>out'])] },
  env: { cols: 5, rows: [R('head', ['#bpm', '#lock', '#zoom*']), R('screen', ['#editor']), R('knobs', ['@.att', '@.hold', '@.dec', '@.sus', '@.rel']),
    R('knobs', ['@.ca', '@.cd', '@.cr', '#start', '#end']), R('jacks', ['>out'])] },
  'env.amp': { cols: 5, rows: [R('head', ['#bpm', '#lock', '#zoom*']), R('screen', ['#editor']), R('knobs', ['@.att', '@.hold', '@.dec', '@.sus', '@.rel']),
    R('knobs', ['@.ca', '@.cd', '@.cr']), R('jacks', ['>out'])] },
  lfo: { cols: 5, rows: [R('head', ['#type', '#dir', '#grid', '#shapes', '#gear']), R('screen', ['#editor'], 'L'), R('knobs', ['@.rate', '@.rise', '@.delay', '@.smooth', '@.phase']),
    R('switches', ['#mode:3', '#bpm', '#mono']), R('jacks', ['>out'])] },
  macros: { cols: 4, rows: [R('head', ['#hint*']), R('knobs', ['#m1', '#m2', '#m3', '#m4']), R('knobs', ['#m5', '#m6', '#m7', '#m8'])] },
};
/** The recipes with their row heights (data; frozen): FACE[kind] = { cols, rows: [{ t, h, items }] }. */
export const FACE = deepFreeze(Object.fromEntries(Object.entries(RECIPES).map(([k, r]) => [k, { cols: r.cols, rows: r.rows.map(x => ({ t: x.t, h: x.h === 'K' ? null : rowH(x.t, x.h), items: x.items.slice() })) }])));
/** The face kinds (MODULES' WC-1 kinds) and the recipe of a kind / part / oscillator type. */
export const KINDS = Object.freeze(['amp', 'osc', 'sub', 'noise', 'filter', 'env', 'lfo', 'macros']);
export function variantOf(kind, o) {
  const O = o || {};
  if (kind === 'osc') return O.type === 'sample' ? 'osc.sample' : O.type && O.type !== 'wt' ? 'osc.kit' : 'osc';
  if (kind === 'env') return O.k === 0 ? 'env.amp' : 'env';
  return kind;
}
/** A face's size (world px) by kind and part ('env1' → Envelope 1's variant; an oscillator: its Wavetable layout — a type switch
 * re-lays it and cv-module re-measures). */
export function sizeOf(kind, part) {
  const v = variantOf(kind, { k: part === 'env1' ? 0 : 1 }), L = layoutOf(FACE[v]);
  return { w: L.w, h: L.h };
}

/* ================================================================ the face builder */
const mk = (d, tag, cls, text) => { const e = d.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const hidden = el => !!el && ((el.classList && el.classList.contains('sx-hidden')) || (el.style && el.style.display === 'none'));
const q = (el, s) => (el && el.querySelector ? el.querySelector(s) : null);
const qa = (el, s) => (el && el.querySelectorAll ? Array.from(el.querySelectorAll(s)) : []);
const kids = el => (el && el.children ? Array.from(el.children) : []);
const hasCls = (e, c) => !!e && !!e.classList && e.classList.contains(c);
const noDest = e => !!e && !e.getAttribute('data-dest');
const flat = x => (Array.isArray(x) ? x.flatMap(flat) : x ? [x] : []);
// the first element with data-dest id among roots (elements, attached or not)
function findDest(roots, id) {
  const s = '[data-dest="' + id + '"]';
  for (const r of roots) {
    if (!r || typeof r.querySelector !== 'function') continue;
    if (r.getAttribute && r.getAttribute('data-dest') === id) return r;
    const e = r.querySelector(s);
    if (e) return e;
  }
  return null;
}
const btnEl = (d, cls, text, title, fn) => {
  const b = mk(d, 'button', cls, text);
  b.type = 'button';
  if (title) { b.title = title; b.setAttribute('aria-label', title); }
  if (fn) b.addEventListener('click', fn);
  return b;
};
const SVGNS = 'http://www.w3.org/2000/svg';
// an icon button: its strokes drawn from a path list (no innerHTML)
function iconBtn(d, cls, paths, title, fn) {
  const b = btnEl(d, 'sx-hbtn ' + cls, null, title, fn), sv = d.createElementNS(SVGNS, 'svg');
  sv.setAttribute('viewBox', '0 0 16 16'); sv.setAttribute('aria-hidden', 'true');
  for (const p of paths) { const e = d.createElementNS(SVGNS, p[0]); for (const [k, v] of Object.entries(p[1])) e.setAttribute(k, v); sv.appendChild(e); }
  b.appendChild(sv);
  return b;
}
const GEAR = [['circle', { cx: 8, cy: 8, r: 2.4 }], ['path', { d: 'M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4' }]];
const UNDO = [['path', { d: 'M5.5 4.5 2.5 7.5l3 3' }], ['path', { d: 'M2.5 7.5h7a3.5 3.5 0 0 1 0 7H8' }]];
const REDO = [['path', { d: 'M10.5 4.5l3 3-3 3' }], ['path', { d: 'M13.5 7.5h-7a3.5 3.5 0 0 0 0 7H8' }]];
// the knob labels the grid prints in our words (the kit's own label stays the widget's aria name); a kit label function (SEM's
// HARM / STEP, the Filter's VAR) is never relabelled
const RELABEL = { '@.semi': 'SEMI', '@.fine': 'FINE', '@.crs': 'COARSE', 'g.porta': 'GLIDE' };
function relabel(el, text) {
  const lab = q(el, '.wk-lab');
  if (lab && lab.setAttribute && lab.getAttribute('data-l') !== text) lab.setAttribute('data-l', text);
}

// The face of one module, built into the view's page (K the host's kit): the builder makes its donor(s) and names its pieces, then
// the recipe is laid; an oscillator re-lays on a type switch. → the panel object the host's View holds.
function buildFace(kind, K, A, V, host) {
  const d = K.doc, part = String(A.part || ''), pv = MOD.partView(kind === 'amp' ? 'voice' : part) || { k: 0 }, k = pv.k | 0;
  ensureRigCSS(d);
  const B = BUILDERS[kind];
  const ctx = { kind, part, k, K, A, V, host, d, roots: [], pieces: {}, fresh: {}, own: {}, menuItems: () => [], destroyers: [], donors: [],
    power: null, module: null, shell: null, drawerItems: null, jacks: new Map(), managed: [], cells: [] };
  ctx.title = B.title(ctx);
  B.build(ctx);
  // the face's root: the donor's bare shell (its ⏻ handed to the bar, its module menu and label drag, its off / locked classes), else a
  // section of our own
  const el = ctx.shell ? ctx.shell.el : mk(d, 'section', 'sx-panel sx-bare');
  if (ctx.shell) { ctx.power = ctx.shell.power || null; ctx.module = ctx.shell.module || null; }
  el.textContent = '';
  el.classList.add('rig-face');
  el.setAttribute('data-rig-kind', kind);
  el.setAttribute('aria-label', ctx.title);
  ctx.el = el;
  ctx.park = mk(d, 'div', 'rig-park');
  ctx.park.setAttribute('aria-hidden', 'true');
  ctx.drawerEl = mk(d, 'div', 'rig-drawer');
  ctx.roots.push(ctx.park, ctx.drawerEl); // (a re-lay finds what an earlier one parked)
  lay(ctx, B.variant ? B.variant(ctx) : variantOf(kind, { k }));
  if (B.variant) K.custom(() => { const v = B.variant(ctx); if (v !== ctx.variant) lay(ctx, v); });
  return {
    el, power: ctx.power, module: ctx.module, ctx,
    get face() { return ctx.meta; },
    menuItems: () => arr(call(ctx.menuItems)),
    destroy: () => {
      closeDrawer(ctx);
      for (const f of ctx.destroyers) call(f);
      for (const p of ctx.donors) if (p && typeof p.destroy === 'function' && p.el !== el) { try { p.destroy(); } catch (err) { /* gone */ } }
      el.remove();
    },
  };
}
// (re)lays variant v: every managed element goes to the park first, then the rows take theirs (a type switch moves only what it must;
// every widget keeps its binding and state)
function lay(ctx, v) {
  const { d, K, el } = ctx, recipe = FACE[v], L = layoutOf(recipe);
  ctx.variant = v;
  for (const e of ctx.managed) ctx.park.appendChild(e);
  el.textContent = '';
  ctx.managed = [];
  ctx.cells = [];
  ctx.jacks.clear();
  el.style.setProperty('--rig-n', String(recipe.cols));
  el.setAttribute('data-rig-variant', v);
  const take = e => { ctx.managed.push(e); return e; };
  L.rows.forEach((row, ri) => {
    const re = mk(d, 'div', 'rig-row rig-' + row.t);
    re.setAttribute('data-row', String(ri));
    if (row.t === 'screen') re.setAttribute('data-h', recipe.rows[ri].h == null ? 'K' : recipe.rows[ri].h === GRID.rows.screenL ? 'L' : 'S');
    if (row.t === 'head' || row.t === 'screen') {
      for (const c of row.cells) for (const e of flat(resolve(ctx, c.alts[0]))) { if (c.grow && e.classList) e.classList.add('rig-grow'); re.appendChild(take(e)); }
    } else if (row.t === 'jacks') {
      for (const c of row.cells) {
        const ce = mk(d, 'div', 'rig-cell');
        ce.style.gridColumn = (c.col + 1) + ' / span 1';
        ce.append(...jackOf(ctx, c.jack, re));
        re.appendChild(ce);
      }
    } else {
      for (const c of row.cells) {
        const ce = mk(d, 'div', 'rig-cell');
        ce.style.gridColumn = (c.col + 1) + ' / span ' + c.span;
        const groups = c.alts.map(a => flat(resolve(ctx, a))).filter(g => g.length);
        for (const g of groups) for (const e of g) ce.appendChild(take(e));
        if (groups.length) ctx.cells.push({ el: ce, ms: groups.map(g => g[0]) });
        re.appendChild(ce);
      }
    }
    el.appendChild(re);
  });
  if (ctx.onLay) call(ctx.onLay, v);
  // a widget of the kit panel's own DOM the recipe does not place (a slot's RAND of a granular warp on a Wavetable, ENV 2's START on
  // Envelope 1) stays on the face, parked and hidden as the kit hid it — unless the face shows its id already (a fresh knob)
  const on = new Set(qa(el, '[data-dest]').map(e => e.getAttribute('data-dest')));
  for (const r of ctx.inline || []) for (const e of qa(r, '[data-dest]')) {
    const id = e.getAttribute('data-dest');
    if (el.contains(e) || on.has(id) || (e.parentNode && e.parentNode.closest && e.parentNode.closest('[data-dest]'))) continue;
    ctx.park.appendChild(e); ctx.managed.push(e); on.add(id);
  }
  // the drawer's controls live in the face, hidden, until ⚙ opens it (never dropped: their data-dest stays on the face)
  fillDrawer(ctx, recipe.cols);
  el.append(ctx.drawerEl, ctx.park);
  ctx.meta = Object.freeze({ kind: ctx.kind, variant: v, cols: recipe.cols, w: L.w, h: L.h });
  if (ctx.V) ctx.V.face = ctx.meta;
  // the dim policy, after the kit's own visibility binds (registered later: it runs after them in every paint)
  if (!ctx.dimBound) {
    ctx.dimBound = true;
    K.custom(() => {
      for (const c of ctx.cells) {
        const dim = c.ms.every(hidden);
        if (dim !== c.el.hasAttribute('data-dim')) { if (dim) c.el.setAttribute('data-dim', ''); else c.el.removeAttribute('data-dim'); }
      }
    });
  }
}
// a recipe item → its element(s): a named piece, else the donor's widget with that data-dest, else a fresh knob (the kind's labels)
function resolve(ctx, a) {
  if (a.name) { const p = ctx.pieces[a.name]; return typeof p === 'function' ? p() : p || null; }
  const id = String(a.id).replace(/^@/, ctx.prefix || '');
  const e = ctx.fresh[a.id] !== undefined ? null : findDest(ctx.roots, id);
  if (!e) return freshKnob(ctx, a.id, id);
  if (RELABEL[a.id]) relabel(e, RELABEL[a.id]);
  return e;
}
function freshKnob(ctx, key, id) {
  if (ctx.own[id]) return ctx.own[id];
  if (core.DEST_INDEX[id] === undefined) return null;
  const f = ctx.fresh[key], o = { label: typeof f === 'string' ? f : f && f.label ? f.label : key.replace(/^@\.?/, '').toUpperCase() };
  if (f && f.disabled) o.disabled = f.disabled;
  const w = f && f.toggle ? ctx.K.toggle(id, { label: o.label, kind: 'btn', disabled: o.disabled }) : ctx.K.knob(id, o);
  ctx.own[id] = w.el;
  return w.el;
}
// a jack of the jack row: span.rig-jack.cv-jack.cv-fjack[data-jack] (cv-module's inline anchor: measured, its attributes moved onto
// it) + its label line → [jack, label]
function jackOf(ctx, J, rowEl) {
  const d = ctx.d, M = RC.MODULES[ctx.kind] || {}, all = arr(M.jacks && M.jacks.in).concat(arr(M.jacks && M.jacks.out));
  const spec = all.find(j => j.id === J.port) || { id: J.port, label: J.port.toUpperCase(), kind: 'audio' };
  const je = mk(d, 'span', 'rig-jack cv-jack cv-fjack'), name = ctx.title + ' · ' + spec.label;
  je.setAttribute('data-jack', J.port);
  je.setAttribute('data-rig-dir', J.dir);
  je.setAttribute('aria-label', name);
  je.title = name + (spec.sum ? ' (any number of cords)' : '') + (spec.ro ? ' (shows the oscillators that warp or modulate this one)' : '');
  if (spec.ro) je.setAttribute('data-ro', '');
  if (spec.sum) je.setAttribute('data-sum', '');
  je.setAttribute('data-rig-sig', spec.kind || 'audio'); // (audio | mod | note | warp: the glue's, whatever kind cv-module gives the jack)
  je.setAttribute('data-cv-awake', ''); // (a rig jack patches at every zoom a line jack does: cv-world's cordAsleep exempts it, §3.2)
  const jl = mk(d, 'span', 'rig-jl', spec.label + (spec.sum ? ' Σ' : ''));
  if (spec.normal) {
    jl.appendChild(mk(d, 'span', 'rig-nrm', spec.normal));
    const D = core.DESTS[core.DEST_INDEX['vc.escale']];
    ctx.K.custom(() => {
      const s = ctx.K.s(), on = ctx.A.levelPlugged ? !!call(ctx.A.levelPlugged) : !RC.isGate(s);
      if (on !== rowEl.hasAttribute('data-plugged')) { if (on) rowEl.setAttribute('data-plugged', ''); else rowEl.removeAttribute('data-plugged'); }
      const sc = s && s.p ? s.p['vc.escale'] : undefined, scaled = fin(sc) && D && Math.abs(sc - D.def) > 1e-9;
      const t = on ? 'LEVEL: an Envelope shapes the level (pull its cord: the keys gate it again)'
        : 'LEVEL: gated by the keys until an Envelope is plugged here · ' + RC.RIG.GATE_MS + ' ms ramps' + (scaled ? ' · scaled by the voice control\u2019s envelope scaling (⚙)' : '');
      if (je.title !== t) je.title = t;
    });
  }
  ctx.jacks.set(J.port, je);
  return [je, jl];
}

/* ---------------------------------------------------------------- the ⚙ drawer */
function gearBtn(ctx) {
  if (ctx.gear) return ctx.gear;
  const b = iconBtn(ctx.d, 'rig-gear', GEAR, ctx.title + ' settings', () => (ctx.open ? closeDrawer(ctx) : openDrawer(ctx)));
  b.setAttribute('aria-haspopup', 'dialog');
  b.setAttribute('aria-expanded', 'false');
  ctx.gear = b;
  return b;
}
const isCellCtl = e => hasCls(e, 'wk-knob') || hasCls(e, 'wk-nb') || hasCls(e, 'sx-nf');
// the drawer's groups ({ title, items }) → titled lines: knobs / nums in cells, the rest wrapping in a line
function fillDrawer(ctx, cols) {
  const d = ctx.d, D = ctx.drawerEl;
  D.textContent = '';
  D.setAttribute('role', 'dialog');
  D.setAttribute('aria-label', ctx.title + ' settings');
  D.style.setProperty('--rig-dn', String(cols));
  for (const g of arr(ctx.drawerItems)) {
    const els = flat(arr(typeof g.items === 'function' ? g.items() : g.items));
    if (!els.length) continue;
    if (g.title) D.appendChild(mk(d, 'div', 'rig-dt', g.title));
    let line = null;
    for (const e of els) {
      if (isCellCtl(e)) { const ce = mk(d, 'div', 'rig-cell'); ce.appendChild(e); D.appendChild(ce); line = null; }
      else { if (!line) { line = mk(d, 'div', 'rig-dline'); D.appendChild(line); } line.appendChild(e); }
    }
  }
}
function openDrawer(ctx) {
  const H = ctx.host, D = ctx.drawerEl, g = ctx.gear, d = ctx.d;
  if (!D || !D.firstChild || ctx.open) return;
  const L = typeof H.layerEl === 'function' ? H.layerEl() : ctx.el;
  const r = g && g.getBoundingClientRect ? g.getBoundingClientRect() : { left: 0, right: 0, bottom: 0, top: 0 };
  const win = d.defaultView || globalThis, vw = +win.innerWidth || 1024, vh = +win.innerHeight || 768;
  const sk = ctx.el.closest ? ctx.el.closest('[data-cv-skin]') : null; // (the top layer is outside #world: the drawer carries the skin itself)
  if (sk) D.setAttribute('data-cv-skin', sk.getAttribute('data-cv-skin')); else D.removeAttribute('data-cv-skin');
  D.style.visibility = 'hidden';
  L.appendChild(D);
  const w = D.offsetWidth || faceW(5), h = D.offsetHeight || 200;
  D.style.left = Math.round(Math.max(8, Math.min(r.right - w, vw - 8 - w))) + 'px';
  D.style.top = Math.round(r.bottom + 4 + h > vh - 8 ? Math.max(8, r.top - 4 - h) : r.bottom + 4) + 'px';
  D.style.visibility = '';
  const out = e => { const t = e.target; if (D.contains(t) || (g && g.contains(t)) || (t && t.closest && t.closest('.wk-ctx, .wk-pop, .sx-pop'))) return; closeDrawer(ctx); };
  const key = e => { if (e.key === 'Escape') { if (e.preventDefault) e.preventDefault(); closeDrawer(ctx, true); } };
  ctx.open = [listen(d, 'pointerdown', out, true), listen(D, 'keydown', key), typeof wk.addTransient === 'function' ? wk.addTransient(() => closeDrawer(ctx)) : () => {}];
  if (g) g.setAttribute('aria-expanded', 'true');
  if (typeof H.scanMods === 'function') call(() => H.scanMods());
  ctx.K.queue();
}
function closeDrawer(ctx, focus) {
  if (!ctx.open) return;
  for (const f of ctx.open) call(f);
  ctx.open = null;
  const D = ctx.drawerEl;
  D.style.left = ''; D.style.top = '';
  if (ctx.park.parentNode === ctx.el) ctx.el.insertBefore(D, ctx.park); else ctx.el.appendChild(D);
  if (ctx.gear) { ctx.gear.setAttribute('aria-expanded', 'false'); if (focus && ctx.gear.focus) ctx.gear.focus(); }
}

/* ================================================================ the builders, per kind */
const OSC_P = ['a', 'b', 'c'];
// the bar title of a numbered kind: its fixed display ordinal (args.n: dev.rig.n, §3.4), else the slot's number
const nameOf = (A, kind, k) => { const M = RC.MODULES[kind]; if (!M) return ''; const n = fin(A.n) && A.n > 0 ? A.n : k + 1; return M.labelN ? M.labelN(n) : M.label; };
// a donor's route pane / button: the pane's BALANCE / BUS knobs are found there (by data-dest); its button anchors the donor's own
// popovers (Edit Note Ranges…) at the face's ⚙. The routing itself is the cords' (W3): the ROUTE seg and the AMP ENV switch never
// reach a face (adopt normalises the switch on, §2.5)
function routeOf(ctx, P) { if (P && P.route) { if (P.route.pane) ctx.roots.push(P.route.pane); P.route.btn = gearBtn(ctx); } }
// a box element (a button / toggle) for a knob cell with its caption in the label line → [el, caption]
const boxCell = (d, el, cap) => (el ? (cap ? [el, mk(d, 'span', 'rig-cap', cap)] : el) : null);
// a display element in the screen's frame (the kit's canvas or editor box, at the full inner width)
function wrapDisp(d, el) { if (!el) return null; const w = mk(d, 'div', 'rig-disp'); w.appendChild(el); return w; }
const isTog = (e, re) => hasCls(e, 'wk-tog') && re.test(((e.getAttribute('aria-label') || '') + ' ' + e.textContent).trim());
const shellItems = P => () => (P && P.shell && typeof P.shell.menuItems === 'function' ? P.shell.menuItems() : []);

const BUILDERS = {
  /* ---- the Amplifier: VOICE's keys and outputs, the LEVEL normal; bends, buses and the GLOBAL fold-outs in the drawer */
  amp: {
    title: () => RC.MODULES.amp.label,
    build(ctx) {
      const { K, d, host: H } = ctx, vp = new MOD.VoicingPanel(null, K, { bare: true }), op = new MOD.OutputsPanel(null, K);
      ctx.donors.push(vp, op);
      ctx.roots.push(vp.el);
      ctx.inline = [vp.el];
      const poly = qa(vp.el, '.sx-nf').find(noDest) || null;
      if (poly) { const l = q(poly, '.sx-nfl'); if (l) l.textContent = 'VOICES'; }
      const tg = label => qa(vp.el, '.wk-tog').find(e => isTog(e, new RegExp('^' + label + '\\b', 'i'))) || null;
      ctx.fresh = { 'g.amp': 'LEVEL', 'g.master': 'MAIN', 'g.direct': 'DIRECT', 'g.bus1v': 'BUS 1', 'g.bus2v': 'BUS 2' };
      // the head: panel undo / redo (the knob policy, §3.5), the output meter, ⚙ (no preset strip in WC-1, §3.7); (lane H) no voice counter:
      // the kit's "0 / 400" (oscillator voices sounding / poly × unison × sources) is an engine number a rig's user cannot read
      const ub = iconBtn(d, 'rig-undo', UNDO, 'Undo', () => H.undoRedo(false)), rb = iconBtn(d, 'rig-redo', REDO, 'Redo', () => H.undoRedo(true));
      K.custom(() => {
        const U = H.undo;
        if (!U) return;
        ub.disabled = !U.canUndo() && !H.undoPend; rb.disabled = !U.canRedo();
        const ul = U.label(), rl = U.redoLabel();
        ub.title = 'Undo' + (ul ? ' ' + ul : '') + ' (Cmd/Ctrl-Z)'; rb.title = 'Redo' + (rl ? ' ' + rl : '') + ' (Shift-Cmd/Ctrl-Z)';
      });
      let meter = null, mkeys = null;
      if (typeof wk.meter === 'function') { try { meter = wk.meter({ ch: 1, label: 'Output', floor: -60, top: 6, orient: 'h' }); H.meter = meter; } catch (err) { meter = null; } }
      if (typeof wk.modifierBar === 'function') { try { mkeys = wk.modifierBar({}); mkeys.el.classList.add('sx-mkeys'); H.mkeys = mkeys; } catch (err) { mkeys = null; } }
      ctx.destroyers.push(() => {
        if (meter && H.meter === meter) { H.meter = null; if (meter.destroy) call(() => meter.destroy()); }
        if (mkeys && H.mkeys === mkeys) { H.mkeys = null; if (mkeys.destroy) call(() => mkeys.destroy()); }
      });
      Object.assign(ctx.pieces, { undo: ub, redo: rb, meter: meter ? meter.el : mk(d, 'span', 'rig-meter'), gear: () => gearBtn(ctx), poly,
        mono: tg('MONO'), legato: tg('LEGATO'), always: tg('ALWAYS'), scaled: tg('SCALED') });
      // the drawer: BEND (S2 / the S1 pair: one shown), the buses' routes and the racks' FX bypass, the GLOBAL fold-outs as dialogs
      const bends = ['g.bu2', 'g.bendup', 'g.bd2', 'g.benddn'].map(id => findDest([vp.el], id)).filter(Boolean);
      const outs = qa(op.el, '.sxm-route').concat(qa(op.el, '.sxm-bypbox'));
      const dlg = (label, Make) => btnEl(d, 'sx-hbtn', label + '…', label, () => MOD.panelDialog(H, Make, label));
      const curve = which => function CurvePanelOf(root, KK) { return new MOD.CurvePanel(root, KK, which); };
      // (review 1 P2-3, the lead: MPE is the Serum's in WC-1 — midi.js stays byte-identical, so a rig is no MPE zone: its MPE… is off, said)
      const mpe = btnEl(d, 'sx-hbtn', 'MPE…', RC.WORDS.mpeLater, null);
      mpe.disabled = true;
      const folds = [dlg('Quality', MOD.QualityPanel), dlg('Tuning', MOD.TuningPanel), mpe, dlg('Voice control', MOD.VcPanel), dlg('Velocity', curve('velo')), dlg('Note', curve('note')), mk(d, 'span', 'rig-dhint', RC.WORDS.mpeLater)];
      ctx.drawerItems = [{ title: 'Bend range', items: bends }, { title: 'Outputs', items: outs }, { title: 'Global', items: folds }, { title: mkeys ? 'Touch modifiers' : null, items: mkeys ? [mkeys.el] : [] }];
      ctx.menuItems = () => [{ label: 'Preferences…', action: () => MOD.panelDialog(H, MOD.PrefsPanel, 'Preferences') }, { label: 'Info…', action: () => MOD.panelDialog(H, MOD.InfoPanel, 'Info') }];
    },
  },
  /* ---- Oscillator 1 / 2 / 3: the OscPanel's widgets; the type view's display and menus — Wavetable / Sample on the grid, the other
     types' interiors in the screen frame (WC-2 lays them) */
  osc: {
    title: ctx => nameOf(ctx.A, 'osc', ctx.k),
    build(ctx) {
      const { K, d, k } = ctx, P = new OSC.OscPanel(null, K, k);
      ctx.prefix = OSC_P[k];
      ctx.donors.push(P);
      ctx.shell = P.shell;
      ctx.roots.push(P.body, P.head);
      ctx.inline = [P.body, P.head];
      routeOf(ctx, P);
      ctx.fresh = { '@.uniw': 'WIDTH', '@.hz': 'HZ' };
      ctx.menuItems = shellItems(P);
      const pitch = P.anchor, rows = kids(P.body), uni = rows[rows.indexOf(pitch) + 1] || null;
      const wrows = kids(P.body).filter(e => hasCls(e, 'sxo-wrow'));
      ctx.roots.push(...wrows);
      // the warp strip: per slot its number, its mode menu(s) (S2 / S1), VAR (Sync), the FM type (FM modes), the remap pen
      const strip = mk(d, 'div', 'rig-strip');
      for (const wr of wrows) {
        const half = mk(d, 'div', 'rig-half');
        for (const c of kids(wr)) if (!hasCls(c, 'wk-knob')) half.appendChild(c);
        strip.appendChild(half);
      }
      const src = kids(pitch).find(e => hasCls(e, 'wk-menu') && noDest(e)) || null, hz = kids(pitch).find(e => hasCls(e, 'sx-hbtn')) || null;
      const ug = uni ? kids(uni).find(e => hasCls(e, 'sx-hbtn')) || null : null;
      if (hz) { hz.textContent = 'Pitch…'; }
      if (ug) { ug.textContent = 'Unison…'; }
      Object.assign(ctx.pieces, { type: kids(P.head).find(e => hasCls(e, 'sxo-type')) || null, src, warps: strip, gear: () => gearBtn(ctx) });
      // the type views' pieces, harvested once per view (the donor builds a view at its type's first showing)
      ctx.typeOf = () => core.oscTypeOf(K.s(), k);
      ctx.harvest = () => {
        const t = ctx.typeOf(), v = P.typeView(t);
        if (!v || v.rigDone) return;
        v.rigDone = true;
        ctx.roots.push(v.el);
        const H = arr(v.head), ch = kids(v.el), Pc = ctx.pieces;
        if (t === 'wt') {
          Object.assign(Pc, { name: H[0], rename: H[1], delete: H[2], edit: H[3], display: wrapDisp(d, ch[0]) });
          Pc.mem = qa(v.el, '.wk-menu').find(noDest) || null;
        } else if (t === 'sample') {
          Object.assign(Pc, { name: H[0], load: H[1], rename: H[2], delete: H[3], embed: H[4], missing: H[5], display: wrapDisp(d, ch[0]) });
          Pc.loop = boxCell(d, kids(ch[1]).find(e => hasCls(e, 'sx-hbtn')) || null, 'LOOP');
        } else { Pc.name = H[0]; Pc.view = wrapDisp(d, v.el); ctx.kitHead = (ctx.kitHead || []).concat(H.slice(1)); }
      };
      ctx.drawerItems = [{ title: 'Unison and pitch', items: () => [ug, hz] },
        { title: 'Sends', items: () => ['fbal', 'bus1', 'bus2'].map(x => findDest(ctx.roots, ctx.prefix + '.' + x)) },
        { title: 'Table and sample', items: () => [ctx.pieces.mem, ctx.pieces.rename, ctx.pieces.delete, ctx.pieces.embed].concat(arr(ctx.kitHead)) }];
      // the donor puts a newly built type view into its own (detached) body / head: the next paint re-lays (variant below)
    },
    variant(ctx) { ctx.harvest(); return variantOf('osc', { type: ctx.typeOf() }); },
  },
  /* ---- the Sub oscillator */
  sub: {
    title: () => RC.MODULES.sub.label,
    build(ctx) {
      const { K, d } = ctx, P = new OSC.SubPanel(null, K), head = P.shell.head;
      ctx.prefix = 's';
      ctx.donors.push(P);
      ctx.shell = P.shell;
      ctx.roots.push(P.shell.body, head);
      routeOf(ctx, P);
      const box = mk(d, 'span', 'rig-sel');
      for (const m of kids(head).filter(e => hasCls(e, 'wk-menu'))) box.appendChild(m);
      const glyph = kids(head).find(e => hasCls(e, 'sx-ico')) || null;
      if (glyph) glyph.classList.add('rig-glyph');
      ctx.inline = [P.shell.body, head];
      ctx.fresh = { '@.track': { label: 'TRACK', toggle: true } };
      Object.assign(ctx.pieces, { shape: box, glyph });
      ctx.menuItems = shellItems(P);
    },
  },
  /* ---- Noise */
  noise: {
    title: () => RC.MODULES.noise.label,
    build(ctx) {
      const { K, d } = ctx, P = new OSC.NoisePanel(null, K), head = P.shell.head;
      ctx.prefix = 'n';
      ctx.donors.push(P);
      ctx.shell = P.shell;
      ctx.roots.push(P.shell.body, head);
      routeOf(ctx, P);
      const hk = kids(head), box = mk(d, 'span', 'rig-sel');
      const menu = hk.find(e => hasCls(e, 'wk-menu')) || null;
      if (menu) box.appendChild(menu);
      box.classList.add('rig-noarr'); // (three columns hold the source, ONE SHOT and ⚙: the source steps by its list, not by ◀ ▶)
      const one = qa(P.shell.body, '.wk-tog').find(e => isTog(e, /one shot/i)) || null;
      ctx.inline = [P.shell.body, head];
      Object.assign(ctx.pieces, { source: box, oneshot: one, gear: () => gearBtn(ctx) });
      ctx.drawerItems = [{ title: 'Noise file', items: () => hk.filter(e => hasCls(e, 'sx-hbtn') || hasCls(e, 'sxo-badge')) }];
      ctx.menuItems = shellItems(P);
    },
  },
  /* ---- Filter 1 / 2: its display in a screen; the input switches in our words (filtered / passing dry: audible state, §2.5) */
  filter: {
    title: ctx => nameOf(ctx.A, 'filter', ctx.k),
    build(ctx) {
      const { K, d, k } = ctx, P = new OSC.FilterPanel(null, K, k), F = k ? 'f2.' : 'f.', T = ctx.title, head = P.shell.head, body = P.shell.body;
      ctx.prefix = F;
      ctx.donors.push(P);
      ctx.shell = P.shell;
      ctx.roots.push(body, head, P.xyPane);
      ctx.inline = [body, head];
      routeOf(ctx, P);
      const box = mk(d, 'span', 'rig-sel');
      for (const m of kids(head).filter(e => hasCls(e, 'wk-menu'))) box.appendChild(m);
      const typeN = () => P.typeN(false);
      ctx.fresh = { '@level': 'LEVEL', '@x': { label: 'X', disabled: () => typeN() < 96 }, '@y': { label: 'Y', disabled: () => typeN() < 96 } };
      const key = qa(body, '.wk-tog').find(e => isTog(e, /^KEY\b/)) || null, pz = qa(body, '.sx-hbtn').find(e => e.textContent === 'PZ') || null;
      const clean = K.bind(wk.toggle({ label: T + ' clean mode', text: 'CLEAN', kind: 'btn', get: () => ((K.s().filter[k] || {}).clean ? 1 : 0),
        set: v => K.edit(s => { s.filter[k].clean = v ? 1 : 0; }, { label: 'Filter clean mode' }) }));
      clean.el.title = 'Clean: the filter without its drive colour';
      // INPUTS (Serum's S A B C N): lit = the source is filtered here; off = it passes dry through this filter at its LEVEL
      const SHORT = { A: 'OSC 1', B: 'OSC 2', C: 'OSC 3', N: 'NOISE', S: 'SUB' }, FULL = { A: 'Oscillator 1', B: 'Oscillator 2', C: 'Oscillator 3', N: 'Noise', S: 'Sub oscillator' };
      for (const X of ['A', 'B', 'C', 'N', 'S']) {
        const w = K.bind(wk.toggle({ label: FULL[X] + ' into ' + T, text: SHORT[X], kind: 'btn', get: () => (OSC.filterLit(K.s(), k)[X] ? 1 : 0), set: () => P.routeTap(X) }));
        w.el.setAttribute('data-pdest', F + 'route' + X);
        w.el.title = FULL[X] + ' → ' + T + ': lit = filtered here; off = it passes dry at this filter’s LEVEL';
        ctx.pieces['src' + X] = w.el;
      }
      Object.assign(ctx.pieces, { type: box, display: wrapDisp(d, kids(body).find(e => hasCls(e, 'sx-disp')) || null), key, pz, clean: clean.el, gear: () => gearBtn(ctx) });
      ctx.drawerItems = [{ title: 'Sends', items: () => [findDest(ctx.roots, F + 'bus1'), findDest(ctx.roots, F + 'bus2')] }];
      ctx.menuItems = shellItems(P);
    },
  },
  /* ---- Envelope 1…4 (Envelope 1, the amp slot: no START / END) */
  env: {
    title: ctx => nameOf(ctx.A, 'env', ctx.k),
    build(ctx) {
      const { K, d, k } = ctx, P = new MOD.EnvPanel(null, K, k, { bare: true }), head = P.shell.head, body = P.shell.body;
      ctx.prefix = 'e' + (k + 1);
      ctx.donors.push(P);
      ctx.shell = P.shell;
      ctx.roots.push(body, head);
      ctx.inline = [body, head];
      const tg = kids(head).filter(e => hasCls(e, 'wk-tog')), zoom = kids(head).find(e => e.localName === 'input') || null;
      if (zoom) zoom.title = 'Zoom (LOCK fits the whole envelope)';
      const cur = kids(body).find(e => hasCls(e, 'sx-envcurves')), st = cur ? kids(cur) : [];
      Object.assign(ctx.pieces, { bpm: tg[0] || null, lock: tg[1] || null, zoom, editor: wrapDisp(d, kids(body).find(e => hasCls(e, 'sx-edbox')) || null),
        start: st[3] || null, end: st[4] || null });
      // ⋯: the kit's module items (Lock · Init · Copy · Paste · Swap with ▸, §8.2 — EnvPanel's shell has no module of its own, so the
      // face had none: review 1 P3-1's "⋯ → Init" on the amp Envelope is the host's envFromAmp), then its own and the destinations
      ctx.menuItems = () => {
        const H = K.sx, own = P.menuItems().filter(i => i.label !== 'Lock Module');
        if (!H || typeof H.moduleMenuActs !== 'function') return P.menuItems();
        return H.moduleMenuActs('env' + (k + 1), null, () => own.filter((x, i) => !(x.sep && (!i || own[i - 1].sep || i === own.length - 1))));
      };
      // (Envelope 1: START / END are ENV 2's, hidden by the kit — kept on the face, parked, as the kit keeps them)
      ctx.onLay = v => { if (v === 'env.amp') for (const e of [st[3], st[4]]) if (e) { ctx.park.appendChild(e); ctx.managed.push(e); } };
    },
  },
  /* ---- LFO 1…10 */
  lfo: {
    title: ctx => nameOf(ctx.A, 'lfo', ctx.k),
    build(ctx) {
      const { K, d, k } = ctx, P = new MOD.LfoPanel(null, K, k, { bare: true }), body = P.shell.body;
      ctx.prefix = 'l' + (k + 1);
      ctx.donors.push(P);
      ctx.shell = P.shell;
      ctx.roots.push(body);
      ctx.inline = [body];
      const area = kids(body).find(e => hasCls(e, 'sx-pbody')) || body, heads = kids(area).filter(e => hasCls(e, 'sx-edhead'));
      const h1 = kids(heads[0]), h2 = kids(heads[1]);
      const tog = (row, re) => row.find(e => isTog(e, re)) || null, seg = row => row.find(e => hasCls(e, 'wk-seg') || hasCls(e, 'sx-seg')) || null;
      const menus = h1.filter(e => hasCls(e, 'wk-menu')), btns = h2.filter(e => hasCls(e, 'sx-hbtn'));
      const ed = mk(d, 'div', 'rig-disp');
      for (const b of kids(area).filter(e => hasCls(e, 'sx-edbox'))) ed.appendChild(b);
      Object.assign(ctx.pieces, { type: menus[0] || null, dir: menus[1] || null, grid: h2.find(e => e.localName === 'input') || null, shapes: btns[0] || null,
        mode: seg(h1), bpm: tog(h2, /^BPM/), mono: tog(h1, /^MONO/), editor: ed, gear: () => gearBtn(ctx) });
      ctx.drawerItems = [{ title: 'Timing', items: () => [tog(h2, /^DOT/), tog(h2, /^TRIP/), tog(h2, /^HOST/)] }, { title: 'Drawing', items: () => [seg(h2), btns[1]] }];
      ctx.menuItems = () => P.menuItems();
    },
  },
  /* ---- Macros: a knob over its name tile — the tile is the macro's jack (k1…k8: cv-module's inline anchors) */
  macros: {
    title: () => RC.MODULES.macros.label,
    build(ctx) {
      const { K, d } = ctx, P = new MOD.MacrosPanel(null, K, { bare: true });
      ctx.donors.push(P);
      ctx.shell = P.shell;
      ctx.roots.push(P.shell.body);
      ctx.inline = [P.shell.body];
      qa(P.shell.body, '.sx-macro').forEach((box, i) => {
        const kn = kids(box).find(e => hasCls(e, 'wk-knob')) || null;
        if (kn) kn.classList.add('rig-mk');
        ctx.pieces['m' + (i + 1)] = kids(box);
      });
      ctx.pieces.hint = mk(d, 'span', 'rig-hint', 'Drag a name onto a knob to modulate it');
    },
  },
};

/* ================================================================ skins (§5.1) */
/** The skin of the world (one attribute: data-cv-skin on #world; a skin is a CSS block of colours and the face font, never a
 * number): an unknown id falls to SKIN_DEFAULT. → the id applied. */
export function applySkin(worldEl, id) {
  const ids = arr(RC.SKINS).map(s => s.id), v = ids.includes(id) ? id : RC.SKIN_DEFAULT;
  if (worldEl && typeof worldEl.setAttribute === 'function' && worldEl.getAttribute('data-cv-skin') !== v) worldEl.setAttribute('data-cv-skin', v);
  return v;
}

/* ================================================================ the host */
export function rigHost(deps) {
  const P = deps || {};
  /** A face: the module of `kind` for the rig's SerumHost args.host, mounted into root as a view of that host (its page, its paint, its
   * panel undo). → the host's View + { el, face, jacks, dests(), drawer }. */
  function face(kind, root, args) {
    const A = Object.assign({}, args), H = A.host;
    if (!BUILDERS[kind]) throw new Error('rig-ui: no face for ' + kind);
    if (!H || typeof H.mount !== 'function') throw new Error('rig-ui: a face needs its rig\'s SerumHost (args.host)');
    const part = A.part || (kind === 'amp' ? 'voice' : kind);
    const opts = Object.assign({}, A.opts, kind === 'macros' ? { tiles: 'jack' } : null);
    const L = layoutOf(FACE[variantOf(kind, { k: part === 'env1' ? 0 : 1 })]);
    const V = H.mount((r, K, MA, view) => { const p = buildFace(kind, K, Object.assign({}, A, { part }), view, H); r.appendChild(p.el); return p; }, root,
      { kind: 'rig:' + kind, bare: true, width: L.w, dev: A.dev, shown: A.shown, opts, part });
    const pn = V.panel || {}, C = pn.ctx || null;
    V.el = pn.el || null;
    V.face = C ? C.meta : null;
    V.jacks = C ? C.jacks : new Map();
    V.dests = () => (V.el ? Array.from(new Set(qa(V.el, '[data-dest]').map(e => e.getAttribute('data-dest')))) : []);
    V.drawer = C ? { el: C.drawerEl, open: () => openDrawer(C), close: () => closeDrawer(C), isOpen: () => !!C.open } : null;
    return V;
  }
  const G = makeMenu(P);
  return { face, jackMenu: G.jackMenu, press: G.press, applySkin, FACE, GRID, sizeOf, layoutOf, endOf, jackKey };
}

/* ================================================================ the jack row's menu (§3.2, §4.4) */
// The lead's decision (WC-1, after lane C): the cord DRAG is cv-cables' cords-mode drag (createCableDrag({ live, grab, … }): an output
// starts a new cord, an input grabs its most recent, re-patch / pull, "Which cord?", the badge drag). rig-ui keeps the jack row's TAP:
//   jackMenu(jack, el, x, y) → the menu's handle | null    cv-cables' call (`jack` the jack key 'i1/oscA.out', or the element; a
//     (jackEl, event) pair works too). A plugged jack → its plug menu: the cord (A → B) with Pull · Re-patch to ▸ · Colour ▸ (eight
//     swatches: dev.rig.cc by the source end), a jack holding several → a submenu per cord, the most recent first; an output or a Σ input
//     also "Connect to…". An empty jack → "Connect to…" (every rig jack `can` accepts; a pick plugs). A read-only jack (the Oscillator's
//     WARP target, the Amplifier's OUT) → what reaches it. A modulation output with no rig jack to reach and no cord → null (cv-cables
//     falls to its onJackTap: the modulator's own menu); an Envelope's OUT lists the Amplifier's LEVEL — the amp slot's menu path in lines
//     mode too (lane C's open item). Not a jack of the shown rig → null.
//   press(e, el) → false   declines every press: the drag is cv-cables' (kept so §11.1's shape holds and a cordPress chain passes it on)
// deps (rigHost): { doc, cur: () => { t, dev, s, fx, rig } | null (the shown track's rig), rec?: (t, dev) → the rig's records (default
//   rig-core edges(s, fx, dev, rig)), edit: (t, dev, label, r) → bool (ONE History step: r = rig-core's { f, why, notes, lay? }),
//   colour?: (t, dev, srcEnd, c) → bool (dev.rig.cc), notice: (text, ms, onTap?), undo: (), menu?: (x, y, items, opts) (wk.contextMenu),
//   view?: () → { jacks() } (else every [data-cv-jack] of the device under world.el), world?, title?: (t, dev, part) → a module's bar title
//   (dev.rig.n ordinals), can? / plug? / pull? / repatch? (the rules: rig-core's by default — lane K's) }
const COLOUR_NAMES = ['Red', 'Yellow', 'Blue', 'Green', 'Cream', 'Orange', 'Violet', 'Black'];
/** The rig end of a jack key ('i1/oscA.out' → 'oscA.out', 'i1.main' → 'voice.main') of device dev, or null. */
export function endOf(dev, jk) {
  if (typeof jk !== 'string' || typeof dev !== 'string') return null;
  if (jk.startsWith(dev + '/')) { const r = jk.slice(dev.length + 1), m = /^([a-zA-Z][a-zA-Z0-9]*)\.([a-zA-Z][a-zA-Z0-9]*)$/.exec(r); return m ? m[1] + '.' + m[2] : null; }
  if (jk.startsWith(dev + '.')) { const p = jk.slice(dev.length + 1); return /^[a-zA-Z][a-zA-Z0-9]*$/.test(p) ? 'voice.' + p : null; }
  return null;
}
/** The jack key of a rig end on device dev (endOf's inverse). */
export function jackKey(dev, end) { const i = String(end).indexOf('.'), part = end.slice(0, i), port = end.slice(i + 1); return part === 'voice' ? dev + '.' + port : dev + '/' + part + '.' + port; }
// the module kind of an engine part ('voice' → the Amplifier)
const kindOfPart = part => { for (const [k, M] of Object.entries(RC.MODULES)) if (M.slots.includes(part)) return k; return null; };
function makeMenu(P) {
  const world = () => (typeof P.world === 'function' ? call(P.world) : P.world) || null;
  const notice = (t, ms, tap) => call(P.notice, t, ms, tap);
  const rule = name => (typeof P[name] === 'function' ? P[name] : typeof RC[name] === 'function' ? RC[name] : null);
  /* ---- the context: the shown rig, its records */
  function ctx() {
    const c = call(P.cur);
    if (!c || !c.t || typeof c.dev !== 'string' || !isObj(c.s)) return null;
    const recs = typeof P.rec === 'function' ? call(P.rec, c.t, c.dev) : rule('edges') ? call(rule('edges'), c.s, c.fx, c.dev, c.rig) : [];
    return Object.assign({}, c, { recs: arr(recs) });
  }
  // (a pick acts on the rig as it is now: the same track and device, else nothing — cv-patch's review-2 rule)
  const again = C => { const N = ctx(); return N && C && N.t && C.t && N.t.id === C.t.id && N.dev === C.dev ? N : null; };
  function partName(C, part) {
    const t = call(P.title, C.t, C.dev, part);
    if (typeof t === 'string' && t) return t;
    const k = kindOfPart(part), M = k ? RC.MODULES[k] : null;
    if (!M) return part;
    return M.labelN ? M.labelN(M.slots.indexOf(part) + 1) : M.label;
  }
  function endLabel(C, end) {
    const i = end.indexOf('.'), part = end.slice(0, i), port = end.slice(i + 1), k = kindOfPart(part), M = k ? RC.MODULES[k] : null;
    const J = M ? arr(M.jacks.in).concat(arr(M.jacks.out)).find(j => j.id === port) : null;
    return partName(C, part) + ' · ' + (J ? J.label : port.toUpperCase());
  }
  // the records at an end, in the records' order (the last the most recent)
  const cordsAt = (C, end) => C.recs.filter(r => r && (r.a === end || r.b === end));
  const dirOf = el => (el && el.getAttribute ? el.getAttribute('data-dir') || el.getAttribute('data-rig-dir') : null) || 'out';
  const isRo = el => !!el && typeof el.hasAttribute === 'function' && el.hasAttribute('data-ro');
  const isMod = el => !!el && (el.getAttribute('data-rig-sig') === 'mod' || el.getAttribute('data-cord') === 'mod' || el.getAttribute('data-kind') === 'mod' || /\.k[1-8]$/.test(el.getAttribute('data-cv-jack') || ''));
  // the rig's jacks on the canvas now: [{ jk, end, el, dir }] (the view's list, else every [data-cv-jack] of the device in the world)
  function jackEls(C) {
    const V = call(P.view), out = [];
    let L = V && typeof V.jacks === 'function' ? call(() => V.jacks()) : null;
    if (!Array.isArray(L)) {
      L = [];
      const W = world(), walk = n => { for (const c of n.children || []) { const id = c.getAttribute && c.getAttribute('data-cv-jack'); if (id) L.push({ id, el: c }); else walk(c); } };
      if (W && W.el) walk(W.el);
    }
    for (const j of L) {
      if (!j || !j.el || typeof j.el.getAttribute !== 'function') continue;
      const end = endOf(C.dev, j.id);
      if (end) out.push({ jk: j.id, end, el: j.el, dir: dirOf(j.el) });
    }
    return out;
  }
  // the rule's verdict on a cord a (an output) → b (an input): { ok, why }
  function verdict(C, a, b) {
    const can = rule('can');
    if (!can) return { ok: false, why: 'Not connectable yet' };
    const r = call(can, C.s, C.fx, a, b);
    return r && typeof r === 'object' ? { ok: !!r.ok, why: r.why ? String(r.why) : '' } : { ok: !!r, why: '' };
  }
  const callRule = (name, C, ...a) => { const f = rule(name); return f ? call(f, C.s, C.fx, ...a) : { f: [], why: 'Not connectable yet' }; };
  // one History step (the host's): a refusal says why and writes nothing; done, "<its notes, else `said`, else the label> · tap to undo"
  // (review 2 P3-4: a plug or a re-patch from the menu says so, as a drag does); a slot move with equal fields is still a move (r.lay)
  function commit(C, label, r, said) {
    if (!r || r.why || !Array.isArray(r.f) || !(r.f.length || (Array.isArray(r.lay) && r.lay.length))) { if (r && r.why) notice(r.why, 3500); return false; }
    const ok = call(P.edit, C.t, C.dev, label, r) !== false;
    if (ok) notice((Array.isArray(r.notes) && r.notes.length ? r.notes.join(' · ') : said || label) + ' · tap to undo', 6000, () => call(P.undo));
    return ok;
  }
  const ctxMenu = (x, y, items, opts) => (typeof P.menu === 'function' ? call(P.menu, x, y, items, opts) : wk.contextMenu(x, y, items, opts));
  const rectOf = el => { try { return el && el.getBoundingClientRect ? el.getBoundingClientRect() : null; } catch (err) { return null; } };
  // the ends `end` can reach (its own side excluded, a read-only jack never, `skip` the cord's current other end)
  function targets(C, end, dir, skip) {
    const out = [];
    for (const J of jackEls(C)) {
      if (J.end === end || J.end === skip || J.dir === dir || isRo(J.el)) continue;
      const v = dir === 'out' ? verdict(C, end, J.end) : verdict(C, J.end, end);
      if (v.ok) out.push({ end: J.end, label: endLabel(C, J.end) });
    }
    return out;
  }
  const plugItem = (C, end, dir, T) => ({ label: T.label, action: () => {
    const N = again(C);
    if (!N) return;
    const a = dir === 'in' ? T.end : end, b = dir === 'in' ? end : T.end;
    commit(N, 'Plug ' + endLabel(N, a) + ' → ' + endLabel(N, b), callRule('plug', N, a, b));
  } });
  const pullCord = (C, c) => { const N = again(C); if (N) commit(N, 'Pull ' + endLabel(N, c.a) + ' → ' + endLabel(N, c.b), callRule('pull', N, c.id), 'Cord pulled'); };
  // a cord's items: Pull · Re-patch to ▸ (its INPUT plug moved to another input its source can feed: cv-cables' grab, in a menu) · Colour ▸
  function cordItems(C, c) {
    const re = targets(C, c.a, 'out', c.b).map(T => ({ label: T.label, action: () => { const N = again(C); if (N) commit(N, 'Re-patch ' + endLabel(N, c.a) + ' → ' + T.label, callRule('repatch', N, c.id, 'b', T.end)); } }));
    return [{ label: 'Pull', action: () => pullCord(C, c) },
      { label: 'Re-patch to', sub: re.length ? re : [{ label: 'Nowhere else', disabled: true }] },
      { label: 'Colour', sub: COLOUR_NAMES.map((name, i) => ({ label: name, checked: (c.c | 0) === i, action: () => { const N = again(C); if (N) call(P.colour, N.t, N.dev, c.a, i); } })) }];
  }
  /** The jack's tap menu (cv-cables' jackMenu(jack, el, x, y); also (jackEl, event)) → the menu's handle | null. */
  function jackMenu(jack, el, x, y) {
    let E = el, X = x, Y = y;
    if (jack && typeof jack === 'object') { if (el && typeof el === 'object' && !el.getAttribute && fin(el.clientX)) { X = el.clientX; Y = el.clientY; } E = jack; }
    const C = ctx(), jk = typeof jack === 'string' ? jack : E && E.getAttribute ? E.getAttribute('data-cv-jack') : null, end = C ? endOf(C.dev, jk) : null;
    if (!C || !end) return null;
    if (!E || typeof E.getAttribute !== 'function') E = (jackEls(C).find(J => J.jk === jk) || {}).el || null;
    const r = rectOf(E), px = fin(X) ? X : r ? r.left + r.width / 2 : 0, py = fin(Y) ? Y : r ? r.bottom + 4 : 0, opts = E ? { anchor: E } : undefined;
    const dir = dirOf(E), cords = cordsAt(C, end), live = cords.filter(c => !c.ro);
    if (isRo(E)) { // a read-only end: what reaches it (made in the oscillators' menus / derived)
      const items = [{ label: endLabel(C, end), disabled: true }].concat(cords.length ? cords.map(c => ({ label: endLabel(C, c.a === end ? c.b : c.a) + (c.label ? ' (' + c.label + ')' : ''), disabled: true })) : [{ label: 'Nothing reaches it', disabled: true }]);
      return ctxMenu(px, py, items, opts) || null;
    }
    const T = targets(C, end, dir, null);
    if (isMod(E) && dir === 'out' && !live.length && !T.length) return null; // (a modulator with no jack to reach: cv-cables' own tap)
    const connect = [{ label: 'Connect ' + endLabel(C, end) + ' to…', disabled: true }].concat(T.length ? T.map(t => plugItem(C, end, dir, t)) : [{ label: 'Nothing to connect to', disabled: true }]);
    if (!live.length) return ctxMenu(px, py, connect, opts) || null;
    const items = live.length === 1 ? [{ label: endLabel(C, live[0].a) + ' → ' + endLabel(C, live[0].b), disabled: true }].concat(cordItems(C, live[0]))
      : [{ label: 'Which cord?', disabled: true }].concat(live.slice().reverse().map(c => ({ label: endLabel(C, c.a === end ? c.b : c.a), sub: cordItems(C, c) })));
    if (dir === 'out' || (E && E.hasAttribute && E.hasAttribute('data-sum'))) items.push({ sep: true }, { label: 'Connect to', sub: connect.slice(1) });
    return ctxMenu(px, py, items, opts) || null;
  }
  return { jackMenu, press: () => false };
}
