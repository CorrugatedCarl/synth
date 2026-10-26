// cv-modlayer.js — the canvas mod layer (SPEC-canvas §2.9 Editing, §2.11 Mod list, §2.13 refusals, §7.7 items 6–7; contract:
// docs/canvas/IMPL-2a.md §4). Owner: lane C (stage 2a). Three surfaces over one host:
//   · the inspector (openInspector): a popover editing one modulation row — a canvas cable (track.mods) or a Serum preset row
//     (s.matrix, D11) — with the matrix row's vocabulary (serum-ui matrixRow): amount, bipolar, curve, output, aux + invert,
//     slew rise / fall / link, bypass, Save with preset / Keep on canvas, Disconnect; the header "<source> → <knob>" and the
//     Serum's budget "n/64";
//   · the Mod list (openList): a sheet (cv-tray sheet) of every row of the track grouped by destination device, the budget per
//     Serum, preset rows tagged "preset", rows the compile could not place tagged "not compiled: matrix full", tap → inspector,
//     Disconnect all per device (confirmed);
//   · the parameter list (openDestList): a device's destinations by group (the host's descs groups: destMenu's sections + one
//     per FX instance), nomod entries greyed (a tap says why), pick → host.connect.
// History: the host records nothing inside edit / remove / toPreset / fromPreset / connect; this layer calls host.step(label)
// once per gesture end (slider lift, key step, toggle, pick, button), never per move — edits are live (host.edit per move).
// Popovers live in host.layer (#ov) or the body, position: fixed at client px; Escape, a press outside (wk popup lists
// excepted: the aux menu's) and a camera move (wk.addTransient → closeTransient) close them, so nothing strands after a pan.
// Milestone 3 (IMPL-3 §2.4–2.5, lane D): a Serum in parts view lists EVERY row of its matrix (the host's presetRows: own LFO /
// ENV / macro rows own: true, tagged "Serum" — they stay in the matrix: no Keep on canvas) — the Mod list replaces MATRIX —,
// named by host.nativeLabel(dev, src); a destination no mounted view shows (host.hidden(dev, pid) → { tag, show }) carries
// its tag ("OSC B · LEVEL · hidden") in the list and the inspector, whose foot offers show.label ("Show OSC B").
// Rules: plain ES module, no DOM at module top level (node imports it), survives tests/main-sim.mjs's DOM stub (keeps
// references, never queries the DOM back); imports carry ?v=9; styles ship as STYLE (the host injects it once).
import * as wk from './wk.js?v=9';
import { sheet } from './cv-tray.js?v=9';
import { SRC_INDEX } from './serum-core.js?v=9';
import { amtText } from './cv-cables.js?v=9';
import { CurveEditor } from './graph.js?v=9'; // ((2b) Curve: Custom… — the Serum matrix's editable curve on a canvas row)
import { bend, MC_K } from './serum-core.js?v=9';
const bendOf = (t, c) => bend(t, MC_K * c); // (the curve amount's law, as the matrix page draws it)

/** A Serum's matrix size (serum-core N_MATRIX): the "n/64" budget's denominator when the host gives none. */
export const MAX_ROWS = 64;
/** Canvas source id ↔ Serum-native id (IMPL-2a §2.1's injection map; preset rows carry the native one). */
export const NATIVE = Object.freeze({ wheel: 'wheel', 've.out': 'velo', 'at.out': 'at', 'bd.out': 'bend' });
export const CANVAS = Object.freeze({ wheel: 'wheel', velo: 've.out', at: 'at.out', bend: 'bd.out' });
const SRC_LABEL = { wheel: 'Mod Wheel', 've.out': 'Velocity', 'at.out': 'Aftertouch', 'bd.out': 'Bend' };
// the row fields a gesture can change (a gesture whose end leaves them as they were records no step)
const FIELDS = ['amt', 'bi', 'curve', 'aux', 'inv', 'byp', 'out', 'rise', 'fall', 'slink', 'crv'];
// (2b) the ModCore slot budgets ({ lfo: [n, max], env, chaos, macro, vals, ext }) as the header and the refusals say them
const SLOT_LABELS = [['LFO', 'lfo'], ['ENV', 'env'], ['Chaos', 'chaos'], ['Macro', 'macro'], ['values', 'vals'], ['ext', 'ext']];
export function slotsText(slots, keys) {
  const s = isObj(slots) ? slots : {}, out = [];
  for (const [L, k] of SLOT_LABELS) { if (keys && !keys.includes(k)) continue; const v = s[k]; if (Array.isArray(v) && v.length >= 2) out.push(L + ' ' + num(v[0], 0) + '/' + num(v[1], 0)); }
  return out.join(' · ');
}
const LEFT_TEXT = { full: 'not compiled: matrix full', slots: 'not compiled: ModCore slots full', ext: 'not compiled: ext slots full', nomod: 'not compiled' };

const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const r4 = v => Math.round(v * 1e4) / 1e4 + 0; // + 0: never -0
const num = (v, d) => typeof v === 'number' && isFinite(v) ? v : d;
/** Signed percent of an amount −1…1 ("+25%", "-40%", "0%"; serum-ui's matrix format). */
export const pct = a => { const k = Math.round(num(a, 0) * 100) + 0; return (k > 0 ? '+' : '') + k + '%'; };
/** Typed percent → −1…1 (or 0…1 with uni): "25", "+25%", "-40 %", "−40" (U+2212), amtText's "±25%" / "∓25%"; null when not a number. */
export function parsePct(t, uni) {
  const m = /^\s*([+\-−±∓]?\d+(?:[.,]\d+)?)\s*%?\s*$/.exec(String(t == null ? '' : t));
  if (!m) return null;
  const v = parseFloat(m[1].replace(/[−∓]/, '-').replace('±', '').replace(',', '.')) / 100;
  return isFinite(v) ? clamp(v, uni ? 0 : -1, 1) : null;
}

/**
 * The refusal / notice texts (SPEC §2.13). code: 'nomod' (a structural knob), 'stage' | '2b' (a destination a later stage
 * opens: classic knobs, shared panels), 'full' (the Serum's 64 rows); anything else → ctx.why or a generic line.
 * @param {string} code @param {{src?: string, dst?: string, dev?: string, stage?: string, used?: number, max?: number, why?: string}} [ctx]
 *   names, not ids (the host's labels) @returns {string}
 */
export function refusal(code, ctx) {
  const c = isObj(ctx) ? ctx : {};
  if (code === 'nomod') return 'This knob can\'t be modulated';
  if (code === 'stage' || code === '2b' || (code == null && c.stage)) {
    const st = c.stage || '2b';
    return (c.src && c.dst ? c.src + ' → ' + c.dst + ': this knob' : 'This knob') + ' can be modulated from stage ' + st;
  }
  if (code === 'full') {
    const max = num(c.max, MAX_ROWS);
    return (c.dev || 'This Serum') + '\'s mod rows are full (' + Math.min(max, num(c.used, max)) + '/' + max + ')';
  }
  if (code === 'slots') { const t = slotsText(c.slots, ['lfo', 'env', 'chaos', 'macro', 'vals']); return 'ModCore slots full' + (t ? ': ' + t : ''); } // (2b)
  if (code === 'ext') { const t = slotsText(c.slots, ['ext']); return 'Ext slots full' + (t ? ' (' + t.replace(/^ext /, '') + ')' : ''); }
  return c.why ? String(c.why) : 'Can\'t connect that';
}

/** The styles of the layer (the host injects them once; the lead moves them into style.css at integration). Classes:
 * .cv-ml-pop[data-kind=insp|dest] (the popover), .cv-ml-h / .cv-ml-t / .cv-ml-b / .cv-ml-tag[data-tag] / .cv-ml-x (header,
 * title, budget, tags, ✕), .cv-ml-sec / .cv-ml-lab (a control row and its label), .cv-ml-amt, .cv-ml-tg (toggle row),
 * .cv-ml-foot / .cv-ml-btn[data-act] / .cv-ml-why (actions and the reason a disabled one gives), .cv-ml-grp / .cv-ml-item /
 * .cv-ml-back (the parameter list), .cv-ml-list / .cv-ml-dev / .cv-ml-dh / .cv-ml-line / .cv-ml-empty (the Mod list sheet). */
export const STYLE = `
.cv-ml-pop { position: fixed; z-index: 70; width: min(340px, calc(100vw - 16px)); max-height: calc(100dvh - 16px); overflow-y: auto; overscroll-behavior: contain;
  display: flex; flex-direction: column; gap: 10px; padding: 10px 12px 12px; border-radius: 12px; border: 1px solid var(--line2, #33363d);
  background: var(--pop, #1a1c21); box-shadow: 0 18px 50px rgba(0, 0, 0, 0.62); color: var(--text, #e9e7e2); font: 13px/1.3 var(--ui, system-ui, sans-serif); }
.cv-ml-h { display: flex; align-items: center; gap: 8px; }
.cv-ml-t { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cv-ml-b { font: 600 11px/1 var(--mono, ui-monospace, monospace); color: var(--mute, #8d8b86); white-space: nowrap; }
.cv-ml-b[data-full] { color: var(--hot, #f2a33a); }
.cv-ml-tag { padding: 2px 6px; border-radius: 6px; border: 1px solid var(--line, #24262b); font: 600 10.5px/1.2 var(--ui, system-ui, sans-serif); color: var(--mute, #8d8b86); white-space: nowrap; }
.cv-ml-tag[data-tag="left"] { border-color: #5a4320; color: var(--hot, #f2a33a); }
.cv-ml-tag[data-tag="hidden"] { border-style: dashed; }
.cv-ml-x { position: relative; flex: none; width: 32px; height: 32px; border: 0; border-radius: 8px; background: transparent; color: var(--mute, #8d8b86); font-size: 16px; }
.cv-ml-x::before { content: ''; position: absolute; inset: -6px; }
.cv-ml-x:hover, .cv-ml-x:focus-visible { background: #24262c; color: var(--text, #e9e7e2); outline: none; }
.cv-ml-sec { display: flex; align-items: center; gap: 10px; }
.cv-ml-sec > .wk-sl { flex: 1; min-width: 0; }
.cv-ml-lab { flex: none; width: 52px; color: var(--mute, #8d8b86); font-size: 12px; }
.cv-ml-amt .wk-nb { flex: none; width: 72px; }
.cv-ml-amt .wk-nb .wk-lab { display: none; }
.cv-ml-tg { display: flex; flex-wrap: wrap; gap: 8px; }
.cv-ml-sec .wk-menu { flex: 1; min-width: 0; }
.cv-ml-foot { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 4px; border-top: 1px solid var(--line, #24262b); }
.cv-ml-btn, .cv-ml-grp, .cv-ml-item, .cv-ml-back, .cv-ml-line { display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 12px; border-radius: 8px;
  border: 1px solid var(--line, #24262b); background: #17181c; color: var(--text, #e9e7e2); font: 500 13px var(--ui, system-ui, sans-serif); text-align: left; -webkit-tap-highlight-color: transparent; }
.cv-ml-btn { flex: 1 1 auto; justify-content: center; }
.cv-ml-btn[data-act="disconnect"], .cv-ml-btn[data-act="all"] { color: #ff8a73; }
.cv-ml-btn:hover, .cv-ml-btn:focus-visible, .cv-ml-grp:hover, .cv-ml-grp:focus-visible, .cv-ml-item:hover, .cv-ml-item:focus-visible,
.cv-ml-back:hover, .cv-ml-back:focus-visible, .cv-ml-line:hover, .cv-ml-line:focus-visible { border-color: #5a4320; outline: none; }
.cv-ml-btn:disabled { opacity: 0.45; border-color: var(--line, #24262b); }
.cv-ml-why { width: 100%; font-size: 11.5px; color: var(--mute, #8d8b86); }
.cv-ml-grps, .cv-ml-items { display: flex; flex-direction: column; gap: 4px; }
.cv-ml-grp > span:first-child, .cv-ml-item > span:first-child, .cv-ml-line > span:first-child { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cv-ml-grp > span + span { color: var(--mute, #8d8b86); font-size: 11.5px; }
.cv-ml-item[aria-disabled="true"] { opacity: 0.45; }
.cv-ml-list { display: flex; flex-direction: column; gap: 18px; }
.cv-ml-dev { display: flex; flex-direction: column; gap: 4px; }
.cv-ml-dh { display: flex; align-items: center; gap: 10px; font-weight: 600; color: var(--text, #e9e7e2); }
.cv-ml-dh > span:first-child { flex: 1; min-width: 0; }
.cv-ml-dh > .cv-ml-btn { flex: none; }
.cv-ml-line[data-byp] > span:first-child { color: var(--mute, #8d8b86); }
.cv-ml-empty { margin: 0; color: var(--mute, #8d8b86); }
.cv-ml-curve > .cv-ml-btn { flex: none; height: 32px; padding: 0 10px; font-size: 12px; }
.cv-ml-crv { height: auto; }
.cv-ml-dim { opacity: 0.45; }
.cv-ml-pop [hidden] { display: none !important; }
.cv-ml-item[data-stage] > .cv-ml-tag { margin-left: auto; }
`;

/**
 * @typedef {{id: string, label: string, law?: string, lo?: number, hi?: number, def?: number, fmt?: *, nomod?: boolean, group?: string}} Desc
 * @typedef {{id?: string, slot?: number, src: string, dst: string, amt: number, bi: number, curve: number, aux: string, inv: number,
 *   byp: number, out: number, rise: number, fall: number, slink: number}} Row  a canvas row (id, dst '<dev>:<param>', src canvas id)
 *   or a preset row (slot, dst the param id, src native)
 * @typedef {string | {preset: string, slot: number}} Key  what edit / remove get: a row id, or a preset row's {preset: devId, slot}
 * @typedef {{
 *   doc: Document, layer?: HTMLElement,
 *   descs: (dev: string) => Desc[], sources: (dev?: string) => Array<{id: string, label: string, scope?: string, group?: string}>,
 *   rowsOf: (dev?: string) => Row[], presetRows: (dev: string) => Row[],
 *   budget: (dev: string) => {preset: number, canvas: number, left: string[] | number, max: number},
 *   edit: (key: Key, fields: object) => Row | null, remove: (key: Key) => *,
 *   toPreset: (rowId: string) => *, fromPreset: (dev: string, slot: number) => *,
 *   connect: (src: string, dst: string) => {ok: boolean, why?: string, code?: string, stage?: string},
 *   select?: (id: string | null) => void, notice: (text: string) => void, labelOf?: (id: string) => string,
 *   step: (label: string) => void, confirm?: (text: string) => boolean, row?: (id: string) => Row | null,
 *   cancel?: () => void, nativeLabel?: (dev: string, src: string) => string,
 *   hidden?: (dev: string, pid: string) => ({tag: string, show?: {label: string, action: () => void}} | null),
 * }} ModHost  rowsOf() with no device → every canvas row of the track (the inspector finds a bare row id there); labelOf gets
 *   canvas-form ids: a source ('wheel', 've.out'), a knob ('<dev>:<param>') or a device ('i2' → "Serum 1"); cancel (U12):
 *   a gesture's live edits ended where they began — drop the step its first edit opened
 */

/** @param {ModHost} host */
export function createModLayer(host) {
  const H = host || {};
  const call = (fn, ...a) => { try { return typeof H[fn] === 'function' ? H[fn](...a) : undefined; } catch (err) { console.error(err); return undefined; } };
  const D = () => H.doc || globalThis.document;
  const mk = (tag, cls, txt) => { const e = D().createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const button = (cls, txt, act, fn) => {
    const b = mk('button', cls, txt);
    b.type = 'button';
    if (act) b.setAttribute('data-act', act);
    b.addEventListener('click', e => { if (e && e.stopPropagation) e.stopPropagation(); fn(e); });
    return b;
  };
  const layerOf = () => H.layer || D().body;
  const notice = t => { if (t) call('notice', t); };
  // one History step per gesture; the open Mod list follows (amounts, bypass, rows gone or moved)
  const step = label => { call('step', label); syncList(); };

  /* ---------------------------------------------------------------- labels, rows, budgets */
  const label = id => { const t = call('labelOf', id); return t ? String(t) : ''; };
  const devName = dev => label(dev) || dev;
  // ((milestone 3) a Serum's own source on a matrix row — 'lfo3', 'env1', 'macro2', 'velo' …: its name in that Serum, host.nativeLabel)
  const srcName = (src, dev) => label(src) || (dev ? String(call('nativeLabel', dev, src) || '') : '') || SRC_LABEL[src] || src;
  const knobName = (dev, pid) => {
    const t = label(dev + ':' + pid);
    if (t) return t;
    const d = (call('descs', dev) || []).find(x => x && x.id === pid);
    return d && d.label ? String(d.label) : pid;
  };
  const splitDst = dst => { const i = String(dst || '').indexOf(':'); return i < 0 ? ['', String(dst || '')] : [dst.slice(0, i), dst.slice(i + 1)]; };
  // a target → { key (what the host gets), dev, preset (bool), id | slot }
  function targetOf(t) {
    if (typeof t === 'string' && t) return { key: t, id: t, dev: null, preset: false };
    if (isObj(t) && typeof t.preset === 'string' && Number.isInteger(t.slot)) return { key: { preset: t.preset, slot: t.slot }, dev: t.preset, slot: t.slot, preset: true };
    if (isObj(t) && typeof t.id === 'string') return { key: t.id, id: t.id, dev: typeof t.dev === 'string' ? t.dev : null, preset: false };
    return null;
  }
  // the row as it is now (null: gone); a canvas row's device comes from its dst
  function readRow(T) {
    if (T.preset) { const r = (call('presetRows', T.dev) || []).find(x => isObj(x) && x.slot === T.slot); return r ? Object.assign({}, r) : null; }
    let r = typeof H.row === 'function' ? call('row', T.id) : null;
    if (!isObj(r)) r = (call('rowsOf', T.dev || undefined) || []).find(x => isObj(x) && x.id === T.id) || null;
    if (!r) return null;
    if (!T.dev) T.dev = splitDst(r.dst)[0] || null;
    return Object.assign({}, r);
  }
  // { used, max, left: Set of row ids not compiled, full } — budget.left an id list, or a count: the last canvas rows in
  // track.mods order are the ones that found no slot (injectMods fills first-come)
  // (2b) + slots (the ModCore budgets), why (row id → 'slots' | 'ext' | 'full' | 'nomod'), kind ('serum' | 'classic' |
  // 'panel': the host's; a Serum without it)
  function budgetOf(dev, rows) {
    const b = call('budget', dev) || {}, max = num(b.max, MAX_ROWS);
    const used = num(b.preset, 0) + num(b.canvas, 0);
    let left = new Set();
    if (Array.isArray(b.left)) left = new Set(b.left.map(String));
    else if (num(b.left, 0) > 0) { const rs = rows || call('rowsOf', dev) || []; left = new Set(rs.slice(Math.max(0, rs.length - b.left)).map(r => r.id)); }
    const kind = typeof b.kind === 'string' ? b.kind : 'serum';
    return { used, max, left, full: kind === 'serum' ? used >= max || left.size > 0 : left.size > 0, slots: isObj(b.slots) ? b.slots : null, why: isObj(b.why) ? b.why : {}, kind, canvas: num(b.canvas, 0) };
  }
  const leftText = (B, id) => LEFT_TEXT[B.why[id]] || LEFT_TEXT.full;
  const budgetText = B => (B.kind === 'serum' ? B.used + '/' + B.max : B.canvas + ' cable' + (B.canvas === 1 ? '' : 's') + (B.slots ? ' · ' + slotsText(B.slots, ['lfo', 'env', 'ext']) : '')) + (B.left.size ? ' · ' + B.left.size + ' not compiled' : '');
  const srcOfRow = (R, preset) => preset ? (CANVAS[R.src] || R.src) : R.src;
  const pidOfRow = (R, preset) => preset ? String(R.dst) : splitDst(R.dst)[1];
  const lineOf = (R, preset, dev) => srcName(srcOfRow(R, preset), preset ? dev : null) + ' → ' + knobName(dev, pidOfRow(R, preset)) + ' · ' + amtText(R.amt, R.bi) + (R.byp ? ' · bypassed' : ''); // (U11: the badge's format)
  // ((milestone 3, §2.4) a destination no mounted view of its Serum shows: { tag: 'OSC B · LEVEL · hidden', show?: { label, action } })
  const hiddenOf = (dev, pid) => { const h = call('hidden', dev, pid); return isObj(h) && typeof h.tag === 'string' ? h : null; };
  // ((milestone 3) a row of a Serum's matrix whose source is its own LFO / ENV / macro … (the parts view's Mod list): own, not "preset")
  const ownRow = (R, pre) => !!pre && !!R.own;
  // ((WC, G13, lane H) an own row's tag and the preset's owner: the instrument's name (a rig's own name; a Serum's 'Serum')
  const ownTag = dev => { const n = dev ? label(dev) : ''; return n && !/^i\d+$/.test(n) ? n : 'Serum'; };

  /* ---------------------------------------------------------------- the popover shell (inspector, parameter list) */
  let P = null; // { box, kind, offs, widgets, sync, T? }
  const inPopupList = n => { for (; n && n.nodeType === 1; n = n.parentNode) if (n.classList && (n.classList.contains('wk-pop') || n.classList.contains('wk-ctx'))) return true; return false; };
  function popover(kind, aria, x, y) {
    closePop();
    const d = D(), box = mk('div', 'cv-ml-pop');
    box.setAttribute('data-kind', kind);
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', aria);
    box.tabIndex = -1;
    const prev = d.activeElement || null;
    const onDown = e => { const t = e.target; if (P && P.box === box && !box.contains(t) && !inPopupList(t)) closePop(); };
    const onKey = e => {
      if (e.key !== 'Escape') return;
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
      closePop(true);
    };
    // Escape with the focus nowhere (the body): the box's own handler has not seen it
    const onDocKey = e => { if (e.key === 'Escape' && (e.target === d.body || e.target === d.documentElement)) onKey(e); };
    d.addEventListener('pointerdown', onDown, { capture: true, passive: true });
    d.addEventListener('keydown', onDocKey);
    box.addEventListener('keydown', onKey);
    const tOff = wk.addTransient(() => closePop());
    P = { box, kind, widgets: [], sync: null, prev,
      off() { d.removeEventListener('pointerdown', onDown, { capture: true, passive: true }); d.removeEventListener('keydown', onDocKey); box.removeEventListener('keydown', onKey); tOff(); } };
    return P;
  }
  // after the content is in: fixed at (x, y) client px, kept inside what is visible — the visual viewport (native zoom, the
  // soft keyboard: U12), else the window — flipping above y when it would run off the bottom
  function place(box, x, y) {
    const d = D(), win = d.defaultView || globalThis, vv = win.visualViewport;
    const V = vv && vv.width > 0 && vv.height > 0 ? { x: num(vv.offsetLeft, 0), y: num(vv.offsetTop, 0), w: vv.width, h: vv.height } : { x: 0, y: 0, w: win.innerWidth || 1024, h: win.innerHeight || 768 };
    box.style.left = '0px'; box.style.top = '0px';
    layerOf().appendChild(box);
    const r = box.getBoundingClientRect(), w = r.width || 340, h = r.height || 0, T = V.y + 8, B = V.y + V.h - 8;
    const px = num(x, V.x + (V.w - w) / 2), py = num(y, V.y + V.h / 3);
    let top = py;
    if (top + h > B) top = py - h - 8 >= T ? py - h - 8 : Math.max(T, B - h);
    box.style.left = Math.round(clamp(px, V.x + 8, Math.max(V.x + 8, V.x + V.w - 8 - w))) + 'px';
    box.style.top = Math.round(Math.max(T, top)) + 'px';
  }
  function closePop(focusBack) {
    if (!P) return false;
    const p = P;
    P = null;
    p.off();
    for (const w of p.widgets) { try { w.destroy(); } catch (err) { /* gone */ } }
    p.box.remove();
    if (focusBack && p.prev && p.prev.focus && p.prev !== D().body) { try { p.prev.focus({ preventScroll: true }); } catch (err) { /* gone */ } }
    return true;
  }
  const head = (title, tags, budget) => {
    const h = mk('div', 'cv-ml-h'), t = mk('span', 'cv-ml-t', title);
    t.title = title;
    h.append(t);
    for (const [k, txt] of tags) { const g = mk('span', 'cv-ml-tag', txt); g.setAttribute('data-tag', k); h.append(g); }
    let b = null;
    if (budget) { b = mk('span', 'cv-ml-b'); h.append(b); }
    const x = button('cv-ml-x', '✕', 'close', () => closePop(true));
    x.setAttribute('aria-label', 'Close');
    x.title = 'Close (Esc)';
    h.append(x);
    return { el: h, t, b };
  };
  const sec = (lab, ...kids) => { const s = mk('div', 'cv-ml-sec'); if (lab) s.append(mk('span', 'cv-ml-lab', lab)); s.append(...kids); return s; };

  /* ---------------------------------------------------------------- the inspector */
  /**
   * Edit one modulation row. target: a canvas row id ('r3'), {id, dev} (the Mod list's: rowsOf(dev) finds it), or a preset
   * row {preset: devId, slot}. x, y: client px of its top-left (the badge, the list line). → false when the row is unknown.
   */
  function openInspector(target, x, y) {
    const T = targetOf(target);
    if (!T) return false;
    let R = readRow(T);
    if (!R || !T.dev) return false;
    const dev = T.dev, pre = T.preset, B0 = budgetOf(dev), sx = B0.kind === 'serum';
    const titleOf = () => srcName(srcOfRow(R, pre), pre ? dev : null) + ' → ' + knobName(dev, pidOfRow(R, pre)); // (U12: a preset slot can hold another row after a sync)
    const title = titleOf();
    const p = popover('insp', 'Modulation: ' + title, x, y);
    const box = p.box, W = p.widgets;
    const own = ownRow(R, pre), hid = hiddenOf(dev, pidOfRow(R, pre)); // ((3) a Serum's own row; a hidden destination)
    const tags = pre ? [own ? ['own', ownTag(dev)] : ['preset', 'preset']] : [];
    if (hid) tags.push(['hidden', hid.tag]);
    const hd = head(title, tags, true);
    const leftTag = mk('span', 'cv-ml-tag', 'not compiled: matrix full');
    leftTag.setAttribute('data-tag', 'left');
    hd.el.insertBefore(leftTag, hd.b);
    box.append(hd.el);
    const snapKey = () => FIELDS.map(k => R[k]).join('|');
    function edit(fields) {
      const got = call('edit', T.key, fields);
      R = Object.assign({}, R, fields, isObj(got) ? got : null);
      refresh();
    }
    const changes = f => Object.keys(f).some(k => R[k] !== f[k]);
    // a widget's set(n, phase): live edits per move, one step at the gesture's end when the row changed ('set': a key, a
    // typed value, the wheel, a toggle — a gesture of its own)
    // (U12) live edits that end where they began (a two-finger rollback, a drag back to its start): host.cancel?() — the
    // host drops the step its first edit opened
    const live = (lab, toFields) => {
      let g0 = null, ed = false;
      return (n, ph) => {
        if (ph === 'start') { g0 = snapKey(); ed = false; return; }
        const f = toFields(n), ch = changes(f);
        if (ch) { edit(f); ed = true; }
        if (ph === 'set') { if (ch) step(lab); }
        else if (ph === 'end') {
          const was = g0, e2 = ed;
          g0 = null; ed = false;
          if (was !== null && was !== snapKey()) step(lab); else if (was !== null && e2) call('cancel');
        }
      };
    };
    const w = o => { W.push(o); return o; };
    // amount: the bipolar slider and its number box (1 % steps; typed "25", "-40%")
    const amtN = () => (num(R.amt, 0) + 1) / 2, amtF = n => ({ amt: r4(clamp(2 * n - 1, -1, 1)) });
    const amtParse = t => { const a = parsePct(t); return a == null ? null : (a + 1) / 2; };
    const amtT = n => amtText(2 * n - 1, R.bi); // (U11: as the badge and the Mod list say it)
    const amt = w(wk.slider({ label: 'Amount', get: amtN, def: 0.5, bipolar: true, orient: 'h', fmt: amtT, parse: amtParse, set: live('Mod amount', amtF) }));
    const amtB = w(wk.numBox({ label: 'Amount %', steps: 200, get: amtN, def: 0.5, fmt: amtT, parse: amtParse, set: live('Mod amount', amtF) }));
    const sA = sec('', amt.el, amtB.el);
    sA.classList.add('cv-ml-amt');
    // bipolar, bypass
    const tog = (lab, k, stepLab, extra) => w(wk.toggle({ label: lab, kind: 'led', get: () => (R[k] ? 1 : 0), disabled: extra && extra.disabled,
      set: v => { const f = extra && extra.fields ? extra.fields(v) : { [k]: v ? 1 : 0 }; if (changes(f)) { edit(f); step(stepLab); } } }));
    const bi = tog('Bipolar', 'bi', 'Mod polarity'), byp = tog('Bypass', 'byp', 'Mod bypass');
    const tg = mk('div', 'cv-ml-tg');
    tg.append(bi.el, byp.el);
    // curve (the matrix's curve, −1…1), output (0…1)
    const curve = w(wk.slider({ label: 'Curve', get: () => (num(R.curve, 0) + 1) / 2, def: 0.5, bipolar: true, orient: 'h', fmt: n => pct(2 * n - 1), parse: amtParse,
      set: live('Mod curve', n => ({ curve: r4(clamp(2 * n - 1, -1, 1)) })) }));
    const out = w(wk.slider({ label: 'Output', get: () => num(R.out, 1), def: 1, bipolar: false, orient: 'h', fmt: n => Math.round(n * 100) + '%', parse: t => parsePct(t, true),
      set: live('Mod output', n => ({ out: r4(clamp(n, 0, 1)) })) }));
    // (2b) Curve: Custom… — the Serum matrix's editable curve (graph CurveEditor 'mcurve' with its RISE / FALL) on the row's
    // crv, inline under the curve slider; one step per gesture end; Init drops it (crv null: the curve slider rules again)
    const crvBtn = button('cv-ml-btn', 'Custom…', 'curve', () => toggleCurve());
    crvBtn.title = 'Edit a custom curve for this cable (replaces the Curve amount while set)';
    const crvBox = mk('div', 'cv-ml-crv');
    crvBox.hidden = true;
    let crvEd = null;
    const crvInit = () => { const c0 = num(R.curve, 0), pts = []; for (let j = 0; j <= 4; j++) { const t = j / 4; pts.push([t, Math.round(bendOf(t, c0) * 1e5) / 1e5, 0]); } return pts; };
    const crvStep = ph => { if (ph === 'set' || ph === 'end') step('Mod custom curve'); };
    function toggleCurve() {
      if (crvEd) { try { crvEd.destroy(); } catch (err) { /* gone */ } crvEd = null; crvBox.hidden = true; crvBox.textContent = ''; refresh(); return; }
      crvBox.hidden = false;
      try {
        crvEd = new CurveEditor(crvBox, {
          kind: 'mcurve', height: 140,
          get: () => (Array.isArray(R.crv) && R.crv.length >= 2 ? R.crv : crvInit()),
          set: (pts, ph) => { edit({ crv: pts }); crvStep(ph); },
          slew: { get: () => ({ rise: num(R.rise, 0), fall: num(R.fall, 0), slink: num(R.slink, 0) }),
            set: (p, ph) => { const f = {}; for (const k of ['rise', 'fall', 'slink']) if (p && p[k] !== undefined) f[k] = k === 'slink' ? (p[k] ? 1 : 0) : r4(clamp(+p[k] || 0, 0, 1)); if (f.slink || (f.slink === undefined && R.slink)) f.fall = f.rise !== undefined ? f.rise : num(R.rise, 0); if (changes(f)) { edit(f); crvStep(ph); } } },
          init: () => { if (R.crv) { edit({ crv: null }); step('Init curve'); } },
        });
        W.push({ update() { if (crvEd && typeof crvEd.update === 'function') crvEd.update(); }, destroy() { if (crvEd) { try { crvEd.destroy(); } catch (err) { /* gone */ } crvEd = null; } } });
      } catch (err) { crvBox.hidden = true; crvEd = null; notice('Curve editor not available'); }
      refresh();
    }
    // aux source (Serum-native ids normRow accepts) and aux invert
    const auxItems = () => {
      const seen = new Set(['']), list = [{ v: '', label: '(none)' }];
      for (const s of call('sources', dev) || []) {
        if (!isObj(s)) continue;
        const id = NATIVE[s.id] || s.id;
        if (typeof id !== 'string' || seen.has(id) || !Object.prototype.hasOwnProperty.call(SRC_INDEX, id)) continue;
        seen.add(id);
        list.push(Object.assign({ v: id, label: String(s.label || srcName(CANVAS[id] || id)) }, s.group ? { group: String(s.group) } : null));
      }
      if (R.aux && !seen.has(R.aux)) list.push({ v: R.aux, label: srcName(CANVAS[R.aux] || R.aux) });
      return list;
    };
    const aux = w(wk.menu({ label: 'Aux source', items: auxItems, get: () => R.aux || '', arrows: false, wheel: false,
      set: v => { const f = { aux: String(v || '') }; if (changes(f)) { edit(f); step('Mod aux'); } } }));
    const inv = tog('Invert aux', 'inv', 'Mod aux invert', { disabled: () => !R.aux });
    // slew: rise, fall (= rise while linked), link
    const rise = w(wk.slider({ label: 'Rise', get: () => num(R.rise, 0), def: 0, orient: 'h', fmt: n => Math.round(n * 100) + '%', parse: t => parsePct(t, true),
      set: live('Mod slew', n => R.slink ? { rise: r4(n), fall: r4(n) } : { rise: r4(n) }) }));
    const fall = w(wk.slider({ label: 'Fall', get: () => num(R.slink ? R.rise : R.fall, 0), def: 0, orient: 'h', fmt: n => Math.round(n * 100) + '%', parse: t => parsePct(t, true),
      disabled: () => !!R.slink, set: live('Mod slew', n => ({ fall: r4(n) })) }));
    const link = tog('Link', 'slink', 'Mod slew link', { fields: v => v ? { slink: 1, fall: num(R.rise, 0) } : { slink: 0 } });
    // Save with preset (canvas) / Keep on canvas (preset); Disconnect
    const foot = mk('div', 'cv-ml-foot'), why = mk('span', 'cv-ml-why');
    const move = pre
      ? button('cv-ml-btn', 'Keep on canvas', 'keep', () => moveRow())
      : button('cv-ml-btn', 'Save with preset', 'save', () => moveRow());
    move.title = pre ? 'Move this row out of the preset onto the canvas (a cable of this track)' : 'Move this cable into the ' + ownTag(dev) + '\'s preset (its matrix)';
    const disc = button('cv-ml-btn', 'Disconnect', 'disconnect', () => {
      call('remove', T.key);
      closePop();
      step('Disconnect');
    });
    foot.append(move, disc, why);
    // ((milestone 3, §2.4) a hidden destination: "Show OSC B" — its part's module, or the module revealed)
    if (hid && isObj(hid.show) && typeof hid.show.action === 'function') {
      const sh = button('cv-ml-btn', String(hid.show.label || 'Show'), 'show', () => { closePop(); try { hid.show.action(); } catch (err) { console.error(err); } });
      foot.insertBefore(sh, move);
    }
    function moveRow() {
      if (move.disabled) return;
      const res = pre ? call('fromPreset', dev, T.slot) : call('toPreset', T.id);
      if (res === false || (isObj(res) && res.ok === false)) {
        const B = budgetOf(dev);
        notice(isObj(res) && res.why ? res.why : refusal(isObj(res) && res.code ? res.code : 'full', { dev: devName(dev), used: B.used, max: B.max }));
        return;
      }
      closePop();
      step(pre ? 'Keep on canvas' : 'Save with preset');
    }
    const sC = sec('', curve.el, crvBtn), sAux = sec('', aux.el, inv.el);
    sC.classList.add('cv-ml-curve');
    if (!sx) { move.hidden = true; sAux.hidden = true; } // ((2b) a classic / panel row has no preset to move into; (C7) its aux would name the synthetic CP's slot, not a canvas source — no Aux menu)
    if (own) move.hidden = true; // ((3) a Serum's own LFO / ENV / macro row stays in its matrix: no canvas cable to move it to)
    box.append(sA, tg, sC, crvBox, sec('', out.el), sAux, sec('', rise.el), sec('', fall.el, link.el), foot);
    function refresh() {
      for (const x of W) x.update();
      const tt = titleOf();
      if (hd.t.textContent !== tt) { hd.t.textContent = tt; hd.t.title = tt; box.setAttribute('aria-label', 'Modulation: ' + tt); }
      const B = budgetOf(dev), left = !pre && B.left.has(T.id);
      // (2b) a Serum row: its matrix "n/64"; a classic / panel row: the ModCore slot budgets "LFO 3/10 · ENV 1/4 · ext 2/16"
      hd.b.textContent = sx ? B.used + '/' + B.max : slotsText(B.slots, ['lfo', 'env', 'ext']) || B.canvas + ' cables';
      hd.b.title = sx ? devName(dev) + '\'s mod rows: ' + B.used + ' of ' + B.max + ' used' + (B.left.size ? ', ' + B.left.size + ' not compiled' : '') : 'ModCore slots of this track: ' + (slotsText(B.slots) || 'none') + (B.left.size ? ', ' + B.left.size + ' not compiled' : '');
      if (B.full) hd.b.setAttribute('data-full', ''); else hd.b.removeAttribute('data-full');
      leftTag.hidden = !left;
      if (left) leftTag.textContent = leftText(B, T.id);
      const custom = Array.isArray(R.crv) && R.crv.length >= 2;
      crvBtn.textContent = crvEd ? 'Done' : custom ? 'Custom ✓' : 'Custom…';
      curve.el.classList.toggle('cv-ml-dim', custom); // (a custom curve replaces the amount)
      // Save with preset needs a free matrix slot (a row that found none has no slot to move into) and a performance source
      let no = '';
      if (!pre && !NATIVE[R.src]) no = 'Only Mod Wheel, Velocity, Aftertouch and Bend cables can be saved with a preset';
      else if (!pre && (left || B.used >= B.max)) no = refusal('full', { dev: devName(dev), used: B.used, max: B.max });
      move.disabled = !!no;
      why.textContent = no;
      why.hidden = !no || !sx;
      if (no) move.title = no;
    }
    p.sync = () => { const r = readRow(T); if (!r) { closePop(); return; } R = r; refresh(); };
    refresh();
    place(box, x, y);
    if (!pre) call('select', T.id);
    try { amt.focus(); } catch (err) { /* no focus */ }
    return true;
  }

  /* ---------------------------------------------------------------- the parameter list */
  /**
   * The destinations of `dev` for a cable from `src` (a canvas source id), by the descs' groups; nomod entries greyed (a tap
   * says why); a pick → host.connect(src, '<dev>:<id>'), one step "Modulate <knob> with <source>", or the refusal as a notice.
   */
  function openDestList(src, dev, x, y) {
    const list = (call('descs', dev) || []).filter(x => isObj(x) && typeof x.id === 'string');
    const groups = new Map();
    for (const d of list) { const g = d.group ? String(d.group) : 'Other'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(d); }
    const sn = srcName(src), title = 'Modulate ' + devName(dev) + ' with ' + sn;
    const p = popover('dest', title, x, y), box = p.box;
    const hd = head(title, [], true), B = budgetOf(dev);
    hd.b.textContent = B.used + '/' + B.max;
    if (B.full) hd.b.setAttribute('data-full', '');
    const view = mk('div', 'cv-ml-grps');
    box.append(hd.el, view);
    const pick = d => {
      if (d.nomod) { notice(d.why ? String(d.why) : refusal('nomod')); return; }
      if (d.stage) { notice(refusal('stage', { src: sn, dst: d.label ? String(d.label) : d.id, stage: String(d.stage) })); return; } // ((2b) a chunk knob: stage 5)
      const knob = d.label ? String(d.label) : d.id, r = call('connect', src, dev + ':' + d.id);
      if (isObj(r) && r.ok) { closePop(); step('Modulate ' + knob + ' with ' + sn); return; }
      notice(isObj(r) && r.why ? String(r.why) : refusal(isObj(r) ? r.code || (r.stage ? 'stage' : '') : '', { src: sn, dst: knob, dev: devName(dev), stage: isObj(r) ? r.stage : '', used: B.used, max: B.max }));
    };
    const showItems = (g, back) => {
      view.textContent = '';
      view.className = 'cv-ml-items';
      if (back) {
        const b = button('cv-ml-back', '‹ ' + g, 'back', () => showGroups());
        b.setAttribute('aria-label', 'Back to the groups');
        view.append(b);
      }
      for (const d of groups.get(g)) {
        const it = button('cv-ml-item', null, null, () => pick(d));
        it.append(mk('span', null, d.label ? String(d.label) : d.id));
        it.setAttribute('data-dest', d.id);
        if (d.nomod) { it.setAttribute('aria-disabled', 'true'); it.title = d.why ? String(d.why) : refusal('nomod'); }
        else if (d.stage) { it.setAttribute('aria-disabled', 'true'); it.setAttribute('data-stage', String(d.stage)); it.title = refusal('stage', { stage: String(d.stage) }); it.append(mk('span', 'cv-ml-tag', 'stage ' + d.stage)); }
        view.append(it);
      }
      focusFirst();
    };
    const showGroups = () => {
      view.textContent = '';
      view.className = 'cv-ml-grps';
      for (const [g, ds] of groups) {
        const b = button('cv-ml-grp', null, null, () => showItems(g, true));
        b.setAttribute('data-group', g);
        b.append(mk('span', null, g), mk('span', null, String(ds.length)));
        view.append(b);
      }
      focusFirst();
    };
    const focusFirst = () => { const f = view.children[0]; if (f && P === p) { try { f.focus({ preventScroll: true }); } catch (err) { /* no focus */ } } };
    if (!groups.size) view.append(mk('p', 'cv-ml-empty', devName(dev) + ' has no knobs to modulate'));
    else if (groups.size === 1) showItems(groups.keys().next().value, false);
    else showGroups();
    p.sync = () => {};
    place(box, x, y);
    focusFirst();
    return true;
  }

  /* ---------------------------------------------------------------- the Mod list */
  let L = null; // { S, body, title, devs }
  /**
   * The track's Mod list: a sheet, one section per destination device (devs: ids or {id, label}) — its budget "n/64",
   * its canvas rows then its preset rows ("<source> → <knob> · amount · bypassed", tags "preset" / "not compiled: matrix
   * full"); a tap → the inspector; Disconnect all (canvas rows; confirmed) per device.
   */
  function openList(trackLabel, devs) {
    closeList();
    const body = mk('div', 'cv-ml-list');
    const S = sheet({ title: 'Modulation · ' + (trackLabel || 'Track'), body, layer: H.layer, doc: D(), onClose: () => { if (L && L.S === S) { L = null; closePop(); } } });
    L = { S, body, devs: (devs || []).map(d => typeof d === 'string' ? { id: d, label: '' } : isObj(d) && typeof d.id === 'string' ? { id: d.id, label: d.label ? String(d.label) : '' } : null).filter(Boolean) };
    renderList();
    return true;
  }
  function renderList() {
    if (!L) return;
    const body = L.body;
    body.textContent = '';
    let n = 0;
    for (const { id: dev, label: lab } of L.devs) {
      const rows = (call('rowsOf', dev) || []).filter(isObj), pres = (call('presetRows', dev) || []).filter(isObj);
      const B = budgetOf(dev, rows), name = lab || devName(dev);
      const grp = mk('section', 'cv-ml-dev'), dh = mk('div', 'cv-ml-dh'), b = mk('span', 'cv-ml-b', budgetText(B));
      grp.setAttribute('data-dev', dev);
      grp.setAttribute('aria-label', name + ', ' + B.used + ' of ' + B.max + ' mod rows');
      if (B.full) b.setAttribute('data-full', '');
      dh.append(mk('span', null, name), b);
      if (rows.length) {
        const all = button('cv-ml-btn', 'Disconnect all', 'all', () => {
          const k = rows.length, q = 'Disconnect ' + k + ' canvas cable' + (k === 1 ? '' : 's') + ' from ' + name + '? Rows saved with the preset stay.';
          const ok = typeof H.confirm === 'function' ? call('confirm', q) : typeof globalThis.confirm === 'function' ? globalThis.confirm(q) : true;
          if (!ok) return;
          for (const r of rows) call('remove', r.id);
          closePop();
          step('Disconnect all');
        });
        dh.append(all);
      }
      grp.append(dh);
      const line = (R, pre) => {
        const t = lineOf(R, pre, dev), left = !pre && B.left.has(R.id);
        const el = button('cv-ml-line', null, null, () => {
          const r = el.getBoundingClientRect();
          openInspector(pre ? { preset: dev, slot: R.slot } : { id: R.id, dev }, r.left, r.bottom + 4);
        });
        el.append(mk('span', null, t));
        if (pre) { const o = ownRow(R, pre), g = mk('span', 'cv-ml-tag', o ? ownTag(dev) : 'preset'); g.setAttribute('data-tag', o ? 'own' : 'preset'); el.append(g); } // ((3) parts view: its own rows)
        const hz = hiddenOf(dev, pidOfRow(R, pre));
        if (hz) { const g = mk('span', 'cv-ml-tag', hz.tag); g.setAttribute('data-tag', 'hidden'); el.append(g); } // ((3) no mounted view shows the knob
        if (left) { const g = mk('span', 'cv-ml-tag', leftText(B, R.id)); g.setAttribute('data-tag', 'left'); el.append(g); }
        if (R.byp) el.setAttribute('data-byp', '');
        el.setAttribute(pre ? 'data-slot' : 'data-row', pre ? String(R.slot) : R.id);
        el.setAttribute('aria-label', t + (pre ? ', saved with the preset' : '') + (left ? ', ' + leftText(B, R.id) : ''));
        grp.append(el);
        n++;
      };
      for (const R of rows) line(R, false);
      for (const R of pres) line(R, true);
      if (!rows.length && !pres.length) grp.append(mk('p', 'cv-ml-empty', 'No modulation'));
      body.append(grp);
    }
    if (!n && !L.devs.length) body.append(mk('p', 'cv-ml-empty', 'No modulation cables on this track yet. Drag a modulator\'s jack onto a knob.'));
  }
  const syncList = () => { if (L && L.S.isOpen()) renderList(); };
  function closeList() { if (!L) return false; const l = L; L = null; l.S.close(); return true; }

  return {
    openInspector, openDestList, openList,
    /** Close the innermost (the Escape chain, U7): the popover when one is open, else the Mod list → whether one closed. */
    close() { return closePop() || closeList(); },
    isOpen: () => !!P || !!(L && L.S.isOpen()),
    /** Re-read the host after an outside change (undo / redo, a preset load): the open inspector follows its row (closes
     * when it is gone), the Mod list re-renders. */
    sync() { if (P && P.sync) P.sync(); syncList(); },
    refusal, STYLE,
  };
}
