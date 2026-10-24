// SYNTH app: Web MIDI for the page, fed by CoreMIDI in the native shell (IMPL-B §1). A classic script the app injects as a
// WKUserScript at document start, main frame only, after the marker window.SYNTH_SHELL (both installs) — never part of the site:
// midi.js runs on it unchanged and finds navigator.requestMIDIAccess as in Chrome (B1). The surface is the Web MIDI spec's where
// SYNTH touches it (B2): MIDIAccess — a new one per call, with its own port objects, as Chrome's — (inputs / outputs: Maps by
// String(uniqueID) in first-seen order, sysexEnabled false, statechange), MIDIPort (id, name, manufacturer, version, type, state,
// connection — the implicit open, 'pending', close(), per access —, open / close, statechange), MIDIInput (midimessage: data +
// timeStamp in performance.now()'s clock, §1.3), MIDIOutput (send, clear); permissions.query({ name: 'midi' }) → granted (CoreMIDI
// asks nobody). No SysEx (refused), no network, no app-only API.
// Native → page, on the marker (IMPL-B §3.1, frozen): SYNTH_SHELL.midiPorts(list, gen) — the whole list of present ports, a
// known id absent from it is 'disconnected' —, SYNTH_SHELL.midiIn([h, dropped, uid, age, st, d1, d2, …]) — 5 per message.
// Page → native: { t: 'midi', on: true } (reply { ok, ports, gen, h }), { t: 'midi-send', id, b, delay } (reply ignored).
(function () {
  'use strict';
  const S = window.SYNTH_SHELL, N = window.navigator;
  // (no marker: not the app; a WebKit with Web MIDI of its own: it stands, the shim stands aside)
  if (!S || typeof S !== 'object' || !N || typeof N.requestMIDIAccess === 'function') return;
  const WIN = 2000;          // §1.3: the jump that reseeds the offset (ms), also the age clamp and how far back a stamp reaches
  const KI = new Map(), KO = new Map(); // the known ports (native's lists): id → { id, type, name, man, state }, first-seen order
  const ACC = [];            // every access handed out (each gets every change and message of its own ports)
  const X = new WeakMap();   // access → { ins, outs }: its own port objects by id
  const I = new WeakMap();   // port → { r: its known record (name, state… shared by every access), conn: its own, A: its access }
  const H = new WeakMap();   // target → { type: { f, l } }: its on<type> handler attributes
  const ET = EventTarget.prototype;
  const def = (o, k, v) => Object.defineProperty(o, k, { value: v, configurable: true, writable: true });
  const now = () => performance.now(); // (read at call time: the global, whatever replaced it)
  let lastGen = -Infinity, warned = false;

  // an event handler attribute on<type> (Web IDL EventHandler): one listener in the target's list, its callback swappable,
  // anything but a function removes it; after(target) runs on every set to a function (midimessage: the implicit open)
  function handler(proto, type, after) {
    Object.defineProperty(proto, 'on' + type, { configurable: true, enumerable: true,
      get() { const h = H.get(this); return h && h[type] ? h[type].f : null; },
      set(f) {
        const h = H.get(this) || (H.set(this, {}), H.get(this)), x = h[type];
        if (typeof f !== 'function') { if (x) { ET.removeEventListener.call(this, type, x.l); h[type] = null; } return; }
        if (x) x.f = f;
        else { const self = this, y = h[type] = { f, l(e) { return y.f.call(self, e); } }; ET.addEventListener.call(this, type, y.l); }
        if (after) after(this);
      } });
  }
  const event = (type, props) => { const e = new Event(type); for (const k in props) Object.defineProperty(e, k, { value: props[k], enumerable: true }); return e; };

  class MIDIAccess extends EventTarget {
    get inputs() { return X.get(this).ins; }
    get outputs() { return X.get(this).outs; }
    get sysexEnabled() { return false; }
  }
  handler(MIDIAccess.prototype, 'statechange');
  class MIDIPort extends EventTarget {
    constructor(r, A) { super(); I.set(this, { r, conn: 'closed', A }); }
    get id() { return I.get(this).r.id; }
    get name() { return I.get(this).r.name; }
    get manufacturer() { return I.get(this).r.man; }
    get version() { return ''; }
    get type() { return I.get(this).r.type; }
    get state() { return I.get(this).r.state; }
    get connection() { return I.get(this).conn; }
    open() { opening(this); return Promise.resolve(this); }
    close() { conn(this, 'closed'); return Promise.resolve(this); } // (an input: delivery stops; a later handler set opens it again)
  }
  handler(MIDIPort.prototype, 'statechange');
  class MIDIInput extends MIDIPort {
    addEventListener(type, l, o) { super.addEventListener(type, l, o); if (type === 'midimessage' && l) opening(this); }
  }
  handler(MIDIInput.prototype, 'midimessage', p => opening(p));
  class MIDIOutput extends MIDIPort {
    // the spec's checks in its order (TypeError: a byte > 0xFF, running status, a reserved status, an incomplete message, a data
    // byte ≥ 0x80, nothing to send; InvalidAccessError: SysEx; InvalidStateError: disconnected), all before anything is sent; data may
    // hold several messages — one post each. timestamp (performance.now()'s clock) → delay ms; absent, 0 or past: now
    send(data, timestamp) {
      const c = I.get(this), r = c.r, b = octets(data), out = [];
      for (let i = 0; i < b.length;) {
        const st = b[i], n = size(st);
        if (st === 0xf0 || st === 0xf7) throw new DOMException('System exclusive messages are not allowed (no SysEx in the SYNTH app).', 'InvalidAccessError');
        if (!n) throw new TypeError((st < 0x80 ? 'Running status is not allowed' : 'Reserved status is not allowed') + ' at index ' + i + ' (' + st + ').');
        if (i + n > b.length) throw new TypeError('Message is incomplete.');
        for (let j = 1; j < n; j++) if (b[i + j] > 0x7f) throw new TypeError('Unexpected status byte at index ' + (i + j) + ' (' + b[i + j] + ').');
        out.push(b.slice(i, i + n)); i += n;
      }
      if (!out.length) throw new TypeError('No MIDI message to send.');
      if (r.state !== 'connected') throw new DOMException('The port is disconnected.', 'InvalidStateError');
      if (c.conn === 'closed') conn(this, 'open'); // (the spec's implicit open)
      const t = Number(timestamp), delay = Number.isFinite(t) && t > 0 ? Math.max(0, t - now()) : 0;
      for (const m of out) post({ t: 'midi-send', id: r.id, b: m, delay }); // (b a plain Array: a script message carries no typed array)
    }
    clear() {}
  }

  // a message's length by its status byte; 0: not a status byte, SysEx (F0 / F7) or reserved (F4 F5 F9 FD)
  function size(st) {
    if (!(st >= 0x80 && st <= 0xff) || st % 1) return 0;
    if (st < 0xf0) return (st & 0xe0) === 0xc0 ? 2 : 3;
    return st === 0xf1 || st === 0xf3 ? 2 : st === 0xf2 ? 3 : st === 0xf0 || st === 0xf4 || st === 0xf5 || st === 0xf7 || st === 0xf9 || st === 0xfd ? 0 : 1;
  }
  // send()'s data → numbers 0–255 (Chrome's sequence<unsigned long>: NaN 0, truncated, modulo 2^32; > 0xFF a TypeError)
  function octets(data) {
    if (!data || typeof data !== 'object' || typeof data[Symbol.iterator] !== 'function') throw new TypeError('MIDIOutput.send: data is not a sequence of bytes.');
    const b = [];
    for (const v of data) {
      let x = Math.trunc(Number(v));
      x = Number.isFinite(x) ? ((x % 4294967296) + 4294967296) % 4294967296 : 0;
      if (x > 0xff) throw new TypeError('The value at index ' + b.length + ' (' + x + ') is greater than 0xFF.');
      b.push(x);
    }
    return b;
  }
  function post(m) { try { Promise.resolve(S.post(m)).catch(() => {}); } catch { /* a light is only a light */ } }

  // connection changes and the events: one statechange per change, on the port then its access, queued (a microtask — Chrome posts
  // its implicit open as a task, and an event inside the setter would re-enter midi.js's hook() mid-loop; never a timer: hidden, a
  // WKWebView throttles them to ≈ 1 Hz). Port objects exist only inside accesses: a list before the first one changes nothing visible
  function changed(p) {
    const A = I.get(p).A;
    queueMicrotask(() => { p.dispatchEvent(event('statechange', { port: p })); A.dispatchEvent(event('statechange', { port: p })); });
  }
  function conn(p, c) { const x = I.get(p); if (x.conn !== c) { x.conn = c; changed(p); } }
  function opening(p) { const x = I.get(p); if (x.conn === 'closed') conn(p, x.r.state === 'connected' ? 'open' : 'pending'); }
  const mapOf = (A, r) => X.get(A)[r.type === 'input' ? 'ins' : 'outs'];
  function add(A, r) { mapOf(A, r).set(r.id, new (r.type === 'input' ? MIDIInput : MIDIOutput)(r, A)); }
  function each(r, f) { for (const A of ACC) { const p = mapOf(A, r).get(r.id); if (p) f(p, I.get(p)); } }

  // a port list (the midi reply's, a hot-plug's): applied when its gen is newer than the last one applied (the two travel on
  // different channels); a record makes (in every access) or flips its port (the same object per id in an access), a known port
  // absent from it is 'disconnected' and stays in the Maps (Chrome's way); an open port gone → 'pending', a pending one back → 'open'
  function ports(list, gen) {
    if (!Array.isArray(list)) return;
    const g = Number(gen);
    if (Number.isFinite(g)) { if (g <= lastGen) return; lastGen = g; }
    const seen = new Set();
    for (const x of list) {
      const K = x && x.state !== 'disconnected' && x.id != null ? (x.type === 'input' ? KI : x.type === 'output' ? KO : null) : null;
      if (!K) continue;
      const id = String(x.id);
      let r = K.get(id);
      if (!r) { K.set(id, (r = { id, type: x.type, name: '', man: '', state: 'disconnected' })); for (const A of ACC) add(A, r); }
      r.name = String(x.name || ''); r.man = String(x.manufacturer || '');
      seen.add(r);
      if (r.state !== 'connected') { r.state = 'connected'; each(r, (p, c) => { if (c.conn === 'pending') c.conn = 'open'; changed(p); }); }
    }
    for (const K of [KI, KO]) for (const r of K.values()) {
      if (seen.has(r) || r.state === 'disconnected') continue;
      r.state = 'disconnected';
      each(r, (p, c) => { if (c.conn === 'open') c.conn = 'pending'; changed(p); });
    }
  }

  // §1.3 the page's clock (as amended after review 2, F1): off = the minimum of recv − h — the clock offset + the fastest transit
  // seen —, KEPT across silence (never lifted by a slower batch, however old the minimum), lowered at once by a faster one, and
  // reseeded by a sample more than 2 s above it (the clocks moved apart: a sleep) — that batch itself is still stamped against the
  // kept minimum (a 3 s dialog looks the same). A message is stamped h − age + off within [recv − 2 000, recv]: its arrival in the
  // page's clock, however long the page made the batch wait (up to the 2 s the shim ever reaches back)
  let off = NaN;
  function base(t, h) {
    const s = t - h, o = off;
    if (!(s >= o) || s - o > WIN) off = s; // (the first sample — the access reply's —, a new minimum, a jump)
    return s >= o ? o : s;
  }
  // a batch, dispatched in order and at once (no frame added), to every access's port of that id; delivery follows connection and
  // the handlers, not state: a closed port gets nothing, a 'disconnected' input still open (pending) gets the releases native
  // ordered before its list
  function midiIn(b) {
    const recv = now();
    if (!b || !(b.length >= 2)) return;
    const h = Number(b[0]), dropped = Number(b[1]), fin = Number.isFinite(h), o = fin ? base(recv, h) : 0;
    if (dropped > 0 && !warned) { warned = true; console.warn('SYNTH: the app thinned or dropped ' + dropped + ' MIDI messages (the page was busy, or MIDI paused in the background) — warned once'); }
    for (let i = 2; i + 5 <= b.length; i += 5) {
      const r = KI.get(String(b[i])), st = Number(b[i + 2]), n = size(st);
      if (!r || !n) continue; // (an unknown id: its list is on the way; group nibbles never arrive)
      const age = Math.min(WIN, Math.max(0, Number(b[i + 1]) || 0)), timeStamp = fin ? Math.min(recv, Math.max(recv - WIN, h - age + o)) : recv;
      each(r, (p, c) => {
        if (c.conn === 'closed') return;
        const data = new Uint8Array(n);
        data[0] = st;
        if (n > 1) data[1] = b[i + 3] & 0x7f;
        if (n > 2) data[2] = b[i + 4] & 0x7f;
        p.dispatchEvent(event('midimessage', { data, timeStamp }));
      });
    }
  }

  // the access — a new MIDIAccess per call, its own port objects (Chrome's MIDIAccessInitializer; review 2 N4: a second caller's
  // handlers never replace midi.js's), every one kept for the page's life. One post per page: calls in flight share it, once it
  // succeeded the ports are known and a later call asks nobody; a refusal is never kept (the next call asks again: midi.js's retry)
  let asking = null;
  function ask() {
    return new Promise((res, rej) => {
      const no = (name, why) => rej(new DOMException('MIDI is not available in the SYNTH app' + (why ? ' (' + why + ')' : '') + '.', name));
      let r;
      try { r = S.post({ t: 'midi', on: true }); } catch (err) { no('NotSupportedError', err && err.message); return; }
      Promise.resolve(r).then(rep => {
        if (!rep || rep.ok !== true) { no('InvalidStateError', rep && rep.error); return; }
        const t = now(), h = Number(rep.h);
        ports(rep.ports, rep.gen); // (no access yet: nothing to tell)
        if (Number.isFinite(h)) base(t, h); // (the first offset sample: the reply's own transit, ≥ the truth — §1.3)
        res();
      }, err => no('NotSupportedError', err && err.message));
    });
  }
  function access() {
    const A = new MIDIAccess();
    X.set(A, { ins: new Map(), outs: new Map() }); ACC.push(A);
    for (const K of [KI, KO]) for (const r of K.values()) add(A, r); // (every known port, a gone one 'disconnected'; all 'closed')
    return A;
  }
  def(N, 'requestMIDIAccess', function requestMIDIAccess(opts) {
    if (opts && opts.sysex) return Promise.reject(new DOMException('System exclusive access is not available in the SYNTH app.', 'SecurityError'));
    if (!asking) asking = ask().catch(err => { asking = null; throw err; });
    return asking.then(access);
  });

  // permissions.query({ name: 'midi' }) → granted (sysex: denied): midi.js connects by itself at boot — WebKit's Permissions API
  // knows no 'midi' and CoreMIDI no permission; every other name → WebKit's own query (none: a TypeError, as for an unknown name)
  const PM = N.permissions && typeof N.permissions === 'object' ? N.permissions : null, q0 = PM && typeof PM.query === 'function' ? PM.query : null;
  function query(d) {
    if (d && typeof d === 'object' && d.name === 'midi') {
      const s = new EventTarget();
      Object.assign(s, { name: 'midi', state: d.sysex ? 'denied' : 'granted', onchange: null });
      return Promise.resolve(s);
    }
    return q0 ? q0.call(PM, d) : Promise.reject(new TypeError('The permission name is not supported here.'));
  }
  if (PM) def(PM, 'query', query); else def(N, 'permissions', { query });

  S.midiIn = midiIn;
  S.midiPorts = ports;
})();
