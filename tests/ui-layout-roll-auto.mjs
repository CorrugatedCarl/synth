// tests/ui-layout-roll-auto.mjs — G5's browser half (docs/canvas/IMPL-AUTO.md §5, §9 G5; stage AUTO lane L): the roll's automation
// lane in Chrome for Testing on a page of its own — three PianoRolls stacked, each on the stub host of tests/roll-auto-stub.mjs (a
// curve on Cutoff with a point selected and the playhead on it; a drum track's velocity lane in the 120 px gutter; an empty lane
// whose name must ellipsize in the 64 px corner), the stub's menu the real wk context menu. Measured: the chip inside the strip's
// corner, its text fitted (measureText on the real font), ≥ 44 × 44 on touch; the readout inside the lane with the family's string;
// the empty lane's hint inside the lane; the chooser opened by a real tap on the chip (CDP input) and its Add… level inside the
// viewport with no label clipped; a tap on the empty lane → one autoEdit "Automation: Emphasis"; a point dragged → one autoEdit;
// two fingers on the lane (touch) → none; no console error. Then a contact sheet per size (the chooser open): roll-auto-<size>.png.
//   node --max-old-space-size=2048 tests/ui-layout-roll-auto.mjs --out <dir> [--sizes d,l,p] [--profile <dir>] [--json]
//     sizes: d 1440 × 900 (mouse) · l 1366 × 1024 and p 1024 × 1366 (touch) — dpr 2. Chrome: Chrome for Testing — $CHROME, else
//     .claude/test-browser's (this checkout's or the main checkout's); never the user's Google Chrome; a temporary profile under
//     --profile (the caller's scratchpad); downloads denied; exit 1 on any failure.
// Not a node --test file (not in the sweep): a CDP harness like ui-layout-kit.mjs; the page imports this module (/__ra.html) and
// calls page(o); nothing at top level touches node or the DOM.

/* ================================================================ the page side (browser) */
export async function page(o) {
  const O = o || {}, d = document, v = '?v=9';
  window.__raStep = 'imports';
  const [RL, S, WK, ST] = await Promise.all([import('../roll.js' + v), import('../song.js' + v), import('../wk.js' + v), import('./roll-auto-stub.mjs')]);
  const st = d.createElement('style');
  st.textContent = 'html, body { margin: 0; background: #24262b; overflow: hidden; } .rbox { position: absolute; left: 0; right: 0; }';
  d.head.appendChild(st);
  const H3 = Math.floor(innerHeight / 3), BAR = 3840;
  const DRUM = [{ n: 36, name: 'Kick' }, { n: 38, name: 'Snare' }, { n: 42, name: 'Closed hat' }, { n: 46, name: 'Open hat' }];
  const SC = [
    { key: 'curve', lane: 'i1:cf', auto: { 'i1:cf': { pts: [[0, 2], [BAR, 7.5], [2 * BAR, 3], [2 * BAR + 960, 9], [3 * BAR, 9], [3 * BAR + 1, 1], [4 * BAR, 5]] }, 'mix:vol': { pts: [[0, 1]] }, 'i1:gone': { pts: [[0, 3]] } },
      notes: [[0, 60], [960, 64], [1920, 67], [2880, 72], [BAR, 62], [BAR + 1920, 65], [2 * BAR, 60], [3 * BAR, 67], [3 * BAR + 1920, 64]], sel: BAR, ph: 2 * BAR + 480 },
    { key: 'drums', lane: 'vel', drum: true, notes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(i => [i * 960, i % 4 === 0 ? 36 : i % 4 === 2 ? 38 : 42, 60 + (i * 37) % 67]), ph: BAR },
    { key: 'empty', lane: 'i1:em', notes: [[0, 48], [BAR, 50]], ph: 0 },
  ];
  window.__raStep = 'rolls';
  const views = SC.map((sc, i) => {
    const box = d.createElement('div'); box.className = 'rbox'; box.style.top = i * H3 + 'px'; box.style.height = (i === 2 ? innerHeight - 2 * H3 : H3 - 2) + 'px'; // (a 2 px seam between)
    d.body.appendChild(box);
    const p = S.newProject({ model: 'x', name: sc.key }), tr = p.tracks[0];
    p.loop = { on: true, start: 0, end: 4 * BAR };
    tr.notes.push(...sc.notes.map(([t, n, vel], k) => ({ id: 100 + k, t, d: 720, n, v: vel || 100 })));
    if (sc.auto) tr.auto = JSON.parse(JSON.stringify(sc.auto));
    const A = ST.autoHost({ menu: (items, x, y) => WK.contextMenu(x, y, items) });
    A.lanes.set(tr.id, sc.lane);
    const host = Object.assign({
      getProject: () => p, getTrack: () => tr, edit: (l, fn) => fn(), beginEdit() {}, endEdit() {}, changed() {}, audition() {}, auditionOff() {},
      getPlayhead: () => sc.ph, setPlayhead() {}, setLoop() {}, restoreLoop() {}, getSnap: () => p.snap, onSelect() {}, touch: !!O.touch,
    }, A, sc.drum ? { drumRows: () => DRUM } : {});
    const roll = new RL.PianoRoll(box, host);
    return { sc, box, roll, A, tr };
  });
  if (d.fonts && d.fonts.ready) await d.fonts.ready;
  for (const V of views) { V.roll.resize(); V.roll.fit(); V.roll.setPlayhead(V.sc.ph); }
  views[0].roll.asel = views[0].sc.sel; views[0].roll.render();
  for (let i = 0; i < 4; i++) await new Promise(r => requestAnimationFrame(r));
  const edits = i => views[i].A.log.filter(e => e.op === 'edit');
  const cr = (V, x, y) => { const r = V.roll.el.getBoundingClientRect(); return { x: r.left + x, y: r.top + y }; };
  const a2y = (R, L, val) => R.vt + 7 + (1 - (val - L.lo) / (L.hi - L.lo)) * (R.H - R.vt - 14);
  // client points for the driver's input: a roll's chip centre, its lane's point k, an empty spot of its lane
  window.__raPt = (i, what, k) => {
    const V = views[i], R = V.roll;
    if (what === 'chip') { const C = R.autoChip(); return cr(V, C.x + C.w / 2, C.y + C.h / 2); }
    const L = R.al;
    if (what === 'pt') { const pt = L.pts[k]; return cr(V, R.t2x(pt[0]), a2y(R, L, pt[1])); }
    return cr(V, R.gut + R.gw * 0.4, (R.vt + R.H) / 2);
  };
  window.__raEdits = i => edits(i).map(e => ({ key: e.key, label: e.label, n: e.pts.length, pts: e.pts }));
  window.__raPinch = i => !!(views[i].roll.g && views[i].roll.g.type === 'pinch');
  // the layout: the chip, the readout, the hint, the strip inside the viewport
  window.__raMeasure = () => {
    const fails = [], rolls = [];
    for (const V of views) {
      const R = V.roll, C = R.autoChip(), L = R.al, f = m => fails.push(V.sc.key + ': ' + m), br = V.box.getBoundingClientRect();
      const out = { key: V.sc.key, W: R.W, H: R.H, gut: R.gut, chip: C, lane: R.autoLane() };
      if (R.W !== Math.round(br.width) || R.H !== Math.round(br.height)) f('the canvas ' + R.W + ' × ' + R.H + ' ≠ its box ' + br.width + ' × ' + br.height);
      if (br.bottom > innerHeight + 0.5 || br.right > innerWidth + 0.5) f('the roll leaves the viewport');
      if (!C) { f('no chip'); rolls.push(out); continue; }
      if (C.x < 0 || C.x + C.w > R.gut - 1 + 0.01 || C.y < R.vt - 0.01 || C.y + C.h > R.H + 0.01) f('the chip ' + JSON.stringify([C.x, C.y, C.w, C.h]) + ' outside the corner (' + R.gut + ' × 72 at ' + R.vt + ')');
      if (C.tw > C.w - 10 + 0.01) f('the chip text "' + C.text + '" ' + C.tw.toFixed(1) + ' px > ' + (C.w - 10));
      if (C.text !== C.label && !(C.text.endsWith('…') && C.label.startsWith(C.text.slice(0, -1)))) f('the chip text "' + C.text + '" is not its label "' + C.label + '"');
      if (O.touch && (C.w < 44 || C.h < 44)) f('the chip ' + C.w + ' × ' + C.h + ' < 44 × 44 on touch');
      if (V.sc.lane !== out.lane) f('lane ' + out.lane + ' ≠ ' + V.sc.lane);
      if (L && L.pts.length) {
        const B = R.aread, want = ST.KEYS[L.key].fmt(autoAtLocal(L.pts, R.ph));
        out.readout = B && B.text;
        if (!B) f('no readout');
        else {
          if (B.x < R.gut || B.x + B.w > R.W || B.y < R.vt || B.y + B.h > R.H) f('the readout ' + JSON.stringify([B.x, B.y, B.w, B.h]) + ' outside the lane');
          if (B.text !== want) f('the readout "' + B.text + '" ≠ "' + want + '"');
          if (B.w1 + 12 > B.w + 0.01) f('the readout text clipped');
        }
        for (const pt of L.pts) { const y = a2y(R, L, pt[1]); if (y - 4 < R.vt || y + 4 > R.H) f('a point at y ' + y.toFixed(1) + ' outside the strip'); }
        if (!R.adraw || R.adraw.dots !== L.pts.length || R.adraw.sel !== 1) f('drawn ' + JSON.stringify(R.adraw) + ' for ' + L.pts.length + ' points, one selected');
      }
      if (L && !L.pts.length) {
        const c = R.ctx; c.font = "11px 'JetBrains Mono', ui-monospace, Menlo, monospace";
        const w = c.measureText(O.touch ? 'Tap to add a point' : 'Click to add a point').width;
        if (w > R.gw - 8) f('the empty lane\'s hint ' + w + ' px > the lane');
      }
      rolls.push(out);
    }
    return { fails, rolls };
  };
  // the chooser: every level inside the viewport, no label clipped; → the Add… item's centre
  window.__raMenu = () => {
    const L = Array.from(d.querySelectorAll('.wk-ctx')), fails = [];
    for (const m of L) {
      const r = m.getBoundingClientRect();
      if (r.left < -0.5 || r.top < -0.5 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) fails.push('a menu level ' + JSON.stringify([r.left, r.top, r.width, r.height]) + ' outside the viewport');
      for (const it of m.querySelectorAll('.wk-ci')) {
        const lab = it.querySelector('.wk-cl'), ir = it.getBoundingClientRect();
        if (lab && lab.scrollWidth > lab.clientWidth + 1) fails.push('the item "' + lab.textContent + '" clipped');
        if (O.touch && ir.height < 32) fails.push('the item "' + (lab && lab.textContent) + '" ' + ir.height.toFixed(1) + ' px tall');
      }
    }
    const items = L.length ? Array.from(L[0].querySelectorAll('.wk-ci')).map(e => e.querySelector('.wk-cl').textContent) : [];
    const add = L.length ? Array.from(L[0].querySelectorAll('.wk-ci')).find(e => e.querySelector('.wk-cl').textContent === 'Add…') : null, ar = add && add.getBoundingClientRect();
    return { levels: L.length, items, sub: L[1] ? Array.from(L[1].querySelectorAll('.wk-cl')).map(e => e.textContent) : [], fails, add: ar ? { x: ar.left + ar.width / 2, y: ar.top + ar.height / 2 } : null };
  };
  window.__ra = { ready: true, size: [innerWidth, innerHeight, devicePixelRatio], touch: !!O.touch };
  return window.__ra;
}
// §2.3 (as roll-auto's): the page's own copy, so the readout is checked against the rule, not against the code under test
function autoAtLocal(P, t) {
  if (!P.length) return undefined;
  if (t <= P[0][0]) return P[0][1];
  if (t >= P[P.length - 1][0]) return P[P.length - 1][1];
  for (let i = 1; i < P.length; i++) if (t < P[i][0]) return P[i - 1][1] + (P[i][1] - P[i - 1][1]) * (t - P[i - 1][0]) / (P[i][0] - P[i - 1][0]);
  return P[P.length - 1][1];
}

/* ================================================================ the driver (node) */
const isMain = typeof process !== 'undefined' && process.versions && process.versions.node && process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) await main();
async function main() {
  const http = await import('node:http'), fs = await import('node:fs'), path = await import('node:path'), os = await import('node:os'), url = await import('node:url'), cp = await import('node:child_process');
  const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
  const arg = (k, x) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : x; };
  const OUT = arg('out', null), SIZES = String(arg('sizes', 'd,l,p')).split(','), JSONOUT = process.argv.includes('--json');
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
  const HTML = q => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1"><title>Roll automation lane</title>
<link rel="stylesheet" href="/__fonts.css"></head><body>
<script type="module">import('/tests/ui-layout-roll-auto.mjs').then(m => m.page(${JSON.stringify(q)})).catch(e => { window.__ra = { error: String(e && e.stack || e) }; });</script></body></html>`;
  const fontsCss = () => fs.readFileSync(path.join(ROOT, 'fonts', 'fonts.css'), 'utf8').replace(/url\(([^/)][^)]*)\)/g, 'url(/fonts/$1)');
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/__ra.html') { res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); return res.end(HTML({ touch: u.searchParams.get('touch') === '1' })); }
    if (u.pathname === '/__fonts.css') { res.writeHead(200, { 'Content-Type': 'text/css', 'Cache-Control': 'no-store' }); return res.end(fontsCss()); }
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
  if (!CHROME) { console.log('Chrome for Testing not found (.claude/test-browser): set $CHROME'); srv.close(); process.exit(2); }
  const prof = fs.mkdtempSync(path.join(arg('profile', os.tmpdir()), 'ra-chrome-'));
  const ch = cp.spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + prof, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-color-profile=srgb', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  console.log('Chrome for Testing pid ' + ch.pid);
  const all = [], sheets = [];
  let failed = 0, browserWs = null;
  try {
    const wsUrl = await new Promise((res, rej) => { let b = ''; const t = setTimeout(() => rej(new Error('Chrome did not start')), 20000); ch.stderr.on('data', x => { b += x; const m = /DevTools listening on (ws:\/\/\S+)/.exec(b); if (m) { clearTimeout(t); res(m[1]); } }); });
    browserWs = new WebSocket(wsUrl);
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
    const wait = ms => new Promise(r => setTimeout(r, ms));
    for (const sk of SIZES) {
      const Z = SZ[sk];
      if (!Z) continue;
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      const s = (m, p) => send(m, p, sessionId);
      const ev = async e => { const v = await s('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (v.exceptionDetails) throw new Error(e + ': ' + JSON.stringify(v.exceptionDetails).slice(0, 300)); return v.result.value; };
      await s('Runtime.enable'); await s('Page.enable');
      await s('Emulation.setDeviceMetricsOverride', { width: Z.w, height: Z.h, deviceScaleFactor: Z.dpr, mobile: Z.touch });
      if (Z.touch) await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await s('Page.navigate', { url: 'http://127.0.0.1:' + port + '/__ra.html?touch=' + (Z.touch ? 1 : 0) });
      const R = { name: Z.name, fails: [] };
      let ok = null;
      for (let i = 0; i < 200 && !ok; i++) { await wait(100); ok = await ev('window.__ra ? JSON.stringify(window.__ra) : null'); }
      ok = ok ? JSON.parse(ok) : { error: 'timeout (' + (await ev('window.__raStep')) + ')' };
      if (ok.error) { R.error = ok.error; failed++; console.log(Z.name + ': ERROR ' + ok.error); all.push(R); await send('Target.closeTarget', { targetId }); continue; }
      R.size = ok.size;
      if (ok.size[0] !== Z.w || ok.size[1] !== Z.h) R.fails.push('the pass ran at ' + ok.size[0] + ' × ' + ok.size[1] + ', not ' + Z.w + ' × ' + Z.h);
      // a tap / a drag / two fingers through the real input pipeline (touch: touch events → pointers, as the iPad)
      const tap = async P => {
        if (Z.touch) { await s('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: P.x, y: P.y, id: 1 }] }); await s('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
        else { await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x: P.x, y: P.y }); await s('Input.dispatchMouseEvent', { type: 'mousePressed', x: P.x, y: P.y, button: 'left', buttons: 1, clickCount: 1 }); await s('Input.dispatchMouseEvent', { type: 'mouseReleased', x: P.x, y: P.y, button: 'left', buttons: 0, clickCount: 1 }); }
        await wait(120);
      };
      const drag = async (P, dx, dy) => {
        for (let k = 0; k <= 8; k++) {
          const x = P.x + dx * k / 8, y = P.y + dy * k / 8;
          if (Z.touch) await s('Input.dispatchTouchEvent', { type: k ? 'touchMove' : 'touchStart', touchPoints: [{ x, y, id: 1 }] });
          else await s('Input.dispatchMouseEvent', { type: k ? 'mouseMoved' : 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
          await wait(16);
        }
        if (Z.touch) await s('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        else await s('Input.dispatchMouseEvent', { type: 'mouseReleased', x: P.x + dx, y: P.y + dy, button: 'left', buttons: 0, clickCount: 1 });
        await wait(120);
      };
      const M = await ev('JSON.stringify(window.__raMeasure())').then(JSON.parse);
      R.rolls = M.rolls; R.fails.push(...M.fails);
      // the chooser by a tap on the curve roll's chip, then its Add… level
      await tap(await ev('window.__raPt(0, "chip")'));
      const m1 = await ev('window.__raMenu()');
      R.menu = m1.items;
      if (m1.levels !== 1) R.fails.push('a tap on the chip opened ' + m1.levels + ' menu level(s)');
      const want = ['Velocity', 'Minimoog · Cutoff', 'Volume', 'i1:gone (no such control)', 'Delete i1:gone automation', 'Add…'];
      if (JSON.stringify(m1.items) !== JSON.stringify(want)) R.fails.push('the chooser\'s items ' + JSON.stringify(m1.items));
      R.fails.push(...m1.fails);
      if (m1.add) await tap(m1.add);
      const m2 = await ev('window.__raMenu()');
      R.sub = m2.sub;
      if (m2.levels !== 2 || JSON.stringify(m2.sub) !== JSON.stringify(['Minimoog', 'Reverb 1', 'Mixer'])) R.fails.push('Add… opened ' + m2.levels + ' level(s): ' + JSON.stringify(m2.sub));
      R.fails.push(...m2.fails.map(x => 'Add…: ' + x));
      if (OUT) {
        await wait(150);
        const shot = await s('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: Z.w, height: Z.h, scale: 1 } });
        const file = path.join(OUT, 'roll-auto-' + Z.name + '.png');
        fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
        sheets.push(file);
      }
      for (let i = 0; i < 2; i++) { await s('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await s('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await wait(60); }
      if ((await ev('document.querySelectorAll(".wk-ctx").length')) !== 0) R.fails.push('Escape ×2 left the chooser open');
      // a tap on the empty lane: one edit, one point
      await tap(await ev('window.__raPt(2, "lane")'));
      const e2 = await ev('window.__raEdits(2)');
      if (e2.length !== 1 || e2[0].label !== 'Automation: Emphasis' || e2[0].n !== 1) R.fails.push('a tap on the empty lane: ' + JSON.stringify(e2));
      // two fingers on the curve's lane, the first on a point: a pinch, no edit
      if (Z.touch) {
        const P = await ev('window.__raPt(0, "pt", 2)');
        await s('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: P.x, y: P.y, id: 1 }] });
        await wait(30);
        await s('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: P.x, y: P.y, id: 1 }, { x: P.x + 160, y: P.y - 20, id: 2 }] });
        let pinch = false;
        for (let k = 1; k <= 6; k++) { await s('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: P.x - 6 * k, y: P.y - 3 * k, id: 1 }, { x: P.x + 160 + 10 * k, y: P.y - 20, id: 2 }] }); await wait(16); pinch = pinch || await ev('window.__raPinch(0)'); }
        await s('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await wait(120);
        const e0 = await ev('window.__raEdits(0)');
        if (!pinch) R.fails.push('two fingers on the lane made no pinch');
        if (e0.length) R.fails.push('two fingers edited: ' + JSON.stringify(e0));
      }
      // a point dragged up: one edit, its tick kept
      const P0 = await ev('window.__raPt(0, "pt", 2)');
      await drag(P0, 0, -18);
      const e0 = await ev('window.__raEdits(0)');
      if (e0.length !== 1 || e0[0].label !== 'Automation: Cutoff' || e0[0].n !== 7 || e0[0].pts[2][0] !== 7680 || !(e0[0].pts[2][1] > 3)) R.fails.push('a point drag: ' + JSON.stringify(e0));
      R.console = logs.splice(0);
      const errs = R.console.filter(m => !/^warning: /.test(m));
      if (errs.length) R.fails.push(...errs.map(m => 'console ' + m.slice(0, 160)));
      all.push(R);
      console.log('\n' + Z.name + (R.fails.length ? '  ✗ ' + R.fails.length + ' failure(s)' : '  ✓ G5 (browser) green') + '  (' + R.size.join(' × ') + ')');
      for (const r of R.rolls) console.log('  ' + r.key.padEnd(7) + ' ' + (r.W + '×' + r.H).padEnd(10) + ' gutter ' + r.gut + '  chip ' + (r.chip ? r.chip.w + '×' + r.chip.h + ' "' + r.chip.text + '" ' + r.chip.tw.toFixed(1) + ' px' : '—') + (r.readout ? '  readout "' + r.readout + '"' : ''));
      console.log('  chooser: ' + (R.menu || []).join(' | ') + '  ·  Add…: ' + (R.sub || []).join(' | '));
      for (const m of R.fails) console.log('    · ' + m);
      failed += R.fails.length;
      await send('Target.closeTarget', { targetId });
    }
  } catch (e) {
    failed++; console.log('ERROR ' + (e && e.stack || e));
  } finally {
    try { if (browserWs) browserWs.close(); } catch (e) { /* closed */ }
    ch.kill();
    srv.close();
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* busy */ }
  }
  if (OUT) { fs.writeFileSync(path.join(OUT, 'g5-roll-auto.json'), JSON.stringify(all, null, 1)); console.log('\nsheets:\n  ' + sheets.join('\n  ')); }
  if (JSONOUT) console.log(JSON.stringify(all));
  console.log(failed ? '\nG5 (roll automation lane): ' + failed + ' failure(s)' : '\nG5 (roll automation lane): green');
  process.exit(failed ? 1 : 0);
}
