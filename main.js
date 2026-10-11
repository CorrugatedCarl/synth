import { MODELS, DX_ALGS } from './models.js?v=1';

const VERSION = '1';
const $ = (s, el = document) => el.querySelector(s);
const h = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

const settings = Object.assign({ sr: 0, os: 4, drift: 5, master: 0.8, model: 'minimoog', vel: 100 }, store.get('synth.settings', {}));
const fromHash = MODELS.find(m => '#' + m.id === location.hash);
let model = fromHash || MODELS.find(m => m.id === settings.model) || MODELS[1];
let vals = {};
let ctx = null, node = null, an = null, gain = null, powering = null;
let octave = 0, sustain = false;
const ui = new Map();

/* ------------------------------------------------------------ values */
function defaults(m) { const v = {}; for (const c of m.controls) v[c.id] = c.def; return v; }
function loadVals(m) { return Object.assign(defaults(m), store.get('synth.v.' + m.id, {})); }
function fmt(c, v) { return c.fmt ? c.fmt(v) : c.t === 'k' ? (+v).toFixed(1) : String(v); }
function toPos(c, v) { return (v - c.min) / (c.max - c.min); }
function fromPos(c, p) {
  let v = c.min + clamp(p, 0, 1) * (c.max - c.min);
  if (c.step) v = Math.round(v / c.step) * c.step;
  return +v.toFixed(4);
}

let patchQueued = false;
function queuePatch() {
  if (patchQueued) return;
  patchQueued = true;
  requestAnimationFrame(() => { patchQueued = false; sendPatch(); });
}
function buildPatch() {
  const P = {};
  for (const c of model.controls) P[c.id] = c.conv ? c.conv(vals[c.id]) : vals[c.id];
  return model.map(P, vals, { drift: settings.drift / 10, hiss: 1, sr: ctx ? ctx.sampleRate : 48000 });
}
function sendPatch() { if (node) node.port.postMessage({ t: 'patch', p: buildPatch() }); }
let saveT;
function persist() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { store.set('synth.v.' + model.id, vals); store.set('synth.settings', settings); }, 250);
}
function setVal(id, v) {
  vals[id] = v;
  const u = ui.get(id); if (u) u();
  if (id === 'alg') drawAlgo();
  queuePatch(); persist();
}
function refreshAll() { for (const u of ui.values()) u(); drawAlgo(); }

/* ------------------------------------------------------------- audio */
async function powerOn() {
  if (ctx) return;
  if (powering) return powering;
  powering = (async () => {
    const opt = { latencyHint: 'interactive' };
    if (settings.sr) opt.sampleRate = settings.sr;
    let c;
    try { c = new AudioContext(opt); } catch { c = new AudioContext({ latencyHint: 'interactive' }); }
    c.resume();
    try {
      await c.audioWorklet.addModule('engine.js?v=' + VERSION);
    } catch (err) {
      c.close();
      $('#cpu').textContent = 'Audio engine failed to load: ' + err.message;
      throw err;
    }
    const n = new AudioWorkletNode(c, 'synth-engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { os: settings.os } });
    gain = c.createGain(); gain.gain.value = settings.master;
    an = c.createAnalyser(); an.fftSize = 8192; an.smoothingTimeConstant = 0.75;
    n.connect(gain); gain.connect(c.destination); gain.connect(an);
    n.port.onmessage = e => { if (e.data.t === 'stats') stats(e.data); };
    ctx = c; node = n;
    if (c.state !== 'running') await c.resume();
    sendPatch();
    if (sustain) post({ t: 'sus', v: true });
    setPowerUI(true);
    initMIDI();
  })();
  try { await powering; } finally { powering = null; }
}
async function powerOff() {
  if (!ctx) return;
  const c = ctx;
  ctx = null; node = null; an = null; gain = null;
  for (const n of [...down]) { down.delete(n); keyVis(n, false); }
  await c.close();
  setPowerUI(false);
}
function setPowerUI(on) {
  $('#power').setAttribute('aria-pressed', on ? 'true' : 'false');
  if (!on) { $('#rate').textContent = 'Engine off'; $('#cpu').textContent = 'Press Power or play a key'; }
  else rateText();
}
function rateText() {
  if (!ctx) return;
  const sr = ctx.sampleRate, os = settings.os;
  $('#rate').textContent = `${(sr / 1000).toFixed(1).replace(/\.0$/, '')} kHz × ${os} = ${(sr * os / 1000).toFixed(1).replace(/\.0$/, '')} kHz · 64-bit`;
}
function stats(d) {
  const pct = Math.round(d.load * 100);
  const el = $('#cpu');
  el.textContent = `DSP load ${pct}% · ${d.voices} voice${d.voices === 1 ? '' : 's'}`;
  el.classList.toggle('warn', pct > 80);
  if (pct > 80) el.textContent += ' — lower oversampling';
}
function post(m) { if (node) node.port.postMessage(m); }

/* ------------------------------------------------------------- notes */
const down = new Set();
function noteOn(n, v) {
  if (n < 0 || n > 127) return;
  down.add(n); keyVis(n, true);
  if (!node) { powerOn().then(() => { if (down.has(n)) post({ t: 'on', n, v }); }).catch(() => {}); return; }
  post({ t: 'on', n, v });
}
function noteOff(n) {
  if (!down.has(n)) return;
  down.delete(n); keyVis(n, false);
  post({ t: 'off', n });
}
function panic() {
  for (const n of [...down]) noteOff(n);
  setSustain(false);
  post({ t: 'panic' });
}
function setSustain(on) {
  sustain = on;
  $('#hold').setAttribute('aria-pressed', on ? 'true' : 'false');
  post({ t: 'sus', v: on });
}

/* -------------------------------------------------------- model nav */
function renderNav() {
  const nav = $('#models');
  nav.innerHTML = '';
  for (const m of MODELS) {
    const b = h('button', m === model ? 'on' : '');
    b.type = 'button';
    b.append(h('span', 'yr', String(m.year)), h('span', 'nm', m.name), h('span', 'mk', m.maker));
    b.onclick = () => selectModel(m.id);
    nav.append(b);
  }
  const on = nav.querySelector('.on');
  if (on) {
    const l = on.offsetLeft - nav.offsetLeft, r = l + on.offsetWidth;
    if (l < nav.scrollLeft || r > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = l - 24;
  }
}
function selectModel(id) {
  if (id === model.id) return;
  for (const n of [...down]) noteOff(n);
  post({ t: 'panic' });
  model = MODELS.find(m => m.id === id);
  settings.model = id;
  vals = loadVals(model);
  renderNav(); renderPanel(); sendPatch(); persist();
  history.replaceState(null, '', '#' + id);
}

/* ------------------------------------------------------------ panel */
function renderPanel() {
  ui.clear();
  const th = model.theme, el = $('#inst');
  el.className = `inst ctl-${th.ctl} knob-${th.knob}${th.wood ? ' wood' : ''} m-${model.id}`;
  const vars = { panel: th.panel, face: th.face, ink: th.ink, label: th.label, accent: th.accent, cap: th.cap || '#eee', capline: th.capLine || '#111' };
  for (const k in vars) el.style.setProperty('--' + k, vars[k]);
  el.innerHTML = '';
  const plate = h('div', 'plate');
  const nm = h('div', 'nameplate');
  nm.append(h('div', 'maker', model.maker), h('div', 'mname', model.name), h('div', 'mmodel', `${model.model} · ${model.year}`));
  if (th.stripes) { const s = h('div', 'stripes'); for (const c of th.stripes) { const i = h('i'); i.style.background = c; s.append(i); } nm.append(s); }
  plate.append(nm, h('div', 'tag', model.tag), presetUI());
  const secs = h('div', 'secs');
  model.sections.forEach((s, si) => {
    const se = h('div', 'sec' + (s.wide ? ' wide' : '') + (s.op ? ' op' : ''));
    se.append(h('h3', null, s.title));
    const cs = h('div', 'ctls');
    for (const c of s.c) cs.append(control(c, si));
    se.append(cs);
    secs.append(se);
  });
  el.append(plate, secs);
  $('#about-title').textContent = `${model.maker} ${model.name} (${model.year})`;
  $('#about').textContent = model.about;
  drawAlgo();
}

function control(c, si) {
  const th = model.theme;
  const wrap = h('div', 'ctl t-' + c.t);
  let el;
  if (c.t === 'k') el = th.ctl === 'slider' ? slider(c, si) : th.ctl === 'num' ? numBox(c) : knob(c);
  else if (c.t === 's') el = selector(c);
  else el = toggle(c);
  const lab = h('label', null, c.label);
  wrap.append(el, lab);
  return wrap;
}

const TICKS = (() => {
  let s = '';
  for (let i = 0; i <= 10; i++) {
    const a = (-135 + 27 * i) * Math.PI / 180;
    const x1 = 32 + Math.sin(a) * 28.5, y1 = 32 - Math.cos(a) * 28.5, x2 = 32 + Math.sin(a) * 31.5, y2 = 32 - Math.cos(a) * 31.5;
    s += `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`;
  }
  return s;
})();
function knob(c) {
  const el = h('div', 'knob');
  el.tabIndex = 0; el.setAttribute('role', 'slider'); el.setAttribute('aria-label', c.label);
  el.innerHTML = `<svg viewBox="0 0 64 64"><g class="ticks">${TICKS}</g><circle class="skirt" cx="32" cy="32" r="25"/><g class="rot"><circle class="cap" cx="32" cy="32" r="17.5"/><circle class="shine" cx="32" cy="32" r="17.5"/><line class="ind" x1="32" y1="9" x2="32" y2="21"/></g></svg>`;
  const rot = el.querySelector('.rot');
  const upd = () => {
    rot.setAttribute('transform', `rotate(${(-135 + 270 * toPos(c, vals[c.id])).toFixed(2)} 32 32)`);
    el.setAttribute('aria-valuetext', fmt(c, vals[c.id]));
  };
  ui.set(c.id, upd); upd();
  drag(el, c);
  return el;
}
function slider(c, si) {
  const th = model.theme;
  const el = h('div', 'slider');
  el.tabIndex = 0; el.setAttribute('role', 'slider'); el.setAttribute('aria-label', c.label);
  const ticks = h('div', 'sticks');
  for (let i = 0; i <= 10; i++) ticks.append(h('i'));
  const cap = h('div', 'cap');
  if (th.capColors) cap.style.background = th.capColors[si % th.capColors.length];
  el.append(h('div', 'groove'), ticks, cap);
  const upd = () => {
    cap.style.bottom = `calc(${toPos(c, vals[c.id]).toFixed(4)} * (100% - 14px))`;
    el.setAttribute('aria-valuetext', fmt(c, vals[c.id]));
  };
  ui.set(c.id, upd); upd();
  drag(el, c);
  return el;
}
function numBox(c) {
  const el = h('div', 'num');
  el.tabIndex = 0; el.setAttribute('role', 'slider'); el.setAttribute('aria-label', c.label);
  const upd = () => { el.textContent = fmt(c, vals[c.id]); };
  ui.set(c.id, upd); upd();
  drag(el, c);
  return el;
}
function selector(c) {
  const el = h('div', 'sel' + (c.opts.length <= 2 ? ' two' : ''));
  el.setAttribute('role', 'radiogroup'); el.setAttribute('aria-label', c.label);
  const bs = c.opts.map((o, i) => {
    const b = h('button', 'opt'); b.type = 'button'; b.setAttribute('role', 'radio');
    b.append(h('span', 'led'), h('span', 'txt', o));
    b.onclick = () => setVal(c.id, i);
    el.append(b);
    return b;
  });
  const upd = () => bs.forEach((b, i) => { const on = vals[c.id] === i; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
  ui.set(c.id, upd); upd();
  return el;
}
function toggle(c) {
  const b = h('button', 'tog'); b.type = 'button'; b.setAttribute('aria-label', c.label);
  b.append(h('span', 'led'));
  b.onclick = () => setVal(c.id, vals[c.id] ? 0 : 1);
  const upd = () => { b.classList.toggle('on', !!vals[c.id]); b.setAttribute('aria-pressed', vals[c.id] ? 'true' : 'false'); };
  ui.set(c.id, upd); upd();
  return b;
}

/* tooltip */
const tip = $('#tip');
let tipHide;
function showTip(el, c) {
  clearTimeout(tipHide);
  const r = el.getBoundingClientRect();
  tip.textContent = `${c.label}: ${fmt(c, vals[c.id])}`;
  tip.style.left = (r.left + r.width / 2) + 'px';
  tip.style.top = (r.top - 6) + 'px';
  tip.classList.add('show');
}
function hideTip(delay = 0) { clearTimeout(tipHide); tipHide = setTimeout(() => tip.classList.remove('show'), delay); }

function drag(el, c) {
  let dragging = false;
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); el.focus({ preventScroll: true });
    el.setPointerCapture(e.pointerId);
    dragging = true;
    const p0 = toPos(c, vals[c.id]), y0 = e.clientY;
    const range = c.step ? (c.max - c.min) / c.step : 100;
    const base = range > 40 ? 0.0045 : Math.max(0.0045, 1 / (range * 22));
    showTip(el, c);
    const mv = ev => {
      const p = p0 + (y0 - ev.clientY) * (ev.shiftKey ? base * 0.2 : base);
      const v = fromPos(c, p);
      if (v !== vals[c.id]) setVal(c.id, v);
      showTip(el, c);
    };
    const up = () => {
      dragging = false;
      el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
      hideTip(400);
    };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
  el.addEventListener('dblclick', () => { setVal(c.id, c.def); showTip(el, c); hideTip(800); });
  el.addEventListener('wheel', e => {
    e.preventDefault();
    const st = c.step ? c.step / (c.max - c.min) : (e.shiftKey ? 0.002 : 0.01);
    setVal(c.id, fromPos(c, toPos(c, vals[c.id]) - Math.sign(e.deltaY) * st));
    showTip(el, c); hideTip(700);
  }, { passive: false });
  el.addEventListener('keydown', e => {
    const st = c.step ? c.step / (c.max - c.min) : (e.shiftKey ? 0.002 : 0.02);
    let d = 0;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') d = st;
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') d = -st;
    else return;
    e.preventDefault(); e.stopPropagation();
    setVal(c.id, fromPos(c, toPos(c, vals[c.id]) + d));
    showTip(el, c); hideTip(700);
  });
  el.addEventListener('pointerenter', () => { if (!dragging) showTip(el, c); });
  el.addEventListener('pointerleave', () => { if (!dragging) hideTip(); });
  el.addEventListener('blur', () => { if (!dragging) hideTip(); });
}

/* ---------------------------------------------------------- presets */
function userPresets() { return store.get('synth.user.' + model.id, []); }
function presetUI() {
  const w = h('div', 'presets');
  const sel = h('select'); sel.setAttribute('aria-label', 'Preset');
  const fill = () => {
    sel.innerHTML = '';
    const o0 = h('option', null, '— Presets —'); o0.value = ''; sel.append(o0);
    const g1 = h('optgroup'); g1.label = 'Factory';
    model.presets.forEach((p, i) => { const o = h('option', null, p.name); o.value = 'f' + i; g1.append(o); });
    sel.append(g1);
    const up = userPresets();
    if (up.length) {
      const g2 = h('optgroup'); g2.label = 'Saved';
      up.forEach((p, i) => { const o = h('option', null, p.name); o.value = 'u' + i; g2.append(o); });
      sel.append(g2);
    }
  };
  fill();
  const load = key => {
    if (!key) return;
    const p = key[0] === 'f' ? model.presets[+key.slice(1)] : userPresets()[+key.slice(1)];
    if (!p) return;
    vals = Object.assign(defaults(model), p.v);
    refreshAll(); sendPatch(); persist();
  };
  sel.onchange = () => load(sel.value);
  const step = d => {
    const keys = [...sel.querySelectorAll('option')].map(o => o.value).filter(Boolean);
    let i = keys.indexOf(sel.value);
    i = (i + d + keys.length) % keys.length;
    if (i < 0) i = 0;
    sel.value = keys[i]; load(keys[i]);
  };
  const prev = h('button', null, '◀'); prev.type = 'button'; prev.title = 'Previous preset'; prev.onclick = () => step(-1);
  const next = h('button', null, '▶'); next.type = 'button'; next.title = 'Next preset'; next.onclick = () => step(1);
  const save = h('button', null, 'Save'); save.type = 'button';
  save.onclick = () => {
    const name = prompt('Name this sound:', 'My ' + model.name + ' sound');
    if (!name) return;
    const up = userPresets(); up.push({ name, v: Object.assign({}, vals) });
    store.set('synth.user.' + model.id, up);
    fill(); sel.value = 'u' + (up.length - 1);
  };
  const init = h('button', null, 'Init'); init.type = 'button'; init.title = 'Reset every control to its default';
  init.onclick = () => { vals = defaults(model); refreshAll(); sendPatch(); persist(); sel.value = ''; };
  w.append(prev, sel, next, save, init);
  return w;
}

/* ------------------------------------------------- DX7 algorithm view */
function drawAlgo() {
  const box = $('#algo');
  if (model.id !== 'dx7') { box.hidden = true; return; }
  box.hidden = false;
  const a = DX_ALGS[clamp(Math.round(vals.alg), 1, 32) - 1];
  const [edges, car, fb] = a;
  const mods = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const [f, t] of edges) mods[t].push(f);
  const lvl = {}; for (let i = 1; i <= 6; i++) lvl[i] = 0;
  for (let it = 0; it < 6; it++) for (const [f, t] of edges) lvl[f] = Math.max(lvl[f], lvl[t] + 1);
  const xs = {}; let col = 0;
  const place = op => {
    if (xs[op] != null) return xs[op];
    const ms = mods[op].filter(m => xs[m] == null || true);
    const kids = [];
    for (const m of ms) { if (xs[m] == null) kids.push(place(m)); else kids.push(xs[m]); }
    xs[op] = kids.length ? kids.reduce((s, x) => s + x, 0) / kids.length : col++;
    return xs[op];
  };
  for (const c of [...car].sort((x, y) => x - y)) place(c);
  for (let i = 1; i <= 6; i++) if (xs[i] == null) xs[i] = col++;
  const maxL = Math.max(...Object.values(lvl));
  const W = 44, Hh = 46, bw = 30, bh = 24;
  const cols = Math.max(col, 1);
  const width = cols * W + 20, height = (maxL + 1) * Hh + 40;
  const P = i => ({ x: 10 + xs[i] * W + W / 2, y: 14 + (maxL - lvl[i]) * Hh + bh / 2 });
  let s = `<svg viewBox="0 0 ${width} ${height}" width="${width * 1.3}" role="img" aria-label="Algorithm ${Math.round(vals.alg)} diagram">`;
  for (const [f, t] of edges) {
    const A = P(f), B = P(t);
    s += `<path d="M${A.x} ${A.y + bh / 2} C ${A.x} ${A.y + bh / 2 + 12}, ${B.x} ${B.y - bh / 2 - 12}, ${B.x} ${B.y - bh / 2}"/>`;
  }
  const [ff, ft] = fb;
  { const A = P(ff), B = P(ft);
    if (ff === ft) s += `<path d="M${A.x + bw / 2} ${A.y} h8 v${-bh / 2 - 8} h${-bw / 2 - 8} v8"/>`;
    else s += `<path d="M${A.x + bw / 2} ${A.y} h10 V${B.y - bh / 2 - 8} H${B.x} v8"/>`; }
  const cx = car.map(c => P(c).x), by = height - 10;
  s += `<line class="bus" x1="${Math.min(...cx)}" y1="${by}" x2="${Math.max(...cx)}" y2="${by}"/>`;
  for (const c of car) { const A = P(c); s += `<line x1="${A.x}" y1="${A.y + bh / 2}" x2="${A.x}" y2="${by}"/>`; }
  for (let i = 1; i <= 6; i++) {
    const A = P(i);
    s += `<g class="op${car.includes(i) ? ' car' : ''}"><rect x="${A.x - bw / 2}" y="${A.y - bh / 2}" width="${bw}" height="${bh}" rx="3"/><text x="${A.x}" y="${A.y}">${i}</text></g>`;
  }
  s += '</svg>';
  box.innerHTML = `<p class="help" style="margin:0 0 6px">Algorithm ${Math.round(vals.alg)} — carriers (filled) feed the output bus; the loop marks operator feedback.</p>` + s;
}

/* ---------------------------------------------------------- keyboard */
const KEYMAP = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16, "'": 17 };
const KEYLAB = Object.fromEntries(Object.entries(KEYMAP).map(([k, v]) => [v, k]));
const NOTE = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const isBlack = n => [1, 3, 6, 8, 10].includes(n % 12);
const keyEls = new Map();
let kbLo = 48;
function buildKeys() {
  const el = $('#keys');
  el.innerHTML = ''; keyEls.clear();
  const w = el.clientWidth || window.innerWidth;
  const octs = w < 430 ? 2 : w < 700 ? 3 : w < 1050 ? 4 : 5;
  kbLo = clamp(60 + 12 * octave - 12 * Math.floor((octs - 1) / 2), 0, 108);
  const hi = Math.min(127, kbLo + octs * 12);
  let nW = 0; for (let n = kbLo; n <= hi; n++) if (!isBlack(n)) nW++;
  const ww = 100 / nW, bw = ww * 0.62;
  let wi = 0;
  const comp = 60 + 12 * octave;
  for (let n = kbLo; n <= hi; n++) {
    const k = h('div', 'key ' + (isBlack(n) ? 'b' : 'w'));
    k.dataset.n = n;
    if (isBlack(n)) { k.style.left = `calc(${wi * ww - bw / 2}% )`; k.style.width = bw + '%'; }
    else { k.style.left = wi * ww + '%'; k.style.width = `calc(${ww}% + 1px)`; wi++; if (n % 12 === 0) k.append(h('span', 'nm', 'C' + (n / 12 - 1))); }
    const kl = KEYLAB[n - comp];
    if (kl && w > 600) k.append(h('span', 'kb', kl));
    if (down.has(n)) k.classList.add('down');
    keyEls.set(n, k);
    el.append(k);
  }
  $('#octv').textContent = 'Oct ' + (octave > 0 ? '+' : '') + octave;
}
function keyVis(n, on) { const k = keyEls.get(n); if (k) k.classList.toggle('down', on); }
function keyAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const k = el && el.closest && el.closest('.key');
  return k ? +k.dataset.n : null;
}
function velAt(y, n) {
  const k = keyEls.get(n); if (!k) return settings.vel / 127;
  const r = k.getBoundingClientRect();
  return clamp(0.3 + 0.75 * (y - r.top) / r.height, 0.05, 1);
}
const ptrs = new Map();
function initKeys() {
  const el = $('#keys');
  el.addEventListener('pointerdown', e => {
    e.preventDefault();
    const n = keyAt(e.clientX, e.clientY); if (n == null) return;
    el.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, n);
    noteOn(n, velAt(e.clientY, n));
  });
  el.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    const n = keyAt(e.clientX, e.clientY), o = ptrs.get(e.pointerId);
    if (n === o) return;
    if (o != null && ![...ptrs.entries()].some(([id, v]) => id !== e.pointerId && v === o)) noteOff(o);
    ptrs.set(e.pointerId, n);
    if (n != null) noteOn(n, velAt(e.clientY, n));
  });
  const end = e => {
    if (!ptrs.has(e.pointerId)) return;
    const o = ptrs.get(e.pointerId); ptrs.delete(e.pointerId);
    if (o != null && ![...ptrs.values()].includes(o)) noteOff(o);
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
  el.addEventListener('contextmenu', e => e.preventDefault());

  const held = new Map();
  window.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'SELECT' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') { panic(); return; }
    if (e.repeat) { if (k in KEYMAP || k === ' ') e.preventDefault(); return; }
    if (k === 'z') { setOctave(octave - 1); return; }
    if (k === 'x') { setOctave(octave + 1); return; }
    if (k === 'c') { setVel(settings.vel - 16); return; }
    if (k === 'v') { setVel(settings.vel + 16); return; }
    if (k === ' ') { e.preventDefault(); setSustain(!sustain); return; }
    if (k in KEYMAP) {
      e.preventDefault();
      const n = 60 + 12 * octave + KEYMAP[k];
      held.set(k, n);
      noteOn(n, settings.vel / 127);
    }
  });
  window.addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    if (held.has(k)) { noteOff(held.get(k)); held.delete(k); }
  });
  window.addEventListener('blur', () => { for (const n of held.values()) noteOff(n); held.clear(); });
}
function setOctave(o) {
  octave = clamp(o, -3, 3);
  buildKeys();
}
function setVel(v) {
  settings.vel = clamp(Math.round(v), 1, 127);
  $('#vel').value = settings.vel; $('#velv').textContent = settings.vel;
  persist();
}

/* ------------------------------------------------------------ wheels */
function wheel(id, spring, onChange) {
  const el = $('#' + id), slot = el.querySelector('.slot'), th = el.querySelector('.thumb');
  let val = spring ? 0.5 : 0;
  const draw = () => { th.style.top = `calc(${(1 - val).toFixed(4)} * (100% - 26px))`; };
  draw();
  const set = (v, send = true) => { val = clamp(v, 0, 1); draw(); if (send) onChange(val); };
  slot.addEventListener('pointerdown', e => {
    e.preventDefault(); slot.setPointerCapture(e.pointerId);
    const r = slot.getBoundingClientRect();
    const at = ev => set(1 - (ev.clientY - r.top - 13) / (r.height - 26));
    at(e);
    const mv = ev => at(ev);
    const up = () => {
      slot.removeEventListener('pointermove', mv); slot.removeEventListener('pointerup', up); slot.removeEventListener('pointercancel', up);
      if (spring) set(0.5);
    };
    slot.addEventListener('pointermove', mv); slot.addEventListener('pointerup', up); slot.addEventListener('pointercancel', up);
  });
  return set;
}
let setBendUI, setModUI;

/* -------------------------------------------------------------- MIDI */
let midiInit = false;
async function initMIDI() {
  if (midiInit || !navigator.requestMIDIAccess) {
    if (!navigator.requestMIDIAccess) $('#midi').textContent = 'MIDI: not supported in this browser';
    return;
  }
  midiInit = true;
  try {
    const m = await navigator.requestMIDIAccess();
    const hook = () => {
      const names = [];
      for (const inp of m.inputs.values()) { inp.onmidimessage = onMIDI; names.push(inp.name); }
      $('#midi').textContent = names.length ? 'MIDI: ' + names.join(', ') : 'MIDI: no devices';
    };
    hook(); m.onstatechange = hook;
  } catch {
    $('#midi').textContent = 'MIDI: permission denied';
  }
}
function onMIDI(e) {
  const [st, d1, d2] = e.data, cmd = st & 0xf0;
  if (cmd === 0x90 && d2 > 0) noteOn(d1, d2 / 127);
  else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) noteOff(d1);
  else if (cmd === 0xb0) {
    if (d1 === 1) { post({ t: 'wheel', v: d2 / 127 }); setModUI(d2 / 127, false); }
    else if (d1 === 64) setSustain(d2 >= 64);
    else if (d1 === 120 || d1 === 123) panic();
  } else if (cmd === 0xe0) {
    const v = ((d2 << 7) | d1) / 8192 - 1;
    post({ t: 'bend', v }); setBendUI((v + 1) / 2, false);
  } else if (cmd === 0xd0) post({ t: 'at', v: d1 / 127 });
}

/* ------------------------------------------------------------- scope */
let scopeMode = 'wave';
const td = new Float32Array(8192), fd = new Float32Array(4096);
function drawScope() {
  requestAnimationFrame(drawScope);
  const cv = $('#scope'), dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#07090a'; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(124,255,181,0.07)'; g.lineWidth = 1;
  for (let i = 1; i < 10; i++) { const x = Math.round(W * i / 10) + 0.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let i = 1; i < 6; i++) { const y = Math.round(H * i / 6) + 0.5; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.strokeStyle = '#7cffb5'; g.lineWidth = 1.6; g.shadowColor = 'rgba(124,255,181,0.6)'; g.shadowBlur = 6;
  g.beginPath();
  if (!an) { g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke(); g.shadowBlur = 0; return; }
  if (scopeMode === 'wave') {
    an.getFloatTimeDomainData(td);
    const span = Math.min(2048, Math.round(an.context.sampleRate * 0.025));
    let t0 = 0;
    for (let i = 1; i < 4096; i++) if (td[i - 1] <= 0 && td[i] > 0) { t0 = i; break; }
    for (let i = 0; i < span; i++) {
      const x = i / (span - 1) * W, y = H / 2 - td[t0 + i] * H * 0.45;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
  } else {
    an.getFloatFrequencyData(fd);
    const ny = an.context.sampleRate / 2, n = fd.length, lo = Math.log(20), hi = Math.log(Math.min(ny, 24000));
    for (let px = 0; px <= W; px += 1) {
      const f = Math.exp(lo + (hi - lo) * px / W), bin = Math.min(n - 1, Math.round(f / ny * n));
      const db = Math.max(-130, fd[bin]);
      const y = H * (-db / 130);
      px ? g.lineTo(px, y) : g.moveTo(px, y);
    }
    g.stroke(); g.shadowBlur = 0;
    g.fillStyle = 'rgba(124,255,181,0.45)'; g.font = '10px JetBrains Mono, monospace';
    for (const f of [100, 1000, 10000]) { const x = (Math.log(f) - lo) / (hi - lo) * W; g.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), x + 3, H - 6); }
    for (const d of [-30, -60, -90, -120]) g.fillText(d + ' dB', 6, H * (-d / 130) - 3);
    return;
  }
  g.stroke(); g.shadowBlur = 0;
}

/* -------------------------------------------------------------- boot */
function boot() {
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  defs.setAttribute('width', 0); defs.setAttribute('height', 0); defs.style.position = 'absolute';
  defs.innerHTML = '<defs><radialGradient id="knobShine" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity="0.22"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.04"/><stop offset="1" stop-color="#000" stop-opacity="0.25"/></radialGradient></defs>';
  document.body.prepend(defs);

  vals = loadVals(model);
  renderNav(); renderPanel(); buildKeys(); initKeys();

  $('#power').onclick = () => (ctx ? powerOff() : powerOn().catch(() => {}));
  const sr = $('#sr'), os = $('#os'), drift = $('#drift'), master = $('#master'), vel = $('#vel');
  sr.value = String(settings.sr); os.value = String(settings.os); drift.value = settings.drift; master.value = settings.master;
  vel.value = settings.vel; $('#velv').textContent = settings.vel;
  sr.onchange = async () => { settings.sr = +sr.value; persist(); if (ctx) { await powerOff(); powerOn().catch(() => {}); } };
  os.onchange = () => { settings.os = +os.value; persist(); post({ t: 'os', v: settings.os }); rateText(); };
  drift.oninput = () => { settings.drift = +drift.value; persist(); queuePatch(); };
  master.oninput = () => { settings.master = +master.value; persist(); if (gain) gain.gain.setTargetAtTime(settings.master, ctx.currentTime, 0.02); };
  vel.oninput = () => setVel(+vel.value);
  $('#octdn').onclick = () => setOctave(octave - 1);
  $('#octup').onclick = () => setOctave(octave + 1);
  $('#panic').onclick = panic;
  $('#hold').onclick = () => setSustain(!sustain);
  setBendUI = wheel('bend', true, v => post({ t: 'bend', v: v * 2 - 1 }));
  setModUI = wheel('modw', false, v => post({ t: 'wheel', v }));
  for (const b of document.querySelectorAll('.scope-ctl button')) {
    b.onclick = () => { scopeMode = b.dataset.mode; for (const x of document.querySelectorAll('.scope-ctl button')) x.classList.toggle('on', x === b); };
  }
  let rw;
  window.addEventListener('resize', () => { clearTimeout(rw); rw = setTimeout(buildKeys, 120); });
  window.addEventListener('hashchange', () => { const m = MODELS.find(x => '#' + x.id === location.hash); if (m) selectModel(m.id); });
  requestAnimationFrame(drawScope);
}
boot();
