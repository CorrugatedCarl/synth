// wtedit.js tests: pure helpers plus a headless run of the editor on a minimal fake DOM (spec §8.9, §9.9, §10.6).
// Run: node --test tests/wtedit.test.mjs
import './v8-guard.mjs';
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Imported before any DOM exists: the module must not touch document/window at top level (§0.1, §10.6).
const E = await import('../wtedit.js');
const W = await import('../wt.js');
const { memoryStore } = await import('../wtstore.js');
const { WTEditor, thumbLabel, UndoStack, changedFrames, fieldInfo, classifyFiles, loadFormulas, zipStore, crc32, tableBytes } = E;
const FRAME = 2048;

/* ================================================================== pure helpers */

test('thumbLabel: real frames at their 256-slot position after a morph', () => {
  const t = (R, morph) => ({ frames: Array.from({ length: R }, () => new Float32Array(FRAME)), morph });
  assert.deepEqual([0, 1, 2].map(k => thumbLabel(t(17, 1), k)), ['1', '17', '33']);
  assert.deepEqual([0, 1, 2].map(k => thumbLabel(t(17, 0), k)), ['1', '2', '3']);
  assert.equal(thumbLabel(t(2, 2), 1), '256');
  assert.equal(thumbLabel(t(256, 1), 5), '6');
  assert.equal(thumbLabel(t(1, 1), 0), '1');
});

test('UndoStack: 64 snapshots, byte cap, redo cleared by a new push', () => {
  const T = R => ({ frames: Array.from({ length: R }, () => new Float32Array(FRAME)) });
  const u = new UndoStack();
  for (let i = 0; i < 70; i++) u.push(T(1));
  assert.equal(u.u.length, 64);
  const b = new UndoStack(64, tableBytes(T(256)) * 3);
  for (let i = 0; i < 5; i++) b.push(T(256));
  assert.equal(b.u.length, 3);
  const s = new UndoStack(), a = T(1), c = T(1), d = T(1);
  s.push(a); s.push(c);
  assert.equal(s.undo(d), c);
  assert.equal(s.redo(c), d);
  assert.equal(s.undo(d), c);
  s.push(T(1));
  assert.equal(s.canRedo, false);
  assert.equal(new UndoStack().undo(a), null);
});

test('changedFrames, fieldInfo, classifyFiles, loadFormulas', () => {
  const f = Array.from({ length: 4 }, () => new Float32Array(FRAME));
  const a = { frames: f, morph: 0 }, b = { frames: f.slice(), morph: 0 };
  b.frames[2] = new Float32Array(FRAME);
  assert.deepEqual(changedFrames(a, b), [2]);
  assert.equal(changedFrames(a, { frames: f.slice(1), morph: 0 }), null);
  assert.equal(changedFrames(a, { frames: f, morph: 1 }), null);
  assert.deepEqual(fieldInfo(''), { kind: 'empty' });
  assert.deepEqual(fieldInfo(' 0 '), { kind: 'clear' });
  assert.equal(fieldInfo('A3').kind, 'split');
  assert.equal(fieldInfo('A3').split, 200);
  assert.match(fieldInfo('169').msg, /^split at: 169 samples/);
  assert.deepEqual(fieldInfo('sin(pi*x)'), { kind: 'formula', multi: false, usesQ: false });
  assert.equal(fieldInfo('q<y*255').multi, true);
  assert.equal(fieldInfo('(1+').kind, 'error');
  const c = classifyFiles([{ name: 'a.WAV' }, { name: 'b.png' }, { name: 'FolderInfo.txt' }, { name: 'c', type: 'audio/wav' }, { name: 'd.mp3' }]);
  assert.deepEqual([c.wavs.length, c.pngs.length, c.txts.length, c.other.length], [2, 1, 1, 1]);
  const st = new Map([['synth.sx.formulas', { singles: [{ name: 'a', src: 'x' }, { bad: 1 }], multis: 'nope' }]]);
  assert.deepEqual(loadFormulas({ get: (k, d) => (st.has(k) ? st.get(k) : d) }), { singles: [{ name: 'a', src: 'x' }], multis: [] });
  assert.deepEqual(loadFormulas(null), { singles: [], multis: [] });
});

test('zipStore: a valid store-only archive (signatures, CRC-32, names, data)', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  const files = [{ name: 'Saw 001.wav', data: new Uint8Array([1, 2, 3]) }, { name: 'Säge 002.wav', data: new Uint8Array(1000).fill(7).buffer }];
  const z = new Uint8Array(zipStore(files)), dv = new DataView(z.buffer);
  const eocd = z.length - 22;
  assert.equal(dv.getUint32(eocd, true), 0x06054b50);
  assert.equal(dv.getUint16(eocd + 10, true), 2);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (const f of files) {
    assert.equal(dv.getUint32(p, true), 0x02014b50);
    const n = dv.getUint16(p + 28, true), off = dv.getUint32(p + 42, true), size = dv.getUint32(p + 24, true);
    assert.equal(dec.decode(z.subarray(p + 46, p + 46 + n)), f.name);
    assert.equal(dv.getUint32(off, true), 0x04034b50);
    const ln = dv.getUint16(off + 26, true), data = z.subarray(off + 30 + ln, off + 30 + ln + size);
    assert.deepEqual(data, new Uint8Array(f.data));
    assert.equal(dv.getUint32(off + 14, true), crc32(data));
    p += 46 + n;
  }
});

/* ================================================================== fake DOM */

let NOW = 0;
class Ev {
  constructor(type, o = {}) {
    Object.assign(this, { bubbles: false, cancelable: false, isTrusted: false, button: 0, buttons: 0, clientX: 0, clientY: 0, shiftKey: false,
      altKey: false, ctrlKey: false, metaKey: false, pointerId: 1, pointerType: 'mouse', deltaX: 0, deltaY: 0, deltaMode: 0, key: '', timeStamp: NOW++ }, o);
    this.type = type; this.defaultPrevented = false; this._stop = false; this._imm = false; this.target = null;
  }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  stopPropagation() { this._stop = true; }
  stopImmediatePropagation() { this._stop = this._imm = true; }
}
class Tgt {
  constructor() { this._l = []; }
  addEventListener(t, fn, o) { const c = o === true || !!(o && o.capture); if (!this._l.some(x => x.t === t && x.fn === fn && x.c === c)) this._l.push({ t, fn, c }); }
  removeEventListener(t, fn, o) { const c = o === true || !!(o && o.capture); this._l = this._l.filter(x => !(x.t === t && x.fn === fn && x.c === c)); }
  dispatchEvent(ev) {
    ev.target = this;
    const path = [];
    for (let n = this; n; n = n._up()) path.push(n);
    const run = (n, cap) => { for (const x of n._l.slice()) { if (x.t !== ev.type || x.c !== cap) continue; x.fn.call(n, ev); if (ev._imm) break; } };
    for (let i = path.length - 1; i > 0 && !ev._stop; i--) run(path[i], true);
    if (!ev._stop) run(this, true);
    if (!ev._stop) run(this, false);
    if (ev.bubbles) for (let i = 1; i < path.length && !ev._stop; i++) run(path[i], false);
    return !ev.defaultPrevented;
  }
}
class Txt { constructor(t) { this.nodeType = 3; this.data = String(t); this.parentNode = null; } get textContent() { return this.data; } contains(n) { return n === this; } }
function ctx2d() {
  const store = { calls: 0 };
  return new Proxy(store, {
    get(t, k) { if (k in t) return t[k]; if (typeof k === 'symbol') return undefined; if (k === 'getImageData') return () => ({ width: 4, height: 8, data: new Uint8ClampedArray(128).fill(255) }); return () => { t.calls++; }; },
    set(t, k, v) { t[k] = v; return true; },
  });
}
class El extends Tgt {
  constructor(doc, tag) {
    super();
    this.ownerDocument = doc; this.localName = tag; this.tagName = tag.toUpperCase(); this.nodeType = 1;
    this.childNodes = []; this.parentNode = null; this._a = new Map(); this._rect = null; this.value = ''; this.dataset = {};
    this.scrollLeft = 0; this.files = null;
    this.style = { setProperty(k, v) { this[k] = v; }, getPropertyValue(k) { return this[k] || ''; } };
    const self = this, get = () => self.className.split(/\s+/).filter(Boolean), put = a => { self.className = a.join(' '); };
    this.classList = {
      add(...c) { const a = get(); for (const x of c) if (!a.includes(x)) a.push(x); put(a); },
      remove(...c) { put(get().filter(x => !c.includes(x))); },
      toggle(c, f) { const want = f === undefined ? !get().includes(c) : !!f; if (want) this.add(c); else this.remove(c); return want; },
      contains(c) { return get().includes(c); },
    };
  }
  _up() { return this.parentNode; }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  setAttribute(k, v) { this._a.set(k, String(v)); }
  getAttribute(k) { return this._a.has(k) ? this._a.get(k) : null; }
  hasAttribute(k) { return this._a.has(k); }
  removeAttribute(k) { this._a.delete(k); }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', v); }
  get tabIndex() { const v = this.getAttribute('tabindex'); return v == null ? -1 : +v; }
  set tabIndex(v) { this.setAttribute('tabindex', v); }
  get type() { return this.getAttribute('type') || ''; }
  set type(v) { this.setAttribute('type', v); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(v) { if (v) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) { for (const n of this.childNodes) n.parentNode = null; this.childNodes = v === '' || v == null ? [] : [new Txt(v)]; for (const n of this.childNodes) n.parentNode = this; }
  appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; }
  append(...ns) { for (const n of ns) this.appendChild(typeof n === 'string' ? new Txt(n) : n); }
  insertBefore(n, ref) { if (!ref) return this.appendChild(n); if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.splice(this.childNodes.indexOf(ref), 0, n); return n; }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; const d = this.ownerDocument; if (n.contains(d.activeElement)) d.activeElement = d.body; return n; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; }
  get isConnected() { return this.ownerDocument.documentElement.contains(this); }
  focus() { if (this.isConnected) this.ownerDocument._focus(this); }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument._focus(this.ownerDocument.body); }
  click() { this.dispatchEvent(new Ev('click', { bubbles: true, cancelable: true })); }
  select() {}
  getBoundingClientRect() { const r = this._rect || { left: 0, top: 0, width: 40, height: 40 }; return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height }; }
  get clientWidth() { return this._rect ? this._rect.width : 0; }
  get scrollWidth() { return 100000; }
  setPointerCapture() {}
  releasePointerCapture() {}
  getContext(kind) { return this.localName === 'canvas' && kind === '2d' ? this._ctx || (this._ctx = ctx2d()) : null; }
}
class Doc extends Tgt {
  constructor() {
    super();
    this.nodeType = 9;
    const win = this.defaultView = new (class extends Tgt { _up() { return null; } })();
    Object.assign(win, { innerWidth: 1280, innerHeight: 800, devicePixelRatio: 2, prompt: () => 'My formula', getComputedStyle: () => ({ getPropertyValue: () => '' }) });
    this.documentElement = this.createElement('html');
    this.documentElement.parentNode = this;
    this.head = this.createElement('head'); this.body = this.createElement('body');
    this.documentElement.append(this.head, this.body);
    this.activeElement = this.body;
  }
  _up() { return this.defaultView; }
  createElement(t) { return new El(this, t); }
  createElementNS(ns, t) { return new El(this, t); }
  getElementById(id) { return all(this.documentElement).find(n => n.id === id) || null; }
  _focus(el) { const prev = this.activeElement; if (prev === el) return; this.activeElement = el; if (prev && prev !== this.body) prev.dispatchEvent(new Ev('blur')); el.dispatchEvent(new Ev('focus')); }
}
const all = root => { const out = []; const walk = n => { out.push(n); for (const c of n.childNodes || []) if (c.nodeType === 1) walk(c); }; walk(root); return out; };
const one = (root, cls) => all(root).find(n => n.classList && n.classList.contains(cls)) || null;
const byLabel = (root, cls, text) => all(root).find(n => n.classList && n.classList.contains(cls) && n.textContent.trim() === text) || null;
const fire = (el, type, o = {}) => { const e = new Ev(type, Object.assign({ bubbles: true, cancelable: true }, o)); el.dispatchEvent(e); return e; };
const ptr = (el, type, x, y, o = {}) => fire(el, type, Object.assign({ clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1 }, o));
const place = (el, left, top, width, height) => { el._rect = { left, top, width, height }; return el; };
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

// Click a context-menu item by label (wk.contextMenu needs a pointerdown inside before it accepts a click).
function pick(doc, label) {
  const it = all(doc.body).find(n => n.classList && n.classList.contains('wk-ci') && one(n, 'wk-cl') && one(n, 'wk-cl').textContent === label);
  assert.ok(it, 'menu item “' + label + '”');
  fire(it, 'pointerdown');
  it.click();
}
function openMenu(ed, label) { const b = byLabel(ed.rootEl, 'wte-btn', label + ' ▾'); assert.ok(b, label); b.click(); }

/* ================================================================== headless editor */

function makeHost() {
  const store = memoryStore();
  const storage = new Map();
  const S = { osc: [{ wt: 'factory:Basic Shapes' }, { wt: 'factory:Sine' }], ui: { wtSel: [2, 0] }, noise: { src: 'noise:White' }, p: { 'n.on': 0 } };
  const log = { saveNew: [], update: [], edits: [], notes: [], saveNoise: [], downloads: [] };
  const host = {
    state: () => S,
    edit: (fn, o) => { fn(S); log.edits.push(o || {}); },
    notify: t => log.notes.push(t),
    storage: { get: (k, d) => (storage.has(k) ? JSON.parse(JSON.stringify(storage.get(k))) : d), set: (k, v) => storage.set(k, JSON.parse(JSON.stringify(v))) },
    wt: {
      get: async id => (/^(factory|sub):/.test(id) ? W.factoryTable(id) : store.get(id)),
      saveNew: async (t, name) => { const id = await store.put(t, { name }); log.saveNew.push({ id, name, R: t.frames.length }); return id; },
      update: (id, t, o) => { log.update.push({ id, R: t.frames.length, frames: o && o.frames ? o.frames.slice() : null, morph: t.morph }); store.put(t, { id, name: t.name }); },
      saveNoise: async (rec, name) => { const id = await store.put(rec, { name }); log.saveNoise.push({ id, name, len: rec.len }); return id; },
      rename: async (id, name) => store.rename(id, name),
    },
  };
  return { host, S, log, store, storage };
}

test('WTEditor headless: load, ops, copy-on-write, live updates, drawing, formulas, undo, reorder, import, export, close', async () => {
  const doc = new Doc();
  globalThis.document = doc;
  globalThis.MouseEvent = Ev;
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  try {
    const { host, S, log, storage } = makeHost();
    storage.set('synth.sx.wte', { binZoom: 128, waveZoom: 2, split: '' });
    const root = doc.createElement('div');
    doc.body.appendChild(root);
    let closed = 0;
    const ed = new WTEditor(root, { host, osc: 0, onClose: () => { closed++; ed.close(); } });
    ed.open();
    assert.ok(doc.getElementById('wte-css') && doc.getElementById('wk-css'), 'styles injected');
    assert.ok(one(root, 'wte-busy'), 'loading state');
    await settle();
    // loaded: Basic Shapes, frame 3 selected from ui.wtSel, zoom restored
    assert.equal(ed.table.frames.length, 6);
    assert.equal(ed.cur, 2);
    assert.equal(ed.prefs.binZoom, 128);
    assert.equal(ed.prefs.waveZoom, 2);
    assert.equal(one(root, 'wte-busy'), null);
    assert.equal(one(root, 'wte-name').value, 'Basic Shapes');
    assert.equal(one(root, 'wte-fnum').value, '3');
    const tools = all(root).filter(n => n.classList.contains('wte-tool'));
    assert.equal(tools.length, 13);
    assert.equal(tools[0].getAttribute('aria-checked'), 'true');
    for (const m of ['SINGLE', 'ALL', 'MORPH', 'REMOVE', 'SORT', 'IMPORT', 'EXPORT', 'TABLE']) assert.ok(byLabel(root, 'wte-btn', m + ' ▾'), m);
    // the touch modifier bar is always built; hidden (CSS) until touch mode — no coarse pointer, no touch seen yet
    const mk = one(root, 'wte-mk');
    assert.ok(mk && mk.classList.contains('wk-mkeys'));
    assert.deepEqual(all(mk).filter(n => n.getAttribute && n.getAttribute('data-mod')).map(n => n.getAttribute('data-mod')), ['shift', 'alt']);
    assert.equal(ed.rootEl.classList.contains('wte-touch'), false);
    assert.match(doc.getElementById('wte-css').textContent, /\.wte-root:not\(\.wte-touch\) \.wte-mk \{ display: none; \}/);
    const [fftCv, waveCv] = all(root).filter(n => n.localName === 'canvas' && n.classList.contains('wte-cv'));
    place(fftCv, 0, 0, 512, 160); place(waveCv, 0, 200, 1024, 206); place(ed.strip, 0, 500, 300, 60);
    ed.invalidate();
    assert.ok(waveCv._ctx.calls > 0 && fftCv._ctx.calls > 0 && ed.thCv._ctx.calls > 0, 'canvases painted');

    // a Single op through the menu: copy-on-write (one saveNew "<name> *", oscillator repointed), no update yet
    const orig = ed.table.frames[2];
    openMenu(ed, 'SINGLE');
    pick(doc, 'Flip Vertical');
    assert.equal(ed.table.frames[2][100], -orig[100]);
    assert.equal(ed.table.name, 'Basic Shapes *');
    await settle();
    assert.equal(log.saveNew.length, 1);
    assert.equal(log.saveNew[0].name, 'Basic Shapes *');
    assert.equal(S.osc[0].wt, log.saveNew[0].id);
    assert.equal(S.osc[1].wt, 'factory:Sine', 'only the edited oscillator is repointed');
    assert.ok(ed.owned);
    assert.equal(log.update.length, 0);

    // per-frame live updates, throttled to ≤ 30 Hz
    await ed.runOp('single.normalize');
    await ed.runOp('single.removeDC');
    assert.equal(log.update.length, 0);
    mock.timers.tick(34);
    assert.equal(log.update.length, 1);
    assert.deepEqual(log.update[0].frames, [2]);
    assert.equal(log.update[0].id, S.osc[0].wt);

    // drawing on the waveform (grid 4, flat line in the cell under the pointer)
    ed.setGrid(4);
    const id1 = S.osc[0].wt;
    ptr(waveCv, 'pointerdown', 100, 210);  // zoom 2 → x = 100/1024/2 ≈ 0.05 (cell 0), y near the top
    ptr(waveCv, 'pointermove', 120, 215);
    ptr(waveCv, 'pointerup', 120, 215);
    const fr = ed.table.frames[2];
    assert.ok(fr[10] > 0.9 && Math.abs(fr[10] - fr[500]) < 1e-9, 'cell filled');
    assert.notEqual(fr[600], fr[10]);
    mock.timers.tick(40);
    assert.deepEqual(log.update.at(-1).frames, [2]);
    assert.equal(S.osc[0].wt, id1, 'no second copy in the same session');
    assert.equal(log.saveNew.length, 1);
    // undo restores the pre-draw frame (full update)
    ed.doUndo();
    assert.notEqual(ed.table.frames[2][10], fr[10]);
    mock.timers.tick(40);
    assert.equal(log.update.at(-1).frames, null);
    ed.doRedo();
    assert.equal(ed.table.frames[2][10], fr[10]);

    // FFT area: drawing a magnitude bar edits the current frame's spectrum
    ed.setCur(0);
    const before = W.toSpectrum(ed.table.frames[0]).mag[9];
    const x10 = (9.5 / 128) * 512;                     // harmonic 10 at bin zoom 128
    ptr(fftCv, 'pointerdown', x10, 10);
    ptr(fftCv, 'pointerup', x10, 10);
    const after = W.toSpectrum(ed.table.frames[0]).mag[9];
    assert.ok(after > 0.5 && after > before + 0.4, `harmonic 10: ${before} → ${after}`);
    // FFT context menu: clear HF from the bin under the pointer
    fire(fftCv, 'contextmenu', { clientX: x10, clientY: 20 });
    pick(doc, 'Clear HF (bin 10 to end)');
    const Sp = W.toSpectrum(ed.table.frames[0]);
    assert.ok(Sp.mag[0] > 0.5 && Sp.mag.subarray(9).every(v => v < 1e-3), 'harmonics ≥ 10 cleared (float32 noise only), fundamental kept');

    // formula field: a single formula on the current frame, a multi formula on all 256
    const fx = one(root, 'wte-fx');
    fx.value = 'sin(pi*x)';
    fire(fx, 'input');
    fire(fx, 'keydown', { key: 'Enter' });
    assert.ok(Math.abs(ed.table.frames[0][512] - Math.sin(Math.PI * (2 * 512 / FRAME - 1))) < 1e-6);
    fx.value = 'sin(pi*x*(1+6*y))';
    fire(fx, 'keydown', { key: 'Enter' });
    assert.equal(ed.table.frames.length, 256);
    assert.equal(one(root, 'wte-fcount').textContent, '/ 256');
    fx.value = 'sin(';
    fire(fx, 'input');
    assert.ok(fx.classList.contains('wte-bad'));
    const tb = ed.table;
    fire(fx, 'keydown', { key: 'Enter' });
    assert.equal(ed.table, tb, 'a bad formula changes nothing');
    assert.ok(one(root, 'wte-msg').classList.contains('wte-err'));
    // split size: held in the field and persisted for serum-ui display drops
    fx.value = 'A3';
    fire(fx, 'input');
    assert.equal(storage.get('synth.sx.wte').split, 'A3');
    assert.match(one(root, 'wte-msg').textContent, /200 samples/);
    fire(fx, 'keydown', { key: 'Enter' });
    assert.equal(ed.table, tb, 'a split size is not a formula');
    fx.value = '0';
    fire(fx, 'keydown', { key: 'Enter' });
    assert.equal(fx.value, '');
    assert.equal(storage.get('synth.sx.wte').split, '');
    // save a user formula, then reuse it from the presets menu
    fx.value = '-in';
    fire(fx, 'input');
    openMenu(ed, 'PRESETS');
    pick(doc, 'Save Formula…');
    assert.deepEqual(storage.get('synth.sx.formulas').singles, [{ name: 'My formula', src: '-in' }]);

    // add/remove and reorder
    ed.undo.clear();
    await ed.runOp('add.reduce', { n: 16 });
    assert.equal(ed.table.frames.length, 16);
    const firstTwo = [ed.table.frames[0], ed.table.frames[1]];
    ed.strip.scrollLeft = 0;
    ptr(ed.thCv, 'pointerdown', 10, 520);   // frame 0
    ptr(ed.thCv, 'pointermove', 60, 520);
    ptr(ed.thCv, 'pointermove', 133, 520);  // gap 3
    ptr(ed.thCv, 'pointerup', 133, 520);
    assert.equal(ed.table.frames[0], firstTwo[1], 'dragging frame 0 to gap 3 gives order 1, 2, 0, 3…');
    assert.equal(ed.table.frames[2], firstTwo[0]);
    assert.equal(ed.cur, 2);
    fire(ed.strip, 'keydown', { key: 'ArrowRight' });
    assert.equal(ed.cur, 3);
    fire(ed.strip, 'keydown', { key: 'ArrowRight', shiftKey: true });
    assert.deepEqual(ed.sel, [3, 4]);
    fire(ed.strip, 'keydown', { key: 'Delete' });
    assert.equal(ed.table.frames.length, 14);
    assert.equal(ed.cur, 3);
    ptr(ed.thCv, 'pointerdown', 10, 520);
    ptr(ed.thCv, 'pointerup', 10, 520);
    ptr(ed.thCv, 'pointerdown', 100, 520, { shiftKey: true });
    assert.deepEqual(ed.sel, [0, 2]);

    // spectral morph: full updates debounced 150 ms
    await ed.runOp('morph.spectral');
    assert.equal(ed.table.morph, 2);
    const n0 = log.update.length;
    mock.timers.tick(100);
    await ed.runOp('single.flipH');
    mock.timers.tick(100);
    assert.equal(log.update.length, n0, 'still debouncing');
    mock.timers.tick(60);
    assert.equal(log.update.length, n0 + 1);
    assert.equal(log.update.at(-1).frames, null);
    assert.equal(log.update.at(-1).morph, 2);

    // send to noise oscillator
    ed.setCur(1);
    await ed.runOp('single.toNoise');
    await settle();
    assert.equal(log.saveNoise.length, 1);
    assert.equal(log.saveNoise[0].len, FRAME);
    assert.equal(S.noise.src, log.saveNoise[0].id);
    assert.equal(S.p['n.on'], 1);
    assert.equal(S.noise.oneshot, 0, 'the sent cycle loops');
    assert.equal(S.noise.keytrack, 1, 'and follows the keyboard (§7.9: root pitch with keytrack on)');

    // exports (Blob downloads)
    const urls = [];
    doc.defaultView.URL = { createObjectURL: b => { urls.push(b); return 'blob:' + urls.length; }, revokeObjectURL() {} };
    const clicks = [];
    const origCreate = doc.createElement.bind(doc);
    doc.createElement = t => { const e = origCreate(t); if (t === 'a') e.click = () => clicks.push(e.download); return e; };
    openMenu(ed, 'EXPORT'); pick(doc, 'Export All as 32-bit WAV');
    openMenu(ed, 'EXPORT'); pick(doc, 'Export All as Single-Cycle Waves (.zip)');
    openMenu(ed, 'EXPORT'); pick(doc, 'Export All as 8-bit (.256)');
    doc.createElement = origCreate;
    assert.deepEqual(clicks, ['Basic Shapes.wav', 'Basic Shapes (single cycles).zip', 'Basic Shapes.256']);
    const back = W.readWav(await urls[0].arrayBuffer());
    assert.equal(back.ch[0].length, ed.table.frames.length * FRAME);
    assert.deepEqual(back.clm, { size: FRAME, morph: 2, factory: 0 });
    assert.equal((await urls[2].arrayBuffer()).byteLength, ed.table.frames.length * 256);

    // import (pitch avg): the table becomes a new user table named after the file; detected size goes to the field
    const sr = 44100, saw = Float32Array.from({ length: sr / 2 }, (_, i) => 0.7 * (1 - 2 * ((i * 220 / sr) % 1)));
    const wavBuf = W.writeWav({ sr, ch: [saw], bits: 16 });
    const file = { name: 'MySaw.wav', type: 'audio/wav', arrayBuffer: async () => wavBuf };
    await ed.importFiles([file], 'pitchAvg');
    await settle();
    assert.equal(ed.table.name, 'MySaw');
    assert.ok(ed.table.frames.length >= 100);
    assert.ok(Math.abs(parseFloat(fx.value) - 200.45) < 1);
    assert.equal(log.saveNew.at(-1).name, 'MySaw');
    assert.equal(S.osc[0].wt, log.saveNew.at(-1).id);
    assert.match(one(root, 'wte-msg').textContent, /^split at: /);
    // thumbnail drop: replace one frame with a single cycle. A file with a clm chunk keeps its frame size even while
    // the field holds a split size (§9.9) …
    const sqF = W.factoryTable('factory:Square').frames[0];
    const one1 = W.writeWav({ sr, ch: [sqF], bits: 32, float: true, clm: { size: FRAME, morph: 0, factory: 0 } });
    await ed.importFiles([{ name: 'sq.wav', arrayBuffer: async () => one1 }], 'replace', 1);
    assert.deepEqual(ed.table.frames[1], sqF);
    // … a clm-less file is cut at the held split size (here the detected 200.45 samples): its middle cycle
    const sine = Float32Array.from({ length: 2406 }, (_, i) => Math.sin(2 * Math.PI * i / 200.45));
    await ed.importFiles([{ name: 'sine.wav', arrayBuffer: async () => W.writeWav({ sr, ch: [sine], bits: 32, float: true }) }], 'replace', 1);
    const sf = ed.table.frames[1];
    let dot = 0, n1 = 0;
    for (let i = 0; i < FRAME; i++) { const r = Math.sin(2 * Math.PI * i / FRAME); dot += sf[i] * r; n1 += sf[i] * sf[i]; }
    assert.ok(dot / Math.sqrt(n1 * FRAME / 2) > 0.9999, 'one sine cycle cut at the split size');
    // … and without a split size a 2048-sample file is that frame
    fx.value = '';
    fire(fx, 'input');
    await ed.importFiles([{ name: 'sq2.wav', arrayBuffer: async () => W.writeWav({ sr, ch: [sqF], bits: 32, float: true }) }], 'replace', 1);
    assert.deepEqual(ed.table.frames[1], sqF);
    // drop zones appear while files are dragged over the editor
    const dt = { types: ['Files'], files: [] };
    fire(ed.rootEl, 'dragenter', { dataTransfer: dt });
    assert.ok(one(root, 'wte-drop').classList.contains('wte-on'));
    assert.deepEqual(all(root).filter(n => n.classList.contains('wte-zone')).map(z => z.textContent), ['Pitch Avg', 'Zero-Snap', 'Pitch Follow', 'FFT 1024']);
    fire(ed.rootEl, 'dragleave', { dataTransfer: dt });
    assert.ok(!one(root, 'wte-drop').classList.contains('wte-on'));

    // UI-only selection writes go through host.edit({ui: true})
    assert.ok(log.edits.some(o => o.ui === true));
    assert.ok(S.ui.wtSel[0] >= 0);

    // Escape in a text field only leaves the field; Escape on the editor closes it (flushing pending updates)
    fx.focus();
    fire(fx, 'keydown', { key: 'Escape' });
    assert.equal(closed, 0);
    await ed.runOp('single.flipV');
    const nu = log.update.length;
    fire(ed.rootEl, 'keydown', { key: 'Escape' });
    assert.equal(closed, 1);
    assert.equal(log.update.length, nu + 1, 'close flushes the pending update');
    assert.equal(root.childNodes.length, 0);
    ed.close();
    assert.equal(closed, 1, 'close is idempotent');
    assert.equal(all(doc.body).filter(n => n.classList && n.classList.contains('wk-ctx')).length, 0, 'no menu left open');
  } finally {
    mock.timers.reset();
    delete globalThis.document;
    delete globalThis.MouseEvent;
  }
});

test('WTEditor headless: missing user table falls back to a copy of the default; edits before load are ignored', async () => {
  const doc = new Doc();
  globalThis.document = doc;
  globalThis.MouseEvent = Ev;
  try {
    const { host, S } = makeHost();
    S.osc[1].wt = 'user:missing';
    const root = doc.createElement('div');
    doc.body.appendChild(root);
    const ed = new WTEditor(root, { host, osc: 1 });
    ed.open();
    await ed.runOp('single.flipV'); // nothing loaded yet: no-op
    await settle();
    assert.equal(ed.table.frames.length, 1);
    assert.match(one(root, 'wte-msg').textContent, /not available/);
    assert.equal(root.firstChild.getAttribute('aria-label'), 'Wavetable editor, OSC B');
    ed.close();
    assert.equal(root.childNodes.length, 0);
  } finally {
    delete globalThis.document;
    delete globalThis.MouseEvent;
  }
});

async function openEd(doc, mod) {
  const env = makeHost();
  if (mod) mod(env);
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  const ed = new WTEditor(root, { host: env.host, osc: 0 });
  ed.open();
  await settle();
  const [fftCv, waveCv] = all(root).filter(n => n.localName === 'canvas' && n.classList.contains('wte-cv'));
  place(fftCv, 0, 0, 512, 160); place(waveCv, 0, 200, 1024, 206); place(ed.strip, 0, 500, 300, 60);
  ed.setZoom(1);
  return Object.assign(env, { ed, root, fftCv, waveCv });
}

test('WTEditor headless: pointercancel, undo and frame changes mid-stroke, tooltips on close, copy-on-write race, FFT phases', async () => {
  const doc = new Doc();
  globalThis.document = doc;
  globalThis.MouseEvent = Ev;
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  try {
    { // a touch pan on the thumbnail strip ends in pointercancel: never a reorder
      const { ed } = await openEd(doc);
      const before = ed.table.frames.slice();
      ptr(ed.thCv, 'pointerdown', 10, 520, { pointerType: 'touch' });
      ptr(ed.thCv, 'pointermove', 40, 520, { pointerType: 'touch' });
      ptr(ed.thCv, 'pointermove', 140, 520, { pointerType: 'touch' });
      fire(ed.thCv, 'pointercancel', { clientX: 140, clientY: 520, pointerType: 'touch' });
      assert.deepEqual(ed.table.frames, before);
      assert.equal(ed.g, null);
      // a cancelled waveform stroke keeps what was drawn, as one undo step
      const f0 = ed.table.frames[ed.cur];
      ptr(ed.waveCv, 'pointerdown', 100, 210);
      ptr(ed.waveCv, 'pointermove', 300, 210);
      fire(ed.waveCv, 'pointercancel', { clientX: 300, clientY: 210 });
      assert.equal(ed.g, null);
      assert.notEqual(ed.table.frames[ed.cur], f0);
      ed.doUndo();
      assert.equal(ed.table.frames[ed.cur], f0);
      ed.close();
    }
    { // Ctrl+Z mid-stroke reverts the stroke (history intact); redo and strip keys are ignored until the stroke ends
      const { ed } = await openEd(doc);
      await ed.runOp('single.flipV');
      const flipped = ed.table.frames[ed.cur];
      ed.setTool('slopeUp');
      ptr(ed.waveCv, 'pointerdown', 100, 210);
      ptr(ed.waveCv, 'pointermove', 400, 210);
      assert.notEqual(ed.table.frames[ed.cur], flipped);
      fire(ed.rootEl, 'keydown', { key: 'y', ctrlKey: true });
      fire(ed.strip, 'keydown', { key: 'Delete' });
      assert.equal(ed.table.frames.length, 6, 'no frame removed mid-stroke');
      fire(ed.rootEl, 'keydown', { key: 'z', ctrlKey: true });
      assert.equal(ed.table.frames[ed.cur], flipped, 'stroke reverted');
      ptr(ed.waveCv, 'pointermove', 700, 210);
      ptr(ed.waveCv, 'pointerup', 700, 210);
      assert.equal(ed.table.frames[ed.cur], flipped, 'moves after the cancel draw nothing');
      ed.doUndo();
      assert.deepEqual(ed.table.frames[ed.cur], W.factoryTable('factory:Basic Shapes').frames[ed.cur], 'the flip is still undoable');
      ed.close();
    }
    { // a stroke stays on the frame it started on, even if the current frame changes meanwhile
      const { ed } = await openEd(doc);
      ed.setTool('halfPeak');
      const c0 = ed.cur, next = ed.table.frames[c0 + 1];
      ptr(ed.waveCv, 'pointerdown', 100, 210);
      ptr(ed.waveCv, 'pointermove', 300, 210);
      ed.setCur(c0 + 1);
      ptr(ed.waveCv, 'pointermove', 400, 210);
      ptr(ed.waveCv, 'pointerup', 400, 210);
      assert.equal(ed.table.frames[c0 + 1], next, 'the other frame is untouched');
      assert.notEqual(ed.table.frames[c0], W.factoryTable('factory:Basic Shapes').frames[c0]);
      // FFT drawing into empty bins of a sine-phase frame: new harmonics get sine phase (ph 0.5)
      ed.setCur(0); // Basic Shapes frame 1 = sine
      const x = k => (k - 0.5) / 512 * 512;
      ptr(ed.fftCv, 'pointerdown', x(2), 20);
      ptr(ed.fftCv, 'pointermove', x(5), 20);
      ptr(ed.fftCv, 'pointerup', x(5), 20);
      const S = W.toSpectrum(ed.table.frames[0]);
      for (let k = 2; k <= 5; k++) {
        assert.ok(S.mag[k - 1] > 0.3, 'harmonic ' + k + ' drawn');
        assert.ok(Math.abs(S.ph[k - 1] - 0.5) < 1e-4, `harmonic ${k} phase ${S.ph[k - 1]}`);
      }
      ed.close();
    }
    { // tooltips: a shown tip and a pending one are both gone once the editor closes
      const { ed, root } = await openEd(doc);
      const tool = all(root).find(n => n.classList && n.classList.contains('wte-tool'));
      fire(tool, 'pointerenter', { bubbles: false, pointerType: 'mouse' });
      mock.timers.tick(500);
      const tip = doc.getElementById('wk-tip');
      assert.ok(tip && tip.classList.contains('wk-show'), 'tip shown');
      fire(ed.rootEl, 'keydown', { key: 'Escape' });
      assert.ok(ed.closed && !tip.classList.contains('wk-show'), 'hidden on close');
      const b = await openEd(doc), tool2 = all(b.root).find(n => n.classList && n.classList.contains('wte-tool'));
      fire(tool2, 'pointerenter', { bubbles: false, pointerType: 'mouse' });
      b.ed.close();
      mock.timers.tick(500);
      assert.ok(!tip.classList.contains('wk-show'), 'a pending tip never appears after close');
    }
    { // an import while the first copy-on-write save is pending becomes its own table; the copy keeps the edit
      const pending = [];
      const { ed, S, log, store } = await openEd(doc, env => {
        const real = env.host.wt.saveNew;
        env.host.wt.saveNew = (t, name) => (pending.length || env.log.saveNew.length ? real(t, name) : new Promise(res => pending.push(() => res(real(t, name)))));
      });
      await ed.runOp('single.flipV');
      await settle();
      assert.equal(pending.length, 1);
      const sr = 44100, saw = Float32Array.from({ length: sr / 2 }, (_, i) => 0.7 * (1 - 2 * ((i * 220 / sr) % 1)));
      const buf = W.writeWav({ sr, ch: [saw], bits: 16 });
      await ed.importFiles([{ name: 'MySaw.wav', arrayBuffer: async () => buf }], 'pitchAvg');
      const imported = ed.table;
      pending.shift()();
      await settle(20);
      assert.deepEqual(log.saveNew.map(x => [x.name, x.R]), [['Basic Shapes *', 6], ['MySaw', imported.frames.length]]);
      const first = await store.get(log.saveNew[0].id), second = await store.get(log.saveNew[1].id);
      assert.equal(first.name, 'Basic Shapes *');
      assert.equal(first.frames.length, 6);
      assert.equal(second.name, 'MySaw');
      assert.equal(S.osc[0].wt, log.saveNew[1].id, 'the oscillator plays the import');
      assert.equal(ed.id, log.saveNew[1].id);
      ed.close();
    }
  } finally {
    mock.timers.reset();
    delete globalThis.document;
    delete globalThis.MouseEvent;
  }
});

/* ================================================================== Phase 2 (SPEC-serum2 §13.13b, §11.13; inv B11) */

const wk5 = await import('../wk.js?v=7'); // the instance wtedit imports (its touch modifier latches)
const { channelFor, otherOscs, copyRange } = E;
const menuLabels = doc => all(doc.body).filter(n => n.classList && n.classList.contains('wk-cl')).map(n => n.textContent);
const menuItem = (doc, label) => all(doc.body).find(n => n.classList && n.classList.contains('wk-ci') && one(n, 'wk-cl') && one(n, 'wk-cl').textContent === label) || null;
const closeMenus = doc => fire(doc.body, 'pointerdown');
const specOf = f => W.toSpectrum(f);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);

test('Phase 2 pure helpers: channelFor (L → A/C, R → B), otherOscs, copyRange', () => {
  assert.deepEqual([0, 1, 2].map(o => channelFor(o, 2)), [0, 1, 0]);
  assert.deepEqual([0, 1, 2].map(o => channelFor(o, 1)), [0, 0, 0]);
  const s = { osc: [{ wt: 'factory:Sine' }, { wt: 'user:x', type: 'sample' }, { wt: 'factory:Square', type: 'wt' }] };
  assert.deepEqual(otherOscs(s, 0), [{ osc: 1, label: 'OSC B', id: 'user:x', ok: false }, { osc: 2, label: 'OSC C', id: 'factory:Square', ok: true }]);
  assert.deepEqual(otherOscs(s, 2).map(c => [c.label, c.ok]), [['OSC A', true], ['OSC B', false]]);
  assert.deepEqual(otherOscs({ osc: [{ wt: 'a' }, { wt: 'b' }] }, 1).map(c => c.label), ['OSC A'], 'a v1 state has two oscillators');
  assert.deepEqual(otherOscs(null, 0), []);
  const t = { frames: [0, 1, 2, 3, 4].map(i => new Float32Array(FRAME).fill(i)) };
  assert.deepEqual(copyRange(t, [3, 1]).map(f => f[0]), [1, 2, 3]);
  assert.equal(copyRange(t, [2, 2])[0], t.frames[2], 'frames are shared (immutable)');
  assert.deepEqual(copyRange(t, [-5, 99]).map(f => f[0]), [0, 1, 2, 3, 4]);
  assert.deepEqual(copyRange({ frames: [] }, [0, 0]), []);
});

test('WTEditor headless, Phase 2: OSC C, ALL ▸ other osc, REMOVE ▸ Reduce to, Randomize, Mirror, COPY/PASTE, FFT repeat + phase nudge, Frequency Estimation, stereo channels, EXPORT, TABLE, Switch OSC Type', async () => {
  const peakOf = f => f.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const doc = new Doc();
  globalThis.document = doc;
  globalThis.MouseEvent = Ev;
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  try {
    const { host, S, log, store } = makeHost();
    S.osc.push({ wt: 'factory:Default Shapes', type: 'wt' });
    S.osc[1].type = 'sample'; // OSC B plays a sample: no table to read
    S.ui.wtSel = [2, 0, 1];
    const imports = [];
    let nextId = 'smp:abc';
    host.smp = { import: async (files, o) => { imports.push({ n: files.length, name: files[0].name, o }); return nextId; } };
    const root = doc.createElement('div');
    doc.body.appendChild(root);
    let closed = 0;
    const ed = new WTEditor(root, { host, osc: 2, onClose: () => { closed++; } });
    ed.open();
    await settle();
    assert.equal(root.firstChild.getAttribute('aria-label'), 'Wavetable editor, OSC C');
    assert.equal(ed.table.frames.length, 9, 'Default Shapes');
    assert.equal(ed.cur, 1, 'ui.wtSel[2]');
    for (const m of ['SINGLE', 'ALL', 'MORPH', 'REMOVE', 'SORT', 'IMPORT', 'EXPORT', 'TABLE']) assert.ok(byLabel(root, 'wte-btn', m + ' ▾'), m);
    assert.equal(byLabel(root, 'wte-btn', 'PROCESS ▾'), null);
    assert.equal(byLabel(root, 'wte-btn', 'ADD/REMOVE ▾'), null);
    const [fftCv, waveCv] = all(root).filter(n => n.localName === 'canvas' && n.classList.contains('wte-cv'));
    place(fftCv, 0, 0, 512, 160); place(waveCv, 0, 200, 1024, 206); place(ed.strip, 0, 500, 300, 60);
    ed.setZoom(1);
    const orig = ed.table.frames.slice();

    // ALL ▸ Set Spectra from Other Osc ▸ OSC A (OSC B is a sample oscillator: disabled); the table is read on demand
    openMenu(ed, 'ALL');
    assert.ok(menuLabels(doc).includes('Remove Low Spectra (grid size)') && menuLabels(doc).includes('Shift Horizontal to Zero Crossing'));
    pick(doc, 'Set Spectra from Other Osc');
    assert.equal(menuItem(doc, 'OSC B').getAttribute('aria-disabled'), 'true');
    assert.equal(menuItem(doc, 'OSC C'), null, 'never this oscillator');
    pick(doc, 'OSC A');
    await settle(10);
    const s0 = specOf(ed.table.frames[0]); // frame 0 (saw) takes Basic Shapes frame 0's spectrum (a sine)
    assert.ok(s0.mag[0] > 0.5 && s0.mag[2] < 1e-3 * s0.mag[0], 'saw → only the fundamental');
    await settle();
    assert.equal(log.saveNew.length, 1, 'copy-on-write');
    assert.equal(S.osc[2].wt, log.saveNew[0].id);
    assert.equal(S.osc[0].wt, 'factory:Basic Shapes');
    ed.doUndo();
    assert.equal(ed.table.frames[0], orig[0]);

    // REMOVE ▸ Reduce to ▸ 4 frames: frames 0, 3, 5, 8 (evenly spaced, ends kept); the current frame follows
    ed.setCur(4);
    openMenu(ed, 'REMOVE');
    const rl = menuLabels(doc); // removal items only: Insert is the + button, Init All is in the TABLE menu
    assert.deepEqual(rl, ['Remove current index', 'Remove: multiselection', 'Remove: beginning→selected', 'Remove: selected→end', 'Remove: All (except selected)', 'Reduce', 'Reduce to']);
    pick(doc, 'Reduce to');
    assert.deepEqual(menuLabels(doc).slice(-4), ['2 frames', '4 frames', '8 frames', 'Other…']);
    pick(doc, '4 frames');
    await settle();
    assert.deepEqual(ed.table.frames, [orig[0], orig[3], orig[5], orig[8]]);
    assert.equal(ed.cur, 2);
    ed.doUndo();
    // SORT ▸ Randomize: a permutation
    openMenu(ed, 'SORT');
    pick(doc, 'Randomize');
    await settle();
    assert.equal(ed.table.frames.length, 9);
    assert.deepEqual(new Set(ed.table.frames), new Set(orig));
    ed.doUndo();
    assert.deepEqual(ed.table.frames, orig);

    // Mirror draw tool: the cell under the pointer and its point mirror about the frame centre
    const tools = all(root).filter(n => n.classList.contains('wte-tool'));
    assert.equal(tools.length, 13);
    const mirror = tools.find(b => b.dataset.tool === 'mirror');
    assert.equal(mirror.getAttribute('aria-label'), 'Mirror');
    mirror.click();
    assert.equal(ed.tool, 'mirror');
    ed.setCur(3);
    ed.setGrid(4);
    ptr(waveCv, 'pointerdown', 100, 210);
    ptr(waveCv, 'pointerup', 100, 210);
    const mf = ed.table.frames[3];
    assert.ok(mf[10] > 0.9 && mf[10] === mf[500], 'cell 0 filled');
    for (const i of [0, 10, 511]) assert.equal(mf[FRAME - 1 - i], -mf[i], 'mirrored sample ' + i);
    assert.equal(mf[1000], orig[3][1000], 'cells 1–2 untouched');
    ed.setGrid(0);
    ed.setTool('flat');

    // COPY / PASTE: the selection 0–2 pasted after the current frame (Cmd/Ctrl-V on the strip pastes again)
    ed.setCur(0);
    fire(ed.strip, 'keydown', { key: 'ArrowRight', shiftKey: true });
    fire(ed.strip, 'keydown', { key: 'ArrowRight', shiftKey: true });
    assert.deepEqual(ed.sel, [0, 2]);
    const copyB = byLabel(root, 'wte-btn', 'COPY'), pasteB = byLabel(root, 'wte-btn', 'PASTE');
    copyB.click();
    assert.match(one(root, 'wte-msg').textContent, /^Copied 3 frames/);
    assert.equal(pasteB.disabled, false);
    const pre = ed.table.frames.slice();
    await ed.pasteFrames();
    assert.equal(ed.table.frames.length, 12);
    for (let i = 0; i < 3; i++) assert.deepEqual(ed.table.frames[3 + i], pre[i]);
    assert.equal(ed.table.frames[6], pre[3]);
    assert.equal(ed.cur, 3); assert.deepEqual(ed.sel, [3, 5]);
    assert.equal(one(root, 'wte-msg').textContent, 'Pasted 3 frames');
    fire(ed.strip, 'keydown', { key: 'v', ctrlKey: true });
    await settle();
    assert.equal(ed.table.frames.length, 15);
    assert.deepEqual(ed.sel, [4, 6]);
    fire(ed.strip, 'keydown', { key: 'c', metaKey: true }); // copies the frames pasted last (5–7)
    assert.match(one(root, 'wte-msg').textContent, /^Copied 3 frames \(5–7\)/);

    // FFT ▸ Repeat Bin Group (start to the bin under the pointer), on the current frame; the repeated (sine-phase) bins
    // would line up into a +47 dB spike: the frame is scaled back to max(1, its previous peak)
    ed.setCur(0);
    const pk0 = peakOf(ed.table.frames[0]);
    fire(fftCv, 'contextmenu', { clientX: 2.5, clientY: 20 }); // harmonic 3, magnitude row
    assert.equal(menuItem(doc, 'Nudge Phase Right (harmonic 3)'), null, 'the magnitude row has no phase nudge');
    pick(doc, 'Repeat Bin Group (Start to Cursor Pos)');
    const rs = specOf(ed.table.frames[0]);
    for (const k of [4, 5, 6, 100, 101, 102]) assert.ok(Math.abs(rs.mag[k - 1] - rs.mag[(k - 1) % 3]) < 1e-4 * rs.mag[0], 'harmonic ' + k);
    assert.ok(Math.abs(peakOf(ed.table.frames[0]) - Math.max(1, pk0)) < 1e-6, 'peak ' + peakOf(ed.table.frames[0]));
    const unguarded = W.fftOp(specOf(orig[0]), 'mag', 'repeatGroup', { bin: 3 });
    assert.ok(peakOf(W.fromSpectrum(unguarded.mag, unguarded.ph, unguarded.dc)) > 100, 'wt.fftOp itself is unscaled');
    // Shift-Cmd/Ctrl-click on a phase bar nudges it right by 1/64; touch: the Shift + Alt latches
    const ph0 = specOf(ed.table.frames[0]).ph[0], frac = x => x - Math.floor(x);
    ptr(fftCv, 'pointerdown', 0.5, 140, { shiftKey: true, metaKey: true });
    assert.equal(ed.g, null, 'no drawing gesture');
    near(specOf(ed.table.frames[0]).ph[0], frac(ph0 + 1 / 64), 1e-4);
    const mb = wk5.modifierBar({ keys: ['shift', 'alt'] });
    for (const b of all(mb.el).filter(n => n.localName === 'button')) b.click();
    assert.deepEqual(mb.state(), { fine: 0, alt: 1, shift: 1 });
    ptr(fftCv, 'pointerdown', 0.5, 140, { pointerType: 'touch' });
    near(specOf(ed.table.frames[0]).ph[0], frac(ph0 + 2 / 64), 1e-4);
    assert.deepEqual(mb.state(), { fine: 0, alt: 0, shift: 0 }, 'latches released after the nudge');
    mb.destroy();
    assert.ok(ed.rootEl.classList.contains('wte-touch'), 'a touch inside the editor shows its modifier bar');
    // the menu equivalent (§13.1): the phase row's context menu
    fire(fftCv, 'contextmenu', { clientX: 0.5, clientY: 140 });
    assert.ok(menuLabels(doc).includes('Phases · harmonic 1'));
    pick(doc, 'Nudge Phase Right (harmonic 1)');
    near(specOf(ed.table.frames[0]).ph[0], frac(ph0 + 3 / 64), 1e-4);
    // macOS Shift-Ctrl-click: pointerdown nudges, the context menu that follows is swallowed (no menu, no second nudge)
    ptr(fftCv, 'pointerdown', 0.5, 140, { shiftKey: true, ctrlKey: true });
    const cx = fire(fftCv, 'contextmenu', { clientX: 0.5, clientY: 140, shiftKey: true, ctrlKey: true });
    assert.ok(cx.defaultPrevented);
    assert.equal(menuLabels(doc).length, 0, 'no menu');
    near(specOf(ed.table.frames[0]).ph[0], frac(ph0 + 4 / 64), 1e-4);
    // where Ctrl-click arrives as a right-button press (no nudging pointerdown), the context menu event nudges
    ptr(fftCv, 'pointerdown', 0.5, 140, { button: 2, shiftKey: true, ctrlKey: true });
    fire(fftCv, 'contextmenu', { clientX: 0.5, clientY: 140, shiftKey: true, ctrlKey: true });
    assert.equal(menuLabels(doc).length, 0);
    near(specOf(ed.table.frames[0]).ph[0], frac(ph0 + 5 / 64), 1e-4);
    ed.setCur(1); // Default Shapes frame 1: a sine
    const before = ed.table.frames[1];
    ptr(fftCv, 'pointerdown', 9.5, 140, { shiftKey: true, ctrlKey: true }); // harmonic 10 of a sine: empty
    assert.equal(ed.table.frames[1], before);
    assert.match(one(root, 'wte-msg').textContent, /Harmonic 10 is empty/);

    // IMPORT ▸ Frequency Estimation… (period → split-size field) and Switch OSC Type ▸ Sample/Granular/Spectral
    openMenu(ed, 'IMPORT');
    assert.ok(menuLabels(doc).includes('Frequency Estimation…'));
    pick(doc, 'Switch OSC Type');
    assert.deepEqual(menuLabels(doc).slice(-3), ['Sample…', 'Granular…', 'Spectral…']);
    closeMenus(doc);
    const sr = 44100, saw = Float32Array.from({ length: sr / 2 }, (_, i) => 0.7 * (1 - 2 * ((i * 220 / sr) % 1)));
    await ed.importFiles([{ name: 'Lead.wav', arrayBuffer: async () => W.writeWav({ sr, ch: [saw], bits: 16 }) }], 'freqEst');
    const fx = one(root, 'wte-fx');
    assert.ok(Math.abs(parseFloat(fx.value) - 200.45) < 0.5, fx.value);
    assert.match(one(root, 'wte-msg').textContent, /^split at: 200\.\d+ samples .*Lead/);
    // the period is in the file's own samples (what its import splits by); the pitch shown is at the file's rate
    const e1 = Float32Array.from({ length: 96000 }, (_, i) => 0.7 * Math.sin(2 * Math.PI * i * 41.2 / 48000)); // E1, P = 1165.05
    await ed.importFiles([{ name: 'Bass E1.wav', arrayBuffer: async () => W.writeWav({ sr: 48000, ch: [e1], bits: 16 }) }], 'freqEst');
    near(parseFloat(fx.value), 48000 / 41.2, 0.05, 'field');
    assert.match(one(root, 'wte-msg').textContent, /^split at: 1165\.0\d samples \(41\.20 Hz, E1 [+-] 0 cents\) — estimated from “Bass E1” \(48000 Hz\)$/);
    await ed.importFiles([{ name: 'Quiet.wav', arrayBuffer: async () => W.writeWav({ sr, ch: [new Float32Array(9000)], bits: 16 }) }], 'freqEst');
    assert.match(one(root, 'wte-msg').textContent, /no pitch detected in “Quiet” — split size cleared$/);
    assert.equal(fx.value, '', 'the previous file\'s split size is not kept for the next import');
    assert.equal(ed.prefs.split, '');
    fx.value = 'sin(pi*x)'; // a formula in the field stays
    fire(fx, 'input');
    await ed.importFiles([{ name: 'Quiet.wav', arrayBuffer: async () => W.writeWav({ sr, ch: [new Float32Array(9000)], bits: 16 }) }], 'freqEst');
    assert.equal(fx.value, 'sin(pi*x)');
    assert.match(one(root, 'wte-msg').textContent, /no pitch detected in “Quiet”$/);
    fx.value = '';
    fire(fx, 'input');

    // stereo files: OSC C imports the left channel (raw 2048 frames; thumbnail drop likewise)
    const L = new Float32Array(2 * FRAME).fill(0.25), R = new Float32Array(2 * FRAME).fill(0.5);
    await ed.importFiles([{ name: 'Stereo.wav', arrayBuffer: async () => W.writeWav({ sr, ch: [L, R], bits: 32, float: true }) }], 'pitchAvg');
    assert.equal(ed.table.frames.length, 2);
    assert.equal(ed.table.frames[0][7], 0.25);
    assert.match(one(root, 'wte-msg').textContent, /left channel/);
    const s1 = Float32Array.from({ length: FRAME }, (_, i) => Math.sin(2 * Math.PI * i / FRAME)), s3 = Float32Array.from({ length: FRAME }, (_, i) => Math.sin(6 * Math.PI * i / FRAME));
    await ed.importFiles([{ name: 'st.wav', arrayBuffer: async () => W.writeWav({ sr, ch: [s1, s3], bits: 32, float: true }) }], 'replace', 1);
    assert.deepEqual(ed.table.frames[1], s1);
    await settle();

    // EXPORT: All as 16-bit / 32-bit WAV, Single-Cycle Waves (ZIP), 8-bit .256, Selection
    openMenu(ed, 'EXPORT');
    assert.deepEqual(menuLabels(doc), ['Export All as 16-bit WAV', 'Export All as 32-bit WAV', 'Export All as Single-Cycle Waves (.zip)', 'Export All as 8-bit (.256)', 'Export Selection (frames 2)']);
    const urls = [], clicks = [];
    doc.defaultView.URL = { createObjectURL: b => { urls.push(b); return 'blob:' + urls.length; }, revokeObjectURL() {} };
    const origCreate = doc.createElement.bind(doc);
    doc.createElement = t => { const e = origCreate(t); if (t === 'a') e.click = () => clicks.push(e.download); return e; };
    pick(doc, 'Export All as 16-bit WAV');
    doc.createElement = origCreate;
    assert.deepEqual(clicks, ['Stereo (16-bit).wav']);
    const w16 = W.readWav(await urls[0].arrayBuffer());
    assert.equal(w16.bits, 16);
    assert.equal(w16.ch[0].length, 2 * FRAME);

    // TABLE ▸ Save Table… (a new named user table, the oscillator repointed) and Rename (focuses the name field)
    doc.defaultView.prompt = (msg, def) => (/Save/.test(msg) && def === 'Stereo' ? 'Bright Table' : null);
    openMenu(ed, 'TABLE');
    assert.deepEqual(menuLabels(doc), ['Save Table…', 'Rename', 'Init All']);
    pick(doc, 'Save Table…');
    await settle(20);
    assert.equal(log.saveNew.at(-1).name, 'Bright Table');
    assert.equal(S.osc[2].wt, log.saveNew.at(-1).id);
    assert.equal(ed.id, S.osc[2].wt);
    assert.equal(ed.table.name, 'Bright Table');
    assert.equal(one(root, 'wte-name').value, 'Bright Table');
    assert.equal((await store.get(S.osc[2].wt)).frames.length, 2);
    assert.match(one(root, 'wte-msg').textContent, /Saved “Bright Table”/);
    await ed.runOp('single.flipV'); // later edits go to the saved table (no new copy)
    mock.timers.tick(40);
    assert.equal(log.update.at(-1).id, S.osc[2].wt);
    openMenu(ed, 'TABLE');
    pick(doc, 'Rename');
    assert.equal(doc.activeElement, one(root, 'wte-name'));

    // Switch OSC Type: the dialog takes one single-sample audio file (no SFZ / ZIP, no multiple selection)
    ed.pickFiles('switch:sample');
    assert.equal(ed.fileInp.multiple, false);
    assert.ok(!/sfz|zip/.test(ed.fileInp.accept) && /\.wav/.test(ed.fileInp.accept) && /\.flac/.test(ed.fileInp.accept), ed.fileInp.accept);
    ed.fileInp.remove();
    ed.fileInp = null;
    // an SFZ (or ZIP) chosen anyway is refused before importing; a multisample id from the host is refused too (osc.smp
    // cannot hold one: §2.2.5) — the oscillator and the editor stay as they are
    S.osc[2].smpo = { ops: { fade: 3, norm: 1, rev: 1, trim: [0.5, 0.6] }, slice: { mode: 2, marks: [0.25] } };
    const nEdits = log.edits.length;
    await ed.importFiles([{ name: 'Piano.sfz' }], 'switch:sample');
    assert.equal(imports.length, 0);
    assert.match(one(root, 'wte-msg').textContent, /Multisample oscillator/);
    nextId = 'msmp:1234';
    await ed.importFiles([{ name: 'Odd.wav', arrayBuffer: async () => new ArrayBuffer(8) }], 'switch:sample');
    assert.equal(imports.length, 1);
    assert.match(one(root, 'wte-msg').textContent, /“Odd” is not a single sample/);
    assert.deepEqual([S.osc[2].type, S.osc[2].smp, log.edits.length, ed.closed], ['wt', undefined, nEdits, false]);
    // Switch OSC Type ▸ Granular…: host.smp.import (the first file only), then type + smp in one state edit with the
    // sample ops reset (as the panel's own loads: no trim / reverse / fades carried over), and the editor closes
    nextId = 'smp:abc';
    const nSave = log.saveNew.length;
    await ed.importFiles([{ name: 'Pad Loop.wav', arrayBuffer: async () => new ArrayBuffer(8) }, { name: 'Other.wav' }], 'switch:gran');
    assert.deepEqual(imports.at(-1), { n: 1, name: 'Pad Loop.wav', o: { kind: 'sample', osc: 2 } });
    assert.equal(S.osc[2].type, 'gran');
    assert.equal(S.osc[2].smp, 'smp:abc');
    assert.deepEqual(S.osc[2].smpo.ops, { fade: 0, norm: 0, rev: 0, trim: null });
    assert.deepEqual(S.osc[2].smpo.slice, { mode: 2, marks: [0.25] }, 'slice marks are the panel\'s (unchanged)');
    assert.equal(log.edits.at(-1).label, 'Switch OSC Type');
    assert.equal(closed, 1);
    assert.ok(ed.closed);
    assert.equal(log.saveNew.length, nSave);

    // another oscillator's editor (OSC B, no host.smp): pastes the page-wide clipboard, imports the right channel
    delete host.smp;
    const root2 = doc.createElement('div');
    doc.body.appendChild(root2);
    const ed2 = new WTEditor(root2, { host, osc: 1 });
    ed2.open();
    await settle();
    assert.equal(root2.firstChild.getAttribute('aria-label'), 'Wavetable editor, OSC B');
    assert.equal(ed2.table.frames.length, 1, 'factory:Sine');
    assert.equal(byLabel(root2, 'wte-btn', 'PASTE').disabled, false);
    await ed2.pasteFrames();
    assert.equal(ed2.table.frames.length, 4);
    openMenu(ed2, 'IMPORT');
    assert.equal(menuItem(doc, 'Switch OSC Type').getAttribute('aria-disabled'), 'true');
    closeMenus(doc);
    openMenu(ed2, 'ALL');
    pick(doc, 'Subtract Spectra from other Osc');
    assert.deepEqual(menuLabels(doc).slice(-2), ['OSC A', 'OSC C']);
    assert.equal(menuItem(doc, 'OSC C').getAttribute('aria-disabled'), 'true', 'OSC C is granular now');
    closeMenus(doc);
    await ed2.importFiles([{ name: 'Stereo.wav', arrayBuffer: async () => W.writeWav({ sr, ch: [L, R], bits: 32, float: true }) }], 'pitchAvg');
    assert.equal(ed2.table.frames[0][7], 0.5, 'OSC B imports the right channel');
    assert.match(one(root2, 'wte-msg').textContent, /right channel/);
    ed2.close();
  } finally {
    mock.timers.reset();
    delete globalThis.document;
    delete globalThis.MouseEvent;
  }
});

test('WTEditor headless, Phase 2: the name is tinted while the table is an automatic copy; right-click on it opens the table menu', async () => {
  const doc = new Doc();
  globalThis.document = doc;
  globalThis.MouseEvent = Ev;
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  try {
    const { ed, root, log, store } = await openEd(doc);
    // a right-button press as browsers do it: mousedown focuses the field unless prevented, then `contextmenu`
    const rightClick = (el, o = {}) => {
      const md = fire(el, 'mousedown', Object.assign({ button: 2 }, o));
      if (!md.defaultPrevented) el.focus();
      return fire(el, 'contextmenu', Object.assign({ button: 2, clientX: 50, clientY: 10 }, o));
    };
    const name = one(root, 'wte-name');
    assert.equal(name.classList.contains('wte-tint'), false);
    await ed.runOp('single.flipV');
    await settle();
    assert.equal(ed.table.name, 'Basic Shapes *');
    assert.ok(name.classList.contains('wte-tint'), 'unsaved copy');
    // undo keeps the copy's name (in the editor and in the store): only the frames go back
    const copyId = ed.id;
    ed.doUndo();
    mock.timers.tick(40);
    assert.equal(ed.table.name, 'Basic Shapes *');
    assert.ok(name.classList.contains('wte-tint'));
    assert.equal((await store.get(copyId)).name, 'Basic Shapes *');
    ed.doRedo();
    mock.timers.tick(40);
    const ev = rightClick(name);
    assert.ok(ev.defaultPrevented);
    assert.notEqual(doc.activeElement, name, 'the press did not focus the field');
    assert.deepEqual(menuLabels(doc), ['Save Table…', 'Rename', 'Init All']);
    doc.defaultView.prompt = () => 'Keeper';
    pick(doc, 'Save Table…');
    await settle(20);
    assert.equal(log.saveNew.at(-1).name, 'Keeper');
    assert.equal(name.classList.contains('wte-tint'), false, 'saved by name');
    assert.equal(doc.activeElement, ed.tableBtn, 'focus returns to the TABLE button, not the name field');
    // Save Table… then undo: the saved table keeps its name (the undo snapshots carry it)
    const keepId = ed.id;
    ed.doUndo();
    mock.timers.tick(40);
    assert.equal(log.update.at(-1).id, keepId);
    assert.equal(ed.table.name, 'Keeper');
    assert.equal((await store.get(keepId)).name, 'Keeper');
    assert.equal(name.value, 'Keeper');
    ed.doRedo();
    mock.timers.tick(40);
    assert.equal((await store.get(keepId)).name, 'Keeper');
    // macOS Ctrl-click on the unfocused field: the table menu as well
    const cc = rightClick(name, { button: 0, ctrlKey: true });
    assert.ok(cc.defaultPrevented);
    assert.ok(menuLabels(doc).includes('Rename'));
    closeMenus(doc);
    name.focus(); // while the name is being edited: the browser's own menu
    assert.equal(rightClick(name).defaultPrevented, false);
    assert.equal(menuLabels(doc).length, 0);
    // TABLE ▸ Init All (moved from the Phase-1 ADD/REMOVE menu)
    openMenu(ed, 'TABLE');
    pick(doc, 'Init All');
    assert.equal(ed.table.frames.length, 1);
    assert.equal(ed.table.name, 'Keeper');
    // touch mode seen earlier on the page (wk.touchMode): a new editor shows its modifier bar from the start
    assert.equal(wk5.touchMode(), true);
    const root2 = doc.createElement('div');
    doc.body.appendChild(root2);
    const ed2 = new WTEditor(root2, { host: ed.host, osc: 1 });
    ed2.open();
    assert.ok(ed2.rootEl.classList.contains('wte-touch'));
    ed2.close();
    ed.close();
  } finally {
    mock.timers.reset();
    delete globalThis.document;
    delete globalThis.MouseEvent;
  }
});
