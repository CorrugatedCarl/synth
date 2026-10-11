// serum-ui.js — the Serum-style instrument panel (SPEC-serum §8.8, §9): SerumUI with the OSC / FX / MATRIX /
// GLOBAL pages, the header (tabs, preset area, main menu, voice counter, MASTER), drag-and-drop modulation with
// halos and live dots, the knob right-click menus, the matrix, locks, MIDI-learn hooks, the wavetable / noise /
// filter displays, the WT editor overlay, and PresetBrowser (§9.10).
//
// Browser ES module. Nothing touches document / window / localStorage / navigator at module top level, so node
// can import it for the pure-helper tests (§0.1, §10.6). Sibling modules are imported as namespaces: a helper
// missing from a sibling degrades one feature (with a notice) instead of failing the whole panel at link time.
//
// Pure helpers (node-tested, tests/serum-ui.test.mjs): haloArcs, knobMenuItems, dropRow, busMenuItems,
// lfoTileCount, sortPresets, filterPresets, browserList, stepPreset, captureDue, plus clipModule / pasteModule /
// initModule, linkPoints, parseGrid, parseAmount, normPrefs, presetCats, memTrigSet, tileDests, modTipLines.
//
// Edits: every state change goes through host.edit / host.editFx (fn mutates the live state in place). UI-only
// changes (s.ui.*, page, editor selection) pass { ui: true }. Continuous gestures send phase start → move… → end
// with a stable label. Preset-like loads (Init Preset, effect chains) also pass { seed: true } (hosts may ignore).
//
// Optional host members used when present (all degrade gracefully; for the integrator):
//   host.wt.rename(id, name)   — renames a user table (§9.3 Rename button); without it the rename is a full
//                                host.wt.update of the table under its new name (wtstore.put stores table.name)
//   host.wt.del(id)            — deletes a user table / noise from the store (OSC / NOISE Delete buttons); the host
//                                switches every sound of the project that used it to the default source
//   host.wt.users(id)          — names of the tracks using it (named in the delete confirmation)
//   host.sampleRate            — number or () => number: GLOBAL's "Running at 96 kHz" (§9.7) before the first
//                                snapshot arrives (afterwards the snapshot's tapRate = the processor's own rate)
//   host.editorOpen(o | null)  — the WT editor opened / closed (for the "Mod wheel → WT Pos" preference, §9.9);
//                                the same information is the public field ui.editorOsc (0 | 1 | null)
//   host.prefsChanged(prefs)   — a preference changed (smooth / silenceTails / defOs / author / wheelWt, §9.7);
//                                every change is also written with host.storage.set('synth.sx.prefs', prefs)
// The "Default WT view" preference applies to Init Preset and to a sound that is still the untouched default
// when the panel mounts (new tracks; §11 withPrefs sets only global.os and author).
// Storage keys: synth.sx.prefs, synth.sx.browser, synth.sx.shapes (via graph.shapeLib), synth.fxchains; the
// WT editor's synth.sx.wte.split (held import split size) is honoured by wavetable drops on the displays.
// MIDI program change: index browserList(host.presets.list(), storage[BROWSER_KEY]) (§9.10, §11.8).
import * as core from './serum-core.js?v=5';
import * as wt from './wt.js?v=5';
import * as wk from './wk.js?v=5';
import * as gx from './graph.js?v=5';
import * as fxui from './fx-ui.js?v=5';
import * as wte from './wtedit.js?v=5';

/* ================================================================ constants and small helpers */

const { DESTS, DEST_INDEX, NS, SOURCES, SRC_INDEX, SRC_MENU, FILTERS, FILTER_CATS, WARPS, SUB_SHAPES, UNI_STACKS,
  UNI_MODES, MODULE_FIELDS, MC_K } = core;

export const PREFS_KEY = 'synth.sx.prefs';
export const BROWSER_KEY = 'synth.sx.browser';
const SHAPES_KEY = 'synth.sx.shapes';
const CHAINS_KEY = 'synth.fxchains';
const PAGES = ['osc', 'fx', 'matrix', 'global'];
const PAGE_LABEL = { osc: 'OSC', fx: 'FX', matrix: 'MATRIX', global: 'GLOBAL' };
const MOD_NOUN = { oscA: 'OSC', oscB: 'OSC', noise: 'Noise', sub: 'Sub', filter: 'Filter' };
const ENV_KEYS = ['att', 'hold', 'dec', 'sus', 'rel'];
const ENV_ED = { a: 'att', h: 'hold', d: 'dec', s: 'sus', r: 'rel', ca: 'ca', cd: 'cd', cr: 'cr' };
const LFO_KNOBS = [['rate', 'RATE'], ['rise', 'RISE'], ['delay', 'DELAY'], ['smooth', 'SMOOTH']];
const I_MASTER = DEST_INDEX['g.master'], I_BYPASS = DEST_INDEX['g.bypass'];
const C = { bg: '#0f1216', panel: '#161b21', line: '#2a333d', ink: '#dfe6ee', mute: '#7f8b98', accent: '#4fb3ff',
  neg: '#ffb347', on: '#6fe3a1', warn: '#ff6a4a', graph: '#59c2ff', cur: '#ffd84a', grey: '#55606c' };

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const clamp01 = x => (x > 0 ? (x < 1 ? x : 1) : 0);
const fin = x => typeof x === 'number' && isFinite(x);
const fnOf = v => (typeof v === 'function' ? v : () => v);
const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
const arr = x => (Array.isArray(x) ? x : []);
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const frac = x => x - Math.floor(x);
const sgn = v => (v > 0 ? '+' : '');
const isFxIdx = i => i >= NS && i !== I_MASTER && i !== I_BYPASS;
const destOf = id => { const i = DEST_INDEX[id]; return i === undefined ? null : DESTS[i]; };
const gridOf = d => (!d ? 0 : d.law === 'int' ? d.hi - d.lo : d.law === 'enum' ? d.hi : d.law === 'bool' ? 1 : 0);
const stepsOf = d => (d && (d.law === 'int' || d.law === 'enum') ? gridOf(d) : 0);
const srcPol = id => { const i = SRC_INDEX[id]; return i ? SOURCES[i].pol : 'uni'; };
const lfoNum = id => { const m = /^lfo([1-8])$/.exec(id || ''); return m ? +m[1] : 0; };
const envNum = id => { const m = /^env([1-3])$/.exec(id || ''); return m ? +m[1] : 0; };
const rowActive = r => !!(r && r.src && r.dst && !r.byp && r.amt !== 0 && r.out !== 0);
const emptyRow = () => ({ src: '', amt: 0, dst: '', bi: 0, curve: 0, aux: '', inv: 0, byp: 0, out: 1 });
const nameOfId = id => String(id || '').replace(/^[a-z]+:/, '') || '—';
const NOISE_OV = new Map();   // factory noise id → min/max overview (Float32Array(512)), shared by every SerumUI
const warnOnce = (() => { const seen = new Set(); return (k, ...a) => { if (!seen.has(k)) { seen.add(k); console.warn(...a); } }; })();

// normalised n snapped to the grid of a stepped law (exactly k/(hi−lo), as normalizeSerum stores it)
function snapN(id, n) {
  const m = gridOf(destOf(id));
  return m ? Math.round(clamp01(n) * m) / m : clamp01(n);
}
// base n of a DEST: synth ids (and g.master / g.bypass) from s.p, FX ids from fx.p, else the default (§5.8)
function baseN(s, fx, id) {
  if (typeof core.destBase === 'function') return core.destBase(s, fx, id);
  const i = DEST_INDEX[id];
  if (i === undefined) return 0;
  const src = isFxIdx(i) ? fx : s, v = src && src.p ? src.p[id] : undefined;
  return fin(v) ? clamp01(v) : DESTS[i].def;
}
function rowsOf(s) { return s && Array.isArray(s.matrix) ? s.matrix : []; }

// Display label of a source; macros show their user names
export function srcLabel(s, id) {
  const m = /^macro([1-4])$/.exec(id || '');
  if (m && s && s.macros && s.macros[m[1] - 1] && s.macros[m[1] - 1].name) return s.macros[m[1] - 1].name;
  const i = SRC_INDEX[id];
  return i ? SOURCES[i].label : '—';
}

/* ================================================================ pure helpers (§8.8, node-tested) */

// Halo arcs of every active row on control `destId` (§5.8): normalised, clamped, from ≤ to.
// unipolar row + unipolar source [base, base + a]; unipolar row + bipolar source [base − |a|, base + |a|];
// bipolar row [base − |a|/2, base + |a|/2]; a = amt·out. kind: 'sel' (row source = selSrc), 'neg' (a < 0),
// 'other'. Aux sources are ignored (the arc shows the maximum reach). Each arc carries its matrix slot.
export function haloArcs(s, fx, destId, selSrc) {
  const out = [];
  if (DEST_INDEX[destId] === undefined) return out;
  const base = baseN(s, fx, destId), M = rowsOf(s);
  for (let slot = 0; slot < M.length; slot++) {
    const r = M[slot];
    if (!rowActive(r) || r.dst !== destId) continue;
    const a = r.amt * r.out, m = Math.abs(a);
    let lo, hi;
    if (r.bi) { lo = base - m / 2; hi = base + m / 2; }
    else if (srcPol(r.src) === 'bi') { lo = base - m; hi = base + m; }
    else { lo = Math.min(base, base + a); hi = Math.max(base, base + a); }
    out.push({ from: clamp01(lo), to: clamp01(hi), kind: r.src === selSrc ? 'sel' : a < 0 ? 'neg' : 'other', slot });
  }
  return out;
}

// [{slot, row}] of the rows on dst that have a source (any state: bypassed / zero rows included)
function modRows(s, dst) {
  const out = [], M = rowsOf(s);
  for (let slot = 0; slot < M.length; slot++) { const r = M[slot]; if (r && r.dst === dst && r.src) out.push({ slot, row: r }); }
  return out;
}
// lowest CC whose MIDI-learn target is id, or null
export function ccFor(s, id) {
  let best = null;
  const m = s && isObj(s.midi) ? s.midi : {};
  for (const k of Object.keys(m)) if (m[k] === id && (best === null || +k < best)) best = +k;
  return best;
}

// Knob right-click menu (§9.4), exact order: [module items · sep] · Bypass Modulator: <src> (per row) · Remove
// Modulator: <src> (per row) · Remove All Modulators · sep · Reset Control · Enter Value… · [New MemTrig phase
// set] · sep · Mod Source ▸ · sep · MIDI Learn | MIDI Re-learn (CC n), Remove MIDI CC n · Lock | Unlock.
// Items without rows are omitted (never shown disabled). caps = { midi, module: 'oscA'…, paste }.
// Returns [{label, kind, slot?, checked?, sub?}]; separators are { label: '', kind: 'sep' }.
export function knobMenuItems(s, fx, destId, caps) {
  const c = caps || {}, out = [];
  const sep = () => { if (out.length && out[out.length - 1].kind !== 'sep') out.push({ label: '', kind: 'sep' }); };
  if (c.module && MOD_NOUN[c.module]) {
    const noun = MOD_NOUN[c.module], locked = !!(s && s.locks && arr(s.locks.mod).includes(c.module));
    out.push({ label: 'Lock Module', kind: 'lockModule', checked: locked });
    out.push({ label: 'Copy ' + noun, kind: 'copy' });
    if (c.paste) out.push({ label: 'Paste ' + noun, kind: 'paste' });
    out.push({ label: 'Init ' + noun, kind: 'init' });
    sep();
  }
  const rows = modRows(s, destId);
  for (const { slot, row } of rows) out.push({ label: 'Bypass Modulator: ' + srcLabel(s, row.src), kind: 'bypass', slot, checked: !!row.byp });
  for (const { slot, row } of rows) out.push({ label: 'Remove Modulator: ' + srcLabel(s, row.src), kind: 'remove', slot });
  if (rows.length) { out.push({ label: 'Remove All Modulators', kind: 'removeAll' }); sep(); }
  out.push({ label: 'Reset Control', kind: 'reset' });
  out.push({ label: 'Enter Value…', kind: 'enter' });
  if (destId === 'a.phase' || destId === 'b.phase') out.push({ label: 'New MemTrig phase set', kind: 'memtrig' });
  sep();
  out.push({ label: 'Mod Source', kind: 'modsrc', sub: SRC_MENU.map(id => ({ label: srcLabel(s, id), kind: 'src', src: id })) });
  sep();
  if (c.midi) {
    const cc = ccFor(s, destId);
    if (cc === null) out.push({ label: 'MIDI Learn', kind: 'midiLearn' });
    else {
      out.push({ label: 'MIDI Re-learn (CC ' + cc + ')', kind: 'midiLearn', cc });
      out.push({ label: 'Remove MIDI CC ' + cc, kind: 'midiForget', cc });
    }
  }
  const locked = !!(s && s.locks && arr(s.locks.p).includes(destId));
  out.push({ label: locked ? 'Unlock' : 'Lock', kind: locked ? 'unlock' : 'lock' });
  return out;
}

// Drag-and-drop row (§5.8, wraps addMod; mutates s): {slot, row} or null when the matrix is full / ids invalid.
// opts.limit = the "Limit mod depth on drop" preference (default on).
export function dropRow(s, fx, src, dst, opts) {
  const limit = opts && 'limit' in opts ? !!opts.limit : true;
  const slot = core.addMod(s, fx, src, dst, { limit });
  return slot >= 0 ? { slot, row: s.matrix[slot] } : null;
}

// LFO point-modulation menu (§9.4): `Bus k (<source labels>)` for every bus some point links (ascending;
// just `Bus k` when no row feeds it), then `New bus` = newBus(s) (omitted when 0). pt = point index or array;
// an item is `checked` when every listed point already links that bus on `axis` ('x' | 'y').
export function busMenuItems(s, lfo, pt, axis) {
  const items = [], map = core.linkedBuses(s), ai = axis === 'x' ? 3 : 4;
  const idxs = Array.isArray(pt) ? pt : pt === undefined || pt === null ? [] : [pt];
  const pts = s && s.lfo && s.lfo[lfo] ? arr(s.lfo[lfo].pts) : [];
  for (const bus of Array.from(map.keys()).sort((a, b) => a - b)) {
    const labels = [];
    for (const id of arr(map.get(bus).sources)) { const l = srcLabel(s, id); if (!labels.includes(l)) labels.push(l); }
    const it = { label: 'Bus ' + bus + (labels.length ? ' (' + labels.join(', ') + ')' : ''), bus };
    if (idxs.length && idxs.every(i => pts[i] && pts[i][ai] === bus)) it.checked = true;
    items.push(it);
  }
  const nb = core.newBus(s);
  if (nb) items.push({ label: 'New bus', bus: nb });
  return items;
}

// In place: links axis ('x' | 'y') of points idxs of LFO `lfo` to `bus`; with src also adds the row
// src → bus<k> (bipolar, amount 0.5). First/last points never take an X link. The rows of the buses the relinked
// points held before and that no point links any more are pruned (inv A13); rows aimed at buses no point ever
// linked (a routing prepared in the matrix) are kept. Returns the number of points linked (0 → nothing changed).
export function linkPoints(s, fx, lfo, idxs, axis, bus, src) {
  const L = s && s.lfo && s.lfo[lfo];
  if (!L || !(bus >= 1 && bus <= 16)) return 0;
  const pts = L.pts, ai = axis === 'x' ? 3 : 4, cut = [];
  let n = 0;
  for (const i of arr(idxs)) {
    const p = pts[i];
    if (!p || (ai === 3 && (i === 0 || i === pts.length - 1))) continue;
    const q = p.slice(0, 3).concat([p[3] || 0, p[4] || 0]), was = busNum(q[ai]);
    if (was && was !== bus && !cut.includes(was)) cut.push(was);
    q[ai] = bus;
    pts[i] = q;
    n++;
  }
  if (!n) return 0;
  if (src) core.addMod(s, fx, src, 'bus' + bus, { amt: 0.5, bi: 1 });
  pruneLost(s, cut);
  return n;
}
const busNum = v => (fin(v) && Math.round(v) >= 1 && Math.round(v) <= 16 ? Math.round(v) : 0);
// Menu items gathered by `group` (wk.menu starts a new group box whenever the group changes between neighbours):
// groups in the order of `order` (then of first appearance), items keep their relative order inside a group.
export function groupItems(items, order) {
  const rank = new Map();
  for (const g of arr(order)) if (!rank.has(g)) rank.set(g, rank.size);
  for (const it of arr(items)) { const g = it.group === undefined ? '' : it.group; if (!rank.has(g)) rank.set(g, rank.size); }
  const key = it => rank.get(it.group === undefined ? '' : it.group);
  return arr(items).map((it, i) => [it, i]).sort((a, b) => key(a[0]) - key(b[0]) || a[1] - b[1]).map(x => x[0]);
}
// A sound nobody has edited yet: the default state apart from the view (ui) and the fields new tracks take from
// the preferences (global.os, author; §11 withPrefs). Used to apply the "Default WT view" preference to new tracks.
export function isPristine(s) {
  if (!isObj(s) || typeof core.normalizeSerum !== 'function') return false;
  const strip = x => { const c = core.normalizeSerum(x); delete c.ui; c.global.os = 0; c.author = ''; return JSON.stringify(c); };
  try { return strip(s) === strip(core.defaultSerum()); } catch (err) { return false; }
}
// Layers of the 3D wavetable view (§9.3, §7.1), back to front: [{ z (0–1), slot (display slot of F), frame (real
// frame index | −1), real }]. Raw tables (F = R) show up to `max` evenly spaced frames, all real. Morph tables
// (F = 256 slots over R real frames) always include the real frames (up to `max` of them, at their slot
// round(k·(F−1)/(R−1))) and fill up to `max` layers with interpolated slots between them.
export function layers3d(F, R, max) {
  const M = max > 0 ? max : 40, out = [];
  if (!(F > 1)) return [{ z: 0, slot: 0, frame: 0, real: true }];
  if (!(R > 1) || F === R) {
    const n = Math.min(F, M);
    for (let c = 0; c < n; c++) { const k = Math.round(c * (F - 1) / (n - 1)); out.push({ z: k / (F - 1), slot: k, frame: R === F ? k : -1, real: R === F }); }
  } else {
    const nr = Math.min(R, M), taken = new Set();
    for (let c = 0; c < nr; c++) {
      const k = Math.round(c * (R - 1) / (nr - 1)), slot = Math.round(k * (F - 1) / (R - 1));
      taken.add(slot);
      out.push({ z: slot / (F - 1), slot, frame: k, real: true });
    }
    const ni = M - nr;
    for (let c = 1; c <= ni; c++) {
      const slot = Math.round(c * (F - 1) / (ni + 1));
      if (!taken.has(slot)) { taken.add(slot); out.push({ z: slot / (F - 1), slot, frame: -1, real: false }); }
    }
  }
  return out.sort((a, b) => b.z - a.z);
}
// bus numbers (1–16) linked by the X or Y of any point of a graph
export function ptsBuses(pts) {
  const out = [];
  for (const p of arr(pts)) {
    if (!Array.isArray(p)) continue;
    for (const b of [busNum(p[3]), busNum(p[4])]) if (b && !out.includes(b)) out.push(b);
  }
  return out;
}
// In place: prunes the rows of the listed buses that no point links any more (never the sweep form, inv A13)
function pruneLost(s, buses) {
  if (buses && buses.length && typeof core.pruneBuses === 'function') core.pruneBuses(s, buses);
}

// LFO tiles shown (§9.3): min(8, max(4, highest LFO number used by any row as source or aux + 1))
export function lfoTileCount(s) {
  let hi = 0;
  for (const r of rowsOf(s)) if (r) hi = Math.max(hi, lfoNum(r.src), lfoNum(r.aux));
  return Math.min(8, Math.max(4, hi + 1));
}

// destinations of the rows whose source is src (slot order, as ids; rows without a destination skipped)
export function tileDests(s, src) {
  const out = [];
  for (const r of rowsOf(s)) if (r && r.src === src && r.dst) out.push(r.dst);
  return out;
}

// Tooltip lines of the modulators on a control (§9.4): `<src> <±amount%> <-> | ->`
export function modTipLines(s, destId) {
  return modRows(s, destId).map(({ row }) => srcLabel(s, row.src) + ' ' + sgn(row.amt) + Math.round(row.amt * 100) + '% '
    + (row.bi ? '<->' : '->') + (row.byp ? ' (bypassed)' : ''));
}

// Phase capture (§6.4): oscillators o whose base PHASE is Mem in `next` while RAND went from < 0.9995 (prev) to
// ≥ 0.9995 (next) with notes sounding. prev/next = states or plain s.p maps.
export function captureDue(prev, next, notes) {
  const out = [];
  if (!(notes > 0)) return out;
  const P = x => (x && isObj(x.p) ? x.p : x || {});
  const a = P(prev), b = P(next);
  ['a', 'b'].forEach((k, o) => {
    if (b[k + '.phase'] >= 0.9995 && a[k + '.rand'] < 0.9995 && b[k + '.rand'] >= 0.9995) out.push(o);
  });
  return out;
}

// 16 unison start phases for "New MemTrig phase set" (seeded; 6 decimals like the defaults)
export function memTrigSet(seed) {
  const r = mulberry32(seed >>> 0);
  return Array.from({ length: 16 }, () => Math.round(r() * 1e6) / 1e6 % 1);
}
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Module clipboard (title / power menus, §9.3). OSC data pastes across A ↔ B (fields matched by suffix:
// 'a.level' ↔ 'b.level'; osc[i], uniRange[i], uniMode[i]); other modules paste onto themselves only.
const modKind = m => (m === 'oscA' || m === 'oscB' ? 'osc' : m);
const suffixOf = id => id.slice(id.indexOf('.') + 1);
function getPath(o, path) { let v = o; for (const k of path) { if (v === null || typeof v !== 'object') return undefined; v = v[k]; } return v; }
function setPath(o, path, v) {
  let t = o;
  for (let j = 0; j < path.length - 1; j++) {
    if (!t[path[j]] || typeof t[path[j]] !== 'object') t[path[j]] = typeof path[j + 1] === 'number' ? [] : {};
    t = t[path[j]];
  }
  t[path[path.length - 1]] = v;
}
export function clipModule(s, m) {
  const F = MODULE_FIELDS[m];
  if (!F || !s) return null;
  const p = {};
  for (const id of F.p) if (s.p && fin(s.p[id])) p[suffixOf(id)] = s.p[id];
  return { kind: modKind(m), p, paths: F.paths.map(path => clone(getPath(s, path))) };
}
// In place; returns false when the clipboard does not fit module m. Re-applies the warp single-direction rule
// with the pasted oscillator as the most recent choice.
export function pasteModule(s, m, clip) {
  const F = MODULE_FIELDS[m];
  if (!F || !clip || clip.kind !== modKind(m)) return false;
  for (const id of F.p) { const v = clip.p[suffixOf(id)]; if (fin(v)) s.p[id] = v; }
  F.paths.forEach((path, j) => { if (clip.paths[j] !== undefined) setPath(s, path, clone(clip.paths[j])); });
  if (clip.kind === 'osc') {
    const o = m === 'oscB' ? 1 : 0, id = o ? 'b.warpMode' : 'a.warpMode';
    if (typeof core.warpChoice === 'function') core.warpChoice(s, o, Math.round(22 * s.p[id]));
  }
  return true;
}
// In place: module m back to defaultSerum()'s fields
export function initModule(s, m) {
  if (!MODULE_FIELDS[m]) return false;
  const d = core.defaultSerum();
  if (typeof core.copyModule === 'function') return core.copyModule(s, d, m);
  return pasteModule(s, m, clipModule(d, m));
}

// LFO GRID text box: 'x' or 'x,y' (1–64) → {x, y} | null
export function parseGrid(text) {
  const m = /^\s*(\d{1,2})\s*(?:[,x×]\s*(\d{1,2})\s*)?$/i.exec(String(text));
  if (!m) return null;
  const x = +m[1], y = m[2] !== undefined ? +m[2] : x;
  return x >= 1 && x <= 64 && y >= 1 && y <= 64 ? { x, y } : null;
}

// Matrix AMOUNT typing (§9.5): '35', '-35 %', '0,5%' → amount ∈ [−1, 1]; '12st' / '-7 st' on semitone-linear
// destinations → semitoneAmount(dst, st, bi); anything else → null
export function parseAmount(text, dst, bi) {
  const t = String(text).trim().replace(',', '.');
  let m = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*(?:st|semi|semis|semitones?)$/i.exec(t);
  if (m) return typeof core.semitoneAmount === 'function' ? core.semitoneAmount(dst, +m[1], bi) : null;
  m = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*%?$/.exec(t);
  return m ? clamp(+m[1] / 100, -1, 1) : null;
}

// Preferences (§9.7), stored with host.storage under PREFS_KEY; app-wide, never in presets
export const PREFS_DEFAULT = Object.freeze({ tooltips: 1, dblClick: 'type', wheel: 1, view3d: 0, wheelWt: 0, limitDrop: 1,
  silenceTails: 1, defOs: 2, author: '', askPreset: 0, smooth: 1 });
export function normPrefs(p) {
  const o = isObj(p) ? p : {};
  const b = k => (o[k] === undefined || o[k] === null ? PREFS_DEFAULT[k] : o[k] ? 1 : 0);
  return {
    tooltips: b('tooltips'), dblClick: o.dblClick === 'reset' ? 'reset' : 'type', wheel: b('wheel'), view3d: b('view3d'),
    wheelWt: b('wheelWt'), limitDrop: b('limitDrop'), silenceTails: b('silenceTails'),
    defOs: o.defOs === 1 || o.defOs === 4 ? o.defOs : 2, author: typeof o.author === 'string' ? o.author.slice(0, 64) : '',
    askPreset: b('askPreset'), smooth: fin(o.smooth) ? clamp(Math.round(o.smooth * 100) / 100, 0.01, 8) : 1,
  };
}

/* ---------------------------------------------------------------- presets (§9.10) */

const COLL = typeof Intl !== 'undefined' && Intl.Collator ? new Intl.Collator('en', { numeric: true, sensitivity: 'base' }) : null;
const cmpStr = (a, b) => {
  const x = String(a == null ? '' : a), y = String(b == null ? '' : b);
  if (COLL) return COLL.compare(x, y);
  const p = x.toLowerCase(), q = y.toLowerCase();
  return p < q ? -1 : p > q ? 1 : 0;
};
const SORT_COLS = ['name', 'cat', 'author'];
export const BROWSER_DEFAULT = Object.freeze({ sort: 'name', sort2: 'cat', dir: 1, cat: '', q: '' });
export function normBrowser(b) {
  const o = isObj(b) ? b : {};
  return {
    sort: SORT_COLS.includes(o.sort) ? o.sort : 'name', sort2: SORT_COLS.includes(o.sort2) ? o.sort2 : 'cat',
    dir: o.dir === -1 || o.dir === 'desc' ? -1 : 1, cat: typeof o.cat === 'string' ? o.cat : '', q: typeof o.q === 'string' ? o.q : '',
  };
}
// Sorted copy: primary column `sort` in direction `dir` (1 | −1 | 'asc' | 'desc'); ties fall back to the
// previously clicked column `sort2`, then Name, then key (stable).
export function sortPresets(list, opts) {
  const o = opts || {}, k1 = SORT_COLS.includes(o.sort) ? o.sort : 'name', k2 = SORT_COLS.includes(o.sort2) ? o.sort2 : null;
  const dir = o.dir === -1 || o.dir === 'desc' ? -1 : 1;
  return arr(list).map((p, i) => ({ p, i })).sort((a, b) => (cmpStr(a.p[k1], b.p[k1]) * dir)
    || (k2 && k2 !== k1 ? cmpStr(a.p[k2], b.p[k2]) : 0) || cmpStr(a.p.name, b.p.name)
    || cmpStr(a.p.key, b.p.key) || a.i - b.i).map(x => x.p);
}
// Category filter ('' = All) and search (name / author substring, case-insensitive)
export function filterPresets(list, opts) {
  const o = opts || {}, cat = o.cat || '', q = String(o.q || '').trim().toLowerCase();
  return arr(list).filter(p => (!cat || p.cat === cat)
    && (!q || String(p.name || '').toLowerCase().includes(q) || String(p.author || '').toLowerCase().includes(q)));
}
// The browser's list (filtered, then sorted) — also what MIDI program change indexes (§9.10, §11.8)
export function browserList(list, st) { const b = normBrowser(st); return sortPresets(filterPresets(list, b), b); }
// Categories present, alphabetical
export function presetCats(list) {
  const set = new Set();
  for (const p of arr(list)) if (p && p.cat) set.add(p.cat);
  return Array.from(set).sort(cmpStr);
}
// ◀ ▶ (§9.10): previous / next key of `list` (already sorted) within category `cat` (null/undefined = whole
// list), wrapping. A key not in that list → its first (dir > 0) or last entry. Empty → null.
export function stepPreset(list, key, dir, cat) {
  const L = arr(list).filter(p => p && (cat === null || cat === undefined || p.cat === cat));
  if (!L.length) return null;
  const i = L.findIndex(p => p.key === key), d = dir < 0 ? -1 : 1;
  if (i < 0) return (d > 0 ? L[0] : L[L.length - 1]).key;
  return L[(i + d + L.length) % L.length].key;
}

/* ---------------------------------------------------------------- display maths */

// In-place iterative radix-2 FFT (displays only; n power of two)
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
// log-frequency axis of the filter display = the cutoff law (x = n of f.cutoff: 8.18 Hz … 22.05 kHz)
const F_LO = core.MIDI0 || 8.175798915643707, F_HI = 22050;
const fOfX = u => F_LO * Math.pow(F_HI / F_LO, u);

/* ================================================================ CSS (§9.1, §9.2; tokens on .sx-root) */

const CSS = `
.sx-root { container: sx / inline-size; position: relative; box-sizing: border-box; min-width: 0;
  --sx-bg: #0f1216; --sx-panel: #161b21; --sx-panel2: #1c232b; --sx-line: #2a333d; --sx-ink: #dfe6ee; --sx-mute: #7f8b98;
  --sx-accent: #4fb3ff; --sx-neg: #ffb347; --sx-on: #6fe3a1; --sx-warn: #ff6a4a; --sx-graph: #59c2ff;
  padding: 8px; color: var(--sx-ink); background: var(--sx-bg); border-radius: 10px; font: 500 12px/1.3 var(--ui, system-ui, sans-serif);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6), 0 20px 50px -24px rgba(0, 0, 0, 0.8); }
.sx-root *, .pb-root * { box-sizing: border-box; }
.sx-root button { font: inherit; color: inherit; }
.sx-hidden { display: none !important; }
.sx-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 2px 4px 8px; border-bottom: 1px solid var(--sx-line); }
.sx-logo { flex: 0 0 auto; width: 30px; height: 30px; color: var(--sx-accent); }
.sx-tabs { display: flex; gap: 2px; padding: 2px; background: var(--sx-panel); border: 1px solid var(--sx-line); border-radius: 7px; }
.sx-tab { min-height: 26px; padding: 3px 10px; color: var(--sx-mute); background: none; border: 0; border-radius: 5px; font-weight: 700; font-size: 11px; letter-spacing: 0.08em; cursor: pointer; }
.sx-tab:hover { color: var(--sx-ink); }
.sx-tab[aria-selected="true"] { color: var(--sx-bg); background: var(--sx-accent); }
.sx-tab:focus-visible, .sx-hbtn:focus-visible, .sx-tile:focus-visible, .sx-tname:focus-visible, .sx-btn:focus-visible { outline: 2px solid var(--sx-accent); outline-offset: 1px; }
.sx-preset { flex: 1 1 280px; display: flex; align-items: center; gap: 3px; min-width: 0; }
.sx-hbtn, .sx-btn { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-height: 26px; min-width: 26px; padding: 2px 8px; color: var(--sx-ink); background: var(--sx-panel2); border: 1px solid var(--sx-line); border-radius: 5px; font-size: 11px; cursor: pointer; white-space: nowrap; }
.sx-hbtn:hover, .sx-btn:hover { border-color: var(--sx-mute); }
.sx-hbtn svg, .sx-btn svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.sx-pname { flex: 1 1 auto; min-width: 0; justify-content: flex-start; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
.sx-pname .sx-pcat { color: var(--sx-mute); font-weight: 500; margin-right: 6px; }
.sx-dirty::after { content: ' *'; color: var(--sx-neg); }
.sx-vc { min-width: 64px; color: var(--sx-mute); font: 500 11px/1 var(--mono, ui-monospace, monospace); text-align: right; }
.sx-vc b { color: var(--sx-ink); font-weight: 600; }
.sx-master { margin-left: auto; display: flex; align-items: center; }
.sx-pages { position: relative; min-width: 0; }
.sx-page { display: grid; gap: 8px; padding-top: 8px; min-width: 0; }
.sx-row { display: grid; gap: 8px; grid-template-columns: minmax(0, 1fr); min-width: 0; }
@container sx (min-width: 900px) { .sx-rowA, .sx-rowC { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container sx (min-width: 1280px) {
  .sx-rowA { grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.2fr) minmax(0, 1.2fr) minmax(0, 1fr); }
  .sx-rowC { grid-template-columns: minmax(0, 0.7fr) minmax(0, 1.2fr) minmax(0, 1.5fr) minmax(0, 0.8fr); }
}
.sx-col { display: grid; gap: 8px; align-content: start; min-width: 0; }
.sx-panel { position: relative; min-width: 0; padding: 6px 8px 8px; background: var(--sx-panel); border: 1px solid var(--sx-line); border-radius: 8px; }
.sx-ptitle { display: flex; align-items: center; gap: 6px; min-height: 26px; margin-bottom: 4px; }
.sx-tname { color: var(--sx-ink); font-weight: 800; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; cursor: context-menu; user-select: none; -webkit-user-select: none; border-radius: 3px; }
.sx-ptitle .sx-grow { flex: 1 1 auto; min-width: 0; }
.sx-ptitle .wk-menu > .wk-lab { display: none !important; }
.sx-lockmark { display: none; width: 12px; height: 12px; color: var(--sx-neg); }
.sx-locked > .sx-ptitle .sx-lockmark { display: inline-block; }
.sx-off > .sx-pbody { opacity: 0.45; }
.sx-pbody { display: grid; gap: 6px; min-width: 0; }
.sx-krow { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 4px 6px; min-width: 0; }
.sx-krow.sx-sp { justify-content: space-between; }
.sx-krow .wk-menu { flex: 1 1 120px; min-width: 0; }
.sx-disp { display: block; width: 100%; height: 120px; background: #0a0d10; border: 1px solid var(--sx-line); border-radius: 6px; cursor: pointer; touch-action: none; }
.sx-disp.sx-tall { height: 150px; }
.sx-disp.sx-short { height: 64px; }
.sx-disp.sx-dropok { border-color: var(--sx-accent); box-shadow: 0 0 0 2px var(--sx-accent) inset; }
.sx-ico { display: inline-flex; width: 26px; height: 22px; align-items: center; justify-content: center; color: var(--sx-graph); }
.sx-ico svg { width: 22px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.6; }
.sx-route { display: flex; gap: 2px; }
.sx-route .wk-tog { min-width: 24px; padding: 2px 5px; }
.sx-locked-ctl { position: relative; }
.sx-locked-ctl::after { content: ''; position: absolute; right: 0; top: 0; width: 6px; height: 6px; border-radius: 1px; background: var(--sx-neg); box-shadow: 0 0 0 1px var(--sx-bg); pointer-events: none; }
.sx-tiles { display: flex; gap: 4px; overflow-x: auto; padding: 2px 0 4px; scrollbar-width: thin; }
.sx-tile { position: relative; flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 3px 10px; color: var(--sx-mute); background: var(--sx-panel); border: 1px solid var(--sx-line); border-radius: 6px; font-weight: 700; font-size: 11px; letter-spacing: 0.06em; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; }
.sx-tile:hover { color: var(--sx-ink); }
.sx-tile[aria-pressed="true"] { color: var(--sx-ink); border-color: var(--sx-accent); box-shadow: 0 0 0 1px var(--sx-accent) inset; }
.sx-tile .sx-badge { min-width: 16px; padding: 1px 4px; color: var(--sx-bg); background: var(--sx-mute); border-radius: 8px; font: 700 9px/1.2 var(--mono, ui-monospace, monospace); text-align: center; }
.sx-tile[aria-pressed="true"] .sx-badge { background: var(--sx-accent); }
.sx-tile .sx-badge:empty { display: none; }
.sx-ghost { position: fixed; z-index: 1100; left: 0; top: 0; padding: 3px 8px; color: var(--sx-bg, #0f1216); background: var(--sx-accent, #4fb3ff); border-radius: 5px; font: 700 11px/1.2 var(--ui, system-ui, sans-serif); pointer-events: none; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5); }
.sx-dragging, .sx-dragging * { cursor: grabbing !important; }
.sx-dragging.sx-candrop, .sx-dragging.sx-candrop * { cursor: copy !important; }
.sx-droptgt { outline: 2px solid var(--sx-accent) !important; outline-offset: 2px; border-radius: 6px; }
.sx-macros { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.sx-macro { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 4px; background: var(--sx-panel2); border: 1px solid var(--sx-line); border-radius: 6px; min-width: 0; }
.sx-macro .sx-tile { width: 100%; justify-content: center; min-height: 24px; padding: 2px 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-transform: none; letter-spacing: 0; font-weight: 600; }
.sx-macro input { width: 100%; padding: 2px 4px; color: var(--sx-ink); background: var(--sx-bg); border: 1px solid var(--sx-accent); border-radius: 4px; font: 600 11px var(--ui, system-ui, sans-serif); }
.sx-edbox { position: relative; min-height: 120px; }
.sx-edhead { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; margin-bottom: 4px; }
.sx-edhead .sx-ttl { font-weight: 800; font-size: 11px; letter-spacing: 0.1em; }
.sx-zoom { width: 90px; accent-color: var(--sx-accent); }
.sx-grid { width: 52px; padding: 3px 5px; color: var(--sx-ink); background: var(--sx-panel2); border: 1px solid var(--sx-line); border-radius: 4px; font: 500 11px var(--mono, ui-monospace, monospace); text-align: center; }
.sx-grid.sx-bad { border-color: var(--sx-warn); }
.sx-nf { display: inline-flex; flex-direction: column; align-items: center; gap: 2px; min-width: 44px; }
.sx-nf .sx-nfl { color: var(--sx-mute); font-size: 9px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; white-space: nowrap; }
.sx-nfv { display: block; min-width: 44px; padding: 3px 6px; color: var(--sx-ink); background: var(--sx-panel2); border: 1px solid var(--sx-line); border-radius: 4px; font: 600 11px/1.2 var(--mono, ui-monospace, monospace); text-align: center; cursor: ns-resize; touch-action: none; user-select: none; -webkit-user-select: none; outline: none; }
.sx-nfv:focus-visible { border-color: var(--sx-accent); }
.sx-nf.sx-dis { opacity: 0.4; }
.sx-nf input { width: 64px; padding: 3px 4px; color: var(--sx-ink); background: var(--sx-bg); border: 1px solid var(--sx-accent); border-radius: 4px; font: 600 11px var(--mono, ui-monospace, monospace); text-align: center; }
.sx-amber .wk-num, .sx-amber .sx-nfv, .sx-amber .wk-nbv { color: var(--sx-neg) !important; }
.sx-txt { color: var(--sx-mute); font-size: 11px; }
.sx-pop { position: absolute; z-index: 40; width: min(420px, calc(100% - 16px)); padding: 8px; background: var(--sx-panel); border: 1px solid var(--sx-accent); border-radius: 8px; box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6); }
.sx-ov { position: absolute; inset: 0; z-index: 60; display: flex; flex-direction: column; background: rgba(9, 11, 14, 0.97); border-radius: 10px; overflow: auto; }
.sx-dlg-ov { align-items: center; justify-content: center; padding: 16px; background: rgba(9, 11, 14, 0.8); }
.sx-dlg { width: min(420px, 100%); max-height: 100%; overflow: auto; padding: 14px; background: var(--sx-panel); border: 1px solid var(--sx-line); border-radius: 10px; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6); }
.sx-dlg h3 { margin: 0 0 10px; font-size: 13px; letter-spacing: 0.04em; }
.sx-dlg label { display: grid; gap: 3px; margin-bottom: 10px; color: var(--sx-mute); font-size: 11px; }
.sx-dlg input, .sx-dlg textarea, .sx-gl input[type="text"], .sx-gl textarea { width: 100%; padding: 6px 8px; color: var(--sx-ink); background: var(--sx-bg); border: 1px solid var(--sx-line); border-radius: 5px; font: 500 12px var(--ui, system-ui, sans-serif); }
.sx-dlg textarea, .sx-gl textarea { min-height: 90px; resize: vertical; }
.sx-dlg input:focus, .sx-dlg textarea:focus, .sx-gl input:focus, .sx-gl textarea:focus { outline: none; border-color: var(--sx-accent); }
.sx-dlg p { margin: 0 0 10px; color: var(--sx-mute); line-height: 1.5; }
.sx-dbtns { display: flex; justify-content: flex-end; gap: 6px; }
.sx-btn.sx-pri { color: var(--sx-bg); background: var(--sx-accent); border-color: var(--sx-accent); font-weight: 700; }
.sx-wte { flex: 1 1 auto; min-height: 0; }
.sx-mxhead { display: flex; align-items: center; gap: 8px; }
.sx-mxhead .sx-grow { flex: 1 1 auto; }
.sx-mx { display: grid; gap: 3px; max-height: 560px; overflow: auto; padding-right: 2px; }
.sx-mrow, .sx-mhd { display: grid; align-items: center; gap: 4px; min-width: 0;
  grid-template-columns: 22px minmax(0, 1.1fr) 40px minmax(90px, 1.3fr) minmax(0, 1.5fr) 44px minmax(0, 1.1fr) 62px 30px minmax(70px, 0.9fr) 28px;
  grid-template-areas: 'n src crv amt dst typ aux mode byp out more'; }
.sx-mhd { position: sticky; top: 0; z-index: 1; padding: 2px 0 4px; color: var(--sx-mute); background: var(--sx-panel); font-size: 9px; font-weight: 700; letter-spacing: 0.08em; }
.sx-mrow { padding: 2px 3px; background: var(--sx-panel2); border: 1px solid transparent; border-radius: 5px; }
.sx-mrow.sx-dim > :not(.sx-mn):not(.sx-mmore) { opacity: 0.45; }
.sx-mrow > * { min-width: 0; }
.sx-mrow .wk-menu { width: 100%; }
.sx-mrow .wk-menu > .wk-lab, .sx-mrow .wk-sl > .wk-lab, .sx-mbyp .wk-tl { display: none !important; }
.sx-mrow .wk-sl { flex: 1 1 auto; min-width: 0; }
.sx-mn { grid-area: n; color: var(--sx-mute); font: 600 10px var(--mono, ui-monospace, monospace); text-align: right; }
.sx-msrc { grid-area: src; } .sx-mcrv { grid-area: crv; } .sx-mamt { grid-area: amt; } .sx-mdst { grid-area: dst; } .sx-mtyp { grid-area: typ; }
.sx-maux { grid-area: aux; } .sx-mmode { grid-area: mode; } .sx-mbyp { grid-area: byp; } .sx-mout { grid-area: out; } .sx-mmore { grid-area: more; }
.sx-mamt, .sx-mout { display: flex; align-items: center; gap: 3px; }
.sx-mamt > :first-child, .sx-mout > :first-child { flex: 1 1 auto; min-width: 0; }
.sx-mval { min-width: 38px; padding: 1px 2px; color: var(--sx-ink); font: 600 10px var(--mono, ui-monospace, monospace); text-align: right; cursor: text; border-radius: 3px; }
.sx-mval:focus-visible { outline: 1px solid var(--sx-accent); }
.sx-mval input { width: 52px; padding: 1px 3px; color: var(--sx-ink); background: var(--sx-bg); border: 1px solid var(--sx-accent); border-radius: 3px; font: 600 10px var(--mono, ui-monospace, monospace); }
.sx-crv { display: block; width: 36px; height: 22px; background: var(--sx-bg); border: 1px solid var(--sx-line); border-radius: 4px; cursor: ns-resize; touch-action: none; }
.sx-crv path { fill: none; stroke: var(--sx-graph); stroke-width: 1.6; }
.sx-crv:focus-visible { outline: 2px solid var(--sx-accent); }
.sx-mrow .sx-btn { width: 100%; min-height: 24px; padding: 1px 4px; font: 600 10px var(--mono, ui-monospace, monospace); }
.sx-mrow .sx-btn.sx-on { color: var(--sx-accent); border-color: var(--sx-accent); }
.sx-mslot.sx-droptgt { outline-offset: 0; }
@container sx (max-width: 899px) {
  .sx-mhd { display: none; }
  .sx-mrow { grid-template-columns: 22px minmax(0, 1fr) 40px minmax(0, 1fr) 28px;
    grid-template-areas: 'n src crv dst more' 'byp amt typ aux mode' 'byp out out out out'; padding: 5px; }
  .sx-mn { align-self: start; }
  .sx-root .wk-md, .sx-root .wk-lg { --wk-d: 28px; }
}
.sx-gl { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr)); }
.sx-gl .sx-panel { display: grid; gap: 8px; align-content: start; }
.sx-pref { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; border-bottom: 1px solid rgba(42, 51, 61, 0.5); }
.sx-pref > span { color: var(--sx-mute); font-size: 11px; }
.sx-pref .wk-tog { text-transform: none; letter-spacing: 0; font-weight: 500; font-size: 11px; background: none; border-color: transparent; padding-left: 0; }
.sx-seg { display: inline-flex; border: 1px solid var(--sx-line); border-radius: 5px; overflow: hidden; }
.sx-seg button { min-height: 24px; padding: 2px 8px; color: var(--sx-mute); background: var(--sx-panel2); border: 0; border-right: 1px solid var(--sx-line); font-size: 11px; cursor: pointer; }
.sx-seg button:last-child { border-right: 0; }
.sx-seg button[aria-checked="true"] { color: var(--sx-bg); background: var(--sx-accent); }
.sx-rate { color: var(--sx-mute); font: 500 11px var(--mono, ui-monospace, monospace); }
.sx-notice { position: absolute; left: 50%; bottom: 10px; z-index: 70; max-width: 80%; padding: 6px 12px; color: var(--sx-bg); background: var(--sx-ink); border-radius: 6px; font-weight: 600; transform: translateX(-50%); pointer-events: none; }
.pb-root { display: flex; flex-direction: column; gap: 8px; height: 100%; min-height: 320px; padding: 12px; }
.pb-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.pb-bar .wk-menu { min-width: 150px; }
.pb-q { flex: 1 1 160px; min-width: 0; padding: 5px 8px; color: var(--sx-ink, #dfe6ee); background: var(--sx-bg, #0f1216); border: 1px solid var(--sx-line, #2a333d); border-radius: 5px; font: inherit; }
.pb-q:focus { outline: none; border-color: var(--sx-accent, #4fb3ff); }
.pb-tbl { flex: 1 1 auto; min-height: 0; overflow: auto; border: 1px solid var(--sx-line, #2a333d); border-radius: 6px; }
.pb-hd, .pb-row { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) 30px; align-items: center; gap: 6px; padding: 0 6px; }
.pb-hd { position: sticky; top: 0; z-index: 1; background: var(--sx-panel, #161b21); border-bottom: 1px solid var(--sx-line, #2a333d); }
.pb-hd button { padding: 6px 2px; color: var(--sx-mute, #7f8b98); background: none; border: 0; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-align: left; text-transform: uppercase; cursor: pointer; }
.pb-hd button[aria-sort="ascending"]::after { content: ' ▲'; } .pb-hd button[aria-sort="descending"]::after { content: ' ▼'; }
.pb-hd button[aria-sort]:not([aria-sort="none"]) { color: var(--sx-ink, #dfe6ee); }
.pb-list { outline: none; }
.pb-row { min-height: 28px; border-bottom: 1px solid rgba(42, 51, 61, 0.45); cursor: pointer; }
.pb-row > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pb-row:hover { background: var(--sx-panel2, #1c232b); }
.pb-row[aria-selected="true"] { background: rgba(79, 179, 255, 0.18); box-shadow: inset 2px 0 0 var(--sx-accent, #4fb3ff); }
.pb-row .pb-u { margin-left: 6px; padding: 0 4px; color: var(--sx-bg, #0f1216); background: var(--sx-on, #6fe3a1); border-radius: 3px; font-size: 9px; font-weight: 800; }
.pb-row .pb-more { padding: 2px; color: var(--sx-mute, #7f8b98); background: none; border: 0; cursor: pointer; }
.pb-empty { padding: 20px; color: var(--sx-mute, #7f8b98); text-align: center; }
@media (pointer: coarse) {
  .sx-tab, .sx-hbtn, .sx-btn, .sx-tile, .sx-nfv { min-height: 32px; }
  .pb-row { min-height: 36px; }
}
@media (prefers-reduced-motion: reduce) { .sx-root *, .pb-root * { transition: none !important; } }
`;

function injectSxStyles(doc) {
  if (!doc || doc.getElementById('sx-css')) return;
  const s = doc.createElement('style');
  s.id = 'sx-css';
  s.textContent = CSS;
  (doc.head || doc.documentElement).appendChild(s);
}

/* ================================================================ DOM helpers */

const SVGNS = 'http://www.w3.org/2000/svg';
function mk(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}
function svgEl(doc, tag, a) {
  const e = doc.createElementNS(SVGNS, tag);
  for (const k in a) e.setAttribute(k, a[k]);
  return e;
}
const ICONS = {
  save: ['M3 2.5h8.5L14 5v8.5H3z', 'M5.5 2.5v3.5h5v-3.5', 'M5.5 13.5v-4h6v4'],
  edit: ['M10.5 2.5l3 3-8 8H2.5v-3z', 'M9 4l3 3'],
  zoom: ['M7 2.5a4.5 4.5 0 1 1 0 9a4.5 4.5 0 1 1 0-9', 'M10.5 10.5L14 14'],
  lock: ['M4 7.5h8v6H4z', 'M5.5 7.5V5a2.5 2.5 0 0 1 5 0v2.5'],
  folder: ['M2 4h4.5l1.5 1.5H14V13H2z'],
  more: ['M3.5 8h.01', 'M8 8h.01', 'M12.5 8h.01'],
  info: ['M8 2a6 6 0 1 1 0 12a6 6 0 1 1 0-12', 'M8 7v4.5', 'M8 4.8v.01'],
  menu: ['M2.5 4.5h11', 'M2.5 8h11', 'M2.5 11.5h11'],
  trash: ['M2.5 4.5h11', 'M6 4.5V2.5h4v2', 'M4 4.5l.8 9h6.4l.8-9', 'M6.8 7v4', 'M9.2 7v4'],
};
function icon(doc, name) {
  const s = svgEl(doc, 'svg', { viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' });
  for (const d of ICONS[name] || []) s.appendChild(svgEl(doc, 'path', { d }));
  return s;
}
function logo(doc) {   // original mark: a wavetable "stack" of three offset waves
  const s = svgEl(doc, 'svg', { class: 'sx-logo', viewBox: '0 0 32 32', 'aria-hidden': 'true', focusable: 'false' });
  const g = svgEl(doc, 'g', { fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round' });
  g.appendChild(svgEl(doc, 'path', { d: 'M4 22c3-9 5-9 8 0s5 9 8 0 5-9 8 0', opacity: '0.35' }));
  g.appendChild(svgEl(doc, 'path', { d: 'M4 17c3-9 5-9 8 0s5 9 8 0 5-9 8 0', opacity: '0.65' }));
  g.appendChild(svgEl(doc, 'path', { d: 'M4 12c3-9 5-9 8 0s5 9 8 0 5-9 8 0' }));
  s.appendChild(g);
  return s;
}
function btn(doc, cls, label, title, onClick) {
  const b = mk(doc, 'button', cls);
  b.type = 'button';
  if (typeof label === 'string') b.textContent = label; else if (label) b.appendChild(label);
  if (title) { b.setAttribute('aria-label', title); b.title = title; }
  if (onClick) b.addEventListener('click', onClick);
  return b;
}
function on(t, type, fn, opt) { t.addEventListener(type, fn, opt); return () => t.removeEventListener(type, fn, opt); }
function closest(el, sel) { return el && el.closest ? el.closest(sel) : null; }
function rafOf(doc) {
  const w = doc && doc.defaultView;
  const r = (w && w.requestAnimationFrame) || globalThis.requestAnimationFrame;
  return r ? f => r.call(w || globalThis, f) : f => setTimeout(f, 16);
}
// Touch long-press (500 ms, ≤ 8 px) on a plain element → fn(x, y); skipped when the browser already fired its
// own contextmenu for that press (Android).
function longPress(el, fn) {
  let t = 0, x = 0, y = 0, t0 = 0, ctxT = -1;
  el.addEventListener('contextmenu', e => { ctxT = e.timeStamp; });
  el.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    x = e.clientX; y = e.clientY; t0 = e.timeStamp;
    clearTimeout(t);
    t = setTimeout(() => { t = 0; if (ctxT < t0) fn(x, y); }, 500);
  });
  el.addEventListener('pointermove', e => { if (t && Math.hypot(e.clientX - x, e.clientY - y) > 8) { clearTimeout(t); t = 0; } });
  for (const k of ['pointerup', 'pointercancel']) el.addEventListener(k, () => { clearTimeout(t); t = 0; });
}
function download(doc, name, text) {
  try {
    const U = globalThis.URL, B = globalThis.Blob;
    const url = U.createObjectURL(new B([text], { type: 'application/json' }));
    const a = mk(doc, 'a');
    a.href = url; a.download = name;
    doc.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => U.revokeObjectURL(url), 4000);
  } catch (err) { console.warn('serum-ui: download failed', err); }
}
// one hidden <input type=file>; resolves the chosen file, or null when the dialog is cancelled ('cancel' event),
// and removes the input either way
function pickFile(doc, accept) {
  return new Promise(res => {
    const i = mk(doc, 'input');
    i.type = 'file'; i.accept = accept || '';
    i.style.display = 'none';
    const done = f => { i.remove(); res(f || null); };
    i.addEventListener('change', () => done(i.files && i.files[0]));
    i.addEventListener('cancel', () => done(null));
    doc.body.appendChild(i);
    i.click();
  });
}
const fileText = f => (f && f.text ? f.text() : Promise.resolve(''));
// window.confirm must be called as a method (a detached call throws "Illegal invocation" in browsers)
function askConfirm(doc, msg) {
  const w = (doc && doc.defaultView) || globalThis;
  try { return typeof w.confirm === 'function' ? !!w.confirm(msg) : true; } catch (err) { return true; }
}

/* ---------------------------------------------------------------- numField */
// Numeric box in engine units: { label, get: () => v, set: (v, phase), min, max, step, def?, fmt?, parse?,
// disabled?, px? (drag px for the full range, default 200), dest?, cls? }. Vertical drag (Shift fine), wheel
// (1 step, honours the wheel preference), arrows ±1 step (Shift ×10), PageUp/Down ±10 steps, Home/End,
// Delete = def, Enter / double-click = typed entry. With `dest` it carries data-dest, el.wk and an underline
// halo (setMod), like wk.numBox.
function numField(doc, o) {
  const el = mk(doc, 'div', 'sx-nf' + (o.cls ? ' ' + o.cls : ''));
  el.style.position = 'relative';
  const lab = o.label ? mk(doc, 'span', 'sx-nfl', o.label) : null;
  const val = mk(doc, 'span', 'sx-nfv');
  val.tabIndex = 0;
  val.setAttribute('role', 'spinbutton');
  val.setAttribute('aria-label', o.label || o.aria || 'value');
  val.setAttribute('aria-valuemin', String(o.min));
  val.setAttribute('aria-valuemax', String(o.max));
  if (lab) el.appendChild(lab);
  el.appendChild(val);
  const bar = mk(doc, 'span', 'wk-modbar'), segs = [];
  bar.setAttribute('aria-hidden', 'true');
  el.appendChild(bar);
  const dec = Math.max(0, Math.ceil(-Math.log10(o.step) - 1e-9));
  const q = v => +clamp(o.min + Math.round((v - o.min) / o.step) * o.step, o.min, o.max).toFixed(dec);
  const fmt = o.fmt || (v => v.toFixed(dec));
  let g = null, inp = null, dis = false, hoverT = -1e9, wacc = 0, wT = 0;
  const W = { el, update, setMod, focus: () => val.focus(), edit, destroy: () => el.remove() };
  if (o.dest) { el.wk = W; el.setAttribute('data-dest', fnOf(o.dest)()); }

  function update() {
    const v = o.get(), t = fmt(v);
    if (val.textContent !== t) val.textContent = t;
    val.setAttribute('aria-valuenow', String(v));
    val.setAttribute('aria-valuetext', t);
    dis = !!(o.disabled && o.disabled());
    el.classList.toggle('sx-dis', dis);
    if (o.dest) el.setAttribute('data-dest', fnOf(o.dest)());
  }
  function setMod(m) {
    const list = (m && m.arcs) || [];
    for (let i = 0; i < Math.max(list.length, segs.length); i++) {
      if (i >= list.length) { segs[i].style.display = 'none'; continue; }
      if (!segs[i]) { segs[i] = mk(doc, 'i'); bar.appendChild(segs[i]); }
      const a = list[i], lo = clamp01(Math.min(a.from, a.to)), hi = clamp01(Math.max(a.from, a.to));
      segs[i].className = 'wk-mseg k-' + (a.kind === 'sel' || a.kind === 'neg' ? a.kind : 'other');
      segs[i].style.display = '';
      segs[i].style.left = (lo * 100).toFixed(2) + '%';
      segs[i].style.width = (Math.max(hi - lo, 0.01) * 100).toFixed(2) + '%';
    }
    el.classList.toggle('wk-modded', list.length > 0);
  }
  function put(v, ph) { v = q(v); if (ph === 'set' && v === o.get()) return; o.set(v, ph); update(); }
  val.addEventListener('pointerdown', e => {
    if (dis || e.button !== 0 || inp || g) return;
    e.preventDefault();
    val.focus();
    g = { id: e.pointerId, x: e.clientX, y: e.clientY, v0: o.get(), acc: 0, last: o.get() };
    try { val.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
    o.set(g.v0, 'start');
  });
  val.addEventListener('pointermove', e => {
    if (!g || e.pointerId !== g.id) return;
    const d = (g.y - e.clientY) + (e.clientX - g.x);
    g.x = e.clientX; g.y = e.clientY;
    g.acc += d * (e.shiftKey ? 0.1 : 1);
    const v = q(g.v0 + g.acc * (o.max - o.min) / (o.px || 200));
    if (v !== g.last) { g.last = v; o.set(v, 'move'); update(); }
  });
  const end = e => {
    if (!g || (e && e.pointerId !== g.id)) return;
    const G = g;
    g = null;
    try { val.releasePointerCapture(G.id); } catch (err) { /* released */ }
    o.set(G.last, 'end');
    update();
  };
  val.addEventListener('pointerup', end);
  val.addEventListener('pointercancel', end);
  val.addEventListener('dblclick', e => {
    e.preventDefault();
    if (dis) return;
    const p = wk.getPrefs ? wk.getPrefs() : { dblClick: 'type' };
    if (p.dblClick === 'reset' && o.def !== undefined) put(o.def, 'set'); else edit();
  });
  val.addEventListener('pointerenter', e => { hoverT = e.timeStamp; });
  val.addEventListener('wheel', e => {
    const p = wk.getPrefs ? wk.getPrefs() : { wheel: 1 };
    if (!p.wheel || dis || inp) return;
    if (doc.activeElement !== val && e.timeStamp - hoverT < 300) return;
    const d = e.deltaY;
    if (!d) return;
    e.preventDefault();
    if (e.deltaMode > 0 || Math.abs(d) >= 50) { put(o.get() - Math.sign(d) * o.step, 'set'); return; }
    if (e.timeStamp - wT > 200) wacc = 0;
    wT = e.timeStamp; wacc += d;
    const k = Math.trunc(wacc / 40);
    if (k) { wacc -= k * 40; put(o.get() - k * o.step, 'set'); }
  }, { passive: false });
  val.addEventListener('keydown', e => {
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const r = val.getBoundingClientRect();
      const E = globalThis.MouseEvent || globalThis.Event;
      el.dispatchEvent(new E('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
      return;
    }
    if (dis) return;
    const k = e.key, st = o.step * (e.shiftKey ? 10 : 1), v = o.get();
    let n = null;
    if (k === 'ArrowUp' || k === 'ArrowRight') n = v + st;
    else if (k === 'ArrowDown' || k === 'ArrowLeft') n = v - st;
    else if (k === 'PageUp') n = v + 10 * o.step;
    else if (k === 'PageDown') n = v - 10 * o.step;
    else if (k === 'Home') n = o.min;
    else if (k === 'End') n = o.max;
    else if ((k === 'Delete' || k === 'Backspace') && o.def !== undefined) n = o.def;
    else if (k === 'Enter') { e.preventDefault(); edit(); return; }
    if (n === null) return;
    e.preventDefault();
    put(n, 'set');
  });
  function edit() {
    if (inp || dis) return;
    inp = mk(doc, 'input');
    inp.type = 'text';
    inp.value = val.textContent;
    inp.setAttribute('aria-label', (o.label || 'value') + ' value');
    val.style.display = 'none';
    el.insertBefore(inp, bar);
    let done = false;
    const fin_ = ok => {
      if (done) return;
      done = true;
      const t = inp.value;
      inp.remove(); inp = null;
      val.style.display = '';
      if (ok) {
        const v = o.parse ? o.parse(t) : parseFloat(String(t).replace(',', '.'));
        if (v !== null && fin(v)) put(v, 'set');
      }
      val.focus();
    };
    inp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); fin_(true); } else if (e.key === 'Escape') { e.preventDefault(); fin_(false); }
    });
    inp.addEventListener('blur', () => fin_(true));
    inp.focus();
    if (inp.select) inp.select();
  }
  update();
  return W;
}

/* ---------------------------------------------------------------- segField */
// Radio group for structured enums: { label, items: [labels], get: () => idx, set: idx, disabled? }
function segField(doc, o) {
  const el = mk(doc, 'div', 'sx-seg');
  el.setAttribute('role', 'radiogroup');
  if (o.label) el.setAttribute('aria-label', o.label);
  const bs = o.items.map((t, i) => {
    const b = btn(doc, '', t, null, () => { if (o.get() !== i) o.set(i); update(); });
    b.setAttribute('role', 'radio');
    b.addEventListener('keydown', e => {
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const j = (o.get() + d + o.items.length) % o.items.length;
      o.set(j); update(); bs[j].focus();
    });
    el.appendChild(b);
    return b;
  });
  function update() {
    const v = o.get(), dis = !!(o.disabled && o.disabled());
    bs.forEach((b, i) => { b.setAttribute('aria-checked', i === v ? 'true' : 'false'); b.tabIndex = i === v ? 0 : -1; b.disabled = dis; });
  }
  update();
  return { el, update, destroy: () => el.remove() };
}

/* ---------------------------------------------------------------- hSlider (fallback for wk.slider) */
function hSlider(doc, o) {
  const el = mk(doc, 'div', 'sx-hs');
  el.tabIndex = 0;
  el.setAttribute('role', 'slider');
  el.style.cssText = 'position:relative;height:18px;min-width:40px;background:var(--sx-bg);border:1px solid var(--sx-line);border-radius:4px;touch-action:none;cursor:ew-resize';
  const fill = mk(doc, 'span');
  fill.style.cssText = 'position:absolute;top:2px;bottom:2px;background:var(--sx-graph);border-radius:2px;opacity:0.85';
  el.appendChild(fill);
  if (o.dest) el.setAttribute('data-dest', fnOf(o.dest)());
  let g = null;
  const W = { el, update, setMod() {}, focus: () => el.focus(), destroy: () => el.remove() };
  if (o.dest) el.wk = W;
  function update() {
    const n = clamp01(o.get()), b = o.bipolar ? 0.5 : 0;
    fill.style.left = (Math.min(b, n) * 100).toFixed(2) + '%';
    fill.style.width = (Math.abs(n - b) * 100).toFixed(2) + '%';
    el.setAttribute('aria-valuenow', String(Math.round(n * 1000) / 10));
    el.setAttribute('aria-valuetext', o.fmt ? o.fmt(n) : String(n));
  }
  const at = e => { const r = el.getBoundingClientRect(); return clamp01((e.clientX - r.left) / Math.max(1, r.width)); };
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); el.focus();
    if ((e.metaKey || e.ctrlKey) && o.def !== undefined) { o.set(o.def, 'set'); update(); return; }
    g = { id: e.pointerId, n: at(e) };
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
    o.set(o.get(), 'start'); o.set(g.n, 'move'); update();
  });
  el.addEventListener('pointermove', e => { if (g && e.pointerId === g.id) { g.n = at(e); o.set(g.n, 'move'); update(); } });
  const end = () => { if (!g) return; const n = g.n; g = null; o.set(n, 'end'); update(); };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('keydown', e => {
    const k = e.key, s = e.shiftKey ? 0.001 : 0.01, n = o.get();
    let v = null;
    if (k === 'ArrowRight' || k === 'ArrowUp') v = n + s; else if (k === 'ArrowLeft' || k === 'ArrowDown') v = n - s;
    else if (k === 'Home') v = 0; else if (k === 'End') v = 1; else if ((k === 'Delete' || k === 'Backspace') && o.def !== undefined) v = o.def;
    if (v === null) return;
    e.preventDefault(); o.set(clamp01(v), 'set'); update();
  });
  update();
  return W;
}

/* ================================================================ SerumUI */

let CLIP = null;          // module clipboard, shared by every panel (copy on one track, paste on another)
let UID = 0;
const qsa = (root, sel) => Array.prototype.slice.call(root.querySelectorAll(sel));
const toggleIn = (list, v, want) => {
  const i = list.indexOf(v), has = i >= 0, w = want === undefined ? !has : !!want;
  if (w && !has) list.push(v); else if (!w && has) list.splice(i, 1);
};
const focusable = el => (el && (el.matches && el.matches('button, [tabindex]') ? el
  : el.querySelector && el.querySelector('button, [tabindex]'))) || el;

export class SerumUI {
  constructor(root, host) {
    this.root = root;
    this.host = host || {};
    this.d = (root && root.ownerDocument) || globalThis.document;
    this.uid = 'sx' + (++UID);
    this.raf = rafOf(this.d);
    this.dead = false;
    this.pages = {};
    this.head = null;
    this.headPage = { binds: [], canvases: [], editors: [] };
    this.bp = null;                   // page being built (widget factories register into it)
    this.page = '';
    this.snap = null;
    this.smon = null;
    this.dirty = false;
    this.nameOverride = null;
    this.recentSlot = new Map();
    this.tables = new Map();          // table id → { state: 'loading' | 'ok' | 'missing', info }
    this.noiseOv = new Map();         // noise id → { min, max } overview (Float32Array) | null
    this.offs = [];
    this.queued = false;
    this.ticking = false;
    this.modEls = [];
    this.edSel = 'lfo1';
    this.edDirty = true;
    this.phaseDrag = [false, false];
    this.drag = null;
    this.overlay = null;
    this.rack = null;
    this.capPrev = null;
    this.capArm = [false, false];     // a.rand / b.rand edited here since the last capture check (§6.4)
    this.eatClick = null;             // { el, t }: the click that ends a Shift+Alt / Alt-drag gesture on el
    this.lfoGest = null;              // buses the LFO points linked when the current graph drag started
    this.editorOsc = null;            // oscillator whose WT editor is open (0 | 1 | null), for the host (§9.9)
    this.fc = null;
    this.edSig = new WeakMap();       // graph editor → () => signature of what it draws
    this.edKey = new WeakMap();
    this.snapT = -1e9;
    this.prefs = normPrefs(this.store('get', PREFS_KEY, null));
    if (wk.setPrefs) wk.setPrefs({ tooltips: this.prefs.tooltips, dblClick: this.prefs.dblClick, wheel: this.prefs.wheel });
    if (wk.injectStyles) wk.injectStyles(this.d);
    injectSxStyles(this.d);
    const s = this.s();
    if (s && s.ui && /^(lfo[1-8]|velo|note)$/.test(s.ui.mod)) this.edSel = s.ui.mod;
    this.el = mk(this.d, 'div', 'sx-root');
    this.el.id = this.uid;
    root.appendChild(this.el);
    const RO = this.d.defaultView && this.d.defaultView.ResizeObserver || globalThis.ResizeObserver;
    this.ro = RO ? new RO(() => { for (const P of this.allPages()) for (const cv of P.canvases) cv.sized = false; this.queue(); }) : null;
    this.buildHead();
    this.pageBox = mk(this.d, 'div', 'sx-pages');
    this.el.appendChild(this.pageBox);
    this.installModLayer();
    this.browser = new PresetBrowser(this.el, this.host, {
      notify: t => this.notify(t),
      confirmLoad: () => this.confirmChange(),
      modified: () => this.dirty || !!this.nameOverride,
      onLoad: () => { this.dirty = false; this.nameOverride = null; this.edDirty = true; this.refresh(); },
    });
    // "Default WT view" (§9.7) for new tracks: the host creates them with withPrefs (os / author only), so a
    // sound that is still the untouched default opens in 3D when the preference says so (a view-only edit)
    if (this.prefs.view3d && s && s.ui && arr(s.ui.view3d).every(v => !v) && isPristine(s)) this.uiEdit(st => { st.ui.view3d = [1, 1]; });
    this.showPage(s && s.ui && PAGES.includes(s.ui.page) ? s.ui.page : 'osc');
    if (this.host.monitor) this.host.monitor(true);
    if (this.d.addEventListener) {
      this.offs.push(on(this.d, 'visibilitychange', () => { if (this.host.monitor && !this.dead) this.host.monitor(!this.d.hidden); }));
    }
    if (!globalThis.SerumDSP && wk.loadDSP) wk.loadDSP().then(() => { if (!this.dead) { this.fc = null; this.queue(); } });
  }

  /* ---------------------------------------------------------------- state access */
  s() { return this.host.state ? this.host.state() : null; }
  fx() { return this.host.fx ? this.host.fx() : null; }
  bpm() { const b = this.host.bpm ? +this.host.bpm() : 120; return b > 0 ? b : 120; }
  dsp() { return globalThis.SerumDSP || null; }
  store(op, k, v) {
    const st = this.host.storage;
    try {
      if (op === 'get') return st && st.get ? st.get(k, v) : v;
      if (st && st.set) st.set(k, v);
    } catch (err) { console.warn('serum-ui: storage', err); }
    return v;
  }
  getN(id) { return baseN(this.s(), this.fx(), id); }
  setN(id, n, ph) {
    const d = destOf(id);
    if (!d) return;
    const v = snapN(id, n), phase = ph || 'set', label = d.label;
    if (id === 'a.warpMode' || id === 'b.warpMode') {
      const o = id === 'b.warpMode' ? 1 : 0;
      this.edit(s => { if (core.warpChoice) core.warpChoice(s, o, Math.round(v * 22)); else s.p[id] = v; }, { label, phase });
    } else if (isFxIdx(DEST_INDEX[id])) this.editFx(fx => { fx.p[id] = v; }, { label, phase });
    else this.edit(s => { s.p[id] = v; }, { label, phase });
    if (id === 'a.phase' || id === 'b.phase') this.phaseDrag[id === 'b.phase' ? 1 : 0] = phase === 'start' || phase === 'move';
    if (id === 'a.rand' || id === 'b.rand') this.capArm[id === 'b.rand' ? 1 : 0] = true;   // phase capture (§6.4)
  }
  edit(fn, opts) {
    const o = Object.assign({ label: 'Edit' }, opts);
    if (this.host.edit) this.host.edit(fn, o);
    if (!o.ui) this.dirty = true;
    this.rackDirty = true;
    this.fc = null;
    this.queue();
  }
  editFx(fn, opts, fromRack) {
    const o = Object.assign({ label: 'Edit FX' }, opts);
    if (this.host.editFx) this.host.editFx(fn, o); else { this.notify('FX editing is not available'); return; }
    if (!o.ui) this.dirty = true;
    if (!fromRack) this.rackDirty = true;
    this.fc = null;
    this.queue();
  }
  uiEdit(fn) { this.edit(fn, { label: 'View', ui: true }); }
  notify(text) {
    if (this.host.notify) { this.host.notify(text); return; }
    if (!this.el) return;
    if (!this.noticeEl) { this.noticeEl = mk(this.d, 'div', 'sx-notice'); this.noticeEl.setAttribute('role', 'status'); }
    this.noticeEl.textContent = text;
    this.el.appendChild(this.noticeEl);
    clearTimeout(this.noticeT);
    this.noticeT = setTimeout(() => { if (this.noticeEl) this.noticeEl.remove(); }, 2200);
  }
  need(name) {
    if (typeof core[name] === 'function') return core[name];
    this.notify('Not available yet: ' + name);
    return null;
  }
  fmt(id, n) { return core.fmtParam(id, n, this.fctx()); }
  fctx() {
    if (this.fc) return this.fc;
    const s = this.s(), i0 = this.tinfo(0), i1 = this.tinfo(1);
    this.fc = { s, fx: this.fx(), bpm: this.bpm(), frames: [i0.F, i1.F], interp: [i0.interp, i1.interp], eff: this.snap ? this.snap.eff : undefined };
    return this.fc;
  }
  parse(id, text) {
    if (typeof core.parseParam === 'function') return core.parseParam(id, text, this.fctx());
    const t = String(text).trim().replace(',', '.'), m = /^([+-]?\d*\.?\d+)\s*(%?)/.exec(t);
    if (/^on$/i.test(t)) return 1;
    if (/^off$/i.test(t)) return 0;
    if (!m) return null;
    return m[2] ? clamp01(+m[1] / 100) : core.lawNorm(id, +m[1]);
  }

  /* ---------------------------------------------------------------- widget factories */
  bind(w) { (this.bp || this.headPage).binds.push(w); return w; }
  decorate(w, idf, focusEl) {
    const el = focusEl || w.el;
    if (wk.tooltip && el) wk.tooltip(el, () => this.tipText(idf()));
    return w;
  }
  dKnob(id, label, opt) {
    const O = opt || {}, idf = fnOf(id), d0 = destOf(idf());
    const o = {
      dest: idf, label,
      get: () => this.getN(idf()),
      set: (n, ph) => this.setN(idf(), n, ph),
      def: () => destOf(idf()).def,
      fmt: n => this.fmt(idf(), n),
      parse: t => this.parse(idf(), t),
      steps: stepsOf(d0), size: O.size || 'md', bipolar: d0.ctr === 1,
      disabled: O.disabled, detents: O.detents,
    };
    if (O.labelFn) Object.defineProperty(o, 'label', { get: O.labelFn, enumerable: true });
    if (!O.bipolarFn) return this.bind(this.decorate(wk.knob(o), idf));
    // dynamic bipolar arc (WARP, §9.3): wk.knob redraws its value arc only when the value changes, so a flip of
    // the flag at an unchanged value redraws through a one-off nudged value, then the true one
    let bip = !!O.bipolarFn(), nudge = false;
    const get0 = o.get;
    o.get = () => { const n = get0(); return nudge ? (n > 0.5 ? n - 1e-6 : n + 1e-6) : n; };
    Object.defineProperty(o, 'bipolar', { get: () => bip, enumerable: true });
    const w = this.bind(this.decorate(wk.knob(o), idf));
    this.custom(() => {
      const b = !!O.bipolarFn();
      if (b === bip) return;
      bip = b;
      nudge = true; w.update();
      nudge = false; w.update();
    });
    return w;
  }
  dToggle(id, label, kind, opt) {
    const O = opt || {}, idf = fnOf(id);
    const w = wk.toggle({ dest: idf, label, kind: kind || 'led', get: () => (this.getN(idf()) >= 0.5 ? 1 : 0),
      set: v => this.setN(idf(), v ? 1 : 0, 'set'), disabled: O.disabled });
    if (O.module) w.el.setAttribute('data-module', O.module);
    return this.bind(this.decorate(w, idf));
  }
  dMenu(id, label, items, opt) {
    const O = opt || {}, idf = fnOf(id);
    const w = wk.menu({ dest: idf, label, items, get: () => this.getN(idf()), set: v => this.setN(idf(), v, 'set'),
      arrows: O.arrows !== false, wheel: true });
    return this.bind(this.decorate(w, idf, w.el.querySelector ? w.el.querySelector('.wk-mbtn') : null));
  }
  dNum(id, label, opt) {
    const O = opt || {}, idf = fnOf(id), d = destOf(idf());
    let w;
    if (typeof wk.numBox === 'function') {
      w = wk.numBox({ dest: idf, label, get: () => this.getN(idf()), set: (n, ph) => this.setN(idf(), n, ph), def: d.def,
        fmt: n => this.fmt(idf(), n), parse: t => this.parse(idf(), t), steps: stepsOf(d), disabled: O.disabled });
    } else {
      w = numField(this.d, { dest: idf, label, min: d.lo, max: d.hi, step: 1, def: core.lawValue(d.id, d.def), disabled: O.disabled,
        get: () => core.lawValue(idf(), this.getN(idf())), set: (v, ph) => this.setN(idf(), core.lawNorm(idf(), v), ph),
        fmt: v => this.fmt(idf(), core.lawNorm(idf(), v)), parse: t => { const n = this.parse(idf(), t); return n === null ? null : core.lawValue(idf(), n); } });
    }
    if (O.cls) w.el.classList.add(O.cls);
    return this.bind(this.decorate(w, idf, w.el.querySelector ? w.el.querySelector('.sx-nfv, [tabindex]') : null));
  }
  pKnob(o) { return this.bind(wk.knob(Object.assign({ size: 'md' }, o))); }
  pToggle(o) { return this.bind(wk.toggle(Object.assign({ kind: 'led' }, o))); }
  pNum(o) { return this.bind(numField(this.d, o)); }
  pSeg(o) { return this.bind(segField(this.d, o)); }
  slider(o) {
    const w = typeof wk.slider === 'function' ? wk.slider(o) : hSlider(this.d, o);
    return this.bind(w);
  }
  custom(update) { return this.bind({ update }); }
  enumItems(id, labels, groups) {
    const d = destOf(id), hi = gridOf(d);
    return labels.map((label, k) => ({ v: k / hi, label, group: groups ? groups[k] : undefined }));
  }

  /* ---------------------------------------------------------------- tooltips */
  tipText(id) {
    const s = this.s();
    if (!s || !destOf(id)) return '';
    const lines = [core.destLabel(id, s, this.fx()) + ': ' + this.fmt(id, this.getN(id))];
    return lines.concat(modTipLines(s, id)).join('\n');
  }
  tileTip(src) {
    const s = this.s(), ds = tileDests(s, src);
    return srcLabel(s, src) + (ds.length ? '\n' + ds.map(id => '→ ' + core.destLabel(id, s, this.fx())).join('\n')
      : '\nDrag onto a control to modulate it');
  }

  /* ---------------------------------------------------------------- refresh / snapshot */
  queue() {
    if (this.queued || this.dead) return;
    this.queued = true;
    this.raf(() => { this.queued = false; if (!this.dead) this.paint(true); });
  }
  refresh() {
    if (this.dead) return;
    this.fc = null;
    this.edDirty = true;
    this.paint(true);
    if (this.page === 'fx' && this.rack && this.rack.refresh) this.rack.refresh();
  }
  allPages() { return [this.headPage].concat(PAGES.map(p => this.pages[p]).filter(Boolean)); }
  paint(full) {
    const s = this.s();
    if (!s || this.dead) return;
    this.fc = null;
    this.paintSeq = (this.paintSeq || 0) + 1;
    const P = this.pages[this.page];
    for (const w of this.headPage.binds) w.update();
    if (P) for (const w of P.binds) w.update();
    if (full || this.edDirty) {   // graph editors redraw when their inputs changed (signature) or on demand
      const force = this.edDirty;
      this.edDirty = false;
      const eds = P ? P.editors.slice() : [];
      if (this.pop && this.pop.ed) eds.push(this.pop.ed);
      for (const ed of eds) {
        if (!ed || !ed.refresh) continue;
        const f = this.edSig.get(ed), k = f ? f() : null;
        if (force || k === null || k !== this.edKey.get(ed)) { this.edKey.set(ed, k); ed.refresh(); }
      }
    }
    if (full && this.rackDirty && this.page === 'fx' && this.rack && this.rack.refresh) { this.rackDirty = false; this.rack.refresh(); }
    if (full) this.scanMods();
    this.paintMods(full);
    this.paintCanvases();
    this.updateVoices();
    this.checkCapture();
  }
  setSnapshot(msg) {
    this.smon = msg || null;
    this.snap = msg && msg.s ? msg.s : null;
    this.snapSeq = (this.snapSeq || 0) + 1;
    if (this.ticking || this.dead) return;
    const now = Date.now();
    if (wk.reducedMotion && wk.reducedMotion() && now - this.snapT < 100) return;   // §9.1: 10 fps under reduced motion
    this.snapT = now;
    this.ticking = true;
    this.raf(() => {
      this.ticking = false;
      if (this.dead || !this.s()) return;
      this.paintMods(false);
      this.paintCanvases();
      this.updateVoices();
      this.checkCapture();
    });
  }
  scanMods() {
    const roots = [this.head], P = this.pages[this.page];
    if (P) roots.push(P.el);
    const s = this.s(), locked = new Set(s && s.locks ? arr(s.locks.p) : []);
    this.modEls = [];
    for (const r of roots) {
      for (const el of qsa(r, '[data-dest]')) {
        if (!el.wk || typeof el.wk.setMod !== 'function') continue;
        const id = el.getAttribute('data-dest');
        if (DEST_INDEX[id] === undefined) continue;
        el.classList.toggle('sx-locked-ctl', locked.has(id));
        this.modEls.push({ el, id, i: DEST_INDEX[id], arcs: null, had: true });
      }
    }
  }
  paintMods(full) {
    const s = this.s(), fx = this.fx(), sel = s.ui ? s.ui.mod : '', eff = this.snap && this.snap.eff;
    for (const m of this.modEls) {
      if (full || !m.arcs) m.arcs = haloArcs(s, fx, m.id, sel);
      if (!m.arcs.length) { if (m.had) { m.el.wk.setMod(null); m.had = false; } continue; }
      m.el.wk.setMod({ arcs: m.arcs, live: eff && fin(eff[m.i]) ? eff[m.i] : null });
      m.had = true;
    }
  }
  updateVoices() {
    if (!this.vcEl) return;
    const s = this.s(), sn = this.snap;
    const on = id => (s.p[id] >= 0.5 ? 1 : 0), poly = s.voicing && s.voicing.mono ? 1 : (s.voicing ? s.voicing.poly : 8);
    const x = sn ? sn.oscVoices | 0 : 0, y = sn ? sn.maxVoices | 0 : poly * (16 * on('a.on') + 16 * on('b.on') + on('s.on') + on('n.on'));
    const t = x + ' / ' + y;
    if (this.vcText !== t) {
      this.vcText = t;
      this.vcEl.textContent = '';
      this.vcEl.append(mk(this.d, 'b', '', String(x)), ' / ' + y);
      this.vcEl.setAttribute('aria-label', 'Voices ' + x + ' of ' + y);
    }
    const hot = !!(sn && sn.oscVoices > 128);
    for (const el of this.uniEls || []) el.classList.toggle('sx-amber', hot);
  }
  // phase capture (§6.4): base RAND of an oscillator in Mem crossing 0.9995 upwards while notes sound. Only the
  // user's own RAND edits on this panel count (capArm, set by setN): a state replaced by a preset load, a program
  // change or the host's undo can cross the threshold too, and must keep the memSet it brings.
  checkCapture() {
    const s = this.s(), p = s.p, cur = { 'a.phase': p['a.phase'], 'a.rand': p['a.rand'], 'b.phase': p['b.phase'], 'b.rand': p['b.rand'] };
    const arm = this.capArm, due = captureDue(this.capPrev, cur, this.snap ? this.snap.notes : 0).filter(o => arm[o]);
    this.capPrev = cur;
    arm[0] = arm[1] = false;
    const mem = this.snap && this.snap.memNow;
    if (!due.length || !mem || mem.length < 32) return;
    this.edit(st => {
      for (const o of due) st.osc[o].memSet = Array.from({ length: 16 }, (_, i) => Math.round(frac(mem[o * 16 + i]) * 1e6) / 1e6 % 1);
    }, { label: 'Capture phases' });
    this.notify('Captured unison phases');
  }

  /* ---------------------------------------------------------------- canvases */
  canvas(cls, key, draw, extra) {
    const c = mk(this.d, 'canvas', 'sx-disp' + (cls ? ' ' + cls : ''));
    const cv = Object.assign({ el: c, key, draw, last: null, sized: false, w: 0, h: 0, dpr: 1 }, extra);
    (this.bp || this.headPage).canvases.push(cv);
    if (this.ro) this.ro.observe(c);
    return cv;
  }
  paintCanvases() {
    const P = this.pages[this.page];
    if (!P) return;
    for (const cv of P.canvases) this.paintCanvas(cv);
  }
  paintCanvas(cv) {
    if (!cv.sized) {
      const r = cv.el.getBoundingClientRect(), dpr = (this.d.defaultView && this.d.defaultView.devicePixelRatio) || 1;
      const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (cv.el.width !== w || cv.el.height !== h) { cv.el.width = w; cv.el.height = h; }
      cv.w = w; cv.h = h; cv.dpr = dpr; cv.sized = r.width > 0; cv.last = null;
    }
    let k;
    try { k = cv.key(); } catch (err) { k = Math.random(); }
    if (k === cv.last) return;
    cv.last = k;
    const g = cv.el.getContext ? cv.el.getContext('2d') : null;
    if (!g) return;
    try {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, cv.w, cv.h);
      cv.draw(g, cv.w, cv.h, cv.dpr);
    } catch (err) { warnOnce('draw' + cv.el.className, 'serum-ui: display draw failed', err); }
  }

  /* ---------------------------------------------------------------- header (§9.2) */
  buildHead() {
    const d = this.d, H = mk(d, 'div', 'sx-head');
    this.head = H;
    this.bp = this.headPage;
    H.appendChild(logo(d));
    const tabs = mk(d, 'div', 'sx-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Synth pages');
    this.tabBtns = {};
    PAGES.forEach((p, i) => {
      const b = btn(d, 'sx-tab', PAGE_LABEL[p], null, () => this.setPage(p));
      b.setAttribute('role', 'tab');
      b.id = this.uid + '-tab-' + p;
      b.setAttribute('aria-controls', this.uid + '-page-' + p);
      b.addEventListener('keydown', e => {
        const k = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!k) return;
        e.preventDefault();
        const q = PAGES[(i + k + PAGES.length) % PAGES.length];
        this.setPage(q);
        this.tabBtns[q].focus();
      });
      tabs.appendChild(b);
      this.tabBtns[p] = b;
    });
    const pa = mk(d, 'div', 'sx-preset');
    const save = btn(d, 'sx-hbtn', icon(d, 'save'), 'Save preset', () => this.savePresetDialog());
    const prev = btn(d, 'sx-hbtn', '◀', 'Previous preset in category', () => this.stepPresetUI(-1));
    const name = btn(d, 'sx-hbtn sx-pname', '', 'Browse presets', () => this.browser.open());
    const next = btn(d, 'sx-hbtn', '▶', 'Next preset in category', () => this.stepPresetUI(1));
    pa.append(save, prev, name, next);
    this.custom(() => {
      // a preset loaded from outside (program change, host undo) ends the Init override and the dirty state
      const pr = this.host.presets, key = pr && pr.current ? pr.current() : null;
      if (key !== this.lastKey) { if (this.lastKey !== undefined) { this.dirty = false; this.nameOverride = null; } this.lastKey = key; }
      const cur = this.currentPreset(), nm = cur ? cur.name : this.nameOverride || 'Init';
      const t = (cur && cur.cat ? cur.cat + ' · ' : '') + nm + (this.dirty ? ' *' : '');
      if (name.textContent !== t) {
        name.textContent = '';
        if (cur && cur.cat) name.appendChild(mk(d, 'span', 'sx-pcat', cur.cat));
        name.appendChild(mk(d, 'span', this.dirty ? 'sx-dirty' : '', nm));
        name.setAttribute('aria-label', 'Preset ' + nm + (this.dirty ? ' (edited)' : '') + ', browse presets');
      }
    });
    const menuB = btn(d, 'sx-hbtn', 'Menu', 'Main menu', () => this.mainMenu(menuB));
    menuB.setAttribute('aria-haspopup', 'menu');
    const info = btn(d, 'sx-hbtn', icon(d, 'info'), 'Author and notes', () => this.authorDialog());
    this.vcEl = mk(d, 'span', 'sx-vc');
    this.vcEl.title = 'Oscillator voices sounding / maximum';
    const master = mk(d, 'div', 'sx-master');
    master.appendChild(this.dKnob('g.master', 'MASTER', { size: 'sm' }).el);
    H.append(tabs, pa, menuB, info, this.vcEl, master);
    this.el.appendChild(H);
    this.bp = null;
  }
  setPage(p) {
    if (!PAGES.includes(p)) p = 'osc';
    const s = this.s();
    if (s && s.ui && s.ui.page !== p) this.uiEdit(st => { st.ui.page = p; });
    this.showPage(p);
  }
  showPage(p) {
    this.page = p;
    if (!this.pages[p]) {
      const el = mk(this.d, 'div', 'sx-page sx-page-' + p);
      el.id = this.uid + '-page-' + p;
      el.setAttribute('role', 'tabpanel');
      el.setAttribute('aria-labelledby', this.uid + '-tab-' + p);
      const P = { el, binds: [], canvases: [], editors: [] };
      this.pages[p] = P;
      this.pageBox.appendChild(el);
      this.bp = P;
      try {
        if (p === 'osc') this.buildOsc(el); else if (p === 'fx') this.buildFx(el);
        else if (p === 'matrix') this.buildMatrix(el); else this.buildGlobal(el);
      } finally { this.bp = null; }
    }
    for (const k of PAGES) {
      const b = this.tabBtns[k], sel = k === p;
      b.setAttribute('aria-selected', sel ? 'true' : 'false');
      b.tabIndex = sel ? 0 : -1;
      if (this.pages[k]) this.pages[k].el.classList.toggle('sx-hidden', !sel);
    }
    for (const cv of this.pages[p].canvases) cv.sized = false;
    this.edDirty = true;
    this.paint(true);
    if (p === 'fx' && this.rack && this.rack.refresh) this.rack.refresh();
  }

  /* ---------------------------------------------------------------- presets in the header (§9.10) */
  presetList() { const pr = this.host.presets; return pr && pr.list ? arr(pr.list()) : []; }
  currentPreset() {
    const pr = this.host.presets;
    if (this.nameOverride || !pr || !pr.current) return null;
    const k = pr.current();
    return k === null || k === undefined ? null : this.presetList().find(p => p.key === k) || null;
  }
  confirmChange() {
    if (!this.prefs.askPreset || !this.dirty) return true;
    const cur = this.currentPreset(), nm = cur ? cur.name : this.nameOverride || 'Init';
    return askConfirm(this.d, 'Discard changes to “' + nm + '”?');
  }
  stepPresetUI(dir) {
    const pr = this.host.presets;
    if (!pr || !pr.load) return;
    const list = sortPresets(this.presetList(), this.browser.state()), cur = this.currentPreset();
    const key = stepPreset(list, cur ? cur.key : null, dir, cur ? cur.cat : null);
    if (key === null || (cur && key === cur.key) || !this.confirmChange()) return;
    pr.load(key);
    this.dirty = false;
    this.nameOverride = null;
    this.refresh();
  }
  savePresetDialog() {
    const pr = this.host.presets;
    if (!pr || !pr.save) { this.notify('Saving presets is not available'); return; }
    const d = this.d, cur = this.currentPreset(), body = mk(d, 'div');
    const nameI = mk(d, 'input'), catI = mk(d, 'input'), dl = mk(d, 'datalist');
    nameI.type = 'text'; nameI.maxLength = 64; nameI.value = cur ? cur.name : this.nameOverride || 'Init';
    catI.type = 'text'; catI.maxLength = 32; catI.value = cur && cur.cat ? cur.cat : 'User';
    dl.id = this.uid + '-cats';
    catI.setAttribute('list', dl.id);
    for (const c of presetCats(this.presetList())) { const o = mk(d, 'option'); o.value = c; dl.appendChild(o); }
    const l1 = mk(d, 'label', '', 'Name'), l2 = mk(d, 'label', '', 'Category (pick or type a new one)');
    l1.appendChild(nameI); l2.append(catI, dl);
    body.append(l1, l2);
    this.dialog('Save Preset', body, [
      { label: 'Cancel' },
      { label: 'Save', primary: true, action: () => {
        const name = nameI.value.trim();
        if (!name) { nameI.focus(); return false; }
        const nm = name.slice(0, 64); // (the host's limit)
        if (this.presetList().some(p => p.user && p.name === nm) && !askConfirm(d, 'Replace the saved preset “' + nm + '”?')) { nameI.focus(); return false; }
        pr.save({ name, cat: catI.value.trim() || 'User' });
        this.dirty = false;
        this.nameOverride = null;
        this.refresh();
        return true;
      } },
    ]);
  }
  authorDialog() {
    const d = this.d, s = this.s(), body = mk(d, 'div');
    const a = mk(d, 'input'), n = mk(d, 'textarea');
    a.type = 'text'; a.maxLength = 64; a.value = s.author || '';
    n.maxLength = 2000; n.value = s.notes || '';
    const l1 = mk(d, 'label', '', 'Author'), l2 = mk(d, 'label', '', 'Notes');
    l1.appendChild(a); l2.appendChild(n);
    body.append(l1, l2);
    this.dialog('Preset Info', body, [
      { label: 'Cancel' },
      { label: 'Done', primary: true, action: () => {
        const au = a.value.slice(0, 64), no = n.value.slice(0, 2000), st = this.s();
        if (au !== st.author || no !== st.notes) this.edit(x => { x.author = au; x.notes = no; }, { label: 'Preset info' });
        return true;
      } },
    ]);
  }

  /* ---------------------------------------------------------------- dialogs / overlays */
  // Full-panel overlay (role=dialog, Escape closes, focus restored). Returns { el, close }.
  overlayOpen(cls, label, onClose) {
    if (this.overlay) this.overlay.close();
    const d = this.d, ov = mk(d, 'div', 'sx-ov' + (cls ? ' ' + cls : ''));
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', label);
    const prev = d.activeElement;
    const O = { el: ov, closed: false };
    O.close = () => {
      if (O.closed) return;
      O.closed = true;
      ov.remove();
      if (this.overlay === O) this.overlay = null;
      if (onClose) onClose();
      if (prev && prev.focus && prev.isConnected !== false) prev.focus();
    };
    ov.addEventListener('keydown', e => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); O.close(); } });
    this.el.appendChild(ov);
    this.overlay = O;
    return O;
  }
  dialog(title, body, buttons) {
    const d = this.d, O = this.overlayOpen('sx-dlg-ov', title);
    const box = mk(d, 'div', 'sx-dlg');
    box.appendChild(mk(d, 'h3', '', title));
    box.appendChild(body);
    const row = mk(d, 'div', 'sx-dbtns');
    for (const b of buttons) {
      const e = btn(d, 'sx-btn' + (b.primary ? ' sx-pri' : ''), b.label, null, () => { if (!b.action || b.action() !== false) O.close(); });
      row.appendChild(e);
    }
    box.appendChild(row);
    O.el.appendChild(box);
    box.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
        const pri = buttons.find(b => b.primary);
        if (pri) { e.preventDefault(); if (!pri.action || pri.action() !== false) O.close(); }
      }
    });
    O.el.addEventListener('pointerdown', e => { if (e.target === O.el) O.close(); });
    const f = body.querySelector ? body.querySelector('input, textarea, button') : null;
    if (f && f.focus) f.focus(); else if (row.firstChild) row.firstChild.focus();
    return O;
  }
  promptText(title, label, value, ok) {
    const d = this.d, body = mk(d, 'div'), i = mk(d, 'input'), l = mk(d, 'label', '', label);
    i.type = 'text'; i.value = value || '';
    l.appendChild(i); body.appendChild(l);
    this.dialog(title, body, [{ label: 'Cancel' }, { label: 'OK', primary: true, action: () => ok(i.value) }]);
    if (i.select) i.select();
  }
  enterValue(id, el) {
    const w = el && el.wk;
    if (w && typeof w.edit === 'function') { if (w.focus) w.focus(); w.edit(); return; }
    this.promptText('Enter Value', core.destLabel(id, this.s(), this.fx()), this.fmt(id, this.getN(id)), t => {
      const n = this.parse(id, t);
      if (n === null || !fin(n)) { this.notify('Could not read “' + t + '”'); return false; }
      this.setN(id, n, 'set');
      return true;
    });
  }

  /* ---------------------------------------------------------------- mod layer (§9.4) */
  installModLayer() {
    const el = this.el;
    this.offs.push(on(el, 'contextmenu', e => this.onCtx(e)));
    this.offs.push(on(el, 'pointerdown', e => this.onCapDown(e), true));
    this.offs.push(on(el, 'click', e => this.onCapClick(e), true));
  }
  onCtx(e) {
    const t = e.target, host = closest(t, '[data-dest]');
    if (!host || !this.el.contains(host) || closest(t, '.sx-ov')) return;
    e.preventDefault();
    this.destMenu(host.getAttribute('data-dest'), e.clientX, e.clientY, host);
  }
  destMenu(id, x, y, el) {
    if (DEST_INDEX[id] === undefined) return;
    const s = this.s(), module = el && el.getAttribute ? el.getAttribute('data-module') : null;
    const caps = { midi: typeof this.host.midiLearn === 'function', module: module || undefined,
      paste: !!(module && CLIP && CLIP.kind === modKind(module)) };
    const items = knobMenuItems(s, this.fx(), id, caps);
    wk.contextMenu(x, y, this.menuActions(items, id, el, module), { anchor: focusable(el) });
  }
  moduleMenu(m, x, y, anchor) {
    const items = knobMenuItems(this.s(), this.fx(), '', { module: m, paste: !!(CLIP && CLIP.kind === modKind(m)) });
    const k = items.findIndex(it => it.kind === 'sep');
    wk.contextMenu(x, y, this.menuActions(items.slice(0, k < 0 ? items.length : k), '', anchor, m), { anchor });
  }
  menuActions(items, id, el, module) {
    const noun = MOD_NOUN[module] || '';
    return items.map(it => {
      if (it.kind === 'sep') return { sep: true };
      const a = { label: it.label };
      if (it.checked !== undefined) a.checked = it.checked;
      switch (it.kind) {
        case 'lockModule': a.action = () => this.edit(s => toggleIn(s.locks.mod, module), { label: 'Lock Module' }); break;
        case 'copy': a.action = () => { CLIP = clipModule(this.s(), module); this.notify(noun + ' copied'); }; break;
        case 'paste': a.action = () => this.edit(s => pasteModule(s, module, CLIP), { label: 'Paste ' + noun }); break;
        case 'init': a.action = () => this.edit(s => initModule(s, module), { label: 'Init ' + noun }); break;
        case 'bypass': a.action = () => this.edit(s => core.toggleModBypass(s, it.slot), { label: 'Bypass Modulator' }); break;
        case 'remove': a.action = () => this.edit(s => { s.matrix[it.slot] = emptyRow(); }, { label: 'Remove Modulator' }); break;
        case 'removeAll': a.action = () => this.edit(s => core.removeMods(s, id), { label: 'Remove All Modulators' }); break;
        case 'reset': a.action = () => this.setN(id, destOf(id).def, 'set'); break;
        case 'enter': a.action = () => this.enterValue(id, el); break;
        case 'memtrig': a.action = () => {
          const o = id === 'b.phase' ? 1 : 0, set = memTrigSet(Date.now());
          this.edit(s => { s.osc[o].memSet = set; }, { label: 'New MemTrig phase set' });
        }; break;
        case 'modsrc': a.sub = it.sub.map(x => ({ label: x.label, action: () => this.addModUI(x.src, id) })); break;
        case 'midiLearn': a.action = () => this.midiLearn(id); break;
        case 'midiForget': a.action = () => this.midiForget(id); break;
        case 'lock': case 'unlock': a.action = () => this.edit(s => toggleIn(s.locks.p, id, it.kind === 'lock'), { label: it.label }); break;
        default: break;
      }
      return a;
    });
  }
  applySel(s, src) {
    s.ui.mod = src;
    const e = envNum(src);
    if (e) s.ui.env = e - 1;
    if (/^(lfo[1-8]|velo|note)$/.test(src)) this.edSel = src;
    this.edDirty = true;
  }
  selectSrc(src) { this.uiEdit(s => this.applySel(s, src)); }
  addModUI(src, dst) {
    let res = null;
    this.edit(s => { res = dropRow(s, this.fx(), src, dst, { limit: this.prefs.limitDrop }); if (res) this.applySel(s, src); },
      { label: 'Add Modulation' });
    if (!res) this.notify('Matrix full (32 slots)'); else this.recentSlot.set(dst, res.slot);
    return res;
  }
  midiLearn(id) {
    const f = this.host.midiLearn;
    if (typeof f !== 'function') return;
    this.notify('MIDI Learn: move a controller…');
    Promise.resolve(f(id)).then(cc => {
      if (this.dead) return;
      if (cc !== null && cc !== undefined) {
        this.dirty = true;   // the MIDI map is saved with the preset (applyPreset)
        this.notify('CC ' + cc + ' → ' + (/^macro/.test(id) ? srcLabel(this.s(), id) : core.destLabel(id, this.s(), this.fx())));
      }
      this.queue();
    }, () => {});
  }
  midiForget(id) {
    if (typeof this.host.midiForget === 'function') { this.host.midiForget(id); this.dirty = true; this.queue(); return; }
    this.edit(s => { for (const k of Object.keys(s.midi)) if (s.midi[k] === id) delete s.midi[k]; }, { label: 'Remove MIDI CC' });
  }
  // Shift+Enter on a tile (§9.4 keyboard parity): destination picker grouped like the matrix menu
  modulatePicker(src, anchor) {
    const groups = new Map();
    for (const d of DESTS) {
      if (core.MATRIX_ONLY && core.MATRIX_ONLY.includes(d.id)) continue;
      if (!groups.has(d.group)) groups.set(d.group, []);
      groups.get(d.group).push({ label: core.destLabel(d.id, this.s(), this.fx()), action: () => this.addModUI(src, d.id) });
    }
    const r = anchor.getBoundingClientRect();
    wk.contextMenu(r.left, r.bottom, Array.from(groups, ([g, sub]) => ({ label: g, sub })), { anchor });
  }

  // Alt-drag / depth handle (§9.4): edits the row of the selected source on this control, else the most recently
  // added row; Shift+Alt-click toggles that row's TYPE
  onCapDown(e) {
    if (e.button !== 0) return;
    const t = e.target, dh = closest(t, '.wk-dh');
    if (!dh && !e.altKey) return;
    const host = closest(t, '[data-dest]');
    if (!host || !this.el.contains(host) || closest(t, '.sx-ov')) return;
    const id = host.getAttribute('data-dest'), slot = this.depthSlot(id);
    if (slot < 0) return;
    e.stopPropagation();
    e.preventDefault();
    // the click that follows this gesture must not reach the control (toggle flip, menu popup, seg select)
    this.eatClick = { el: host, t: Date.now() };
    if (e.altKey && e.shiftKey) { this.edit(s => core.toggleModPolarity(s, slot), { label: 'Mod polarity' }); return; }
    this.startDepth(e, id, slot);
  }
  depthSlot(id) {
    const s = this.s(), rows = modRows(s, id);
    if (!rows.length) return -1;
    const sel = rows.find(r => r.row.src === s.ui.mod);
    if (sel) return sel.slot;
    const rec = this.recentSlot.get(id);
    if (rec !== undefined && rows.some(r => r.slot === rec)) return rec;
    return rows[rows.length - 1].slot;
  }
  startDepth(e, id, slot) {
    const el = this.el, row = this.s().matrix[slot], D = { id: e.pointerId, x: e.clientX, y: e.clientY, a0: row.amt, acc: 0, a: row.amt };
    const ghost = mk(this.d, 'div', 'sx-ghost');
    this.d.body.appendChild(ghost);
    const show = (x, y) => {
      ghost.textContent = srcLabel(this.s(), row.src) + ' ' + sgn(D.a) + Math.round(D.a * 100) + '%';
      ghost.style.transform = 'translate(' + (x + 14) + 'px,' + (y - 24) + 'px)';
    };
    show(e.clientX, e.clientY);
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* pointer gone */ }
    this.edit(s => core.setModAmount(s, slot, D.a), { label: 'Mod depth', phase: 'start' });
    const move = ev => {
      if (ev.pointerId !== D.id) return;
      D.acc += ((D.y - ev.clientY) + (ev.clientX - D.x)) * (ev.shiftKey ? 0.1 : 1) / 100;   // 200 px = 2.0
      D.x = ev.clientX; D.y = ev.clientY;
      const a = Math.round(clamp(D.a0 + D.acc, -1, 1) * 1e4) / 1e4;
      if (a !== D.a) { D.a = a; this.edit(s => core.setModAmount(s, slot, a), { label: 'Mod depth', phase: 'move' }); }
      show(ev.clientX, ev.clientY);
    };
    const up = ev => {
      if (ev.pointerId !== D.id) return;
      offs.forEach(f => f());
      ghost.remove();
      try { el.releasePointerCapture(D.id); } catch (err) { /* released */ }
      if (ev.type === 'pointercancel') this.eatClick = null;   // no click follows a cancelled pointer
      else if (this.eatClick) this.eatClick.t = Date.now();   // a long depth drag: the click comes at release
      this.edit(s => core.setModAmount(s, slot, D.a), { label: 'Mod depth', phase: 'end' });
    };
    const offs = [on(el, 'pointermove', move), on(el, 'pointerup', up), on(el, 'pointercancel', up)];
  }
  // Alt-click on a matrix SOURCE menu (reassign every row with that source) or on the AUX MODE cell (bypass)
  onCapClick(e) {
    const E = this.eatClick;
    if (E) {
      this.eatClick = null;
      if (Date.now() - E.t < 1000 && E.el.contains(e.target)) { e.stopPropagation(); e.preventDefault(); return; }
    }
    if (!e.altKey) return;
    const cell = closest(e.target, '[data-malt]');
    if (!cell || !this.el.contains(cell)) return;
    e.stopPropagation();
    e.preventDefault();
    const slot = +cell.getAttribute('data-slot'), what = cell.getAttribute('data-malt'), s = this.s(), row = s.matrix[slot];
    if (what === 'mode') { this.edit(st => core.toggleModBypass(st, slot), { label: 'Bypass Modulator' }); return; }
    if (!row || !row.src) return;
    const r = cell.getBoundingClientRect(), from = row.src;
    wk.contextMenu(r.left, r.bottom, SRC_MENU.filter(id => id !== from).map(id => ({
      label: srcLabel(s, id), action: () => this.edit(st => core.reassignSource(st, from, id), { label: 'Reassign source' }),
    })), { anchor: focusable(cell) });
  }

  /* ---------------------------------------------------------------- source tiles and drag-and-drop */
  makeTile(src, labelFn, cls) {
    const d = this.d, b = mk(d, 'button', 'sx-tile' + (cls ? ' ' + cls : ''));
    b.type = 'button';
    const lab = mk(d, 'span', 'sx-tl'), badge = mk(d, 'span', 'sx-badge');
    b.append(lab, badge);
    b.setAttribute('data-src', src);
    if (lfoNum(src)) b.setAttribute('data-lfotile', String(lfoNum(src)));
    if (wk.tooltip) wk.tooltip(b, () => this.tileTip(src));
    this.custom(() => {
      const s = this.s(), n = tileDests(s, src).length, L = labelFn();
      if (lab.textContent !== L) lab.textContent = L;
      const bt = n ? String(n) : '';
      if (badge.textContent !== bt) badge.textContent = bt;
      b.setAttribute('aria-pressed', s.ui.mod === src ? 'true' : 'false');
      b.setAttribute('aria-label', L + (n ? ', ' + n + ' destination' + (n > 1 ? 's' : '') : '') + '. Drag onto a control; Shift+Enter to pick a destination');
    });
    this.tileDrag(b, src);
    b.addEventListener('keydown', e => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); this.modulatePicker(src, b); } });
    return b;
  }
  tileDrag(b, src) {
    let g = null, eat = 0;   // eat = time of the pointerup that ended a drag: its click is swallowed
    b.addEventListener('pointerdown', e => {
      if (e.button !== 0 || g) return;
      if (e.target && e.target.tagName === 'INPUT') return;
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, alt: e.altKey, on: false };
      try { b.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
    });
    b.addEventListener('pointermove', e => {
      if (!g || e.pointerId !== g.id) return;
      if (!g.on) {
        if (Math.hypot(e.clientX - g.x, e.clientY - g.y) <= 4) return;
        g.on = true;
        this.dragBegin(src, g.alt || e.altKey);
      }
      this.dragMove(e.clientX, e.clientY);
    });
    const up = e => {
      if (!g || e.pointerId !== g.id) return;
      const G = g;
      g = null;
      try { b.releasePointerCapture(G.id); } catch (err) { /* released */ }
      if (!G.on) return;
      if (e.type === 'pointercancel') { this.dragDone(null); return; }   // no click follows a cancelled pointer
      eat = Date.now();
      this.dragDone(this.hitTest(e.clientX, e.clientY), e.clientX, e.clientY);
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('click', e => {
      const ate = eat && Date.now() - eat < 1000;
      eat = 0;
      if (ate) { e.preventDefault(); return; }
      if (e.target && e.target.tagName === 'INPUT') return;
      this.selectSrc(src);
    });
  }
  dragBegin(src, alt) {
    const g = mk(this.d, 'div', 'sx-ghost', (alt ? 'Alt · ' : '') + srcLabel(this.s(), src));
    this.d.body.appendChild(g);
    this.el.classList.add('sx-dragging');
    this.drag = { src, alt, ghost: g, hit: null, off: on(this.d, 'keydown', e => { if (e.key === 'Escape') { e.preventDefault(); this.dragDone(null); } }, true) };
  }
  dragMove(x, y) {
    const D = this.drag;
    if (!D) return;
    D.ghost.style.transform = 'translate(' + (x + 12) + 'px,' + (y + 10) + 'px)';
    const hit = this.hitTest(x, y), el = hit ? hit.el : null;
    if (D.hit && D.hit.el !== el) D.hit.el.classList.remove('sx-droptgt');
    if (el) el.classList.add('sx-droptgt');
    this.el.classList.toggle('sx-candrop', !!hit);
    D.hit = hit;
  }
  dragDone(hit, x, y) {
    const D = this.drag;
    if (!D) return;
    this.drag = null;
    D.off();
    D.ghost.remove();
    if (D.hit) D.hit.el.classList.remove('sx-droptgt');
    this.el.classList.remove('sx-dragging', 'sx-candrop');
    if (hit) this.doDrop(hit, D.src, x, y);
  }
  hitTest(x, y) {
    const D = this.drag, d = this.d;
    if (!D) return null;
    const t = typeof d.elementFromPoint === 'function' ? d.elementFromPoint(x, y) : null;
    if (!t || !this.el.contains(t) || closest(t, '.sx-ov')) return null;
    const l = lfoNum(D.src);
    const ms = closest(t, '[data-msrc]');
    if (ms) return { kind: 'msrc', el: ms, slot: +ms.getAttribute('data-slot'), field: ms.getAttribute('data-msrc') };
    if (l && D.alt) {
      const lt = closest(t, '[data-lfotile]');
      if (lt) { const to = +lt.getAttribute('data-lfotile'); return to !== l ? { kind: 'copyLfo', el: lt, to: to - 1 } : null; }
      const od = closest(t, '[data-oscdisp]');
      if (od) return { kind: 'lfoWt', el: od, o: +od.getAttribute('data-oscdisp') };
    }
    const pt = this.lfoPointAt(x, y);
    if (pt) return pt;
    const dd = closest(t, '[data-dest]');
    if (dd && DEST_INDEX[dd.getAttribute('data-dest')] !== undefined) return { kind: 'dest', el: dd, id: dd.getAttribute('data-dest') };
    if (l) { const np = closest(t, '[data-noisepanel]'); if (np) return { kind: 'lfoNoise', el: np }; }
    return null;
  }
  // nearest LFO graph point within 8 px of (x, y) while an LFO is shown in the editor
  lfoPointAt(x, y) {
    const box = this.lfoBox, l = lfoNum(this.edSel) - 1;
    if (!box || l < 0 || this.page !== 'osc' || !box.isConnected) return null;
    const r = box.getBoundingClientRect();
    if (x < r.left - 8 || x > r.right + 8 || y < r.top - 8 || y > r.bottom + 8 || r.width < 2) return null;
    const pts = this.s().lfo[l].pts, ed = this.lfoEd;
    if (ed && typeof ed.pos === 'function' && typeof ed.hitPoint === 'function') {   // the editor's own geometry (padding)
      const i = ed.hitPoint(pts, ed.pos({ clientX: x, clientY: y }), false);
      return i >= 0 ? { kind: 'point', el: box, lfo: l, idx: i } : null;
    }
    let best = -1, bd = 64;
    pts.forEach((p, i) => {
      const dx = r.left + p[0] * r.width - x, dy = r.top + (1 - p[1]) * r.height - y, q = dx * dx + dy * dy;
      if (q <= bd) { bd = q; best = i; }
    });
    return best < 0 ? null : { kind: 'point', el: box, lfo: l, idx: best };
  }
  doDrop(hit, src, x, y) {
    const l = lfoNum(src) - 1;
    switch (hit.kind) {
      case 'dest': this.addModUI(src, hit.id); break;
      case 'msrc': this.edit(s => { s.matrix[hit.slot][hit.field] = src; }, { label: 'Matrix source' }); break;
      case 'point': {
        const n = this.s().lfo[hit.lfo].pts.length, items = [];
        if (hit.idx > 0 && hit.idx < n - 1) items.push({ label: 'X', action: () => this.linkNew(hit.lfo, [hit.idx], 'x', src) });
        items.push({ label: 'Y', action: () => this.linkNew(hit.lfo, [hit.idx], 'y', src) });
        wk.contextMenu(x, y, items, { anchor: this.lfoBox });
        break;
      }
      case 'copyLfo': this.edit(s => core.copyLfo(s, l, hit.to), { label: 'Copy LFO' }); this.edDirty = true; break;
      case 'lfoWt': this.lfoToWavetable(l, hit.o); break;
      case 'lfoNoise': this.lfoToNoise(l); break;
      default: break;
    }
  }
  linkNew(lfo, idxs, axis, src) {
    const s = this.s(), k = core.newBus ? core.newBus(s) : 0;
    if (!k) { this.notify('All 16 LFO buses in use'); return; }
    if (!rowsOf(s).some(r => !r.src)) { this.notify('Matrix full (32 slots)'); return; }
    this.edit(st => linkPoints(st, this.fx(), lfo, idxs, axis, k, src), { label: 'Modulate point' });
    this.edDirty = true;
  }

  /* ---------------------------------------------------------------- main menu (§9.8) */
  mainMenu(anchor) {
    const fx = this.fx(), r = anchor.getBoundingClientRect();
    wk.contextMenu(r.left, r.bottom + 2, [
      { label: 'Init Preset', action: () => this.initPreset() },
      { label: 'Init All LFOs', action: () => { if (this.need('initLfos')) { this.edit(s => core.initLfos(s), { label: 'Init All LFOs' }); this.edDirty = true; } } },
      { sep: true },
      { label: 'Render OSC A Warp', action: () => this.renderOscWarp(0) },
      { label: 'Render OSC B Warp', action: () => this.renderOscWarp(1) },
      { label: 'Resample to OSC A', action: () => this.resample('A') },
      { label: 'Resample to OSC B', action: () => this.resample('B') },
      { label: 'Resample to A+B (Stereo)', action: () => this.resample('AB') },
      { sep: true },
      { label: 'Lock FX Rack', checked: !!(fx && fx.lock), action: () => this.editFx(f => { f.lock = f.lock ? 0 : 1; }, { label: 'Lock FX Rack' }) },
      { label: 'Load Effect Chain…', sub: this.chainMenu() },
      { label: 'Save Effect Chain…', action: () => this.saveChainDialog() },
      { sep: true },
      { label: 'Velo->Amp', action: () => this.veloAmp() },
      { label: 'Vibrato quick-assign', action: () => this.vibrato() },
      { sep: true },
      { label: 'About', action: () => this.about() },
    ], { anchor });
  }
  replaceState(target, src) {
    for (const k of Object.keys(target)) delete target[k];
    Object.assign(target, src);
  }
  initPreset() {
    if (!this.need('applyPreset') || !this.confirmChange()) return;
    const init = core.defaultSerum();
    init.global.os = this.prefs.defOs;
    init.author = this.prefs.author;
    const next = core.applyPreset(this.s(), { name: 'Init', cat: 'Init', v: { s: init }, fx: core.defaultFx() });
    if (this.prefs.view3d) next.ui.view3d = [1, 1];
    this.edit(s => this.replaceState(s, next), { label: 'Init Preset', seed: true });
    if (this.fx() && core.applyPresetFx) {
      const locked = arr(next.locks.p).filter(id => isFxIdx(DEST_INDEX[id]));
      const nf = core.applyPresetFx(this.fx(), core.defaultFx(), locked);
      this.editFx(f => this.replaceState(f, nf), { label: 'Init Preset', seed: true });
    }
    this.dirty = false;
    this.nameOverride = 'Init';
    this.refresh();
  }
  veloAmp() {
    if (!this.need('veloToAmp')) return;
    let slot = -1;
    this.edit(s => { slot = core.veloToAmp(s); }, { label: 'Velo->Amp' });
    if (slot < 0) this.notify('Matrix full (32 slots)');
  }
  vibrato() {
    if (!this.need('vibratoAssign')) return;
    let slot = -1;
    this.edit(s => { slot = core.vibratoAssign(s); }, { label: 'Vibrato quick-assign' });
    if (slot < 0) this.notify('No unused LFO or matrix full');
    else { const r = this.s().matrix[slot]; this.notify(srcLabel(this.s(), r.src) + ' → Master Tune (mod wheel depth)'); this.edDirty = true; }
  }
  resample(target) {
    if (typeof this.host.resample !== 'function') { this.notify('Resampling is not available'); return; }
    this.notify('Resampling…');
    // the host selects the resampled table on the oscillator(s): an edit of the sound (§8.8 dirty)
    Promise.resolve(this.host.resample(target)).then(() => { if (!this.dead) { this.dirty = true; this.tables.clear(); this.refresh(); } },
      err => { console.error(err); this.notify('Resample failed'); });
  }
  about() {
    const body = mk(this.d, 'div');
    body.appendChild(mk(this.d, 'p', '', 'Wavetable synthesizer modelled on the Serum 1 workflow: two wavetable oscillators with 23 warp modes and unison, sub and noise oscillators, 96 filter types, 3 envelopes, 8 drawable LFOs, a 32-slot modulation matrix and a 10-module effect rack.'));
    body.appendChild(mk(this.d, 'p', '', 'All artwork, wavetables, noises and presets are original. Not affiliated with Xfer Records.'));
    this.dialog('About', body, [{ label: 'Close', primary: true }]);
  }
  /* effect chains (§9.6): synth.fxchains = [{name, fx}] (fx without ui / lock) + JSON file export / import */
  chains() { return arr(this.store('get', CHAINS_KEY, [])).filter(c => c && typeof c.name === 'string' && isObj(c.fx)); }
  chainMenu() {
    // Factory ▸ = serum-core FACTORY_CHAINS (read-only, never stored), then the user's library
    const fac = core.FACTORY_CHAINS ? core.FACTORY_CHAINS.chains : [];
    const head = fac.length ? [{ label: 'Factory', sub: fac.map(c => ({ label: c.name, action: () => this.loadChain(c.fx, c.name) })) }, { sep: true }] : [];
    const list = this.chains().map(c => ({ label: c.name, action: () => this.loadChain(c.fx, c.name) }));
    if (!list.length) list.push({ label: '(no saved chains)', disabled: true });
    return head.concat(list, [{ sep: true }, { label: 'Import from File…', action: () => this.importChains() },
      { label: 'Export All to File…', action: () => download(this.d, 'effect-chains.json', JSON.stringify({ type: 'synth.fxchains', v: 1, chains: this.chains() }, null, 1)) }]);
  }
  // Same rules as the rack's chain menu (fx-ui): stored chains are normalised copies without ui / lock, sorted by
  // name; loading replaces everything but ui / lock, keeps the values of locked FX parameters and compiles with
  // seed (§9.6); import accepts a library file ({ chains: [{ name, fx }] }, merged by name) or a single chain
  // ({ name, fx } as the rack's Export Effect Chain… writes it, or a bare fx state: loaded).
  chainCopy(fx) { const c = core.normalizeFx ? core.normalizeFx(fx) : clone(fx); delete c.ui; delete c.lock; return c; }
  storeChains(list) { this.store('set', CHAINS_KEY, list.slice().sort((a, b) => a.name.localeCompare(b.name))); }
  loadChain(fx, name) {
    if (!core.normalizeFx) return;
    const n = core.normalizeFx(fx), locked = arr(this.s().locks.p).filter(id => isFxIdx(DEST_INDEX[id]));
    this.editFx(f => {
      const keep = {};
      for (const id of locked) if (f.p && fin(f.p[id])) keep[id] = f.p[id];
      const ui = f.ui, lock = f.lock;
      this.replaceState(f, n);
      Object.assign(f.p, keep);
      f.ui = ui; f.lock = lock;
    }, { label: 'Load Effect Chain', seed: true });
    if (this.rack && this.rack.refresh) this.rack.refresh();
    if (name) this.notify('Loaded effect chain “' + name + '”');
  }
  saveChainDialog() {
    this.promptText('Save Effect Chain', 'Name', 'Chain ' + (this.chains().length + 1), t => {
      const name = String(t).trim().slice(0, 48);
      if (!name || !this.fx()) return false;
      this.storeChains(this.chains().filter(c => c.name !== name).concat([{ name, fx: this.chainCopy(this.fx()) }]));
      this.notify('Saved effect chain “' + name + '”');
      return true;
    });
  }
  importChains() {
    return pickFile(this.d, '.json,application/json').then(f => fileText(f).then(t => (t ? this.importChainText(t, f && f.name) : 0)))
      .catch(err => { console.warn(err); this.notify('Could not read that file'); });
  }
  importChainText(t, fileName) {
    const j = JSON.parse(t);
    if (j && Array.isArray(j.chains)) {
      const add = j.chains.filter(c => c && typeof c.name === 'string' && c.name.trim() && isObj(c.fx) && isObj(c.fx.p));
      if (!add.length) { this.notify('No effect chains in that file'); return 0; }
      const m = new Map(this.chains().map(c => [c.name, c]));
      for (const c of add) { const nm = c.name.trim().slice(0, 48); m.set(nm, { name: nm, fx: this.chainCopy(c.fx) }); }
      this.storeChains(Array.from(m.values()));
      this.notify('Imported ' + add.length + ' effect chain' + (add.length > 1 ? 's' : ''));
      return add.length;
    }
    const fx = j && isObj(j.fx) ? j.fx : j;
    if (!isObj(fx) || !isObj(fx.p)) { this.notify('No effect chains in that file'); return 0; }
    this.loadChain(fx, (j && typeof j.name === 'string' && j.name) || String(fileName || 'Effect chain').replace(/(\.fxchain)?\.json$/i, ''));
    return 1;
  }


  /* ================================================================ OSC page (§9.3) */
  buildOsc(el) {
    const d = this.d;
    const rowA = mk(d, 'div', 'sx-row sx-rowA'), col = mk(d, 'div', 'sx-col');
    col.append(this.noisePanel(), this.subPanel());
    rowA.append(col, this.oscPanel(0), this.oscPanel(1), this.filterPanel());
    const rowC = mk(d, 'div', 'sx-row sx-rowC');
    rowC.append(this.macrosPanel(), this.envPanel(), this.lfoPanel(), this.voicingPanel());
    el.append(rowA, this.tileStrip(), rowC);
  }
  // panel shell: power toggle (module power = DEST + module menu), title (module menu on right-click /
  // long-press / Enter), lock mark; greys out while off
  panel(title, module, powerId, cls) {
    const d = this.d, el = mk(d, 'section', 'sx-panel' + (cls ? ' ' + cls : ''));
    el.setAttribute('aria-label', title);
    const head = mk(d, 'div', 'sx-ptitle'), body = mk(d, 'div', 'sx-pbody');
    if (powerId) head.appendChild(this.dToggle(powerId, title + ' on', 'power', { module }).el);
    const name = mk(d, 'span', 'sx-tname', title);
    if (module) {
      name.tabIndex = 0;
      name.setAttribute('role', 'button');
      name.setAttribute('aria-haspopup', 'menu');
      name.setAttribute('aria-label', title + ' module menu (lock, copy, paste, init)');
      const open = (x, y) => this.moduleMenu(module, x, y, name);
      const below = () => { const r = name.getBoundingClientRect(); open(r.left, r.bottom + 2); };
      name.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); open(e.clientX, e.clientY); });
      name.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); below(); }
      });
      longPress(name, open);
    }
    const lock = icon(d, 'lock');
    lock.setAttribute('class', 'sx-lockmark');
    head.append(name, lock);
    el.append(head, body);
    if (module || powerId) {
      this.custom(() => {
        if (powerId) el.classList.toggle('sx-off', this.getN(powerId) < 0.5);
        if (module) el.classList.toggle('sx-locked', arr(this.s().locks.mod).includes(module));
      });
    }
    return { el, head, body, name };
  }
  row(...els) { const r = mk(this.d, 'div', 'sx-krow'); r.append(...els.filter(Boolean)); return r; }

  /* ---------------------------------------------------------------- OSC A / B */
  oscPanel(o) {
    const d = this.d, P = o ? 'b' : 'a', T = o ? 'OSC B' : 'OSC A';
    const { el, head, body } = this.panel(T, o ? 'oscB' : 'oscA', P + '.on');
    const wtm = this.bind(wk.menu({ label: T + ' wavetable', items: () => this.wtItems(o), get: () => this.s().osc[o].wt, arrows: true, stepGroup: true,
      set: v => this.edit(s => { s.osc[o].wt = v; }, { label: 'Wavetable' }) }));
    wtm.el.classList.add('sx-grow');
    const ren = btn(d, 'sx-hbtn', 'Rename', 'Rename user wavetable', () => this.renameTable(o));
    this.custom(() => ren.classList.toggle('sx-hidden', !this.canRename(this.s().osc[o].wt)));
    const del = btn(d, 'sx-hbtn', icon(d, 'trash'), 'Delete user wavetable', () => this.deleteUser(false, o));
    this.custom(() => del.classList.toggle('sx-hidden', !this.canDelete(this.s().osc[o].wt, false)));
    const edb = btn(d, 'sx-hbtn', icon(d, 'zoom'), 'Open wavetable editor (' + T + ')', () => this.openWtEditor(o));
    head.append(wtm.el, ren, del, edb);
    const cv = this.canvas('sx-tall', () => this.oscKey(o), (g, w, h, dpr) => this.drawOsc(g, w, h, dpr, o));
    cv.el.setAttribute('data-oscdisp', String(o));
    cv.el.tabIndex = 0;
    cv.el.setAttribute('role', 'button');
    cv.el.setAttribute('aria-label', T + ' wavetable display: click to switch 2D / 3D; drop a WAV or PNG to import');
    const flip = () => this.uiEdit(s => { s.ui.view3d[o] = s.ui.view3d[o] ? 0 : 1; });
    cv.el.addEventListener('click', flip);
    cv.el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
    this.fileDrop(cv.el, files => this.importTableFiles(o, files));
    const uni = this.dNum(P + '.uni', 'UNISON');
    this.uniEls = (this.uniEls || []).concat(uni.el);
    const warpBip = () => [6, 10, 12].includes(Math.round(22 * this.getN(P + '.warpMode')));
    const warp = this.dMenu(P + '.warpMode', 'WARP MODE', () => WARPS.map((w, k) => ({ v: k / 22, label: o ? w.nameB : w.name })));
    const pen = btn(d, 'sx-hbtn', icon(d, 'edit'), 'Edit remap curve (' + T + ')', () => this.remapPopover(o, pen));
    this.custom(() => { const m = Math.round(22 * this.getN(P + '.warpMode')); pen.classList.toggle('sx-hidden', !(m >= 13 && m <= 16)); });
    body.append(cv.el,
      this.row(uni.el, this.dKnob(P + '.det', 'DETUNE', { size: 'sm' }).el, this.dKnob(P + '.blend', 'BLEND', { size: 'sm' }).el,
        this.dKnob(P + '.phase', 'PHASE', { size: 'sm' }).el, this.dKnob(P + '.rand', 'RAND', { size: 'sm' }).el),
      this.row(this.dKnob(P + '.oct', 'OCT', { size: 'sm' }).el, this.dKnob(P + '.semi', 'SEM', { size: 'sm' }).el,
        this.dKnob(P + '.fine', 'FIN', { size: 'sm' }).el, this.dKnob(P + '.crs', 'CRS', { size: 'sm' }).el,
        this.dKnob(P + '.wt', 'WT POS').el),
      this.row(warp.el, pen),
      this.row(this.dKnob(P + '.warp', 'WARP', { bipolarFn: warpBip }).el, this.dKnob(P + '.pan', 'PAN', { size: 'sm' }).el,
        this.dKnob(P + '.level', 'LEVEL').el));
    return el;
  }
  wtList() {
    if (this.wtListT !== this.paintSeq || !this.wtListC) {
      const w = this.host.wt, L = w && w.list ? arr(w.list()) : [];
      this.wtListC = L.filter(t => !t.user).concat(L.filter(t => t.user));
      this.wtListT = this.paintSeq;
    }
    return this.wtListC;
  }
  wtItems(o) {
    const list = this.wtList(), cur = this.s().osc[o].wt;
    const items = list.map(t => ({ v: t.id, label: t.name || nameOfId(t.id), group: t.user ? 'User' : t.cat || 'Factory' }));
    if (!items.some(it => it.v === cur)) items.push({ v: cur, label: nameOfId(cur), group: 'Current' });
    // categories in catalogue order (first appearance), then User, then the unlisted current table (§9.3)
    const cats = items.map(it => it.group).filter(g => g !== 'User' && g !== 'Current');
    return groupItems(items, cats.concat(['User', 'Current']));
  }
  renameTable(o) {
    const id = this.s().osc[o].wt, it = this.wtList().find(t => t.id === id);
    this.promptText('Rename Wavetable', 'Name', it ? it.name : nameOfId(id), t => {
      const name = String(t).trim().slice(0, 48);
      if (!name) return false;
      const W = this.host.wt;
      // host.wt.rename when the host has it; otherwise a full host.wt.update of the table under its new name
      // (§8.8 update persists the table, and wtstore.put stores table.name)
      const job = typeof W.rename === 'function' ? Promise.resolve(W.rename(id, name))
        : Promise.resolve(W.get(id)).then(tb => { if (tb) return W.update(id, Object.assign({}, tb, { name }), {}); throw new Error('table missing'); });
      job.then(() => { this.tables.delete(id); this.wtListC = null; this.queue(); },
        err => { console.warn('serum-ui: rename', err); this.notify('Could not rename the wavetable'); });
      return true;
    });
  }
  canRename(id) {
    const W = this.host.wt;
    return /^user:/.test(id || '') && !!W && (typeof W.rename === 'function' || (typeof W.get === 'function' && typeof W.update === 'function'));
  }
  // Delete (OSC A / B, NOISE): the selected user table / noise leaves the store after a confirmation that names the
  // other tracks using it; the host switches every sound that used it to the default source
  canDelete(id, noise) {
    const W = this.host.wt;
    return (noise ? /^nzuser:/ : /^user:/).test(id || '') && !!W && typeof W.del === 'function';
  }
  deleteUser(noise, o) {
    const W = this.host.wt, s = this.s(), id = noise ? s.noise.src : s.osc[o].wt;
    if (!this.canDelete(id, noise)) return;
    const it = (noise ? this.noiseList() : this.wtList()).find(t => t.id === id), nm = it && it.name ? it.name : nameOfId(id);
    const kind = noise ? 'noise' : 'wavetable', users = typeof W.users === 'function' ? arr(W.users(id)) : [];
    const also = users.length > 1 ? ' The tracks using it (' + users.join(', ') + ') switch to the default ' + kind + '.' : '';
    if (!askConfirm(this.d, 'Delete the user ' + kind + ' “' + nm + '” from this browser? This cannot be undone.' + also)) return;
    Promise.resolve(W.del(id)).then(() => {
      if (this.dead) return;
      this.tables.delete(id); this.noiseOv.delete(id); this.wtListC = null; this.nzListC = null;
      this.notify('Deleted “' + nm + '”');
      this.queue();
    }, err => { console.warn('serum-ui: delete', err); if (!this.dead) this.notify('Could not delete “' + nm + '”'); });
  }
  // table cache: host.wt.get(id) → { table, R, morph, F (display frames), interp, exp }
  tableEntry(id) {
    let e = this.tables.get(id);
    if (e) return e;
    e = { state: 'loading', info: null };
    this.tables.set(id, e);
    const w = this.host.wt;
    if (!w || typeof w.get !== 'function') { e.state = 'missing'; return e; }
    Promise.resolve().then(() => w.get(id)).then(t => {
      if (this.tables.get(id) !== e) return;
      if (!t || !Array.isArray(t.frames) || !t.frames.length) e.state = 'missing';
      else {
        const R = t.frames.length, morph = t.morph | 0;
        e.info = { table: t, R, morph, F: morph && R > 1 ? 256 : R, interp: morph && R > 1 ? 1 : 0, exp: null };
        if (morph && R >= 256) e.info.F = R;
        e.state = 'ok';
      }
      this.fc = null;
      this.queue();
    }, () => { e.state = 'missing'; this.queue(); });
    return e;
  }
  tinfo(o) {
    const s = this.s(), e = s && s.osc ? this.tableEntry(s.osc[o].wt) : null;
    return e && e.info ? e.info : { F: 256, interp: 1 };
  }
  // the frame heard at normalised position n (discrete / crossfade / spectral expansion, §7.1, §6.5)
  frameAt(info, n) {
    const t = info.table, R = info.R, u = clamp01(n);
    if (R === 1) return t.frames[0];
    if (!info.morph) return t.frames[Math.min(R - 1, Math.floor(u * R))];
    let A, B, f;
    if (info.morph === 1 || typeof wt.expandTable !== 'function' || R >= 256) {
      const x = u * (R - 1), i = Math.min(R - 2, Math.floor(x));
      A = t.frames[i]; B = t.frames[i + 1]; f = x - i;
    } else {
      if (!info.exp) info.exp = wt.expandTable(t);
      const x = u * 255, i = Math.min(254, Math.floor(x));
      A = info.exp.subarray(i * 2048, i * 2048 + 2048); B = info.exp.subarray((i + 1) * 2048, (i + 2) * 2048); f = x - i;
    }
    if (!this.fbuf) this.fbuf = new Float32Array(2048);
    const out = this.fbuf;
    for (let j = 0; j < 2048; j++) out[j] = A[j] + (B[j] - A[j]) * f;
    return out;
  }
  slotFrame(info, k) {   // display slot k of info.F
    if (info.F === info.R) return info.table.frames[k];
    return this.frameAt(info, info.F > 1 ? k / (info.F - 1) : 0).slice();
  }
  liveN(id) {
    const sn = this.snap, i = DEST_INDEX[id];
    return sn && sn.notes > 0 && sn.eff && fin(sn.eff[i]) ? sn.eff[i] : this.getN(id);
  }
  livePos(o) {
    const sn = this.snap;
    return sn && sn.notes > 0 && sn.wtPos && fin(sn.wtPos[o]) ? sn.wtPos[o] : this.getN((o ? 'b' : 'a') + '.wt');
  }
  remapTab(o) {
    const pts = this.s().osc[o].remap, k = JSON.stringify(pts);
    this.rmap = this.rmap || [{}, {}];
    if (this.rmap[o].k !== k) this.rmap[o] = { k, tab: core.renderPts(pts, 2048) };
    return this.rmap[o].tab;
  }
  oscKey(o) {
    const s = this.s(), P = o ? 'b' : 'a', e = this.tableEntry(s.osc[o].wt), mode = Math.round(22 * this.getN(P + '.warpMode'));
    return [s.osc[o].wt, e.state, s.ui.view3d[o], this.livePos(o).toFixed(4), mode, this.liveN(P + '.warp').toFixed(4),
      this.getN(P + '.uni'), this.getN(P + '.det').toFixed(3), s.global.uniMode[o], this.getN(P + '.on'),
      this.phaseDrag[o] ? this.getN(P + '.phase').toFixed(3) : '', mode >= 13 && mode <= 16 ? JSON.stringify(s.osc[o].remap) : '',
      this.dsp() ? 1 : 0].join('|');
  }
  drawOsc(g, w, h, dpr, o) {
    const s = this.s(), P = o ? 'b' : 'a', e = this.tableEntry(s.osc[o].wt);
    g.strokeStyle = C.line; g.lineWidth = dpr;
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    g.font = Math.round(10 * dpr) + 'px ui-monospace, monospace';
    if (e.state !== 'ok') {
      g.fillStyle = C.mute;
      g.fillText(e.state === 'loading' ? 'Loading…' : 'Wavetable not found: ' + nameOfId(s.osc[o].wt), 8 * dpr, 16 * dpr);
      return;
    }
    const info = e.info, pos = this.livePos(o);
    const cur = info.interp ? Math.round(pos * (info.F - 1)) : Math.min(info.F - 1, Math.floor(pos * info.F));
    if (s.ui.view3d[o]) this.draw3d(g, w, h, dpr, info, cur);
    else {
      let fr = this.frameAt(info, pos);
      const mode = Math.round(22 * this.getN(P + '.warpMode')), D = this.dsp();
      if (mode > 0 && mode < 18 && D && typeof D.renderWarp === 'function') {
        try { fr = D.renderWarp(fr, mode, this.liveN(P + '.warp'), { over: 1, remap: this.remapTab(o) }); } catch (err) { warnOnce('rw', 'serum-ui: renderWarp failed', err); }
      }
      const n = fr.length, amp = h * 0.42;
      g.beginPath();
      for (let x = 0; x <= w; x++) { const y = h / 2 - fr[Math.min(n - 1, Math.floor(x / w * n))] * amp; if (x) g.lineTo(x, y); else g.moveTo(x, y); }
      g.strokeStyle = C.graph; g.lineWidth = 1.6 * dpr; g.stroke();
      g.lineTo(w, h / 2); g.lineTo(0, h / 2); g.closePath();
      g.fillStyle = 'rgba(89, 194, 255, 0.10)'; g.fill();
      if (this.phaseDrag[o]) {
        const x = Math.min(0.99999, this.getN(P + '.phase')) * w;
        g.strokeStyle = C.cur; g.lineWidth = 1.5 * dpr;
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
      }
    }
    this.drawStalks(g, w, h, dpr, o);
    g.fillStyle = C.mute;
    g.fillText((cur + 1) + ' / ' + info.F, 6 * dpr, h - 6 * dpr);
  }
  draw3d(g, w, h, dpr, info, cur) {
    const F = info.F, R = info.R || F, dx = w * 0.26, dy = h * 0.4, fw = w * 0.72, amp = h * 0.2;
    const line = (fr, z, col, lw) => {
      const x0 = z * dx, y0 = h * 0.7 - z * dy, n = fr.length, steps = Math.max(32, Math.round(fw / (2 * dpr)));
      g.beginPath();
      for (let j = 0; j <= steps; j++) {
        const x = x0 + j / steps * fw, y = y0 - fr[Math.min(n - 1, Math.floor(j / steps * n))] * amp;
        if (j) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.strokeStyle = col; g.lineWidth = lw; g.stroke();
    };
    for (const L of layers3d(F, R)) {   // back to front; real frames green, interpolated slots grey (§9.3)
      const fr = L.real && F !== R ? info.table.frames[L.frame] : this.slotFrame(info, L.slot);
      line(fr, L.z, L.real ? 'rgba(111, 227, 161, 0.55)' : 'rgba(127, 139, 152, 0.35)', dpr);
    }
    line(this.slotFrame(info, cur), F > 1 ? cur / (F - 1) : 0, C.cur, 1.8 * dpr);
  }
  drawStalks(g, w, h, dpr, o) {   // unison detune "stalks" (inv A3)
    const s = this.s(), P = o ? 'b' : 'a', N = Math.round(core.lawValue(P + '.uni', this.getN(P + '.uni')));
    if (N < 2) return;
    const det = core.lawValue(P + '.det', this.getN(P + '.det')), mode = s.global.uniMode[o];
    g.strokeStyle = 'rgba(79, 179, 255, 0.85)'; g.lineWidth = 1.5 * dpr;
    for (let i = 0; i < N; i++) {
      const t = 2 * i / (N - 1) - 1, v = mode === 4 ? t : core.detuneShape(mode, t), x = w / 2 + v * Math.max(det, 0.02) * w * 0.44;
      g.beginPath(); g.moveTo(x, h - 2 * dpr); g.lineTo(x, h - (i === (N - 1) / 2 ? 14 : 9) * dpr); g.stroke();
    }
  }
  remapPopover(o, anchor) {
    if (this.pop) { const same = this.pop.o === o; this.pop.close(); if (same) return; }
    const Ed = gx.CurveEditor;
    if (typeof Ed !== 'function') { this.notify('Curve editor not available'); return; }
    const d = this.d, box = mk(d, 'div', 'sx-pop'), T = (o ? 'OSC B' : 'OSC A') + ' remap';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', T);
    const hd = mk(d, 'div', 'sx-edhead');
    hd.append(mk(d, 'span', 'sx-ttl', T.toUpperCase()), mk(d, 'span', 'sx-grow'));
    const x = btn(d, 'sx-hbtn', '✕', 'Close', () => P.close());
    hd.appendChild(x);
    const eb = mk(d, 'div', 'sx-edbox');
    box.append(hd, eb);
    const er = this.el.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(ar.left - er.left, er.width - 436)) + 'px';
    box.style.top = (ar.bottom - er.top + 4) + 'px';
    this.el.appendChild(box);
    const ed = new Ed(eb, {
      get: () => this.s().osc[o].remap,
      set: (pts, ph) => this.edit(s => { s.osc[o].remap = pts; }, { label: T, phase: ph }),
      grid: () => { const g = this.s().lfoGrid; return { x: g.x, y: g.y }; },
      kind: 'remap', shapes: this.shapeLib(), height: 150,
    });
    const offs = [
      on(this.d, 'pointerdown', e => { if (!box.contains(e.target) && !anchor.contains(e.target) && !closest(e.target, '.wk-ctx')) P.close(); }, true),
      on(box, 'keydown', e => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); P.close(); anchor.focus(); } }),
    ];
    this.edSig.set(ed, () => JSON.stringify([this.s().osc[o].remap, this.s().lfoGrid]));
    const P = { o, ed, close: () => {
      offs.forEach(f => f());
      if (ed.destroy) ed.destroy();
      this.edSig.delete(ed); this.edKey.delete(ed);
      box.remove();
      if (this.pop === P) this.pop = null;
    } };
    this.pop = P;
    x.focus();
  }

  /* ---------------------------------------------------------------- files: wavetables / noises */
  fileDrop(el, fn) {
    const has = e => !!(e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0);
    el.addEventListener('dragover', e => { if (has(e)) { e.preventDefault(); el.classList.add('sx-dropok'); } });
    el.addEventListener('dragleave', () => el.classList.remove('sx-dropok'));
    el.addEventListener('drop', e => {
      el.classList.remove('sx-dropok');
      const fl = e.dataTransfer && e.dataTransfer.files;
      if (!fl || !fl.length) return;
      e.preventDefault();
      fn(Array.prototype.slice.call(fl));
    });
  }
  splitSize() {   // the WT editor's held import split size (§9.9), when it persists one in synth.sx.wte
    const st = this.store('get', 'synth.sx.wte', null), v = st && st.split;
    if (v === undefined || v === null || v === '') return null;
    return typeof wt.parseSplitSize === 'function' ? wt.parseSplitSize(String(v)) : null;
  }
  async decodeImage(file) {
    const w = this.d.defaultView || globalThis, bmp = await w.createImageBitmap(file);
    const c = mk(this.d, 'canvas');
    c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const im = g.getImageData(0, 0, c.width, c.height);
    return { width: im.width, height: im.height, data: im.data };
  }
  async importTableFiles(o, files) {
    const f = files[0], W = this.host.wt;
    if (!f || !W || !W.saveNew) return;
    try {
      let table;
      if (/\.png$/i.test(f.name) || f.type === 'image/png') {
        if (typeof wt.importImage !== 'function') throw new Error('PNG import unavailable');
        table = wt.importImage(await this.decodeImage(f));
      } else {
        if (typeof wt.readWav !== 'function' || typeof wt.tableFromWav !== 'function') throw new Error('WAV import unavailable');
        // clm chunk → its frames; whole multiple of 2048 → raw frames; else the held split size (manual) or Pitch Avg
        const wav = wt.readWav(await f.arrayBuffer()), split = this.splitSize();
        const opts = { mode: 'auto', name: (f.name || '').replace(/\.[^.]+$/, ''), channel: o === 1 && wav.ch && wav.ch.length > 1 ? 1 : 0 };
        if (split) opts.size = split;
        table = wt.tableFromWav(wav, opts);
      }
      const name = (f.name || 'Imported').replace(/\.[^.]+$/, '').slice(0, 48) || 'Imported';
      table.name = name;
      const id = await W.saveNew(table, name);
      if (this.dead || !id) return;
      this.wtListC = null;
      this.edit(s => { s.osc[o].wt = id; }, { label: 'Import wavetable' });
      this.notify(table.importMsg || 'Imported “' + name + '”');
    } catch (err) {
      console.warn('serum-ui: import', err);
      this.notify('Import failed: ' + (err && err.message ? err.message : err));
    }
  }
  async importNoiseFiles(files) {
    const f = files[0], W = this.host.wt;
    if (!f || !W || !W.saveNoise) return;
    try {
      if (typeof wt.readWav !== 'function') throw new Error('WAV import unavailable');
      const wav = wt.readWav(await f.arrayBuffer()), L = wav.ch[0], R = wav.ch.length > 1 ? wav.ch[1] : null;
      const name = (f.name || 'Noise').replace(/\.[^.]+$/, '').slice(0, 48) || 'Noise';
      const lp = wav.loop && wav.loop.end > wav.loop.start ? wav.loop : null;
      // source default (§9.3): a file with a smpl loop loops, any other file plays once
      const oneshot = lp ? 0 : 1;
      const rec = { kind: 'noise', name, rate: wav.sr, ch: R ? 2 : 1, root: 60, len: L.length, loopStart: lp ? lp.start : 0, loopEnd: lp ? lp.end : L.length, oneshot, L, R };
      const id = await W.saveNoise(rec, name);
      if (this.dead || !id) return;
      this.edit(s => { s.noise.src = id; s.noise.oneshot = oneshot; s.p['n.on'] = 1; }, { label: 'Import noise' });
      this.notify('Imported noise “' + name + '”');
    } catch (err) {
      console.warn('serum-ui: noise import', err);
      this.notify('Import failed: ' + (err && err.message ? err.message : err));
    }
  }
  // Alt-drag an LFO tile onto an oscillator display: one cycle of the LFO as a 1-frame user table (inv A13)
  async lfoToWavetable(l, o) {
    const W = this.host.wt;
    if (typeof wt.ptsToFrame !== 'function' || !W || !W.saveNew) { this.notify('LFO → wavetable is not available'); return; }
    const frame = wt.ptsToFrame(core.renderPts(this.s().lfo[l].pts, 1024)), name = 'LFO ' + (l + 1);
    const id = await W.saveNew({ name, frames: [frame], morph: 0, factory: 0 }, name);
    if (this.dead || !id) return;
    this.wtListC = null;
    this.edit(s => { s.osc[o].wt = id; }, { label: 'LFO to wavetable' });
  }
  // drag an LFO tile onto the NOISE panel: the LFO cycle as a keytrack-ready user noise (inv A8)
  async lfoToNoise(l) {
    const W = this.host.wt;
    if (typeof wt.lfoToNoise !== 'function' || !W || !W.saveNoise) { this.notify('LFO → noise is not available'); return; }
    const name = 'LFO ' + (l + 1), entry = wt.lfoToNoise(core.renderPts(this.s().lfo[l].pts, 1024), name);
    if (entry && typeof entry === 'object') entry.oneshot = 0;
    const id = await W.saveNoise(entry, name);
    if (this.dead || !id) return;
    // a looping single cycle tuned to the root (§7.9): looped, key-tracked (choosing a source sets oneshot, §9.3)
    this.edit(s => { s.noise.src = id; s.noise.oneshot = 0; s.noise.keytrack = 1; s.p['n.on'] = 1; }, { label: 'LFO to noise' });
  }
  // Wavetable to LFO Shape (§9.3): the oscillator's frame at its base WT POS → ≤ 64 points
  wtToLfo(o) {
    const e = this.tableEntry(this.s().osc[o].wt), l = Math.max(0, lfoNum(this.edSel) - 1);
    if (!e.info) { this.notify('Wavetable not loaded yet'); return; }
    if (typeof wt.frameToPoints !== 'function') { this.notify('Wavetable to LFO Shape is not available'); return; }
    const pts = wt.frameToPoints(this.frameAt(e.info, this.getN((o ? 'b' : 'a') + '.wt')).slice(), 64);
    this.edit(s => { const cut = ptsBuses(s.lfo[l].pts); s.lfo[l].pts = pts; s.lfo[l].loop = -1; s.lfo[l].start = 0; pruneLost(s, cut); }, { label: 'Wavetable to LFO Shape' });
    this.edDirty = true;
  }
  // Render OSC Warp (§9.8): 256 frames, frame f = base frame through the base warp mode at amount f/255
  async renderOscWarp(o) {
    const D = this.dsp(), W = this.host.wt, s = this.s(), P = o ? 'b' : 'a', mode = Math.round(22 * this.getN(P + '.warpMode'));
    if (!D || typeof D.renderWarp !== 'function' || typeof wt.bandlimit !== 'function' || !W || !W.saveNew) { this.notify('Render OSC Warp is not available'); return; }
    if (!mode) { this.notify('Choose a warp mode first'); return; }
    const e = this.tableEntry(s.osc[o].wt);
    if (!e.info) { this.notify('Wavetable not loaded yet'); return; }
    const frame = this.frameAt(e.info, this.getN(P + '.wt')).slice();
    let mod;
    if (mode >= 18 && mode <= 20) {
      const e2 = this.tableEntry(s.osc[1 - o].wt);
      if (!e2.info) { this.notify('The other oscillator’s wavetable is not loaded yet'); return; }
      mod = this.frameAt(e2.info, this.getN((o ? 'a' : 'b') + '.wt')).slice();
    } else if (mode === 22) {
      const sub = typeof wt.factoryTable === 'function' ? wt.factoryTable(core.SUB_IDS[Math.round(core.lawValue('s.shape', this.getN('s.shape')))]) : null;
      mod = sub && sub.frames ? sub.frames[0] : new Float32Array(2048);
    } else if (mode === 21) {
      const r = mulberry32(0x5EED);
      mod = new Float32Array(2048);
      for (let i = 0; i < 2048; i++) mod[i] = 2 * r() - 1;
    }
    this.notify('Rendering warp…');
    const remap = this.remapTab(o), frames = [];
    for (let f = 0; f < 256; f++) {
      frames.push(wt.bandlimit(D.renderWarp(frame, mode, f / 255, { over: 4, remap, mod }), 4));
      if ((f & 15) === 15) await new Promise(r => setTimeout(r, 0)); // short slices: the page stays responsive
      if (this.dead) return;
    }
    const name = (e.info.table.name || nameOfId(s.osc[o].wt)) + ' warp';
    const id = await W.saveNew({ name, frames, morph: 0, factory: 0 }, name);
    if (this.dead || !id) return;
    this.wtListC = null;
    this.edit(st => { st.osc[o].wt = id; st.p[P + '.warpMode'] = 0; }, { label: 'Render OSC Warp' });
    this.notify('Rendered “' + name + '”');
  }
  openWtEditor(o) {
    const W = wte.WTEditor;
    if (typeof W !== 'function') { this.notify('Wavetable editor not available'); return; }
    if (this.pop) this.pop.close();
    const O = this.overlayOpen('sx-wte-ov', 'Wavetable editor, ' + (o ? 'OSC B' : 'OSC A'), () => {
      const ed = this.wtEd;
      this.wtEd = null;
      if (ed && ed.close) { try { ed.close(); } catch (err) { /* closed */ } }
      this.editorOsc = null;
      if (typeof this.host.editorOpen === 'function') this.host.editorOpen(null);
      this.tables.clear();
      this.wtListC = null;
      if (!this.dead) this.refresh();
    });
    const box = mk(this.d, 'div', 'sx-wte');
    O.el.appendChild(box);
    this.wtEd = new W(box, { host: this.editorHost(), osc: o, onClose: () => O.close() });
    if (this.wtEd.open) this.wtEd.open();
    this.editorOsc = o;
    if (typeof this.host.editorOpen === 'function') this.host.editorOpen(o);
  }
  // The SerumUI host as the WT editor sees it: state edits (copy-on-write repoint, Send to Noise Oscillator) go
  // through SerumUI.edit, so they mark the preset edited (§8.8 dirty) and repaint the panel; every other member
  // is the host's own (methods bound to it).
  editorHost() {
    const H = this.host, ui = this;
    if (typeof Proxy !== 'function') return Object.assign({}, H, { edit: (fn, o) => ui.edit(fn, o) });
    return new Proxy(H, {
      get(t, k) {
        if (k === 'edit') return (fn, o) => ui.edit(fn, o);
        const v = t[k];
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  }

  /* ---------------------------------------------------------------- SUB */
  subPanel() {
    const d = this.d, { el, head, body } = this.panel('SUB', 'sub', 's.on');
    const shape = this.dMenu('s.shape', 'Sub shape', () => this.enumItems('s.shape', SUB_SHAPES.map(x => x.name)));
    shape.el.classList.add('sx-grow');
    const ico = mk(d, 'span', 'sx-ico'), sv = svgEl(d, 'svg', { viewBox: '0 0 32 16', 'aria-hidden': 'true' }), path = svgEl(d, 'path', { d: '' });
    sv.appendChild(path); ico.appendChild(sv);
    const SH = [p => -Math.sin(2 * Math.PI * p), p => -Math.tanh(4 * Math.sin(2 * Math.PI * p)) / Math.tanh(4), p => 1 - 2 * frac(p + 0.5),
      p => (p < 0.5 ? -1 : 1), p => (p < 0.25 ? -1 : 1 / 3)];
    let last = -1;
    this.custom(() => {
      const k = Math.round(core.lawValue('s.shape', this.getN('s.shape')));
      if (k === last || !SH[k]) return;
      last = k;
      let dd = '';
      for (let j = 0; j <= 64; j++) dd += (j ? 'L' : 'M') + (j / 2).toFixed(2) + ' ' + (8 - 6 * SH[k](j / 64)).toFixed(2);
      path.setAttribute('d', dd);
    });
    head.append(shape.el, ico);
    const dir = this.pToggle({ label: 'DIRECT', kind: 'btn', get: () => this.s().sub.direct,
      set: v => this.edit(s => { s.sub.direct = v ? 1 : 0; }, { label: 'Sub direct out' }) });
    dir.el.title = 'Direct out: bypass the filter and the FX rack';
    body.append(this.row(this.dNum('s.oct', 'OCTAVE').el, dir.el, this.dKnob('s.pan', 'PAN', { size: 'sm' }).el, this.dKnob('s.level', 'LEVEL').el));
    return el;
  }

  /* ---------------------------------------------------------------- NOISE */
  noiseList() {
    if (this.nzListT !== this.paintSeq || !this.nzListC) {
      const w = this.host.wt, L = w && w.noises ? arr(w.noises()) : [];
      this.nzListC = L.filter(t => !t.user).concat(L.filter(t => t.user));
      this.nzListT = this.paintSeq;
    }
    return this.nzListC;
  }
  noisePanel() {
    const d = this.d, { el, head, body } = this.panel('NOISE', 'noise', 'n.on');
    el.setAttribute('data-noisepanel', '1');
    const nm = this.bind(wk.menu({ label: 'Noise source', arrows: true, stepGroup: true, get: () => this.s().noise.src,
      items: () => {
        const cur = this.s().noise.src, items = this.noiseList().map(t => ({ v: t.id, label: t.name || nameOfId(t.id), group: t.user ? 'User' : t.cat || 'Noise' }));
        if (!items.some(it => it.v === cur)) items.push({ v: cur, label: nameOfId(cur), group: 'Current' });
        return groupItems(items, items.map(it => it.group).filter(g => g !== 'User' && g !== 'Current').concat(['User', 'Current']));
      },
      set: v => {
        const it = this.noiseList().find(t => t.id === v);
        this.edit(s => { s.noise.src = v; if (it && it.oneshot !== undefined) s.noise.oneshot = it.oneshot ? 1 : 0; }, { label: 'Noise source' });
      } }));
    nm.el.classList.add('sx-grow');
    const del = btn(d, 'sx-hbtn', icon(d, 'trash'), 'Delete user noise', () => this.deleteUser(true));
    this.custom(() => del.classList.toggle('sx-hidden', !this.canDelete(this.s().noise.src, true)));
    head.append(nm.el, del);
    const cv = this.canvas('sx-short', () => this.noiseKey(), (g, w, h, dpr) => this.drawNoise(g, w, h, dpr));
    cv.el.setAttribute('role', 'img');
    cv.el.setAttribute('aria-label', 'Noise overview; drop a WAV file to import a noise');
    this.fileDrop(cv.el, files => this.importNoiseFiles(files));
    const tg = (label, k, title) => {
      const w = this.pToggle({ label, kind: 'btn', get: () => this.s().noise[k], set: v => this.edit(s => { s.noise[k] = v ? 1 : 0; }, { label: 'Noise ' + label.toLowerCase() }) });
      w.el.title = title;
      return w.el;
    };
    body.append(cv.el,
      this.row(tg('ONE SHOT', 'oneshot', 'One-shot (off = loop)'), tg('KEY', 'keytrack', 'Keytrack: pitch follows the note'),
        tg('DIRECT', 'direct', 'Direct out: bypass the filter and the FX rack')),
      this.row(this.dKnob('n.phase', 'PHASE', { size: 'sm' }).el, this.dKnob('n.rand', 'RAND', { size: 'sm' }).el,
        this.dKnob('n.pitch', 'PITCH', { size: 'sm' }).el, this.dKnob('n.pan', 'PAN', { size: 'sm' }).el, this.dKnob('n.level', 'LEVEL').el));
    return el;
  }
  noiseOverview(id) {
    if (this.noiseOv.has(id)) return this.noiseOv.get(id);
    this.noiseOv.set(id, null);
    const build = L => {
      if (!L || !L.length) return;
      const n = 256, mm = new Float32Array(2 * n), per = L.length / n;
      for (let c = 0; c < n; c++) {
        let lo = 0, hi = 0;
        for (let i = Math.floor(c * per), e = Math.min(L.length, Math.floor((c + 1) * per) + 1); i < e; i++) { const v = L[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
        mm[2 * c] = lo; mm[2 * c + 1] = hi;
      }
      this.noiseOv.set(id, mm);
      this.queue();
    };
    const pick = r => {
      if (!r) return null;
      if (r.levels && r.levels[0]) return r.levels[0].L;
      if (r.L) return ArrayBuffer.isView(r.L) ? r.L : r.L instanceof ArrayBuffer ? new Float32Array(r.L) : null;
      return null;
    };
    // factory sources: generated once per page (deterministic content, shared by every SerumUI) with
    // wt.generateNoise (source only: no mip levels, no copies), when the browser is idle and only if the id is
    // still the selected source (arrowing through the menu does not generate every noise on the way)
    const factory = /^noise:/.test(id);
    if (factory && NOISE_OV.has(id)) { this.noiseOv.set(id, NOISE_OV.get(id)); return NOISE_OV.get(id); }
    const run = () => {
      if (this.dead) return;
      if (factory && this.s().noise.src !== id) { this.noiseOv.delete(id); return; }
      try {
        const gen = typeof wt.generateNoise === 'function' ? wt.generateNoise : typeof wt.makeNoise === 'function' ? wt.makeNoise : null;
        if (factory && gen) {
          build(pick(gen(id)));
          if (this.noiseOv.get(id)) NOISE_OV.set(id, this.noiseOv.get(id));
          return;
        }
      } catch (err) { warnOnce('nz' + id, 'serum-ui: noise overview', err); }
      const w = this.host.wt;
      if (w && w.get) Promise.resolve(w.get(id)).then(r => build(pick(r)), () => {});
    };
    const win = this.d.defaultView, ric = win && win.requestIdleCallback;
    if (factory && typeof ric === 'function') ric.call(win, run, { timeout: 300 }); else setTimeout(run, factory ? 120 : 0);
    return null;
  }
  noiseKey() {
    const s = this.s(), sn = this.snap, ov = this.noiseOverview(s.noise.src);
    return [s.noise.src, ov ? 1 : 0, sn && sn.notes > 0 && fin(sn.noisePos) ? sn.noisePos.toFixed(3) : '', this.getN('n.on')].join('|');
  }
  drawNoise(g, w, h, dpr) {
    const s = this.s(), mm = this.noiseOverview(s.noise.src), sn = this.snap;
    g.fillStyle = C.mute;
    if (!mm) { g.font = Math.round(10 * dpr) + 'px ui-monospace, monospace'; g.fillText(nameOfId(s.noise.src), 6 * dpr, h / 2 + 4 * dpr); return; }
    g.fillStyle = 'rgba(89, 194, 255, 0.7)';
    const n = mm.length / 2;
    for (let x = 0; x < w; x++) {
      const c = Math.min(n - 1, Math.floor(x / w * n)), lo = mm[2 * c], hi = mm[2 * c + 1];
      g.fillRect(x, h / 2 - hi * h * 0.45, 1, Math.max(1, (hi - lo) * h * 0.45));
    }
    if (sn && sn.notes > 0 && fin(sn.noisePos)) {
      g.fillStyle = C.cur;
      g.fillRect(Math.round(clamp01(sn.noisePos) * (w - 1)), 0, Math.max(1, dpr), h);
    }
  }

  /* ---------------------------------------------------------------- FILTER */
  filterItems() { return FILTERS.map((f, k) => ({ v: k / 95, label: f.name, group: f.cat })); }
  filterPanel() {
    const d = this.d, { el, head, body } = this.panel('FILTER', 'filter', 'f.on');
    const type = this.dMenu('f.type', 'Filter type', () => this.filterItems());
    type.el.classList.add('sx-grow');
    head.appendChild(type.el);
    const cv = this.canvas('sx-tall', () => this.filtKey(), (g, w, h, dpr) => this.drawFilter(g, w, h, dpr));
    const c = cv.el;
    c.tabIndex = 0;
    c.setAttribute('role', 'button');
    c.setAttribute('aria-label', 'Filter display: click cycles magnitude, phase and spectrum; drag sets cutoff (x) and resonance (y)');
    let g = null;
    const at = e => { const r = c.getBoundingClientRect(); return [clamp01((e.clientX - r.left) / Math.max(1, r.width)), clamp01(1 - (e.clientY - r.top) / Math.max(1, r.height))]; };
    const put = (e, ph) => { const [u, v] = at(e); this.edit(s => { s.p['f.cutoff'] = u; s.p['f.res'] = v; }, { label: 'Filter cutoff / res', phase: ph }); };
    c.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
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
      if (G.moved) put(e, 'end');
      else if (e.type === 'pointerup') this.uiEdit(s => { s.ui.filtView = (s.ui.filtView + 1) % 3; });
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('keydown', e => {
      const k = e.key;
      if (k === 'Enter' || k === ' ') { e.preventDefault(); this.uiEdit(s => { s.ui.filtView = (s.ui.filtView + 1) % 3; }); }
      else if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); this.setN('f.cutoff', this.getN('f.cutoff') + (k === 'ArrowRight' ? 0.01 : -0.01), 'set'); }
      else if (k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); this.setN('f.res', this.getN('f.res') + (k === 'ArrowUp' ? 0.01 : -0.01), 'set'); }
    });
    const route = mk(d, 'div', 'sx-route');
    route.setAttribute('role', 'group');
    route.setAttribute('aria-label', 'Filter routing');
    for (const k of ['A', 'B', 'N', 'S']) route.appendChild(this.dToggle('f.route' + k, k, 'btn').el);
    const key = this.pToggle({ label: 'KEY', kind: 'btn', get: () => this.s().filter.keytrack, set: v => this.edit(s => { s.filter.keytrack = v ? 1 : 0; }, { label: 'Filter key track' }) });
    key.el.title = 'Key track: cutoff follows the note';
    const typeN = () => Math.round(95 * this.getN('f.type'));
    body.append(c, this.row(route, key.el),
      this.row(this.dKnob('f.cutoff', 'CUTOFF', { size: 'lg' }).el, this.dKnob('f.res', 'RES').el, this.dKnob('f.pan', 'PAN', { size: 'sm' }).el),
      this.row(this.dKnob('f.drive', 'DRIVE', { size: 'sm' }).el,
        this.dKnob('f.var', 'VAR', { size: 'sm', labelFn: () => core.varLabel(typeN()) || 'VAR', disabled: () => !core.varLabel(typeN()) }).el,
        this.dKnob('f.mix', 'MIX', { size: 'sm', disabled: () => Math.round(95 * this.liveN('f.type')) === 80 }).el));
    return el;
  }
  filtKey() {
    const s = this.s(), v = s.ui.filtView;
    if (v === 2) return 'spec|' + (this.snapSeq || 0) + '|' + (this.snap && this.snap.notes > 0 ? 1 : 0);
    return [v, Math.round(95 * this.liveN('f.type')), this.liveN('f.cutoff').toFixed(4), this.liveN('f.res').toFixed(3),
      this.liveN('f.drive').toFixed(3), this.liveN('f.var').toFixed(3), this.getN('f.on'), this.dsp() ? 1 : 0].join('|');
  }
  drawFilter(g, w, h, dpr) {
    const s = this.s(), view = s.ui.filtView, type = Math.round(95 * this.liveN('f.type')), D = this.dsp();
    g.font = Math.round(9 * dpr) + 'px ui-monospace, monospace';
    g.strokeStyle = 'rgba(42, 51, 61, 0.9)'; g.lineWidth = dpr; g.fillStyle = C.mute;
    for (const f of [100, 1000, 10000]) {
      const x = Math.log(f / F_LO) / Math.log(F_HI / F_LO) * w;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
      g.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), x + 2 * dpr, h - 3 * dpr);
    }
    const label = ['MAG', 'PHASE', 'SPECTRUM'][view] || '';
    g.fillText(label, w - g.measureText(label).width - 4 * dpr, 10 * dpr);
    if (view === 2) { this.drawSpectrum(g, w, h, dpr); return; }
    if (type >= 76 && type <= 79) { this.drawFilterIcon(g, w, h, dpr, type); return; }
    if (!D || typeof D.filterImpulse !== 'function') { g.fillText('Filter display needs the DSP script', 6 * dpr, 14 * dpr); return; }
    const fc = core.lawValue('f.cutoff', this.liveN('f.cutoff'));
    let ir;
    try { ir = D.filterImpulse(type, fc, this.liveN('f.res'), this.liveN('f.drive'), this.liveN('f.var'), 48000, 4096); } catch (err) { warnOnce('fi', 'serum-ui: filterImpulse', err); return; }
    const N = ir.length, re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = fin(ir[i]) ? ir[i] : 0;
    fft(re, im);
    const binHz = 48000 / N, y0 = h * 0.5;
    g.beginPath();
    for (let x = 0; x <= w; x++) {
      const b = clamp(fOfX(x / w) / binHz, 0, N / 2 - 1), i = Math.floor(b), f = b - i, j = Math.min(N / 2, i + 1);
      let y;
      if (view === 1) {
        const ph = Math.atan2(im[i] + (im[j] - im[i]) * f, re[i] + (re[j] - re[i]) * f);
        y = y0 - ph / Math.PI * h * 0.42;
      } else {
        const m = Math.hypot(re[i], im[i]) * (1 - f) + Math.hypot(re[j], im[j]) * f, db = 20 * Math.log10(Math.max(1e-6, m));
        y = h * (24 - clamp(db, -60, 30)) / 72;
      }
      if (x) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.strokeStyle = this.getN('f.on') >= 0.5 ? C.graph : C.mute; g.lineWidth = 1.6 * dpr; g.stroke();
    if (view === 0) {
      g.lineTo(w, h); g.lineTo(0, h); g.closePath();
      g.fillStyle = 'rgba(89, 194, 255, 0.09)'; g.fill();
      g.strokeStyle = 'rgba(223, 230, 238, 0.25)';
      g.beginPath(); g.moveTo(0, h * 24 / 72); g.lineTo(w, h * 24 / 72); g.stroke();
    }
    const cx = this.liveN('f.cutoff') * w;
    g.fillStyle = C.cur; g.fillRect(cx - dpr, h - 5 * dpr, 2 * dpr, 5 * dpr);
  }
  drawFilterIcon(g, w, h, dpr, type) {   // Ring Mod / S&H types: symbolic display (inv A11.1)
    g.strokeStyle = C.graph; g.lineWidth = 1.6 * dpr;
    g.beginPath();
    for (let x = 0; x <= w; x++) {
      const p = x / w;
      let y;
      if (type <= 77) y = Math.sin(2 * Math.PI * 3 * p) * Math.sin(2 * Math.PI * 23 * p) * (type === 77 ? Math.cos(2 * Math.PI * 1.5 * p) : 1);
      else { const q = Math.floor(p * 14) / 14; y = Math.sin(2 * Math.PI * 2 * q); if (type === 79) y = Math.sin(2 * Math.PI * 2 * p) - y; }
      const yy = h / 2 - y * h * 0.35;
      if (x) g.lineTo(x, yy); else g.moveTo(x, yy);
    }
    g.stroke();
    g.fillStyle = C.mute;
    g.fillText(FILTERS[type].name, 6 * dpr, 12 * dpr);
  }
  drawSpectrum(g, w, h, dpr) {
    const sn = this.snap, tap = sn && sn.filtTap;
    let any = false;
    if (tap) for (let i = 0; i < tap.length; i += 7) if (tap[i] !== 0) { any = true; break; }
    if (!sn || !sn.notes || !tap || !any) { g.fillStyle = C.mute; g.fillText('no signal', w / 2 - 22 * dpr, h / 2); return; }
    const N = 1024, re = new Float64Array(N), im = new Float64Array(N), rate = sn.tapRate > 0 ? sn.tapRate : 48000;
    for (let i = 0; i < N; i++) re[i] = (tap[i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
    fft(re, im);
    g.beginPath();
    for (let x = 0; x <= w; x++) {
      const b = clamp(fOfX(x / w) / (rate / N), 0, N / 2 - 1), i = Math.floor(b), j = Math.min(N / 2, i + 1), f = b - i;
      const m = (Math.hypot(re[i], im[i]) * (1 - f) + Math.hypot(re[j], im[j]) * f) / (N / 4);
      const db = 20 * Math.log10(Math.max(1e-7, m)), y = h * (6 - clamp(db, -96, 6)) / 102;
      if (x) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.strokeStyle = C.on; g.lineWidth = 1.4 * dpr; g.stroke();
  }

  /* ---------------------------------------------------------------- tile strip (row B) */
  tileStrip() {
    const d = this.d, el = mk(d, 'div', 'sx-tiles'), lfo = [];
    el.setAttribute('role', 'toolbar');
    el.setAttribute('aria-label', 'Modulation sources (drag onto a control)');
    for (let e = 1; e <= 3; e++) el.appendChild(this.makeTile('env' + e, () => 'ENV ' + e));
    for (let l = 1; l <= 8; l++) { const t = this.makeTile('lfo' + l, () => 'LFO ' + l); lfo.push(t); el.appendChild(t); }
    el.append(this.makeTile('velo', () => 'VELO'), this.makeTile('note', () => 'NOTE'), this.makeTile('wheel', () => 'WHEEL'));
    this.custom(() => {
      const s = this.s(), n = Math.max(lfoTileCount(s), lfoNum(s.ui.mod), lfoNum(this.edSel));
      lfo.forEach((t, l) => t.classList.toggle('sx-hidden', l + 1 > n));
    });
    return el;
  }

  /* ---------------------------------------------------------------- MACROS (inv A15) */
  macrosPanel() {
    const d = this.d, { el, body } = this.panel('MACROS'), grid = mk(d, 'div', 'sx-macros');
    for (let m = 0; m < 4; m++) {
      const box = mk(d, 'div', 'sx-macro'), id = 'macro' + (m + 1);
      const name = () => this.s().macros[m].name || 'Macro ' + (m + 1);
      const ko = { get: () => this.s().macros[m].v, def: 0, fmt: n => Math.round(n * 100) + '%', size: 'md',
        set: (n, ph) => this.edit(s => { s.macros[m].v = clamp01(n); }, { label: 'Macro ' + (m + 1), phase: ph }) };
      Object.defineProperty(ko, 'label', { get: name, enumerable: true });
      const k = this.pKnob(ko);
      k.el.querySelector('.wk-lab').style.display = 'none';
      if (wk.tooltip) wk.tooltip(k.el, () => name() + ': ' + Math.round(this.s().macros[m].v * 100) + '%');
      k.el.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); this.macroMenu(m, e.clientX, e.clientY, k); });
      const tile = this.makeTile(id, name);
      tile.addEventListener('dblclick', e => { e.preventDefault(); this.renameMacro(m, box, tile); });
      tile.addEventListener('keydown', e => { if (e.key === 'F2') { e.preventDefault(); this.renameMacro(m, box, tile); } });
      box.append(k.el, tile);
      grid.appendChild(box);
    }
    body.appendChild(grid);
    return el;
  }
  macroMenu(m, x, y, k) {
    const id = 'macro' + (m + 1), s = this.s(), cc = ccFor(s, id), items = [
      { label: 'Reset Control', action: () => this.edit(st => { st.macros[m].v = 0; }, { label: 'Macro ' + (m + 1) }) },
      { label: 'Enter Value…', action: () => { k.focus(); if (k.edit) k.edit(); } },
      { label: 'Rename…', action: () => this.promptText('Rename Macro', 'Name', s.macros[m].name, t => {
        const v = String(t).trim().slice(0, 24) || 'Macro ' + (m + 1);
        this.edit(st => { st.macros[m].name = v; }, { label: 'Rename macro' });
        return true;
      }) },
    ];
    if (typeof this.host.midiLearn === 'function') {
      items.push({ sep: true });
      if (cc === null) items.push({ label: 'MIDI Learn', action: () => this.midiLearn(id) });
      else items.push({ label: 'MIDI Re-learn (CC ' + cc + ')', action: () => this.midiLearn(id) }, { label: 'Remove MIDI CC ' + cc, action: () => this.midiForget(id) });
    }
    wk.contextMenu(x, y, items, { anchor: k.el });
  }
  renameMacro(m, box, tile) {
    const d = this.d, i = mk(d, 'input');
    i.type = 'text'; i.maxLength = 24; i.value = this.s().macros[m].name;
    i.setAttribute('aria-label', 'Macro ' + (m + 1) + ' name');
    tile.classList.add('sx-hidden');
    box.appendChild(i);
    let done = false;
    const end = ok => {
      if (done) return;
      done = true;
      const v = i.value.trim().slice(0, 24);
      i.remove();
      tile.classList.remove('sx-hidden');
      if (ok) this.edit(s => { s.macros[m].name = v || 'Macro ' + (m + 1); }, { label: 'Rename macro' });
      tile.focus();
    };
    i.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); end(true); } else if (e.key === 'Escape') { e.preventDefault(); end(false); } });
    i.addEventListener('blur', () => end(true));
    i.focus();
    if (i.select) i.select();
  }

  /* ---------------------------------------------------------------- ENV editor (inv A12) */
  envPanel() {
    const d = this.d, { el, head, body, name } = this.panel('ENV 1');
    const E = () => this.s().ui.env | 0, id = k => () => 'e' + (E() + 1) + '.' + k;
    this.custom(() => { const t = 'ENV ' + (E() + 1); if (name.textContent !== t) name.textContent = t; });
    const lock = this.pToggle({ label: 'LOCK', kind: 'btn', get: () => this.s().ui.envLock, set: v => this.uiEdit(s => { s.ui.envLock = v ? 1 : 0; }) });
    lock.el.title = 'Lock: fit the whole envelope';
    const zoom = mk(d, 'input', 'sx-zoom');
    zoom.type = 'range'; zoom.min = '0'; zoom.max = '1'; zoom.step = '0.001';
    zoom.setAttribute('aria-label', 'Envelope zoom');
    const zOf = u => 0.01 * Math.pow(6400, u), uOf = z => Math.log(clamp(z, 0.01, 64) / 0.01) / Math.log(6400);
    zoom.addEventListener('input', () => this.uiEdit(s => { s.ui.envZoom = Math.round(zOf(+zoom.value) * 1000) / 1000; }));
    this.custom(() => { const s = this.s(); zoom.disabled = !!s.ui.envLock; if (d.activeElement !== zoom) zoom.value = String(uOf(s.ui.envZoom)); });
    head.append(mk(d, 'span', 'sx-grow'), lock.el, zoom);
    const box = mk(d, 'div', 'sx-edbox');
    body.appendChild(box);
    if (typeof gx.EnvEditor === 'function') {
      const ed = new gx.EnvEditor(box, {
        env: () => this.envVals(E()),
        set: (patch, ph) => this.setEnv(E(), patch, ph),
        ghosts: () => [0, 1, 2].filter(k => k !== E() && (k === 0 || this.srcUsed('env' + (k + 1)))).map(k => this.envVals(k)),
        lock: () => !!this.s().ui.envLock,
        zoom: () => this.s().ui.envZoom,
        playhead: () => { const sn = this.snap, k = E(); return sn && sn.envStage && sn.envStage[k] ? { stage: sn.envStage[k], t: sn.envT ? sn.envT[k] : 0 } : null; },
      });
      this.bp.editors.push(ed);
      this.edSig.set(ed, () => { const s = this.s(); return JSON.stringify([E(), this.envVals(0), this.envVals(1), this.envVals(2), s.ui.envLock, s.ui.envZoom, this.srcUsed('env2'), this.srcUsed('env3')]); });
    } else box.appendChild(mk(d, 'p', 'sx-txt', 'Envelope editor unavailable'));
    body.appendChild(this.row(this.dKnob(id('att'), 'ATTACK', { size: 'sm' }).el, this.dKnob(id('hold'), 'HOLD', { size: 'sm' }).el,
      this.dKnob(id('dec'), 'DECAY', { size: 'sm' }).el, this.dKnob(id('sus'), 'SUSTAIN', { size: 'sm' }).el,
      this.dKnob(id('rel'), 'RELEASE', { size: 'sm' }).el));
    // the curve handles are destinations too (§3.13): small knobs give them data-dest (lock, MIDI learn, drops)
    const cur = this.row(this.dKnob(id('ca'), 'A CURVE', { size: 'sm' }).el, this.dKnob(id('cd'), 'D CURVE', { size: 'sm' }).el,
      this.dKnob(id('cr'), 'R CURVE', { size: 'sm' }).el);
    cur.classList.add('sx-envcurves');
    body.appendChild(cur);
    return el;
  }
  envVals(k) {
    const P = 'e' + (k + 1) + '.', v = x => core.lawValue(P + x, this.getN(P + x));
    return { a: v('att'), h: v('hold'), d: v('dec'), s: v('sus'), r: v('rel'), ca: this.getN(P + 'ca'), cd: this.getN(P + 'cd'), cr: this.getN(P + 'cr') };
  }
  setEnv(k, patch, ph) {
    const P = 'e' + (k + 1) + '.';
    this.edit(s => {
      for (const key of Object.keys(patch || {})) {
        const f = ENV_ED[key], v = patch[key];
        if (!f || !fin(v)) continue;
        const id = P + f;
        s.p[id] = snapN(id, f === 'ca' || f === 'cd' || f === 'cr' ? clamp01(v) : core.lawNorm(id, v));
      }
    }, { label: 'Env ' + (k + 1), phase: ph || 'set' });
  }
  srcUsed(src) { return rowsOf(this.s()).some(r => r && (r.src === src || r.aux === src)); }

  /* ---------------------------------------------------------------- LFO / VELO / NOTE editor (inv A13, A14) */
  lfoIdx() { const l = lfoNum(this.edSel); if (l) this.lastLfo = l - 1; return this.lastLfo || 0; }
  lfoPanel() {
    const d = this.d, { el, head, body, name } = this.panel('LFO 1'), L = () => this.lfoIdx(), lf = () => this.s().lfo[L()];
    const isCurve = () => this.edSel === 'velo' || this.edSel === 'note';
    this.custom(() => { const t = isCurve() ? this.edSel.toUpperCase() : 'LFO ' + (L() + 1); if (name.textContent !== t) name.textContent = t; });
    // LFO controls
    const lfoHead = mk(d, 'div', 'sx-edhead'), lfoArea = mk(d, 'div', 'sx-pbody');
    const mode = this.pSeg({ label: 'LFO mode', items: ['TRIG', 'ENV', 'OFF'], get: () => ['trig', 'env', 'off'].indexOf(lf().mode),
      set: i => this.edit(s => { s.lfo[L()].mode = ['trig', 'env', 'off'][i]; }, { label: 'LFO mode' }) });
    const sw = (label, k, dis) => this.pToggle({ label, kind: 'btn', get: () => lf()[k], disabled: dis,
      set: v => this.edit(s => { s.lfo[L()][k] = v ? 1 : 0; }, { label: 'LFO ' + label.toLowerCase() }) }).el;
    const noBpm = () => !lf().bpm;
    const grid = mk(d, 'input', 'sx-grid');
    grid.type = 'text';
    grid.setAttribute('aria-label', 'LFO grid: x or x,y (1–64)');
    grid.title = 'Grid (x or x,y), global to all LFOs';
    const commit = () => {
      const gg = parseGrid(grid.value);
      grid.classList.toggle('sx-bad', !gg);
      if (gg) { const c = this.s().lfoGrid; if (gg.x !== c.x || gg.y !== c.y) this.edit(s => { s.lfoGrid = gg; }, { label: 'LFO grid' }); this.edDirty = true; }
    };
    grid.addEventListener('change', commit);
    grid.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
    this.custom(() => { if (d.activeElement !== grid) { const g = this.s().lfoGrid; grid.value = g.x === g.y ? String(g.x) : g.x + ',' + g.y; grid.classList.remove('sx-bad'); } });
    const folder = btn(d, 'sx-hbtn', icon(d, 'folder'), 'LFO shapes', () => this.lfoFolderMenu(folder));
    lfoHead.append(mode.el, sw('BPM', 'bpm'), sw('DOT', 'dot', noBpm), sw('TRIP', 'trip', noBpm), sw('ANCHOR', 'anchor', noBpm), grid, folder);
    const box = mk(d, 'div', 'sx-edbox');
    this.lfoBox = box;
    lfoArea.append(lfoHead, box);
    if (typeof gx.CurveEditor === 'function') {
      const ed = new gx.CurveEditor(box, {
        get: () => lf().pts,
        set: (pts, ph) => this.edit(s => {
          // buses the points held before this edit (and at the start of a drag): those no point links any
          // more lose their rows once the gesture ends; other bus rows are never touched (inv A13)
          const o = s.lfo[L()], had = ptsBuses(o.pts);
          if (ph === 'start') this.lfoGest = had;
          else if (ph === 'move' && this.lfoGest) { for (const b of had) if (!this.lfoGest.includes(b)) this.lfoGest.push(b); }
          o.pts = pts;
          if (o.loop >= pts.length) o.loop = pts.length - 1;
          if (o.start >= pts.length) o.start = 0;
          if (ph !== 'move' && ph !== 'start') {
            const cut = had.concat((this.lfoGest || []).filter(b => !had.includes(b)));
            this.lfoGest = null;
            pruneLost(s, cut);
          }
        }, { label: 'LFO ' + (L() + 1) + ' shape', phase: ph || 'set' }),
        grid: () => { const g = this.s().lfoGrid; return { x: g.x, y: g.y }; },
        kind: 'lfo',
        loop: () => lf().loop, setLoop: i => this.edit(s => { s.lfo[L()].loop = i; }, { label: 'LFO loop point' }),
        start: () => lf().start, setStart: i => this.edit(s => { s.lfo[L()].start = i; }, { label: 'LFO start point' }),
        playhead: () => (this.snap && this.snap.lfoPh && fin(this.snap.lfoPh[L()]) ? this.snap.lfoPh[L()] : null),
        pointMenu: (idxs, axis) => busMenuItems(this.s(), L(), idxs, axis).map(it => ({ label: it.label, checked: it.checked,
          action: () => (it.label === 'New bus' ? this.linkNew(L(), idxs, axis, this.s().ui.mod)
            : this.edit(s => linkPoints(s, this.fx(), L(), idxs, axis, it.bus, null), { label: 'Modulate point' })) })),
        removePointMods: idxs => this.edit(s => core.clearPointMods(s, L(), idxs), { label: 'Remove Point Modulations' }),
        fromWavetable: () => [{ label: 'From OSC A', action: () => this.wtToLfo(0) }, { label: 'From OSC B', action: () => this.wtToLfo(1) }],
        shapes: this.shapeLib(),
        bipolar: false, readOnly: false, height: 160,
      });
      this.lfoEd = ed;
      this.bp.editors.push(ed);
      this.edSig.set(ed, () => { const o = lf(), g = this.s().lfoGrid; return JSON.stringify([L(), o.pts, o.loop, o.start, o.mode, g.x, g.y]); });
    } else box.appendChild(mk(d, 'p', 'sx-txt', 'LFO editor unavailable'));
    const lid = k => () => 'l' + (L() + 1) + '.' + k;
    lfoArea.appendChild(this.row(...LFO_KNOBS.map(([k, t]) => this.dKnob(lid(k), t, { size: 'sm' }).el)));
    // VELO / NOTE curve
    const curveArea = mk(d, 'div', 'sx-pbody'), cb = mk(d, 'div', 'sx-edbox'), cv = () => (this.edSel === 'note' ? 'note' : 'velo');
    if (typeof gx.CurveEditor === 'function') {
      const ed2 = new gx.CurveEditor(cb, {
        get: () => this.s()[cv()].pts,
        set: (pts, ph) => this.edit(s => { s[cv()].pts = pts; }, { label: cv() === 'note' ? 'Note curve' : 'Velocity curve', phase: ph || 'set' }),
        grid: () => { const g = this.s().lfoGrid; return { x: g.x, y: g.y }; },
        kind: 'curve', shapes: this.shapeLib(), height: 160,
      });
      this.bp.editors.push(ed2);
      this.edSig.set(ed2, () => JSON.stringify([cv(), this.s()[cv()].pts, this.s().lfoGrid]));
    }
    const follow = this.pToggle({ label: 'FOLLOW PORTAMENTO / LEGATO', kind: 'btn', get: () => this.s()[cv()].porta,
      set: v => this.edit(s => { s[cv()].porta = v ? 1 : 0; }, { label: 'Follow portamento' }) });
    curveArea.append(cb, this.row(follow.el));
    let shown = null;
    this.custom(() => {
      const c = isCurve();
      lfoArea.classList.toggle('sx-hidden', c);
      curveArea.classList.toggle('sx-hidden', !c);
      const k = c ? this.edSel : 'lfo' + L();
      if (k !== shown) { shown = k; this.edDirty = true; }
    });
    body.append(lfoArea, curveArea);
    return el;
  }
  lfoFolderMenu(anchor) {
    const lib = this.shapeLib(), L = this.lfoIdx(), r = anchor.getBoundingClientRect();
    const apply = (pts, name) => this.edit(s => {
      const cut = ptsBuses(s.lfo[L].pts);
      s.lfo[L].pts = clone(pts); s.lfo[L].loop = -1; s.lfo[L].start = 0;
      pruneLost(s, cut);
    }, { label: 'Load shape ' + name });
    const list = lib.list(), fac = list.filter(x => x.factory), user = list.filter(x => !x.factory);
    const load = fac.map(x => ({ label: x.name, action: () => { apply(x.pts, x.name); this.edDirty = true; } }));
    if (user.length) load.push({ sep: true }, ...user.map(x => ({ label: x.name, action: () => { apply(x.pts, x.name); this.edDirty = true; } })));
    const items = [
      { label: 'Load Shape', sub: load.length ? load : [{ label: '(none)', disabled: true }] },
      { label: 'Save Shape…', action: () => this.promptText('Save Shape', 'Name', 'Shape ' + (user.length + 1), t => {
        const n = String(t).trim();
        if (!n) return false;
        lib.save(n, this.s().lfo[L].pts);
        this.notify('Saved shape “' + n + '”');
        return true;
      }) },
    ];
    if (user.length) items.push({ label: 'Delete Shape', sub: user.map(x => ({ label: x.name, action: () => lib.del(x.name) })) });
    items.push({ sep: true },
      { label: 'Import Library…', action: () => pickFile(this.d, '.json,application/json').then(f => f && lib.importFile(f)).then(n => { if (n) this.notify('Imported ' + n + ' shape' + (n > 1 ? 's' : '')); }, () => this.notify('Could not read that file')) },
      { label: 'Export Library…', action: () => lib.exportFile() },
      { sep: true },
      { label: 'Wavetable to LFO Shape', sub: [{ label: 'From OSC A', action: () => this.wtToLfo(0) }, { label: 'From OSC B', action: () => this.wtToLfo(1) }] });
    wk.contextMenu(r.left, r.bottom + 2, items, { anchor });
  }
  // shape library (deviation 10: JSON, no .shp): factory pts.SHAPES + synth.sx.shapes [{name, pts}]
  shapeLib() {
    if (this.shapes) return this.shapes;
    if (typeof gx.shapeLib === 'function') return (this.shapes = gx.shapeLib(this.host.storage, SHAPES_KEY));
    const okPts = p => Array.isArray(p) && p.length >= 2 && p.length <= 480 && p.every(q => Array.isArray(q) && fin(q[0]) && fin(q[1]));
    const fac = () => {
      const S = gx.pts && gx.pts.SHAPES;
      if (Array.isArray(S)) return S.filter(x => x && okPts(x.pts)).map(x => ({ name: x.name, pts: x.pts, factory: true }));
      if (isObj(S)) return Object.keys(S).filter(k => okPts(S[k])).map(k => ({ name: k, pts: S[k], factory: true }));
      return [];
    };
    const user = () => arr(this.store('get', SHAPES_KEY, [])).filter(x => x && typeof x.name === 'string' && okPts(x.pts));
    this.shapes = {
      list: () => fac().concat(user().map(x => ({ name: x.name, pts: x.pts, factory: false }))),
      save: (name, pts) => {
        const n = String(name).trim().slice(0, 48);
        if (!n || !okPts(pts)) return;
        this.store('set', SHAPES_KEY, user().filter(x => x.name !== n).concat([{ name: n, pts: clone(pts) }]));
      },
      del: name => this.store('set', SHAPES_KEY, user().filter(x => x.name !== name)),
      exportFile: () => download(this.d, 'shapes.json', JSON.stringify({ type: 'synth.sx.shapes', v: 1, shapes: user() }, null, 1)),
      importFile: file => fileText(file).then(t => {
        const o = JSON.parse(t), add = arr(Array.isArray(o) ? o : o && o.shapes).filter(x => x && typeof x.name === 'string' && okPts(x.pts));
        const keep = user().filter(x => !add.some(a => a.name === x.name));
        this.store('set', SHAPES_KEY, keep.concat(add.map(x => ({ name: x.name.slice(0, 48), pts: x.pts }))));
        return add.length;
      }),
    };
    return this.shapes;
  }

  /* ---------------------------------------------------------------- VOICING (inv A17) */
  voicingPanel() {
    const d = this.d, { el, body } = this.panel('VOICING'), v = () => this.s().voicing;
    const tg = (label, k, title) => {
      const w = this.pToggle({ label, kind: 'btn', get: () => v()[k], set: x => this.edit(s => { s.voicing[k] = x ? 1 : 0; }, { label: 'Voicing ' + label.toLowerCase() }) });
      if (title) w.el.title = title;
      return w.el;
    };
    const poly = this.pNum({ label: 'POLY', min: 1, max: 32, step: 1, def: 8, px: 160, get: () => v().poly, disabled: () => !!v().mono,
      set: (x, ph) => this.edit(s => { s.voicing.poly = x; }, { label: 'Polyphony', phase: ph }) });
    const polyMenu = (x, y) => {
      const s = this.s();
      wk.contextMenu(x, y, [
        { label: 'Lock Polyphony', checked: !!s.locks.misc.poly, action: () => this.edit(st => { st.locks.misc.poly = st.locks.misc.poly ? 0 : 1; }, { label: 'Lock Polyphony' }) },
        { label: 'Limit polyphony to one of any note number', checked: !!s.voicing.oneNote, action: () => this.edit(st => { st.voicing.oneNote = st.voicing.oneNote ? 0 : 1; }, { label: 'One voice per note' }) },
      ], { anchor: poly.el.querySelector('.sx-nfv') });
    };
    poly.el.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); polyMenu(e.clientX, e.clientY); });
    longPress(poly.el, polyMenu);
    this.custom(() => poly.el.classList.toggle('sx-locked-ctl', !!this.s().locks.misc.poly));
    const vc = mk(d, 'span', 'sx-rate');
    this.custom(() => { const t = this.vcText ? this.vcText + ' voices' : ''; if (vc.textContent !== t) vc.textContent = t; });
    body.append(this.row(tg('MONO', 'mono'), tg('LEGATO', 'legato', 'Legato (with Mono off: poly legato)'), poly.el),
      this.row(this.dKnob('g.porta', 'PORTA').el, this.dKnob('g.curve', 'CURVE', { size: 'sm' }).el),
      this.row(tg('ALWAYS', 'always', 'Glide even without overlapping notes'), tg('SCALED', 'scaled', 'Glide time scales with the interval (1 octave = PORTA)')),
      this.row(vc));
    return el;
  }


  /* ================================================================ FX page (§9.6) */
  buildFx(el) {
    const d = this.d, box = mk(d, 'div', 'sx-fxbox'), R = fxui.FXRackUI;
    if (typeof R === 'function') {
      const adapter = {
        fx: () => this.fx(),
        editFx: (fn, o) => this.editFx(fn, o, true),
        bpm: () => this.bpm(),
        gr: () => (this.smon && this.smon.gr ? this.smon.gr : null),
        locked: id => arr(this.s().locks.p).includes(id),
        storage: this.host.storage,
        notify: t => this.notify(t),
        tip: id => this.tipText(id) || null, // FX knob tooltips with Serum's modulator lines (RULINGS host additions)
      };
      this.rack = new R(box, adapter, { embedded: true, dsp: globalThis.FXDSP || null });
    } else box.appendChild(mk(d, 'p', 'sx-txt', 'FX rack unavailable'));
    const mac = mk(d, 'div', 'sx-row sx-rowC');
    mac.appendChild(this.macrosPanel());
    el.append(box, this.tileStrip(), mac);
  }

  /* ================================================================ MATRIX page (§9.5) */
  buildMatrix(el) {
    const d = this.d, { el: pan, head, body } = this.panel('MATRIX');
    const mb = btn(d, 'sx-hbtn', icon(d, 'more'), 'Matrix menu', () => {
      const r = mb.getBoundingClientRect();
      wk.contextMenu(r.left, r.bottom + 2, [
        { label: 'Velo->Amp', action: () => this.veloAmp() },
        { label: 'Vibrato quick-assign', action: () => this.vibrato() },
        { sep: true },
        { label: 'Clear All Modulations', action: () => this.edit(s => { s.matrix = s.matrix.map(emptyRow); }, { label: 'Clear All Modulations' }) },
      ], { anchor: mb });
    });
    mb.setAttribute('aria-haspopup', 'menu');
    head.append(mk(d, 'span', 'sx-grow'), mb);
    const hd = mk(d, 'div', 'sx-mhd');
    hd.setAttribute('aria-hidden', 'true');
    for (const t of ['#', 'SOURCE', 'CURVE', 'AMOUNT', 'DESTINATION', 'TYPE', 'AUX SOURCE', 'AUX MODE', 'BYP', 'OUTPUT', '']) hd.appendChild(mk(d, 'span', '', t));
    const list = mk(d, 'div', 'sx-mx');
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', 'Modulation matrix, 32 slots');
    for (let slot = 0; slot < 32; slot++) list.appendChild(this.matrixRow(slot));
    body.append(hd, list);
    el.append(pan, this.tileStrip());
  }
  destItems() {
    if (this.dstT !== this.paintSeq || !this.dstC) {
      const s = this.s(), fx = this.fx();
      this.dstC = groupItems([{ v: '', label: '—', group: '' }].concat(DESTS.map(x => ({ v: x.id, label: core.destLabel(x.id, s, fx), group: x.group }))));
      this.dstT = this.paintSeq;
    }
    return this.dstC;
  }
  srcItems() {
    if (this.srcT !== this.paintSeq || !this.srcC) {
      const s = this.s();
      this.srcC = [{ v: '', label: '—' }].concat(SRC_MENU.map(id => ({ v: id, label: srcLabel(s, id) })));
      this.srcT = this.paintSeq;
    }
    return this.srcC;
  }
  matrixRow(slot) {
    const d = this.d, R = () => this.s().matrix[slot];
    const row = mk(d, 'div', 'sx-mrow');
    row.setAttribute('role', 'listitem');
    row.setAttribute('aria-label', 'Slot ' + (slot + 1));
    const mmenu = (label, field) => {
      const w = this.bind(wk.menu({ label, items: () => (field === 'dst' ? this.destItems() : this.srcItems()), get: () => R()[field], arrows: false,
        set: v => this.edit(s => { s.matrix[slot][field] = v; }, { label: 'Matrix ' + label.toLowerCase() }) }));
      return w.el;
    };
    const cell = (cls, child, attrs) => {
      const c = mk(d, 'div', cls);
      for (const k in attrs || {}) c.setAttribute(k, attrs[k]);
      if (child) c.appendChild(child);
      return c;
    };
    const pct = a => sgn(a) + Math.round(a * 100) + '%';
    const amt = this.slider({ label: 'Amount', get: () => (R().amt + 1) / 2, def: 0.5, bipolar: true, orient: 'h', fmt: n => pct(2 * n - 1),
      parse: t => { const a = parseAmount(t, R().dst, R().bi); return a === null ? null : (a + 1) / 2; },
      set: (n, ph) => this.edit(s => core.setModAmount(s, slot, Math.round((2 * n - 1) * 1e4) / 1e4), { label: 'Matrix amount', phase: ph || 'set' }) });
    if (wk.tooltip) wk.tooltip(amt.el, () => 'Amount ' + pct(R().amt) + ' (type a percentage, or 12st on pitch destinations)');
    const native = typeof wk.slider === 'function';   // wk.slider shows its value and takes typed entry itself
    const amtV = native ? null : this.valBox(() => pct(R().amt), t => parseAmount(t, R().dst, R().bi),
      a => this.edit(s => core.setModAmount(s, slot, a), { label: 'Matrix amount' }), 'Amount: percent, or semitones (12st) on pitch destinations');
    const out = this.slider({ label: 'Output', get: () => R().out, def: 1, bipolar: false, orient: 'h', fmt: n => Math.round(n * 100) + '%',
      parse: t => { const m = /^\s*(\d+(?:[.,]\d+)?)\s*%?\s*$/.exec(String(t)); return m ? clamp01(parseFloat(m[1].replace(',', '.')) / 100) : null; },
      set: (n, ph) => this.edit(s => { s.matrix[slot].out = Math.round(clamp01(n) * 1e4) / 1e4; }, { label: 'Matrix output', phase: ph || 'set' }) });
    const outV = native ? null : this.valBox(() => Math.round(R().out * 100) + '%', t => { const m = /^\s*(\d+(?:[.,]\d+)?)\s*%?\s*$/.exec(String(t)); return m ? clamp01(parseFloat(m[1].replace(',', '.')) / 100) : null; },
      v => this.edit(s => { s.matrix[slot].out = v; }, { label: 'Matrix output' }), 'Output (percent)');
    const typ = this.mBtn(() => (R().bi ? '<->' : '->'), () => this.edit(s => { const r = s.matrix[slot]; r.bi = r.bi ? 0 : 1; }, { label: 'Matrix type' }),
      () => 'Type: ' + (R().bi ? 'bipolar' : 'unipolar'));
    const mode = this.mBtn(() => (R().inv ? '(inv)' : 'Default'), () => this.edit(s => { const r = s.matrix[slot]; r.inv = r.inv ? 0 : 1; }, { label: 'Aux mode' }),
      () => 'Aux mode ' + (R().inv ? '(inv)' : 'Default') + '; Alt-click toggles bypass');
    const byp = this.pToggle({ label: 'Bypass', kind: 'led', get: () => R().byp, set: v => this.edit(s => { s.matrix[slot].byp = v ? 1 : 0; }, { label: 'Matrix bypass' }) });
    const more = btn(d, 'sx-hbtn', icon(d, 'more'), 'Slot ' + (slot + 1) + ' menu', () => this.rowMenu(slot, more));
    const ac = mk(d, 'div', 'sx-mamt'), oc = mk(d, 'div', 'sx-mout');
    ac.append(amt.el); oc.append(out.el);
    if (amtV) ac.appendChild(amtV);
    if (outV) oc.appendChild(outV);
    row.append(mk(d, 'span', 'sx-mn', String(slot + 1)),
      cell('sx-msrc sx-mslot', mmenu('Source', 'src'), { 'data-msrc': 'src', 'data-slot': slot, 'data-malt': 'src' }),
      cell('sx-mcrv', this.curveCell(slot)), ac, cell('sx-mdst', mmenu('Destination', 'dst')), cell('sx-mtyp', typ),
      cell('sx-maux sx-mslot', mmenu('Aux source', 'aux'), { 'data-msrc': 'aux', 'data-slot': slot }),
      cell('sx-mmode', mode, { 'data-malt': 'mode', 'data-slot': slot }), cell('sx-mbyp', byp.el), oc, cell('sx-mmore', more));
    this.custom(() => row.classList.toggle('sx-dim', !rowActive(R())));
    return row;
  }
  mBtn(text, click, title) {
    const b = btn(this.d, 'sx-btn', '', null, click);
    this.custom(() => {
      const t = text(), ti = title();
      if (b.textContent !== t) b.textContent = t;
      b.setAttribute('aria-label', ti);
      b.title = ti;
    });
    return b;
  }
  // clickable value text with typed entry (Enter / click → input; Enter commits through parse)
  valBox(text, parse, commit, label) {
    const d = this.d, v = mk(d, 'span', 'sx-mval');
    v.tabIndex = 0;
    v.setAttribute('role', 'button');
    v.title = label;
    this.custom(() => { if (!v.firstChild || v.firstChild.nodeType === 3 || !v.querySelector('input')) { const t = text(); if (v.textContent !== t) v.textContent = t; v.setAttribute('aria-label', label + ': ' + t); } });
    const edit = () => {
      if (v.querySelector && v.querySelector('input')) return;
      const i = mk(d, 'input');
      i.type = 'text'; i.value = text();
      i.setAttribute('aria-label', label);
      v.textContent = '';
      v.appendChild(i);
      let done = false;
      const end = ok => {
        if (done) return;
        done = true;
        const t = i.value;
        i.remove();
        v.textContent = text();
        if (ok) { const x = parse(t); if (x !== null && fin(x)) commit(x); else this.notify('Could not read “' + t + '”'); }
        v.focus();
      };
      i.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); end(true); } else if (e.key === 'Escape') { e.preventDefault(); end(false); } });
      i.addEventListener('blur', () => end(true));
      i.addEventListener('pointerdown', e => e.stopPropagation());
      i.focus();
      if (i.select) i.select();
    };
    v.addEventListener('click', edit);
    v.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); edit(); } });
    return v;
  }
  // CURVE column: thumbnail of bend(·, MC_K·curve); drag vertically (200 px = −1…+1), double-click resets
  curveCell(slot) {
    const d = this.d, sv = svgEl(d, 'svg', { class: 'sx-crv', viewBox: '0 0 36 22', tabindex: '0', role: 'slider',
      'aria-label': 'Curve', 'aria-valuemin': '-100', 'aria-valuemax': '100' });
    const path = svgEl(d, 'path', { d: '' });
    sv.appendChild(path);
    const R = () => this.s().matrix[slot];
    let last = null, g = null;
    this.custom(() => {
      const c = R().curve;
      if (c === last) return;
      last = c;
      let dd = '';
      for (let j = 0; j <= 18; j++) { const t = j / 18; dd += (j ? 'L' : 'M') + (2 + 32 * t).toFixed(2) + ' ' + (20 - 18 * core.bend(t, MC_K * c)).toFixed(2); }
      path.setAttribute('d', dd);
      sv.setAttribute('aria-valuenow', String(Math.round(c * 100)));
    });
    const put = (c, ph) => this.edit(s => { s.matrix[slot].curve = Math.round(clamp(c, -1, 1) * 1e4) / 1e4; }, { label: 'Matrix curve', phase: ph });
    sv.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      g = { id: e.pointerId, y: e.clientY, c0: R().curve, acc: 0 };
      try { sv.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
      put(g.c0, 'start');
    });
    sv.addEventListener('pointermove', e => {
      if (!g || e.pointerId !== g.id) return;
      g.acc += (g.y - e.clientY) * (e.shiftKey ? 0.1 : 1) / 100;
      g.y = e.clientY;
      put(g.c0 + g.acc, 'move');
    });
    const up = e => { if (!g || e.pointerId !== g.id) return; const G = g; g = null; put(G.c0 + G.acc, 'end'); };
    sv.addEventListener('pointerup', up);
    sv.addEventListener('pointercancel', up);
    sv.addEventListener('dblclick', e => { e.preventDefault(); put(0, 'set'); });
    sv.addEventListener('keydown', e => {
      const k = e.key, c = R().curve;
      if (k === 'ArrowUp' || k === 'ArrowRight') { e.preventDefault(); put(c + (e.shiftKey ? 0.01 : 0.05), 'set'); }
      else if (k === 'ArrowDown' || k === 'ArrowLeft') { e.preventDefault(); put(c - (e.shiftKey ? 0.01 : 0.05), 'set'); }
      else if (k === 'Delete' || k === 'Backspace' || k === 'Home') { e.preventDefault(); put(0, 'set'); }
    });
    return sv;
  }
  rowMenu(slot, anchor) {
    const r = anchor.getBoundingClientRect(), s = this.s();
    const swap = (a, b) => this.edit(st => { const t = st.matrix[a]; st.matrix[a] = st.matrix[b]; st.matrix[b] = t; }, { label: 'Move modulation' });
    const items = [
      { label: 'Clear', action: () => this.edit(st => { st.matrix[slot] = emptyRow(); }, { label: 'Clear modulation' }) },
      { label: 'Duplicate', action: () => {
        const free = this.s().matrix.findIndex(x => !x.src);
        if (free < 0) { this.notify('Matrix full (32 slots)'); return; }
        this.edit(st => { st.matrix[free] = clone(st.matrix[slot]); }, { label: 'Duplicate modulation' });
      } },
    ];
    if (slot > 0) items.push({ label: 'Move Up', action: () => swap(slot, slot - 1) });
    if (slot < s.matrix.length - 1) items.push({ label: 'Move Down', action: () => swap(slot, slot + 1) });
    wk.contextMenu(r.left, r.bottom + 2, items, { anchor });
  }

  /* ================================================================ GLOBAL page (§9.7) */
  buildGlobal(el) {
    const d = this.d, grid = mk(d, 'div', 'sx-gl'), s0 = () => this.s();
    // OSCILLATORS
    const p1 = this.panel('OSCILLATORS');
    const os = this.pSeg({ label: 'Oversampling', items: ['1x', '2x', '4x'], get: () => [1, 2, 4].indexOf(s0().global.os),
      set: i => this.edit(s => { s.global.os = [1, 2, 4][i]; }, { label: 'Oversampling' }) });
    const osLock = this.pToggle({ label: 'LOCK', kind: 'btn', get: () => s0().locks.misc.os,
      set: v => this.edit(s => { s.locks.misc.os = v ? 1 : 0; }, { label: 'Lock oversampling' }) });
    osLock.el.title = 'Keep this oversampling when presets load';
    const rate = mk(d, 'span', 'sx-rate');
    this.custom(() => { const t = this.osText(); if (rate.textContent !== t) rate.textContent = t; });
    p1.body.append(this.row(this.dToggle('a.track', 'PITCH TRACK A', 'btn').el, this.dToggle('b.track', 'PITCH TRACK B', 'btn').el),
      this.row(this.dKnob('n.fine', 'NOISE FINE', { size: 'sm' }).el),
      this.row(mk(d, 'span', 'sx-txt', 'OVERSAMPLING'), os.el, osLock.el), this.row(rate));
    grid.appendChild(p1.el);
    // UNISON A / B
    for (const o of [0, 1]) {
      const P = o ? 'b' : 'a', p = this.panel('UNISON ' + (o ? 'B' : 'A'));
      const range = this.pNum({ label: 'RANGE', min: 0, max: 48, step: 0.01, def: 2, px: 240, get: () => s0().global.uniRange[o],
        fmt: v => v.toFixed(2) + ' st', parse: t => { const m = /^\s*(\d+(?:[.,]\d+)?)/.exec(String(t)); return m ? parseFloat(m[1].replace(',', '.')) : null; },
        set: (v, ph) => this.edit(s => { s.global.uniRange[o] = v; }, { label: 'Unison range ' + (o ? 'B' : 'A'), phase: ph }) });
      const tun = this.bind(wk.menu({ label: 'TUNING', items: () => UNI_MODES.map((m, i) => ({ v: i, label: m })), get: () => s0().global.uniMode[o],
        set: v => this.edit(s => { s.global.uniMode[o] = v; }, { label: 'Unison tuning ' + (o ? 'B' : 'A') }) }));
      p.body.append(this.row(range.el, this.dKnob(P + '.uniw', 'WIDTH', { size: 'sm' }).el, this.dKnob(P + '.uniwarp', 'WARP', { size: 'sm' }).el,
        this.dKnob(P + '.uniwt', 'WT POS', { size: 'sm' }).el),
      this.row(this.dMenu(P + '.stack', 'STACK', () => this.enumItems(P + '.stack', UNI_STACKS)).el, tun.el));
      grid.appendChild(p.el);
    }
    // CHAOS 1 / 2
    for (const c of [0, 1]) {
      const P = 'c' + (c + 1), p = this.panel('CHAOS ' + (c + 1));
      const sw = (label, k) => this.pToggle({ label, kind: 'btn', get: () => s0().chaos[c][k],
        set: v => this.edit(s => { s.chaos[c][k] = v ? 1 : 0; }, { label: 'Chaos ' + (c + 1) + ' ' + label.toLowerCase() }) }).el;
      p.body.append(this.row(this.dKnob(P + '.rate', 'RATE').el, this.dToggle(P + '.bpm', 'BPM', 'btn').el, sw('MONO', 'mono'), sw('S&H', 'sh')));
      grid.appendChild(p.el);
    }
    // TUNING & BEND
    const p4 = this.panel('TUNING & BEND');
    const a4 = this.pNum({ label: 'A4 (Hz)', min: 430, max: 450, step: 0.1, def: 440, get: () => s0().global.a4, fmt: v => v.toFixed(1),
      set: (v, ph) => this.edit(s => { s.global.a4 = v; }, { label: 'A4 reference', phase: ph }) });
    const a4Lock = this.pToggle({ label: 'LOCK', kind: 'btn', get: () => s0().locks.misc.tuning,
      set: v => this.edit(s => { s.locks.misc.tuning = v ? 1 : 0; }, { label: 'Lock tuning' }) });
    a4Lock.el.title = 'Keep this A4 when presets load';
    p4.body.append(this.row(a4.el, a4Lock.el), this.row(this.dNum('g.bendup', 'BEND UP').el, this.dNum('g.benddn', 'BEND DOWN').el));
    grid.appendChild(p4.el);
    // PREFERENCES
    grid.appendChild(this.prefsPanel());
    // INFO
    const p6 = this.panel('INFO');
    const au = mk(d, 'input'), no = mk(d, 'textarea');
    au.type = 'text'; au.maxLength = 64;
    no.maxLength = 2000;
    const la = mk(d, 'label', 'sx-txt', 'Author'), ln = mk(d, 'label', 'sx-txt', 'Notes');
    la.appendChild(au); ln.appendChild(no);
    au.addEventListener('change', () => this.edit(s => { s.author = au.value.slice(0, 64); }, { label: 'Author' }));
    no.addEventListener('change', () => this.edit(s => { s.notes = no.value.slice(0, 2000); }, { label: 'Notes' }));
    this.custom(() => {
      const s = s0();
      if (d.activeElement !== au && au.value !== s.author) au.value = s.author || '';
      if (d.activeElement !== no && no.value !== s.notes) no.value = s.notes || '';
    });
    p6.body.append(la, ln);
    grid.appendChild(p6.el);
    el.appendChild(grid);
  }
  // effective internal rate (§9.7, deviation 9): the processor's own rate from the snapshot (tapRate = proc.fs,
  // which already includes the device-rate cap and the CPU safeguard), else host.sampleRate (optional) × the cap
  osText() {
    const os = this.s().global.os, sn = this.snap, h = this.host.sampleRate, base = typeof h === 'function' ? +h() : +h;
    const kHz = r => 'Running at ' + (r >= 1000 ? +(r / 1000).toFixed(1) + ' kHz' : Math.round(r) + ' Hz');
    if (sn && sn.tapRate > 0) return kHz(sn.tapRate);
    if (!(base > 0)) return 'Runs at ' + os + '× the device rate (capped at 384 kHz)';
    const cap = Math.pow(2, Math.floor(Math.log2(384000 / base)));
    return kHz(base * Math.max(1, Math.min(os, cap)));
  }
  setPref(k, v) {
    const p = Object.assign({}, this.prefs);
    p[k] = v;
    this.prefs = normPrefs(p);
    this.store('set', PREFS_KEY, this.prefs);
    if (wk.setPrefs && (k === 'tooltips' || k === 'dblClick' || k === 'wheel')) wk.setPrefs({ [k]: this.prefs[k] });
    if (typeof this.host.prefsChanged === 'function') this.host.prefsChanged(Object.assign({}, this.prefs));
    this.queue();
  }
  prefsPanel() {
    const d = this.d, p = this.panel('PREFERENCES'), P = () => this.prefs;
    const line = (label, ctl) => { const r = mk(d, 'div', 'sx-pref'); r.append(mk(d, 'span', '', label), ctl); return r; };
    const opt = (label, k) => { const r = mk(d, 'div', 'sx-pref'), w = this.pToggle({ label, kind: 'led', get: () => P()[k], set: v => this.setPref(k, v ? 1 : 0) }); r.appendChild(w.el); return r; };
    const seg = (label, items, get, set) => this.pSeg({ label, items, get, set }).el;
    const author = mk(d, 'input');
    author.type = 'text'; author.maxLength = 64;
    author.setAttribute('aria-label', 'Default author name');
    author.addEventListener('change', () => this.setPref('author', author.value));
    this.custom(() => { if (d.activeElement !== author) author.value = P().author; });
    const smooth = this.pNum({ label: '', aria: 'Smoothing scale', min: 1, max: 800, step: 1, def: 100, px: 400, get: () => Math.round(P().smooth * 100),
      fmt: v => v + '%', set: (v, ph) => { if (ph !== 'start') this.setPref('smooth', v / 100); } });
    p.body.append(
      opt('Show tooltips', 'tooltips'),
      line('Double-click', seg('Double-click', ['Type value', 'Reset'], () => (P().dblClick === 'reset' ? 1 : 0), i => this.setPref('dblClick', i ? 'reset' : 'type'))),
      opt('Mouse wheel adjusts controls', 'wheel'),
      line('Default WT view', seg('Default WT view', ['2D', '3D'], () => P().view3d, i => this.setPref('view3d', i))),
      opt('Mod wheel → WT Pos while editor open', 'wheelWt'),
      opt('Limit mod depth on drop', 'limitDrop'),
      opt('Silence effect tails when transport stops', 'silenceTails'),
      line('Default oversampling', seg('Default oversampling', ['1x', '2x', '4x'], () => [1, 2, 4].indexOf(P().defOs), i => this.setPref('defOs', [1, 2, 4][i]))),
      line('Default author name', author),
      opt('Ask before preset change when edited', 'askPreset'),
      line('Smoothing scale', smooth.el));
    return p.el;
  }

  /* ---------------------------------------------------------------- destroy */
  destroy() {
    if (this.dead) return;
    this.dead = true;
    if (this.drag) this.dragDone(null);
    if (this.pop) this.pop.close();
    if (this.browser) this.browser.close();
    if (this.overlay) this.overlay.close();
    if (this.wtEd && this.wtEd.close) { try { this.wtEd.close(); } catch (err) { /* already closed */ } }
    for (const P of this.allPages()) for (const ed of P.editors) if (ed && ed.destroy) { try { ed.destroy(); } catch (err) { /* gone */ } }
    if (this.rack && this.rack.destroy) this.rack.destroy();
    if (this.ro) this.ro.disconnect();
    for (const f of this.offs) f();
    this.offs = [];
    clearTimeout(this.noticeT);
    if (this.host.monitor) this.host.monitor(false);
    this.el.remove();
  }
}

/* ================================================================ PresetBrowser (§9.10) */
// new PresetBrowser(container, host, { confirmLoad?: () => bool, modified?: () => bool, onLoad?: key => void,
//   notify?: text => void }); modified() = the sound differs from the current preset (choosing it again reloads it)
// Full-panel overlay (role=dialog) over `container`: category filter, search, Name / Category / Author columns
// (click sorts; again flips; ties → previously clicked column, then Name), user rows marked, ↑/↓ browse-to-
// audition, Enter / double-click load and close, Escape closes, Delete removes a user preset (confirm), row menu
// (Delete, Export…), Import…. State { sort, sort2, dir, cat, q } persists in host.storage BROWSER_KEY.
export class PresetBrowser {
  constructor(container, host, opts) {
    this.box = container;
    this.host = host || {};
    this.o = opts || {};
    this.d = (container && container.ownerDocument) || globalThis.document;
    this.st = normBrowser(this.load());
    this.ov = null;
    this.sel = null;
  }
  load() { const s = this.host.storage; try { return s && s.get ? s.get(BROWSER_KEY, null) : null; } catch (err) { return null; } }
  persist() { const s = this.host.storage; try { if (s && s.set) s.set(BROWSER_KEY, Object.assign({}, this.st)); } catch (err) { /* storage unavailable */ } }
  state() { return Object.assign({}, this.st); }
  all() { const p = this.host.presets; return p && p.list ? arr(p.list()) : []; }
  list() { return browserList(this.all(), this.st); }
  current() { const p = this.host.presets; const k = p && p.current ? p.current() : null; return k === undefined ? null : k; }
  isOpen() { return !!this.ov; }
  notify(t) { if (this.o.notify) this.o.notify(t); else if (this.host.notify) this.host.notify(t); }
  sortBy(col) {
    if (col === this.st.sort) this.st.dir = -this.st.dir;
    else { this.st.sort2 = this.st.sort; this.st.sort = col; this.st.dir = 1; }
    this.persist();
    this.render();
  }
  // Loads unless key is the current preset and nothing changed since it was loaded (opts.modified(): edits, Init
  // Preset), so choosing the current preset again reverts its edits (asking first per confirmLoad).
  loadKey(key, close) {
    const p = this.host.presets;
    if (!p || !p.load || key === null || key === undefined) return false;
    const load = key !== this.current() || !!(this.o.modified && this.o.modified());
    if (load && this.o.confirmLoad && !this.o.confirmLoad()) return false;
    if (load) { p.load(key); if (this.o.onLoad) this.o.onLoad(key); }
    this.sel = key;
    if (close) this.close(); else this.render();
    return true;
  }
  del(key) {
    const p = this.host.presets, it = this.all().find(x => x.key === key);
    if (!p || !p.del || !it || !it.user) return;
    if (!askConfirm(this.d, 'Delete preset “' + it.name + '”?')) return;
    const L = this.list(), i = L.findIndex(x => x.key === key);
    p.del(key);
    const L2 = this.list();
    this.sel = L2.length ? L2[Math.min(Math.max(0, i), L2.length - 1)].key : null;
    this.render();
  }
  importFile() {
    const p = this.host.presets;
    if (!p || !p.importFile) { this.notify('Preset import is not available'); return; }
    pickFile(this.d, '.json,application/json').then(f => (f ? p.importFile(f) : null)).then(k => {
      if (k === null || k === undefined) return;
      this.sel = k;
      this.render();
      this.notify('Preset imported');
    }, err => { console.warn(err); this.notify('Could not import that file'); });
  }
  rowMenu(key, x, y, anchor) {
    const p = this.host.presets, it = this.all().find(q => q.key === key);
    if (!it) return;
    const items = [{ label: 'Load', action: () => this.loadKey(key, true) }];
    if (p && p.exportFile) items.push({ label: 'Export…', action: () => p.exportFile(key) });
    if (it.user && p && p.del) items.push({ sep: true }, { label: 'Delete', action: () => this.del(key) });
    wk.contextMenu(x, y, items, { anchor });
  }
  open() {
    if (this.ov) { this.focusList(); return; }
    const d = this.d, ov = mk(d, 'div', 'sx-ov');
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', 'Preset browser');
    const root = mk(d, 'div', 'pb-root'), bar = mk(d, 'div', 'pb-bar');
    const cat = wk.menu({ label: '', arrows: true, items: () => [{ v: '', label: 'All categories' }].concat(presetCats(this.all()).map(c => ({ v: c, label: c }))),
      get: () => this.st.cat, set: v => { this.st.cat = v; this.persist(); this.render(); } });
    const q = mk(d, 'input', 'pb-q');
    q.type = 'search';
    q.placeholder = 'Search name or author';
    q.setAttribute('aria-label', 'Search presets');
    q.value = this.st.q;
    q.addEventListener('input', () => { this.st.q = q.value; this.persist(); this.render(); });
    q.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { e.preventDefault(); this.focusList(); } });
    const imp = btn(d, 'sx-btn', 'Import…', 'Import a preset file', () => this.importFile());
    const x = btn(d, 'sx-btn', '✕', 'Close preset browser', () => this.close());
    bar.append(cat.el, q, imp, x);
    const tbl = mk(d, 'div', 'pb-tbl'), hd = mk(d, 'div', 'pb-hd'), list = mk(d, 'div', 'pb-list');
    const cols = {};
    for (const [k, t] of [['name', 'Name'], ['cat', 'Category'], ['author', 'Author']]) {
      const b = btn(d, '', t, null, () => this.sortBy(k));
      b.setAttribute('aria-label', 'Sort by ' + t);
      cols[k] = b;
      hd.appendChild(b);
    }
    hd.appendChild(mk(d, 'span'));
    list.tabIndex = 0;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Presets');
    list.addEventListener('keydown', e => this.key(e));
    tbl.append(hd, list);
    root.append(bar, tbl);
    ov.appendChild(root);
    ov.addEventListener('keydown', e => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); this.close(); } });
    const prev = d.activeElement;
    this.ov = { el: ov, list, cols, cat, prev };
    this.sel = this.current();
    this.box.appendChild(ov);
    this.render();
    this.focusList();
  }
  close() {
    const O = this.ov;
    if (!O) return;
    this.ov = null;
    if (O.cat && O.cat.destroy) O.cat.destroy();
    O.el.remove();
    if (O.prev && O.prev.focus && O.prev.isConnected !== false) O.prev.focus();
  }
  focusList() { if (this.ov) this.ov.list.focus(); }
  key(e) {
    const L = this.list(), i = L.findIndex(p => p.key === this.sel), k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Home' || k === 'End' || k === 'PageDown' || k === 'PageUp') {
      e.preventDefault();
      if (!L.length) return;
      const j = k === 'Home' ? 0 : k === 'End' ? L.length - 1 : clamp((i < 0 ? (k === 'ArrowUp' ? L.length : -1) : i)
        + (k === 'ArrowDown' ? 1 : k === 'ArrowUp' ? -1 : k === 'PageDown' ? 10 : -10), 0, L.length - 1);
      this.loadKey(L[j].key, false);   // browse-to-audition
    } else if (k === 'Enter') { e.preventDefault(); if (i >= 0) this.loadKey(L[i].key, true); }
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); if (i >= 0) this.del(L[i].key); }
    else if (k === 'ContextMenu' || (k === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const row = i >= 0 && this.ov ? this.ov.rows[L[i].key] : null;
      if (row) { const r = row.getBoundingClientRect(); this.rowMenu(L[i].key, r.left + 20, r.bottom, row); }
    }
  }
  render() {
    const O = this.ov;
    if (!O) return;
    const d = this.d, L = this.list(), cur = this.current();
    O.cat.update();
    for (const k of SORT_COLS) O.cols[k].setAttribute('aria-sort', this.st.sort === k ? (this.st.dir > 0 ? 'ascending' : 'descending') : 'none');
    O.list.textContent = '';
    O.rows = {};
    if (!L.length) { O.list.appendChild(mk(d, 'div', 'pb-empty', 'No presets match')); O.list.removeAttribute('aria-activedescendant'); return; }
    let selEl = null;
    L.forEach((p, i) => {
      const r = mk(d, 'div', 'pb-row');
      r.id = 'pb-' + (++UID);
      r.setAttribute('role', 'option');
      const isSel = p.key === this.sel;
      r.setAttribute('aria-selected', isSel ? 'true' : 'false');
      if (p.key === cur) r.setAttribute('aria-current', 'true');
      const nm = mk(d, 'span', '', p.name || '(unnamed)');
      if (p.user) { const u = mk(d, 'span', 'pb-u', 'USER'); u.setAttribute('aria-label', 'user preset'); nm.appendChild(u); }
      const more = btn(d, 'pb-more', icon(d, 'more'), 'Preset menu', e => { e.stopPropagation(); const b = more.getBoundingClientRect(); this.rowMenu(p.key, b.left, b.bottom, more); });
      more.tabIndex = -1;
      r.append(nm, mk(d, 'span', '', p.cat || ''), mk(d, 'span', '', p.author || ''), more);
      r.addEventListener('click', () => { this.loadKey(p.key, false); this.focusList(); });
      r.addEventListener('dblclick', () => this.loadKey(p.key, true));
      r.addEventListener('contextmenu', e => { e.preventDefault(); this.rowMenu(p.key, e.clientX, e.clientY, r); });
      O.list.appendChild(r);
      O.rows[p.key] = r;
      if (isSel) selEl = r;
    });
    if (selEl) {
      O.list.setAttribute('aria-activedescendant', selEl.id);
      if (selEl.scrollIntoView) selEl.scrollIntoView({ block: 'nearest' });
    } else O.list.removeAttribute('aria-activedescendant');
  }
}
