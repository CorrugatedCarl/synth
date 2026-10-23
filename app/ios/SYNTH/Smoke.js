// The smoke's page half (IMPL-A §9.2) — a WKUserScript at document start, main frame, injected ONLY under -smoke (Debug;
// excluded from Release builds by Config.xcconfig). Never part of the site. Installs the console / error hooks (console.error
// and warn, a CAPTURE-phase `error` listener for failed element loads — the only page-visible sign of a blocked resource —,
// unhandledrejection, visibilitychange) and `window.__smoke`, the functions SmokeSteps.swift calls through callAsyncJavaScript.
// The bridge save here is lane N's own implementation of §4.1's messages (W1 writes the page's); the download() mirrors wk.js
// saveFile's <a download> of a blob: URL.
(function () {
  'use strict';
  var post = function (m) { try { return window.SYNTH_SHELL.post(m); } catch (e) { return Promise.reject(e); } };
  var log = function (d) { try { d.t = 'log'; post(d); } catch (e) {} };
  var str = function (a) { try { return typeof a === 'string' ? a : (a && a.stack) ? a.stack : JSON.stringify(a); } catch (e) { return String(a); } };
  ['error', 'warn'].forEach(function (l) { var o = console[l]; console[l] = function () { log({ k: 'console', level: l, msg: Array.prototype.map.call(arguments, str).join(' ').slice(0, 2000) }); return o.apply(console, arguments); }; });
  window.addEventListener('error', function (e) {
    if (e.target && e.target !== window && e.target.tagName) { log({ k: 'console', level: 'load', tag: e.target.tagName, src: String(e.target.src || e.target.href || '').slice(0, 300) }); return; }
    log({ k: 'console', level: 'onerror', msg: String(e.message) + ' @ ' + e.filename + ':' + e.lineno });
  }, true);
  window.addEventListener('unhandledrejection', function (e) { log({ k: 'console', level: 'unhandledrejection', msg: str(e.reason && (e.reason.stack || e.reason.message) || e.reason).slice(0, 2000) }); });
  var vis = [], t0 = performance.now();
  document.addEventListener('visibilitychange', function () { vis.push({ t: Math.round(performance.now()), hidden: document.hidden }); log({ k: 'vis', hidden: document.hidden }); });
  var ticks = 0; setInterval(function () { ticks++; }, 25);   // the metronome's scheduler shape (main.js setInterval 25 ms)

  var $ = function (id) { return document.getElementById(id); };
  var hex = function (buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); };
  var pattern = function (n) { var u8 = new Uint8Array(n); for (var i = 0; i < n; i++) u8[i] = (i * 7) & 255; return u8; };
  var textW = function (family) { var s = document.createElement('span'); s.textContent = 'Transport & tracks — SYNTH 0123456789'; s.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:600 20px ' + family; document.body.appendChild(s); var w = s.getBoundingClientRect().width; s.remove(); return w; };
  var insets = function () { var d = document.createElement('div'); d.style.cssText = 'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)'; document.body.appendChild(d); var c = getComputedStyle(d), r = [c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft]; d.remove(); return r; };

  // §4.1's bridge, as the page will do it: file → 2 MiB chunks (base64 per 32 KiB apply, toBase64 when present; one in flight) → end
  var b64 = async function (slice) { var u8 = new Uint8Array(await slice.arrayBuffer()); if (u8.toBase64) return u8.toBase64(); var s = ''; for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  var shellSave = async function (blob, name) {
    var id = 'smk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), CH = 2 << 20, r;
    r = await post({ t: 'file', id: id, name: name, type: blob.type, size: blob.size });
    if (!r || !r.ok) throw new Error('file: ' + (r && r.error));
    for (var at = 0; at < blob.size; at += CH) {
      r = await post({ t: 'chunk', id: id, at: at, b64: await b64(blob.slice(at, Math.min(at + CH, blob.size))) });
      if (!r || !r.ok) { await post({ t: 'abort', id: id }); throw new Error('chunk: ' + (r && r.error)); }
    }
    var sent = performance.now();
    r = await post({ t: 'end', id: id });
    if (!r || !r.ok) throw new Error('end: ' + (r && r.error));
    r.sentAt = sent; return r;
  };
  var idb = function (mode, fn) {
    return new Promise(function (ok, no) {
      var req = indexedDB.open('smoke-db', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('kv', { keyPath: 'id' }); };
      req.onerror = function () { no(req.error); };
      req.onsuccess = function () { var db = req.result, tx = db.transaction('kv', mode), q = fn(tx.objectStore('kv')); tx.oncomplete = function () { db.close(); ok(q && q.result); }; tx.onerror = function () { no(tx.error); }; };
    });
  };
  var attempt = async function (out, what, f) { try { var v = await f(); out.push({ what: what, failed: false, result: String(v).slice(0, 120) }); } catch (e) { out.push({ what: what, failed: true, error: String(e && e.message || e).slice(0, 200) }); } };
  var timeout = function (ms) { return new Promise(function (_, no) { setTimeout(function () { no(new Error('timeout')); }, ms); }); };
  var bgCtx = null;

  window.__smoke = {
    status: async function (stage) {
      var S = window.SYNTH_SHELL, build = null;
      try { build = await (await fetch('app-build.json')).json(); } catch (e) { build = { error: String(e) }; }
      var probe = null; try { if (S && typeof S.probe === 'function') probe = S.probe(); } catch (e) { probe = { error: String(e) }; }
      return { stage: stage, secure: window.isSecureContext, protocol: location.protocol, origin: location.origin, shell: !!S, shellKeys: S ? Object.keys(S) : [], restarted: S ? S.restarted : null, probe: probe,
        keys: document.querySelectorAll('#keys .key').length, install: ($('install') || {}).hidden, fs: ($('fullscreen') || {}).hidden, toast: ($('update') || {}).hidden,
        cpu: ($('cpu') || {}).textContent || null, notice: ($('notice') || {}).textContent || '', title: document.title,
        fonts: Array.from(document.fonts).map(function (f) { return f.family + ':' + f.status; }), interW: textW("'Inter', sans-serif"), fallbackW: textW('sans-serif'), monoW: textW("'JetBrains Mono', monospace"), monoFallbackW: textW('monospace'),
        resources: performance.getEntriesByType('resource').map(function (e) { return e.name; }).filter(function (n) { return !/^(synth:|blob:|data:)/.test(n); }).slice(0, 40),
        build: build, inner: [innerWidth, innerHeight], dpr: devicePixelRatio, insets: insets(), hidden: document.hidden, vis: vis, ticks: ticks, sinceStart: Math.round(performance.now() - t0),
        standalone: navigator.standalone, sw: 'serviceWorker' in navigator, ua: navigator.userAgent };
    },
    // §2.4 item 4 (c): every attempt to reach the network must fail (with the Mac online, a pass proves the block)
    guard: async function () {
      var out = [];
      await attempt(out, 'fetch', function () { return Promise.race([fetch('https://canvas.domlavin.com/manifest.webmanifest?smoke=' + Date.now()).then(function (r) { return 'status ' + r.status; }), timeout(8000)]); });
      await attempt(out, 'image', function () { return Promise.race([new Promise(function (ok, no) { var i = new Image(); i.onload = function () { ok('loaded ' + i.naturalWidth); }; i.onerror = function () { no(new Error('error event')); }; i.src = 'http://canvas.domlavin.com/icons/favicon-32.png?smoke=' + Date.now(); }), timeout(8000)]); });
      await attempt(out, 'websocket', function () { return Promise.race([new Promise(function (ok, no) { var ws = new WebSocket('wss://canvas.domlavin.com/smoke'); ws.onopen = function () { ok('open'); ws.close(); }; ws.onerror = function () { no(new Error('error event')); }; ws.onclose = function (e) { no(new Error('closed ' + e.code)); }; }), timeout(8000)]); });
      await attempt(out, 'worker-fetch', function () { return Promise.race([new Promise(function (ok, no) {
        var src = "fetch('https://canvas.domlavin.com/manifest.webmanifest?smoke=w').then(r => postMessage({ ok: true, status: r.status }), e => postMessage({ ok: false, error: String(e) }));";
        var w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })), { type: 'module' });
        w.onmessage = function (e) { w.terminate(); if (e.data.ok) ok('status ' + e.data.status); else no(new Error(e.data.error)); };
        w.onerror = function (e) { w.terminate(); no(new Error('worker error: ' + e.message)); };
      }), timeout(8000)]); });
      await attempt(out, 'stylesheet', function () { return Promise.race([new Promise(function (ok, no) { var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Inter&smoke=' + Date.now(); l.onload = function () { ok('loaded'); l.remove(); }; l.onerror = function () { no(new Error('error event')); l.remove(); }; document.head.appendChild(l); }), timeout(8000)]); });
      return { online: navigator.onLine, attempts: out };
    },
    // §2.1: the map is case-exact and has no implicit index; a traversal is normalised away by the URL parser or 404s (?smoke=404 marks the deliberate misses)
    probe404: async function () {
      var out = [], urls = ['Index.html?smoke=404', 'panels/?smoke=404', 'nope.js?smoke=404', 'panels/../index.html?smoke=trav', 'synth://x/index.html?smoke=404', 'main.js?v=9&smoke=ok'];
      for (var i = 0; i < urls.length; i++) { try { var r = await fetch(urls[i]); out.push({ u: urls[i], status: r.status, type: r.headers.get('content-type') }); } catch (e) { out.push({ u: urls[i], error: String(e).slice(0, 120) }); } }
      return { probes: out };
    },
    // the engine step waits for the engine (its JIT warm-up runs with the context suspended — main.js powerOn) and its first stats line
    engineWait: async function (ms) {
      var t0 = Date.now(), p = null;
      while (Date.now() - t0 < ms) { p = window.SYNTH_SHELL && window.SYNTH_SHELL.probe ? window.SYNTH_SHELL.probe() : null; if (p && p.ctx === 'running' && p.peak > 0.01 && /DSP load \d+%/.test(p.cpu || '')) break; await new Promise(function (r) { setTimeout(r, 100); }); }
      return { waited: Date.now() - t0, ctx: p && p.ctx, peak: p && p.peak };
    },
    keyDown: function (code) { window.dispatchEvent(new KeyboardEvent('keydown', { code: code, key: code.replace('Key', '').toLowerCase(), bubbles: true })); return { code: code, cpu: ($('cpu') || {}).textContent }; },
    keyUp: function (code) { window.dispatchEvent(new KeyboardEvent('keyup', { code: code, key: code.replace('Key', '').toLowerCase(), bubbles: true })); return { code: code, cpu: ($('cpu') || {}).textContent }; },
    click: function (id) { var el = $(id); if (!el) return { id: id, error: 'no element' }; el.click(); return { id: id, clicked: true }; },
    // (b) integrity: 100 MB of (i * 7) & 255 over the bridge; the page's digest vs native's
    save100: async function () {
      var n = 100 << 20, u8 = pattern(n), sha = hex(await crypto.subtle.digest('SHA-256', u8)), blob = new Blob([u8], { type: 'application/octet-stream' });
      u8 = null; log({ k: 'mark', what: 'save100-blob-ready' });
      var t1 = performance.now(), r = await shellSave(blob, 'smoke-100.bin');
      // transferMs: file → the end message sent (the chunks); ms: until the sheet closed (the auto-dismiss under -smoke)
      return { size: n, sha256: sha, transferMs: Math.round(r.sentAt - t1), ms: Math.round(performance.now() - t1), toBase64: !!Uint8Array.prototype.toBase64, reply: { ok: r.ok, done: r.done } };
    },
    saveTwice: async function () {
      var a = new Blob([JSON.stringify({ smoke: 'a', tracks: [] })], { type: 'application/json' }), b = new Blob([JSON.stringify({ smoke: 'b', tracks: [] })], { type: 'application/json' });
      var t1 = performance.now(), r = await Promise.all([shellSave(a, 'smoke-a.json'), shellSave(b, 'smoke-b.json')]);
      return { replies: r, ms: Math.round(performance.now() - t1) };
    },
    // (d) wk.js saveFile's shape: an <a download> of a blob: URL, revoked 4 s later
    download: async function (n) {
      var u8 = pattern(n), sha = hex(await crypto.subtle.digest('SHA-256', u8));
      var url = URL.createObjectURL(new Blob([u8], { type: 'application/octet-stream' })), a = document.createElement('a');
      a.href = url; a.download = 'smoke-dl-' + n + '.bin'; a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      return { size: n, sha256: sha };
    },
    storageWrite: async function (run) { localStorage.__smoke = run; await idb('readwrite', function (s) { return s.put({ id: 1, run: run }); }); return { written: run }; },
    storageRead: async function () { var v = await idb('readonly', function (s) { return s.get(1); }); return { ls: localStorage.__smoke || null, idb: v ? v.run : null }; },
    // §5.2: an own context (a silent oscillator) beside the engine's held note; the state the native loop samples every 2 s
    bgStart: async function () {
      bgCtx = new AudioContext(); var o = bgCtx.createOscillator(), g = bgCtx.createGain(); g.gain.value = 0; o.connect(g).connect(bgCtx.destination); o.start();
      await bgCtx.resume(); return { state: bgCtx.state, sr: bgCtx.sampleRate };
    },
    bgState: function () {
      var S = window.SYNTH_SHELL, probe = null; try { if (S && typeof S.probe === 'function') probe = S.probe(); } catch (e) {}
      return { hidden: document.hidden, visState: document.visibilityState, ctxState: bgCtx ? bgCtx.state : null, ctxTime: bgCtx ? Math.round(bgCtx.currentTime * 1000) : null, now: Math.round(performance.now()), ticks: ticks, vis: vis.slice(-6), cpu: ($('cpu') || {}).textContent, probe: probe };
    }
  };
})();
