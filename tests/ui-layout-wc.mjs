// tests/ui-layout-wc.mjs — G11, the layout system measured (docs/canvas/IMPL-WC.md §3.8, §10 G11; stage WC lane F): every WC-1 face
// mounted by rig-ui's rigHost over one rig's SerumHost (the app's own SerumUI parts host) on a page of its own, measured from
// getBoundingClientRect in world px (100 %): the module width (64·n + 32, on the 32 px dots), every row's top and height against
// layoutOf, every knob's SVG 40 × 40 on a column centre and on its row's knob line, the jacks (28 px at column centres, hit ≥ 44),
// every text box ≥ 6 px from the face edge and from every control box (its own excepted), ≥ 8 px from every other text box (a cell's
// label / value stack is one), nothing clipped (an asset name in a menu excepted: it ellipsizes), the font-size minima, the fill
// ratio (control ∪ screen ∪ text boxes over the face area) in GRID.fill, label / face contrast ≥ 4.5 : 1, the data-dest parity with
// the stage-3 panel of the same part (mounted beside it, hidden) and the element count against it; (review 2 P3-2) each module's bar as
// cv-module builds it (⏻ slot, stripe, title — rig-core barOf —, ⋯, ▾): its title never clipped. Then the contact sheets: a PNG per size
// of every face side by side in the charcoal skin.
//   node --max-old-space-size=2048 tests/ui-layout-wc.mjs [--out <dir>] [--narrow [<Archivo Narrow woff2>]] [--sizes d,l,p] [--json]
//     sizes: d 1440 × 900 at 100 % (mouse) · l 1366 × 1024 and p 1024 × 1366 (touch) — every one at dpr 2 (§10 G11; review 2 P3-8: d ran
//     at 1); --narrow measures with the narrow face too (each size twice: Inter alone — fonts.css served WITHOUT its Archivo Narrow face, so
//     the skin's stack falls to Inter as it does when that face fails —, then Archivo Narrow: the bundled fonts/ArchivoNarrowVariable.woff2,
//     or the file given); each pass checks the face it measured really is that one (a probe's width); exit 1 on any failure. Chrome:
//     /Applications/Google Chrome.app (or $CHROME); a temporary profile; nothing of the user's is touched.
// Not a node --test file (not in the sweep): a CDP harness like ui-bench-m9.mjs. In the page the module is imported by the harness
// HTML the driver serves (/__wc.html): page(o) builds and measures; nothing at top level touches node or the DOM.

/* ================================================================ the page side (browser) */
const MIN = { lab: 11, val: 10, sw: 11, head: 12, jack: 10 };
const lum = c => { const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(c || ''); if (!m) return null; const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(+m[1]) + 0.7152 * f(+m[2]) + 0.0722 * f(+m[3]); };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return x == null || y == null ? null : (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// the charcoal skin (§5.2) for the sheets — lane U ships the real block in style.css; this page carries the same values
const SKIN = `
#world[data-cv-skin="charcoal"] .cv-mod[data-cv-rig] .sx-root, #world[data-cv-skin="charcoal"] .cv-mod[data-cv-rig] .rig-face, .rig-drawer[data-cv-skin="charcoal"] {
  --sx-bg: #17181a; --sx-panel: #1f2023; --sx-panel2: #141518; --sx-line: #2c2e32; --sx-graph: #ebe6d8; --sx-ink: #ebe6d8; --sx-mute: #9c978a;
  --sx-accent: #e8a33d; --sx-neg: #e8a33d; --sx-on: #e8a33d;
  --rig-face: #1f2023; --rig-screen: #141518; --rig-jack-ring: #ebe6d8; --rig-jack-hole: #0b0b0c; --rig-screw: #9c978a; --rig-font: 'Archivo Narrow', Inter, var(--ui); }
#world[data-cv-skin="charcoal"] .cv-mod[data-cv-rig] { background: #17181a; box-shadow: 0 0 0 1px #2c2e32, 0 22px 56px -26px rgba(0, 0, 0, 0.9); }
#world[data-cv-skin="charcoal"] .cv-mod[data-cv-rig] > .cv-bar { background: linear-gradient(#232427, #1c1d20); }
#world[data-cv-skin="charcoal"] .cv-mod[data-cv-rig] .cv-title { font-family: 'Archivo Narrow', Inter, var(--ui); font-weight: 600; letter-spacing: 0.06em; color: #ebe6d8; font-size: 13px; }
#world[data-cv-skin="charcoal"] .cv-mod[data-cv-rig] > .cv-body { background: #1f2023; }
html, body { margin: 0; background: #0c0d0f; }
#world { position: relative !important; width: auto !important; height: auto !important; display: flex; flex-wrap: wrap; align-items: flex-start; gap: 40px 32px; padding: 32px; --ik: 1; }
#world .cv-mod { position: relative; }
#sheetTitle { color: #9c978a; font: 500 13px var(--ui); padding: 20px 32px 0; }
#stage3 { position: absolute; left: -20000px; top: 0; visibility: hidden; }
`;
export async function page(o) {
  const O = o || {}, d = document, v = '?v=9';
  window.__wcStep = 'imports';
  const [core, wt, SU, MOD, RU, RC, wk] = await Promise.all(['../serum-core.js', '../wt.js', '../serum-ui.js', '../sx-ui-mod.js', '../rig-ui.js', '../rig-core.js', '../wk.js'].map(p => import(p + v)));
  window.__wcStep = 'skin';
  const st = d.createElement('style'); st.textContent = SKIN; d.head.appendChild(st); // ((review 2 P3-8) the faces come with the page's /__fonts.css: Archivo Narrow only in the narrow pass
  // the rig: the blank, every WC-1 part on — Oscillator 1 a wavetable, 2 a sample, 3 a granular (the kit interior); Envelope 1 a real
  // envelope (an Envelope plugged into LEVEL), Envelope 2 free; LFO 1; the filter on
  const s = RC.rigBlank();
  for (const id of ['a.on', 'b.on', 'c.on', 's.on', 'n.on', 'f.on', 'f2.on']) s.p[id] = 1;
  s.osc[1].type = 'sample';
  s.osc[2].type = 'gran';
  for (const id of ['e1.att', 'e1.dec', 'e1.sus', 'e1.rel']) s.p[id] = core.DESTS[core.DEST_INDEX[id]].def;
  const mkHost = (S, dev) => {
    const st0 = { s: S, fx: core.defaultFx2() }, store = new Map();
    return { state: () => st0.s, fx: () => st0.fx, edit: fn => fn(st0.s), editFx: fn => fn(st0.fx), bpm: () => 120, dev, sampleRate: () => 48000,
      storage: { get: (k, x) => (store.has(k) ? store.get(k) : x), set: (k, x) => store.set(k, x) }, notify: () => {},
      wt: { list: () => wt.FACTORY_TABLES, noises: () => wt.NOISES, get: id => wt.factoryTable(id) } };
  };
  const world = d.createElement('div'); world.id = 'world'; world.setAttribute('data-cv-skin', 'charcoal');
  const title = d.createElement('div'); title.id = 'sheetTitle';
  title.textContent = RC.RIG.NAME + ' WC-1 faces · RIG grid · charcoal · ' + (O.narrow ? 'Archivo Narrow' : 'Inter (fallback)') + ' · ' + innerWidth + ' × ' + innerHeight + (O.touch ? ' touch' : '') + ' · 100 %';
  const s3 = d.createElement('div'); s3.id = 'stage3';
  d.body.append(title, world, s3);
  const H = new SU.SerumUI(d.createElement('div'), mkHost(s, 'i1'), { parts: true });
  const H3 = new SU.SerumUI(d.createElement('div'), mkHost(JSON.parse(JSON.stringify(s)), 'i9'), { parts: true });
  const rig = RU.rigHost({ doc: d });
  // the faces of the sheet: [key, kind, part, title, the stage-3 part (parity)]
  const FACES = [['osc1', 'osc', 'oscA', 'Oscillator 1', 'oscA'], ['filter1', 'filter', 'filter', 'Filter 1', 'filter'], ['amp', 'amp', 'voice', 'Amplifier', 'voice'],
    ['env1', 'env', 'env1', 'Envelope 1', 'env1'], ['sub', 'sub', 'sub', 'Sub oscillator', 'sub'], ['noise', 'noise', 'noise', 'Noise', 'noise'],
    ['env2', 'env', 'env2', 'Envelope 2', 'env2'], ['lfo1', 'lfo', 'lfo1', 'LFO 1', 'lfo1'], ['macros', 'macros', 'macros', 'Macros', 'macros'],
    ['osc2', 'osc', 'oscB', 'Oscillator 2', 'oscB'], ['osc3', 'osc', 'oscC', 'Oscillator 3', 'oscC']];
  const views = [];
  for (const [key, kind, part, ttl, p3] of FACES) {
    const mod = d.createElement('div'); mod.className = 'cv-mod'; mod.setAttribute('data-cv-rig', ''); mod.setAttribute('data-cv-mod', key);
    const bar = d.createElement('div'); bar.className = 'cv-bar';
    // (review 2 P3-2) the bar as cv-module builds it on the canvas: the ⏻ slot (a part's own ⏻, else hidden), the stripe, the title (rig-core
    // barOf: what the host gives the bar) over its sub (none on a rig module), ⋯ and ▾ — so a clipped title shows here
    const pow = d.createElement('span'); pow.className = 'cv-pow';
    const stripe = d.createElement('span'); stripe.className = 'cv-stripe';
    const tt = d.createElement('span'); tt.className = 'cv-ttl'; const te = d.createElement('span'); te.className = 'cv-title'; te.textContent = RC.barOf(part) || ttl; tt.appendChild(te);
    const more = d.createElement('button'); more.className = 'cv-btn cv-more'; more.textContent = '⋯';
    const fold = d.createElement('button'); fold.className = 'cv-btn cv-fold'; fold.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.25 6 7.75l3.5-3.5"/></svg>';
    bar.append(pow, stripe, tt, more, fold);
    const body = d.createElement('div'); body.className = 'cv-body';
    mod.append(bar, body);
    world.appendChild(mod);
    window.__wcStep = 'face ' + key;
    const V = rig.face(kind, body, { host: H, part, dev: 'i1', shown: () => true });
    if (V.power) { pow.className = 'cv-pow cv-powslot'; pow.appendChild(V.power); } else pow.hidden = true;
    const b3 = d.createElement('div'); s3.appendChild(b3);
    const V3 = MOD.mountPart(H3, p3, b3, {});
    views.push({ key, kind, part, V, V3, b3, mod });
  }
  window.__wcStep = 'mounted';
  H.paint(true); H3.paint(true);
  if (d.fonts && d.fonts.ready) await d.fonts.ready;
  for (let i = 0; i < 6; i++) { await new Promise(r => requestAnimationFrame(r)); H.paint(true); }
  await new Promise(r => setTimeout(r, 300));
  H.paint(true);
  window.__wcStep = 'measure';
  const res = { size: [innerWidth, innerHeight, devicePixelRatio], touch: !!O.touch, narrow: !!O.narrow, faces: [], fails: [] };
  // (review 2 P3-8) the face this pass measures is the one it names: the skin's stack ('Archivo Narrow', Inter) against Inter alone — wider
  // apart in the narrow pass, the same in the Inter pass (fonts.css's Archivo Narrow face left out)
  const probe = f => { const s = d.createElement('span'); s.style.cssText = 'position: absolute; left: -9999px; visibility: hidden; white-space: nowrap; font: 600 13px ' + f; s.textContent = 'SUB OSCILLATOR · NOISE · ENVELOPE 2'; d.body.appendChild(s); const w = s.getBoundingClientRect().width; s.remove(); return Math.round(w * 100) / 100; };
  if (O.narrow && d.fonts && d.fonts.load) { try { await d.fonts.load("600 13px 'Archivo Narrow'"); } catch (err) { /* measured below */ } }
  res.font = { stack: probe("'Archivo Narrow', Inter"), inter: probe('Inter') };
  if (O.narrow ? Math.abs(res.font.stack - res.font.inter) < 1 : Math.abs(res.font.stack - res.font.inter) > 0.5) res.fails.push(O.narrow ? 'the narrow pass did not get Archivo Narrow (' + res.font.stack + ' vs Inter ' + res.font.inter + ')' : 'the Inter pass reached another face (' + res.font.stack + ' vs Inter ' + res.font.inter + ')');
  for (const F of views) res.faces.push(measure(F, RU, d));
  // the Amplifier's drawer, open (its cells measured as a sheet of their own)
  const amp = views.find(x => x.key === 'amp');
  if (amp && amp.V.drawer) { amp.V.drawer.open(); H.paint(true); await new Promise(r => requestAnimationFrame(r)); res.drawer = measureDrawer(amp.V.drawer.el, d); amp.V.drawer.close(); }
  for (const f of res.faces) for (const m of f.fails) res.fails.push(f.key + ': ' + m);
  if (res.drawer) for (const m of res.drawer.fails) res.fails.push('amp drawer: ' + m);
  res.css = !!d.getElementById(RU.CSS_ID);
  window.__wc = res;
  return res;
}
const vis = (el, root) => { if (!el || !el.getClientRects || !el.getClientRects().length) return false; if (el.closest && el.closest('.rig-screen[data-h="K"]')) return false; // (the kit's own type view in the frame: WC-2 lays it)
  for (let n = el; n && n !== root; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return false; if (n.classList && (n.classList.contains('rig-park') || n.classList.contains('rig-drawer'))) return false; } return true; };
const TEXT_SEL = '.wk-knob > .wk-lab, .wk-knob > .wk-num, .wk-nb > .wk-lab, .sx-nf > .sx-nfl, .wk-nbv, .sx-nfv, .rig-cap, .rig-jl, .rig-hint, .sx-vc, .sxo-wl, .wk-sl > .wk-lab, .wk-mtxt, .wk-tl, .wk-seg button, .sx-seg button, .sx-tile .sx-tl';
const CTL_SEL = '.wk-knob > .wk-svg, .wk-nbv, .sx-nfv, .wk-tog, .wk-mbtn, .wk-arr, .sx-hbtn, input, .rig-jack, .rig-disp, .wk-seg button, .sx-seg button, .sx-tile, .wk-slt, .rig-glyph';
const FILL_SEL = '.wk-knob, .wk-nb, .sx-nf, .wk-tog, .wk-menu, .sx-hbtn, input, .rig-jack, .rig-jl, .rig-disp, .wk-seg, .sx-seg, .sx-tile, .rig-cap, .rig-hint, .sx-vc, .wk-meter, .rig-glyph, .wk-sl';
function textBox(el) {
  // a text element's box: the element itself when it shrinks to its text, else its text's range (a button's / a menu's label)
  if (el.matches('.wk-mtxt, .wk-tl, .wk-nbv, .sx-nfv, .wk-seg button, .sx-seg button, .sx-tile .sx-tl') && el.firstChild) {
    const r = document.createRange(); r.selectNodeContents(el); const b = r.getBoundingClientRect();
    if (b.width > 0) return b;
  }
  return el.getBoundingClientRect();
}
const gap = (a, b) => { const dx = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right)), dy = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom)); return Math.hypot(dx, dy); };
const cellOf = el => (el.closest ? el.closest('.rig-cell, .rig-head > *, .rig-strip > *') : null);
function measure(F, RU, d) {
  const face = F.V.el, fr = face.getBoundingClientRect(), fails = [], out = { key: F.key, kind: F.kind, variant: F.V.face && F.V.face.variant };
  const rel = r => ({ left: r.left - fr.left, top: r.top - fr.top, right: r.right - fr.left, bottom: r.bottom - fr.top, width: r.width, height: r.height });
  const L = RU.layoutOf(RU.FACE[out.variant]), G = RU.GRID, n = L.cols, kit = out.variant === 'osc.kit';
  out.w = Math.round(fr.width * 100) / 100; out.h = Math.round(fr.height * 100) / 100;
  // (review 2 P3-2) the bar's title: all of it in the room the bar leaves it
  const te = F.mod.querySelector('.cv-title'), tt = F.mod.querySelector('.cv-ttl');
  if (te && tt) { out.bar = { title: te.textContent, w: te.scrollWidth, room: tt.clientWidth }; if (te.scrollWidth > tt.clientWidth + 0.5) fails.push('bar title "' + te.textContent + '" clipped (' + te.scrollWidth + ' > ' + tt.clientWidth + ')'); }
  if (Math.abs(fr.width - (64 * n + 32)) > 0.5 || (64 * n + 32) % 32) fails.push('width ' + fr.width + ' ≠ ' + (64 * n + 32));
  if (!kit && Math.abs(fr.height - L.h) > 0.5) fails.push('height ' + fr.height + ' ≠ ' + L.h);
  // rows
  const rows = Array.from(face.children).filter(e => e.classList.contains('rig-row'));
  if (rows.length !== L.rows.length) fails.push('rows ' + rows.length + ' ≠ ' + L.rows.length);
  let dy = 0;
  rows.forEach((re, i) => {
    const r = rel(re.getBoundingClientRect()), want = L.rows[i];
    if (!want) return;
    if (kit && want.t === 'screen') { dy = r.height - want.h; return; }
    if (Math.abs(r.top - (want.top + dy)) > 0.5 || Math.abs(r.height - want.h) > 0.5) fails.push('row ' + i + ' (' + want.t + ') at ' + r.top + '+' + r.height + ', want ' + (want.top + dy) + '+' + want.h);
  });
  const colC = x => { const i = Math.round((x - G.pad - G.col / 2) / G.col); return Math.abs(x - (G.pad + G.col / 2 + G.col * i)) <= 0.5 && i >= 0 && i < n; };
  // knobs: 40 × 40 on a column centre and on the knob line
  let knobs = 0;
  rows.forEach((re, i) => {
    if (!re.classList.contains('rig-knobs')) return;
    const top = rel(re.getBoundingClientRect()).top;
    for (const sv of re.querySelectorAll('.rig-cell > .wk-knob > .wk-svg')) {
      if (!vis(sv, face)) continue;
      knobs++;
      const r = rel(sv.getBoundingClientRect()), cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
      if (Math.abs(r.width - G.knob) > 0.5 || Math.abs(r.height - G.knob) > 0.5) fails.push('knob ' + sv.parentNode.getAttribute('data-dest') + ' is ' + r.width + ' × ' + r.height);
      if (!colC(cx)) fails.push('knob ' + sv.parentNode.getAttribute('data-dest') + ' centre x ' + cx + ' off the columns');
      if (Math.abs(cy - (top + G.knobTop + G.knob / 2)) > 0.5) fails.push('knob ' + sv.parentNode.getAttribute('data-dest') + ' centre y ' + cy + ' off its row\'s knob line');
    }
  });
  out.knobs = knobs;
  // jacks
  const jacks = Array.from(face.querySelectorAll('.rig-jack')).filter(e => vis(e, face));
  for (const je of jacks) {
    const r = rel(je.getBoundingClientRect()), cx = (r.left + r.right) / 2, hit = parseFloat(getComputedStyle(je, '::before').width);
    if (Math.abs(r.width - G.jack) > 0.5 || !colC(cx)) fails.push('jack ' + je.getAttribute('data-jack') + ' ' + r.width + ' px at ' + cx);
    if (!(hit >= G.hit - 0.01)) fails.push('jack ' + je.getAttribute('data-jack') + ' hit ' + hit);
  }
  out.jacks = jacks.length;
  // every control inside the inner area (the side paddings stay clear: the corner screws sit there)
  for (const c of face.querySelectorAll(CTL_SEL)) {
    if (!vis(c, face)) continue;
    const r = rel(c.getBoundingClientRect());
    if (r.left < G.pad - 0.5 || r.right > fr.width - G.pad + 0.5 || r.top < G.top - 0.5 || r.bottom > fr.height - G.bottom + 0.5) fails.push('control ' + (c.getAttribute('data-dest') || c.getAttribute('aria-label') || c.className.baseVal || c.className) + ' outside the inner area (' + r.left.toFixed(1) + '…' + r.right.toFixed(1) + ' × ' + r.top.toFixed(1) + '…' + r.bottom.toFixed(1) + ')');
  }
  // text boxes: margins, gaps, clipping, sizes
  const texts = Array.from(face.querySelectorAll(TEXT_SEL)).filter(e => vis(e, face) && (e.textContent.trim() || getComputedStyle(e, '::after').content.length > 2));
  const ctls = Array.from(face.querySelectorAll(CTL_SEL)).filter(e => vis(e, face));
  let minEdge = Infinity, minCtl = Infinity, minText = Infinity, minFont = Infinity;
  const tb = texts.map(e => ({ e, r: textBox(e) }));
  for (const { e, r } of tb) {
    const R = rel(r), edge = Math.min(R.left, R.top, fr.width - R.right, fr.height - R.bottom);
    minEdge = Math.min(minEdge, edge);
    if (edge < G.margin - 0.01) fails.push('text "' + e.textContent.trim().slice(0, 18) + '" ' + edge.toFixed(1) + ' px from the face edge');
    for (const c of ctls) {
      if (c === e || c.contains(e) || e.contains(c)) continue;
      // (a knob's own label sits its 6 px under its SVG: measured like any other, never excused)
      const g = gap(r, c.getBoundingClientRect());
      minCtl = Math.min(minCtl, g);
      if (g < G.margin - 0.01) fails.push('text "' + e.textContent.trim().slice(0, 18) + '" ' + g.toFixed(1) + ' px from a control (' + (c.getAttribute('data-dest') || c.className.baseVal || c.className) + ')');
    }
    const fs = parseFloat(getComputedStyle(e).fontSize) || 0, fs2 = e.matches('.wk-lab[data-l]') ? parseFloat(getComputedStyle(e, '::after').fontSize) : fs; // (a relabelled knob prints its ::after)
    const want = e.matches('.wk-num, .wk-nbv, .sx-nfv, .rig-jl, .sxo-wl, .wk-sl > .wk-lab') ? MIN.val : e.closest('.rig-head') ? MIN.head : MIN.lab;
    minFont = Math.min(minFont, fs2);
    if (fs2 < want - 0.01) fails.push('text "' + e.textContent.trim().slice(0, 18) + '" ' + fs2 + ' px < ' + want);
    const name = e.matches('.wk-mtxt') && (e.closest('.rig-grow') || e.closest('.rig-strip') || e.closest('.rig-sel'));
    if (!name && e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0) fails.push('text "' + e.textContent.trim().slice(0, 18) + '" clipped (' + e.scrollWidth + ' > ' + e.clientWidth + ')');
  }
  for (let i = 0; i < tb.length; i++) for (let j = i + 1; j < tb.length; j++) {
    const a = tb[i], b = tb[j], ca = cellOf(a.e), cb = cellOf(b.e);
    if (ca && ca === cb) continue; // (a cell's label / value stack, a control's own texts)
    if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
    const g = gap(a.r, b.r);
    minText = Math.min(minText, g);
    if (g < G.textGap - 0.01) fails.push('texts "' + a.e.textContent.trim().slice(0, 12) + '" / "' + b.e.textContent.trim().slice(0, 12) + '" ' + g.toFixed(1) + ' px apart');
  }
  out.minEdge = +minEdge.toFixed(1); out.minCtl = +minCtl.toFixed(1); out.minText = +minText.toFixed(1); out.minFont = minFont;
  // fill ratio: control ∪ screen ∪ text boxes over the face (a 1 px raster)
  const W = Math.round(fr.width), Hh = Math.round(fr.height), grid = new Uint8Array(W * Hh);
  const paint = r => { const R = rel(r), x0 = Math.max(0, Math.floor(R.left)), x1 = Math.min(W, Math.ceil(R.right)), y0 = Math.max(0, Math.floor(R.top)), y1 = Math.min(Hh, Math.ceil(R.bottom)); for (let y = y0; y < y1; y++) grid.fill(1, y * W + x0, y * W + x1); };
  for (const e of face.querySelectorAll(FILL_SEL)) if (vis(e, face)) paint(e.getBoundingClientRect());
  for (const { r } of tb) paint(r);
  let on = 0; for (let i = 0; i < grid.length; i++) on += grid[i];
  out.strict = +(on / grid.length).toFixed(3);
  // the occupancy (the gate): every grid cell a control stands in (a dimmed one too: it is no hole), every jack's cell, the head's items
  // at the row's height, the screen's boxes, the text boxes — empty cells, empty jack cells, the paddings and the gaps are the empty part
  grid.fill(0);
  for (const re of face.querySelectorAll('.rig-row')) {
    if (re.matches('.rig-knobs, .rig-switches, .rig-jacks')) { for (const c of re.querySelectorAll('.rig-cell')) if (Array.from(c.children).some(x => vis(x, face) || c.hasAttribute('data-dim'))) paint(c.getBoundingClientRect()); }
    else if (re.matches('.rig-head')) { const R = re.getBoundingClientRect(); for (const x of re.children) if (vis(x, face)) { const r = x.getBoundingClientRect(); paint({ left: r.left, right: r.right, top: R.top, bottom: R.bottom }); } }
    else for (const x of re.querySelectorAll('.rig-disp, .rig-strip')) if (vis(x, face) || x.closest('[data-h="K"]')) paint(x.getBoundingClientRect());
  }
  for (const { r } of tb) paint(r);
  on = 0; for (let i = 0; i < grid.length; i++) on += grid[i];
  out.fill = +(on / grid.length).toFixed(3);
  if (!kit && (out.fill < G.fill[0] || out.fill > G.fill[1])) fails.push('fill ' + out.fill + ' outside ' + G.fill.join('…'));
  // contrast: a label against the face
  const lab = texts.find(e => e.matches('.wk-knob > .wk-lab')) || texts[0], bg = getComputedStyle(face).backgroundColor;
  out.contrast = lab ? +(contrast(getComputedStyle(lab).color, bg) || 0).toFixed(2) : null;
  const vlab = texts.find(e => e.matches('.wk-knob > .wk-num'));
  out.contrastVal = vlab ? +(contrast(getComputedStyle(vlab).color, bg) || 0).toFixed(2) : null;
  if (out.contrast != null && out.contrast < 4.5) fails.push('label contrast ' + out.contrast);
  if (out.contrastVal != null && out.contrastVal < 4.5) fails.push('value contrast ' + out.contrastVal);
  // parity with the stage-3 panel: every data-dest it shows is on the face (Envelope 1's ids are the amp's no longer: §3.1)
  const ids = el => new Set(Array.from(el.querySelectorAll('[data-dest]')).map(e => e.getAttribute('data-dest')));
  const mine = ids(face), theirs = ids(F.b3);
  if (F.kind === 'amp') for (const x of Array.from(theirs)) if (/^e\d\./.test(x)) theirs.delete(x);
  out.missing = Array.from(theirs).filter(x => !mine.has(x));
  if (out.missing.length) fails.push('data-dest missing: ' + out.missing.join(' '));
  out.dests = mine.size; out.dests3 = theirs.size;
  const count = el => el.querySelectorAll('*').length + 1;
  const painted = el => Array.from(el.querySelectorAll('*')).filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').length + 1;
  out.count = count(face); out.count3 = count(F.b3); out.painted = painted(face);
  F.b3.style.visibility = 'visible'; out.painted3 = painted(F.b3); F.b3.style.visibility = '';
  out.ratio = +(out.count / out.count3).toFixed(2); out.pratio = +(out.painted / out.painted3).toFixed(2);
  // G13's words on a face (lane K / H gate them; listed here): no Serum / Xfer / VOICE in its texts, titles or names
  const words = new Set();
  for (const e of [face].concat(Array.from(face.querySelectorAll('*')))) for (const v of [e.getAttribute && e.getAttribute('title'), e.getAttribute && e.getAttribute('aria-label'), e.children && !e.children.length ? e.textContent : '']) if (v && /Serum|Xfer|\bVOICE\b/.test(v)) words.add(v.slice(0, 60));
  out.words = Array.from(words);
  out.fails = fails;
  return out;
}
function measureDrawer(D, d) {
  const fails = [], r0 = D.getBoundingClientRect(), out = { w: r0.width, h: r0.height };
  const texts = Array.from(D.querySelectorAll(TEXT_SEL + ', .rig-dt, .sx-hbtn')).filter(e => e.getClientRects().length && e.textContent.trim());
  let minEdge = Infinity;
  for (const e of texts) {
    const r = textBox(e), edge = Math.min(r.left - r0.left, r.top - r0.top, r0.right - r.right, r0.bottom - r.bottom);
    minEdge = Math.min(minEdge, edge);
    if (edge < 6 - 0.01) fails.push('"' + e.textContent.trim().slice(0, 18) + '" ' + edge.toFixed(1) + ' px from the drawer edge');
    if (e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0 && !e.matches('.wk-mtxt')) fails.push('"' + e.textContent.trim().slice(0, 18) + '" clipped');
  }
  out.minEdge = +minEdge.toFixed(1);
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
  const NI = process.argv.indexOf('--narrow'), NARROW = NI > 0, NFILE = NARROW && process.argv[NI + 1] && !process.argv[NI + 1].startsWith('--') ? process.argv[NI + 1] : null; // ((review 2 P3-8) the bundled face unless a file is given
  const OUT = arg('out', null), SIZES = String(arg('sizes', 'd,l,p')).split(','), JSONOUT = process.argv.includes('--json');
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
  const HTML = q => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>WC faces</title>
<link rel="stylesheet" href="/__fonts.css?narrow=${q.narrow ? 1 : 0}"><link rel="stylesheet" href="/style.css?v=9"></head><body>
<script type="module">import('/tests/ui-layout-wc.mjs').then(m => m.page(${JSON.stringify(q)})).catch(e => { window.__wc = { error: String(e && e.stack || e) }; });</script></body></html>`;
  // (review 2 P3-8) the site's fonts.css, its urls made absolute: the Inter pass without its Archivo Narrow face (the stack falls to Inter, as
  // when that face fails), the narrow pass with it (from the file given, else the bundled one)
  const fontsCss = narrow => {
    let css = fs.readFileSync(path.join(ROOT, 'fonts', 'fonts.css'), 'utf8').replace(/url\(([^/)][^)]*)\)/g, 'url(/fonts/$1)');
    if (!narrow) css = css.replace(/@font-face\s*\{[^}]*'Archivo Narrow'[^}]*\}/g, '');
    else if (NFILE) css = css.replace(/(@font-face\s*\{[^}]*'Archivo Narrow'[^}]*src:\s*)url\([^)]*\)/, '$1url(/__an.woff2)');
    return css;
  };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/__wc.html') { res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); return res.end(HTML({ narrow: u.searchParams.get('narrow') === '1', touch: u.searchParams.get('touch') === '1' })); }
    if (u.pathname === '/__fonts.css') { res.writeHead(200, { 'Content-Type': 'text/css', 'Cache-Control': 'no-store' }); return res.end(fontsCss(u.searchParams.get('narrow') === '1')); }
    if (u.pathname === '/__an.woff2' && NFILE) { res.writeHead(200, { 'Content-Type': 'font/woff2' }); return res.end(fs.readFileSync(NFILE)); }
    const f = path.join(ROOT, decodeURIComponent(u.pathname));
    const rel = path.relative(ROOT, f);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).some(x => x.startsWith('.'))) { res.writeHead(403); return res.end(); }
    fs.readFile(f, (e, data) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data); });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-chrome-'));
  const ch = cp.spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + prof, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-color-profile=srgb', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((res, rej) => { let b = ''; const t = setTimeout(() => rej(new Error('Chrome did not start')), 20000); ch.stderr.on('data', x => { b += x; const m = /DevTools listening on (ws:\/\/\S+)/.exec(b); if (m) { clearTimeout(t); res(m[1]); } }); });
  const browserWs = new WebSocket(wsUrl);
  await new Promise((r, j) => { browserWs.onopen = r; browserWs.onerror = j; });
  let id = 0; const pend = new Map(), logs = [];
  browserWs.onmessage = m => {
    const x = JSON.parse(m.data);
    if (x.id && pend.has(x.id)) { const { r, j } = pend.get(x.id); pend.delete(x.id); x.error ? j(new Error(JSON.stringify(x.error))) : r(x.result); }
    else if (x.method === 'Runtime.exceptionThrown') logs.push('exception: ' + ((x.params.exceptionDetails.exception || {}).description || x.params.exceptionDetails.text));
    else if (x.method === 'Runtime.consoleAPICalled' && (x.params.type === 'error' || x.params.type === 'warning')) logs.push(x.params.type + ': ' + x.params.args.map(a => a.value != null ? a.value : a.description).join(' '));
  };
  const send = (method, params = {}, sessionId) => new Promise((r, j) => { const i = ++id; pend.set(i, { r, j }); browserWs.send(JSON.stringify(Object.assign({ id: i, method, params }, sessionId ? { sessionId } : {}))); });
  const SZ = { d: { w: 1440, h: 900, dpr: 2, touch: false, name: 'desktop-1440x900' }, l: { w: 1366, h: 1024, dpr: 2, touch: true, name: 'ipad-1366x1024' }, p: { w: 1024, h: 1366, dpr: 2, touch: true, name: 'ipad-1024x1366' } }; // ((review 2 P3-8) d at dpr 2 too, as §10 G11 says
  const all = [], sheets = [];
  let failed = 0;
  try {
    for (const sk of SIZES) {
      const S = SZ[sk];
      if (!S) continue;
      for (const narrow of NARROW ? [false, true] : [false]) {
        const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
        const s = (m, p) => send(m, p, sessionId);
        await s('Runtime.enable'); await s('Page.enable');
        await s('Emulation.setDeviceMetricsOverride', { width: S.w, height: S.h, deviceScaleFactor: S.dpr, mobile: S.touch });
        if (S.touch) await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
        await s('Page.navigate', { url: 'http://127.0.0.1:' + port + '/__wc.html?narrow=' + (narrow ? 1 : 0) + '&touch=' + (S.touch ? 1 : 0) });
        let R = null;
        for (let i = 0; i < 300 && !R; i++) {
          await new Promise(r => setTimeout(r, 100));
          const v = await s('Runtime.evaluate', { expression: 'window.__wc ? JSON.stringify(window.__wc) : null', returnByValue: true });
          if (v.result && v.result.value) R = JSON.parse(v.result.value);
        }
        if (!R) {
          const v = await s('Runtime.evaluate', { expression: 'window.__wcStep + " · " + location.href + " · " + document.readyState + " · " + document.body.innerHTML.length + " · " + document.title', returnByValue: true });
          R = { error: 'timeout (' + (v.result && v.result.value) + ')' };
        }
        R.name = S.name + (narrow ? '-narrow' : '');
        R.console = logs.splice(0);
        if (R.console.length) console.log(R.name + ' console:\n  ' + R.console.slice(0, 20).join('\n  '));
        all.push(R);
        if (R.error) { failed++; console.log(R.name + ': ERROR ' + R.error); }
        else {
          console.log('\n' + R.name + (R.fails.length ? '  ✗ ' + R.fails.length + ' failure(s)' : '  ✓ G11 green') + '  (' + R.size.join(' × ') + '; the probe: stack ' + (R.font && R.font.stack) + ' / Inter ' + (R.font && R.font.inter) + ' px)');
          console.log('  bars: ' + R.faces.map(f => (f.bar ? f.key + ' "' + f.bar.title + '" ' + f.bar.w + '/' + f.bar.room : f.key)).join(' · '));
          console.log('  face        variant     w×h        fill  strict edge  ctl  text font knobs jacks contrast  parity(dests)   els / stage-3');
          for (const f of R.faces) console.log('  ' + f.key.padEnd(10) + ' ' + String(f.variant).padEnd(11) + ' ' + (f.w + '×' + f.h).padEnd(10) + ' ' + String(f.fill).padEnd(5) + ' ' + String(f.strict).padEnd(6) + ' ' + String(f.minEdge).padEnd(5) + ' ' + String(f.minCtl).padEnd(4) + ' ' + String(f.minText).padEnd(4) + ' ' + String(f.minFont).padEnd(4) + ' ' + String(f.knobs).padEnd(5) + ' ' + String(f.jacks).padEnd(5) + ' ' + (f.contrast + '/' + f.contrastVal).padEnd(9) + ' ' + (f.missing.length ? '✗ ' + f.missing.length : '✓') + ' ' + f.dests + '⊇' + f.dests3 + '      ' + f.count + ' / ' + f.count3 + ' (' + f.ratio + ') painted ' + f.painted + ' / ' + f.painted3 + ' (' + f.pratio + ')');
          for (const f of R.faces) if (f.words && f.words.length) console.log('  words ' + f.key + ': ' + f.words.join(' | '));
          if (R.drawer) console.log('  amp drawer ' + R.drawer.w + '×' + R.drawer.h + ' edge ' + R.drawer.minEdge);
          for (const m of R.fails) console.log('    · ' + m);
          failed += R.fails.length;
          if (OUT) {
            const lm = await s('Page.getLayoutMetrics');
            const cs = lm.cssContentSize || lm.contentSize;
            const shot = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: Math.max(S.w, Math.ceil(cs.width)), height: Math.ceil(cs.height), scale: 1 } });
            const file = path.join(OUT, 'wc1-faces-' + R.name + '.png');
            fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
            sheets.push(file);
            if (process.argv.includes('--faces')) {
              const dir = path.join(OUT, R.name);
              fs.mkdirSync(dir, { recursive: true });
              const rects = JSON.parse((await s('Runtime.evaluate', { expression: 'JSON.stringify(Array.from(document.querySelectorAll("#world > .cv-mod")).map(m => { const r = m.getBoundingClientRect(); return [m.getAttribute("data-cv-mod"), r.left + scrollX, r.top + scrollY, r.width, r.height]; }))', returnByValue: true })).result.value);
              for (const [k, x, y, w, h] of rects) { const sh = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: x - 8, y: y - 8, width: w + 16, height: h + 16, scale: 2 } }); fs.writeFileSync(path.join(dir, k + '.png'), Buffer.from(sh.data, 'base64')); }
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
  if (OUT) { fs.writeFileSync(path.join(OUT, 'g11.json'), JSON.stringify(all, null, 1)); console.log('\nsheets:\n  ' + sheets.join('\n  ')); }
  if (JSONOUT) console.log(JSON.stringify(all));
  console.log(failed ? '\nG11: ' + failed + ' failure(s)' : '\nG11: green');
  process.exit(failed ? 1 : 0);
}
