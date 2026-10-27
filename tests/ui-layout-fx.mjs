// tests/ui-layout-fx.mjs — the FX look's layout gate (G11's sibling; the user, 2026-10-26: "make this effects panel in the style of
// wavecraft as well"): every effect type and variant's face (fx-ui FX_FACE on the RIG grid, rig-grid.js) mounted by the app's own
// FXRackUI in the canvas's FX module (a .cv-mod[data-cv-fx] in #world[data-cv-skin="charcoal"]: the real style.css, its skin and
// chrome), measured from getBoundingClientRect in world px (100 %): the face's width (64 · 8 + 32, on the 32 px dots) and every row's
// top and height against layoutOf, every knob / switch row centred on the face (an odd row half a column in), every knob's SVG 40 × 40
// on its cell's centre (the column pitch) and on its row's knob line, every control inside the
// inner area, every text box ≥ 6 px from the face edge and from every control box (its own excepted), ≥ 8 px from every other text box
// (a cell's label / value stack is one; a compound control's own parts too), nothing clipped (a name in a growing menu excepted: it
// ellipsizes), the font-size minima (labels 11, values 10, head 12), the fill ratio (control ∪ screen ∪ text over the face) in
// GRID.fill, label and value contrast ≥ 4.5 : 1, the data-dest parity with the classic panel of the same instance (the same state in a
// rack mounted beside it, hidden, look: 'classic'), the element counts; the rack's chrome (its bar, its list rows, + Add) on the same
// numbers, a press 1–2 px inside a list row's edge landing in that row; the behaviour of the re-lays in the real browser (the keyboard
// focus kept through a reverb TYPE stepped by its arrows and a MULTIBAND switch, a dimmed cell's member inert, the X-Shaper popover
// over whole rows; every state put back). Then the contact sheets: a PNG per size of every face, and (--faces) one per module.
//   CHROME=<Chrome for Testing> node --max-old-space-size=2048 tests/ui-layout-fx.mjs [--out <dir>] [--narrow] [--sizes d,l,p] [--faces] [--json]
//     sizes: d 1440 × 900 (mouse) · l 1366 × 1024 and p 1024 × 1366 (touch), dpr 2; --narrow: each size twice (Inter alone, then the
//     bundled Archivo Narrow), as G11. Chrome: $CHROME, else the repo's Chrome for Testing (.claude/test-browser, looked for from the
//     repo up); its profile a temporary directory under $FX_PROFILE (default the OS temp); exit 1 on any failure.
// Not a node --test file (not in the sweep): a CDP harness like ui-layout-wc.mjs. Nothing at module top level touches node or the DOM.

/* ================================================================ the page side (browser) */
const MIN = { lab: 11, val: 10, sw: 11, head: 12 };
const lum = c => { const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(c || ''); if (!m) return null; const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(+m[1]) + 0.7152 * f(+m[2]) + 0.0722 * f(+m[3]); };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return x == null || y == null ? null : (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const PAGE_CSS = `
html, body { margin: 0; background: #0c0d0f; }
#world { position: relative !important; inset: auto !important; width: auto !important; height: auto !important; transform: none !important; display: flex; flex-wrap: wrap; align-items: flex-start; gap: 40px 32px; padding: 32px; --ik: 1; }
#world .cv-mod { position: relative !important; left: auto !important; top: auto !important; }
#sheetTitle { color: #9c978a; font: 500 13px var(--ui); padding: 20px 32px 0; }
#classic { position: absolute; left: -30000px; top: 0; visibility: hidden; }
`;
// the scenes: modules of instances, each instance a face to measure — [type, variant, { p: values, sub, byp, ui }, the case's name]
const SCENES = [
  { key: 'mod', title: 'Effects · modulation, drive', racks: 3, insts: [
    ['hyper', 1, {}, 'Hyper/Dimension'], ['dist', 2, {}, 'Distortion (Tube)'], ['dist', 2, { p: { mode: 16 / 17, stages: 7 / 15 } }, 'Distortion Overdrive'],
    ['dist', 2, { p: { mode: 11 / 17, filt: 0.5 } }, 'Distortion X-Shaper, PRE'], ['dist', 1, {}, 'Distortion S1'], ['flg', 1, {}, 'Flanger'],
    ['phs', 1, {}, 'Phaser S1'], ['phs', 2, {}, 'Phaser'], ['cho', 1, {}, 'Chorus S1'], ['cho', 2, { p: { hp: 1 } }, 'Chorus HPF']] },
  { key: 'time', title: 'Effects · delay, dynamics', racks: 3, insts: [
    ['dly', 1, {}, 'Delay S1'], ['dly', 2, {}, 'Delay'], ['dly', 2, { p: { bpm: 0, link: 1 } }, 'Delay ms, LINK'],
    ['cmp', 1, {}, 'Compressor S1'], ['cmp', 1, { p: { mb: 1 } }, 'Compressor S1 MULTIBAND'], ['cmp', 2, {}, 'Compressor'],
    ['cmp', 2, { p: { mb: 1 } }, 'Compressor MULTIBAND'], ['cmp', 3, { sub: { src: 'k' }, p: { ext: 1 } }, 'Compressor keyed'],
    ['cmp', 3, { p: { mb: 1 } }, 'Compressor keyed MULTIBAND'], ['eq', 1, {}, 'EQ S1'], ['eq', 2, { p: { typeH: 1 } }, 'EQ']] },
  { key: 'space', title: 'Effects · reverbs, filters', racks: 3, insts: [
    ['rev', 1, {}, 'Reverb S1 Hall'], ['rev', 1, { sub: { type: 0 } }, 'Reverb S1 Plate'], ['rev', 2, { p: { type: 0 } }, 'Reverb Plate'],
    ['rev', 2, { p: { type: 1 / 4 } }, 'Reverb Hall'], ['rev', 2, { p: { type: 2 / 4 } }, 'Reverb Vintage'], ['rev', 2, { p: { type: 3 / 4 } }, 'Reverb Nitrous'],
    ['rev', 2, { p: { type: 1, prebpm: 1 } }, 'Reverb Basin, PRE sync'], ['fil', 1, {}, 'Filter S1'], ['fil', 2, {}, 'Filter'], ['conv', 2, {}, 'Convolve'],
    ['conv', 2, { p: { prebpm: 1 } }, 'Convolve, PRE sync']] },
  { key: 'rest', title: 'Effects · Bode, Utility, splitters, Ducker', racks: 3, insts: [
    ['bode', 2, {}, 'Bode'], ['bode', 2, { p: { bpm: 1 } }, 'Bode, DELAY sync'], ['util', 2, { p: { mbass: 1 } }, 'Utility'],
    ['split2', 2, { br: [['cho', 2]] }, 'Splitter L/H (a Chorus in LOWS)'], ['split3', 2, {}, 'Splitter L/M/H'], ['splitms', 2, {}, 'Splitter M/S'],
    ['duck', 2, { sub: { src: 'k' } }, 'Ducker'], ['duck', 2, { p: { bpm: 0 }, byp: 1 }, 'Ducker ms, BYPASSED']] },
  { key: 'master', title: 'Master effects (racks 1)', racks: 1, insts: [['dly', 2, {}, 'Delay'], ['rev', 2, {}, 'Reverb']] },
];
export async function page(o) {
  const O = o || {}, d = document, v = '?v=9';
  window.__fxStep = 'imports';
  const [core, FX, wk, RG] = await Promise.all(['../serum-core.js', '../fx-ui.js', '../wk.js', '../rig-grid.js'].map(p => import(p + v)));
  const st = d.createElement('style'); st.textContent = PAGE_CSS; d.head.appendChild(st);
  if (O.touch) d.documentElement.classList.add('wk-touch'); // (the kit's touch rules both ways: pointer: coarse and .wk-touch, as after an iPad's first touch)
  window.__fxStep = 'dsp';
  await wk.loadDSP();
  const dsp = globalThis.FXDSP || null;
  // an instance: the table's defaults (the variant asked), the case's values and structured data
  const inst = (id, type, v2, o2) => {
    const T = core.FXTYPES.find(t => t.id === type), p = {};
    for (const r of core.FXP_TAB[type][v2]) p[r.pid] = r.def;
    const I = { id, type, v: v2, byp: 0, p, sub: {}, ph: 0, ui: { lvl: 0, lvl2: 0 } };
    if (type === 'dist') I.sub = { xa: [[0, 0, 0], [0.4, 0.8, 0.3], [1, 1, 0]], xb: [[0, 0, 0], [1, 1, 0]] };
    if (type === 'cho') I.sub = { mono: 0 };
    if (type === 'rev' && v2 === 1) I.sub = { type: 1 };
    if (type === 'conv') I.sub = { ir: 'fir:Medium/Chamber' };
    if (type === 'cmp' && v2 === 3) I.sub = { src: '' };
    if (type === 'duck') I.sub = { src: '', cv: core.DUCK_DEFAULT.map(q => q.slice()) };
    if (T.split) { I.br = Array.from({ length: T.split }, () => []); I.bb = new Array(T.split).fill(0); }
    const X = o2 || {};
    Object.assign(I.p, X.p || {});
    Object.assign(I.sub, X.sub || {});
    if (X.byp) I.byp = 1;
    return I;
  };
  const gr = new Float32Array(4 * 48);
  for (let i = 0; i < 48; i++) { gr[4 * i] = 3 + (i % 5); gr[4 * i + 1] = 0.35; gr[4 * i + 2] = 2; gr[4 * i + 3] = -1.5; }
  const irs = { list: () => [{ id: 'fir:Medium/Chamber', name: 'Chamber', folder: 'Medium' }, { id: 'fir:Large/Hall', name: 'Hall', folder: 'Large' }],
    overview: (id, n) => { const o2 = new Float32Array(2 * n); for (let i = 0; i < n; i++) { const a = Math.exp(-5 * i / n) * (0.6 + 0.4 * Math.abs(Math.sin(i * 1.7))); o2[2 * i] = -a; o2[2 * i + 1] = a; } return o2; } };
  const scSources = () => ({ self: 't2', list: [{ id: 'k', name: 'Kick', drum: false }, { id: 't2', name: 'Bass' }], notes: () => null, ok: id => (id === 't2' ? 'A track cannot key itself' : '') });
  const mkHost = (fx, racks) => {
    const store = new Map();
    return { fx: () => fx, editFx: fn => fn(fx), bpm: () => 120, gr: () => gr, locked: () => false, notify: () => {}, racks: () => racks, irs, scSources,
      storage: { get: (k, x) => (store.has(k) ? store.get(k) : x), set: (k, x) => store.set(k, x) } };
  };
  const world = d.createElement('div'); world.id = 'world'; world.setAttribute('data-cv-skin', 'charcoal'); world.setAttribute('data-cv-world', '');
  const title = d.createElement('div'); title.id = 'sheetTitle';
  title.textContent = 'SYNTH · the FX look (every effect on the RIG grid) · charcoal · ' + (O.narrow ? 'Archivo Narrow' : 'Inter (fallback)') + ' · ' + innerWidth + ' × ' + innerHeight + (O.touch ? ' touch' : '') + ' · 100 % · test IRs / GR values';
  const cl = d.createElement('div'); cl.id = 'classic';
  d.body.append(title, world, cl);
  const views = [];
  window.__fxStep = 'mount';
  for (const S of SCENES) {
    const fx = core.defaultFx2(), ids = [], seen = {};
    for (const [type, v2, o2, name] of S.insts) {
      seen[type] = (seen[type] || 0) + 1;
      const id = type + (seen[type] > 1 ? seen[type] : '');
      const I = inst(id, type, v2, o2);
      if (o2 && o2.br) o2.br.forEach(([t2, vv], k) => { if (vv) I.br[k].push(inst(id + 'c' + k, t2, vv)); });
      fx.racks[0].mods.push(I);
      ids.push([id, name, type, v2]);
    }
    fx.ui = { rack: 0, sel: '', expand: 0, br: {} };
    const mod = d.createElement('div'); mod.className = 'cv-mod'; mod.setAttribute('data-cv-fx', ''); mod.setAttribute('data-cv-mod', S.key); mod.style.width = '760px';
    const bar = d.createElement('div'); bar.className = 'cv-bar';
    const pow = d.createElement('span'); pow.className = 'cv-pow'; pow.hidden = true;
    const stripe = d.createElement('span'); stripe.className = 'cv-stripe';
    const tt = d.createElement('span'); tt.className = 'cv-ttl'; const te = d.createElement('span'); te.className = 'cv-title'; te.textContent = S.racks === 1 ? 'Master effects' : 'Effects'; tt.appendChild(te);
    const ts = d.createElement('span'); ts.className = 'cv-sub'; ts.textContent = S.title; tt.appendChild(ts);
    const more = d.createElement('button'); more.className = 'cv-btn cv-more'; more.textContent = '⋯';
    bar.append(pow, stripe, tt, more);
    const body = d.createElement('div'); body.className = 'cv-body';
    const tab = d.createElement('section'); tab.className = 'fxtab'; body.appendChild(tab);
    mod.append(bar, body);
    world.appendChild(mod);
    const rack = new FX.FXRackUI(tab, mkHost(fx, S.racks), { embedded: false, dsp, racks: S.racks, v2Fx: true });
    // the classic panel of the same state (parity): a standalone rack in the old look, hidden
    const cb = d.createElement('div'); cl.appendChild(cb);
    const classic = new FX.FXRackUI(cb, mkHost(JSON.parse(JSON.stringify(fx)), S.racks), { embedded: false, dsp, racks: S.racks, v2Fx: true, look: 'classic' });
    views.push({ S, mod, rack, classic, ids });
  }
  for (const V of views) { V.rack.refresh(); V.classic.refresh(); }
  if (d.fonts && d.fonts.ready) await d.fonts.ready;
  if (O.narrow && d.fonts && d.fonts.load) { try { await d.fonts.load("600 12px 'Archivo Narrow'"); } catch (err) { /* measured below */ } }
  for (let i = 0; i < 6; i++) { await new Promise(r => requestAnimationFrame(r)); for (const V of views) { V.rack.redraw(true); V.rack.drawGrs(); } }
  await new Promise(r => setTimeout(r, 300));
  for (const V of views) { V.rack.redraw(true); V.rack.drawGrs(); }
  window.__fxStep = 'measure';
  const res = { size: [innerWidth, innerHeight, devicePixelRatio], touch: !!O.touch, narrow: !!O.narrow, faces: [], racks: [], fails: [] };
  const probe = f => { const s = d.createElement('span'); s.style.cssText = 'position: absolute; left: -9999px; visibility: hidden; white-space: nowrap; font: 600 13px ' + f; s.textContent = 'DISTORTION · REVERB · COMPRESSOR'; d.body.appendChild(s); const w = s.getBoundingClientRect().width; s.remove(); return Math.round(w * 100) / 100; };
  res.font = { stack: probe("'Archivo Narrow', Inter"), inter: probe('Inter') };
  if (O.narrow ? Math.abs(res.font.stack - res.font.inter) < 1 : Math.abs(res.font.stack - res.font.inter) > 0.5) res.fails.push(O.narrow ? 'the narrow pass did not get Archivo Narrow' : 'the Inter pass reached another face');
  for (const V of views) {
    res.racks.push(measureRack(V, RG));
    const all = [];
    for (const [id, name] of V.ids) {
      all.push([id, name]);
      const P = V.rack.panels.get(id);
      if (P && P.brBox) for (const [cid, CP] of V.rack.panels) if (CP !== P && P.brBox.contains(CP.el)) all.push([cid, name + ' › ' + CP.type]);
    }
    for (const [id, name] of all) {
      const P = V.rack.panels.get(id), C = V.classic.panels.get(id);
      if (!P) { res.fails.push(V.S.key + ': no panel ' + id); continue; }
      res.faces.push(measure(P, C, RG, name, V.S.key));
    }
  }
  window.__fxStep = 'behaviour';
  res.behaviour = await behaviour(views, RG);
  for (const m of res.behaviour.fails) res.fails.push('behaviour: ' + m);
  for (const r of res.racks) for (const m of r.fails) res.fails.push('rack ' + r.key + ': ' + m);
  for (const f of res.faces) for (const m of f.fails) res.fails.push(f.key + ' (' + f.name + '): ' + m);
  window.__fx = res;
  return res;
}
// (the skeptics, 2026-10-26) the real browser's side of the re-lays: the keyboard focus kept through them (a reverb TYPE stepped by
// ArrowRight three times and back, MULTIBAND and back by ArrowLeft — each re-lays the face), a dimmed cell's member inert (no focus),
// the X-Shaper popover over the face's rows below its head, whole (never half a knob label); every state put back for the sheets
const frames = n => new Promise(r => { const f = k => (k ? requestAnimationFrame(() => f(k - 1)) : r()); f(n); });
async function behaviour(views, RG) {
  const fails = [], out = { steps: [] }, G = RG.GRID, V = k => views.find(x => x.S.key === k);
  const press = async (k, el) => { (el || document.activeElement).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); await frames(3); };
  // the reverb's TYPE (S2 Plate, the space scene)
  const sp = V('space'), rv = sp && sp.rack.panels.get('rev3');
  if (rv) {
    const b = rv.el.querySelector('[data-dest="fx.rev3.type"] .wk-mbtn'), ty = () => Math.round(sp.rack.inst('rev3').p.type * 4);
    b.focus();
    for (const [k, want] of [['ArrowRight', 1], ['ArrowRight', 2], ['ArrowRight', 3], ['ArrowLeft', 2], ['ArrowLeft', 1], ['ArrowLeft', 0]]) {
      await press(k);
      out.steps.push('TYPE ' + ty() + (document.activeElement === b ? ' ✓' : ' ✗'));
      if (ty() !== want || document.activeElement !== b) { fails.push('reverb TYPE ' + k + ': type ' + ty() + ' (want ' + want + '), focus on ' + (document.activeElement === b ? 'the TYPE button' : document.activeElement.tagName + '.' + document.activeElement.className)); break; }
    }
    b.blur();
  } else fails.push('no S2 Plate reverb (rev3)');
  // MULTIBAND (the S2 Compressor, the time scene: its SINGLE / MULTIBAND segment): a click, then ArrowLeft
  const tm = V('time'), cp = tm && tm.rack.panels.get('cmp3');
  if (cp) {
    const sbs = cp.el.querySelectorAll('[data-dest="fx.cmp3.mb"] .wk-sb'), mb = () => tm.rack.inst('cmp3').p.mb;
    sbs[1].focus(); sbs[1].click(); await frames(3);
    if (mb() !== 1 || document.activeElement !== sbs[1]) fails.push('MULTIBAND click: mb ' + mb() + ', focus ' + (document.activeElement === sbs[1] ? 'kept' : 'lost'));
    await press('ArrowLeft');
    if (mb() !== 0 || document.activeElement !== sbs[0]) fails.push('MULTIBAND ArrowLeft: mb ' + mb() + ', focus ' + (document.activeElement === sbs[0] ? 'on SINGLE' : 'lost'));
    out.steps.push('MB → ' + mb());
    sbs[0].blur();
  } else fails.push('no S2 Compressor (cmp3)');
  // the dimmed STAGES (the Tube Distortion): inert — focus() does not take, a key edits nothing
  const md = V('mod'), dp = md && md.rack.panels.get('dist');
  if (dp) {
    const stg = dp.el.querySelector('[data-dest="fx.dist.stages"]'), nbv = stg && (stg.querySelector('.wk-nbv') || stg), p0 = md.rack.inst('dist').p.stages;
    if (!stg || !stg.parentNode.hasAttribute('data-dim')) fails.push('STAGES not dimmed in Tube');
    else {
      nbv.focus();
      if (!stg.inert || stg.contains(document.activeElement)) fails.push('a dimmed STAGES takes the focus');
      await press('ArrowUp', nbv);
      if (md.rack.inst('dist').p.stages !== p0) fails.push('a dimmed STAGES took a key');
    }
  }
  // the X-Shaper popover (Edit A on the X-Shaper Distortion): from the screen row's top to the face's inner bottom, its editor inside it
  const xp = md && md.rack.panels.get('dist3');
  if (xp) {
    md.rack.openXs(xp, 'xa', xp.pieces.xa); await frames(2);
    const pop = xp.el.querySelector('.fxr-xpop'), F = xp.face.getBoundingClientRect(), P = pop.getBoundingClientRect(), L = xp.lay.layout;
    const ed = pop.querySelector('.gx-root') || pop.lastElementChild, E = ed.getBoundingClientRect();
    out.xs = { top: P.top - F.top, bottom: F.bottom - P.bottom, ed: [E.top - P.top, P.bottom - E.bottom] };
    if (Math.abs(P.top - F.top - L.rows[1].top) > 0.5 || Math.abs(F.bottom - P.bottom - G.bottom) > 0.5) fails.push('X-Shaper popover ' + (P.top - F.top).toFixed(1) + '…' + (P.bottom - F.top).toFixed(1) + ', want ' + L.rows[1].top + '…' + (L.h - G.bottom));
    if (E.bottom > P.bottom - 6.5 || E.top < P.top) fails.push('X-Shaper editor ' + (E.top - P.top).toFixed(1) + '…' + (E.bottom - P.top).toFixed(1) + ' outside its popover (' + P.height.toFixed(1) + ')');
    for (const lab of xp.face.querySelectorAll('.rig-knobs .wk-lab, .rig-knobs .wk-num')) {
      const r = lab.getBoundingClientRect();
      if (!r.width) continue;
      const inside = r.top >= P.top && r.bottom <= P.bottom, outside = r.bottom <= P.top || r.top >= P.bottom;
      if (!inside && !outside) fails.push('X-Shaper popover half over "' + lab.textContent + '"');
    }
    md.rack.closeXs(false); await frames(2);
  }
  out.fails = fails;
  return out;
}
const vis = (el, root) => { if (!el || !el.getClientRects || !el.getClientRects().length) return false;
  for (let n = el; n && n !== root; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return false; if (n.classList && n.classList.contains('rig-park')) return false; } return true; };
const TEXT_SEL = '.wk-knob > .wk-lab, .wk-knob > .wk-num, .wk-nb > .wk-lab, .wk-nbv, .wk-sl > .wk-lab, .wk-sl > .wk-num, .wk-mtxt, .wk-menu > .wk-lab, .wk-tl, .wk-seg > .wk-lab, .wk-seg button, '
  + '.fxr-mtitle, .fxr2-s1, .fxr2-chip, .fxr2-emb, .fxr-xs, .fxr2-bname, .fxr2-bbyp, .fxr2-plus';
const CTL_SEL = '.wk-knob > .wk-svg, .wk-nbv, .wk-tog, .wk-mbtn, .wk-arr, .wk-seg button, .wk-slt, .fxr-disp, canvas.fxr-gr, .gx-root, .fxr-pre, .fxr-xs, .fxr2-chip, .fxr2-bpanel';
// the printed width of a relabelled element's words (data-l: font-size 0, its ::after prints them): a probe in the ::after's font
function afterWidth(el) {
  const cs = getComputedStyle(el, '::after'), s = document.createElement('span');
  s.style.cssText = 'position: absolute; left: -9999px; top: 0; visibility: hidden; white-space: nowrap';
  for (const k of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'textTransform', 'fontStretch']) s.style[k] = cs[k];
  s.textContent = el.getAttribute('data-l');
  document.body.appendChild(s);
  const w = s.getBoundingClientRect().width;
  s.remove();
  return w;
}
// a text element's box: its words' (a range over its text; a relabelled one's printed words, centred in it), else the element's
function textBox(el) {
  const R = el.getBoundingClientRect();
  if (el.hasAttribute('data-l')) { const w = Math.min(R.width, afterWidth(el)), x = R.left + (R.width - w) / 2; return { left: x, right: x + w, top: R.top, bottom: R.bottom, width: w, height: R.height }; }
  if (el.matches('.wk-mtxt, .wk-tl, .wk-nbv, .wk-seg button, .fxr2-chip, .fxr-xs, .fxr2-bname, .fxr2-bbyp, .fxr2-plus, .fxr-mtitle') && el.firstChild) {
    const r = document.createRange(); r.selectNodeContents(el); const b = r.getBoundingClientRect();
    if (b.width > 0) return b;
  }
  return R;
}
// clipped: its words wider than its content box (the range's width — never an invisible hit pseudo-element's overflow)
function clipped(el) {
  const cs = getComputedStyle(el), cw = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  if (!(el.clientWidth > 0)) return false;
  let w;
  if (el.hasAttribute('data-l')) w = afterWidth(el);
  else { const r = document.createRange(); r.selectNodeContents(el.matches('.wk-nbv') && el.querySelector('.wk-nbt') || el); w = r.getBoundingClientRect().width; } // (a num's box: its text, not its mod bar)
  return w > cw + 1 ? Math.round(w) + ' > ' + Math.round(cw) : false;
}
const gap = (a, b) => { const dx = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right)), dy = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom)); return Math.hypot(dx, dy); };
// a text's unit: its cell (a knob row's label / value stack), a head item, a screen item, a compound control (the branch strip's panel)
const unitOf = el => (el.closest ? el.closest('.fxr2-bpanel, .rig-cell, .rig-head > *, .rig-screen > *') : null);
const labelText = e => { const a = getComputedStyle(e, '::after').content; return e.hasAttribute('data-l') && a && a !== 'none' ? e.getAttribute('data-l') : e.textContent.trim(); };
function measure(P, C, RG, name, scene) {
  const face = P.face, fr = face.getBoundingClientRect(), fails = [], G = RG.GRID, out = { key: P.id, scene, name, type: P.type, v: P.v };
  const rel = r => ({ left: r.left - fr.left, top: r.top - fr.top, right: r.right - fr.left, bottom: r.bottom - fr.top, width: r.width, height: r.height });
  const L = P.lay && P.lay.layout, n = L ? L.cols : 0;
  if (!L) { fails.push('no layout'); out.fails = fails; return out; }
  out.w = Math.round(fr.width * 100) / 100; out.h = Math.round(fr.height * 100) / 100; out.rowsT = L.rows.map(r => r.t[0]).join('');
  if (Math.abs(fr.width - (64 * n + 32)) > 0.5 || (64 * n + 32) % 32) fails.push('width ' + fr.width + ' ≠ ' + (64 * n + 32));
  if (Math.abs(fr.height - L.h) > 0.5) fails.push('height ' + fr.height + ' ≠ ' + L.h);
  const rows = Array.from(face.children).filter(e => e.classList.contains('rig-row'));
  if (rows.length !== L.rows.length) fails.push('rows ' + rows.length + ' ≠ ' + L.rows.length);
  rows.forEach((re, i) => {
    const r = rel(re.getBoundingClientRect()), want = L.rows[i];
    if (want && (Math.abs(r.top - want.top) > 0.5 || Math.abs(r.height - want.h) > 0.5)) fails.push('row ' + i + ' (' + want.t + ') at ' + r.top + '+' + r.height + ', want ' + want.top + '+' + want.h);
  });
  // (the skeptics, 2026-10-26: an odd row sat 32 px left with the 8th column empty) every knob / switch row centred on the face — its
  // cells' span symmetric about the inner area's centre (an odd row half a column in: layoutOf mid), each knob on its cell's centre
  rows.forEach((re, i) => {
    if (!re.matches('.rig-knobs, .rig-switches')) return;
    const cs = Array.from(re.children).filter(e => e.classList.contains('rig-cell'));
    if (!cs.length) return;
    const a = rel(cs[0].getBoundingClientRect()).left - G.pad, b = fr.width - G.pad - rel(cs[cs.length - 1].getBoundingClientRect()).right;
    if (Math.abs(a - b) > 0.5) fails.push('row ' + i + ' (' + L.rows[i].t + ') off centre: ' + a.toFixed(1) + ' px left, ' + b.toFixed(1) + ' px right');
  });
  const cellCx = sv => { const ce = sv.closest('.rig-cell'), re = ce && ce.parentNode, ri = re ? +re.getAttribute('data-row') : -1, j = re ? Array.from(re.children).filter(e => e.classList.contains('rig-cell')).indexOf(ce) : -1;
    const c = L.rows[ri] && L.rows[ri].cells[j]; return c ? c.cx : NaN; };
  let knobs = 0;
  rows.forEach(re => {
    if (!re.classList.contains('rig-knobs')) return;
    const top = rel(re.getBoundingClientRect()).top;
    for (const sv of re.querySelectorAll('.rig-cell > .wk-knob > .wk-svg')) {
      if (!vis(sv, face)) continue;
      knobs++;
      const r = rel(sv.getBoundingClientRect()), cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2, id = sv.parentNode.getAttribute('data-dest'), want = cellCx(sv);
      if (Math.abs(r.width - G.knob) > 0.5 || Math.abs(r.height - G.knob) > 0.5) fails.push('knob ' + id + ' is ' + r.width + ' × ' + r.height);
      if (!(Math.abs(cx - want) <= 0.5) || (want - G.pad) % (G.col / 2) !== 0) fails.push('knob ' + id + ' centre x ' + cx + ' off its cell\'s ' + want + ' (the column pitch)');
      if (Math.abs(cy - (top + G.knobTop + G.knob / 2)) > 0.5) fails.push('knob ' + id + ' centre y ' + cy + ' off its row\'s knob line');
    }
    // a box at the knob's centre line (a toggle, a num, a segment's buttons, a picker, the branch strip): centred on it too
    for (const b of re.querySelectorAll('.rig-cell > .wk-tog, .rig-cell > .wk-nb > .wk-nbv, .rig-cell > .wk-seg .wk-sb, .rig-cell > .wk-menu .wk-mbtn, .rig-cell > .fxr2-brsel, .rig-cell > .wk-sl.wk-h > .wk-slt')) {
      if (!vis(b, face)) continue;
      const r = rel(b.getBoundingClientRect()), cy = (r.top + r.bottom) / 2;
      if (Math.abs(cy - (top + G.knobTop + G.knob / 2)) > 0.75) fails.push('box ' + (b.getAttribute('data-dest') || b.className) + ' centre y ' + cy.toFixed(1) + ' off its row\'s knob line');
    }
  });
  out.knobs = knobs;
  for (const c of face.querySelectorAll(CTL_SEL)) {
    if (!vis(c, face)) continue;
    const r = rel(c.getBoundingClientRect());
    if (r.left < G.pad - 0.5 || r.right > fr.width - G.pad + 0.5 || r.top < G.top - 0.5 || r.bottom > fr.height - G.bottom + 0.5) fails.push('control ' + (c.getAttribute('data-dest') || c.getAttribute('aria-label') || c.className.baseVal || c.className) + ' outside the inner area (' + r.left.toFixed(1) + '…' + r.right.toFixed(1) + ' × ' + r.top.toFixed(1) + '…' + r.bottom.toFixed(1) + ')');
  }
  const texts = Array.from(face.querySelectorAll(TEXT_SEL)).filter(e => vis(e, face) && labelText(e));
  const ctls = Array.from(face.querySelectorAll(CTL_SEL)).filter(e => vis(e, face));
  let minEdge = Infinity, minCtl = Infinity, minText = Infinity, minFont = Infinity;
  const tb = texts.map(e => ({ e, r: textBox(e) }));
  for (const { e, r } of tb) {
    const R = rel(r), edge = Math.min(R.left, R.top, fr.width - R.right, fr.height - R.bottom), t = labelText(e).slice(0, 18);
    minEdge = Math.min(minEdge, edge);
    if (edge < G.margin - 0.01) fails.push('text "' + t + '" ' + edge.toFixed(1) + ' px from the face edge');
    for (const c of ctls) {
      if (c === e || c.contains(e) || e.contains(c)) continue;
      const u = unitOf(e), grp = e.closest('.wk-segs, .wk-mrow');
      if (u && u.matches('.fxr2-bpanel') && u.contains(c)) continue; // (a branch panel's name, BYP and +: one control)
      if (grp && grp.contains(c)) continue; // (a segment's buttons, a menu's ◀ name ▶: one control, their borders shared by design)
      const g = gap(r, c.getBoundingClientRect());
      minCtl = Math.min(minCtl, g);
      if (g < G.margin - 0.01) fails.push('text "' + t + '" ' + g.toFixed(1) + ' px from a control (' + (c.getAttribute('data-dest') || c.getAttribute('aria-label') || c.className.baseVal || c.className) + ')');
    }
    const cs = getComputedStyle(e), fs = e.hasAttribute('data-l') ? parseFloat(getComputedStyle(e, '::after').fontSize) : parseFloat(cs.fontSize) || 0;
    const want = e.closest('.rig-head') ? MIN.head : e.matches('.wk-num, .wk-nbv, .wk-sl > .wk-num') ? MIN.val : MIN.lab;
    minFont = Math.min(minFont, fs);
    if (fs < want - 0.01) fails.push('text "' + t + '" ' + fs + ' px < ' + want);
    const nameOk = e.matches('.wk-mtxt') && (e.closest('.rig-grow') || e.closest('.fxr2-pick'));
    const cl = nameOk ? false : clipped(e);
    if (cl) fails.push('text "' + t + '" clipped (' + cl + ')');
  }
  for (let i = 0; i < tb.length; i++) for (let j = i + 1; j < tb.length; j++) {
    const a = tb[i], b = tb[j], ua = unitOf(a.e), ub = unitOf(b.e);
    if (ua && ua === ub) continue;
    if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
    const g = gap(a.r, b.r);
    minText = Math.min(minText, g);
    if (g < G.textGap - 0.01) fails.push('texts "' + labelText(a.e).slice(0, 12) + '" / "' + labelText(b.e).slice(0, 12) + '" ' + g.toFixed(1) + ' px apart');
  }
  out.minEdge = +minEdge.toFixed(1); out.minCtl = +minCtl.toFixed(1); out.minText = +minText.toFixed(1); out.minFont = minFont;
  // the occupancy (G11's gate): every grid cell a control stands in (a dimmed one too: no hole; a divider is no control), the head's items
  // at the row's height, the screen's items, the text boxes over the face
  const W = Math.round(fr.width), Hh = Math.round(fr.height), grid = new Uint8Array(W * Hh);
  const paint = r => { const R = rel(r), x0 = Math.max(0, Math.floor(R.left)), x1 = Math.min(W, Math.ceil(R.right)), y0 = Math.max(0, Math.floor(R.top)), y1 = Math.min(Hh, Math.ceil(R.bottom)); for (let y = y0; y < y1; y++) grid.fill(1, y * W + x0, y * W + x1); };
  for (const re of rows) {
    if (re.matches('.rig-knobs, .rig-switches')) { for (const c of re.querySelectorAll('.rig-cell')) if (Array.from(c.children).some(x => !x.matches('.fxr-sep') && (vis(x, face) || c.hasAttribute('data-dim')))) paint(c.getBoundingClientRect()); }
    else if (re.matches('.rig-head')) { const R = re.getBoundingClientRect(); for (const x of re.children) if (vis(x, face)) { const r = x.getBoundingClientRect(); paint({ left: r.left, right: r.right, top: R.top, bottom: R.bottom }); } }
    else for (const x of re.children) if (vis(x, face)) paint(x.getBoundingClientRect());
  }
  for (const { r } of tb) paint(r);
  let on = 0; for (let i = 0; i < grid.length; i++) on += grid[i];
  out.fill = +(on / grid.length).toFixed(3);
  if (out.fill < G.fill[0] || out.fill > G.fill[1]) fails.push('fill ' + out.fill + ' outside ' + G.fill.join('…'));
  const lab = texts.find(e => e.matches('.wk-knob > .wk-lab')) || texts[0], bg = getComputedStyle(face).backgroundColor;
  out.contrast = lab ? +(contrast(getComputedStyle(lab).color, bg) || 0).toFixed(2) : null;
  const vlab = texts.find(e => e.matches('.wk-knob > .wk-num'));
  out.contrastVal = vlab ? +(contrast(getComputedStyle(vlab).color, bg) || 0).toFixed(2) : null;
  if (out.contrast != null && out.contrast < 4.5) fails.push('label contrast ' + out.contrast);
  if (out.contrastVal != null && out.contrastVal < 4.5) fails.push('value contrast ' + out.contrastVal);
  // parity: every data-dest of the classic panel of this instance is in the face's section (its own panel: a splitter's nested ones apart)
  const own = el => new Set(Array.from(el.querySelectorAll('[data-dest]')).filter(e => !(P.brBox && P.brBox.contains(e))).map(e => e.getAttribute('data-dest')).filter(x => x.startsWith('fx.' + P.id + '.')));
  const mine = own(P.el), theirs = C ? new Set(Array.from(C.el.querySelectorAll('[data-dest]')).filter(e => !(C.brBox && C.brBox.contains(e))).map(e => e.getAttribute('data-dest')).filter(x => x.startsWith('fx.' + P.id + '.'))) : new Set();
  out.missing = Array.from(theirs).filter(x => !mine.has(x)); out.extra = Array.from(mine).filter(x => !theirs.has(x));
  if (!C) fails.push('no classic panel to compare');
  if (out.missing.length) fails.push('data-dest missing: ' + out.missing.join(' '));
  if (out.extra.length) fails.push('data-dest not in the classic panel: ' + out.extra.join(' '));
  out.dests = mine.size; out.dests3 = theirs.size;
  const count = el => el.querySelectorAll('*').length + 1, painted = el => Array.from(el.querySelectorAll('*')).filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').length + 1;
  out.count = count(P.face); out.painted = painted(P.face);
  if (C) { out.count3 = count(C.el) - (C.brBox ? count(C.brBox) : 0); }
  // G13's words, reported (the names review): Serum / Xfer in a face's texts, titles or names
  const words = new Set();
  for (const e of [P.el].concat(Array.from(P.face.querySelectorAll('*')))) for (const v of [e.getAttribute && e.getAttribute('title'), e.getAttribute && e.getAttribute('aria-label'), e.children && !e.children.length ? e.textContent : '']) if (v && /Serum|Xfer/.test(v)) words.add(v.slice(0, 60));
  out.words = Array.from(words);
  out.fails = fails;
  return out;
}
// the rack's chrome: the module 760 wide, its bar a head row (32; its tabs / buttons 28), the list's rows 32 (a branch's 28), + Add 28, the
// side column 168 and the faces' column 544, the texts unclipped (a module name in the list ellipsizes: allowed) and ≥ 11 px
function measureRack(V, RG) {
  const G = RG.GRID, el = V.rack.el, fails = [], out = { key: V.S.key };
  const r0 = el.getBoundingClientRect(), side = V.rack.side.getBoundingClientRect(), rk = V.rack.rack.getBoundingClientRect(), bar = V.rack.bar.getBoundingClientRect();
  out.w = r0.width; out.side = side.width; out.rack = rk.width; out.bar = bar.height;
  if (Math.abs(r0.width - 760) > 0.5) fails.push('module body ' + r0.width + ' ≠ 760');
  if (Math.abs(side.width - 168) > 0.5) fails.push('list column ' + side.width + ' ≠ 168');
  if (Math.abs(rk.width - RG.faceW(8)) > 0.5) fails.push('faces column ' + rk.width + ' ≠ ' + RG.faceW(8));
  if (Math.abs(bar.height - G.rows.head) > 0.5) fails.push('bar ' + bar.height + ' ≠ ' + G.rows.head);
  if (Math.abs(side.left - r0.left - G.pad) > 0.5 || Math.abs(bar.top - r0.top - G.pad) > 0.5) fails.push('padding: the bar at ' + (bar.top - r0.top) + ', the list at ' + (side.left - r0.left));
  for (const b of el.querySelectorAll('.fxr2-bar button')) { const h = b.getBoundingClientRect().height; if (Math.abs(h - G.box) > 0.5) fails.push('bar button "' + b.textContent + '" ' + h + ' tall'); }
  for (const t of el.querySelectorAll('.fxr-tile')) { const h = t.getBoundingClientRect().height; if (Math.abs(h - G.rows.head) > 0.5) fails.push('list row ' + t.getAttribute('data-inst') + ' ' + h + ' tall'); }
  for (const t of el.querySelectorAll('.fxr2-brow')) { const h = t.getBoundingClientRect().height; if (Math.abs(h - G.box) > 0.5) fails.push('branch row ' + h + ' tall'); }
  const add = el.querySelector('.fxr2-add').getBoundingClientRect();
  if (Math.abs(add.height - G.box) > 0.5 || Math.abs(add.width - side.width) > 0.5) fails.push('+ Add ' + add.width + ' × ' + add.height);
  // (the skeptics, 2026-10-26) a press inside a list row lands in that row — 1 and 2 px inside its top and bottom edges, across it (the
  // touch passes' grown hits: an LED's or a branch button's 44 px hit reached the next row)
  for (const row of el.querySelectorAll('.fxr-side .fxr-tile, .fxr-side .fxr2-brow')) {
    if (!vis(row, el)) continue;
    row.scrollIntoView({ block: 'center' });
    const R = row.getBoundingClientRect(), bad = new Set();
    for (const y of [R.top + 1, R.top + 2, R.bottom - 1, R.bottom - 2]) for (let x = R.left + 2; x < R.right - 1; x += 5) {
      const hit = document.elementFromPoint(x, y);
      if (hit && !row.contains(hit)) bad.add((hit.className && hit.className.baseVal != null ? hit.className.baseVal : hit.className) + ' @' + Math.round(x - R.left) + ',' + Math.round(y - R.top));
    }
    if (bad.size) fails.push('a press in list row "' + row.textContent.trim().slice(0, 16) + '" lands outside it: ' + Array.from(bad).slice(0, 3).join(' · '));
  }
  // (the skeptics, 2026-10-27) a mouse press 6 px inside a list row's top or bottom edge selects that row: across its name (the select
  // target) the press lands on the name, and a click there selects the row (a 12 px name in a 32 px row: 10 px dead above and below);
  // the selection and the rack's scroll put back. (The touch passes: the LED's 44 px hit — the kit's, grown sideways — takes the name's
  // first px by design: a press there is the LED's, never the row's dead ground.)
  const U = V.rack.fx().ui, sel0 = U.sel, st0 = V.rack.rack.scrollTop, touch = document.documentElement.classList.contains('wk-touch');
  for (const id of Array.from(el.querySelectorAll('.fxr-side .fxr-tile')).map(t => t.getAttribute('data-inst'))) {
    const t = el.querySelector('.fxr-side .fxr-tile[data-inst="' + id + '"]');
    if (!vis(t, el)) continue;
    t.scrollIntoView({ block: 'center' });
    const nm = t.querySelector('.fxr-tname'), led = t.querySelector('.fxr-led'), R = t.getBoundingClientRect(), N = nm.getBoundingClientRect(), miss = [];
    for (const y of [R.top + 6, R.bottom - 6]) for (let x = N.left + 1; x < N.right - 0.5; x += 4) {
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(nm.contains(hit) || (touch && led && led.contains(hit)))) miss.push((hit ? (hit.className && hit.className.baseVal != null ? hit.className.baseVal : hit.className) : 'nothing') + ' @' + Math.round(x - R.left) + ',' + Math.round(y - R.top));
    }
    if (miss.length) fails.push('a press 6 px inside list row ' + id + '\'s edge misses its name (' + N.height.toFixed(1) + ' of ' + R.height.toFixed(1) + ' px): ' + miss.slice(0, 3).join(' · '));
    for (const y of [R.top + 6, R.bottom - 6]) {
      U.sel = ''; V.rack.refresh();
      const hit = document.elementFromPoint((N.left + N.right) / 2, y);
      if (hit) hit.click();
      if (V.rack.fx().ui.sel !== id) fails.push('a click ' + Math.round(y - R.top) + ' px into list row ' + id + ' does not select it (the selection: "' + V.rack.fx().ui.sel + '")');
    }
  }
  V.rack.fx().ui.sel = sel0; V.rack.refresh(); V.rack.rack.scrollTop = st0;
  window.scrollTo(0, 0);
  for (const e of el.querySelectorAll('.fxr2-tab, .fxr2-title, .fxr2-add, .fxr2-bname, .fxr2-bbyp, .fxr2-plus, .fxr-side .fxr2-s1, .fxr-side .fxr2-chip')) {
    if (!vis(e, el) || !e.textContent.trim()) continue;
    const cl = clipped(e);
    if (cl) fails.push('"' + e.textContent.trim() + '" clipped (' + cl + ')');
    const fs = parseFloat(getComputedStyle(e).fontSize); if (fs < (e.matches('.fxr2-s1, .fxr2-chip') ? MIN.val : MIN.lab) - 0.01) fails.push('"' + e.textContent.trim() + '" ' + fs + ' px');
  }
  out.fails = fails;
  return out;
}

/* ================================================================ the driver (node) */
const isMain = typeof process !== 'undefined' && process.versions && process.versions.node && process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) await main();
async function main() {
  const http = await import('node:http'), fs = await import('node:fs'), path = await import('node:path'), os = await import('node:os'), url = await import('node:url'), cp = await import('node:child_process');
  const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
  const arg = (k, x) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : x; };
  const NARROW = process.argv.includes('--narrow'), OUT = arg('out', null), SIZES = String(arg('sizes', 'd,l,p')).split(','), JSONOUT = process.argv.includes('--json');
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  // Chrome for Testing: $CHROME, else the repo's (.claude/test-browser/<version>/…), looked for from the repo up (a worktree sits inside it)
  const findChrome = () => {
    if (process.env.CHROME) return process.env.CHROME;
    for (let dir = ROOT, i = 0; i < 4; i++, dir = path.dirname(dir)) {
      const tb = path.join(dir, '.claude', 'test-browser');
      if (!fs.existsSync(tb)) continue;
      for (const v of fs.readdirSync(tb).sort().reverse()) {
        const exe = path.join(tb, v, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
        if (fs.existsSync(exe)) return exe;
      }
    }
    throw new Error('no Chrome for Testing: set $CHROME');
  };
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
  const HTML = q => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>FX faces</title>
<link rel="stylesheet" href="/__fonts.css?narrow=${q.narrow ? 1 : 0}"><link rel="stylesheet" href="/style.css?v=9"></head><body>
<script type="module">import('/tests/ui-layout-fx.mjs').then(m => m.page(${JSON.stringify(q)})).catch(e => { window.__fx = { error: String(e && e.stack || e) }; });</script></body></html>`;
  const fontsCss = narrow => {
    let css = fs.readFileSync(path.join(ROOT, 'fonts', 'fonts.css'), 'utf8').replace(/url\(([^/)][^)]*)\)/g, 'url(/fonts/$1)');
    if (!narrow) css = css.replace(/@font-face\s*\{[^}]*'Archivo Narrow'[^}]*\}/g, '');
    return css;
  };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/__fx.html') { res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); return res.end(HTML({ narrow: u.searchParams.get('narrow') === '1', touch: u.searchParams.get('touch') === '1' })); }
    if (u.pathname === '/__fonts.css') { res.writeHead(200, { 'Content-Type': 'text/css', 'Cache-Control': 'no-store' }); return res.end(fontsCss(u.searchParams.get('narrow') === '1')); }
    const f = path.join(ROOT, decodeURIComponent(u.pathname)), rel = path.relative(ROOT, f);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).some(x => x.startsWith('.'))) { res.writeHead(403); return res.end(); }
    fs.readFile(f, (e, data) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data); });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const prof = fs.mkdtempSync(path.join(process.env.FX_PROFILE || os.tmpdir(), 'fx-chrome-'));
  const ch = cp.spawn(findChrome(), ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + prof, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-color-profile=srgb', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((res, rej) => { let b = ''; const t = setTimeout(() => rej(new Error('Chrome did not start')), 20000); ch.stderr.on('data', x => { b += x; const m = /DevTools listening on (ws:\/\/\S+)/.exec(b); if (m) { clearTimeout(t); res(m[1]); } }); });
  const browserWs = new WebSocket(wsUrl);
  await new Promise((r, j) => { browserWs.onopen = r; browserWs.onerror = j; });
  let id = 0; const pend = new Map(), logs = [];
  browserWs.onmessage = m => {
    const x = JSON.parse(m.data);
    if (x.id && pend.has(x.id)) { const { r, j } = pend.get(x.id); pend.delete(x.id); x.error ? j(new Error(JSON.stringify(x.error))) : r(x.result); }
    else if (x.method === 'Runtime.exceptionThrown') logs.push('exception: ' + ((x.params.exceptionDetails.exception || {}).description || x.params.exceptionDetails.text));
    else if (x.method === 'Runtime.consoleAPICalled' && (x.params.type === 'error' || x.params.type === 'warning')) logs.push(x.params.type + ': ' + x.params.args.map(a => (a.value != null ? a.value : a.description)).join(' '));
  };
  const send = (method, params = {}, sessionId) => new Promise((r, j) => { const i = ++id; pend.set(i, { r, j }); browserWs.send(JSON.stringify(Object.assign({ id: i, method, params }, sessionId ? { sessionId } : {}))); });
  const SZ = { d: { w: 1440, h: 900, dpr: 2, touch: false, name: 'desktop-1440x900' }, l: { w: 1366, h: 1024, dpr: 2, touch: true, name: 'ipad-1366x1024' }, p: { w: 1024, h: 1366, dpr: 2, touch: true, name: 'ipad-1024x1366' } };
  const all = [], sheets = [];
  let failed = 0;
  try {
    for (const sk of SIZES) {
      const S = SZ[sk];
      if (!S) continue;
      for (const narrow of NARROW ? [false, true] : [true]) {
        const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
        const s = (m, p) => send(m, p, sessionId);
        await s('Runtime.enable'); await s('Page.enable');
        await s('Emulation.setDeviceMetricsOverride', { width: S.w, height: S.h, deviceScaleFactor: S.dpr, mobile: S.touch });
        if (S.touch) await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
        await s('Page.navigate', { url: 'http://127.0.0.1:' + port + '/__fx.html?narrow=' + (narrow ? 1 : 0) + '&touch=' + (S.touch ? 1 : 0) });
        let R = null;
        for (let i = 0; i < 300 && !R; i++) {
          await new Promise(r => setTimeout(r, 100));
          const v = await s('Runtime.evaluate', { expression: 'window.__fx ? JSON.stringify(window.__fx) : null', returnByValue: true });
          if (v.result && v.result.value) R = JSON.parse(v.result.value);
        }
        if (!R) { const v = await s('Runtime.evaluate', { expression: 'String(window.__fxStep)', returnByValue: true }); R = { error: 'timeout (' + (v.result && v.result.value) + ')' }; }
        R.name = S.name + (narrow ? '-narrow' : '-inter');
        R.console = logs.splice(0);
        if (R.console.length) console.log(R.name + ' console:\n  ' + R.console.slice(0, 20).join('\n  '));
        all.push(R);
        if (R.error) { failed++; console.log(R.name + ': ERROR ' + R.error); }
        else {
          console.log('\n' + R.name + (R.fails.length ? '  ✗ ' + R.fails.length + ' failure(s)' : '  ✓ the FX gate green') + '  (' + R.size.join(' × ') + '; the probe: stack ' + R.font.stack + ' / Inter ' + R.font.inter + ' px)');
          console.log('  racks: ' + R.racks.map(r => r.key + ' ' + r.w + ' (' + r.side + ' | ' + r.rack + ') bar ' + r.bar).join(' · '));
          console.log('  face       rows      w×h        fill  edge ctl  text font knobs contrast  parity(dests)  els / classic  case');
          for (const f of R.faces) console.log('  ' + String(f.key).padEnd(10) + ' ' + String(f.rowsT).padEnd(9) + ' ' + (f.w + '×' + f.h).padEnd(10) + ' ' + String(f.fill).padEnd(5) + ' ' + String(f.minEdge).padEnd(4) + ' ' + String(f.minCtl).padEnd(4) + ' ' + String(f.minText).padEnd(4) + ' ' + String(f.minFont).padEnd(4) + ' ' + String(f.knobs).padEnd(5) + ' ' + (f.contrast + '/' + f.contrastVal).padEnd(9) + ' ' + ((f.missing && f.missing.length) ? '✗ ' + f.missing.length : '✓') + ' ' + f.dests + '=' + f.dests3 + '      ' + f.count + ' / ' + f.count3 + '   ' + f.name);
          const words = new Set(); for (const f of R.faces) for (const w of f.words || []) words.add(w);
          if (words.size) console.log('  words (the names review): ' + Array.from(words).join(' | '));
          for (const m of R.fails) console.log('    · ' + m);
          failed += R.fails.length;
          if (OUT) {
            const lm = await s('Page.getLayoutMetrics'), cs = lm.cssContentSize || lm.contentSize;
            const shot = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: Math.max(S.w, Math.ceil(cs.width)), height: Math.ceil(cs.height), scale: 1 } });
            const file = path.join(OUT, 'fx-faces-' + R.name + '.png');
            fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
            sheets.push(file);
            if (process.argv.includes('--faces')) {
              const dir = path.join(OUT, R.name);
              fs.mkdirSync(dir, { recursive: true });
              const rects = JSON.parse((await s('Runtime.evaluate', { expression: 'JSON.stringify(Array.from(document.querySelectorAll("#world > .cv-mod")).map(m => { const r = m.getBoundingClientRect(); return [m.getAttribute("data-cv-mod"), r.left + scrollX, r.top + scrollY, r.width, r.height]; }))', returnByValue: true })).result.value);
              for (const [k, x, y, w, h] of rects) { const sh = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: x - 8, y: y - 8, width: w + 16, height: h + 16, scale: 1 } }); const fpath = path.join(dir, k + '.png'); fs.writeFileSync(fpath, Buffer.from(sh.data, 'base64')); sheets.push(fpath); }
              // every face on its own (its module's key, its instance id)
              const fr = JSON.parse((await s('Runtime.evaluate', { expression: 'JSON.stringify(Array.from(document.querySelectorAll("#world .fxr-face")).map(f => { const r = f.getBoundingClientRect(), m = f.closest(".cv-mod"), sec = f.closest(".fxr-mod"); return [m.getAttribute("data-cv-mod") + "-" + sec.getAttribute("data-inst"), r.left + scrollX, r.top + scrollY, r.width, r.height]; }))', returnByValue: true })).result.value);
              fs.mkdirSync(path.join(dir, 'faces'), { recursive: true });
              for (const [k, x, y, w, h] of fr) { const sh = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: x - 4, y: y - 4, width: w + 8, height: h + 8, scale: 1 } }); fs.writeFileSync(path.join(dir, 'faces', k + '.png'), Buffer.from(sh.data, 'base64')); }
            }
          }
        }
        await send('Target.closeTarget', { targetId });
      }
    }
  } finally {
    try { browserWs.close(); } catch (e) { /* closed */ }
    ch.kill();
    srv.close();
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* busy */ }
  }
  if (OUT) { fs.writeFileSync(path.join(OUT, 'fx-gate.json'), JSON.stringify(all, null, 1)); console.log('\nsheets:\n  ' + sheets.join('\n  ')); }
  if (JSONOUT) console.log(JSON.stringify(all));
  console.log(failed ? '\nthe FX gate: ' + failed + ' failure(s)' : '\nthe FX gate: green');
  process.exit(failed ? 1 : 0);
}
