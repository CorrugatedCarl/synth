// Test stub of serum-ui's binding kit (makeKit, SPEC-serum2 §11.14) for the sub-panel unit tests (tests/sx-ui-osc.test.mjs,
// tests/sx-ui-seq.test.mjs, tests/sx-ui-mix.test.mjs): a kit with exactly the members of the real one
// (tests/serum-ui.test.mjs compares them), bound to a plain state instead of a SerumUI. Destination widgets are real wk
// widgets carrying data-dest; virtual destinations (m1…m8, arp.*, clip.*) read and write their state bases as the real
// kit does; panel(…, o) keeps o.items on the returned shell (P.items) and o.collapse as P.collapse; edits apply at once
// and are logged; nothing is sent anywhere.
//
//   const kit = makeKit({ doc, s, fx, host, snap, wt, prefs });
//   const T = stubOf(kit);   // { log, binds, canvases, lives, pops, prompts, held, paint(), setSnap(snap), destroy(), queued,
//                            //   shown (default true: the page is on screen; kit.live callbacks get it, as serum-ui's) }
//   log entries: ['edit' | 'editFx', label, phase, ui] · ['setN', id, n, phase] · ['notify', text] · ['openWtEditor', o]
import * as core from '../../serum-core.js?v=10';
import * as wk from '../../wk.js?v=10';

export const __stub = true;
const STUBS = new WeakMap();
const clamp01 = x => (x > 0 ? (x < 1 ? x : 1) : 0);
const destOf = id => { const i = core.DEST_INDEX[id]; return i === undefined ? null : core.DESTS[i]; };
const gridOf = d => (!d ? 0 : d.law === 'int' ? d.hi - d.lo : d.law === 'enum' ? d.hi : d.law === 'bool' ? 1 : 0);
const isFxPar = id => core.isFxId(id) && id !== 'g.master' && id !== 'g.bypass';
const opt = o => (typeof o === 'string' ? { label: o } : Object.assign({}, o));
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
// virtual destinations (serum-ui virtGet / virtSet): macros m1…m8 → s.macros[k].v, arp.* → the selected arp slot's n,
// clip.* → the selected clip's n (EDIT ALL: every slot / clip); undefined / false for every other id
const VIRT_RE = /^(m([1-8])|arp\.(\w+)|clip\.(\w+))$/;
function virtGet(s, id) {
  const m = VIRT_RE.exec(id || '');
  if (!m || !isObj(s) || !destOf(id) || id === 'arp.on' || id === 'clip.on') return undefined;
  if (m[2]) { const M = (s.macros || [])[+m[2] - 1]; return isObj(M) && Number.isFinite(M.v) ? clamp01(M.v) : undefined; }
  const A = m[3] ? s.arp : s.clip, list = (m[3] ? A && A.slots : A && A.clips) || [], it = isObj(A) ? list[A.sel | 0] : null, k = m[3] || m[4];
  return isObj(it) && isObj(it.n) && Number.isFinite(it.n[k]) ? clamp01(it.n[k]) : undefined;
}
function virtSet(s, id, n) {
  const m = VIRT_RE.exec(id || '');
  if (!m || !isObj(s) || !destOf(id) || id === 'arp.on' || id === 'clip.on') return false;
  if (m[2]) { const M = (s.macros || [])[+m[2] - 1]; if (isObj(M)) M.v = clamp01(n); return true; }
  const A = m[3] ? s.arp : s.clip, list = (m[3] ? A && A.slots : A && A.clips) || [], k = m[3] || m[4];
  if (isObj(A)) list.forEach((it, j) => { if (isObj(it) && isObj(it.n) && (j === (A.sel | 0) || A.editAll)) it.n[k] = clamp01(n); });
  return true;
}

export function stubOf(kit) { return STUBS.get(kit) || null; }

export function makeKit(o) {
  const O = o || {}, doc = O.doc || globalThis.document;
  const T = { log: [], binds: [], canvases: [], lives: [], pops: [], prompts: [], held: new Set(), paints: 0, snaps: 0, queued: 0, dead: false,
    snap: O.snap || null, pop: null };
  const s = () => O.s, fx = () => O.fx || null;
  const getN = id => { const v = virtGet(s(), id); return v !== undefined ? v : core.destBase(s(), fx(), id); };
  const setN = (id, n, ph) => {
    const d = destOf(id);
    if (!d) return;
    const m = gridOf(d), v = m ? Math.round(clamp01(n) * m) / m : clamp01(n), phase = ph || 'set';
    if (isFxPar(id)) { if (fx()) fx().p[id] = v; } else if (!virtSet(s(), id, v)) s().p[id] = v;
    if (phase === 'start' || phase === 'move') T.held.add(id); else T.held.delete(id);
    T.log.push(['setN', id, v, phase]);
  };
  const bind = w => { T.binds.push(w); return w; };
  const fmt = id => n => core.fmtParam(id, n, { s: s(), fx: fx() });
  const kit = {
    host: O.host || {},
    s, fx,
    snap: () => T.snap,
    knob: (id, oo) => {
      const P = opt(oo), d = destOf(id);
      const k = { dest: id, label: P.label || '', get: () => getN(id), set: (n, ph) => setN(id, n, ph), def: () => d.def, fmt: fmt(id),
        parse: t => core.parseParam(id, t, { s: s(), fx: fx() }), steps: d.law === 'int' || d.law === 'enum' ? gridOf(d) : 0, size: P.size || 'md',
        bipolar: P.bipolarFn ? !!P.bipolarFn() : d.ctr === 1, disabled: P.disabled, detents: P.detents };
      if (P.labelFn) Object.defineProperty(k, 'label', { get: P.labelFn, enumerable: true });
      return bind(wk.knob(k));
    },
    menu: (id, items, oo) => { const P = opt(oo); return bind(wk.menu({ dest: id, label: P.label || '', items, get: () => getN(id), set: v => setN(id, v, 'set'), arrows: P.arrows !== false, wheel: true })); },
    toggle: (id, oo) => {
      const P = opt(oo), w = wk.toggle({ dest: id, label: P.label || '', kind: P.kind || 'led', get: () => (getN(id) >= 0.5 ? 1 : 0), set: v => setN(id, v ? 1 : 0, 'set'), disabled: P.disabled });
      if (P.module) w.el.setAttribute('data-module', P.module);
      return bind(w);
    },
    seg: (id, oo) => {
      const P = opt(oo), g = () => gridOf(destOf(id));
      return bind(wk.seg({ dest: id, label: P.label || '', items: P.items || (() => Array.from({ length: g() + 1 }, (_, k) => fmt(id)(k / g()))),
        get: () => Math.round(getN(id) * g()), set: i => setN(id, g() ? i / g() : 0, 'set'), disabled: P.disabled }));
    },
    dropTarget: (el, id) => { if (el && el.setAttribute && typeof id === 'string') el.setAttribute('data-dest', id); return el; },
    edit: (fn, oo) => { const P = opt(oo); fn(s()); T.log.push(['edit', P.label || 'Edit', P.phase, !!P.ui]); },
    editFx: (fn, oo) => { const P = opt(oo); if (fx()) fn(fx()); T.log.push(['editFx', P.label || 'Edit FX', P.phase, !!P.ui]); },
    notify: text => T.log.push(['notify', text]),
    prefs: () => O.prefs || {},
    doc,
    num: (id, oo) => {
      const P = opt(oo), d = destOf(id);
      const w = wk.numBox({ dest: id, label: P.label || '', get: () => getN(id), set: (n, ph) => setN(id, n, ph), def: d.def, fmt: fmt(id),
        steps: d.law === 'int' || d.law === 'enum' ? gridOf(d) : 0, disabled: P.disabled });
      if (P.cls) w.el.classList.add(P.cls);
      return bind(w);
    },
    bind,
    custom: fn => bind({ update: fn }),
    canvas: (cls, key, draw, extra) => {
      const c = doc.createElement('canvas');
      c.className = 'sx-disp' + (cls ? ' ' + cls : '');
      const cv = Object.assign({ el: c, key, draw, last: null }, extra);
      T.canvases.push(cv);
      return cv;
    },
    panel: (title, module, powerId, cls, o) => {   // o.items (extra module-menu items): kept on the shell, no menu here
      const el = doc.createElement('section'), head = doc.createElement('div'), body = doc.createElement('div'), name = doc.createElement('span');
      el.className = 'sx-panel' + (cls ? ' ' + cls : ''); head.className = 'sx-ptitle'; body.className = 'sx-pbody'; name.className = 'sx-tname';
      el.setAttribute('aria-label', title);
      name.textContent = title;
      if (powerId) head.appendChild(kit.toggle(powerId, { label: title + ' on', kind: 'power', module }).el);
      if (module) name.setAttribute('data-modlabel', module);
      head.appendChild(name);
      el.append(head, body);
      const P = { el, head, body, name };
      if (o && typeof o.items === 'function') P.items = o.items;
      P.collapse = !!(o && o.collapse);   // C1: the real shell folds to its title row while the module is off
      return P;
    },
    live: fn => { T.lives.push(fn); return fn; },
    getN, setN,
    dragging: id => T.held.has(id),
    queue: () => { T.queued++; },
    dead: () => T.dead,
    paintSeq: () => T.paints,
    snapSeq: () => T.snaps,
    prompt: (title, label, value, ok) => { T.prompts.push({ title, label, value, ok }); },
    popover: (key, anchor, title, make, sig) => {
      if (T.pop) { const same = T.pop.o === key; T.pop.close(); if (same) return null; }
      const box = doc.createElement('div');
      box.setAttribute('aria-label', title);
      doc.body.appendChild(box);
      const ed = make(box);
      const P = { o: key, ed, sig, title, close: () => { if (ed && ed.destroy) ed.destroy(); box.remove(); if (T.pop === P) T.pop = null; } };
      T.pop = P;
      T.pops.push(P);
      return P;
    },
    shapes: () => ({ list: () => [], save() {}, del() {}, exportFile() {}, importFile: () => Promise.resolve(0) }),
    openWtEditor: oo => { T.log.push(['openWtEditor', oo]); },
    wt: O.wt || null,
  };
  Object.freeze(kit);
  // repaint: binds, live callbacks, then every canvas whose key changed (drawn on its recording 2D context)
  T.paint = () => {
    T.paints++;
    for (const w of T.binds) w.update();
    for (const f of T.lives) f(T.shown !== false);   // kit.live(fn): fn(shown) — set T.shown = false to paint a hidden page
    for (const cv of T.canvases) {
      const k = cv.key();
      if (k === cv.last) continue;
      cv.last = k;
      const g = cv.el.getContext ? cv.el.getContext('2d') : null;
      if (g) cv.draw(g, 300, 120, 1);
    }
  };
  T.setSnap = sn => { T.snap = sn || null; T.snaps++; for (const f of T.lives) f(T.shown !== false); };
  T.destroy = () => { T.dead = true; if (T.pop) T.pop.close(); };
  STUBS.set(kit, T);
  return kit;
}
