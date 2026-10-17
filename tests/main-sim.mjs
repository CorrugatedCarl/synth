// The page in node (owner I; SPEC-serum2 §15.13 "main-thread simulation"): boots the real main.js against
//  - a DOM stub (stable elements per selector, recorded listeners; unknown members are inert functions),
//  - Web Audio fakes: AudioContext / OfflineAudioContext / AudioWorkletNode. Every context has its own
//    AudioWorkletGlobalScope (a node:vm context with the §0.3 scripts and engine.js, tests/dsp-scope.mjs); a worklet node
//    owns a real SynthProcessor of that scope; messages are structured-cloned (transfers detach, as in a browser) and
//    their v8-serialised sizes recorded; live contexts render on demand (sim.run), offline ones in startRendering
//    (gain / stereo-panner / destination graph mixed),
//  - storage: a fake localStorage and, optionally, the fake IndexedDB of tests/fakes.mjs (appstore `synth-app`);
//    no Workers (the asset manager builds on the main thread), no BroadcastChannel,
//  - controllable requestAnimationFrame (sim.raf() runs the queued callbacks) and unref'd timers (the test process exits),
//  - the browser around the page (pwa.js): o.ua / o.platform / o.touch (navigator; o.maxTouch: maxTouchPoints apart from
//    the coarse pointer — a mouse-driven touchscreen laptop, an iPad with a trackpad), o.display ('standalone' |
//    'fullscreen': the display-mode media queries that match), o.navStandalone (iOS navigator.standalone), o.fs (the
//    Fullscreen API on document.documentElement: 'std' | 'webkit'; none by default), o.sw (a navigator.serviceWorker
//    fake), o.location (merged into location: protocol, hostname, …; location.reload() counts sim.reloads),
//    navigator.storage (persisted() / persist() calls in sim.persist), o.vendor (navigator.vendor),
//  - the audio clock (R5): o.clock 'webkit' | 'std' — getOutputTimestamp stamped as that engine does, outputLatency /
//    baseLatency (o.outLat / o.baseLat), a fake performance.now() (sim.ms, moved by sim.run / sim.advance); every context
//    records its resume / suspend / close calls (ctx.calls), every worklet node the context state it was built in
//    (node.state0); o.noReady / o.readyMs: the engine's {t: 'ready'} dropped / late.
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
const REAL_PERF = globalThis.performance;  // (o.clock boots replace it with sim.ms; the others get it back)
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
// one AudioWorkletGlobalScope: the §0.3 scripts in table order, then engine.js; processors post through `out`. What a
// processor posts from its constructor (engine.js {t: 'ready'}) reaches its node a microtask later, as in a browser
// (after main.js has set node.port.onmessage); o.noReady drops 'ready', o.readyMs delivers it that many ms later.
function workletScope(sr, o = {}) {
  const D = dspScope({ sampleRate: sr, fast: true });
  let Proc = null, early = null;
  const outs = new Map(); // processor → its node (worklet → main messages)
  D.run('(function (reg, out) { globalThis.AudioWorkletProcessor = class AudioWorkletProcessor { constructor() { const self = this;'
    + ' this.port = { postMessage(m) { out(self, m); }, onmessage: null }; } };'
    + ' globalThis.registerProcessor = function registerProcessor(name, cls) { reg(cls); }; })', 'sim-worklet.js')(c => { Proc = c; }, (p, m) => {
    if (m && m.t === 'ready' && o.noReady) return;
    const node = outs.get(p);
    if (node) node._fromProc(m); else if (early) early.push(m);
  });
  D.run(ENGINE, 'engine.js');
  const make = (po, node) => {
    early = [];
    const p = new Proc({ processorOptions: po }), q = early;
    early = null; outs.set(p, node);
    if (q.length && node) {
      const send = () => { for (const m of q) node._fromProc(m); };
      if (o.readyMs) setTimeout(send, o.readyMs); else queueMicrotask(send);
    }
    return p;
  };
  return { D, ctx: D.ctx, outs, make };
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
  // calls: the state changes asked for, in order (a suspended context's state and time stand still until resume); a
  // change fires statechange a microtask later
  _to(call, state) {
    (this.calls || (this.calls = [])).push(call);
    if (this.state !== state) { this.state = state; queueMicrotask(() => { if (typeof this.onstatechange === 'function') this.onstatechange({ type: 'statechange' }); }); }
    return Promise.resolve();
  }
  resume() { return this._to('resume', 'running'); }
  suspend() { return this._to('suspend', 'suspended'); }
  close() { return this._to('close', 'closed'); }
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
  const dom = makeDom(), sim = { dom, live: [], offline: [], rafQ: [], logs: [], posted: [], reloads: 0, persist: [] };
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
      this.state0 = ctx.state; // the context's state when the node (and its processor) was built
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
      if (o.clock) { // (see bootMain: the audio clock personalities)
        this.baseLatency = o.baseLat || 0;
        if (o.outLat === null) delete this.outputLatency; else this.outputLatency = o.outLat || 0;
        this._ts = { contextTime: 0, performanceTime: 0 };
        this.getOutputTimestamp = () => Object.assign({}, this._ts);
      }
      this.born = sim.live.map(x => x.state); // the states of the earlier contexts when this one was created
      sim.live.push(this);
    }
    scope() { return this._scope || (this._scope = workletScope(this.sampleRate, o)); }
    // the stamp after a render: WebKit at the rendered frame, Chromium at the speaker (frames − device delay)
    _stamp() {
      const t = this.frames / this.sampleRate, d = o.clock === 'webkit' ? 0 : (+this.outputLatency || 0) + this.baseLatency;
      this._ts = { contextTime: Math.max(0, t - d), performanceTime: sim.ms };
    }
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
    location: Object.assign({ hash: o.hash || '', search: '', protocol: 'http:', hostname: 'sim.test', href: 'http://sim.test/', reload() { sim.reloads++; } }, o.location || {}),
    history: { replaceState() {} }, isSecureContext: true,
    // display-mode queries match o.display only; every other query (pointer: coarse, …) matches on a touch device
    matchMedia: q => ({ matches: /display-mode/.test(q) ? !!o.display && q.includes(o.display) : !!o.touch, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: f => { sim.rafQ.push(f); return sim.rafQ.length; }, cancelAnimationFrame: () => {},
    alert: m => sim.logs.push('alert: ' + m), confirm: () => true, prompt: () => null,
    addEventListener: (type, fn) => { (dom.winL[type] || (dom.winL[type] = [])).push(fn); }, removeEventListener() {},
    devicePixelRatio: 1, innerWidth: 1400, innerHeight: 900,
  });
  G.indexedDB = o.idb || undefined;
  G.BroadcastChannel = undefined;
  G.Worker = undefined;
  const storage = { persisted: () => { sim.persist.push('persisted'); return Promise.resolve(false); }, persist: () => { sim.persist.push('persist'); return Promise.resolve(true); } };
  const nav = { userAgent: o.ua || 'node-sim', platform: o.platform || 'node', maxTouchPoints: o.maxTouch != null ? o.maxTouch : o.touch ? 5 : 0, storage };
  if (o.navStandalone !== undefined) nav.standalone = o.navStandalone;
  if (o.sw) nav.serviceWorker = o.sw;
  if (o.vendor) nav.vendor = o.vendor;
  Object.defineProperty(G, 'navigator', { value: nav, configurable: true, writable: true });
  // the audio clock (o.clock 'webkit' | 'std'): live contexts stamp getOutputTimestamp as that engine does — WebKit at the
  // rendered frame (nothing subtracted), Chromium at the speaker (− outputLatency − baseLatency) — with o.outLat / o.baseLat
  // (s; o.outLat null: no outputLatency, iPadOS < 18.4), and performance.now() is sim.ms: sim.run advances it with the
  // frames it renders (sim.run(n, false): a catch-up render that takes no wall time), sim.advance(ms) without rendering
  // (a stall). Without o.clock: no stamps, the real performance.now().
  sim.ms = 1000;
  Object.defineProperty(G, 'performance', { value: o.clock ? { now: () => sim.ms, timeOrigin: REAL_PERF.timeOrigin } : REAL_PERF, configurable: true, writable: true });
  // the Fullscreen API (pwa.js): none unless o.fs; entering / leaving fires (webkit)fullscreenchange on the document
  const D = dom.document, root = D.documentElement, pre = o.fs === 'webkit' ? 'webkit' : '';
  const fsChange = () => { for (const f of dom.docL[pre ? 'webkitfullscreenchange' : 'fullscreenchange'] || []) f({ type: 'fullscreenchange' }); };
  Object.assign(D, { readyState: 'complete', fullscreenEnabled: o.fs === 'std', fullscreenElement: null, webkitFullscreenEnabled: o.fs === 'webkit', webkitFullscreenElement: null,
    exitFullscreen: undefined, webkitExitFullscreen: undefined });
  Object.assign(root, { requestFullscreen: undefined, webkitRequestFullscreen: undefined });
  if (o.fs) {
    const el = pre ? 'webkitFullscreenElement' : 'fullscreenElement';
    root[pre ? 'webkitRequestFullscreen' : 'requestFullscreen'] = function (opt) { sim.fsCalls = (sim.fsCalls || []).concat([['enter', opt]]); D[el] = root; fsChange(); return pre ? undefined : Promise.resolve(); };
    D[pre ? 'webkitExitFullscreen' : 'exitFullscreen'] = function () { sim.fsCalls = (sim.fsCalls || []).concat([['exit']]); D[el] = null; fsChange(); return pre ? undefined : Promise.resolve(); };
  }
  G.__synthTest = {};
  const url = new URL('main.js?v=10&sim=' + (++boots), ROOT).href;
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
    // renders `frames` of the live context (every worklet node, creation order), returning each node's output; with
    // o.clock each quantum moves sim.ms on (unless wall === false) and stamps getOutputTimestamp
    run(frames, wall = true) {
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
        if (o.clock) { if (wall) sim.ms += 128 / c.sampleRate * 1000; c._stamp(); }
      }
      return out;
    },
    advance(ms) { sim.ms += ms; },
    key(code, down, extra) {
      const e = Object.assign({ type: down ? 'keydown' : 'keyup', code, key: '', target: dom.document.body, repeat: false, timeStamp: performance.now(),
        preventDefault() {}, stopPropagation() {}, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }, extra || {});
      for (const f of dom.winL[e.type] || []) f(e);
    },
    // lets promise chains and 0-ms timers settle
    async settle(ms = 5) { await new Promise(r => realTimeout(r, ms)); },
    // a window event (beforeinstallprompt, appinstalled, load …) to the page's listeners
    win(type, extra) { const e = Object.assign({ type, preventDefault() { e.defaultPrevented = true; }, defaultPrevented: false }, extra || {}); for (const f of dom.winL[type] || []) f(e); return e; },
  });
  return sim;
}

export { makeDom, workletScope };
