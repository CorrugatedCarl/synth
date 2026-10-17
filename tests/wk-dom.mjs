// Minimal fake DOM for the E6 browser-module tests (wk.js, graph.js, fx-ui.js): exactly the surface those modules
// use — elements, SVG elements, attributes, classList, style, events with capture/target/bubble phases, focus,
// pointer capture, bounding rects, canvas 2D contexts (recording stubs) and a manual requestAnimationFrame queue.
// Not a test file itself (node --test only runs *.test.mjs).

const HTML = 'http://www.w3.org/1999/xhtml';
let NOW = 1000;
export const advance = ms => { NOW += ms; };

export class Ev {
  constructor(type, o = {}) {
    Object.assign(this, {
      bubbles: false, cancelable: false, isTrusted: false, button: 0, buttons: 0, clientX: 0, clientY: 0,
      shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, pointerId: 1, pointerType: 'mouse',
      deltaX: 0, deltaY: 0, deltaMode: 0, key: '', timeStamp: NOW,
    }, o);
    this.type = type;
    this.defaultPrevented = false;
    this._stop = false; this._imm = false;
    this.target = null; this.currentTarget = null;
  }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  stopPropagation() { this._stop = true; }
  stopImmediatePropagation() { this._stop = true; this._imm = true; }
}
class Tgt {
  constructor() { this._l = []; }
  addEventListener(t, fn, o) {
    const c = o === true || !!(o && o.capture);
    if (!this._l.some(x => x.t === t && x.fn === fn && x.c === c)) this._l.push({ t, fn, c });
  }
  removeEventListener(t, fn, o) {
    const c = o === true || !!(o && o.capture);
    this._l = this._l.filter(x => !(x.t === t && x.fn === fn && x.c === c));
  }
  listenerCount(t) { return this._l.filter(x => x.t === t).length; }
  dispatchEvent(ev) {
    ev.target = this;
    const path = [];
    for (let n = this; n; n = n._parent()) path.push(n);
    const run = (n, capture) => {
      ev.currentTarget = n;
      for (const x of n._l.slice()) {
        if (x.t !== ev.type || x.c !== capture) continue;
        x.fn.call(n, ev);
        if (ev._imm) break;
      }
    };
    for (let i = path.length - 1; i > 0 && !ev._stop; i--) run(path[i], true);
    if (!ev._stop) run(this, true);
    if (!ev._stop) run(this, false);
    if (ev.bubbles) for (let i = 1; i < path.length && !ev._stop; i++) run(path[i], false);
    ev.currentTarget = null;
    return !ev.defaultPrevented;
  }
}
class Txt {
  constructor(t) { this.nodeType = 3; this.data = String(t); this.parentNode = null; }
  get textContent() { return this.data; }
  contains(n) { return n === this; }
}
// Recording 2D context: every method call is appended to `calls`; property writes are kept.
function ctx2d(canvas) {
  const store = { calls: [], canvas };
  return new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return s => ({ width: String(s).length * 6 });
      if (typeof k === 'symbol') return undefined;
      return (...a) => { t.calls.push([k, ...a]); };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
export class El extends Tgt {
  constructor(doc, tag, ns) {
    super();
    this.ownerDocument = doc; this.localName = tag; this.tagName = tag.toUpperCase(); this.namespaceURI = ns;
    this.nodeType = 1; this.childNodes = []; this.parentNode = null; this._a = new Map(); this._rect = null; this._cap = null;
    this.value = '';
    const style = { setProperty(k, v) { this[k] = v; }, getPropertyValue(k) { return this[k] || ''; } };
    this.style = style;
    const self = this;
    const get = () => self.className.split(/\s+/).filter(Boolean), put = a => { self.className = a.join(' '); };
    this.classList = {
      add(...c) { const a = get(); for (const x of c) if (!a.includes(x)) a.push(x); put(a); },
      remove(...c) { put(get().filter(x => !c.includes(x))); },
      toggle(c, f) { const want = f === undefined ? !get().includes(c) : !!f; if (want) this.add(c); else this.remove(c); return want; },
      contains(c) { return get().includes(c); },
    };
  }
  _parent() { return this.parentNode; }
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
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(v) { if (v) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
  get title() { return this.getAttribute('title') || ''; }
  set title(v) { this.setAttribute('title', v); }
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) {
    for (const n of this.childNodes) n.parentNode = null;
    this.childNodes = v === '' || v == null ? [] : [new Txt(v)];
    for (const n of this.childNodes) n.parentNode = this;
  }
  appendChild(n) {
    if (n.parentNode) n.parentNode.removeChild(n);
    n.parentNode = this; this.childNodes.push(n);
    if (n.localName === 'script') this.ownerDocument.scripts.push(n);
    return n;
  }
  append(...ns) { for (const n of ns) this.appendChild(typeof n === 'string' ? new Txt(n) : n); }
  insertBefore(n, ref) {
    if (!ref) return this.appendChild(n);
    if (n.parentNode) n.parentNode.removeChild(n);
    n.parentNode = this; this.childNodes.splice(this.childNodes.indexOf(ref), 0, n);
    return n;
  }
  removeChild(n) {
    const i = this.childNodes.indexOf(n);
    if (i >= 0) this.childNodes.splice(i, 1);
    n.parentNode = null;
    const d = this.ownerDocument;
    if (n.contains(d.activeElement)) d.activeElement = d.body; // removal moves focus without blur (as Chrome)
    return n;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; }
  get isConnected() { return this.ownerDocument.documentElement.contains(this); }
  focus() { if (this.isConnected) this.ownerDocument._focus(this); }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument._focus(this.ownerDocument.body); }
  click() { this.dispatchEvent(new Ev('click', { bubbles: true, cancelable: true })); }
  select() { this._selected = true; }
  getBoundingClientRect() {
    const r = this._rect || { left: parseFloat(this.style.left) || 0, top: parseFloat(this.style.top) || 0, width: 40, height: 40 };
    return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top };
  }
  get clientWidth() { return this._off ? this._off.w : this._rect ? this._rect.width : 0; }
  get clientHeight() { return this._off ? this._off.h : this._rect ? this._rect.height : 0; }
  // the layout box (offsetWidth / -Height): the placed rect's size, or layout(el, w, h)'s — an element under a CSS
  // transform (the canvas world's scale k: rect = layout · k)
  get offsetWidth() { return this._off ? this._off.w : this._rect ? this._rect.width : 0; }
  get offsetHeight() { return this._off ? this._off.h : this._rect ? this._rect.height : 0; }
  setPointerCapture(id) { this._cap = id; }
  releasePointerCapture(id) { if (this._cap === id) this._cap = null; }
  getContext(kind) { if (this.localName !== 'canvas' || kind !== '2d') return null; return this._ctx || (this._ctx = ctx2d(this)); }
}
class Win extends Tgt {
  constructor() { super(); this.innerWidth = 1280; this.innerHeight = 800; this.devicePixelRatio = 1; }
  _parent() { return null; }
}
export class Doc extends Tgt {
  constructor() {
    super();
    this.nodeType = 9; this.defaultView = new Win(); this.baseURI = 'https://synth.test/app/index.html'; this.scripts = [];
    this.visibilityState = 'visible';
    this.documentElement = this.createElement('html');
    this.documentElement.parentNode = this;
    this.head = this.createElement('head'); this.body = this.createElement('body');
    this.documentElement.append(this.head, this.body);
    this.activeElement = this.body;
  }
  _parent() { return this.defaultView; }
  createElement(t) { return new El(this, t, HTML); }
  createElementNS(ns, t) { return new El(this, t, ns); }
  createTextNode(t) { return new Txt(t); }
  getElementById(id) { return all(this.documentElement).find(n => n.id === id) || null; }
  _focus(el) {
    const prev = this.activeElement;
    if (prev === el) return;
    this.activeElement = el;
    if (prev && prev !== this.body) prev.dispatchEvent(new Ev('blur'));
    el.dispatchEvent(new Ev('focus'));
  }
}
export function all(root) { const out = []; const walk = n => { out.push(n); for (const c of n.childNodes || []) if (c.nodeType === 1) walk(c); }; walk(root); return out; }
export const byCls = (root, c) => all(root).filter(n => n.classList.contains(c));
export const one = (root, c) => byCls(root, c)[0] || null;
export const byAttr = (root, k, v) => all(root).filter(n => n.getAttribute && n.getAttribute(k) === v);

// A fresh document installed as globalThis.document (also resets the rAF queue).
const rafQ = [];
let rafT = 0;
export function fresh() {
  const d = new Doc();
  globalThis.document = d;
  globalThis.MouseEvent = Ev;
  rafQ.length = 0;
  return d;
}
// Manual animation frames: install() makes requestAnimationFrame queue callbacks; flush(n, t0?) runs n rounds with
// timestamps t0, t0 + 40, … — without t0 an internal clock continues 40 ms per round (monotonic, as real frames).
export const raf = {
  install() {
    let id = 0;
    rafT = 0;
    globalThis.requestAnimationFrame = fn => { rafQ.push({ fn, id: ++id }); return id; };
    globalThis.cancelAnimationFrame = i => { const k = rafQ.findIndex(x => x.id === i); if (k >= 0) rafQ.splice(k, 1); };
  },
  uninstall() { delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame; rafQ.length = 0; },
  flush(rounds = 1, t0) {
    for (let r = 0; r < rounds; r++) {
      const t = t0 != null ? t0 + r * 40 : (rafT += 40), q = rafQ.splice(0);
      for (const x of q) x.fn(t);
    }
  },
  get pending() { return rafQ.length; },
};
export function fire(el, type, o = {}) { const e = new Ev(type, Object.assign({ bubbles: true, cancelable: true }, o)); el.dispatchEvent(e); return e; }
export function ptr(el, type, x, y, o = {}) {
  return fire(el, type, Object.assign({ clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1 }, o));
}
export const key = (el, k, o = {}) => fire(el, 'keydown', Object.assign({ key: k }, o));
export const setPlatform = p => Object.defineProperty(globalThis, 'navigator', { value: { platform: p }, configurable: true, writable: true });
// Places an element's box (getBoundingClientRect / clientWidth) for geometry-dependent tests.
export function place(el, left, top, width, height) { el._rect = { left, top, width, height }; return el; }
// An element's layout size apart from its screen rect (place): offsetWidth / -Height = w / h (a scaled ancestor).
export function layout(el, w, h) { el._off = { w, h }; return el; }
