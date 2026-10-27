// sx-ui-mod.js — Serum's own module panels, one implementation for every view (SYNTH Canvas milestone 3,
// docs/canvas/IMPL-3.md §2.2–2.3): the bundled panel's row C and GLOBAL page, a Serum's parts on the canvas and the canvas
// modulators' slot hosts all mount these classes — identical look and editing, the bundled ids, classes and CSS.
//   new XPanel(root, kit, args) → { el, power?, module?, menuItems(), destroy() }   (root: appended to when given)
//     MacrosPanel   Serum's MACROS 4 × 2 (knobs m1…m8, the name tiles: Serum's drag sources, or with kit.opts.tiles
//                   'jack' the canvas jacks k1…k8; rename ≤ kit.opts.nameMax)
//     EnvPanel(·, k)     ENV k (0…3) in a fixed slot; k undefined: the bundled ENV with its 1–4 tabs (s.ui.env)
//     LfoPanel(·, k)     LFO k (0…9) in a fixed slot (no VELO / NOTE area, H3); k undefined: the bundled editor (the
//                        selected LFO / VELO / NOTE); the PATH editor is built at the first Path type (H3), then kept
//     CurvePanel(·, which)   VELO / NOTE curve (VOICE's fold-outs; the bundled LFO panel's curve area: { shell: false })
//     VoicingPanel, ChaosRow(·, c) (one chaos source: RATE, BPM, MONO, S&H), VoiceHeader (preset ◀ name ▶, save, undo /
//     redo, menu, MASTER + meter, voices, render-last; args.lead: elements after the wave icon — the bundled logo and
//     tabs), OutputsPanel (sx-ui-mix: BUS 1 / BUS 2 / MAIN / DIRECT), QualityPanel, TuningPanel, MpePanel, VcPanel,
//     PrefsPanel, InfoPanel (the GLOBAL page's; VOICE's ⋯ dialogs: panelDialog), VoicePanel (VOICE: the header, VOICING
//     beside ENV 1, the outputs, the fold-outs)
//   PART_W           each panel's width in the 1200 px bundled Serum (the look the user compares with), layout px
//   PART_PH          each panel body's device-pixel phase there (look parity: a part's panel moved to it)
//   partView(part)   'oscB' → { kind: 'osc', k: 1 } … (serum-core MODULE_FIELDS names, 'macros', 'voice')
//   mountPart(host, part, root, args)   host.mount of a Serum part (args.bare default true: the canvas bar's chrome)
//   mountSlot(slotHost, root, args)     the panel of a canvas modulator's slot host (cv-mods-ui's bodies)
//   MONO_LOCK_TIP    (MM, IMPL-MM §7.2) the tip of a locked MONO switch: a slot host made with lock: { mono: 1 } (the master's
//                    modulators; it has no notes) shows an LFO's / a Chaos row's MONO lit, disabled, its tap ignored — but said:
//                    the kit's notice with the tip (MM UI fixer, review MM-2 P3-2: touch has no hover tip)
// The view kinds registered on sx-host (defineView): osc, sub, noise, filter, env, lfo, macros, voicing, chaos, curve,
// arp, clip, voice, quality, tuning, mpe, vc, outputs, header.
// Panels reach the host through the kit (kit.sx for the host services VOICE's header and the GLOBAL panels use).
//
// Browser ES module: nothing touches document / window / storage at module top level.
import * as core from './serum-core.js?v=9';
import * as wk from './wk.js?v=9';
import * as gx from './graph.js?v=9';
import * as osc from './sx-ui-osc.js?v=9';
import * as seq from './sx-ui-seq.js?v=9';
import * as mix from './sx-ui-mix.js?v=9';
import {
  defineView, mk, btn, icon, longPress, numField, segField, tidySeps, knobMenuItems, parseGrid, s1Diff, clamp, clamp01, fin, arr, isObj,
  destOf, snapN, s1On, ENV_ED, LFO_KNOBS, LFO_MODES, LFO_TYPES, LFO_TYPE_LABEL, LFO_DIRS, LFO_DIR_LABEL, LFO_TOOL_IDS,
  LFO_TOOL_LABEL, STEAL_LABEL, QUALITY, BUILD, N_ENV, N_MAC, VC_KEY, nowMs, clone, tagList,
} from './sx-host.js?v=9';

const { DESTS, DEST_INDEX, MODULE_FIELDS } = core;

/* ================================================================ sizes (IMPL-3 §2.2) */
// Each part's panel width in the 1200 px bundled Serum (measured once from that reference with every module on, frozen;
// the look-parity gate re-measures): row A's columns (SUB / NOISE, the three oscillators, the filters), row C's
// (MACROS / ENV / LFO / VOICING), the GLOBAL page's (QUALITY, TUNING, MPE, VOICE CONTROL, CHAOS), the ARP / CLIP pages
// (the page width); VOICE = VOICING + gap + ENV 1 (its layout below). Measured 2026-10-20 in Chrome (1200 px root: 1184 of
// content; row A 0.75 / 3.6 / 1 fr, row C 0.9 / 1.2 / 1.5 / 0.8 fr, the GLOBAL grid three columns), layout px; cv-module
// rounds them up to the 32 px grid (MOD_W). (Review 2: to the layout unit, 1/64 px — a panel 0.05 px narrower than its
// bundled self lays its text out at other fractions.)
export const PART_W = Object.freeze({
  osc: 256.65625, sub: 163.734375, noise: 163.734375, filter: 218.328125, macros: 237.265625, env: 316.375, lfo: 395.453125, voicing: 210.90625,
  curve: 395.5, chaos: 389.34375, quality: 389.3, tuning: 389.3, mpe: 389.3, vc: 389.3, arp: 1184, clip: 1184, voice: 535.28125, outputs: 535.28125,
});
// (review 2, look parity) each panel BODY's device-pixel phase in the 1200 px bundled Serum: its world offset mod 1 layout px
// [x, y] (the bundled module stands on the dots; Chrome, measured with PART_W — OSC B's column at .390625, row C at y
// .765625 …). The world layer rasters text at each element's own fractional origin, so a part's or a canvas modulator's
// panel is moved (< 1 px, relative: sx-host alignPhase) to the same phase — its text then rasters as in the whole panel.
// VOICE: its VOICING and ENV 1 apart. Parts without an entry stay as laid out.
export const PART_PH = Object.freeze({
  oscA: [0.734375, 0], oscB: [0.390625, 0], oscC: [0.03125, 0], sub: [0, 0], noise: [0, 0.390625], filter: [0.6875, 0],
  macros: [0, 0.765625], env: [0.265625, 0.765625], lfo: [0.640625, 0.765625], voicing: [0.09375, 0.765625], chaos: [0.328125, 0.078125],
});
// a view's phase spec (sx-host mount args.phase): [[selector ('' = the view's panel), x, y]]
function phaseOf(part, kind) {
  if (kind === 'voice') return [['.sx-vrow > section.sx-panel:nth-child(1)', ...PART_PH.voicing], ['.sx-vrow > section.sx-panel:nth-child(2)', ...PART_PH.env]];
  const P = PART_PH[part] || PART_PH[kind];
  return P ? [['', ...P]] : null;
}
// the bundled column a part comes from (the part root's data-col: the 1200 px rules restated for it, .sx-part[data-col])
const COL = { osc: 'O', sub: 'SN', noise: 'SN', filter: 'F', macros: 'C', env: 'C', lfo: 'C', voicing: 'C', curve: 'C', voice: 'C',
  chaos: 'GL', quality: 'GL', tuning: 'GL', mpe: 'GL', vc: 'GL', outputs: 'C', arp: 'P', clip: 'P' };

/* ================================================================ small helpers */
const pToggle = (K, o) => K.bind(wk.toggle(Object.assign({ kind: 'led' }, o)));
/** (MM, IMPL-MM §7.2) The tip of a MONO switch locked on by its slot host (sx-host slotHost o.lock.mono → kit.opts.monoLock). */
export const MONO_LOCK_TIP = 'The master’s modulators are global (it has no notes)';
// ((MM UI fixer, review MM-2 P3-2) a locked MONO: its tip, and a tap says it (touch has no hover tip) — the kit's notice
const monoSay = (K, el) => { el.title = MONO_LOCK_TIP; el.addEventListener('click', e => { if (!e.defaultPrevented) K.notify(MONO_LOCK_TIP); }); };
const pSeg = (K, o) => K.bind(segField(K.doc, o));
const pNum = (K, o) => K.bind(numField(K.doc, o));
const row = (d, ...els) => { const r = mk(d, 'div', 'sx-krow'); r.append(...els.filter(Boolean)); return r; };
const uiEdit = (K, fn, o) => K.edit(fn, Object.assign({ label: 'View', ui: true }, o));
const redraw = K => { if (K.sx) K.sx.edDirty = true; K.queue(); };
const opt = (K, k, d) => { const O = K.opts; return O && O[k] !== undefined ? O[k] : d; };
const prefLine = (d, ctl, note) => { const r = mk(d, 'div', 'sx-pref'); r.appendChild(ctl); if (note) r.appendChild(mk(d, 'span', '', note)); return r; };
const enumItems = (id, labels) => { const d = destOf(id), hi = d ? (d.law === 'int' ? d.hi - d.lo : d.law === 'enum' ? d.hi : 1) : 1; return labels.map((label, k) => ({ v: k / hi, label })); };
// the shell object a view hands the host (View.power / menuItems / labelDrag): from a panel and its kit.panel shell
const asView = (p, shell, extra) => Object.assign({ el: p.el, panel: p, power: shell && shell.power ? shell.power : null, module: shell && shell.module ? shell.module : null,
  menuItems: () => (shell && typeof shell.menuItems === 'function' ? arr(shell.menuItems()) : []), destroy: () => { if (p && typeof p.destroy === 'function') p.destroy(); else if (p && p.el) p.el.remove(); } }, extra);

/* ================================================================ MACROS 1–8 (inv B17) */
// knob = destination m1…m8 (a macro tile dropped on it adds macroA → mB; its base is s.macros[k].v), tile = source (drag;
// dropped on another macro's label swaps the two macros) — or, with kit.opts.tiles 'jack', the macro's canvas jack; the
// knob menu adds Rename… and the Phase-1 MIDI learn target `macroN`
export class MacrosPanel {
  constructor(root, kit, args) {
    const K = this.kit = kit, d = K.doc, A = isObj(args) ? args : {};
    const shell = K.panel('MACROS', null, null, '', A.bare !== undefined ? { bare: A.bare } : undefined), grid = mk(d, 'div', 'sx-macros');
    this.shell = shell;
    this.knobs = [];   // (the knob elements m1…m8)
    for (let m = 0; m < N_MAC; m++) {
      const box = mk(d, 'div', 'sx-macro'), id = 'macro' + (m + 1), did = 'm' + (m + 1);
      const name = () => (K.s().macros[m] && K.s().macros[m].name) || 'Macro ' + (m + 1);
      const k = K.knob(did, { label: '', size: 'md', labelFn: name });
      this.knobs.push(k.el);
      const lab = k.el.querySelector ? k.el.querySelector('.wk-lab') : null;
      if (lab) lab.style.display = 'none';
      k.el.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); this.menu(m, e.clientX, e.clientY, k); });
      const tile = K.tile(id, name);
      tile.addEventListener('dblclick', e => { e.preventDefault(); this.rename(m, box, tile); });
      tile.addEventListener('keydown', e => { if (e.key === 'F2') { e.preventDefault(); this.rename(m, box, tile); } });
      box.append(k.el, tile);
      grid.appendChild(box);
    }
    shell.body.appendChild(grid);
    this.el = shell.el;
    if (root) root.appendChild(this.el);
  }
  nameMax() { return Math.max(1, opt(this.kit, 'nameMax', 24) | 0); }
  // the knob's menu: Rename…, then Serum's knob menu (a slot host: Reset / Enter Value only — no mod, learn or lock)
  menu(m, x, y, k) {
    const K = this.kit, H = K.sx, did = 'm' + (m + 1), id = 'macro' + (m + 1), s = K.s(), O = K.opts || {};
    let items = H ? knobMenuItems(s, K.fx(), did, { midi: typeof H.host.midiLearn === 'function' && O.learn !== false && !O.nomod, recent: H.recentSlot.get(did) })
      .filter(it => it.kind !== 'lock' && it.kind !== 'unlock') : [];
    if (O.nomod) items = tidySeps(items.filter(it => ['reset', 'enter', 'sep', 'midiLearn', 'midiForget'].includes(it.kind)));
    const max = this.nameMax();
    const acts = [{ label: 'Rename…', action: () => K.prompt('Rename Macro', 'Name', s.macros[m].name, t => {
      const v = String(t).trim().slice(0, max) || 'Macro ' + (m + 1);
      K.edit(st => { st.macros[m].name = v; }, { label: 'Rename macro' });
      return true;
    }) }].concat(H && items.length ? [{ sep: true }].concat(H.menuActions(items, did, k.el, null, id)) : []);
    wk.contextMenu(x, y, acts, { anchor: k.el });
  }
  rename(m, box, tile) {
    const K = this.kit, d = K.doc, i = mk(d, 'input'), max = this.nameMax();
    i.type = 'text'; i.maxLength = max; i.value = K.s().macros[m].name;
    i.setAttribute('aria-label', 'Macro ' + (m + 1) + ' name');
    tile.classList.add('sx-hidden');
    box.appendChild(i);
    let done = false;
    const end = ok => {
      if (done) return;
      done = true;
      const v = i.value.trim().slice(0, max);
      i.remove();
      tile.classList.remove('sx-hidden');
      if (ok) K.edit(s => { s.macros[m].name = v || 'Macro ' + (m + 1); }, { label: 'Rename macro' });
      tile.focus();
    };
    i.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); end(true); } else if (e.key === 'Escape') { e.preventDefault(); end(false); } });
    i.addEventListener('blur', () => end(true));
    i.focus();
    if (i.select) i.select();
  }
  menuItems() { return []; }
  destroy() { this.el.remove(); }
}

/* ================================================================ ENV 1–4 (inv B15, §13.13) */
// ENV_LADDER at the current tempo (seconds), for the BPM-unit editor steps (§6.14)
export function envLadderSec(K) {
  const spb = 60 / K.bpm();
  return arr(core.ENV_LADDER).map(e => (isObj(e) ? e.beats : +e) * spb).filter(fin);
}
// seconds of an envelope time destination: BPM units read the ladder (ENV_LADDER[round(n·15)] beats at the tempo)
export function envSec(K, k, key) {
  const id = 'e' + (k + 1) + '.' + key, n = K.getN(id), E = K.s().env[k] || {};
  if (E.bpm && (key === 'att' || key === 'hold' || key === 'dec' || key === 'rel')) {
    const L = envLadderSec(K);
    return L.length ? L[clamp(Math.round(n * (L.length - 1)), 0, L.length - 1)] : 0;
  }
  return core.lawValue(id, n);
}
export function envVals(K, k) {
  const P = 'e' + (k + 1) + '.', g = x => K.getN(P + x);
  const v = { a: envSec(K, k, 'att'), h: envSec(K, k, 'hold'), d: envSec(K, k, 'dec'), s: core.lawValue(P + 'sus', g('sus')),
    r: envSec(K, k, 'rel'), ca: g('ca'), cd: g('cd'), cr: g('cr') };
  if (k > 0 && destOf(P + 'start')) { v.st = g('start'); v.en = g('end'); }
  return v;
}
// n of a time in seconds: BPM units → the nearest ladder entry (log distance), else the time law
function envN(K, k, key, sec) {
  const id = 'e' + (k + 1) + '.' + key, E = K.s().env[k] || {};
  if (E.bpm && (key === 'att' || key === 'hold' || key === 'dec' || key === 'rel')) {
    const L = envLadderSec(K);
    let best = 0, bd = Infinity;
    L.forEach((t, i) => { const dd = sec > 0 && t > 0 ? Math.abs(Math.log(t / sec)) : Math.abs(t - sec) * 1e3; if (dd < bd) { bd = dd; best = i; } });
    return L.length > 1 ? best / (L.length - 1) : 0;
  }
  return core.lawNorm(id, sec);
}
function setEnv(K, k, patch, ph) {
  const P = 'e' + (k + 1) + '.';
  K.edit(s => {
    for (const key of Object.keys(patch || {})) {
      const f = ENV_ED[key], v = patch[key];
      if (!f || !fin(v)) continue;
      const id = P + f;
      if (!destOf(id)) continue;
      const n = f === 'ca' || f === 'cd' || f === 'cr' || f === 'start' || f === 'end' ? clamp01(v) : f === 'sus' ? core.lawNorm(id, v) : envN(K, k, f, v);
      s.p[id] = snapN(id, n);
    }
  }, { label: 'Env ' + (k + 1), phase: ph || 'set' });
}
// MS ↔ BPM units: the times convert to the nearest entry at the current tempo (§6.14, inv B15)
function setEnvBpm(K, k, on) {
  const keys = ['att', 'hold', 'dec', 'rel'], secs = keys.map(x => envSec(K, k, x));
  K.edit(s => {
    s.env[k].bpm = on ? 1 : 0;
    keys.forEach((x, i) => { const id = 'e' + (k + 1) + '.' + x; s.p[id] = snapN(id, envN(K, k, x, secs[i])); });
  }, { label: 'Env ' + (k + 1) + ' units' });
}
export class EnvPanel {
  // k: a fixed slot 0…3 (no tabs; the title 'ENV k+1' unless bare), undefined: the bundled ENV (tabs 1–4 → s.ui.env)
  constructor(root, kit, k, args) {
    const K = this.kit = kit, d = K.doc, A = isObj(args) ? args : {}, fixed = fin(k), H = K.sx;
    this.fixed = fixed;
    this.k = fixed ? clamp(k | 0, 0, N_ENV - 1) : -1;
    const shell = K.panel(fixed ? 'ENV ' + (this.k + 1) : 'ENV', null, null, '', A.bare !== undefined ? { bare: A.bare } : undefined), { el, head, body, name } = shell;
    this.shell = shell;
    const E = this.E = () => (fixed ? this.k : clamp(K.s().ui.env | 0, 0, N_ENV - 1)), id = x => () => 'e' + (E() + 1) + '.' + x;
    if (name) name.textContent = fixed ? 'ENV ' + (this.k + 1) : 'ENV';
    let tabs = null;
    if (!fixed) {
      tabs = mk(d, 'div', 'sx-etabs');
      tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', 'Envelope');
      const tb = [];
      for (let e = 0; e < N_ENV; e++) {
        const b = btn(d, '', String(e + 1), 'ENV ' + (e + 1), () => K.selectSrc('env' + (e + 1)));
        b.setAttribute('role', 'tab');
        // right-click / long-press: Bypass / Remove All Destinations of this envelope (inv B15)
        b.addEventListener('contextmenu', ev => { ev.preventDefault(); ev.stopPropagation(); K.srcMenu('env' + (e + 1), ev.clientX, ev.clientY, b); });
        if (H) H.touchMenu(b);
        tb.push(b);
        tabs.appendChild(b);
      }
      K.custom(() => { const k0 = E(); tb.forEach((b, e) => b.setAttribute('aria-selected', e === k0 ? 'true' : 'false')); });
    }
    const bpm = pToggle(K, { label: 'BPM', kind: 'btn', get: () => (K.s().env[E()] || {}).bpm ? 1 : 0, set: v => setEnvBpm(K, E(), v) });
    bpm.el.title = 'Time units: milliseconds or beats (BPM)';
    const lock = pToggle(K, { label: 'LOCK', kind: 'btn', get: () => K.s().ui.envLock, set: v => uiEdit(K, s => { s.ui.envLock = v ? 1 : 0; }) });
    lock.el.title = 'Lock: fit the whole envelope';
    const zoom = mk(d, 'input', 'sx-zoom');
    zoom.type = 'range'; zoom.min = '0'; zoom.max = '1'; zoom.step = '0.001';
    zoom.setAttribute('aria-label', 'Envelope zoom');
    const zOf = u => 0.01 * Math.pow(6400, u), uOf = z => Math.log(clamp(z, 0.01, 64) / 0.01) / Math.log(6400);
    zoom.addEventListener('input', () => uiEdit(K, s => { s.ui.envZoom = Math.round(zOf(+zoom.value) * 1000) / 1000; }));
    K.custom(() => { const s = K.s(); zoom.disabled = !!s.ui.envLock; if (d.activeElement !== zoom) zoom.value = String(uOf(s.ui.envZoom)); });
    const more = btn(d, 'sx-hbtn', icon(d, 'more'), 'Envelope menu', () => { const r = more.getBoundingClientRect(); wk.contextMenu(r.left, r.bottom + 2, this.menuItems(true), { anchor: more }); });
    more.setAttribute('aria-haspopup', 'menu');
    if (tabs) head.append(tabs);
    head.append(mk(d, 'span', 'sx-grow'), bpm.el, lock.el, zoom, more);
    const box = mk(d, 'div', 'sx-edbox');
    body.appendChild(box);
    const ghosts = opt(K, 'ghosts', true);
    if (typeof gx.EnvEditor === 'function') {
      const ed = new gx.EnvEditor(box, {
        env: () => envVals(K, E()),
        set: (patch, ph) => setEnv(K, E(), patch, ph),
        ghosts: () => (ghosts ? [0, 1, 2, 3].filter(k0 => k0 !== E() && (k0 === 0 || K.srcUsed('env' + (k0 + 1)))).map(k0 => envVals(K, k0)) : []),
        lock: () => !!K.s().ui.envLock,
        zoom: () => K.s().ui.envZoom,
        startEnd: () => E() > 0,
        grid: () => ({ beats: K.s().ui.envGrid ? 1 : 0, spb: 60 / K.bpm() }),
        steps: () => ((K.s().env[E()] || {}).bpm ? envLadderSec(K) : null),
        playhead: () => { const sn = K.snap(), k0 = E(); return sn && sn.envStage && sn.envStage[k0] ? { stage: sn.envStage[k0], t: sn.envT ? sn.envT[k0] : 0 } : null; },
      });
      K.editor(ed, () => {
        const s = K.s();
        return JSON.stringify([E(), ghosts ? [0, 1, 2, 3].map(k0 => envVals(K, k0)) : envVals(K, E()), s.ui.envLock, s.ui.envZoom, s.ui.envGrid, arr(s.env).map(x => x && x.bpm), K.bpm(),
          ghosts && K.srcUsed('env2'), ghosts && K.srcUsed('env3'), ghosts && K.srcUsed('env4')]);
      });
      this.ed = ed;
    } else box.appendChild(mk(d, 'p', 'sx-txt', 'Envelope editor unavailable'));
    const kn = (x, label) => K.knob(id(x), { label, size: 'sm' }).el;
    body.appendChild(row(d, kn('att', 'ATTACK'), kn('hold', 'HOLD'), kn('dec', 'DECAY'), kn('sus', 'SUSTAIN'), kn('rel', 'RELEASE')));
    // the curve handles are destinations too (§3.13): small knobs give them data-dest (lock, MIDI learn, drops);
    // ENV 2–4 add the Start / End levels (§6.14)
    const se = x => () => 'e' + Math.max(2, E() + 1) + '.' + x;
    const st = K.knob(se('start'), { label: 'START', size: 'sm' }), en = K.knob(se('end'), { label: 'END', size: 'sm' });
    K.custom(() => { const on1 = E() === 0; st.el.classList.toggle('sx-hidden', on1); en.el.classList.toggle('sx-hidden', on1); });
    const cur = row(d, kn('ca', 'A CURVE'), kn('cd', 'D CURVE'), kn('cr', 'R CURVE'), st.el, en.el);
    cur.classList.add('sx-envcurves');
    body.appendChild(cur);
    this.el = el;
    if (root) root.appendChild(el);
  }
  // the ⋯ menu (Legato Inverted, Grid ▸, Voice Steal Retrigger, Lock Module); for the canvas bar also the envelope's
  // Bypass / Remove All Destinations (its tab's right-click menu in the bundled panel)
  menuItems(own) {
    const K = this.kit, s = K.s(), k = this.E(), E = s.env[k] || {}, m = 'env' + (k + 1);
    const sw = (label, key) => ({ label, checked: !!E[key], action: () => K.edit(st => { st.env[k][key] = st.env[k][key] ? 0 : 1; }, { label: 'Env ' + (k + 1) + ' ' + label }) });
    const items = [
      sw('Legato Inverted', 'legInv'),
      { label: 'Grid', sub: [{ label: 'Time', checked: !s.ui.envGrid, action: () => uiEdit(K, st => { st.ui.envGrid = 0; }) },
        { label: 'Beats', checked: !!s.ui.envGrid, action: () => uiEdit(K, st => { st.ui.envGrid = 1; }) }] },
      sw('Voice Steal Retrigger', 'stealRe'),
    ];
    if (opt(K, 'lock', true)) items.push({ sep: true }, { label: 'Lock Module', checked: arr(s.locks.mod).includes(m), action: () => K.lockModule(m) });
    if (!own && K.sx) { const more = K.sx.srcDestItems(m); if (more.length) items.push({ sep: true }, ...more); }
    return items;
  }
  destroy() { if (this.ed && this.ed.destroy) this.ed.destroy(); this.el.remove(); }
}

/* ================================================================ LFO 1–10 / VELO / NOTE (inv B16, §13.13) */
// VELO / NOTE curve (s.velo / s.note: pts, porta): the curve editor and FOLLOW PORTAMENTO / LEGATO. which: 'velo' | 'note'
// or () => one of them (the bundled LFO panel's area follows the selected source). args.shell false: the area only
export class CurvePanel {
  constructor(root, kit, which, args) {
    const K = this.kit = kit, d = K.doc, A = isObj(args) ? args : {}, cv = typeof which === 'function' ? which : () => (which === 'note' ? 'note' : 'velo');
    const area = mk(d, 'div', 'sx-pbody'), cb = mk(d, 'div', 'sx-edbox');
    if (typeof gx.CurveEditor === 'function') {
      const ed = new gx.CurveEditor(cb, {
        get: () => K.s()[cv()].pts,
        set: (pts, ph) => K.edit(s => { s[cv()].pts = pts; }, { label: cv() === 'note' ? 'Note curve' : 'Velocity curve', phase: ph || 'set' }),
        grid: () => { const g = K.s().lfoGrid; return { x: g.x, y: g.y }; },
        kind: 'curve', shapes: K.shapes(), height: 160,
      });
      K.editor(ed, () => JSON.stringify([cv(), K.s()[cv()].pts, K.s().lfoGrid]));
      this.ed = ed;
    }
    const follow = pToggle(K, { label: 'FOLLOW PORTAMENTO / LEGATO', kind: 'btn', get: () => K.s()[cv()].porta,
      set: v => K.edit(s => { s[cv()].porta = v ? 1 : 0; }, { label: 'Follow portamento' }) });
    area.append(cb, row(d, follow.el));
    this.area = area;
    if (A.shell === false) this.el = area;
    else {
      const t = typeof which === 'function' ? 'CURVE' : which === 'note' ? 'NOTE' : 'VELO', shell = K.panel(t, null, null, '', A.bare !== undefined ? { bare: A.bare } : undefined);
      this.shell = shell;
      shell.body.appendChild(area);
      this.el = shell.el;
    }
    if (root) root.appendChild(this.el);
  }
  menuItems() { return []; }
  destroy() { if (this.ed && this.ed.destroy) this.ed.destroy(); this.el.remove(); }
}
export class LfoPanel {
  // k: a fixed LFO 0…9 (its own module: no VELO / NOTE area); undefined: the bundled editor (the selected LFO, VELO, NOTE)
  constructor(root, kit, k, args) {
    const K = this.kit = kit, d = K.doc, A = isObj(args) ? args : {}, H = K.sx, P = K.page, fixed = fin(k);
    this.fixed = fixed;
    this.k = fixed ? clamp(k | 0, 0, 9) : -1;
    const shell = K.panel('LFO ' + (fixed ? this.k + 1 : 1), null, null, '', A.bare !== undefined ? { bare: A.bare } : undefined), { el, body, name } = shell;
    this.shell = shell;
    const edSel = () => (H ? H.edSel : 'lfo1');
    const L = this.L = () => (fixed ? this.k : H ? H.lfoIdx() : 0), lf = () => K.s().lfo[L()];
    const isCurve = () => !fixed && (edSel() === 'velo' || edSel() === 'note'), isPath = () => !isCurve() && lf().type === 'path';
    // the title is the module menu of the module shown (LFO n / VELO / NOTE; inv B16, B17): Lock Module, Init Module,
    // Copy, Copy (w/mods), Paste, Swap with ▸ — right-click, long-press or Enter; Copy / Paste between LFOs are the
    // menu equivalent of the LFO tiles' Alt-drag (§13.1). Bare: the canvas bar's ⋯ (menuItems)
    const modOf = this.modOf = () => (isCurve() ? edSel() : 'lfo' + (L() + 1));
    if (name) {
      name.tabIndex = 0;
      name.setAttribute('role', 'button');
      name.setAttribute('aria-haspopup', 'menu');
      const openMenu = (x, y) => K.moduleMenu(modOf(), x, y, name, () => (H ? H.srcDestItems(modOf()) : []));
      name.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); openMenu(e.clientX, e.clientY); });
      name.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
          e.preventDefault();
          const r = name.getBoundingClientRect();
          openMenu(r.left, r.bottom + 2);
        }
      });
      longPress(name, openMenu);
    }
    K.custom(() => {
      if (name) {
        const t = isCurve() ? edSel().toUpperCase() : 'LFO ' + (L() + 1);
        if (name.textContent !== t) name.textContent = t;
        const al = t + ' module menu (lock, init, copy, paste' + (isCurve() ? ')' : ', swap)');
        if (name.getAttribute('aria-label') !== al) name.setAttribute('aria-label', al);
      }
      el.classList.toggle('sx-locked', arr(K.s().locks.mod).includes(modOf()));
    });
    const lfoEd = (fn, label) => K.edit(s => fn(s.lfo[L()]), { label: 'LFO ' + (L() + 1) + ' ' + label });
    // LFO controls
    const lfoHead = mk(d, 'div', 'sx-edhead'), lfoHead2 = mk(d, 'div', 'sx-edhead'), lfoArea = mk(d, 'div', 'sx-pbody');
    const type = K.bind(wk.menu({ label: 'TYPE', arrows: true, items: () => LFO_TYPES.map(t => ({ v: t, label: LFO_TYPE_LABEL[t] || t })),
      get: () => lf().type || 'normal', set: v => { lfoEd(o => { o.type = v; }, 'type'); redraw(K); } }));
    const mode = pSeg(K, { label: 'LFO mode', items: ['FREE', 'RETRIG', 'ENV'], get: () => Math.max(0, LFO_MODES.indexOf(lf().mode)),
      set: i => lfoEd(o => { o.mode = LFO_MODES[i]; }, 'mode') });
    const monoLock = !!opt(K, 'monoLock', false);   // (MM) a slot host on the master: no notes, so GLOBAL for good — MONO lit, disabled, the tap ignored
    const sw = (label, key, dis, title) => {
      const lk = monoLock && key === 'mono';
      const w = pToggle(K, { label, kind: 'btn', get: lk ? () => 1 : () => lf()[key], disabled: lk ? () => true : dis,
        set: v => { if (lk) return; lfoEd(o => { o[key] = v ? 1 : 0; }, label.toLowerCase()); } });
      if (lk) monoSay(K, w.el); else if (title) w.el.title = title;
      return w.el;
    };
    const noBpm = () => !lf().bpm;
    const dir = K.bind(wk.menu({ label: 'DIRECTION', arrows: true, items: () => LFO_DIRS.map((x, i) => ({ v: x, label: LFO_DIR_LABEL[i] })),
      get: () => lf().dir || 'fwd', set: v => lfoEd(o => { o.dir = v; }, 'direction') }));
    const grid = mk(d, 'input', 'sx-grid');
    grid.type = 'text';
    grid.setAttribute('aria-label', 'LFO grid: x or x,y (1–64)');
    grid.title = 'Grid (x or x,y), global to all LFOs';
    const commit = () => {
      const gg = parseGrid(grid.value);
      grid.classList.toggle('sx-bad', !gg);
      if (gg) { const c = K.s().lfoGrid; if (gg.x !== c.x || gg.y !== c.y) K.edit(s => { s.lfoGrid = gg; }, { label: 'LFO grid' }); redraw(K); }
    };
    grid.addEventListener('change', commit);
    grid.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
    K.custom(() => { if (d.activeElement !== grid) { const g = K.s().lfoGrid; grid.value = g.x === g.y ? String(g.x) : g.x + ',' + g.y; grid.classList.remove('sx-bad'); } });
    const folder = btn(d, 'sx-hbtn', icon(d, 'folder'), 'LFO shapes', () => { if (H) H.lfoFolderMenu(folder, fixed ? this.k : undefined); });
    const big = btn(d, 'sx-hbtn', icon(d, 'zoom'), 'LFO Editor (large)', () => { if (H) H.openLfoEditor(fixed ? this.k : undefined); });
    const tools = pSeg(K, { label: 'Drawing tool', items: LFO_TOOL_LABEL, get: () => Math.max(0, LFO_TOOL_IDS.indexOf(K.uiState.lfoTool)),
      disabled: isPath, set: i => { if (H) H.setLfoTool(LFO_TOOL_IDS[i]); } });
    lfoHead.append(type.el, mode.el, sw('MONO', 'mono', null, 'MONO: one LFO for every voice'), dir.el);
    lfoHead2.append(sw('BPM', 'bpm'), sw('DOT', 'dot', noBpm), sw('TRIP', 'trip', noBpm), sw('HOST', 'anchor', null, 'HOST: follow the song position'),
      grid, tools.el, folder, big);
    const box = mk(d, 'div', 'sx-edbox'), pbox = mk(d, 'div', 'sx-edbox');
    P.lfoBox = box;
    P.lfoIdx = L;
    P.lfoOn = () => !isCurve();
    lfoArea.append(lfoHead, lfoHead2, box, pbox);
    if (typeof gx.CurveEditor === 'function' && H) {
      const ed = new gx.CurveEditor(box, H.lfoEditorOpts(L, 160));
      P.lfoEd = ed;
      if (typeof ed.setTool === 'function') ed.setTool(K.uiState.lfoTool);
      K.editor(ed, () => { const o = lf(), g = K.s().lfoGrid; return JSON.stringify([L(), o.pts, o.loop, o.start, o.mode, o.type, g.x, g.y, K.uiState.lfoTool]); });
      this.ed = ed;
    } else box.appendChild(mk(d, 'p', 'sx-txt', 'LFO editor unavailable'));
    // H3: the PATH editor is built the first time this panel shows a Path-type LFO (then kept): two canvases, not on every LFO
    this.ped = null;
    const pathEd = () => {
      if (this.ped || typeof gx.PathEditor !== 'function') return;
      K.under(P, () => {
        const ped = new gx.PathEditor(pbox, {
          get: () => lf().path,
          set: (path, ph) => K.edit(s => { s.lfo[L()].path = path; }, { label: 'LFO ' + (L() + 1) + ' path', phase: ph || 'set' }),
          grid: () => { const g = K.s().lfoGrid; return { x: g.x, y: g.y }; },
          height: 160,
          playhead: () => { const sn = K.snap(), l = L(); return sn && sn.lfoOut && sn.lfoY && fin(sn.lfoOut[l]) ? [sn.lfoOut[l], sn.lfoY[l]] : null; },
        });
        K.editor(ped, () => JSON.stringify([L(), lf().path, K.s().lfoGrid]));
        this.ped = ped;
      });
    };
    const lid = x => () => 'l' + (L() + 1) + '.' + x;
    const knobs = LFO_KNOBS.map(([x, t]) => K.knob(lid(x), { label: t, size: 'sm' }).el);
    if (destOf('l1.phase')) knobs.push(K.knob(lid('phase'), { label: 'PHASE', size: 'sm' }).el);
    lfoArea.appendChild(row(d, ...knobs));
    // VELO / NOTE curve (the bundled editor only; a Serum's parts show them in VOICE's fold-outs)
    const curve = fixed ? null : new CurvePanel(null, K, () => (edSel() === 'note' ? 'note' : 'velo'), { shell: false });
    this.curve = curve;
    let shown = null;
    K.custom(() => {
      const c = isCurve(), pth = isPath();
      if (pth) pathEd();
      lfoArea.classList.toggle('sx-hidden', c);
      if (curve) curve.el.classList.toggle('sx-hidden', !c);
      box.classList.toggle('sx-hidden', pth);
      pbox.classList.toggle('sx-hidden', !pth);
      const key = c ? edSel() : 'lfo' + L() + (pth ? 'p' : '');
      if (key !== shown) { shown = key; redraw(K); }
    });
    body.append(lfoArea);
    if (curve) body.append(curve.el);
    this.el = el;
    if (root) root.appendChild(el);
  }
  // the module menu for the canvas bar ⋯: Serum's (Init / Copy / Paste …) and the source's Bypass / Remove All Destinations
  menuItems() {
    const H = this.kit.sx;
    return H ? H.moduleMenuActs(this.modOf(), null, () => H.srcDestItems(this.modOf())) : [];
  }
  destroy() {
    for (const e of [this.ed, this.ped]) if (e && e.destroy) e.destroy();
    if (this.curve) this.curve.destroy();
    this.el.remove();
  }
}

/* ================================================================ VOICING (inv A17, B19; §13.13) */
export class VoicingPanel {
  constructor(root, kit, args) {
    const K = this.kit = kit, d = K.doc, A = isObj(args) ? args : {}, shell = K.panel('VOICING', null, null, '', A.bare !== undefined ? { bare: A.bare } : undefined), { el, body } = shell, v = () => K.s().voicing;
    this.shell = shell;
    const tg = (label, k, title) => {
      const w = pToggle(K, { label, kind: 'btn', get: () => v()[k], set: x => K.edit(s => { s.voicing[k] = x ? 1 : 0; }, { label: 'Voicing ' + label.toLowerCase() }) });
      if (title) w.el.title = title;
      return w.el;
    };
    const poly = pNum(K, { label: 'POLY', min: 1, max: 32, step: 1, def: 8, px: 160, get: () => v().poly, disabled: () => !!v().mono,
      set: (x, ph) => K.edit(s => { s.voicing.poly = x; }, { label: 'Polyphony', phase: ph }) });
    const polyMenu = (x, y) => {
      const s = K.s();
      wk.contextMenu(x, y, [
        { label: 'Limit Same Note Poly to 1', checked: !!s.voicing.oneNote, action: () => K.edit(st => { st.voicing.oneNote = st.voicing.oneNote ? 0 : 1; }, { label: 'One voice per note' }) },
        { label: 'Voice Steal Priority', sub: STEAL_LABEL.map((t, i) => ({ label: t, checked: (s.voicing.steal | 0) === i,
          action: () => K.edit(st => { st.voicing.steal = i; }, { label: 'Voice steal priority' }) })) },
        { sep: true },
        { label: 'Lock Polyphony', checked: !!s.locks.misc.poly, action: () => K.edit(st => { st.locks.misc.poly = st.locks.misc.poly ? 0 : 1; }, { label: 'Lock Polyphony' }) },
      ], { anchor: poly.el.querySelector('.sx-nfv') });
    };
    poly.el.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); polyMenu(e.clientX, e.clientY); });
    longPress(poly.el, polyMenu);
    K.custom(() => poly.el.classList.toggle('sx-locked-ctl', !!K.s().locks.misc.poly));
    // BEND UP / DOWN: g.bu2 / g.bd2 (0…48 / −48…0), in S1 mode the v1 g.bendup / g.benddn (±24), kept in sync by syncS1
    const bends = [];
    const bend = (s2, v1, label) => {
      const a = destOf(s2) ? K.num(s2, { label }) : null, b = K.num(v1, { label });
      if (a) bends.push([a.el, false]);
      bends.push([b.el, true]);
      return [a && a.el, b.el];
    };
    const bu = bend('g.bu2', 'g.bendup', 'BEND UP'), bd = bend('g.bd2', 'g.benddn', 'BEND DOWN');
    K.custom(() => { const s1 = s1On(K.s()) || !destOf('g.bu2'); for (const [e, isV1] of bends) e.classList.toggle('sx-hidden', isV1 !== s1); });
    const vc = mk(d, 'span', 'sx-rate');
    K.custom(() => { const vt = K.sx && K.sx.vcText, t = vt ? vt + ' voices' : ''; if (vc.textContent !== t) vc.textContent = t; });
    body.append(row(d, tg('MONO', 'mono'), tg('LEGATO', 'legato', 'Legato (with Mono off: poly legato)'), poly.el),
      row(d, K.knob('g.porta', { label: 'PORTA' }).el, K.knob('g.curve', { label: 'CURVE', size: 'sm' }).el),
      row(d, tg('ALWAYS', 'always', 'Glide even without overlapping notes'), tg('SCALED', 'scaled', 'Glide time scales with the interval (1 octave = PORTA)')),
      row(d, ...bu.filter(Boolean), ...bd.filter(Boolean)),
      row(d, vc));
    this.el = el;
    if (root) root.appendChild(el);
  }
  menuItems() { return []; }
  destroy() { this.el.remove(); }
}

/* ================================================================ CHAOS (one source; the GLOBAL page's CHAOS (S1) rows) */
// ChaosRow(root, kit, c): chaos source c (0 / 1) — RATE (c<n>.rate), BPM (c<n>.bpm), MONO, S&H (s.chaos[c].mono / sh) —
// in a panel shell ('CHAOS n'; bare: no title — the row keeps its own label, as the GLOBAL page's; args.label: its text, or
// false for none)
export class ChaosRow {
  constructor(root, kit, c, args) {
    const K = this.kit = kit, A = isObj(args) ? args : {};
    this.c = c ? 1 : 0;
    const shell = K.panel('CHAOS ' + (this.c + 1), null, null, '', A.bare !== undefined ? { bare: A.bare } : undefined);
    this.shell = shell;
    // (review 2) the row keeps its label as the bundled GLOBAL page draws it — a canvas Chaos module's its own number (A.label)
    shell.body.appendChild(ChaosRow.row(K, this.c, A.label !== undefined ? A.label : true));
    this.el = shell.el;
    if (root) root.appendChild(this.el);
  }
  // the row alone (the bundled CHAOS (S1) panel holds two): its label, RATE, BPM, MONO, S&H
  static row(K, c, label) {
    const d = K.doc, P = 'c' + (c + 1), monoLock = !!opt(K, 'monoLock', false);   // (MM) the master's Chaos: mono for good (see LfoPanel)
    const sw = (lab, k) => {
      const lk = monoLock && k === 'mono', w = pToggle(K, { label: lab, kind: 'btn', get: lk ? () => 1 : () => K.s().chaos[c][k], disabled: lk ? () => true : undefined,
        set: v => { if (lk) return; K.edit(s => { s.chaos[c][k] = v ? 1 : 0; }, { label: 'Chaos ' + (c + 1) + ' ' + lab.toLowerCase() }); } });
      if (lk) monoSay(K, w.el);
      return w.el;
    };
    return row(d, label === false ? null : mk(d, 'span', 'sx-txt', typeof label === 'string' ? label : 'CHAOS ' + (c + 1)), K.knob(P + '.rate', { label: 'RATE', size: 'sm' }).el,
      K.toggle(P + '.bpm', { label: 'BPM', kind: 'btn' }).el, sw('MONO', 'mono'), sw('S&H', 'sh'));
  }
  menuItems() { const H = this.kit.sx; return H ? H.srcDestItems('chaos' + (this.c + 1)) : []; }
  destroy() { this.el.remove(); }
}

/* ================================================================ VOICE's header (§13.2) */
// The preset area, panel undo / redo, the main menu, the touch modifier bar, the voice counter, MASTER + the output meter
// and the render-last wave icon — the bundled header without its logo and page tabs (args.lead: elements after the wave
// icon). The host keeps the pieces its paint loop updates (vcEl, meter, mkeys, waveBtn).
export class VoiceHeader {
  constructor(root, kit, args) {
    const K = this.kit = kit, H = K.sx, d = K.doc, A = isObj(args) ? args : {}, el = mk(d, 'div', 'sx-head');
    this.el = el;
    // wave icon: render the last played note group (§13.2.5); Shift: download the preset; Alt: the Renders folder
    const wave = btn(d, 'sx-hbtn sx-wave', icon(d, 'wave'), 'Render the last played notes to a WAV file (Shift: download the preset; Alt: open Renders)', e => {
      // the click that ends a drag acted on in dragstart (below) renders nothing more
      if (Date.now() - H.waveDragT < 1000) { H.waveDragT = -1e9; return; }
      H.renderLast(e);
    });
    // drag-export (§13.2.5, deviation 21): a desktop drag hands the most recent render of the current note group and
    // patch to the drop target through the DownloadURL drag type (Chromium: into a DAW or a folder); while there is
    // none (nothing rendered yet, a newer note group, an edit since), or with Shift / Alt, the drag acts as a click.
    // Touch devices keep the plain button (long-press = menus).
    wave.draggable = !H.touch;
    wave.addEventListener('dragstart', e => {
      const m = wk.modifierBar && wk.modifierBar.mods ? wk.modifierBar.mods(e) : { alt: !!e.altKey, shift: !!e.shiftKey };
      const R = H.lastRender, dt = e.dataTransfer;
      if (R && !m.alt && !m.shift && R.notes === H.noteGroup && R.edits === H.editSeq && dt && typeof dt.setData === 'function') {
        try {
          dt.setData('DownloadURL', R.type + ':' + R.name + ':' + R.url);
          dt.setData('text/uri-list', R.url);
          dt.effectAllowed = 'copy';
          return;
        } catch (err) { /* no DownloadURL support: a click */ }
      }
      e.preventDefault();
      H.waveDragT = Date.now();
      H.renderLast(e);
    });
    H.waveBtn = wave;
    H.waveDragT = -1e9;
    const pa = mk(d, 'div', 'sx-preset');
    const save = btn(d, 'sx-hbtn', icon(d, 'save'), 'Save preset (Alt-click: overwrite)', e => H.savePresetUI(e));
    const prev = btn(d, 'sx-hbtn', '◀', 'Previous preset in category', () => H.stepPresetUI(-1));
    const name = btn(d, 'sx-hbtn sx-pname', '', 'Browse presets', () => { const B = H.browser || H.initBrowser(); if (B) B.open(); });
    const next = btn(d, 'sx-hbtn', '▶', 'Next preset in category', () => H.stepPresetUI(1));
    const info = btn(d, 'sx-hbtn', icon(d, 'info'), 'Artist, description and tags', () => H.authorDialog());
    pa.append(save, prev, name, next, info);
    K.custom(() => {
      // the key and the list are cached (syncPreset: refresh() and the panel's own preset actions), not read per paint
      const cur = H.currentPreset(), nm = cur ? cur.name : H.nameOverride || 'Init';
      const t = (cur && cur.cat ? cur.cat + ' · ' : '') + nm + (H.dirty ? ' *' : '');
      if (name.textContent !== t) {
        name.textContent = '';
        if (cur && cur.cat) name.appendChild(mk(d, 'span', 'sx-pcat', cur.cat));
        name.appendChild(mk(d, 'span', H.dirty ? 'sx-dirty' : '', nm));
        name.setAttribute('aria-label', 'Preset ' + nm + (H.dirty ? ' (edited)' : '') + ', browse presets');
      }
    });
    // panel undo / redo (§13.2.4)
    const ur = mk(d, 'div', 'sx-undo');
    const ub = btn(d, 'sx-hbtn', icon(d, 'undo'), 'Undo (Cmd/Ctrl-Z)', () => H.undoRedo(false));
    const rb = btn(d, 'sx-hbtn', icon(d, 'redo'), 'Redo (Shift-Cmd/Ctrl-Z)', () => H.undoRedo(true));
    ur.append(ub, rb);
    K.custom(() => {
      ub.disabled = !H.undo.canUndo() && !H.undoPend;
      rb.disabled = !H.undo.canRedo();
      const ul = H.undo.label(), rl = H.undo.redoLabel();
      ub.title = 'Undo' + (ul ? ' ' + ul : '') + ' (Cmd/Ctrl-Z)';
      rb.title = 'Redo' + (rl ? ' ' + rl : '') + ' (Shift-Cmd/Ctrl-Z)';
    });
    const menuB = btn(d, 'sx-hbtn', 'Menu', 'Main menu', () => H.mainMenu(menuB));
    menuB.setAttribute('aria-haspopup', 'menu');
    // touch modifier latches (wk.modifierBar; shown on touch devices, §13.1)
    let mkeys = null;
    if (typeof wk.modifierBar === 'function') {
      try { mkeys = wk.modifierBar({}); mkeys.el.classList.add('sx-mkeys'); H.mkeys = mkeys; } catch (err) { mkeys = null; }
    }
    H.vcEl = mk(d, 'span', 'sx-vc');
    H.vcEl.title = 'Oscillator voices sounding (grains included) / maximum';
    const master = mk(d, 'div', 'sx-master');
    master.appendChild(K.knob('g.master', { label: 'MASTER', size: 'sm' }).el);
    if (typeof wk.meter === 'function') {
      try { H.meter = wk.meter({ ch: 1, label: 'Output', floor: -60, top: 6 }); master.appendChild(H.meter.el); } catch (err) { H.meter = null; }
    }
    el.append(wave, ...arr(A.lead), pa, ur, menuB);
    if (mkeys) el.appendChild(mkeys.el);
    el.append(H.vcEl, master);
    if (root) root.appendChild(el);
  }
  menuItems() { return []; }
  destroy() { this.el.remove(); }
}

/* ================================================================ the outputs (sx-ui-mix: BUS 1 / BUS 2 / MAIN / DIRECT) */
export const OutputsPanel = mix.OutputsPanel;

/* ================================================================ GLOBAL panels (§13.10, inv B24, B20) */
// QUALITY: Draft / High / Ultra (global.os 1 / 2 / 4) + lock, effective rate; ✓ S1 Compatibility Mode (setS1,
// reversible, §2.6.4) with the "S1 rendition differs" note; ✓ Disable Smoothing
export class QualityPanel {
  constructor(root, kit, args) {
    const K = this.kit = kit, H = K.sx, d = K.doc, A = isObj(args) ? args : {}, p = K.panel('QUALITY', null, null, '', A.bare !== undefined ? { bare: A.bare } : undefined), s0 = () => K.s();
    this.shell = p;
    // choosing a quality — also the one already selected — resets the CPU safeguard's quality-reduction steps
    // (§14.3; host.qualityChosen, optional: the integrator clears the session's qr steps)
    const q = pSeg(K, { label: 'Quality', items: QUALITY.map(x => x[1]), get: () => Math.max(0, QUALITY.findIndex(x => x[0] === s0().global.os)),
      always: true, set: i => H.chooseQuality(QUALITY[i][0]) });
    const lock = pToggle(K, { label: 'LOCK', kind: 'btn', get: () => s0().locks.misc.os,
      set: v => K.edit(s => { s.locks.misc.os = v ? 1 : 0; }, { label: 'Lock quality' }) });
    lock.el.title = 'Keep this quality when presets load';
    const rate = mk(d, 'span', 'sx-rate');
    K.custom(() => { const t = H.osText(); if (rate.textContent !== t) rate.textContent = t; });
    // project asset meter (§14.2): the project's referenced user + factory assets against this device's worklet budget,
    // from host.smp.usage() (optional: {bytes, budget} or a promise of it; read at most once a second); hidden without it
    const assets = mk(d, 'span', 'sx-rate sx-assets'), assetsRow = row(d, assets);
    assets.setAttribute('role', 'status');
    let usageT = -1e9, usageTxt = '';
    const mb = b => (b / 1048576).toFixed(b < 104857600 ? 1 : 0) + ' MB';
    const usageText = u => (isObj(u) && fin(u.bytes) ? 'Assets: ' + mb(u.bytes) + (fin(u.budget) && u.budget > 0 ? ' of ' + mb(u.budget) : '') : '');
    K.custom(() => {
      const S = K.host.smp, f = S && typeof S.usage === 'function' ? S.usage : null;
      if (f && nowMs() - usageT >= 1000) {
        usageT = nowMs();
        let u = null;
        try { u = f.call(S); } catch (err) { u = null; }
        if (u && typeof u.then === 'function') u.then(v => { usageTxt = usageText(v); if (!K.dead()) K.queue(); }, () => {});
        else usageTxt = usageText(u);
      }
      const t = f ? usageTxt : '';
      if (assets.textContent !== t) assets.textContent = t;
      assetsRow.classList.toggle('sx-hidden', !t);
    });
    const s1 = pToggle(K, { label: 'S1 Compatibility Mode', kind: 'led', get: () => (s1On(s0()) ? 1 : 0), set: v => H.setS1(v) });
    s1.el.title = (H && H.host && H.host.words && H.host.words.s1Tip) || 'Serum 1 renditions: OSC A/B warp slot 1 uses the 23 legacy warps, the sub its 5 shapes and level law, Filter 1 its 96 types and the gliding key-track reference, Hz LFOs ignore HOST, PHASE/RAND knob ends set the phase memory, and the bend ranges are ±24. Every other feature works in both modes. Switching back restores the S1 sound exactly.';
    const diff = mk(d, 'p', 'sx-note');
    K.custom(() => {
      const L = s1Diff(s0()), t = L.length ? 'S1 rendition differs: ' + L.join(', ') : '';
      if (diff.textContent !== t) diff.textContent = t;
      diff.classList.toggle('sx-hidden', !t);
    });
    const ns = pToggle(K, { label: 'Disable Smoothing', kind: 'led', get: () => s0().global.nosmooth,
      set: v => K.edit(s => { s.global.nosmooth = v ? 1 : 0; }, { label: 'Disable smoothing' }) });
    p.body.append(row(d, mk(d, 'span', 'sx-txt', 'QUALITY'), q.el, lock.el), row(d, rate), assetsRow, prefLine(d, s1.el), diff, prefLine(d, ns.el));
    this.el = p.el;
    if (root) root.appendChild(this.el);
  }
  menuItems() { return []; }
  destroy() { this.el.remove(); }
}
// TUNING: concert pitch A4 (400–480 Hz) + lock (A4 and the tuning file across preset loads); TUN FILE menu;
// MTS-ESP disabled (deviation 1)
export class TuningPanel {
  constructor(root, kit, args) {
    const K = this.kit = kit, H = K.sx, d = K.doc, A = isObj(args) ? args : {}, p = K.panel('TUNING', null, null, '', A.bare !== undefined ? { bare: A.bare } : undefined), s0 = () => K.s();
    this.shell = p;
    const R = core.A4_RANGE || [400, 480];
    const a4 = pNum(K, { label: 'A4 (Hz)', min: R[0], max: R[1], step: 0.1, def: 440, px: 400, get: () => s0().global.a4, fmt: v => v.toFixed(1),
      set: (v, ph) => K.edit(s => { s.global.a4 = v; }, { label: 'A4 reference', phase: ph }) });
    const lock = pToggle(K, { label: 'LOCK', kind: 'btn', get: () => s0().locks.misc.tuning,
      set: v => K.edit(s => { s.locks.misc.tuning = v ? 1 : 0; }, { label: 'Lock tuning' }) });
    lock.el.title = 'Keep the concert pitch and the tuning file when presets load';
    const tun = btn(d, 'sx-hbtn sx-grow', '', 'Tuning file', () => {
      const r = tun.getBoundingClientRect(), t = s0().global.tun || {};
      wk.contextMenu(r.left, r.bottom + 2, [
        { label: 'Load .scl / .kbm / .tun…', action: () => H.loadTuning() },
        { label: 'Clear Tuning', disabled: !t.kind || t.kind === 'none', action: () => H.clearTuning() },
      ], { anchor: tun });
    });
    tun.setAttribute('aria-haspopup', 'menu');
    K.custom(() => {
      const t = s0().global.tun || {}, txt = 'TUN FILE: ' + (t.kind && t.kind !== 'none' ? t.name || t.kind : '12-TET (none)');
      if (tun.textContent !== txt) tun.textContent = txt;
    });
    const mts = pToggle(K, { label: 'MTS-ESP', kind: 'led', get: () => 0, set: () => {}, disabled: () => true });
    mts.el.title = 'Not available in the browser';
    p.body.append(row(d, a4.el, lock.el), row(d, tun), prefLine(d, mts.el, 'Not available in the browser'));
    this.el = p.el;
    if (root) root.appendChild(this.el);
  }
  menuItems() { return []; }
  destroy() { this.el.remove(); }
}
// MPE: enabled, bend range (1–96, default 48), XYZ→Macro 1,2,3 / YZ→Macro 1,2 / Y→Mod Wheel (radio + off)
export class MpePanel {
  constructor(root, kit, args) {
    const K = this.kit = kit, d = K.doc, A = isObj(args) ? args : {}, p = K.panel('MPE', null, null, '', A.bare !== undefined ? { bare: A.bare } : undefined), m0 = () => K.s().global.mpe || { on: 0, bend: 48, xyz: 0 };
    this.shell = p;
    const mEdit = (fn, label) => K.edit(s => { if (!isObj(s.global.mpe)) s.global.mpe = { on: 0, bend: 48, xyz: 0 }; fn(s.global.mpe); }, { label });
    const onT = pToggle(K, { label: 'MPE Enabled', kind: 'led', get: () => (m0().on ? 1 : 0), set: v => mEdit(m => { m.on = v ? 1 : 0; }, 'MPE') });
    const bend = pNum(K, { label: 'BEND RANGE', min: 1, max: 96, step: 1, def: core.MPE_BEND_DEF || 48, px: 300, get: () => m0().bend || 48,
      fmt: v => v + ' st', set: (v, ph) => mEdit(m => { m.bend = v; }, 'MPE bend range'), parse: t => { const v = parseFloat(String(t).replace(',', '.')); return fin(v) ? v : null; } });
    const xyz = pSeg(K, { label: 'MPE expression mapping', items: ['Off', 'XYZ→M1,2,3', 'YZ→M1,2', 'Y→Wheel'], get: () => clamp(m0().xyz | 0, 0, 3),
      set: i => mEdit(m => { m.xyz = i; }, 'MPE mapping') });
    p.body.append(prefLine(d, onT.el), row(d, bend.el), row(d, xyz.el));
    this.el = p.el;
    if (root) root.appendChild(this.el);
  }
  menuItems() { return []; }
  destroy() { this.el.remove(); }
}
// VOICE CONTROL (inv B20, §2.2.6): preset menu, osc selection A B C N S, sequence length, step rows, RANDOM, SCALING
export class VcPanel {
  constructor(root, kit, args) {
    const K = this.kit = kit, d = K.doc, A = isObj(args) ? args : {}, v0 = () => K.s().vc;
    const p = K.panel('VOICE CONTROL', MODULE_FIELDS.vc ? 'vc' : null, null, '', A.bare !== undefined ? { bare: A.bare } : undefined);
    this.shell = p;
    const pre = btn(d, 'sx-hbtn sx-grow', '', 'Voice Control presets', () => this.presetMenu(pre));
    pre.setAttribute('aria-haspopup', 'menu');
    K.custom(() => { const t = 'PRESET: ' + (v0().name || 'Init'); if (pre.textContent !== t) pre.textContent = t; });
    const sel = mk(d, 'div', 'sx-route');
    ['A', 'B', 'C', 'N', 'S'].forEach((x, i) => {
      const w = pToggle(K, { label: x, kind: 'btn', get: () => (arr(v0().sel)[i] ? 1 : 0),
        set: on1 => K.edit(s => { s.vc.sel[i] = on1 ? 1 : 0; }, { label: 'Voice Control oscillators' }) });
      w.el.title = ['OSC A', 'OSC B', 'OSC C', 'Noise', 'Sub'][i];
      sel.appendChild(w.el);
    });
    const len = pNum(K, { label: 'LENGTH', min: 1, max: 8, step: 1, def: 1, px: 120, get: () => v0().len || 1,
      set: (v, ph) => K.edit(s => { s.vc.len = v; }, { label: 'Voice Control length', phase: ph }) });
    const rows = ['Pan', 'Detune', 'Cutoff', 'Env', 'Mod 1', 'Mod 2'], box = mk(d, 'div', 'sx-vcgrid');
    if (typeof wk.stepGrid === 'function') {
      const g = K.bind(wk.stepGrid({ label: 'Voice Control steps', rows, steps: 8, len: () => v0().len || 1,
        get: (r, j) => { const st = arr(v0().steps)[j]; return st && fin(st[r]) ? st[r] : 0; },
        set: (r, j, v, ph) => K.edit(s => { s.vc.steps[j][r] = Math.round(clamp(v, -1, 1) * 100) / 100; }, { label: 'Voice Control step', phase: ph || 'set' }),
        fmt: (r, v) => Math.round(v * 100) + '%' }));
      box.appendChild(g.el);
    } else box.appendChild(mk(d, 'p', 'sx-txt', 'Step editor unavailable'));
    const kn = (id, label) => (destOf(id) ? K.knob(id, { label, size: 'sm' }).el : null);
    const lscale = kn('vc.lscale', 'LFO');   // knob menu: By Percentage · By Rate first (extraKnobItems)
    p.body.append(row(d, pre), row(d, mk(d, 'span', 'sx-txt', 'OSC'), sel, len.el), box,
      row(d, mk(d, 'span', 'sx-txt', 'RANDOM'), kn('vc.pan', 'PAN'), kn('vc.det', 'DETUNE'), kn('vc.cut', 'CUTOFF'), kn('vc.env', 'ENVS')),
      row(d, mk(d, 'span', 'sx-txt', 'SCALING'), kn('vc.escale', 'ENV'), lscale));
    this.el = p.el;
    if (root) root.appendChild(this.el);
  }
  presets() { const H = this.kit.sx; return arr(H ? H.store('get', VC_KEY, []) : []).filter(x => x && typeof x.name === 'string' && isObj(x.vc)); }
  // Voice Control presets (§10.9 FACTORY_VC {name, vc, p}; user presets in synth.sx.vc): a preset is the vc state plus the
  // bases of the Voice Control destinations (RANDOM, SCALING: vc.* in s.p); ids a preset leaves out take their defaults
  presetMenu(anchor) {
    const K = this.kit, H = K.sx, r = anchor.getBoundingClientRect(), fac = arr(core.FACTORY_VC), user = this.presets();
    const ids = DESTS.filter(dd => /^vc\./.test(dd.id)).map(dd => dd.id);
    const load = (x, name) => K.edit(s => {
      const vc = isObj(x.vc) ? x.vc : x;
      s.vc = Object.assign({}, s.vc, clone(vc), { name: String(name || vc.name || 'Preset').slice(0, 24) });
      if (isObj(x.p)) for (const id of ids) s.p[id] = fin(x.p[id]) ? clamp01(x.p[id]) : DESTS[DEST_INDEX[id]].def;
      if (typeof core.normalizeSerum === 'function') { const n = core.normalizeSerum(s); s.vc = n.vc; }
    }, { label: 'Voice Control preset' });
    const init = () => { const d0 = core.defaultSerum(); return { vc: d0.vc, p: Object.fromEntries(ids.map(id => [id, d0.p[id]])) }; };
    const items = [];
    if (fac.length) items.push({ label: 'Factory', sub: fac.map(x => ({ label: x.name, action: () => load(x, x.name) })) });
    items.push({ label: 'User', sub: user.length ? user.map(x => ({ label: x.name, action: () => load(x, x.name) })) : [{ label: '(none)', disabled: true }] });
    items.push({ label: 'Init', action: () => load(init(), 'Init') });
    items.push({ sep: true }, { label: 'Save…', action: () => K.prompt('Save Voice Control Preset', 'Name', K.s().vc.name || 'VC ' + (user.length + 1), t => {
      const name = String(t).trim().slice(0, 24);
      if (!name) return false;
      const s = K.s(), vc = clone(s.vc);
      vc.name = name;
      const pv = Object.fromEntries(ids.map(id => [id, K.getN(id)]));
      if (H) H.store('set', VC_KEY, user.filter(x => x.name !== name).concat([{ name, vc, p: pv }]));
      K.edit(st => { st.vc.name = name; }, { label: 'Voice Control preset' });
      K.notify('Saved Voice Control preset “' + name + '”');
      return true;
    }) });
    if (user.length) items.push({ label: 'Delete', sub: user.map(x => ({ label: x.name, action: () => { if (H) H.store('set', VC_KEY, user.filter(y => y.name !== x.name)); } })) });
    wk.contextMenu(r.left, r.bottom + 2, items, { anchor });
  }
  menuItems() { return this.shell && this.shell.menuItems ? this.shell.menuItems() : []; }
  destroy() { this.el.remove(); }
}

// INFO / VERSION: author, notes, tags editor, build text (the GLOBAL page; VOICE's ⋯ → Info…)
export class InfoPanel {
  constructor(root, kit, args) {
    const K = this.kit = kit, d = K.doc, A = isObj(args) ? args : {}, p = K.panel('INFO', null, null, '', A.bare !== undefined ? { bare: A.bare } : undefined), s0 = () => K.s();
    this.shell = p;
    const au = mk(d, 'input'), no = mk(d, 'textarea'), tg = mk(d, 'input');
    au.type = 'text'; au.maxLength = 64;
    no.maxLength = 2000;
    tg.type = 'text'; tg.maxLength = 400;
    tg.placeholder = 'tag, tag…';
    const la = mk(d, 'label', 'sx-txt', 'Author'), ln = mk(d, 'label', 'sx-txt', 'Notes'), lt = mk(d, 'label', 'sx-txt', 'Tags');
    la.appendChild(au); ln.appendChild(no); lt.appendChild(tg);
    au.addEventListener('change', () => K.edit(s => { s.author = au.value.slice(0, 64); }, { label: 'Author' }));
    no.addEventListener('change', () => K.edit(s => { s.notes = no.value.slice(0, 2000); }, { label: 'Notes' }));
    tg.addEventListener('change', () => K.edit(s => { s.tags = tagList(tg.value.split(',')).slice(0, 16); }, { label: 'Tags' }));
    K.custom(() => {
      const s = s0();
      if (d.activeElement !== au && au.value !== s.author) au.value = s.author || '';
      if (d.activeElement !== no && no.value !== s.notes) no.value = s.notes || '';
      const t = arr(s.tags).join(', ');
      if (d.activeElement !== tg && tg.value !== t) tg.value = t;
    });
    p.body.append(la, ln, lt, mk(d, 'p', 'sx-rate', (K.sx && K.sx.host && K.sx.host.words && K.sx.host.words.build) || BUILD)); // ((WC, G13) a rig's host names its own build line
    this.el = p.el;
    if (root) root.appendChild(this.el);
  }
  menuItems() { return []; }
  destroy() { this.el.remove(); }
}
// PREFERENCES (§9.7, §13.10): app-wide, never in presets (the host's setPref: storage, wk, host.prefsChanged)
export class PrefsPanel {
  constructor(root, kit, args) {
    const K = this.kit = kit, H = K.sx, d = K.doc, A = isObj(args) ? args : {}, p = K.panel('PREFERENCES', null, null, '', A.bare !== undefined ? { bare: A.bare } : undefined), P = () => H.prefs;
    this.shell = p;
    const line = (label, ctl) => { const r = mk(d, 'div', 'sx-pref'); r.append(mk(d, 'span', '', label), ctl); return r; };
    const opt = (label, k) => { const r = mk(d, 'div', 'sx-pref'), w = pToggle(K, { label, kind: 'led', get: () => P()[k], set: v => H.setPref(k, v ? 1 : 0) }); r.appendChild(w.el); return r; };
    const seg = (label, items, get, set) => pSeg(K, { label, items, get, set }).el;
    const author = mk(d, 'input');
    author.type = 'text'; author.maxLength = 64;
    author.setAttribute('aria-label', 'Default author name');
    author.addEventListener('change', () => H.setPref('author', author.value));
    K.custom(() => { if (d.activeElement !== author) author.value = P().author; });
    // a drag shows its value locally and commits once at the end (setPref writes the storage and host.prefsChanged
    // recompiles every track when the smoothing scale changes)
    let smoothDrag = null;
    const smooth = pNum(K, { label: '', aria: 'Smoothing scale', min: 1, max: 800, step: 1, def: 100, px: 400,
      get: () => (smoothDrag !== null ? smoothDrag : Math.round(P().smooth * 100)), fmt: v => v + '%',
      set: (v, ph) => {
        if (ph === 'start' || ph === 'move') { smoothDrag = v; K.queue(); return; }
        smoothDrag = null;
        if (Math.round(P().smooth * 100) !== v) H.setPref('smooth', v / 100);
      } });
    p.body.append(
      opt('Help tooltips', 'helpTips'),
      opt('Param value tooltips', 'tooltips'),
      line('Double-click', seg('Double-click', ['Type value', 'Reset'], () => (P().dblClick === 'reset' ? 1 : 0), i => H.setPref('dblClick', i ? 'reset' : 'type'))),
      opt('Mouse wheel adjusts controls', 'wheel'),
      opt('Keyboard shortcuts', 'keys'),
      line('Default waveform view', seg('Default WT view', ['2D', '3D'], () => P().view3d, i => H.setPref('view3d', i))),
      opt('MPE enabled by default', 'mpeDefault'),
      opt('MPE Pitch Bend (also) maps to Expr X', 'mpeBendX'),
      opt('MPE Expr Y acts bi-directional', 'mpeYBi'),
      opt('Limit mod depth on drop', 'limitDrop'),
      opt('Mod wheel → WT Pos while editor open', 'wheelWt'),
      opt('Silence effect tails when transport stops', 'silenceTails'),
      opt('Load MIDI Map from Presets', 'midiFromPreset'),
      opt('Use Ultra quality when rendering', 'ultra'),
      line('Default quality', seg('Default quality', QUALITY.map(x => x[1]), () => Math.max(0, QUALITY.findIndex(x => x[0] === P().defOs)), i => H.setPref('defOs', QUALITY[i][0]))),
      line('Default author name', author),
      opt('Ask before preset change when edited', 'askPreset'),
      line('Smoothing scale', smooth.el));
    this.el = p.el;
    if (root) root.appendChild(this.el);
  }
  menuItems() { return []; }
  destroy() { this.el.remove(); }
}
// a panel in a dialog sheet of the host (VOICE's ⋯ → Preferences… / Info…, IMPL-3 §2.2): a view of the host built into the
// overlay (painted while open), unmounted when it closes. → the overlay { el, close }
export function panelDialog(H, Make, title) {
  let V = null;
  const O = H.overlayOpen('sx-dlg-ov', title, () => { if (V) V.destroy(); });
  const box = mk(H.d, 'div', 'sx-dlg'), row0 = mk(H.d, 'div', 'sx-dbtns');
  O.el.appendChild(box);
  V = H.mount((root, K) => new Make(root, K, { bare: false }), box, { inner: true, kind: 'dialog' });
  row0.appendChild(btn(H.d, 'sx-btn sx-pri', 'Close', null, () => O.close()));
  box.appendChild(row0);
  H.paint(true);
  return O;
}

/* ================================================================ VOICE (the Serum's hub, IMPL-3 §2.2) */
// VOICE = the header, VOICING beside ENV 1 (the amp envelope), the outputs (MAIN / DIRECT / BUS 1 / BUS 2), then the
// fold-outs of the GLOBAL page and the voice's curves: QUALITY, TUNING, MPE, VOICE CONTROL, VELO, NOTE, KEYS (s.kbd) and,
// in S1 mode, CHAOS 1 / 2 — each built at its first opening, then kept (view state of the host: not saved, no undo step)
const FOLDS = [
  ['quality', 'QUALITY', (b, K) => new QualityPanel(b, K)], ['tuning', 'TUNING', (b, K) => new TuningPanel(b, K)], ['mpe', 'MPE', (b, K) => new MpePanel(b, K)],
  ['vc', 'VOICE CONTROL', (b, K) => new VcPanel(b, K)], ['velo', 'VELO', (b, K) => new CurvePanel(b, K, 'velo')], ['note', 'NOTE', (b, K) => new CurvePanel(b, K, 'note')],
  ['keys', 'KEYS', (b, K) => (typeof seq.KeyboardPanel === 'function' ? new seq.KeyboardPanel(b, K) : null)],
  ['chaos', 'CHAOS 1 / 2', (b, K) => { const a = new ChaosRow(b, K, 0, { bare: false }), c = new ChaosRow(b, K, 1, { bare: false }); return { el: b, destroy() { a.destroy(); c.destroy(); } }; }, K => s1On(K.s())],
];
export class VoicePanel {
  constructor(root, kit, args) {
    const K = this.kit = kit, H = K.sx, d = K.doc, A = isObj(args) ? args : {}, page = K.page, el = mk(d, 'div', 'sx-voice');
    this.el = el;
    this.parts = [];
    this.header = new VoiceHeader(el, K, { lead: [] });
    if (H && !H.statusEl) {
      H.statusEl = this.status = mk(d, 'div', 'sx-status');   // (the host's touch tip line; it goes with this VOICE)
      H.statusEl.setAttribute('role', 'status');
      H.statusEl.setAttribute('aria-live', 'polite');
      el.appendChild(H.statusEl);
    }
    const vrow = mk(d, 'div', 'sx-vrow');
    this.parts.push(new VoicingPanel(vrow, K, { bare: false }), new EnvPanel(vrow, K, 0, { bare: false }));
    el.appendChild(vrow);
    if (typeof OutputsPanel === 'function') { try { this.parts.push(new OutputsPanel(el, K)); } catch (err) { console.error('sx-ui-mod: outputs', err); } }
    const folds = H ? (H.uiState.folds || (H.uiState.folds = new Set())) : new Set();
    const fbox = mk(d, 'div', 'sx-folds');
    for (const [key, title, make, when] of FOLDS) {
      const sec = mk(d, 'div', 'sx-fold'), body = mk(d, 'div', 'sx-foldbody');
      const b = btn(d, 'sx-hbtn sx-foldbtn', '', title + ' (show / hide)', () => { if (folds.has(key)) folds.delete(key); else folds.add(key); paint(); });
      b.setAttribute('aria-expanded', 'false');
      sec.append(b, body);
      fbox.appendChild(sec);
      let built = null;
      const paint = () => {
        const open = folds.has(key), vis = !when || when(K);
        if (open && vis && !built) built = K.under(page, () => make(body, K)) || { el: body };
        sec.classList.toggle('sx-hidden', !vis);
        body.classList.toggle('sx-hidden', !open);
        const t = (open ? '▾ ' : '▸ ') + title;
        if (b.textContent !== t) b.textContent = t;
        b.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open && built) K.queue();
      };
      this.parts.push({ destroy: () => { if (built && built.destroy) built.destroy(); } });
      K.custom(paint);
    }
    el.appendChild(fbox);
    void A;
    if (root) root.appendChild(el);
  }
  // for the canvas bar ⋯ (VOICE's own items; the app adds Show parts / Bundle, Add ▸ …): the app dialogs of the GLOBAL page
  menuItems() {
    const H = this.kit.sx;
    return H ? [{ label: 'Preferences…', action: () => panelDialog(H, PrefsPanel, 'Preferences') }, { label: 'Info…', action: () => panelDialog(H, InfoPanel, 'Info') }] : [];
  }
  destroy() {
    for (const p of this.parts) if (p && p.destroy) { try { p.destroy(); } catch (err) { /* gone */ } }
    const H = this.kit.sx;
    if (H && this.status && H.statusEl === this.status) H.statusEl = null;   // a remounted VOICE builds its own line (a stale one wrote to a detached element)
    this.header.destroy(); this.el.remove();
  }
}

/* ================================================================ the view kinds (sx-host mount) */
// a Serum part → its view kind and slot (serum-core MODULE_FIELDS names, + 'macros', 'voice', 'chaos1/2')
export function partView(part) {
  const p = String(part || ''), m = /^osc([ABC])$/.exec(p);
  if (m) return { kind: 'osc', k: 'ABC'.indexOf(m[1]) };
  if (p === 'filter' || p === 'filter2') return { kind: 'filter', k: p === 'filter2' ? 1 : 0 };
  let n = /^env([1-4])$/.exec(p);
  if (n) return { kind: 'env', k: +n[1] - 1 };
  n = /^lfo([1-9]|10)$/.exec(p);
  if (n) return { kind: 'lfo', k: +n[1] - 1 };
  n = /^chaos([12])$/.exec(p);
  if (n) return { kind: 'chaos', k: +n[1] - 1 };
  if (['sub', 'noise', 'macros', 'arp', 'clip', 'voice', 'voicing', 'velo', 'note'].includes(p)) return p === 'velo' || p === 'note' ? { kind: 'curve', k: p } : { kind: p, k: 0 };
  return null;
}
// host.mount of a Serum part into root: bare by default (the canvas bar has the chrome), its PART_W width, its column
export function mountPart(host, part, root, args) {
  const v = partView(part);
  if (!v) throw new Error('sx-ui-mod: no part ' + part);
  return host.mount(v.kind, root, Object.assign({ k: v.k, bare: true, width: PART_W[v.kind], col: COL[v.kind], part, phase: phaseOf(part, v.kind) }, args));
}
// a slot host's panel (sx-host slotHost: a canvas LFO / ENV / Chaos / Macro module): LfoPanel 0, EnvPanel 1 (ENV 2's
// layout), ChaosRow 0, MacrosPanel — bare, at the bundled panel's width, in the column it comes from
const SLOT_VIEW = { lfo: 'lfo', env: 'env', chaos: 'chaos', macro: 'macros' };
export function mountSlot(H, root, args) {
  const kind = SLOT_VIEW[H.kind];
  return H.mount(kind, root, Object.assign({ k: H.slot, bare: true, width: PART_W[kind], col: COL[kind], dev: H.dev, phase: phaseOf(kind, kind) }, args));
}
// the pressing / selection rules the bundled OSC page applies, for a mounted oscillator (s.ui.osc: the Render OSC Warp /
// Resample target; its tab while expanded), and its look there (sx-opan / data-o: the colour rule and the selection ring)
function oscSel(K, el, o) {
  const H = K.sx;
  el.classList.add('sx-opan');
  el.setAttribute('data-o', String(o));
  if (!H) return;
  const sel = () => { if (H.selOsc() !== o) uiEdit(K, s => { s.ui.osc = o; }, { noRebase: true }); };
  el.addEventListener('pointerdown', sel, true);
  el.addEventListener('click', sel, true);
  K.custom(() => el.classList.toggle('sx-osel', H.selOsc() === o));
}
defineView('osc', (root, K, A) => { const k = clamp(A.k | 0, 0, 2), p = new osc.OscPanel(root, K, k); oscSel(K, p.el, k); return asView(p, p.shell); });
defineView('sub', (root, K) => { const p = new osc.SubPanel(root, K); return asView(p, p.shell); });
defineView('noise', (root, K) => { const p = new osc.NoisePanel(root, K); return asView(p, p.shell); });
defineView('filter', (root, K, A) => {
  const k = A.k ? 1 : 0, p = new osc.FilterPanel(root, K, k);
  p.el.classList.add('sx-fpan');
  p.el.setAttribute('data-f', String(k));
  return asView(p, p.shell);
});
defineView('env', (root, K, A) => { const p = new EnvPanel(root, K, clamp(A.k | 0, 0, N_ENV - 1)); return asView(p, p.shell, { menuItems: () => p.menuItems() }); });
defineView('lfo', (root, K, A) => { const p = new LfoPanel(root, K, clamp(A.k | 0, 0, 9)); return asView(p, p.shell, { menuItems: () => p.menuItems() }); });
defineView('macros', (root, K) => { const p = new MacrosPanel(root, K); return asView(p, p.shell); });
defineView('voicing', (root, K) => { const p = new VoicingPanel(root, K); return asView(p, p.shell); });
defineView('chaos', (root, K, A) => { const n = /^h(\d+)$/.exec(A.dev || ''), p = new ChaosRow(root, K, A.k ? 1 : 0, n ? { label: 'CHAOS ' + n[1] } : {}); return asView(p, p.shell, { menuItems: () => p.menuItems() }); }); // (a canvas Chaos module h<n>: its row "CHAOS <n>")
defineView('curve', (root, K, A) => { const p = new CurvePanel(root, K, A.k === 'note' ? 'note' : 'velo'); return asView(p, p.shell); });
defineView('arp', (root, K) => { const p = new seq.ArpPage(root, K); return asView(p, p.shell); });
defineView('clip', (root, K) => { const p = new seq.ClipPage(root, K, { twins: true }); return asView(p, p.shell); });
defineView('voice', (root, K, A) => { const p = new VoicePanel(root, K, A); return asView(p, null, { menuItems: () => p.menuItems() }); });
defineView('header', (root, K, A) => { const p = new VoiceHeader(root, K, A); return asView(p, null); });
defineView('outputs', (root, K) => { const p = new OutputsPanel(root, K); return asView(p, null); });
defineView('quality', (root, K) => { const p = new QualityPanel(root, K); return asView(p, p.shell); });
defineView('tuning', (root, K) => { const p = new TuningPanel(root, K); return asView(p, p.shell); });
defineView('mpe', (root, K) => { const p = new MpePanel(root, K); return asView(p, p.shell); });
defineView('vc', (root, K) => { const p = new VcPanel(root, K); return asView(p, p.shell); });
