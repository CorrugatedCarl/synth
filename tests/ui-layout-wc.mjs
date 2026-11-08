// tests/ui-layout-wc.mjs — G11, the layout system measured (docs/canvas/IMPL-WC.md §3.8, §10 G11; stage WC lane F): every WC-1 face
// mounted by rig-ui's rigHost over one rig's SerumHost (the app's own host: (SX0) sx-host createHost) on a page of its own, measured from
// getBoundingClientRect in world px (100 %): the module width (64·n + 32, on the 32 px dots), every row's top and height against
// layoutOf, every knob's SVG 40 × 40 on a column centre and on its row's knob line, the jacks (28 px at column centres, hit ≥ 44),
// every text box ≥ 6 px from the face edge and from every control box (its own excepted), ≥ 8 px from every other text box (a cell's
// label / value stack is one), nothing clipped (an asset name in a menu excepted: it ellipsizes), the font-size minima, the fill
// ratio (control ∪ screen ∪ text boxes over the face area) in GRID.fill, label / face contrast ≥ 4.5 : 1, the data-dest parity with
// the stage-3 panel of the same part and the element count against it ((SX0, lane K) the stage-3 views left with the parts machinery:
// their data-dest ids frozen from ⟨B⟩, tests/fixtures/sx0-dests.json state 'wc'; the count against the part's donor panel mounted as
// its view was, beside it, hidden — VOICE's panel has no donor left: its ids alone); (review 2 P3-2) each module's bar as
// cv-module builds it (⏻ slot, stripe, title — rig-core barOf —, ⋯, ▾): its title never clipped. Then the contact sheets: a PNG per size
// of every face side by side in the charcoal skin.
// (MOD1 G5, lane F) the ten modulators' faces too: LFO, Envelope, Macros and Chaos (cv-mods-ui slotBody: rig-ui's slot faces on their slot
// hosts; parity against the old body's panel — the same panel class on a second slot host, hidden — and ≤ 1.2 × its element count, G11's
// ratio), Mod Wheel, Velocity, Aftertouch, Bend, Note and CC (the plain faces, cv-mods-ui MOD_FACE: ≤ 48 elements); the same numbers,
// margins, fill and contrast; their words (no "ENV" — the LFO's mode excepted —, no "Serum", no "Xfer", "Macro" a knob's name only); then
// the skins: each face's box unmoved by a switch to ivory and glass, its label contrast in each. (MOD1 review, reviewer 2 P2) each modulator's
// bar as cv-module builds it (⏻ slot hidden, stripe, title over its sub — cv-mods modBarSub —, chip, CPU, ⋯, ▾) at its face's width: its title
// and sub never clipped, in every skin. (LC G7, lane F) the Combiner's face at 0 / 4 / 12 inputs (cv-mods-ui combBody on a stand-in ModCore:
// tests/lc-stub.mjs): the same numbers, ≤ 24 + 6n elements, each text ≥ 4.5 : 1 on its own ground, its list's 32 px lines in their columns,
// the hits on touch (the head's 44 px, a line's control the line's band); --lc writes its face in each skin (lc-face-<size>-<skin>.png).
//   node --max-old-space-size=2048 tests/ui-layout-wc.mjs [--out <dir>] [--narrow [<Archivo Narrow woff2>]] [--sizes d,l,p] [--json] [--profile <dir>] [--faces] [--lc]
//     sizes: d 1440 × 900 at 100 % (mouse) · l 1366 × 1024 and p 1024 × 1366 (touch) — every one at dpr 2 (§10 G11; review 2 P3-8: d ran
//     at 1); --narrow measures with the narrow face too (each size twice: Inter alone — fonts.css served WITHOUT its Archivo Narrow face, so
//     the skin's stack falls to Inter as it does when that face fails —, then Archivo Narrow: the bundled fonts/ArchivoNarrowVariable.woff2,
//     or the file given); each pass checks the face it measured really is that one (a probe's width); exit 1 on any failure. Chrome:
//     (MOD1, CLAUDE.md) Chrome for Testing — $CHROME, else .claude/test-browser's (the repo's or, from a worktree, the main checkout's);
//     never the user's Google Chrome; a temporary profile (under --profile <dir>, the caller's scratchpad, else the OS temp dir); downloads
//     denied; nothing of the user's is touched.
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
  window.__wcStep = 'imports'; window.__wcTouch = !!O.touch;
  const [core, wt, SU, MOD, RU, RC, wk, OSC, SEQ] = await Promise.all(['../serum-core.js', '../wt.js', '../sx-host.js', '../sx-ui-mod.js', '../rig-ui.js', '../rig-core.js', '../wk.js', '../sx-ui-osc.js', '../sx-ui-seq.js'].map(p => import(p + v)));
  // (SX0) the stage-3 panels' frozen data-dest ids (tests/ref-SX0/dests.mjs) and the donors their views were (bare, as the registration
  // built them; their ⏻ in the shell)
  const DESTS3 = await fetch(new URL('./fixtures/sx0-dests.json', import.meta.url)).then(r => r.json());
  const DONOR = { oscA: (r, K) => new OSC.OscPanel(r, K, 0), oscB: (r, K) => new OSC.OscPanel(r, K, 1), oscC: (r, K) => new OSC.OscPanel(r, K, 2), filter: (r, K) => new OSC.FilterPanel(r, K, 0),
    sub: (r, K) => new OSC.SubPanel(r, K), noise: (r, K) => new OSC.NoisePanel(r, K), env1: (r, K) => new MOD.EnvPanel(r, K, 0), env2: (r, K) => new MOD.EnvPanel(r, K, 1),
    lfo1: (r, K) => new MOD.LfoPanel(r, K, 0), macros: (r, K) => new MOD.MacrosPanel(r, K), arp: (r, K) => new SEQ.ArpPage(r, K), // ((ARP G3) the ARP page, as mountPart built it

    'slot:lfo': (r, K) => new MOD.LfoPanel(r, K, 0), 'slot:env': (r, K) => new MOD.EnvPanel(r, K, 1), 'slot:macro': (r, K) => new MOD.MacrosPanel(r, K), 'slot:chaos': (r, K) => new MOD.ChaosRow(r, K, 0, {}) };
  const donorView = (Hx, key, root, A) => Hx.mount((r, K) => { const P = DONOR[key](r, K); return { el: P.el, panel: P, power: (P.shell || {}).power || null, destroy: () => P.destroy() }; }, root, Object.assign({ bare: true }, A));
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
  const H = SU.createHost(mkHost(s, 'i1'), { doc: d }); // ((SX0) the app's host: SerumUI's parts host was this plus unread shell fields
  const H3 = SU.createHost(mkHost(JSON.parse(JSON.stringify(s)), 'i9'), { doc: d });
  const rig = RU.rigHost({ doc: d });
  // the faces of the sheet: [key, kind, part, title, the stage-3 part (parity)]
  const FACES = [['osc1', 'osc', 'oscA', 'Oscillator 1', 'oscA'], ['filter1', 'filter', 'filter', 'Filter 1', 'filter'], ['amp', 'amp', 'voice', 'Amplifier', 'voice'],
    ['env1', 'env', 'env1', 'Envelope 1', 'env1'], ['sub', 'sub', 'sub', 'Sub oscillator', 'sub'], ['noise', 'noise', 'noise', 'Noise', 'noise'],
    ['env2', 'env', 'env2', 'Envelope 2', 'env2'], ['lfo1', 'lfo', 'lfo1', 'LFO 1', 'lfo1'], ['macros', 'macros', 'macros', 'Macros 1', 'macros'], // ((MOD1 §2.2) "Macros 1"
    ['osc2', 'osc', 'oscB', 'Oscillator 2', 'oscB'], ['osc3', 'osc', 'oscC', 'Oscillator 3', 'oscC'], ['arp', 'arp', 'arp', 'Arpeggiator', 'arp']]; // ((ARP G3) the Arpeggiator
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
    let b3 = null, V3 = null;
    if (DONOR[p3]) { b3 = d.createElement('div'); s3.appendChild(b3); V3 = donorView(H3, p3, b3, { kind: 'stage3' }); }
    views.push({ key, kind, part, V, V3, b3, mod, ref: DESTS3.parts.wc[p3] });
  }
  // (MOD1 G5) the modulators: [key, kind, module id, title]; a slot kind's old panel (its view kind on a second slot host) for parity
  window.__wcStep = 'modulators';
  const [SXH, CMU, song, CVMODS] = await Promise.all(['../sx-host.js', '../cv-mods-ui.js', '../song.js', '../cv-mods.js'].map(p => import(p + v)));
  await CMU.ready();
  const MODS = [['m-lfo', 'lfo', 'l1', 'LFO 1'], ['m-env', 'env', 'e1', 'Envelope 1'], ['m-macro', 'macro', 'm1', 'Macros 1'], ['m-chaos', 'chaos', 'h1', 'Chaos 1'],
    ['m-wheel', 'wheel', 'wheel', 'Mod Wheel'], ['m-velo', 'velo', 've', 'Velocity'], ['m-at', 'at', 'at', 'Aftertouch'], ['m-bend', 'bend', 'bd', 'Bend'],
    ['m-note', 'note', 'nt', 'Note'], ['m-cc', 'cc', 'c1', 'CC 1']];
  const SLOTV = { lfo: 'lfo', env: 'env', macro: 'macros', chaos: 'chaos' }, rows0 = { count: () => 1, bypassed: () => false, bypass() {}, remove() {} };
  for (const [key, kind, dk, ttl] of MODS) {
    const mod = d.createElement('div'); mod.className = 'cv-mod'; mod.setAttribute('data-cv-rig', ''); mod.setAttribute('data-cv-mod', key); // (the page's charcoal block: the rig's)
    // ((MOD1 review, reviewer 2 P2) the bar as cv-module builds it on the canvas (createModule): the ⏻ slot hidden (no power), the stripe, the
    // title (main.js cvTitle: modLabelOf, "Mod Wheel") over its sub — the track's name on a face of 4 or more columns only (cv-mods modBarSub) —,
    // the chip hidden, the CPU slot empty, ⋯ and ▾; the module as wide as its face (cv-module's fixed width) — so a clipped title shows here
    const bar = d.createElement('div'); bar.className = 'cv-bar';
    const pow = d.createElement('span'); pow.className = 'cv-pow'; pow.hidden = true;
    const stripe = d.createElement('span'); stripe.className = 'cv-stripe';
    const tt = d.createElement('span'); tt.className = 'cv-ttl'; const te = d.createElement('span'); te.className = 'cv-title'; te.textContent = ttl;
    const se = d.createElement('span'); se.className = 'cv-sub'; se.textContent = typeof CVMODS.modBarSub !== 'function' || CVMODS.modBarSub(kind) ? 'Juno-60 12' : ''; se.hidden = !se.textContent;
    tt.append(te, se);
    const chip = d.createElement('span'); chip.className = 'cv-chip'; chip.hidden = true;
    const cpu = d.createElement('span'); cpu.className = 'cv-cpu';
    const more = d.createElement('button'); more.className = 'cv-btn cv-more'; more.textContent = '⋯';
    const fold = d.createElement('button'); fold.className = 'cv-btn cv-fold'; fold.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.25 6 7.75l3.5-3.5"/></svg>';
    bar.append(pow, stripe, tt, chip, cpu, more, fold);
    const body = d.createElement('div'); body.className = 'cv-body';
    mod.append(bar, body);
    world.appendChild(mod);
    window.__wcStep = 'modulator ' + key;
    const slot = !!SLOTV[kind], dev = song.normModDev({ kind: kind === 'wheel' ? 'lfo' : kind });
    const val = { wheel: 0.5, velo: 100 / 127, at: 0.6, bend: -0.3 }[kind];
    const B = CMU.bodyFor(kind, { doc: d, get: () => (kind === 'cc' ? Object.assign(dev, { cc: 74, ch: 0 }) : slot ? dev : val), edit() {}, live() {}, cancel() {}, bpm: () => 120,
      devKey: dk, rows: rows0, shown: () => true });
    body.appendChild(B.el);
    if (kind === 'note') B.update(60);
    if (kind === 'cc') B.update(0.5);
    let b3 = null;
    if (slot) {
      b3 = d.createElement('div'); s3.appendChild(b3);
      const H3 = SXH.slotHost(kind, { doc: d, get: () => dev, edit() {}, live() {}, cancel() {}, devKey: dk, rows: rows0 });
      donorView(H3, 'slot:' + kind, b3, { kind: SLOTV[kind], k: H3.slot, dev: dk });
      H3.paint(true);
    }
    const V = slot ? B.view() : { el: B.el, face: B.face, menuItems: () => [] };
    mod.style.width = V.face.w + 'px'; // (cv-module's fixed width: the bar never wider than the face)
    views.push({ key, kind, part: dk, V, b3, mod, recipe: slot ? null : CMU.MOD_FACE[kind], slot, plain: !slot, host: slot ? B.host() : null, body: B, ref: slot ? DESTS3.slots[kind] : null });
  }
  // (LC G7, lane F) the Combiner's face at 0 / 4 / 12 inputs (cv-mods-ui combBody, recipe combRecipe(n)): the same numbers, margins, fill
  // and contrast, ≤ 24 + 6n elements, its list's hits; (review 2 R2-6) its view on the page's real DSP — ModCore.preview over a real
  // payload (cv-graph compileMods: a track's LFOs into x1 — BPM ¼, BPM 1 bar + PHASE, a square under SMOOTH 0.3, a RETRIG one: dashed),
  // the anchors read off that preview — so the sheet shows the real curves; a build without the preview: the stand-in (tests/lc-stub.mjs:
  // its laws and its payload together, never one on the other)
  window.__wcStep = 'combiner';
  const LS = await import('./lc-stub.mjs');
  try { await wk.loadDSP(); } catch (e) { /* none: the stand-in */ }
  const REAL = !!(globalThis.ModCore && typeof globalThis.ModCore.preview === 'function');
  if (!REAL) globalThis.ModCore = LS.MC;
  const [CG, CMO] = REAL ? await Promise.all(['../cv-graph.js', '../cv-model.js'].map(p => import(p + v))) : [null, null];
  const ladN = l => core.LFO_LADDER.findIndex(x => x.label === l) / (core.LFO_LADDER.length - 1), SQ = [[0, 1, 0], [0.5, 1, 0], [0.5, 0, 0], [1, 0, 0]];
  const REAL_LFO = [{ lfo: { bpm: 1, anchor: 1 }, rate: ladN('1/4') }, { lfo: { bpm: 1, anchor: 1 }, rate: ladN('1 bar'), phase: 0.25 }, { lfo: { bpm: 1, anchor: 1, pts: SQ }, rate: ladN('1/2'), smooth: 0.3 },
    { lfo: { mode: 'retrig' }, rate: Math.pow(1.5 / 100, 0.25) }];
  // a real track: i1 → OUT, l1 … ln (REAL_LFO's laws in turn) plugged into x1 at the sheet's amounts (the 6th muted; an 11th past the 10
  // ModCore LFOs as a loaded project could hold it — the drop refuses it: its row pushed as written, the compile leaves it 'slots')
  function realPay(ins) {
    const t = { id: 'trk_g', prim: 'i1', dev: { i1: { kind: 'synth', model: 'juno60', vals: {} }, out: { kind: 'out' }, x1: song.normModDev({ kind: 'comb' }) }, wires: [{ id: 'w1', a: 'i1.out', b: 'out.in' }], mods: [], mid: 1 }, P = { bpm: 120 };
    ins.forEach((x, j) => {
      const L = REAL_LFO[j % 4];
      t.dev['l' + (j + 1)] = song.normModDev({ kind: 'lfo', lfo: Object.assign({ mono: 1, mode: 'free', bpm: 0, anchor: 0 }, L.lfo), rate: L.rate, smooth: L.smooth || 0, phase: L.phase || 0 });
      const r = CMO.addMod(t, 'l' + (j + 1) + '.out', 'x1:in', { project: P, amt: x.amt, byp: x.byp });
      if (r.ok) x.row = r.row.id;
      else { const r0 = t.mods[t.mods.length - 1]; t.mods.push(Object.assign({}, r0, { id: 'r' + (100 + j), src: 'l' + (j + 1) + '.out', amt: x.amt, byp: x.byp })); x.row = 'r' + (100 + j); }
    });
    const pay = Object.assign({}, CG.compileMods(t, P, { smooth: 1 }), { bpm: 120 }), C = pay.cmb ? pay.cmb[0] : null, left = new Set((pay.left || []).map(q => q.id));
    for (const x of ins) { const e = C ? C.in.find(q => q.row === x.row) : null; x.l = e ? e.l : -1; x.why = left.has(x.row) ? 'slots' : ''; }
    return pay;
  }
  const CORD = ['#d8432f', '#e6b83a', '#3f80d8', '#41a75c', '#e9e5da', '#e27c2f', '#9060c9', '#8a8c90'];
  const LAWS = [{ lock: 'song', beats: 1, start: 0, shape: 'sine', sm: 0 }, { lock: 'song', beats: 4, start: 0.25, shape: 'tri', sm: 0 }, { lock: 'song', beats: 0.5, start: 0, shape: 'square', sm: 0.3 },
    { lock: 'note', hz: 1.5, start: 0, shape: 'saw', sm: 0 }];
  const FH = 124800, MARKL = [{ value: null, label: 'Off' }, { value: { t: 'trk_2', n: -1 }, label: 'TR-808 2' }];
  for (const nIn of [0, 4, 12]) {
    const key = 'm-comb' + nIn, mod = d.createElement('div'); mod.className = 'cv-mod'; mod.setAttribute('data-cv-rig', ''); mod.setAttribute('data-cv-mod', key);
    const bar = d.createElement('div'); bar.className = 'cv-bar';
    const pow = d.createElement('span'); pow.className = 'cv-pow'; pow.hidden = true;
    const stripe = d.createElement('span'); stripe.className = 'cv-stripe';
    const tt = d.createElement('span'); tt.className = 'cv-ttl'; const te = d.createElement('span'); te.className = 'cv-title'; te.textContent = 'Combiner 1';
    const se = d.createElement('span'); se.className = 'cv-sub'; se.textContent = typeof CVMODS.modBarSub !== 'function' || CVMODS.modBarSub('comb') ? 'Juno-60 12' : ''; se.hidden = !se.textContent;
    tt.append(te, se);
    const chip = d.createElement('span'); chip.className = 'cv-chip'; chip.hidden = true;
    const cpu = d.createElement('span'); cpu.className = 'cv-cpu';
    const more = d.createElement('button'); more.className = 'cv-btn cv-more'; more.textContent = '⋯';
    const fold = d.createElement('button'); fold.className = 'cv-btn cv-fold'; fold.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.25 6 7.75l3.5-3.5"/></svg>';
    bar.append(pow, stripe, tt, chip, cpu, more, fold);
    const body = d.createElement('div'); body.className = 'cv-body';
    mod.append(bar, body);
    world.appendChild(mod);
    const ins = Array.from({ length: nIn }, (_, j) => ({ row: 'r' + j, src: 'l' + (j + 1) + '.out', l: j, name: 'LFO ' + (j + 1), color: (CMU.CMB_TINT || CORD)[j % 8], /* (review 2 R2-5) the host's rule: a tint per line */ amt: [1, -0.5, 0.3, 0.6][j % 4], byp: j === 5 ? 1 : 0,
      why: j === 10 ? 'slots' : '', apx: j === 2 ? 'Rise and Delay act per note: not in the Combiner' : '' }));
    const pay = REAL ? realPay(ins) : null, live = ins.filter(x => !x.why), lfos = Array.from({ length: Math.max(1, nIn) }, (_, j) => LAWS[j % 4]);
    const pay0 = pay || { t: 'mods', key: 'g' + nIn, bpm: 120, cp: LS.cpOf(lfos, 'gate' + nIn), ct: { key: '' }, cmb: [{ id: 'x1', k: 8, mode: 0, in: live.map(x => ({ row: x.row, src: 2 + x.l, l: x.l, a: x.byp ? 0 : x.amt })) }],
      slots: { x1: { kind: 'comb', i: 0, n: live.length } } };
    const C0 = pay0.cmb ? pay0.cmb[0] : { in: [] }, PV = REAL && pay ? globalThis.ModCore.preview(pay, 48000) : null;
    const sng = { bpm: 120, sig: [4, 4], playing: true, tick: 2.6 * 960, cursor: 0, loop: { on: false, start: 0, end: 0 }, start: 0, pass: 0 };
    const dev = Object.assign(song.normModDev({ kind: 'comb' }), nIn ? { mark: { t: 'trk_2', n: -1 } } : {});
    const B = CMU.bodyFor('comb', { doc: d, devKey: 'x1', get: () => dev, edit() {}, shown: () => true, heardFrame: () => FH, sampleRate: () => 48000, song: () => sng, inputs: () => ins, payload: () => pay0,
      setAmt() {}, setMute() {}, unplug() {}, select() {}, marks: (t0, t1) => [0, 1, 2, 3, 3.5].map(b => b * 960).filter(t => t >= t0 && t < t1), markList: () => MARKL, cords: () => false });
    body.appendChild(B.el);
    await B.ready();
    for (const F of [FH - 1536, FH + 1536]) { // (two monitor posts round the heard frame: the dot, the dashed input's anchor)
      const cb = new Float64Array(1 + 3 * C0.in.length);
      cb[0] = 0.62;
      C0.in.forEach((x, j) => {
        if (!PV) { cb[1 + 3 * j] = 2.6 * 2 + (F - FH) * 1.5 / 48000; cb[2 + 3 * j] = 1.5 / 48000; cb[3 + 3 * j] = 0.5; return; }
        const r = PV.rate(x.l), X = 0.37 + (F - 4) * r; cb[1 + 3 * j] = X; cb[2 + 3 * j] = r; cb[3 + 3 * j] = PV.read(x.l, X); // (the real preview's own clock, rate and value)
      });
      B.update({ F, cb, i: 0 });
    }
    if (PV) PV.destroy();
    mod.style.width = B.face.w + 'px';
    views.push({ key, kind: 'comb', part: 'x1', V: { el: B.el, face: B.face, menuItems: () => B.menuItems() }, mod, recipe: CMU.combRecipe(nIn), plain: true, comb: nIn, body: B, ref: null });
  }
  window.__lcSync = () => { for (const F of views) if (F.comb != null) F.body.sync(); }; // (a skin switch: the screens' palette again)
  window.__wcStep = 'mounted';
  for (const F of views) if (F.host) F.host.paint(true);
  H.paint(true); H3.paint(true);
  if (d.fonts && d.fonts.ready) await d.fonts.ready;
  const paintAll = () => { H.paint(true); for (const F of views) if (F.host) F.host.paint(true); window.__lcSync(); }; // ((LC) the Combiner's screens: their palette at a skin switch
  for (let i = 0; i < 6; i++) { await new Promise(r => requestAnimationFrame(r)); paintAll(); }
  await new Promise(r => setTimeout(r, 300));
  paintAll();
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
  // (MOD1 G5 / G4's skin half) the modulators under each skin: no face's box moves, its label contrast per skin
  const mods = views.filter(F => F.slot || F.plain), box0 = mods.map(F => F.V.el.getBoundingClientRect());
  res.skins = {};
  for (const sk of ['ivory', 'glass', 'charcoal']) {
    world.setAttribute('data-cv-skin', sk);
    paintAll();
    await new Promise(r => requestAnimationFrame(r));
    res.skins[sk] = mods.map((F, i) => {
      const r = F.V.el.getBoundingClientRect(), b = box0[i], moved = ['left', 'top', 'width', 'height'].some(k => Math.abs(r[k] - b[k]) > 0.01);
      if (moved) res.fails.push(F.key + ': the ' + sk + ' skin moved its box');
      const te = F.mod.querySelector('.cv-title'), tt = F.mod.querySelector('.cv-ttl'); // ((MOD1 review) its bar's title whole in each skin (the skin sets the face font)
      if (te && tt && te.scrollWidth > tt.clientWidth + 0.5) res.fails.push(F.key + ': the ' + sk + ' skin clips its bar title (' + te.scrollWidth + ' > ' + tt.clientWidth + ')');
      const lab = F.V.el.querySelector('.wk-knob > .wk-lab, .rig-mlab, .rig-jl'), bg = getComputedStyle(F.V.el).backgroundColor;
      return { key: F.key, contrast: lab ? +(contrast(getComputedStyle(lab).color, bg) || 0).toFixed(2) : null };
    });
    // ((ARP fix round, R2 P2-3) the Arpeggiator's slot keys in each skin: every name (and the selected key's hint) on its own key's ground
    // ≥ 4.5 : 1 — ivory's dark ink on the black keys read 1.1 : 1
    const AF = views.find(x => x.key === 'arp');
    if (AF) {
      let lo = Infinity, at = '';
      for (const e of AF.V.el.querySelectorAll('.sx-slotname, .sx-slothint:not([hidden])')) { const c = contrast(getComputedStyle(e).color, groundOf(e, AF.V.el)) || 0; if (c < lo) { lo = c; at = e.textContent; } }
      res.skins[sk].push({ key: 'arp slots', contrast: +lo.toFixed(2) });
      if (!(lo >= 4.5)) res.fails.push('arp: the ' + sk + ' skin\'s slot names ' + lo.toFixed(2) + ' : 1 (' + at + ')');
    }
  }
  // (ARP G3) the pattern editor, open: the page gets a top layer (wk.setLayer) and its #world a [data-cv-world], as the canvas has them —
  // after every face is measured (inWorld changes nothing they measured); the panel in the layer (not the face), inside the viewport, its
  // roll not clipped, its texts ≥ 10 px and unclipped, its words; then closed (window.__arpEd() opens it again for the driver's shot)
  const arpF = views.find(x => x.key === 'arp');
  if (arpF) {
    const ov = d.createElement('div'); ov.id = 'wcLayer'; ov.style.cssText = 'position: fixed; left: 0; top: 0; width: 0; height: 0; z-index: 40;';
    d.body.appendChild(ov); world.setAttribute('data-cv-world', ''); wk.setLayer(ov);
    arpF.V.donor.editSlots(x => { x.shape = 1; }, { label: 'Arp Shape' }); H.paint(true);
    const ed = arpF.V.el.querySelector('.sx-pated'), open = async () => { if (!ov.querySelector('.rig-seqpanel')) ed.click(); for (let i = 0; i < 3; i++) { await new Promise(r => requestAnimationFrame(r)); H.paint(true); } };
    await open();
    res.editor = measureEditor(ov, arpF.V.el, ed);
    for (const m of res.editor.fails) res.fails.push('arp editor: ' + m);
    ed.click(); H.paint(true);
    if (ov.querySelector('.rig-seqpanel')) res.fails.push('arp editor: EDIT PATTERN again did not close it');
    window.__arpEd = open;
  }
  for (const f of res.faces) for (const m of f.fails) res.fails.push(f.key + ': ' + m);
  if (res.drawer) for (const m of res.drawer.fails) res.fails.push('amp drawer: ' + m);
  res.css = !!d.getElementById(RU.CSS_ID);
  window.__wc = res;
  return res;
}
const vis = (el, root) => { if (!el || !el.getClientRects || !el.getClientRects().length) return false; if (el.closest && el.closest('.rig-screen[data-h="K"]')) return false; // (the kit's own type view in the frame: WC-2 lays it)
  for (let n = el; n && n !== root; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden') return false; if (n.classList && (n.classList.contains('rig-park') || n.classList.contains('rig-drawer'))) return false; } return true; };
const TEXT_SEL = '.wk-knob > .wk-lab, .wk-knob > .wk-num, .wk-nb > .wk-lab, .sx-nf > .sx-nfl, .wk-nbv, .sx-nfv, .rig-cap, .rig-jl, .rig-hint, .sx-vc, .sxo-wl, .wk-sl > .wk-lab, .wk-mtxt, .wk-tl, .wk-seg button, .sx-seg button, .sx-tile .sx-tl, .rig-mval, .rig-mlab, .rig-mothers, .rig-mlearn' + // ((MOD1) the plain faces' readouts, chip and Learn
  ', .rig-cseg > button, .rig-cmark, .rig-cname, .rig-camt, .rig-cmute, .rig-chint, .rig-cn'; // ((LC) the Combiner's head, its list's lines, its hint and IN count
const CTL_SEL = '.wk-knob > .wk-svg, .wk-nbv, .sx-nfv, .wk-tog, .wk-mbtn, .wk-arr, .sx-hbtn, input, .rig-jack, .rig-disp, .wk-seg button, .sx-seg button, .sx-tile, .wk-slt, .rig-glyph, .rig-mw, .rig-mothers, .rig-mlearn, .rig-cseg > button, .rig-cmark, .rig-cname, .rig-camt, .rig-cmute';
const FILL_SEL = '.wk-knob, .wk-nb, .sx-nf, .wk-tog, .wk-menu, .sx-hbtn, input, .rig-jack, .rig-jl, .rig-disp, .wk-seg, .sx-seg, .sx-tile, .rig-cap, .rig-hint, .sx-vc, .wk-meter, .rig-glyph, .wk-sl';
function textBox(el) {
  // a text element's box: the element itself when it shrinks to its text, else its text's range (a button's / a menu's label)
  if (el.matches('.wk-mtxt, .wk-tl, .wk-nbv, .sx-nfv, .wk-seg button, .sx-seg button, .sx-tile .sx-tl, .rig-mothers, .rig-mlearn, .rig-cseg > button, .rig-cmark, .rig-cname, .rig-camt, .rig-cmute') && el.firstChild) {
    const r = document.createRange(); r.selectNodeContents(el); const b = r.getBoundingClientRect();
    if (b.width > 0) return b;
  }
  return el.getBoundingClientRect();
}
const gap = (a, b) => { const dx = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right)), dy = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom)); return Math.hypot(dx, dy); };
const cellOf = el => (el.closest ? el.closest('.rig-cell, .rig-head > *, .rig-strip > *, .rig-mread') : null); // ((MOD1) a readout's value / label stack is one
function measure(F, RU, d) {
  const face = F.V.el, fr = face.getBoundingClientRect(), fails = [], out = { key: F.key, kind: F.kind, variant: F.V.face && F.V.face.variant, touch: !!window.__wcTouch };
  const rel = r => ({ left: r.left - fr.left, top: r.top - fr.top, right: r.right - fr.left, bottom: r.bottom - fr.top, width: r.width, height: r.height });
  const L = RU.layoutOf(F.recipe || RU.FACE[out.variant]), G = RU.GRID, n = L.cols, kit = out.variant === 'osc.kit';
  out.w = Math.round(fr.width * 100) / 100; out.h = Math.round(fr.height * 100) / 100;
  // (review 2 P3-2) the bar's title: all of it in the room the bar leaves it
  const te = F.mod.querySelector('.cv-title'), tt = F.mod.querySelector('.cv-ttl');
  if (te && tt) { out.bar = { title: te.textContent, w: te.scrollWidth, room: tt.clientWidth }; if (te.scrollWidth > tt.clientWidth + 0.5) fails.push('bar title "' + te.textContent + '" clipped (' + te.scrollWidth + ' > ' + tt.clientWidth + ')'); }
  const se = F.mod.querySelector('.cv-sub'); // ((MOD1 review) a modulator's sub-label, where its bar shows one: whole too (a typical track name)
  if (se && !se.hidden && se.scrollWidth > se.clientWidth + 0.5) fails.push('bar sub "' + se.textContent + '" clipped (' + se.scrollWidth + ' > ' + se.clientWidth + ')');
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
    const want = e.matches('.wk-num, .wk-nbv, .sx-nfv, .rig-jl, .sxo-wl, .wk-sl > .wk-lab, .rig-mothers, .rig-cn') ? MIN.val : e.closest('.rig-head') ? MIN.head : MIN.lab; // ((LC) the IN's count: the stacked jack's 10 px
    minFont = Math.min(minFont, fs2);
    if (fs2 < want - 0.01) fails.push('text "' + e.textContent.trim().slice(0, 18) + '" ' + fs2 + ' px < ' + want);
    const name = (e.matches('.wk-mtxt') && (e.closest('.rig-grow') || e.closest('.rig-strip') || e.closest('.rig-sel'))) || e.matches('.rig-cname, .rig-cmark'); // ((LC) an input's / a marked track's name ellipsizes
    if (!name && e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0 && textW(e) > e.clientWidth + 1) fails.push('text "' + e.textContent.trim().slice(0, 18) + '" clipped (' + e.scrollWidth + ' > ' + e.clientWidth + ')');
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
    else if (re.matches('.rig-list')) { for (const x of re.children) if (vis(x, face)) paint(x.getBoundingClientRect()); } // ((LC) the Combiner's lines (the hint its one line while empty)
    else for (const x of re.querySelectorAll('.rig-disp, .rig-strip')) if (vis(x, face) || x.closest('[data-h="K"]')) paint(x.getBoundingClientRect());
  }
  for (const { r } of tb) paint(r);
  on = 0; for (let i = 0; i < grid.length; i++) on += grid[i];
  out.fill = +(on / grid.length).toFixed(3);
  if (!kit && (out.fill < G.fill[0] || out.fill > G.fill[1])) fails.push('fill ' + out.fill + ' outside ' + G.fill.join('…'));
  // contrast: a label against the face
  const lab = texts.find(e => e.matches('.wk-knob > .wk-lab')) || (F.comb != null ? texts.find(e => e.matches('.rig-jl')) : null) || texts[0], bg = getComputedStyle(face).backgroundColor; // ((LC) its first text is a lit pick
  out.contrast = lab ? +(contrast(getComputedStyle(lab).color, bg) || 0).toFixed(2) : null;
  const vlab = texts.find(e => e.matches('.wk-knob > .wk-num'));
  out.contrastVal = vlab ? +(contrast(getComputedStyle(vlab).color, bg) || 0).toFixed(2) : null;
  if (out.contrast != null && out.contrast < 4.5) fails.push('label contrast ' + out.contrast);
  if (out.contrastVal != null && out.contrastVal < 4.5) fails.push('value contrast ' + out.contrastVal);
  // parity with the stage-3 panel: every data-dest it shows is on the face (Envelope 1's ids are the amp's no longer: §3.1)
  const ids = el => new Set(Array.from(el.querySelectorAll('[data-dest]')).map(e => e.getAttribute('data-dest')));
  const mine = ids(face), theirs = new Set(F.ref || []); // ((MOD1) a plain modulator face: no old panel; (SX0) the frozen ids)
  if (F.b3) for (const x of ids(F.b3)) theirs.add(x); // (the donor beside it: the same ids)
  if (!F.plain && !theirs.size) fails.push('no stage-3 data-dest ids to compare');
  if (F.kind === 'amp') for (const x of Array.from(theirs)) if (/^e\d\./.test(x)) theirs.delete(x);
  out.missing = Array.from(theirs).filter(x => !mine.has(x));
  if (out.missing.length) fails.push('data-dest missing: ' + out.missing.join(' '));
  out.dests = mine.size; out.dests3 = theirs.size;
  const count = el => el.querySelectorAll('*').length + 1;
  const painted = el => Array.from(el.querySelectorAll('*')).filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').length + 1;
  out.count = count(face); out.painted = painted(face);
  if (F.b3) {
    out.count3 = count(F.b3);
    F.b3.style.visibility = 'visible'; out.painted3 = painted(F.b3); F.b3.style.visibility = '';
    out.ratio = +(out.count / out.count3).toFixed(2); out.pratio = +(out.painted / out.painted3).toFixed(2);
  } else { out.count3 = out.painted3 = out.ratio = out.pratio = null; }
  // ((MOD1 G5) the modulators' element counts: a slot face ≤ 1.2 × its old panel's (the ratio above), a plain face ≤ 48
  if (F.slot && out.count > 1.2 * out.count3) fails.push('elements ' + out.count + ' > 1.2 × ' + out.count3);
  if (F.comb != null) { if (out.count > 24 + 6 * F.comb) fails.push('elements ' + out.count + ' > 24 + 6 × ' + F.comb); } // ((LC G7) the Combiner: 24 + 6 a line
  else if (F.plain && out.count > 48) fails.push('elements ' + out.count + ' > 48');
  if (F.comb != null) combChecks(F, face, texts, out, fails);
  // G13's words on a face (lane K / H gate them; listed here): no Serum / Xfer / VOICE in its texts, titles or names; (MOD1 G8) a modulator's:
  // no ENV (the LFO's mode ENV is no module name), "Macro" a knob's name only — failures
  const words = new Set(), mw = new Set(), modf = F.slot || F.plain;
  for (const e of [face].concat(Array.from(face.querySelectorAll('*')))) {
    const lfoMode = !!(e.closest && e.closest('[aria-label="LFO mode"]'));
    for (const v of [e.getAttribute && e.getAttribute('title'), e.getAttribute && e.getAttribute('aria-label'), e.children && !e.children.length ? e.textContent : '']) {
      if (v && /Serum|Xfer|\bVOICE\b/.test(v)) words.add(v.slice(0, 60));
      if (modf && v && !lfoMode && /Serum|Xfer|\bENV\b|\bMacro\b(?! [1-8]\b)/.test(v)) mw.add(v.slice(0, 60));
    }
  }
  if (modf && F.V.menuItems) for (const i of F.V.menuItems()) if (i && i.label && /Serum|Xfer|\bENV\b|\bMacro\b(?! [1-8]\b)/.test(i.label)) mw.add('⋯ ' + i.label);
  out.words = Array.from(words);
  if (mw.size) fails.push('words: ' + Array.from(mw).join(' | '));
  if (F.kind === 'arp') slotChecks(face, out, fails);
  out.fails = fails;
  return out;
}
// (ARP G3) the Arpeggiator's slot strip: 12 keys in the screen. (ARP fix round, R2 P2-2: the whole key is one hit — a tap selects, a tap
// on the selected key launches / stops; no ▶ button on the face) On touch each key's select (its name button) as hit-tested — across the
// key's centre row and down its centre column, ½ px steps — ≥ 44 × 44, ≥ half the key's area (a 2 px grid), the key's CENTRE point the
// select (the old ▶ corner's 44 px hit took the centre: it fails here) and its name point (its text) too; a ▶ button on the face fails
function slotChecks(face, out, fails) {
  const keys = Array.from(face.querySelectorAll('.sx-slot')), d = face.ownerDocument, k = face.getBoundingClientRect().width / face.offsetWidth || 1;
  if (keys.length !== 12) fails.push('slots: ' + keys.length + ' keys');
  if (face.querySelector('.sx-slotplay')) fails.push('slots: a ▶ button on the face (the key is one hit)');
  if (!out.touch) { out.slots = keys.length; return; }
  const sx = scrollX, sy = scrollY;
  face.querySelector('.sx-slots').scrollIntoView({ block: 'center', inline: 'center' });
  const sel = [];
  for (const key of keys) {
    const nm = key.querySelector('.sx-slotname'), kb = key.getBoundingClientRect(), nb = nm.getBoundingClientRect(), own = e => !!e && (e === nm || nm.contains(e));
    const cx = (kb.left + kb.right) / 2, cy = (kb.top + kb.bottom) / 2;
    let w = 0, h = 0, n = 0, m = 0;
    for (let X = kb.left - 20 * k; X < kb.right + 20 * k; X += 0.5) if (own(d.elementFromPoint(X, cy))) w += 0.5;
    for (let Y = kb.top - 20 * k; Y < kb.bottom + 20 * k; Y += 0.5) if (own(d.elementFromPoint(cx, Y))) h += 0.5;
    for (let X = kb.left + 1; X < kb.right - 1; X += 2) for (let Y = kb.top + 1; Y < kb.bottom - 1; Y += 2) { n++; if (own(d.elementFromPoint(X, Y))) m++; }
    const centre = own(d.elementFromPoint(cx, cy)), txt = own(d.elementFromPoint(nb.left + 10 * k, nb.top + 10 * k));
    w /= k; h /= k;
    const frac = n ? m / n : 0, label = key.getAttribute('aria-label');
    sel.push(w.toFixed(0) + '×' + h.toFixed(0) + ' ' + Math.round(frac * 100) + '%' + (centre ? ' c' : ' ✗c'));
    if (w < 44 - 0.5 || h < 44 - 0.5 || frac < 0.5) fails.push(label + ': select hit ' + w.toFixed(1) + ' × ' + h.toFixed(1) + ', ' + Math.round(frac * 100) + '% of the key');
    if (!centre) fails.push(label + ': its centre point is not the select');
    if (!txt) fails.push(label + ': its name point is not the select');
  }
  scrollTo(sx, sy);
  out.slots = keys.length; out.slotSel = sel;
}
// (LC G7) the Combiner's own: each text against its own ground (the nearest opaque background: a lit pick, a box, the screen, the face)
// ≥ 4.5 : 1; its list's lines 32 px (the grid's head row) with no gap, each line's controls in their columns (name 3 · amount 2 · mute 1);
// the hits — the head's ≥ 44 px tall (inside the row gaps), a line's control the whole line band (32 px: the next line's is its
// neighbour — a 44 px hit would take its presses) and ≥ 44 px wide, no two lines' hits overlapping
const opaque = c => { const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(c || ''); return !!m && (m[4] == null || +m[4] >= 0.99); };
function groundOf(e, face) { for (let n = e; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (opaque(c)) return c; if (n === face) break; } return getComputedStyle(face).backgroundColor; }
// (review 2 R2-4) a text's own width (its contents' range): a positioned hit area (an ::after past the box) widens scrollWidth, not the text
function textW(e) { try { const R = e.ownerDocument.createRange(); R.selectNodeContents(e); return R.getBoundingClientRect().width / ((e.getBoundingClientRect().width / e.offsetWidth) || 1); } catch (err) { return e.scrollWidth; } }
function hitOf(e) {
  const r = e.getBoundingClientRect(), a = getComputedStyle(e, '::after');
  if (!a || a.content === 'none' || a.position !== 'absolute') return r;
  const w = parseFloat(a.width), h = parseFloat(a.height), L = r.left + e.clientLeft + (parseFloat(a.left) || 0), T = r.top + e.clientTop + (parseFloat(a.top) || 0); // (from the padding edge)
  return { left: L, top: T, right: L + (w || r.width), bottom: T + (h || r.height), width: w || r.width, height: h || r.height };
}
function combChecks(F, face, texts, out, fails) {
  const own = [];
  for (const e of texts) {
    const c = contrast(getComputedStyle(e).color, groundOf(e, face));
    own.push(+(c || 0).toFixed(2));
    if (c != null && c < 4.5) fails.push('text "' + e.textContent.trim().slice(0, 14) + '" contrast ' + c.toFixed(2) + ' on its ground');
  }
  out.ownContrast = own.length ? Math.min(...own) : null;
  const lines = Array.from(face.querySelectorAll('.rig-cline')), fr = face.getBoundingClientRect();
  let prev = null;
  for (const l of lines) {
    const r = l.getBoundingClientRect();
    if (Math.abs(r.height - 32) > 0.5 || Math.abs(r.width - (fr.width - 32)) > 0.5) fails.push('line ' + l.getAttribute('data-row') + ' ' + r.width + ' × ' + r.height);
    if (prev && Math.abs(r.top - prev.bottom) > 0.5) fails.push('a gap above line ' + l.getAttribute('data-row'));
    const cols = [['.rig-cname', 0, 3], ['.rig-camt', 3, 2], ['.rig-cmute', 5, 1]];
    for (const [sel, c0, span] of cols) {
      const x = l.querySelector(sel), b = x && x.getBoundingClientRect(), L0 = r.left + 64 * c0, R0 = L0 + 64 * span;
      if (!b || b.left < L0 - 0.5 || b.right > R0 + 0.5) { fails.push(sel + ' of ' + l.getAttribute('data-row') + ' outside its columns'); continue; }
      if (out.touch) { const h = hitOf(x); if (h.height < 32 - 0.5 || h.width < 44 - 0.5 || h.top < r.top - 0.5 || h.bottom > r.bottom + 0.5) fails.push(sel + ' of ' + l.getAttribute('data-row') + ' hit ' + h.width.toFixed(1) + ' × ' + h.height.toFixed(1) + ' (the line ' + r.top.toFixed(1) + '…' + r.bottom.toFixed(1) + ')'); }
    }
    prev = r;
  }
  // (review 2 R2-4) the head's hits as hit-tested — across the box's centre row and down its centre column (elementFromPoint, ½ px steps,
  // layout px): ≥ 44 both ways, so each pick's own centre takes it
  if (out.touch) {
    const d = face.ownerDocument, k = fr.width / face.offsetWidth || 1, sx = scrollX, sy = scrollY, row = face.querySelector('.rig-head');
    // (its own box or pseudo; for Marks also the head row's band round it, which combBody forwards to it)
    const mine = (x, e, X) => !!e && (e === x || x.contains(e) || (e === row && x.classList.contains('rig-cmark') && X >= x.getBoundingClientRect().left && X <= x.getBoundingClientRect().right));
    face.querySelector('.rig-head').scrollIntoView({ block: 'center', inline: 'center' }); // (elementFromPoint sees the viewport only)
    for (const x of face.querySelectorAll('.rig-head .rig-cseg > button, .rig-head .rig-cmark')) {
      const b = x.getBoundingClientRect(), cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
      let w = 0, hh = 0;
      for (let X = b.left - 40 * k; X < b.right + 40 * k; X += 0.5) if (mine(x, d.elementFromPoint(X, cy), X)) w += 0.5;
      for (let Y = b.top - 40 * k; Y < b.bottom + 40 * k; Y += 0.5) if (mine(x, d.elementFromPoint(cx, Y), cx)) hh += 0.5;
      w /= k; hh /= k;
      const wMin = x.parentElement.classList.contains('rig-cwin') ? b.width / k - 0.5 : 44 - 0.5; // ((the lead, fix round K) a Window pick's hit is its own box: 4 × 44 would skew off the boxes
      if (w < wMin || hh < 44 - 0.5) fails.push('head hit "' + x.textContent + '" ' + w.toFixed(1) + ' × ' + hh.toFixed(1) + ' px');
      (out.headHits || (out.headHits = [])).push(x.textContent + ' ' + w.toFixed(1) + '×' + hh.toFixed(1));
    }
    scrollTo(sx, sy);
  }
  out.lines = lines.length;
}
// (ARP G3) the open editor's panel
function measureEditor(ov, face, ed) {
  const fails = [], P = ov.querySelector('.rig-seqpanel');
  if (!P) return { fails: ['no panel in the top layer'] };
  const r = P.getBoundingClientRect(), out = { w: r.width, h: r.height, left: r.left, top: r.top, fails };
  if (face.contains(P) || face.querySelector('.sx-seqov')) fails.push('the editor is in the face');
  if (!P.classList.contains('sx-arp') || P.getAttribute('data-cv-skin') !== 'charcoal') fails.push('panel class / skin');
  if (ed.getAttribute('aria-pressed') !== 'true') fails.push('EDIT PATTERN not pressed');
  if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) fails.push('outside the viewport (' + [r.left, r.top, r.right, r.bottom].map(v => v.toFixed(1)).join(' ') + ')');
  if (Math.abs(r.width - Math.min(1024, innerWidth - 32)) > 0.5 || Math.abs(r.height - Math.min(640, innerHeight - 32)) > 0.5) fails.push('size ' + r.width + ' × ' + r.height);
  const ov2 = P.querySelector('.sx-seqov');
  if (!ov2 || getComputedStyle(ov2).position !== 'static') fails.push('the overlay keeps its own position (' + (ov2 && getComputedStyle(ov2).position) + ')');
  const roll = P.querySelector('.sx-roll'), rr = roll ? roll.getBoundingClientRect() : null;
  out.roll = rr ? [Math.round(rr.width), Math.round(rr.height)] : null;
  if (!rr || rr.height < 200) fails.push('roll ' + (rr ? rr.width + ' × ' + rr.height : 'missing'));
  else if (rr.top < r.top - 0.5 || rr.bottom > r.bottom + 0.5 || rr.left < r.left - 0.5 || rr.right > r.right + 0.5) fails.push('the roll is clipped by the panel');
  out.scroll = Math.max(0, P.scrollHeight - P.clientHeight); // (px it scrolls: > 0 only on a viewport too short for the editor)
  // ((ARP fix round, R2 P3-4) the roll fills the panel's free height: no empty band > 24 px under the lanes (d had 170 px under a 300 px
  // roll), the roll ≥ 360 whenever the panel has its full 640
  const ln = P.querySelector('.sx-lanes'), lb = ln ? ln.getBoundingClientRect().bottom : r.bottom, band = r.bottom - parseFloat(getComputedStyle(P).borderBottomWidth || 0) - lb;
  out.band = Math.round(band);
  if (!out.scroll && band > 24) fails.push('an empty band of ' + band.toFixed(1) + ' px under the lanes');
  if (rr && r.height >= 640 - 0.5 && rr.height < 360 - 0.5) fails.push('roll ' + rr.height.toFixed(1) + ' px tall (< 360) in a 640 px panel');
  let minFont = Infinity;
  for (const e of P.querySelectorAll('.wk-lab, .wk-num, .wk-mtxt, .sx-ttl, .sx-seqbtn, .sx-lanetab, .wk-nbv')) {
    if (!e.getClientRects().length || !e.textContent.trim()) continue;
    const fs = parseFloat(getComputedStyle(e).fontSize) || 0; minFont = Math.min(minFont, fs);
    if (fs < 10 - 0.01) fails.push('text "' + e.textContent.trim().slice(0, 16) + '" ' + fs + ' px');
    if (!e.matches('.wk-mtxt, .sx-bankbtn') && e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0 && textW(e) > e.clientWidth + 1) fails.push('text "' + e.textContent.trim().slice(0, 16) + '" clipped');
  }
  out.minFont = minFont;
  // ((ARP fix round, R2 P3-3) the lit controls — the active lane tab, a pressed button — on the violet accent: their text ≥ 4.5 : 1 in every
  // skin (ivory's light --sx-bg read 2.29 : 1 on it); the panel carries the skin itself (the world's, copied at open)
  out.lit = {};
  const sk0 = P.getAttribute('data-cv-skin');
  for (const sk of ['charcoal', 'ivory', 'glass']) {
    P.setAttribute('data-cv-skin', sk);
    let lo = Infinity, at = '';
    for (const e of P.querySelectorAll('.sx-lanetab[aria-selected="true"], .sx-seqbtn[aria-pressed="true"]')) { if (!e.getClientRects().length || !e.textContent.trim()) continue; const c = contrast(getComputedStyle(e).color, groundOf(e, P)) || 0; if (c < lo) { lo = c; at = e.textContent.trim(); } }
    out.lit[sk] = lo === Infinity ? null : +lo.toFixed(2);
    if (lo === Infinity) fails.push(sk + ': no lit lane tab measured'); else if (lo < 4.5) fails.push(sk + ': the lit "' + at + '" ' + lo.toFixed(2) + ' : 1');
  }
  P.setAttribute('data-cv-skin', sk0);
  for (const e of [P].concat(Array.from(P.querySelectorAll('*')))) for (const v of [e.getAttribute('aria-label'), e.getAttribute('title'), e.children.length ? '' : e.textContent]) if (v && /\bARP\b|\bArp\b|Serum|Xfer/.test(v)) fails.push('word: ' + v.slice(0, 40));
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
  // ((MOD1, CLAUDE.md) Chrome for Testing, never the user's Chrome: $CHROME, else .claude/test-browser's — this checkout's or, from a
  // worktree (.claude/worktrees/<name>), the main checkout's
  const CFT = 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
  const cft = () => { for (const base of [ROOT, path.resolve(ROOT, '../../..')]) { const dir = path.join(base, '.claude', 'test-browser'); let vs = []; try { vs = fs.readdirSync(dir).sort().reverse(); } catch (e) { /* none */ } for (const v of vs) { const f = path.join(dir, v, CFT); if (fs.existsSync(f)) return f; } } return null; };
  const CHROME = process.env.CHROME || cft();
  if (!CHROME) { console.log('Chrome for Testing not found (.claude/test-browser): set $CHROME'); process.exit(2); }
  const prof = fs.mkdtempSync(path.join(arg('profile', os.tmpdir()), 'wc-chrome-'));
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
  await send('Browser.setDownloadBehavior', { behavior: 'deny' }); // ((CLAUDE.md) no download ever reaches the user's folders
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
        const errs = R.console.filter(m => !/^warning: /.test(m)); // ((review 2 R2-6) a console error or an exception fails the size
        if (errs.length && !R.error) { R.fails = (R.fails || []).concat(errs.map(m => 'console ' + m.slice(0, 160))); }
        all.push(R);
        if (R.error) { failed++; console.log(R.name + ': ERROR ' + R.error); }
        else {
          console.log('\n' + R.name + (R.fails.length ? '  ✗ ' + R.fails.length + ' failure(s)' : '  ✓ G11 green') + '  (' + R.size.join(' × ') + '; the probe: stack ' + (R.font && R.font.stack) + ' / Inter ' + (R.font && R.font.inter) + ' px)');
          console.log('  bars: ' + R.faces.map(f => (f.bar ? f.key + ' "' + f.bar.title + '" ' + f.bar.w + '/' + f.bar.room : f.key)).join(' · '));
          console.log('  face        variant     w×h        fill  strict edge  ctl  text font knobs jacks contrast  parity(dests)   els / stage-3');
          for (const f of R.faces) console.log('  ' + f.key.padEnd(10) + ' ' + String(f.variant).padEnd(11) + ' ' + (f.w + '×' + f.h).padEnd(10) + ' ' + String(f.fill).padEnd(5) + ' ' + String(f.strict).padEnd(6) + ' ' + String(f.minEdge).padEnd(5) + ' ' + String(f.minCtl).padEnd(4) + ' ' + String(f.minText).padEnd(4) + ' ' + String(f.minFont).padEnd(4) + ' ' + String(f.knobs).padEnd(5) + ' ' + String(f.jacks).padEnd(5) + ' ' + (f.contrast + '/' + f.contrastVal).padEnd(9) + ' ' + (f.missing.length ? '✗ ' + f.missing.length : '✓') + ' ' + f.dests + '⊇' + f.dests3 + '      ' + f.count + ' / ' + f.count3 + ' (' + f.ratio + ') painted ' + f.painted + ' / ' + f.painted3 + ' (' + f.pratio + ')');
          for (const f of R.faces) if (f.words && f.words.length) console.log('  words ' + f.key + ': ' + f.words.join(' | '));
          for (const f of R.faces) if (f.slotSel) console.log('  ' + f.key + ' slots (touch): selects ' + Array.from(new Set(f.slotSel)).join(' / ')); // ((ARP G3; fix round R2 P2-2: one hit a key)
          if (R.drawer) console.log('  amp drawer ' + R.drawer.w + '×' + R.drawer.h + ' edge ' + R.drawer.minEdge);
          if (R.skins) console.log('  arp slots contrast ' + Object.entries(R.skins).map(([k, v]) => k + ' ' + ((v.find(x => x.key === 'arp slots') || {}).contrast)).join(' · ')); // ((ARP fix round, R2 P2-3)
          if (R.editor) console.log('  arp editor ' + R.editor.w + '×' + R.editor.h + ' at ' + R.editor.left + ',' + R.editor.top + ' · roll ' + (R.editor.roll || []).join('×') + ' · scrolls ' + R.editor.scroll + ' px · band ' + R.editor.band + ' px' + ' · font ≥ ' + R.editor.minFont + ' · lit ' + JSON.stringify(R.editor.lit || {})); // ((ARP G3)
          for (const m of R.fails) console.log('    · ' + m);
          failed += R.fails.length;
          if (OUT) {
            const lm = await s('Page.getLayoutMetrics');
            const cs = lm.cssContentSize || lm.contentSize;
            const shot = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: Math.max(S.w, Math.ceil(cs.width)), height: Math.ceil(cs.height), scale: 1 } });
            const file = path.join(OUT, 'wc1-faces-' + R.name + '.png');
            fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
            sheets.push(file);
            if (R.editor) { // ((ARP G3) the pattern editor open over the sheet: the viewport as the user sees it
              await s('Runtime.evaluate', { expression: 'window.__arpEd ? window.__arpEd().then(() => 1) : 0', awaitPromise: true, returnByValue: true });
              await new Promise(r => setTimeout(r, 400));
              const es = await s('Page.captureScreenshot', { format: 'png' }), ef = path.join(OUT, 'arp-editor-' + R.name + '.png');
              fs.writeFileSync(ef, Buffer.from(es.data, 'base64'));
              sheets.push(ef);
            }
            if (process.argv.includes('--lc')) { // ((LC, lane F) the Combiner's face (4 inputs) in each skin, 2 × — its screens repainted in the skin
              for (const sk of ['charcoal', 'ivory', 'glass']) {
                await s('Runtime.evaluate', { expression: "document.getElementById('world').setAttribute('data-cv-skin', '" + sk + "'); window.__lcSync(); 1", returnByValue: true });
                await new Promise(r => setTimeout(r, 400));
                const rc = JSON.parse((await s('Runtime.evaluate', { expression: 'JSON.stringify(Array.from(document.querySelectorAll("#world > .cv-mod[data-cv-mod=m-comb4]")).map(m => { const r = m.getBoundingClientRect(); return [r.left + scrollX, r.top + scrollY, r.width, r.height]; }))', returnByValue: true })).result.value);
                for (const [x, y, w, h] of rc) { const sh = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: x - 12, y: y - 12, width: w + 24, height: h + 24, scale: 2 } }); const f = path.join(OUT, 'lc-face-' + R.name + '-' + sk + '.png'); fs.writeFileSync(f, Buffer.from(sh.data, 'base64')); sheets.push(f); }
              }
              await s('Runtime.evaluate', { expression: "document.getElementById('world').setAttribute('data-cv-skin', 'charcoal'); window.__lcSync(); 1", returnByValue: true });
              await new Promise(r => setTimeout(r, 200));
              const le = logs.splice(0).filter(m => !/^warning: /.test(m)); // ((review 2 R2-6) the skin passes' errors count too
              if (le.length) { console.log(R.name + ' --lc console:\n  ' + le.slice(0, 20).join('\n  ')); failed += le.length; }
            }
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
