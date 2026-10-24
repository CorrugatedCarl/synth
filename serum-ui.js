// serum-ui.js — the Serum-style instrument panel, v2 shell (SPEC-serum2 §13, §11.14; Phase 1: SPEC-serum §8.8, §9).
// SerumUI = a SerumHost (sx-host.js: state, panel undo, the kit, the paint loop, the mod layer, overlays, presets, menus;
// SYNTH Canvas milestone 3, IMPL-3 §2.3) + its shell views: the header (render-last wave icon, logo, tabs OSC · MIX · FX ·
// MATRIX · ARP · CLIP · GLOBAL, VOICE's header: preset area with ARTIST / DESC, panel Undo / Redo, main menu, touch
// modifier bar, voice counter, MASTER knob + output meter), the seven pages (built at their first showing, then kept)
// and the keyboard panel at the bottom of every page. The constructor and showPage are host.mount calls, so the bundled
// panel and a Serum's parts on the canvas are views of one host implementation.
// The sub-panels live in their own modules and are bound through the kit made by makeKit (§11.14): sx-ui-osc (OSC A–C,
// SUB, NOISE, FILTER 1/2; U2), sx-ui-mix (MIX page; U3, loaded on demand), fx-ui (FX page; U3), sx-ui-seq (ARP, CLIP,
// keyboard; U4), sx-ui-mod (MACROS 1–8, ENV 1–4, LFO 1–10 / VELO / NOTE, VOICING, the GLOBAL panels: milestone 3).
// serum-ui owns the page shell, the tile strip, the MATRIX page and the GLOBAL page's own panels (UNISON A / B / C,
// CHAOS (S1), PREFERENCES, INFO).
//
// Browser ES module. Nothing touches document / window / localStorage / navigator at module top level, so node
// can import it for the pure-helper tests (§0.1, §10.6). Sibling modules are imported as namespaces: a helper
// missing from a sibling degrades one feature (with a notice) instead of failing the whole panel at link time.
//
// Pure helpers (node-tested, tests/serum-ui.test.mjs; defined in sx-host.js, re-exported here): haloArcs, knobMenuItems,
// moduleMenuItems, dropRow, busMenuItems, lfoTileCount, sortPresets, filterPresets, browserList, stepPreset, presetTags,
// withMeta, hybridPick, captureDue, undoStack, clipModule / pasteModule / initModule (→ serum-core copyModule /
// initModule), linkPoints, parseGrid, parseAmount, normPrefs, normBrowser, presetCats, memTrigSet, tileDests, modTipLines,
// s1Diff, rowAlias, rowBad, destModule, virtGet / virtSet; and makeKit, the binding kit of the sub-panels (§11.14).
// The edit conventions and the optional host members: sx-host.js's header.
// MIDI program change: index browserList(host.presets.list(), storage[BROWSER_KEY]) (§9.10, §11.8).
import * as core from './serum-core.js?v=9';
import * as wk from './wk.js?v=9';
import * as fxui from './fx-ui.js?v=9';
import * as osc from './sx-ui-osc.js?v=9';
import * as seq from './sx-ui-seq.js?v=9';
import {
  SerumHost, mkPage, mk, btn, icon, logo, svgEl, clamp, clamp01, fin, arr, isObj, clone, sgn, twoF, destOf, srcLabel,
  srcGroups, rowsOf, rowActive, rowBad, rowAlias, emptyRow, lfoNum, parseAmount, lfoTileCount, closest, warnOnce, isPristine, s1On,
  PAGES, PAGE_LABEL, N_MX, N_LFO, N_ENV, N_MAC, N_OSC, OSC_L, OSC_P, UNI_STACKS, UNI_MODES, MC_K,
} from './sx-host.js?v=9';
import { MacrosPanel, EnvPanel, LfoPanel, VoicingPanel, VoiceHeader, QualityPanel, TuningPanel, MpePanel, VcPanel, ChaosRow, PrefsPanel, InfoPanel } from './sx-ui-mod.js?v=9';
export {
  PREFS_KEY, BROWSER_KEY, META_KEY, DEFAULT_KEY, VC_KEY, PAGES, destModule, virtGet, virtSet, srcLabel, haloArcs, powerLive, actionSlot, ccFor,
  moduleMenuItems, knobMenuItems, dropRow, busMenuItems, linkPoints, groupItems, isPristine, layers3d, ptsBuses, lfoTileCount, tileDests,
  modTipLines, captureDue, memTrigSet, clipModule, pasteModule, initModule, parseGrid, parseAmount, PREFS_DEFAULT, normPrefs, undoStack, s1Diff,
  rowAlias, rowBad, BROWSER_DEFAULT, normBrowser, withMeta, sortPresets, filterPresets, browserList, presetCats, presetTags, stepPreset,
  hybridPick, makeKit, PresetBrowser, SerumHost,
} from './sx-host.js?v=9';

// the MIX page module (U3), loaded on demand: the page degrades to a notice while it is missing
const loadMix = () => import('./sx-ui-mix.js?v=9');

/* ================================================================ SerumUI */

export class SerumUI extends SerumHost {
  // o.parts (SYNTH Canvas milestone 3, IMPL-3 §2.4): a Serum shown as parts — the host alone, no shell; the app mounts its
  // part views (sx-ui-mod mountPart). dropShell() / buildShell(root) switch the same host between the two view sets
  // (never both): panel undo, dirty and view state survive a switch
  constructor(root, host, o) {
    super(host, { doc: (root && root.ownerDocument) || globalThis.document });
    this.root = root;
    this.footPage = mkPage(null, this.opts);   // the keyboard panel under every page (§13.2)
    if (o && o.parts) { this.shellReset(); this.start(); return; }
    this.buildShell(root);
    this.start();
  }
  // (milestone 3) the shell's own fields, empty (no shell: the parts view)
  shellReset() {
    this.pages = {};
    this.head = null;
    this.page = '';
    this.mixer = null;
    this.rack = null;
    this.kbd = null;
    this.oscPanels = null;
    this.seqPages = {};
    this.macPane = { arp: false, clip: false };
    this.mxExp = false;
    this.pageBox = null;
    this.footEl = null;
    this.tabBtns = {};
  }
  // (milestone 3) the header's satellites (touch modifier bar, output meter) of a header that went (the shell's, VOICE's)
  dropHeadKit() {
    for (const k of ['mkeys', 'meter']) { const x = this[k]; this[k] = null; if (x && typeof x.destroy === 'function') { try { x.destroy(); } catch (err) { /* gone */ } } }
    this.vcEl = null; this.vcText = null;
  }
  // (milestone 3) the shell's views go (header, pages, keyboard foot, the bundled root); the host stays for the parts view
  dropShell() {
    if (!this.pageBox || this.dead) return;
    for (const V of this.views.slice()) if (V.kind === 'head' || V.kind === 'foot' || /^page:/.test(V.kind)) this.unmount(V);
    this.destroyShell();
    this.dropHeadKit();
    if (this.browser) { this.browser.close(); this.browser = null; }   // (its overlay sat on the bundled root: the next view's root takes it)
    const r = this.roots.find(x => x.id === this.uid);   // (the bundled root: the host's uid, a part root uid-r<n>)
    if (r) this.dropRoot(r);
    this.shellReset();
    this.edDirty = true;
  }
  // the shell into root (the constructor's; milestone 3: again after dropShell — every part view unmounted first, the app's)
  buildShell(root) {
    if (this.dead) return;
    if (root) this.root = root;
    this.dropHeadKit();
    this.shellReset();
    if (this.browser) { this.browser.close(); this.browser = null; }   // (a parts view's: its overlay sat on a part's root)
    const s = this.s();
    this.el = this.addRoot(this.root, { bundled: true });
    if (this.roots[0] !== this.el) { this.roots.splice(this.roots.indexOf(this.el), 1); this.roots.unshift(this.el); }
    this.buildHead();
    // no touch status line in the bundled panel (a line that appears above the oscillators on every touch pushes the panel down);
    // a stale one of VOICE's (parts view) goes too — the touch tip then does nothing here (sx-host touchTip)
    this.statusEl = null;
    this.pageBox = mk(this.d, 'div', 'sx-pages');
    this.el.appendChild(this.pageBox);
    this.buildFoot();
    this.installModLayer(this.el);
    this.initBrowser();
    // "Default WT view" (§9.7) for new tracks: the host creates them with withPrefs (os / author only), so a
    // sound that is still the untouched default opens in 3D when the preference says so (a view-only edit)
    if (this.prefs.view3d && s && s.ui && arr(s.ui.view3d).every(v => !v) && isPristine(s)) this.uiEdit(st => { st.ui.view3d = arr(st.ui.view3d).map(() => 1); });
    this.syncPreset();
    this.showPage(s && s.ui && PAGES.includes(s.ui.page) ? s.ui.page : 'osc');
  }
  // the bundled panel paints its header, the shown page and the keyboard foot (in that order, as before); (milestone 3)
  // without its shell, the host's views (the parts)
  allPages() { return this.pageBox ? [this.headPage, this.footPage].concat(PAGES.map(p => this.pages[p]).filter(Boolean)) : super.allPages(); }
  shownPages() { if (!this.pageBox) return super.shownPages(); const P = this.pages[this.page]; return [this.headPage].concat(P ? [P] : [], [this.footPage]); }
  rackShown() { return !!this.pageBox && this.page === 'fx'; }
  // (milestone 3) the shell is built (the bundled view)
  get bundled() { return !!this.pageBox; }
  destroyShell() {
    for (const x of [this.rack, this.mixer, this.kbd, this.seqPages.arp, this.seqPages.clip].concat(this.oscPanels || [])) {
      if (x && typeof x.destroy === 'function') { try { x.destroy(); } catch (err) { /* gone */ } }
    }
  }

  /* ---------------------------------------------------------------- header (§13.2) */
  // the wave icon, the logo and the page tabs, then VOICE's header (sx-ui-mod VoiceHeader): a view of the host whose page
  // is the header registry (headPage)
  buildHead() {
    this.mount((root, K) => {
      const d = this.d, tabs = mk(d, 'div', 'sx-tabs');
      tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', 'Synth pages');
      this.tabBtns = {};
      PAGES.forEach((p, i) => {
        const b = btn(d, 'sx-tab', PAGE_LABEL[p], null, () => this.setPage(p));
        b.setAttribute('role', 'tab');
        b.setAttribute('data-page', p);
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
      const V = new VoiceHeader(root, K, { lead: [logo(d), tabs] });
      this.head = V.el;
      this.headPage.el = V.el;
      return V;
    }, this.el, { inner: true, page: this.headPage, kind: 'head' });
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
      this.pageBox.appendChild(el);
      // the page is a view of the host (built under its own registry, shown while it is the page on screen)
      const V = this.mount(root => {
        if (p === 'osc') this.buildOsc(root);
        else if (p === 'mix') this.buildMix(root);
        else if (p === 'fx') this.buildFx(root);
        else if (p === 'matrix') this.buildMatrix(root);
        else if (p === 'arp' || p === 'clip') this.buildSeq(root, p);
        else this.buildGlobal(root);
        return null;
      }, el, { inner: true, kind: 'page:' + p, shown: () => this.page === p, keep: true });
      this.pages[p] = V.page;
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
  // the keyboard panel under every page (§13.9; sx-ui-seq KeyboardPanel), collapsible to a 40 px strip
  buildFoot() {
    this.footEl = mk(this.d, 'div', 'sx-foot');
    this.el.appendChild(this.footEl);
    this.footPage.el = this.footEl;
    if (typeof seq.KeyboardPanel !== 'function') return;
    this.mount(root => {
      try { this.kbd = new seq.KeyboardPanel(root, this.kit); } catch (err) { console.error('serum-ui: keyboard panel', err); this.kbd = null; }
      return null;
    }, this.footEl, { inner: true, page: this.footPage, kind: 'foot' });
  }
  // C1: the oscillator / filter a tabbed layout shows: the selected one (s.ui.oscTab / filtTab) unless it is folded
  // and another module of its column is not — then the one shown most recently that still is expanded (closing a
  // peek or undoing a power-on goes back to the tab that was showing), else the first expanded. Derived per paint,
  // never written back; the recent list (tabSeen) is this panel's view state only, as the peeks
  tabOf(kind) {
    const u = this.s().ui || {}, ids = kind === 'osc' ? OSC_P.map(p => p + '.on') : ['f.on', 'f2.on'];
    const sel = clamp((kind === 'osc' ? u.oscTab : u.filtTab) | 0, 0, ids.length - 1);
    const T = this.tabSeen || (this.tabSeen = {}), H = T[kind] || (T[kind] = []);
    if (this.foldOf(ids[sel]) !== 'fold') {
      if (H[0] !== sel) { const i = H.indexOf(sel); if (i >= 0) H.splice(i, 1); H.unshift(sel); }
      return sel;
    }
    const m = H.find(i => this.foldOf(ids[i]) !== 'fold');
    if (m !== undefined) return m;
    const k = ids.findIndex(id => this.foldOf(id) !== 'fold');
    return k < 0 ? sel : k;
  }
  toggleExpand() {
    if (this.page === 'fx' && this.rack) {
      if (typeof this.rack.toggleExpand === 'function') this.rack.toggleExpand();
      else if (typeof this.rack.expand === 'function') this.rack.expand();
    } else if (this.page === 'matrix') {
      this.mxExp = !this.mxExp;
      if (this.pages.matrix) this.pages.matrix.el.classList.toggle('sx-mxexp', this.mxExp);
    }
  }


  /* ================================================================ OSC page (§13.2, §13.3) */
  // row A: [SUB over NOISE] [OSC A] [OSC B] [OSC C] [FILTER 1 over FILTER 2] — the panels of sx-ui-osc (U2), bound
  // through the kit (§11.14). Narrow layouts (container widths, §13.2): below 1100 px one oscillator at a time (tabs
  // A · B · C with colour dots and power LEDs, s.ui.oscTab), below 1366 px one filter at a time (s.ui.filtTab).
  // Pressing an oscillator panel selects it (s.ui.osc: the Render OSC Warp / Resample target, §13.3.1).
  // C1: an off oscillator / SUB / NOISE / filter folds to a bar (kit.panel o.collapse); the tabs then choose among the
  // expanded ones (tabOf) and the folded ones always show as bars. data-rail-sn / -o / -f on row A = "1" while every
  // panel of that column is folded: from 768 px its track shrinks to vertical rails.
  buildOsc(el) {
    const d = this.d, K = this.kit;
    const rowA = mk(d, 'div', 'sx-row sx-rowA'), colSN = mk(d, 'div', 'sx-col sx-colSN');
    const colO = mk(d, 'div', 'sx-colO'), colF = mk(d, 'div', 'sx-col sx-colF');
    rowA.append(colSN, colO, colF);
    this.oscPanels = [];
    const cols = { sn: [], o: [], f: [] };   // C1: the power ids of each column's panels
    const mount = (f, box, col, id) => {
      try { const p = f(); this.oscPanels.push(p); if (p && p.el) cols[col].push(id); return p; } catch (err) { console.error('serum-ui: oscillator panel', err); box.appendChild(mk(d, 'p', 'sx-placeholder', 'Panel unavailable')); return null; }
    };
    mount(() => new osc.SubPanel(colSN, K), colSN, 'sn', 's.on');
    mount(() => new osc.NoisePanel(colSN, K), colSN, 'sn', 'n.on');
    colO.appendChild(this.panelTabs('osc'));
    for (let o = 0; o < N_OSC; o++) {
      const p = mount(() => new osc.OscPanel(colO, K, o), colO, 'o', OSC_P[o] + '.on');
      if (!p || !p.el) continue;
      p.el.classList.add('sx-opan');
      p.el.setAttribute('data-o', String(o));
      // pressing an oscillator selects it (s.ui.osc); its tab (s.ui.oscTab) only while it is expanded: a press on a
      // folded bar (its title's menu, a label drag, a two-finger gesture's first finger) never swaps the oscillator a
      // tabbed layout shows (C1). Powering it on or peeking from the bar shows it: the bubbling click, after the
      // toggle's / chevron's own (keyboard activation too). View edits of s.ui only: no undo re-top (noRebase)
      const pid = OSC_P[o] + '.on', tabIs = () => ((this.s().ui || {}).oscTab | 0) === o;
      const sel = () => {
        const live = this.foldOf(pid) !== 'fold';
        if (this.selOsc() !== o || (live && !tabIs())) this.uiEdit(s => { s.ui.osc = o; if (live) s.ui.oscTab = o; }, { noRebase: true });
      };
      p.el.addEventListener('pointerdown', sel, true);
      p.el.addEventListener('click', sel, true);
      p.el.addEventListener('click', () => { if (this.foldOf(pid) !== 'fold' && !tabIs()) this.uiEdit(s => { s.ui.oscTab = o; }, { noRebase: true }); });
    }
    colF.appendChild(this.panelTabs('filt'));
    for (let k = 0; k < 2; k++) {
      const p = mount(() => new osc.FilterPanel(colF, K, k), colF, 'f', k ? 'f2.on' : 'f.on');
      if (!p || !p.el) continue;
      p.el.classList.add('sx-fpan');
      p.el.setAttribute('data-f', String(k));
      // C1: pressing an expanded filter selects its tab; a folded bar's press leaves it (as the oscillators'); powering
      // on or peeking from the bar shows it (the bubbling click, after the toggle's / chevron's own). No undo re-top
      const pid = k ? 'f2.on' : 'f.on';
      const pick = () => { if (this.foldOf(pid) !== 'fold' && ((this.s().ui || {}).filtTab | 0) !== k) this.uiEdit(s => { s.ui.filtTab = k; }, { noRebase: true }); };
      p.el.addEventListener('pointerdown', pick, true);
      p.el.addEventListener('click', pick, true);
      p.el.addEventListener('click', pick);
    }
    this.custom(() => {
      const ot = String(this.tabOf('osc')), ft = String(this.tabOf('filt')), so = this.selOsc();
      if (colO.getAttribute('data-tab') !== ot) colO.setAttribute('data-tab', ot);
      if (colF.getAttribute('data-tab') !== ft) colF.setAttribute('data-tab', ft);
      for (const k in cols) {
        const L = cols[k], v = L.length && L.every(id => this.foldOf(id) === 'fold') ? '1' : '0', a = 'data-rail-' + k;
        if (rowA.getAttribute(a) !== v) rowA.setAttribute(a, v);
      }
      for (const p of this.oscPanels) if (p && p.el && p.el.hasAttribute('data-o')) p.el.classList.toggle('sx-osel', +p.el.getAttribute('data-o') === so);
    });
    el.append(rowA, this.tileStrip(), this.rowC());
  }
  // oscillator / filter tab pair of the narrow layouts: colour dot + power LED (lit = module on)
  panelTabs(kind) {
    const d = this.d, bar = mk(d, 'div', 'sx-ptabs');
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', kind === 'osc' ? 'Oscillator' : 'Filter');
    const n = kind === 'osc' ? N_OSC : 2, bs = [];
    for (let k = 0; k < n; k++) {
      const label = kind === 'osc' ? 'OSC ' + OSC_L[k] : 'FILTER ' + (k + 1), power = kind === 'osc' ? OSC_P[k] + '.on' : k ? 'f2.on' : 'f.on';
      const b = btn(d, 'sx-ptab', '', label, () => this.uiEdit(s => {
        if (kind === 'osc') { s.ui.oscTab = k; s.ui.osc = k; } else s.ui.filtTab = k;
      }, { noRebase: true }));
      b.setAttribute('role', 'tab');
      b.setAttribute(kind === 'osc' ? 'data-o' : 'data-f', String(k));
      const dot = mk(d, 'span', 'sx-dot');
      dot.setAttribute('aria-hidden', 'true');
      b.append(dot, mk(d, 'span', '', kind === 'osc' ? OSC_L[k] : String(k + 1)));
      bs.push({ b, power });
      bar.appendChild(b);
    }
    // C1: tabs choose among the expanded (live or peeked) modules: a folded module shows as its bar instead of a tab,
    // and the strip shows only while two or more are expanded
    this.custom(() => {
      const sel = this.tabOf(kind), fk = bs.findIndex(x => x.b === d.activeElement);
      let n = 0;
      bs.forEach(({ b, power }, k) => {
        const f = this.foldOf(power) === 'fold';
        if (!f) n++;
        b.setAttribute('aria-selected', k === sel ? 'true' : 'false');
        b.classList.toggle('sx-pon', destOf(power) ? this.getN(power) >= 0.5 : false);
        b.classList.toggle('sx-hidden', f);
      });
      bar.classList.toggle('sx-hidden', n < 2);
      // a focused tab that hides keeps focus near: the selected tab while the strip shows, else its module's power
      if (fk >= 0 && (n < 2 || bs[fk].b.classList.contains('sx-hidden'))) {
        const col = bar.parentNode, t = n >= 2 ? bs[sel].b : col && col.querySelector ? col.querySelector('[data-dest="' + bs[fk].power + '"]') : null;
        if (t && t.focus) t.focus({ preventScroll: true });
      }
    });
    return bar;
  }
  // row C: [MACROS 1–8] [ENV 1–4] [LFO / VELO / NOTE] [VOICING] (OSC, MIX and FX pages, §13.2) — sx-ui-mod's panels,
  // the classes a Serum's parts and the canvas modulators mount (the bundled forms: ENV with its tabs, the LFO editor
  // with the selected LFO / VELO / NOTE)
  rowC() {
    const r = mk(this.d, 'div', 'sx-row sx-rowC'), K = this.kit;
    new MacrosPanel(r, K);
    new EnvPanel(r, K);
    new LfoPanel(r, K);
    new VoicingPanel(r, K);
    return r;
  }

  /* ---------------------------------------------------------------- tile strip (row B, §13.13) */
  tileStrip() {
    const d = this.d, el = mk(d, 'div', 'sx-tiles'), lfo = [];
    el.setAttribute('role', 'toolbar');
    el.setAttribute('aria-label', 'Modulation sources (drag onto a control)');
    for (let e = 1; e <= N_ENV; e++) el.appendChild(this.makeTile('env' + e, () => 'ENV ' + e));
    for (let l = 1; l <= N_LFO; l++) { const t = this.makeTile('lfo' + l, () => 'LFO ' + l); lfo.push(t); el.appendChild(t); }
    el.append(this.makeTile('velo', () => 'VELO'), this.makeTile('note', () => 'NOTE'), this.makeTile('wheel', () => 'WHEEL'));
    // Macro tiles 1–8 (labels = the macro names; §13.13, §3.10): drag onto a control, the matrix or another macro tile
    // (swap) — on every page with the strip, the MATRIX page included
    for (let m = 1; m <= N_MAC; m++) {
      el.appendChild(this.makeTile('macro' + m, () => { const M = this.s().macros[m - 1]; return (M && M.name) || 'Macro ' + m; }, 'sx-mtile'));
    }
    this.custom(() => {
      const s = this.s(), n = Math.max(lfoTileCount(s), lfoNum(s.ui.mod), lfoNum(this.edSel));
      lfo.forEach((t, l) => t.classList.toggle('sx-hidden', l + 1 > n));
    });
    return el;
  }

  /* ================================================================ MIX page (§13.4; sx-ui-mix MixerPage, U3) */
  buildMix(el) {
    const d = this.d, box = mk(d, 'div', 'sx-mixbox'), P = this.bp;
    box.appendChild(mk(d, 'p', 'sx-placeholder', 'Loading the mixer…'));
    el.append(box, this.tileStrip(), this.rowC());
    const fail = msg => { if (!this.dead) { box.textContent = ''; box.appendChild(mk(d, 'p', 'sx-placeholder', msg)); } };
    this.mixReady = loadMix().then(M => {
      if (this.dead) return;
      if (!M || typeof M.MixerPage !== 'function') { fail('Mixer unavailable'); return; }
      box.textContent = '';
      const prev = this.bp;
      this.bp = P;
      try { this.mixer = new M.MixerPage(box, this.kit); } catch (err) { console.error('serum-ui: mixer', err); fail('The mixer could not be shown'); } finally { this.bp = prev; }
      if (this.page === 'mix') { this.edDirty = true; this.paint(true); }
    }, err => { warnOnce('mix', 'serum-ui: sx-ui-mix.js not available', err); fail('Mixer unavailable'); });
  }

  /* ================================================================ FX page (§13.5; fx-ui FXRackUI v2, U3) */
  buildFx(el) {
    const d = this.d, box = mk(d, 'div', 'sx-fxbox'), R = fxui.FXRackUI;
    if (typeof R === 'function') {
      const adapter = {
        fx: () => this.fx(),
        editFx: (fn, o) => this.editFx(fn, o, true),
        bpm: () => this.bpm(),
        gr: () => (this.smon && this.smon.gr ? this.smon.gr : null),
        tap: () => (this.smon && this.smon.ftap ? this.smon.ftap : null),   // the rack's monitor tap (§13.5 Delay overlay)
        setTap: inst => { if (typeof this.host.fxTap === 'function') this.host.fxTap(inst); },
        locked: id => arr(this.s().locks.p).includes(id),
        storage: this.host.storage,
        notify: t => this.notify(t),
        tip: id => this.tipText(id) || null, // FX knob tooltips with Serum's modulator lines (RULINGS host additions)
        racks: () => 3,                      // MAIN · BUS 1 · BUS 2 (§11.15)
        irs: this.host.smp || null,          // Convolve impulse responses
        s: () => this.s(),                   // rows / locks of the Serum state (instance removal, §11.2)
        edit: (fn, o) => this.edit(fn, o),
        scSources: () => (typeof this.host.scSources === 'function' ? this.host.scSources() : null), // (IMPL-SC §6.4 d: the sidechain source menus)
      };
      const ro = { embedded: true, dsp: globalThis.FXDSP || null, racks: 3, mod: true };
      if (typeof this.host.fxCost === 'function') ro.cost = t => this.host.fxCost(t); // (the "+" menu's load estimates: the host's)
      try { this.rack = new R(box, adapter, ro); }
      catch (err) { console.error('serum-ui: FX rack', err); box.appendChild(mk(d, 'p', 'sx-placeholder', 'FX rack unavailable')); }
    } else box.appendChild(mk(d, 'p', 'sx-placeholder', 'FX rack unavailable'));
    el.append(box, this.tileStrip(), this.rowC());
  }

  /* ================================================================ ARP / CLIP pages (§13.7, §13.8; sx-ui-seq, U4) */
  buildSeq(el, kind) {
    const d = this.d, bar = mk(d, 'div', 'sx-pagebar'), box = mk(d, 'div', 'sx-seqbox');
    const C = kind === 'arp' ? seq.ArpPage : seq.ClipPage;
    if (typeof C === 'function') {
      try { this.seqPages[kind] = new C(box, this.kit); } catch (err) { console.error('serum-ui: ' + kind, err); box.appendChild(mk(d, 'p', 'sx-placeholder', 'Page unavailable')); }
    } else box.appendChild(mk(d, 'p', 'sx-placeholder', 'Page unavailable'));
    // macros pane toggle (§13.2: own lower layout; the macros pane shows on demand) — unless the page brings its own
    // (the CLIP page's macro knobs write their clip lanes while recording, §13.8)
    const own = box.querySelector && box.querySelector('[data-sec="macros"]');
    if (own) { el.append(box); return; }
    const mac = new MacrosPanel(null, this.kit).el;
    const tg = this.pToggle({ label: 'MACROS', kind: 'btn', get: () => (this.macPane[kind] ? 1 : 0),
      set: v => { this.macPane[kind] = !!v; this.queue(); } });
    tg.el.title = 'Show the macros pane';
    this.custom(() => mac.classList.toggle('sx-hidden', !this.macPane[kind]));
    bar.append(mk(d, 'span', 'sx-grow'), tg.el);
    el.append(bar, box, mac);
  }


  /* ================================================================ MATRIX page (§13.6, inv B18): 64 rows */
  buildMatrix(el) {
    const d = this.d, { el: pan, head, body } = this.panel('MATRIX', 'matrix');
    const mb = btn(d, 'sx-hbtn', icon(d, 'more'), 'Matrix menu', () => this.matrixMenu(mb));
    mb.setAttribute('aria-haspopup', 'menu');
    const exp = this.pToggle({ label: 'EXPAND', kind: 'btn', get: () => (this.mxExp ? 1 : 0), set: () => this.toggleExpand() });
    exp.el.title = 'Expand the matrix (Alt/Option-F)';
    head.append(mk(d, 'span', 'sx-grow'), exp.el, mb);
    const hd = mk(d, 'div', 'sx-mhd');
    hd.setAttribute('aria-hidden', 'true');
    for (const t of ['', '#', 'SOURCE', 'CRV', 'AMOUNT', 'POL', 'DESTINATION', 'OUT', 'AUX SOURCE', 'INV', 'CRV', 'OUTPUT', 'BYP', '']) hd.appendChild(mk(d, 'span', '', t));
    const list = mk(d, 'div', 'sx-mx');
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', 'Modulation matrix, ' + N_MX + ' slots');
    for (let slot = 0; slot < N_MX; slot++) list.appendChild(this.matrixRow(slot));
    this.mxList = list;
    body.append(hd, list);
    // (SYNTH Canvas 2b, U6) the host's extraMatrix(): the canvas cables compiled into this Serum (an ext slot, an injected
    // PER NOTE LFO / ENV slot, a native source) — read-only rows under the slots: the slot tag, the host's source label,
    // amount, polarity, destination, BYP; edited on the canvas, not here. Rebuilt when their signature changes.
    if (typeof this.host.extraMatrix === 'function') {
      const cvl = mk(d, 'div', 'sx-mcv');
      cvl.setAttribute('role', 'list');
      cvl.setAttribute('aria-label', 'Canvas cables on this Serum');
      let sig = '';
      this.custom(() => {
        let rows = [];
        try { rows = arr(this.host.extraMatrix()).filter(r => isObj(r) && r.id != null); } catch (err) { rows = []; }
        const s = this.s(), fx = this.fx(), lab = id => { try { return core.destLabel(id, s, fx); } catch (err) { return String(id); } };
        const k = rows.map(r => [r.id, r.tag, r.label, r.src, r.dst, r.amt, r.bi, r.byp, r.out].join('\t')).join('\n');
        if (k === sig) return;
        sig = k;
        cvl.textContent = '';
        for (const r of rows) {
          const row = mk(d, 'div', 'sx-mcrow' + (r.byp ? ' sx-dim' : ''));
          row.setAttribute('role', 'listitem');
          row.setAttribute('data-mrow', String(r.id));
          const a = fin(+r.amt) ? +r.amt : 0;
          row.append(mk(d, 'span', 'sx-mn', String(r.tag || '')), mk(d, 'span', 'sx-msrc', String(r.label || srcLabel(s, r.src))), mk(d, 'span', 'sx-mamt', sgn(a) + Math.round(a * 100) + '%'),
            mk(d, 'span', 'sx-mpol', r.bi ? '↔' : '→'), mk(d, 'span', 'sx-mdst', lab(r.dst)), mk(d, 'span', 'sx-mbyp', r.byp ? 'BYP' : ''));
          row.title = 'A canvas cable (edit it on the canvas)';
          cvl.appendChild(row);
        }
        cvl.classList.toggle('sx-hidden', !rows.length);
      });
      body.append(cvl);
    }
    el.append(pan, this.tileStrip());
  }
  matrixMenu(anchor) {
    const r = anchor.getBoundingClientRect(), s = this.s(), locked = arr(s.locks.mod).includes('matrix');
    wk.contextMenu(r.left, r.bottom + 2, [
      { label: 'Sort by Source', action: () => { if (this.need('sortMatrix')) this.edit(st => core.sortMatrix(st, 'src'), { label: 'Sort matrix' }); } },
      // destination-menu order: FX rows follow the rack / instance order of the track's FX state (§5.8)
      { label: 'Sort by Destination', action: () => { if (this.need('sortMatrix')) { const fx = this.fx(); this.edit(st => core.sortMatrix(st, 'dst', fx), { label: 'Sort matrix' }); } } },
      { label: 'Lock Matrix', checked: locked, action: () => this.lockModuleUI('matrix') },
      { sep: true },
      { label: 'Create Vibrato', action: () => this.vibrato() },
      { label: 'Create Velo->Amp', action: () => this.veloAmp() },
      { sep: true },
      { label: 'Apply and Delete Macros', action: () => this.confirmDlg('Apply and Delete Macros', 'Add every macro modulation at the macros\' current values to the controls, then delete the macro rows?', () => {
        if (!this.need('applyMacros')) return;
        const fx = this.fx();
        let n = 0;
        this.edit(st => { n = core.applyMacros(st, fx); }, { label: 'Apply and Delete Macros' });
        if (fx) this.editFx(() => {}, { label: 'Apply and Delete Macros' });   // the FX bases applyMacros wrote
        this.notify(n ? 'Applied ' + n + ' macro row' + (n > 1 ? 's' : '') : 'No macro rows');
      }) },
      { label: 'Init Modulations', action: () => this.confirmDlg('Init Modulations', 'Remove every modulation row and LFO point link?', () => {
        if (this.need('initMods')) { this.edit(st => core.initMods(st), { label: 'Init Modulations' }); this.edDirty = true; }
      }) },
    ], { anchor });
  }
  destItems() {
    if (this.dstT !== this.paintSeq || !this.dstC) {
      const items = [{ v: '', label: '—', group: '' }];
      for (const g of this.destGroups()) for (const x of g.items) items.push({ v: x.id, label: x.label, group: g.group });
      this.dstC = items;
      this.dstT = this.paintSeq;
    }
    return this.dstC;
  }
  srcItems() {
    if (this.srcT !== this.paintSeq || !this.srcC) {
      const items = [{ v: '', label: '—', group: '' }];
      for (const g of srcGroups(this.s())) for (const x of g.items) items.push({ v: x.id, label: x.label, group: g.group });
      this.srcC = items;
      this.srcT = this.paintSeq;
    }
    return this.srcC;
  }
  // one row (§13.6): handle (drag = reorder; click = row menu) · # · SOURCE · CRV · AMOUNT · POL · DESTINATION (≈ for
  // aliased S1-pair rows; red for deleted FX instances / not modulatable) · OUT (live mAmt·x, snapshot.mOut) · AUX
  // SOURCE · INV · aux CRV · OUTPUT · bypass · remove
  matrixRow(slot) {
    const d = this.d, R = () => this.s().matrix[slot];
    const row = mk(d, 'div', 'sx-mrow');
    row.setAttribute('role', 'listitem');
    row.setAttribute('aria-label', 'Slot ' + (slot + 1));
    row.setAttribute('data-mslot', String(slot));
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
    if (wk.tooltip) wk.tooltip(amt.el, () => 'Amount ' + pct(R().amt) + ' (type a percentage, or 12st on pitch destinations; Cmd/Ctrl-click resets)');
    const native = typeof wk.slider === 'function';   // wk.slider shows its value and takes typed entry itself
    const amtV = native ? null : this.valBox(() => pct(R().amt), t => parseAmount(t, R().dst, R().bi),
      a => this.edit(s => core.setModAmount(s, slot, a), { label: 'Matrix amount' }), 'Amount: percent, or semitones (12st) on pitch destinations');
    const out = this.slider({ label: 'Output', get: () => R().out, def: 1, bipolar: false, orient: 'h', fmt: n => Math.round(n * 100) + '%',
      parse: t => { const m = /^\s*(\d+(?:[.,]\d+)?)\s*%?\s*$/.exec(String(t)); return m ? clamp01(parseFloat(m[1].replace(',', '.')) / 100) : null; },
      set: (n, ph) => this.edit(s => { s.matrix[slot].out = Math.round(clamp01(n) * 1e4) / 1e4; }, { label: 'Matrix output', phase: ph || 'set' }) });
    const outV = native ? null : this.valBox(() => Math.round(R().out * 100) + '%', t => { const m = /^\s*(\d+(?:[.,]\d+)?)\s*%?\s*$/.exec(String(t)); return m ? clamp01(parseFloat(m[1].replace(',', '.')) / 100) : null; },
      v => this.edit(s => { s.matrix[slot].out = v; }, { label: 'Matrix output' }), 'Output (percent)');
    const pol = this.mBtn(() => (R().bi ? '↔' : '→'), () => this.edit(s => { const r = s.matrix[slot]; r.bi = r.bi ? 0 : 1; }, { label: 'Matrix polarity' }),
      () => 'Polarity: ' + (R().bi ? 'bipolar' : 'unipolar'));
    const inv = this.mBtn(() => (R().inv ? 'INV' : 'inv'), () => this.edit(s => { const r = s.matrix[slot]; r.inv = r.inv ? 0 : 1; }, { label: 'Aux invert' }),
      () => 'Aux invert ' + (R().inv ? 'on' : 'off') + '; Alt-click toggles bypass');
    this.custom(() => inv.classList.toggle('sx-on', !!R().inv));
    const byp = this.pToggle({ label: 'Bypass', kind: 'led', get: () => R().byp, set: v => this.edit(s => { s.matrix[slot].byp = v ? 1 : 0; }, { label: 'Matrix bypass' }) });
    const del = btn(d, 'sx-hbtn', icon(d, 'close'), 'Remove slot ' + (slot + 1), () => this.edit(s => { s.matrix[slot] = emptyRow(); }, { label: 'Remove modulation' }));
    const handle = btn(d, 'sx-mh', icon(d, 'grip'), 'Slot ' + (slot + 1) + ': drag to reorder, click for the row menu', () => this.rowMenu(slot, handle));
    this.rowDrag(handle, slot);
    const ac = mk(d, 'div', 'sx-mamt'), oc = mk(d, 'div', 'sx-mout');
    ac.append(amt.el); oc.append(out.el);
    if (amtV) ac.appendChild(amtV);
    if (outV) oc.appendChild(outV);
    const dst = cell('sx-mdst', mmenu('Destination', 'dst')), alias = mk(d, 'span', 'sx-alias', '≈');
    alias.title = 'Aliased: this row targets the other mode\'s field of an S1 pair (compiled against the active field)';
    dst.appendChild(alias);
    // OUT: the row's live output of the recent voice (snapshot.mOut, §6.20)
    const og = mk(d, 'span', 'sx-mout-g'), ob = mk(d, 'i');
    og.appendChild(ob);
    og.setAttribute('role', 'img');
    og.setAttribute('aria-label', 'Live output');
    const live = () => {
      const mo = this.snap && this.snap.mOut, v = mo && mo.length > slot && fin(mo[slot]) ? clamp(mo[slot], -1, 1) : 0;
      const k = Math.round(v * 100);
      if (og.lastK === k) return;
      og.lastK = k;
      ob.style.left = (50 + Math.min(0, k) / 2) + '%';
      ob.style.width = (Math.abs(k) / 2) + '%';
    };
    (this.bp || this.headPage).lives.push(on => { if (on) live(); });   // no DOM writes while the MATRIX page is hidden
    row.append(handle, mk(d, 'span', 'sx-mn', String(slot + 1)),
      cell('sx-msrc sx-mslot', mmenu('Source', 'src'), { 'data-msrc': 'src', 'data-slot': slot, 'data-malt': 'src' }),
      cell('sx-mcrv', this.curveCell(slot, 'curve')), ac, cell('sx-mpol', pol), dst, cell('sx-mo', og),
      cell('sx-maux sx-mslot', mmenu('Aux source', 'aux'), { 'data-msrc': 'aux', 'data-slot': slot }),
      cell('sx-minv', inv, { 'data-malt': 'mode', 'data-slot': slot }), cell('sx-macrv', this.curveCell(slot, 'acurve')),
      oc, cell('sx-mbyp', byp.el), cell('sx-mx-x', del));
    this.custom(() => {
      const r = R(), s = this.s();
      row.classList.toggle('sx-dim', !rowActive(r));
      row.classList.toggle('sx-bad', rowBad(this.fx(), r));
      alias.classList.toggle('sx-hidden', !rowAlias(s, r));
      del.classList.toggle('sx-hidden', !r.src && !r.dst);
      live();
    });
    return row;
  }
  // drag the handle onto another row: the row moves there (the rows between shift by one, §13.6). A finger keeps the
  // 250 ms hold (wk.dragSource without scrollAxis): the handles line the scrolling matrix list, so a swipe over them
  // reorders nothing
  rowDrag(handle, slot) {
    if (typeof wk.dragSource !== 'function') return;
    let line = null;
    const target = i => { const t = closest(i.target, '[data-mslot]'); return t && this.mxList && this.mxList.contains(t) ? t : null; };
    const clear = () => { if (line) { line.classList.remove('sx-dropline'); line = null; } };
    const ds = wk.dragSource(handle, {
      data: slot,
      move: i => { const t = target(i); if (t !== line) { clear(); line = t; if (t) t.classList.add('sx-dropline'); } },
      drop: i => {
        const t = target(i);
        clear();
        if (!t) return;
        const to = +t.getAttribute('data-mslot');
        if (to === slot) return;
        if (i.alt) { this.edit(s => { s.matrix[to] = clone(s.matrix[slot]); }, { label: 'Copy modulation' }); return; }
        this.edit(s => { const M = s.matrix, r = M.splice(slot, 1)[0]; M.splice(to, 0, r); }, { label: 'Move modulation' });
      },
      cancel: clear,
    });
    this.offNow(() => ds.destroy());
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
  // CRV / aux CRV columns: thumbnail of the curve (bend(·, MC_K·c), or the Editable Curve of the row); drag vertically
  // (200 px = −1…+1; on an editable curve the drag is off), double-click / double-tap opens the editor (CRV) or resets
  // (aux CRV); grey while the row is bypassed
  curveCell(slot, field) {
    const d = this.d, aux = field === 'acurve', sv = svgEl(d, 'svg', { class: 'sx-crv', viewBox: '0 0 36 22', tabindex: '0', role: 'slider',
      'aria-label': aux ? 'Aux curve' : 'Curve', 'aria-valuemin': '-100', 'aria-valuemax': '100' });
    const path = svgEl(d, 'path', { d: '' });
    sv.appendChild(path);
    const R = () => this.s().matrix[slot];
    let last = null, g = null;
    this.custom(() => {
      const r = R(), c = r[field] || 0, crv = !aux && Array.isArray(r.crv) && r.crv.length >= 2 ? r.crv : null;
      const k = (crv ? JSON.stringify(crv) : c) + '|' + (r.byp ? 1 : 0);
      if (k === last) return;
      last = k;
      let dd = '';
      for (let j = 0; j <= 18; j++) {
        const t = j / 18, y = crv && typeof core.evalPts === 'function' ? core.evalPts(crv, t) : core.bend(t, MC_K * c);
        dd += (j ? 'L' : 'M') + (2 + 32 * t).toFixed(2) + ' ' + (20 - 18 * clamp01(y)).toFixed(2);
      }
      path.setAttribute('d', dd);
      sv.setAttribute('aria-valuenow', String(Math.round(c * 100)));
      sv.classList.toggle('sx-edc', !!crv);
      sv.classList.toggle('sx-grey', !!r.byp);
    });
    const put = (c, ph) => this.edit(s => { s.matrix[slot][field] = Math.round(clamp(c, -1, 1) * 1e4) / 1e4; }, { label: aux ? 'Aux curve' : 'Matrix curve', phase: ph });
    sv.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      if (!aux && Array.isArray(R().crv)) return;
      e.preventDefault();
      g = { id: e.pointerId, y: e.clientY, c0: R()[field] || 0, acc: 0, moved: false };
      try { sv.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
    });
    sv.addEventListener('pointermove', e => {
      if (!g || e.pointerId !== g.id) return;
      g.acc += (g.y - e.clientY) * (e.shiftKey ? 0.1 : 1) / 100;
      g.y = e.clientY;
      if (!g.moved && Math.abs(g.acc) > 0.02) { g.moved = true; put(g.c0, 'start'); }
      if (g.moved) put(g.c0 + g.acc, 'move');
    });
    const up = e => {
      if (!g || e.pointerId !== g.id) return;
      const G = g;
      g = null;
      if (!G.moved) return;
      if (twoF(e)) { G.acc = 0; put(G.c0, 'move'); }   // two-finger rollback: the curve from before
      put(G.c0 + G.acc, 'end');
    };
    sv.addEventListener('pointerup', up);
    sv.addEventListener('pointercancel', up);
    sv.addEventListener('dblclick', e => { e.preventDefault(); if (aux) put(0, 'set'); else this.openCurve(slot, sv); });
    sv.addEventListener('keydown', e => {
      const k = e.key, c = R()[field] || 0;
      if (k === 'ArrowUp' || k === 'ArrowRight') { e.preventDefault(); put(c + (e.shiftKey ? 0.01 : 0.05), 'set'); }
      else if (k === 'ArrowDown' || k === 'ArrowLeft') { e.preventDefault(); put(c - (e.shiftKey ? 0.01 : 0.05), 'set'); }
      else if (k === 'Delete' || k === 'Backspace' || k === 'Home') { e.preventDefault(); put(0, 'set'); }
      else if (k === 'Enter' && !aux) { e.preventDefault(); this.openCurve(slot, sv); }
    });
    return sv;
  }
  rowMenu(slot, anchor) {
    const r = anchor.getBoundingClientRect(), s = this.s();
    const swap = (a, b) => this.edit(st => { const t = st.matrix[a]; st.matrix[a] = st.matrix[b]; st.matrix[b] = t; }, { label: 'Move modulation' });
    const items = [
      { label: 'Edit Custom Curve', action: () => this.openCurve(slot, anchor) },
      { label: 'Clear', action: () => this.edit(st => { st.matrix[slot] = emptyRow(); }, { label: 'Clear modulation' }) },
      { label: 'Duplicate', action: () => {
        const free = this.s().matrix.findIndex(x => !x.src);
        if (free < 0) { this.notify('Matrix full (' + N_MX + ' slots)'); return; }
        this.edit(st => { st.matrix[free] = clone(st.matrix[slot]); }, { label: 'Duplicate modulation' });
      } },
    ];
    if (slot > 0) items.push({ label: 'Move Up', action: () => swap(slot, slot - 1) });
    if (slot < s.matrix.length - 1) items.push({ label: 'Move Down', action: () => swap(slot, slot + 1) });
    wk.contextMenu(r.left, r.bottom + 2, items, { anchor });
  }


  /* ================================================================ GLOBAL page (§13.10, inv B24, B20) */
  buildGlobal(el) {
    const grid = mk(this.d, 'div', 'sx-gl'), K = this.kit;
    new QualityPanel(grid, K);
    new TuningPanel(grid, K);
    new MpePanel(grid, K);
    new VcPanel(grid, K);
    for (let o = 0; o < N_OSC; o++) grid.appendChild(this.unisonPanel(o));
    grid.appendChild(this.chaosPanel());
    new PrefsPanel(grid, K);
    new InfoPanel(grid, K);
    el.appendChild(grid);
  }
  // UNISON A / B / C: the gear popover's contents for every oscillator (§13.10)
  unisonPanel(o) {
    const d = this.d, P = OSC_P[o], p = this.panel('UNISON ' + OSC_L[o]), s0 = () => this.s();
    const range = this.pNum({ label: 'RANGE', min: 0, max: 48, step: 0.01, def: 2, px: 240, get: () => s0().osc[o].uni.range,
      fmt: v => v.toFixed(2) + ' st', parse: t => { const m = /^\s*(\d+(?:[.,]\d+)?)/.exec(String(t)); return m ? parseFloat(m[1].replace(',', '.')) : null; },
      set: (v, ph) => this.edit(s => { s.osc[o].uni.range = v; }, { label: 'Unison range ' + OSC_L[o], phase: ph }) });
    const tun = this.bind(wk.menu({ label: 'MODE', items: () => UNI_MODES.map((m, i) => ({ v: i, label: typeof m === 'string' ? m : m.name || String(m) })),
      get: () => s0().osc[o].uni.mode, set: v => this.edit(s => { s.osc[o].uni.mode = v; }, { label: 'Unison mode ' + OSC_L[o] }) }));
    const kn = (id, label) => (destOf(id) ? this.dKnob(id, label, { size: 'sm' }).el : null);
    p.body.append(this.row(range.el, kn(P + '.uniw', 'WIDTH'), kn(P + '.uniwarp', 'WARP'), kn(P + '.uniwarp2', 'WARP 2'), kn(P + '.uniwt', 'WT POS')),
      this.row(this.dMenu(P + '.stack', 'STACK', () => this.enumItems(P + '.stack', UNI_STACKS.map(x => (typeof x === 'string' ? x : x.name || String(x))))).el, tun.el));
    return p.el;
  }
  // CHAOS (S1): shown in S1 mode or while a row reads a chaos source; Convert to Chaos LFOs (deviation 22). Its two
  // rows are sx-ui-mod's ChaosRow (the canvas Chaos module's panel)
  chaosPanel() {
    const d = this.d, p = this.panel('CHAOS (S1)'), s0 = () => this.s();
    const used = () => rowsOf(s0()).some(r => r && (/^chaos[12]$/.test(r.src) || /^chaos[12]$/.test(r.aux)));
    for (const c of [0, 1]) p.body.appendChild(ChaosRow.row(this.kit, c));
    const conv = btn(d, 'sx-btn', 'Convert to Chaos LFOs', 'Move the chaos sources to free LFOs of the Chaos types (approximate)', () => this.confirmDlg('Convert to Chaos LFOs',
      'Each chaos source moves to a free LFO set to Chaos: Rossler (Chaos 1) or Chaos: Lorenz (Chaos 2). The output scaling differs slightly; S&H settings are dropped.', () => {
        if (!this.need('chaosToLfo')) return;
        const next = core.chaosToLfo(this.s(), this.bpm());   // BPM-synced chaos rates map at the project tempo
        this.edit(s => { const ui = s.ui; this.replaceState(s, next); s.ui = ui; }, { label: 'Convert to Chaos LFOs' });
        this.edDirty = true;
      }));
    this.custom(() => { p.el.classList.toggle('sx-hidden', !s1On(s0()) && !used()); conv.disabled = !used(); });
    p.body.appendChild(this.row(conv));
    return p.el;
  }
}
