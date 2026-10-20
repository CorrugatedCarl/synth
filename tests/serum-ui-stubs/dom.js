// A minimal fake DOM with selectors (tests/serum-ui.test.mjs's, shared since milestone 3: tests/sx-host.test.mjs,
// tests/cv-mods-ui.test.mjs's Serum-panel bodies): elements, SVG elements, attributes, classList, style, events with
// capture / target / bubble phases, focus, compound selectors (tag, .class, #id, [attr], [attr="v"], comma lists) for
// querySelectorAll / closest / matches, bounding rects, recording 2D contexts, a manual requestAnimationFrame queue.
// Fake nodes print as a one-line tag; `safeAssert(assert)` wraps node:assert so a failing assertion never walks the
// cyclic fake DOM (a failing assert.equal(fakeNode, …) once ate 32 GB): nodes become `<tag.class>#id` strings.
import { inspect } from 'node:util';

export const __stub = true;
const INSPECT = inspect.custom;
const tagOf = n => (!n ? String(n) : n.nodeType === 1 ? '<' + n.localName + (n.className ? '.' + n.className.trim().split(/\s+/).join('.') : '')
  + (n.getAttribute('data-dest') ? ' data-dest=' + n.getAttribute('data-dest') : '') + '>' : n.nodeType === 3 ? '#text ' + JSON.stringify(n.data.slice(0, 40)) : '[' + (n.constructor && n.constructor.name) + ']');
const NODE_ID = new WeakMap();
let nodeN = 0;
export const isNode = v => v instanceof Tgt || v instanceof Txt;
const nodeStr = n => { if (!NODE_ID.has(n)) NODE_ID.set(n, ++nodeN); return tagOf(n) + '#' + NODE_ID.get(n); };
export const scrub = (v, d = 0) => (isNode(v) ? nodeStr(v) : d < 3 && Array.isArray(v) ? v.map(x => scrub(x, d + 1))
  : d < 3 && v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x, d + 1)])) : v);
const SAME = new Set(['equal', 'strictEqual', 'notEqual', 'notStrictEqual']), DEEP = new Set(['deepEqual', 'deepStrictEqual', 'notDeepEqual', 'notDeepStrictEqual']);
export function safeAssert(assertBase) {
  return new Proxy(assertBase, {
    get(t, k) {
      const f = t[k];
      if (typeof f !== 'function') return f;
      if (SAME.has(k)) return (a, b, ...r) => (isNode(a) || isNode(b) ? f.call(t, scrub(a), scrub(b), ...r) : f.call(t, a, b, ...r));
      if (DEEP.has(k)) return (a, b, ...r) => f.call(t, scrub(a), scrub(b), ...r);
      if (k === 'ok') return (v, m) => f.call(t, isNode(v) ? true : v, m);
      return f;
    },
  });
}
let NOW = 1000;
export class Ev {
  constructor(type, o = {}) {
    Object.assign(this, { bubbles: false, cancelable: false, isTrusted: false, button: 0, buttons: 0, clientX: 0, clientY: 0,
      shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, pointerId: 1, pointerType: 'mouse', deltaX: 0, deltaY: 0,
      deltaMode: 0, key: '', timeStamp: NOW++ }, o);
    this.type = type; this.defaultPrevented = false; this._stop = false; this._imm = false; this.target = null; this.currentTarget = null;
  }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  stopPropagation() { this._stop = true; }
  stopImmediatePropagation() { this._stop = true; this._imm = true; }
}
class Tgt {
  constructor() { this._l = []; }
  [INSPECT]() { return tagOf(this); }
  addEventListener(t, fn, o) { const c = o === true || !!(o && o.capture); if (!this._l.some(x => x.t === t && x.fn === fn && x.c === c)) this._l.push({ t, fn, c }); }
  removeEventListener(t, fn, o) { const c = o === true || !!(o && o.capture); this._l = this._l.filter(x => !(x.t === t && x.fn === fn && x.c === c)); }
  dispatchEvent(ev) {
    ev.target = this;
    const path = [];
    for (let n = this; n; n = n._parent()) path.push(n);
    const run = (n, cap) => { ev.currentTarget = n; for (const x of n._l.slice()) { if (x.t !== ev.type || x.c !== cap) continue; x.fn.call(n, ev); if (ev._imm) break; } };
    for (let i = path.length - 1; i > 0 && !ev._stop; i--) run(path[i], true);
    if (!ev._stop) run(this, true);
    if (!ev._stop) run(this, false);
    if (ev.bubbles) for (let i = 1; i < path.length && !ev._stop; i++) run(path[i], false);
    ev.currentTarget = null;
    return !ev.defaultPrevented;
  }
}
class Txt { constructor(t) { this.nodeType = 3; this.data = String(t); this.parentNode = null; } [INSPECT]() { return tagOf(this); } get textContent() { return this.data; } contains(n) { return n === this; } _parent() { return this.parentNode; } }
function compound(s) {
  const re = /([a-zA-Z][\w-]*)|\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g, c = { tag: null, cls: [], id: null, attrs: [] };
  let m, pos = 0;
  while ((m = re.exec(s))) {
    if (m.index !== pos) throw new Error('fake DOM: unsupported selector ' + s);
    pos = re.lastIndex;
    if (m[1]) c.tag = m[1].toLowerCase(); else if (m[2]) c.cls.push(m[2]); else if (m[3]) c.id = m[3]; else c.attrs.push([m[4], m[5]]);
  }
  if (pos !== s.length) throw new Error('fake DOM: unsupported selector ' + s);
  return c;
}
function matches(el, sel) {
  if (!el || el.nodeType !== 1) return false;
  return sel.split(',').map(x => x.trim()).filter(Boolean).map(compound).some(c => {
    if (c.tag && el.localName !== c.tag) return false;
    for (const k of c.cls) if (!el.classList.contains(k)) return false;
    if (c.id && el.id !== c.id) return false;
    for (const [a, v] of c.attrs) { if (!el.hasAttribute(a)) return false; if (v !== undefined && el.getAttribute(a) !== v) return false; }
    return true;
  });
}
const CTX2D = () => { const calls = []; return new Proxy({ calls, measureText: t => ({ width: String(t).length * 6 }) }, { get: (t, k) => (k in t ? t[k] : typeof k === 'symbol' ? undefined : (...a) => { calls.push([k, ...a]); }), set: (t, k, v) => { t[k] = v; return true; } }); };
export class El extends Tgt {
  constructor(doc, tag, ns) {
    super();
    this.ownerDocument = doc; this.localName = tag.toLowerCase(); this.tagName = tag.toUpperCase(); this.namespaceURI = ns;
    this.nodeType = 1; this.childNodes = []; this.parentNode = null; this._a = new Map(); this._rect = null;
    this.value = ''; this.disabled = false; this.width = 300; this.height = 150; this.files = null;
    this.style = { setProperty(k, v) { this[k] = v; }, getPropertyValue(k) { return this[k] || ''; } };
    const self = this, get = () => self.className.split(/\s+/).filter(Boolean), put = a => { self.className = a.join(' '); };
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
  get title() { return this.getAttribute('title') || ''; }
  set title(v) { this.setAttribute('title', v); }
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) { for (const n of this.childNodes) n.parentNode = null; this.childNodes = v === '' || v == null ? [] : [new Txt(v)]; for (const n of this.childNodes) n.parentNode = this; }
  appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; }
  append(...ns) { for (const n of ns) this.appendChild(typeof n === 'string' ? new Txt(n) : n); }
  insertBefore(n, ref) { if (!ref) return this.appendChild(n); if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.splice(this.childNodes.indexOf(ref), 0, n); return n; }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; const d = this.ownerDocument; if (n.contains && n.contains(d.activeElement)) d.activeElement = d.body; return n; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; }
  get isConnected() { return this.ownerDocument.documentElement.contains(this); }
  matches(sel) { return matches(this, sel); }
  closest(sel) { for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (matches(n, sel)) return n; return null; }
  querySelectorAll(sel) { const out = []; const walk = n => { for (const c of n.childNodes) if (c.nodeType === 1) { if (matches(c, sel)) out.push(c); walk(c); } }; walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  focus() { if (this.isConnected) this.ownerDocument._focus(this); }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument._focus(this.ownerDocument.body); }
  select() {}
  click() { this.dispatchEvent(new Ev('click', { bubbles: true, cancelable: true })); }
  get offsetWidth() { return this._rect ? this._rect.width : 0; }
  get offsetHeight() { return this._rect ? this._rect.height : 0; }
  get clientWidth() { return this._rect ? this._rect.width : 0; }
  get clientHeight() { return this._rect ? this._rect.height : 0; }
  getBoundingClientRect() {
    const r = this._rect || { left: parseFloat(this.style.left) || 0, top: parseFloat(this.style.top) || 0, width: this.localName === 'canvas' ? 300 : 40, height: this.localName === 'canvas' ? 120 : 20 };
    return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top };
  }
  setPointerCapture() {} releasePointerCapture() {}
  getContext() { return this._g || (this._g = CTX2D()); }
}
class Win extends Tgt {
  constructor() { super(); this.innerWidth = 1440; this.innerHeight = 900; this.devicePixelRatio = 1; this.raf = []; this.confirms = []; }
  _parent() { return null; }
  requestAnimationFrame(f) { this.raf.push(f); return this.raf.length; }
  confirm(msg) { this.confirms.push(msg); return this.answer !== false; }
}
export class Doc extends Tgt {
  constructor() {
    super();
    this.nodeType = 9; this.defaultView = new Win(); this.hidden = false; this.pointAt = null;
    this.documentElement = this.createElement('html'); this.documentElement.parentNode = this;
    this.head = this.createElement('head'); this.body = this.createElement('body');
    this.documentElement.append(this.head, this.body);
    this.activeElement = this.body;
  }
  _parent() { return this.defaultView; }
  createElement(t) { return new El(this, t, 'http://www.w3.org/1999/xhtml'); }
  createElementNS(ns, t) { return new El(this, t, ns); }
  createTextNode(t) { return new Txt(t); }
  getElementById(id) { return this.documentElement.querySelectorAll('#' + id)[0] || null; }
  elementFromPoint(x, y) { return this.pointAt ? this.pointAt(x, y) : null; }
  _focus(el) { const prev = this.activeElement; if (prev === el) return; this.activeElement = el; if (prev && prev !== this.body) prev.dispatchEvent(new Ev('blur')); el.dispatchEvent(new Ev('focus')); }
}
// a fresh document installed as globalThis.document (MouseEvent = Ev, for the long-press menus)
export function fresh() { const d = new Doc(); globalThis.document = d; globalThis.MouseEvent = Ev; return d; }
export function fire(el, type, o = {}) { const e = new Ev(type, Object.assign({ bubbles: true, cancelable: true }, o)); el.dispatchEvent(e); return e; }
export const ptr = (el, type, x, y, o = {}) => fire(el, type, Object.assign({ clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1 }, o));
export const tick = () => new Promise(r => setTimeout(r, 0));
// the frames queued on the document's window (requestAnimationFrame), rounds × (a tick, then every queued frame)
export async function flush(doc, rounds = 4) {
  for (let i = 0; i < rounds; i++) {
    await tick();
    const q = doc.defaultView.raf.splice(0);
    for (const f of q) f(NOW++);
  }
}
export const ctxMenus = doc => doc.body.querySelectorAll('.wk-ctx');
export const menuLabels = m => m.querySelectorAll('.wk-ci, .wk-sep').map(n => (n.classList.contains('wk-sep') ? '' : n.querySelector('.wk-cl').textContent));
