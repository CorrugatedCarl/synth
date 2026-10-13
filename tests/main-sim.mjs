// The page in node (owner I; SPEC-serum2 §15.13 "main-thread simulation"): boots the real main.js against
//  - a DOM stub (stable elements per selector, recorded listeners; unknown members are inert functions),
//  - Web Audio fakes: AudioContext / OfflineAudioContext / AudioWorkletNode. Every context has its own
//    AudioWorkletGlobalScope (a node:vm context with the §0.3 scripts and engine.js, tests/dsp-scope.mjs); a worklet node
//    owns a real SynthProcessor of that scope; messages are structured-cloned (transfers detach, as in a browser) and
//    their v8-serialised sizes recorded; live contexts render on demand (sim.run), offline ones in startRendering
//    (gain / stereo-panner / destination graph mixed),
//  - storage: a fake localStorage and, optionally, the fake IndexedDB of tests/fakes.mjs (appstore `synth-app`);
//    no Workers (the asset manager builds on the main thread), no BroadcastChannel,
//  - controllable requestAnimationFrame (sim.raf() runs the queued callbacks) and unref'd timers (the test process exits).
// main.js publishes its hosts and a few internals on globalThis.__synthTest.api (its test hook) for the tests.
//   const sim = await bootMain({ hash: '#serum', idb: fakeIDB(), ls: fakeStorage({...}) });
//   await sim.power(); sim.raf(); sim.run(48000); sim.key('KeyA', true) …
// One boot per test file (main.js is a module: each boot imports a fresh instance under its own URL).
import vm from 'node:vm';
import { serialize } from 'node:v8';
import { readFileSync } from 'node:fs';
import { dspScope } from './dsp-scope.mjs';
import { fakeStorage } from './fakes.mjs';

const ROOT = new URL('../', import.meta.url);
const realTimeout = globalThis.setTimeout; // (sim.settle waits on a timer that keeps the process alive)
const ENGINE = readFileSync(new URL('engine.js', ROOT), 'utf8');

/* ------------------------------------------------------------------ DOM stub */
const NUMERIC = /^(offset|client|scroll)(Left|Top|Width|Height)$|^(width|height|clientX|clientY|devicePixelRatio)$/;
function inert() { return function () { return undefined; }; }
function makeDom() {
  const reg = new Map(), docL = {}, winL = {};
  const ctx2d = new Proxy({}, { get: (o, k) => (k in o ? o[k] : k === 'canvas' ? { width: 100, height: 100 } : k === 'measureText' ? () => ({ width: 10 }) : inert()), set: (o, k, v) => { o[k] = v; return true; } });
  function el(tag) {
    const t = {
      tagName: String(tag || 'div').toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {}, listeners: {}, hidden: false,
      textContent: '', value: '', options: [], parentNode: null, checked: false, disabled: false, title: '', className: '',
      files: null, offsetParent: null, isConnected: true, isContentEditable: false, type: '', id: '', name: '',
      style: new Proxy({}, { get: (o, k) => (k in o ? o[k] : /^(setProperty|removeProperty)$/.test(String(k)) ? inert() : k === 'getPropertyValue' ? () => '' : undefined), set: (o, k, v) => { o[k] = v; return true; } }),
      classList: { set: new Set(), add(...c) { for (const x of c) this.set.add(x); }, remove(...c) { for (const x of c) this.set.delete(x); },
        toggle(c, f) { const on = f === undefined ? !this.set.has(c) : !!f; if (on) this.set.add(c); else this.set.delete(c); return on; }, contains(c) { return this.set.has(c); } },
      append(...n) { for (const x of n) if (x && typeof x === 'object') { this.children.push(x); x.parentNode = P; } },
      prepend(...n) { for (const x of n) if (x && typeof x === 'object') { this.children.unshift(x); x.parentNode = P; } },
      appendChild(n) { this.append(n); return n; }, insertBefore(n) { this.append(n); return n; }, removeChild(n) { return n; },
      replaceChildren(...n) { this.children = []; this.append(...n); },
      remove() {}, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      removeAttribute(k) { delete this.attrs[k]; }, hasAttribute(k) { return k in this.attrs; },
      addEventListener(type, fn) { (this.listeners[type] || (this.listeners[type] = [])).push(fn); },
      removeEventListener(type, fn) { const l = this.listeners[type]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } },
      dispatchEvent(e) { for (const f of this.listeners[e.type] || []) f(e); return true; },
      click() { if (typeof this.onclick === 'function') this.onclick({ target: P, currentTarget: P, preventDefault() {}, stopPropagation() {} }); },
      focus() {}, blur() {}, select() {}, scrollIntoView() {}, setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture() { return false; },
      querySelector() { return el('div'); }, querySelectorAll() { return []; }, closest() { return null; }, contains() { return false; },
      getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0 }; },
      getContext() { return ctx2d; }, animate() { return { cancel() {}, finished: Promise.resolve() }; },
    };
    Object.defineProperty(t, 'innerHTML', { get() { return ''; }, set() { t.children = []; }, enumerable: true });
    Object.defineProperty(t, 'firstChild', { get() { return t.children[0] || null; } });
    Object.defineProperty(t, 'lastChild', { get() { return t.children[t.children.length - 1] || null; } });
    const P = new Proxy(t, {
      get(o, k) {
        if (k in o) return o[k];
        if (typeof k === 'symbol') return undefined;
        if (NUMERIC.test(k)) return 100;
        if (/^on[a-z]+$/.test(k)) return null;
        return inert();
      },
      set(o, k, v) { o[k] = v; return true; },
    });
    return P;
  }
  const document = el('#document');
  Object.assign(document, {
    nodeType: 9, body: el('body'), head: el('head'), documentElement: el('html'), hidden: false, activeElement: null, baseURI: 'http://localhost/',
    fonts: { ready: Promise.resolve(), load: () => Promise.resolve([]) }, visibilityState: 'visible',
    querySelector(sel) { if (!reg.has(sel)) reg.set(sel, el(sel)); return reg.get(sel); },
    getElementById(id) { return document.querySelector('#' + id); },
    querySelectorAll() { return []; },
    createElement: tag => el(tag), createElementNS: (ns, tag) => el(tag), createTextNode: s => ({ nodeType: 3, textContent: String(s) }),
    createDocumentFragment: () => el('#fragment'),
    addEventListener(type, fn) { (docL[type] || (docL[type] = [])).push(fn); }, removeEventListener() {},
  });
  return { document, reg, docL, winL, el };
}

/* ------------------------------------------------------------------ Web Audio fakes */
// one AudioWorkletGlobalScope: the §0.3 scripts in table order, then engine.js; processors post through `out`
function workletScope(sr) {
  const D = dspScope({ sampleRate: sr, fast: true });
  let Proc = null;
  const outs = new Map(); // processor → its node (worklet → main messages)
  D.run('(function (reg, out) { globalThis.AudioWorkletProcessor = class AudioWorkletProcessor { constructor() { const self = this;'
    + ' this.port = { postMessage(m) { out(self, m); }, onmessage: null }; } };'
    + ' globalThis.registerProcessor = function registerProcessor(name, cls) { reg(cls); }; })', 'sim-worklet.js')(c => { Proc = c; }, (p, m) => {
    const node = outs.get(p);
    if (node) node._fromProc(m);
  });
  D.run(ENGINE, 'engine.js');
  return { D, ctx: D.ctx, outs, make: (po, node) => { const p = new Proc({ processorOptions: po }); outs.set(p, node); return p; } };
}
class Param {
  constructor(v) { this.value = v; }
  setTargetAtTime(v) { this.value = v; return this; } setValueAtTime(v) { this.value = v; return this; }
  linearRampToValueAtTime(v) { this.value = v; return this; } exponentialRampToValueAtTime(v) { this.value = v; return this; }
  cancelScheduledValues() { return this; }
}
class Node {
  constructor(ctx, kind) { this.context = ctx; this.kind = kind; this.outs = new Set(); }
  connect(n) { this.outs.add(n); return n; }
  disconnect() { this.outs.clear(); }
}
class BaseContext {
  constructor(sr) {
    this.sampleRate = sr > 0 ? sr : 48000; this.frames = 0; this.state = 'running'; this.modules = []; this.nodes = [];
    this.destination = new Node(this, 'dest'); this.baseLatency = 0; this.outputLatency = 0; this.onstatechange = null;
    this.audioWorklet = { addModule: async url => { this.modules.push(String(url)); } };
  }
  get currentTime() { return this.frames / this.sampleRate; }
  createGain() { const n = new Node(this, 'gain'); n.gain = new Param(1); return n; }
  createStereoPanner() { const n = new Node(this, 'pan'); n.pan = new Param(0); return n; }
  createAnalyser() {
    const n = new Node(this, 'an');
    n.fftSize = 2048; n.smoothingTimeConstant = 0.8;
    n.getFloatTimeDomainData = a => a.fill(0); n.getFloatFrequencyData = a => a.fill(-200);
    return n;
  }
  createOscillator() { const n = new Node(this, 'osc'); n.frequency = new Param(440); n.start = () => {}; n.stop = () => {}; return n; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}
// the gain / pan path of node n to the destination: [{g, pan}] (a fan-out gives several)
function paths(n, g = 1, pan = 0, seen = new Set()) {
  if (n.kind === 'dest') return [{ g, pan }];
  if (seen.has(n)) return [];
  seen.add(n);
  const out = [];
  for (const m of n.outs) {
    const g2 = m.kind === 'gain' ? g * m.gain.value : g, p2 = m.kind === 'pan' ? m.pan.value : pan;
    out.push(...paths(m, g2, p2, seen));
  }
  return out;
}
// Web Audio StereoPannerNode on a stereo input (equal power)
function panMix(L, R, pan, g, oL, oR, n) {
  const p = Math.max(-1, Math.min(1, pan)), x = p <= 0 ? p + 1 : p, gl = Math.cos(x * Math.PI / 2), gr = Math.sin(x * Math.PI / 2);
  for (let i = 0; i < n; i++) {
    let l, r;
    if (p <= 0) { l = L[i] + R[i] * gl; r = R[i] * gr; } else { l = L[i] * gl; r = R[i] + L[i] * gr; }
    oL[i] += g * l; oR[i] += g * r;
  }
}

/* ------------------------------------------------------------------ boot */
let boots = 0;
export async function bootMain(o = {}) {
  const dom = makeDom(), sim = { dom, live: [], offline: [], rafQ: [], logs: [], posted: [] };
  // the page's initially hidden elements (index.html `hidden` attributes)
  for (const m of readFileSync(new URL('index.html', ROOT), 'utf8').matchAll(/<\w+\s[^>]*>/g)) {
    const id = /\bid="([^"]+)"/.exec(m[0]);
    if (id && /\shidden[\s>]/.test(m[0])) dom.document.querySelector('#' + id[1]).hidden = true;
  }
  const ls = o.ls || fakeStorage({});
  // timers never keep the test process alive
  if (!globalThis.__simTimers) {
    const st = globalThis.setTimeout, si = globalThis.setInterval;
    globalThis.setTimeout = (f, ms, ...a) => { const t = st(f, ms, ...a); if (t && t.unref) t.unref(); return t; };
    globalThis.setInterval = (f, ms, ...a) => { const t = si(f, ms, ...a); if (t && t.unref) t.unref(); return t; };
    globalThis.__simTimers = true;
  }
  class AudioWorkletNode extends Node {
    constructor(ctx, name, opts) {
      super(ctx, 'worklet');
      this.name = name; this.posted = []; this.got = []; this.proc = null; this.pend = []; this.ended = false;
      this.po = structuredClone((opts && opts.processorOptions) || {});
      const node = this;
      this.port = {
        onmessage: null,
        postMessage(m, transfer) {
          const c = structuredClone(m, transfer && transfer.length ? { transfer } : undefined);
          let bytes = 0;
          try { bytes = serialize(c).length; } catch { bytes = -1; }
          node.posted.push({ m: c, bytes }); sim.posted.push({ node, m: c, bytes });
          if (node.proc) node.proc.msg(c); else node.pend.push(c);
        },
      };
      ctx.nodes.push(this);
      if (ctx.live) { this.proc = ctx.scope().make(this.po, this); }
    }
    _fromProc(m) { const c = structuredClone(m); this.got.push(c); if (typeof this.port.onmessage === 'function') this.port.onmessage({ data: c }); }
  }
  class AudioContext extends BaseContext {
    constructor(opt) {
      super(opt && opt.sampleRate);
      this.live = true; this._scope = null;
      sim.live.push(this);
    }
    scope() { return this._scope || (this._scope = workletScope(this.sampleRate)); }
  }
  class OfflineAudioContext extends BaseContext {
    constructor(a, b, c) {
      const opt = typeof a === 'object' ? a : { numberOfChannels: a, length: b, sampleRate: c };
      super(opt.sampleRate);
      this.length = opt.length; this.live = false;
      sim.offline.push(this);
    }
    async startRendering() {
      const S = workletScope(this.sampleRate), list = this.nodes.filter(n => n.kind === 'worklet');
      for (const n of list) { n.proc = S.make(n.po, n); for (const m of n.pend.splice(0)) n.proc.msg(m); }
      const N = Math.ceil(this.length / 128) * 128, L = new Float32Array(N), R = new Float32Array(N);
      const bL = new Float32Array(128), bR = new Float32Array(128), mL = new Float64Array(128), mR = new Float64Array(128);
      const routes = list.map(n => paths(n));
      for (let off = 0; off < N; off += 128) {
        mL.fill(0); mR.fill(0);
        list.forEach((n, k) => {
          if (n.ended) return; // process() returned false: no longer an active source (Web Audio)
          if (n.proc.process([], [[bL, bR]]) === false) n.ended = true;
          for (const r of routes[k]) panMix(bL, bR, r.pan, r.g, mL, mR, 128);
        });
        for (let i = 0; i < 128; i++) { L[off + i] = mL[i]; R[off + i] = mR[i]; }
        S.ctx.currentFrame += 128; this.frames += 128;
      }
      const chs = [L.slice(0, this.length), R.slice(0, this.length)];
      sim.lastOffline = { ctx: this, scope: S, nodes: list, L: chs[0].slice(), R: chs[1].slice() };
      return { length: this.length, sampleRate: this.sampleRate, numberOfChannels: 2, getChannelData: c => chs[c], duration: this.length / this.sampleRate };
    }
  }
  const G = globalThis;
  Object.assign(G, {
    document: dom.document, window: G, localStorage: ls, AudioContext, OfflineAudioContext, AudioWorkletNode,
    location: { hash: o.hash || '', search: '' }, history: { replaceState() {} }, isSecureContext: true,
    matchMedia: () => ({ matches: !!o.touch, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: f => { sim.rafQ.push(f); return sim.rafQ.length; }, cancelAnimationFrame: () => {},
    alert: m => sim.logs.push('alert: ' + m), confirm: () => true, prompt: () => null,
    addEventListener: (type, fn) => { (dom.winL[type] || (dom.winL[type] = [])).push(fn); }, removeEventListener() {},
    devicePixelRatio: 1, innerWidth: 1400, innerHeight: 900,
  });
  G.indexedDB = o.idb || undefined;
  G.BroadcastChannel = undefined;
  G.Worker = undefined;
  Object.defineProperty(G, 'navigator', { value: { userAgent: 'node-sim', platform: 'node', maxTouchPoints: o.touch ? 5 : 0, storage: { persist: () => Promise.resolve(true) } }, configurable: true, writable: true });
  G.__synthTest = {};
  const url = new URL('main.js?v=6&sim=' + (++boots), ROOT).href;
  await import(url);
  const api = G.__synthTest.api;
  if (!api) throw new Error('main.js did not publish its test hook');
  Object.assign(sim, {
    api,
    $: sel => dom.document.querySelector(sel),
    // runs the queued animation-frame callbacks (patch batching, UI updates) — main.js's frame() loop re-queues itself
    raf(rounds = 1) { for (let r = 0; r < rounds; r++) { const q = sim.rafQ.splice(0); for (const f of q) f(performance.now()); } },
    async power() { await api.powerOn(); return sim.ctx(); },
    // the context main.js plays through (with synth.settings.sr and an unknown device rate, powerOn opens and closes a
    // second, probe context after it: the last one created is not necessarily the page's)
    ctx: () => {
      const c = typeof api.ctx === 'function' ? api.ctx() : null;
      if (c && sim.live.includes(c)) return c;
      for (let k = sim.live.length - 1; k >= 0; k--) if (sim.live[k].state !== 'closed') return sim.live[k];
      return null;
    },
    nodeOf: id => { const N = api.nodes.get(id); return N ? N.node : null; },
    // renders `frames` of the live context (every worklet node, creation order), returning each node's output
    run(frames) {
      const c = sim.ctx();
      if (!c) throw new Error('no live context');
      const list = c.nodes.filter(n => n.kind === 'worklet' && n.proc), N = Math.ceil(frames / 128) * 128;
      const out = new Map(list.map(n => [n, { L: new Float32Array(N), R: new Float32Array(N) }]));
      const L = new Float32Array(128), R = new Float32Array(128);
      for (let off = 0; off < N; off += 128) {
        for (const n of list) {
          if (n.ended) continue; // process() returned false: no longer processed (its output stays silent)
          if (n.proc.process([], [[L, R]]) === false) n.ended = true;
          out.get(n).L.set(L, off); out.get(n).R.set(R, off);
        }
        c.scope().ctx.currentFrame += 128; c.frames += 128;
      }
      return out;
    },
    key(code, down, extra) {
      const e = Object.assign({ type: down ? 'keydown' : 'keyup', code, key: '', target: dom.document.body, repeat: false, timeStamp: performance.now(),
        preventDefault() {}, stopPropagation() {}, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }, extra || {});
      for (const f of dom.winL[e.type] || []) f(e);
    },
    // lets promise chains and 0-ms timers settle
    async settle(ms = 5) { await new Promise(r => realTimeout(r, ms)); },
  });
  return sim;
}

export { makeDom, workletScope };
