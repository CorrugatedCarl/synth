// tests/ui-layout-kit.mjs — G8, the drum machine's faces measured (docs/canvas/IMPL-DM.md §4.1–§4.3, §7.3, §8 G8 / G10; stage DM lane F):
// kit-ui's kitHost faces on a page of their own (fakes of lanes S / H: a record through kit-core normKit with a groove of ours, the vals of
// KIT.KITS, a drum api that never posts), measured from getBoundingClientRect in world px (100 %): the Sequencer at 0 / 4 / 8 / 16 voices
// and the six voice faces (one a type), each in a .cv-mod[data-cv-rig] as cv-module builds it (the bar: title over sub) — the widths
// 64·n + 32 (1248 / 288), the rows' tops and heights against layoutOf, the knobs 40 × 40 on column centres and their row's knob line, the
// step grid on its columns (the hit layer at columns 3–18 and the ruler's foot, every row header and lamp a 48 px row, kitHost.cellRect
// on the very boxes), every control inside the inner area, every text ≥ 6 px from the face edge and from every control (its own excepted),
// ≥ 8 px from other text (a cell's stack one), nothing clipped (a name ellipsizes), the font minima, the fill (control ∪ screen ∪ text
// over the face: the voice faces in GRID.fill, the Sequencer's lower bound only — its screen is the instrument, §4.1), each text ≥ 4.5 : 1
// on its own composited ground and every KIT.TINT ≥ 3 : 1 on the grid's screen — in charcoal, ivory and glass —, the hits on touch (every
// control's box ∪ its ::after band ≥ 44 × 44), a skin switch moving no box, the element counts (Sequencer ≤ 160, a voice ≤ 150) and
// painted counts, the words (no Serum / Xfer / Wavecraft on a face). Then the contact sheets: kit-face-<size>-<skin>.png (every face).
//   node --max-old-space-size=2048 tests/ui-layout-kit.mjs [--out <dir>] [--sizes d,l,p] [--narrow] [--json] [--profile <dir>] [--host <class>]
//     (fix round) the Sequencer mounted as main.js mounts it — in its section.inst (renderPanel's class; --host tries another) — and the
//     face flush in its body; each pass at exactly its size (a widened layout viewport fails)
//     sizes: d 1440 × 900 (mouse) · l 1366 × 1024 and p 1024 × 1366 (touch) — dpr 2; --narrow: each size twice (Inter alone, then the
//     bundled Archivo Narrow: the skins' face stack). Chrome: Chrome for Testing — $CHROME, else .claude/test-browser's (this checkout's or
//     the main checkout's); never the user's Google Chrome; a temporary profile (--profile <dir>: the caller's scratchpad); downloads
//     denied; exit 1 on any failure.
// Not a node --test file (not in the sweep): a CDP harness like ui-layout-wc.mjs. In the page the module is imported by the harness HTML
// the driver serves (/__kit.html): page(o) builds and measures; nothing at top level touches node or the DOM.

/* ================================================================ the page side (browser) */
const MIN = { lab: 11, val: 10, head: 12 };
const rgba = c => { const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(c || ''); return m ? [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]] : null; };
const hexRgb = h => { const n = parseInt(String(h).slice(1, 7), 16); return [n >> 16, (n >> 8) & 255, n & 255, 1]; };
const lumA = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const x = lumA(a), y = lumA(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// an element's ground: its own and its ancestors' backgrounds composited down to the first opaque one (else the page's)
function ground(e) {
  const layers = [];
  for (let n = e; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c && c[3] > 0) { layers.push(c); if (c[3] >= 0.99) break; } }
  let out = layers.length && layers[layers.length - 1][3] >= 0.99 ? layers.pop() : rgba(getComputedStyle(document.body).backgroundColor) || [12, 13, 15, 1];
  for (let i = layers.length - 1; i >= 0; i--) { const L = layers[i], a = L[3]; out = [L[0] * a + out[0] * (1 - a), L[1] * a + out[1] * (1 - a), L[2] * a + out[2] * (1 - a), 1]; }
  return out;
}
const PAGE = `
html, body { margin: 0; background: #0c0d0f; }
#world { position: relative !important; width: auto !important; height: auto !important; display: flex; flex-wrap: wrap; align-items: flex-start; gap: 40px 32px; padding: 32px; --ik: 1; }
#world .cv-mod { position: relative; }
#world .kit-rack { display: flex; flex-wrap: wrap; gap: 32px; width: 1248px; }
#sheetTitle { color: #9c978a; font: 500 13px var(--ui, system-ui); padding: 20px 32px 0; }
`;
// a groove of ours for the faces (never shipped): kick 1 5 9 13 · snare 5 13 · clap 13 · hats 3 7 11 / 1 5 9 13 soft · toms · rim
const GROOVE = [[0, 0, 127], [0, 4, 100], [0, 8, 100], [0, 12, 100], [1, 4, 100], [1, 12, 120], [2, 12, 90], [3, 2, 100], [3, 6, 100], [3, 10, 100],
  [3, 0, 64], [3, 4, 64], [3, 8, 64], [3, 12, 64], [4, 14, 100], [5, 9, 80], [6, 10, 96], [7, 11, 64], [7, 15, 40]];
export async function page(o) {
  const O = o || {}, d = document, v = '?v=9';
  window.__kitStep = 'imports'; window.__kitTouch = !!O.touch;
  const [UI, KC, RG] = await Promise.all(['../kit-ui.js', '../kit-core.js', '../rig-grid.js'].map(p => import(p + v)));
  const { KIT } = KC, { GRID } = RG;
  const st = d.createElement('style'); st.textContent = PAGE; d.head.appendChild(st);
  const world = d.createElement('div'); world.id = 'world'; world.setAttribute('data-cv-skin', 'charcoal');
  const title = d.createElement('div'); title.id = 'sheetTitle';
  title.textContent = 'Drum machine faces · RIG grid · ' + (O.narrow ? 'Archivo Narrow' : 'Inter (fallback)') + ' · ' + innerWidth + ' × ' + innerHeight + (O.touch ? ' touch' : '') + ' · 100 %';
  d.body.append(title, world);
  // one kit instance: its vals (types[j] a slot's TYPE), its record (the groove on its present slots), its host
  function kit(types, o2 = {}) {
    const vals = Object.assign({}, KIT.KITS[0].v);
    KIT.CODES.forEach((c, j) => { const ty = types[j] | 0; if (ty && ty !== vals[c + 't']) Object.assign(vals, { [c + 't']: ty }, Object.fromEntries(['u', 'd'].map(f => [c + f, Math.round(KIT.TYPES[ty][f].def * 1000) / 100])), Object.fromEntries(KIT.TYPES[ty].k.map((L, i) => [c + (i + 1), Math.round(L.def * 1000) / 100]))); if (!ty) vals[c + 't'] = 0; });
    const ty = KIT.CODES.map(c => vals[c + 't']), nm = KIT.CODES.map((c, j) => (KIT.STARTER[j] && ty[j] === KIT.STARTER[j].t ? KIT.STARTER[j].nm : ''));
    const cells = GROOVE.filter(([l]) => ty[l]).concat(o2.extra || []);
    const rec = KC.normKit({ ty, nm, pat: [{ len: o2.len || 16, cells: cells.map(([l, s, v2]) => ({ l, s, v: v2 })) }, { len: 16, cells: [{ l: 0, s: 0, v: 100 }] }], ui: { pat: 0 }, x: { swing: o2.swing || 56, mute: o2.mute || 0, solo: o2.solo || 0 } });
    const api = { state: () => ({ D: rec, S: KC.initState(), run: false }), step: () => () => {}, lit: () => () => {}, on: () => () => {}, pads: { on() { return true; }, off() {} } };
    const K = UI.kitHost({ doc: d, barH: 40, get: (t, dev, k) => vals[k], set() {}, drum: () => api, edit() { return true; }, menu() {}, presetName: () => 'Starter', leds: () => ({ step: o2.step == null ? -1 : o2.step }) });
    return { K, vals, rec, ty };
  }
  const views = [];
  // a module as cv-module builds it: the bar (⏻ slot hidden, stripe, title over sub, ⋯, ▾), the body; its width the face's
  function module(key, ttl, sub, color) {
    const mod = d.createElement('div'); mod.className = 'cv-mod'; mod.setAttribute('data-cv-rig', ''); mod.setAttribute('data-cv-mod', key);
    const bar = d.createElement('div'); bar.className = 'cv-bar';
    const pow = d.createElement('span'); pow.className = 'cv-pow'; pow.hidden = true;
    const stripe = d.createElement('span'); stripe.className = 'cv-stripe'; if (color) stripe.style.background = color;
    const tt = d.createElement('span'); tt.className = 'cv-ttl'; const te = d.createElement('span'); te.className = 'cv-title'; te.textContent = ttl;
    const se = d.createElement('span'); se.className = 'cv-sub'; se.textContent = sub || ''; se.hidden = !sub;
    tt.append(te, se);
    const more = d.createElement('button'); more.className = 'cv-btn cv-more'; more.textContent = '⋯';
    const fold = d.createElement('button'); fold.className = 'cv-btn cv-fold'; fold.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.25 6 7.75l3.5-3.5"/></svg>';
    bar.append(pow, stripe, tt, more, fold);
    const body = d.createElement('div'); body.className = 'cv-body';
    mod.append(bar, body);
    return { mod, body };
  }
  const ALL = [1, 2, 4, 3, 3, 5, 5, 6, 1, 2, 3, 4, 5, 6, 3, 6];
  const SCENES = [
    { key: 'seq0', types: [], voices: false },
    { key: 'seq4', types: [1, 2, 4, 3], voices: false },
    { key: 'starter', types: KIT.STARTER.map(e => e.t), voices: true, o: { step: 4 } },
    { key: 'seq16', types: ALL, voices: false, o: { mute: (1 << 5) | (1 << 9), solo: 0, len: 12 } },
    { key: 'types', types: [1, 2, 3, 4, 5, 6], voices: true, seq: false, o: { mute: 1 << 4 } },
  ];
  window.__kitStep = 'faces';
  for (const S of SCENES) {
    const I = kit(S.types, S.o);
    const wrap = d.createElement('div'); wrap.className = 'kit-rack';
    world.appendChild(wrap);
    if (S.seq !== false) {
      const n = I.ty.filter(Boolean).length, { mod, body } = module('seq-' + S.key, 'Drums 1', 'Sequencer · ' + n + (n === 1 ? ' drum' : ' drums'), null);
      wrap.appendChild(mod);
      // ((fix round, review R2-1 / R2-16) as main.js mounts it: the instrument's section.inst (cvBodyEl) in the module body, its class
      // renderPanel's kit branch's — canvas-DM-sim pins main's; `?host=` here the class to try, e.g. the bare 'inst' of the bug)
      const host = d.createElement('section'); host.className = O.host || 'inst custom m-kit'; host.setAttribute('aria-label', 'Instrument panel'); body.appendChild(host);
      const V = I.K.face('seq', host, { t: { id: 't' }, dev: 'i1' });
      mod.style.width = V.face.w + 'px';
      views.push({ key: 'seq-' + S.key, kind: 'seq', n, V, mod, K: I.K, recipe: UI.seqRecipe(n) });
    }
    if (S.voices) for (const e of I.K.devices({ id: 't' }, 'i1')) {
      const { mod, body } = module(e.key, e.title, e.sub, e.color);
      wrap.appendChild(mod);
      const V = I.K.face('voice', body, { t: { id: 't' }, dev: 'i1', slot: e.slot });
      mod.style.width = V.face.w + 'px';
      views.push({ key: S.key + '-' + e.code + '-' + KIT.TYPES[e.type].id, kind: 'voice', V, mod, K: I.K, recipe: UI.FACE.voice });
    }
  }
  if (d.fonts && d.fonts.ready) await d.fonts.ready;
  if (O.narrow && d.fonts && d.fonts.load) { try { await d.fonts.load("600 13px 'Archivo Narrow'"); } catch (err) { /* measured below */ } }
  for (let i = 0; i < 4; i++) await new Promise(r => requestAnimationFrame(r));
  await new Promise(r => setTimeout(r, 200));
  window.__kitStep = 'measure';
  const res = { size: [innerWidth, innerHeight, devicePixelRatio], touch: !!O.touch, narrow: !!O.narrow, faces: [], fails: [], skins: {} };
  const probe = f => { const s = d.createElement('span'); s.style.cssText = 'position: absolute; left: -9999px; visibility: hidden; white-space: nowrap; font: 600 13px ' + f; s.textContent = 'CLOSED HAT · OPEN HAT · HIGH TOM'; d.body.appendChild(s); const w = s.getBoundingClientRect().width; s.remove(); return Math.round(w * 100) / 100; };
  res.font = { stack: probe("'Archivo Narrow', Inter"), inter: probe('Inter') };
  if (O.narrow ? Math.abs(res.font.stack - res.font.inter) < 1 : Math.abs(res.font.stack - res.font.inter) > 0.5) res.fails.push('the font pass is not the one it names (' + res.font.stack + ' vs Inter ' + res.font.inter + ')');
  // every box (faces and their controls) under charcoal: a skin switch moves none
  const boxes = () => views.map(F => [F.V.el, ...F.V.el.querySelectorAll(CTL_SEL + ', ' + TEXT_SEL)].map(e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }));
  const box0 = boxes();
  for (const sk of ['charcoal', 'ivory', 'glass']) {
    world.setAttribute('data-cv-skin', sk);
    for (const F of views) F.V.sync();
    for (let i = 0; i < 2; i++) await new Promise(r => requestAnimationFrame(r));
    const b = boxes();
    b.forEach((L, i) => L.forEach((r, k) => { if (r.some((x, q) => Math.abs(x - box0[i][k][q]) > 0.01)) res.fails.push(views[i].key + ': the ' + sk + ' skin moved a box (' + k + ')'); }));
    const S = res.skins[sk] = { minText: Infinity, minTint: Infinity, worst: '' };
    for (const F of views) {
      const m = skinChecks(F, KIT, sk);
      if (m.minText < S.minText) { S.minText = m.minText; S.worst = F.key + ' "' + m.worstText + '"'; }
      S.minTint = Math.min(S.minTint, m.minTint);
      for (const x of m.fails) res.fails.push(F.key + ' (' + sk + '): ' + x);
    }
    S.minText = +S.minText.toFixed(2); S.minTint = S.minTint === Infinity ? null : +S.minTint.toFixed(2);
  }
  world.setAttribute('data-cv-skin', 'charcoal');
  for (const F of views) F.V.sync();
  await new Promise(r => requestAnimationFrame(r));
  for (const F of views) res.faces.push(measure(F, RG, UI, KIT));
  for (const f of res.faces) for (const m of f.fails) res.fails.push(f.key + ': ' + m);
  // the scenes' painted elements (§7.3: the touch notice's lines — the Starter scene, a 16-voice kit)
  const painted = el => Array.from(el.querySelectorAll('*')).filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').length + 1;
  res.scenes = Array.from(world.querySelectorAll('.kit-rack')).map((w, i) => ({ key: SCENES[i].key, modules: w.children.length, painted: Array.from(w.children).reduce((a, m) => a + painted(m), 0) }));
  window.__kit = res;
  return res;
}
const vis = (el, root) => { if (!el || !el.getClientRects || !el.getClientRects().length) return false; for (let n = el; n && n !== root; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return false; } return true; };
const TEXT_SEL = '.wk-knob > .wk-lab, .wk-knob > .wk-num, .wk-nb > .wk-lab, .wk-nbv, .wk-mtxt, .kit-cap, .kit-btn, .kit-pat, .kit-rul, .kit-rh, .kit-add, .kit-hit';
const CTL_SEL = '.wk-knob > .wk-svg, .wk-nbv, .wk-mbtn, .kit-btn, .kit-pat, .kit-hit, .kit-hits, .kit-rh, .kit-add, .kit-tint, .rig-disp';
const HIT_SEL = '.wk-knob, .wk-nb, .wk-mbtn, .kit-btn, .kit-pat, .kit-hit, .kit-rh, .kit-add';
const FILL_SEL = '.wk-knob, .wk-nb, .wk-menu, .kit-btn, .kit-pat, .kit-hit, .kit-tint, .kit-cap, .rig-disp';
function textBox(el) {
  if (el.firstChild && el.matches('.wk-mtxt, .wk-nbv, .kit-btn, .kit-pat, .kit-rul, .kit-rh, .kit-add, .kit-hit')) {
    const r = document.createRange(); r.selectNodeContents(el); const b = r.getBoundingClientRect();
    if (b.width > 0) {
      if (el.matches('.kit-rh')) { const c = el.getBoundingClientRect(), pr = parseFloat(getComputedStyle(el).paddingRight) || 0; return { left: b.left, top: b.top, bottom: b.bottom, height: b.height, right: Math.min(b.right, c.right - pr), width: Math.min(b.right, c.right - pr) - b.left }; } // (an ellipsized name ends at its padding)
      return b;
    }
  }
  return el.getBoundingClientRect();
}
const gap = (a, b) => { const dx = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right)), dy = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom)); return Math.hypot(dx, dy); };
const cellOf = el => (el.closest ? el.closest('.rig-cell, .rig-head > *, .kit-rh, .kit-add, .kit-hit') : null);
function hitOf(e) {
  const r = e.getBoundingClientRect(), out = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  for (const p of ['::after', '::before']) {
    const a = getComputedStyle(e, p);
    if (!a || a.content === 'none' || a.position !== 'absolute') continue;
    const w = parseFloat(a.width), h = parseFloat(a.height), L = r.left + e.clientLeft + (parseFloat(a.left) || 0), T = r.top + e.clientTop + (parseFloat(a.top) || 0);
    if (!(w > 0 && h > 0)) continue;
    out.left = Math.min(out.left, L); out.top = Math.min(out.top, T); out.right = Math.max(out.right, L + w); out.bottom = Math.max(out.bottom, T + h);
  }
  out.width = out.right - out.left; out.height = out.bottom - out.top;
  return out;
}
// each text on its own ground ≥ 4.5 : 1; each voice tint ≥ 3 : 1 on the grid's screen (the canvas draws them there)
function skinChecks(F, KIT, sk) {
  const face = F.V.el, fails = [], out = { minText: Infinity, worstText: '', minTint: Infinity, fails };
  for (const e of face.querySelectorAll(TEXT_SEL)) {
    if (!vis(e, face) || !e.textContent.trim()) continue;
    const c = rgba(getComputedStyle(e).color), g = ground(e), r = ratio(c, g);
    if (r < out.minText) { out.minText = r; out.worstText = e.textContent.trim().slice(0, 14); }
    if (r < 4.5) fails.push('text "' + e.textContent.trim().slice(0, 14) + '" ' + r.toFixed(2) + ' : 1 on its ground');
  }
  const scr = face.querySelector('.kit-scr');
  if (scr) { const g = ground(scr); for (let t = 1; t < KIT.TINT.length; t++) { const r = ratio(hexRgb(KIT.TINT[t]), g); out.minTint = Math.min(out.minTint, r); if (r < 3) fails.push('tint ' + KIT.TINT[t] + ' ' + r.toFixed(2) + ' : 1 on the screen'); } }
  return out;
}
function measure(F, RG, UI, KIT) {
  const face = F.V.el, fr = face.getBoundingClientRect(), fails = [], out = { key: F.key, kind: F.kind, touch: !!window.__kitTouch };
  const rel = r => ({ left: r.left - fr.left, top: r.top - fr.top, right: r.right - fr.left, bottom: r.bottom - fr.top, width: r.width, height: r.height });
  const L = RG.layoutOf(F.recipe), G = RG.GRID, n = L.cols;
  out.w = +fr.width.toFixed(2); out.h = +fr.height.toFixed(2);
  const bd = F.mod.querySelector('.cv-body'), br = bd ? bd.getBoundingClientRect() : fr; // ((R2-1) the face flush in its module body: no host padding, nothing cut
  if (Math.abs(fr.left - br.left) > 0.5 || Math.abs(fr.top - br.top) > 0.5 || fr.right > br.right + 0.5 || fr.bottom > br.bottom + 0.5) fails.push('the face is not flush in its body (dx ' + (fr.left - br.left) + ', dy ' + (fr.top - br.top) + ', cut ' + Math.max(0, fr.right - br.right) + ' / ' + Math.max(0, fr.bottom - br.bottom) + ')');
  const te = F.mod.querySelector('.cv-title'), tt = F.mod.querySelector('.cv-ttl');
  if (te && tt && te.scrollWidth > tt.clientWidth + 0.5) fails.push('bar title "' + te.textContent + '" clipped (' + te.scrollWidth + ' > ' + tt.clientWidth + ')');
  const se = F.mod.querySelector('.cv-sub');
  if (se && !se.hidden && se.scrollWidth > se.clientWidth + 0.5) fails.push('bar sub "' + se.textContent + '" clipped');
  if (Math.abs(fr.width - (64 * n + 32)) > 0.5) fails.push('width ' + fr.width + ' ≠ ' + (64 * n + 32));
  if (Math.abs(fr.width - (F.kind === 'seq' ? 1248 : 288)) > 0.5) fails.push('width ' + fr.width + ' ≠ the contract\'s');
  if (Math.abs(fr.height - L.h) > 0.5) fails.push('height ' + fr.height + ' ≠ ' + L.h);
  if (F.kind === 'voice' && Math.abs(fr.height - 236) > 0.5) fails.push('height ' + fr.height + ' ≠ 236');
  const rows = Array.from(face.children).filter(e => e.classList.contains('rig-row'));
  if (rows.length !== L.rows.length) fails.push('rows ' + rows.length + ' ≠ ' + L.rows.length);
  rows.forEach((re, i) => { const r = rel(re.getBoundingClientRect()), want = L.rows[i]; if (want && (Math.abs(r.top - want.top) > 0.5 || Math.abs(r.height - want.h) > 0.5)) fails.push('row ' + i + ' (' + want.t + ') at ' + r.top + '+' + r.height + ', want ' + want.top + '+' + want.h); });
  const colC = x => { const i = Math.round((x - G.pad - G.col / 2) / G.col); return Math.abs(x - (G.pad + G.col / 2 + G.col * i)) <= 0.5 && i >= 0 && i < n; };
  let knobs = 0;
  for (const re of rows) {
    if (!re.classList.contains('rig-knobs')) continue;
    const top = rel(re.getBoundingClientRect()).top;
    for (const sv of re.querySelectorAll('.rig-cell > .wk-knob > .wk-svg')) {
      knobs++;
      const r = rel(sv.getBoundingClientRect()), cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2, id = sv.parentNode.getAttribute('data-dest');
      if (Math.abs(r.width - G.knob) > 0.5 || Math.abs(r.height - G.knob) > 0.5) fails.push('knob ' + id + ' ' + r.width + ' × ' + r.height);
      if (!colC(cx)) fails.push('knob ' + id + ' x ' + cx + ' off the columns');
      if (Math.abs(cy - (top + G.knobTop + G.knob / 2)) > 0.5) fails.push('knob ' + id + ' y ' + cy + ' off its knob line');
    }
  }
  out.knobs = knobs;
  // the step grid: the hit layer on columns 3–18 under the ruler, the rows 48, the headers / lamps on their rows, cellRect on the boxes
  if (F.kind === 'seq') {
    const gr = rows[1] && rel(rows[1].getBoundingClientRect()), hits = face.querySelector('.kit-hits'), hr = rel(hits.getBoundingClientRect()), ST = G.steps;
    const want = { left: G.pad + 2 * G.col, top: gr.top + ST.ruler, width: 16 * G.col, height: F.n * ST.cell };
    for (const k of ['left', 'top', 'width', 'height']) if (Math.abs(hr[k] - want[k]) > 0.5) fails.push('the hit layer ' + k + ' ' + hr[k] + ' ≠ ' + want[k]);
    const hd = Array.from(face.querySelectorAll('.kit-rh')), lamps = Array.from(face.querySelectorAll('.kit-lamp'));
    if (hd.length !== F.n || lamps.length !== F.n) fails.push('rows ' + hd.length + ' / lamps ' + lamps.length + ' ≠ ' + F.n);
    hd.forEach((h, r) => { const b = rel(h.getBoundingClientRect()), l = rel(lamps[r].getBoundingClientRect()), y = gr.top + ST.ruler + r * ST.cell;
      if (Math.abs(b.top - y) > 0.5 || Math.abs(b.height - ST.cell) > 0.5 || Math.abs(b.left - G.pad) > 0.5 || Math.abs(b.width - 2 * G.col) > 0.5) fails.push('header ' + r + ' ' + b.left + ',' + b.top + ' ' + b.width + '×' + b.height);
      if (Math.abs(l.top - y) > 0.5 || Math.abs(l.left - (G.pad + 18 * G.col)) > 0.5 || Math.abs(l.width - G.col) > 0.5) fails.push('lamp ' + r + ' at ' + l.left + ',' + l.top);
      const slot = +h.getAttribute('data-slot'), mr = F.mod.getBoundingClientRect();
      for (const s of [0, 7, 15]) { const c = F.K.cellRect({ id: 't' }, 'i1', slot, s), hx = hits.getBoundingClientRect(); if (!c || Math.abs(mr.left + c.x - (hx.left + s * G.col)) > 0.5 || Math.abs(mr.top + c.y - (hx.top + r * ST.cell)) > 0.5 || c.w !== G.col || c.h !== ST.cell) fails.push('cellRect ' + slot + '/' + s + ' off its cell'); }
    });
    const add = face.querySelector('.kit-add'), ab = add && !add.hidden ? rel(add.getBoundingClientRect()) : null;
    if (F.n < 16 && (!ab || Math.abs(ab.top - (gr.top + ST.ruler + F.n * ST.cell)) > 0.5 || Math.abs(ab.height - ST.cell) > 0.5)) fails.push('+ Add drum off its row');
    if (F.n >= 16 && add && !add.hidden) fails.push('+ Add drum shown at 16');
    const rul = Array.from(face.querySelectorAll('.kit-rul'));
    rul.forEach((x, i) => { const b = rel(x.getBoundingClientRect()); if (Math.abs(b.left - (G.pad + (2 + 4 * i) * G.col)) > 0.5 || b.bottom > gr.top + ST.ruler + 0.5) fails.push('ruler ' + x.textContent + ' off its column'); });
  }
  // every control inside the inner area
  for (const c of face.querySelectorAll(CTL_SEL)) {
    if (!vis(c, face)) continue;
    const r = rel(c.getBoundingClientRect());
    if (r.left < G.pad - 0.5 || r.right > fr.width - G.pad + 0.5 || r.top < G.top - 0.5 || r.bottom > fr.height - G.bottom + 0.5) fails.push('control ' + (c.getAttribute('data-dest') || c.getAttribute('aria-label') || c.className.baseVal || c.className) + ' outside the inner area');
  }
  // text: margins, gaps, clipping, sizes
  const texts = Array.from(face.querySelectorAll(TEXT_SEL)).filter(e => vis(e, face) && e.textContent.trim());
  const ctls = Array.from(face.querySelectorAll(CTL_SEL)).filter(e => vis(e, face));
  let minEdge = Infinity, minCtl = Infinity, minText = Infinity, minFont = Infinity;
  const tb = texts.map(e => ({ e, r: textBox(e) }));
  for (const { e, r } of tb) {
    const R = rel(r), edge = Math.min(R.left, R.top, fr.width - R.right, fr.height - R.bottom), nm = e.textContent.trim().slice(0, 16);
    minEdge = Math.min(minEdge, edge);
    if (edge < G.margin - 0.01) fails.push('text "' + nm + '" ' + edge.toFixed(1) + ' px from the face edge');
    for (const c of ctls) {
      if (c === e || c.contains(e) || e.contains(c) || (c.matches('.rig-disp') && c.contains(e))) continue;
      if (c.matches('.rig-disp')) continue;                      // (the screen holds the grid's texts: their gaps are to its controls)
      const g = gap(r, c.getBoundingClientRect());
      minCtl = Math.min(minCtl, g);
      if (g < G.margin - 0.01) fails.push('text "' + nm + '" ' + g.toFixed(1) + ' px from a control (' + (c.getAttribute('aria-label') || c.className.baseVal || c.className) + ')');
    }
    const fs = parseFloat(getComputedStyle(e).fontSize) || 0, want = e.matches('.wk-num, .wk-nbv') && !e.closest('.rig-head') ? MIN.val : e.closest('.rig-head') ? MIN.head : MIN.lab;
    minFont = Math.min(minFont, fs);
    if (fs < want - 0.01) fails.push('text "' + nm + '" ' + fs + ' px < ' + want);
    const name = e.matches('.kit-rh') || (e.matches('.wk-mtxt') && e.closest('.rig-grow'));
    if (!name && e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0) { const w = textBox(e).width; if (w > e.getBoundingClientRect().width + 1) fails.push('text "' + nm + '" clipped (' + e.scrollWidth + ' > ' + e.clientWidth + ')'); }
  }
  for (let i = 0; i < tb.length; i++) for (let j = i + 1; j < tb.length; j++) {
    const a = tb[i], b = tb[j], ca = cellOf(a.e), cb = cellOf(b.e);
    if ((ca && ca === cb) || a.e.contains(b.e) || b.e.contains(a.e)) continue;
    const g = gap(a.r, b.r);
    minText = Math.min(minText, g);
    if (g < G.textGap - 0.01) fails.push('texts "' + a.e.textContent.trim().slice(0, 12) + '" / "' + b.e.textContent.trim().slice(0, 12) + '" ' + g.toFixed(1) + ' px apart');
  }
  Object.assign(out, { minEdge: +minEdge.toFixed(1), minCtl: +minCtl.toFixed(1), minText: +minText.toFixed(1), minFont });
  // the fill: every grid cell a control stands in, the head's items at the row's height, the screen, the texts
  const W = Math.round(fr.width), Hh = Math.round(fr.height), grid = new Uint8Array(W * Hh);
  const paint = r => { const R = rel(r), x0 = Math.max(0, Math.floor(R.left)), x1 = Math.min(W, Math.ceil(R.right)), y0 = Math.max(0, Math.floor(R.top)), y1 = Math.min(Hh, Math.ceil(R.bottom)); for (let y = y0; y < y1; y++) grid.fill(1, y * W + x0, y * W + x1); };
  for (const re of rows) {
    if (re.matches('.rig-knobs')) { for (const c of re.querySelectorAll('.rig-cell')) paint(c.getBoundingClientRect()); }
    else if (re.matches('.rig-head')) { const R0 = re.getBoundingClientRect(); for (const x of re.children) if (vis(x, face)) { const r = x.getBoundingClientRect(); paint({ left: r.left, right: r.right, top: R0.top, bottom: R0.bottom }); } }
    else for (const x of re.querySelectorAll('.rig-disp')) paint(x.getBoundingClientRect());
  }
  for (const { r } of tb) paint(r);
  let on = 0; for (let i = 0; i < grid.length; i++) on += grid[i];
  out.fill = +(on / grid.length).toFixed(3);
  if (out.fill < G.fill[0] || (F.kind === 'voice' && out.fill > G.fill[1])) fails.push('fill ' + out.fill + ' outside ' + (F.kind === 'voice' ? G.fill.join('…') : '≥ ' + G.fill[0]));
  // the hits on touch: each control's box ∪ its ::after / ::before band ≥ 44 × 44 (the knob cell's 64 × 76, a header's 128 × 48 …)
  if (out.touch) {
    let minHit = Infinity;
    for (const e of face.querySelectorAll(HIT_SEL)) {
      if (!vis(e, face)) continue;
      const h = e.matches('.wk-nb') && e.closest('.rig-head') ? hitOf(e.querySelector('.wk-nbv')) : hitOf(e), m = Math.min(h.width, h.height);
      minHit = Math.min(minHit, m);
      if (h.width < G.hit - 0.5 || h.height < G.hit - 0.5) fails.push('hit ' + (e.getAttribute('aria-label') || e.textContent.trim().slice(0, 12) || e.className) + ' ' + h.width.toFixed(1) + ' × ' + h.height.toFixed(1));
    }
    const cellW = G.col, cellH = G.steps.cell;
    minHit = Math.min(minHit, cellW, cellH);
    out.minHit = +minHit.toFixed(1);
  }
  // counts, words
  out.count = face.querySelectorAll('*').length + 1;
  out.painted = Array.from(face.querySelectorAll('*')).filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').length + 1;
  const cap = F.kind === 'seq' ? 160 : 150;
  if (out.count > cap) fails.push('elements ' + out.count + ' > ' + cap);
  const words = [];
  for (const e of [face, ...face.querySelectorAll('*')]) for (const v of [e.getAttribute('title'), e.getAttribute('aria-label'), e.children.length ? '' : e.textContent]) if (v && /Serum|Xfer|Wavecraft/.test(v)) words.push(v.slice(0, 40));
  if (words.length) fails.push('words: ' + words.join(' | '));
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
  const HOST = arg('host', null), NARROW = process.argv.includes('--narrow'), OUT = arg('out', null), SIZES = String(arg('sizes', 'd,l,p')).split(','), JSONOUT = process.argv.includes('--json');
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
  const HTML = q => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1"><title>Kit faces</title>
<link rel="stylesheet" href="/__fonts.css?narrow=${q.narrow ? 1 : 0}"><link rel="stylesheet" href="/style.css?v=9"></head><body>
<script type="module">import('/tests/ui-layout-kit.mjs').then(m => m.page(${JSON.stringify(q)})).catch(e => { window.__kit = { error: String(e && e.stack || e) }; });</script></body></html>`;
  const fontsCss = narrow => { let css = fs.readFileSync(path.join(ROOT, 'fonts', 'fonts.css'), 'utf8').replace(/url\(([^/)][^)]*)\)/g, 'url(/fonts/$1)'); if (!narrow) css = css.replace(/@font-face\s*\{[^}]*'Archivo Narrow'[^}]*\}/g, ''); return css; };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/__kit.html') { res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); return res.end(HTML(Object.assign({ narrow: u.searchParams.get('narrow') === '1', touch: u.searchParams.get('touch') === '1' }, HOST ? { host: HOST } : null))); }
    if (u.pathname === '/__fonts.css') { res.writeHead(200, { 'Content-Type': 'text/css', 'Cache-Control': 'no-store' }); return res.end(fontsCss(u.searchParams.get('narrow') === '1')); }
    const f = path.join(ROOT, decodeURIComponent(u.pathname)), rel = path.relative(ROOT, f);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).some(x => x.startsWith('.'))) { res.writeHead(403); return res.end(); }
    fs.readFile(f, (e, data) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data); });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  // (CLAUDE.md) Chrome for Testing, never the user's Chrome: $CHROME, else .claude/test-browser's — this checkout's or the main checkout's
  const CFT = 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
  const cft = () => { for (const base of [ROOT, path.resolve(ROOT, '../../..')]) { const dir = path.join(base, '.claude', 'test-browser'); let vs = []; try { vs = fs.readdirSync(dir).sort().reverse(); } catch (e) { /* none */ } for (const v of vs) { const f = path.join(dir, v, CFT); if (fs.existsSync(f)) return f; } } return null; };
  const CHROME = process.env.CHROME || cft();
  if (!CHROME) { console.log('Chrome for Testing not found (.claude/test-browser): set $CHROME'); process.exit(2); }
  const prof = fs.mkdtempSync(path.join(arg('profile', os.tmpdir()), 'kit-chrome-'));
  const ch = cp.spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + prof, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-color-profile=srgb', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  console.log('Chrome for Testing pid ' + ch.pid);
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
  await send('Browser.setDownloadBehavior', { behavior: 'deny' }); // ((CLAUDE.md) no download ever reaches the user's folders
  const SZ = { d: { w: 1440, h: 900, dpr: 2, touch: false, name: 'desktop-1440x900' }, l: { w: 1366, h: 1024, dpr: 2, touch: true, name: 'ipad-1366x1024' }, p: { w: 1024, h: 1366, dpr: 2, touch: true, name: 'ipad-1024x1366' } };
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
        await s('Page.navigate', { url: 'http://127.0.0.1:' + port + '/__kit.html?narrow=' + (narrow ? 1 : 0) + '&touch=' + (S.touch ? 1 : 0) });
        let R = null;
        for (let i = 0; i < 300 && !R; i++) {
          await new Promise(r => setTimeout(r, 100));
          const v = await s('Runtime.evaluate', { expression: 'window.__kit ? JSON.stringify(window.__kit) : null', returnByValue: true });
          if (v.result && v.result.value) R = JSON.parse(v.result.value);
        }
        if (!R) { const v = await s('Runtime.evaluate', { expression: 'window.__kitStep', returnByValue: true }); R = { error: 'timeout (' + (v.result && v.result.value) + ')' }; }
        R.name = S.name + (narrow ? '-narrow' : '');
        R.console = logs.splice(0);
        if (!R.error && R.size && (R.size[0] !== S.w || R.size[1] !== S.h)) R.fails = (R.fails || []).concat('the pass ran at ' + R.size[0] + ' × ' + R.size[1] + ', not ' + S.w + ' × ' + S.h + ' (a widened layout viewport)'); // ((R2-16) the meta's minimum-scale=1: mobile emulation no longer widens it to the 1312 px sheet
        const errs = R.console.filter(m => !/^warning: /.test(m));
        if (errs.length && !R.error) R.fails = (R.fails || []).concat(errs.map(m => 'console ' + m.slice(0, 160)));
        all.push(R);
        if (R.error) { failed++; console.log(R.name + ': ERROR ' + R.error); }
        else {
          console.log('\n' + R.name + (R.fails.length ? '  ✗ ' + R.fails.length + ' failure(s)' : '  ✓ G8 green') + '  (' + R.size.join(' × ') + '; the probe: stack ' + R.font.stack + ' / Inter ' + R.font.inter + ' px)');
          console.log('  face                 w×h          fill   edge  ctl   text  font  knobs  hit   els / painted');
          for (const f of R.faces) console.log('  ' + f.key.padEnd(20) + ' ' + (f.w + '×' + f.h).padEnd(12) + ' ' + String(f.fill).padEnd(6) + ' ' + String(f.minEdge).padEnd(5) + ' ' + String(f.minCtl).padEnd(5) + ' ' + String(f.minText).padEnd(5) + ' ' + String(f.minFont).padEnd(5) + ' ' + String(f.knobs).padEnd(6) + ' ' + String(f.minHit == null ? '—' : f.minHit).padEnd(5) + ' ' + f.count + ' / ' + f.painted);
          for (const [k, x] of Object.entries(R.skins)) console.log('  skin ' + k.padEnd(9) + ' text ≥ ' + x.minText + ' : 1 (' + x.worst + ') · tints ≥ ' + x.minTint + ' : 1');
          console.log('  scenes: ' + R.scenes.map(x => x.key + ' ' + x.modules + ' modules ' + x.painted + ' painted').join(' · '));
          for (const m of R.fails) console.log('    · ' + m);
          failed += R.fails.length;
          if (OUT) {
            for (const skn of ['charcoal', 'ivory', 'glass']) {
              await s('Runtime.evaluate', { expression: "document.getElementById('world').setAttribute('data-cv-skin', '" + skn + "'); 1", returnByValue: true });
              await new Promise(r => setTimeout(r, 300));
              const lm = await s('Page.getLayoutMetrics'), cs = lm.cssContentSize || lm.contentSize;
              const shot = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: Math.max(S.w, Math.ceil(cs.width)), height: Math.ceil(cs.height), scale: 1 } });
              const file = path.join(OUT, 'kit-face-' + R.name + '-' + skn + '.png');
              fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
              sheets.push(file);
            }
            const le = logs.splice(0).filter(m => !/^warning: /.test(m));
            if (le.length) { console.log(R.name + ' sheets console:\n  ' + le.slice(0, 20).join('\n  ')); failed += le.length; }
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
  if (OUT) { fs.writeFileSync(path.join(OUT, 'g8-kit.json'), JSON.stringify(all, null, 1)); console.log('\nsheets:\n  ' + sheets.join('\n  ')); }
  if (JSONOUT) console.log(JSON.stringify(all));
  console.log(failed ? '\nG8 (kit): ' + failed + ' failure(s)' : '\nG8 (kit): green');
  process.exit(failed ? 1 : 0);
}
