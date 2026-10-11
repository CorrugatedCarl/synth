import { MODELS, DX_ALGS } from './models.js?v=4';
import * as S from './song.js?v=4';
import { PianoRoll } from './roll.js?v=4';
import { Arrangement } from './arrange.js?v=4';

const VERSION = '4';
const $ = (s, el = document) => el.querySelector(s);
const h = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  raw(k) { try { return localStorage.getItem(k); } catch { return null; } },
  setRaw(k, v) { try { localStorage.setItem(k, v); } catch { /* storage full or unavailable */ } },
};
const modelById = id => MODELS.find(m => m.id === id) || MODELS[1];

const settings = Object.assign({ sr: 0, os: 4, drift: 5, master: 0.8, model: 'minimoog', vel: 100 }, store.get('synth.settings', {}));
let ctx = null, an = null, master = null, metroBus = null, powering = null;
let octave = 0, sustain = false;
const ui = new Map();

/* ----------------------------------------------------------- project */
function defaults(m) { const v = {}; for (const c of m.controls) v[c.id] = c.def; return v; }
function loadVals(m) { return Object.assign(defaults(m), store.get('synth.v.' + m.id, {})); }
function fmt(c, v) { return c.fmt ? c.fmt(v) : c.t === 'k' ? (+v).toFixed(1) : String(v); }
function toPos(c, v) { return (v - c.min) / (c.max - c.min); }
function fromPos(c, p) {
  let v = c.min + clamp(p, 0, 1) * (c.max - c.min);
  if (c.step) v = Math.round(v / c.step) * c.step;
  return +v.toFixed(4);
}

// song.deserialize validates the core schema; carry over the extras this UI keeps (303 patterns, view prefs)
function loadProject(json) {
  const p = S.deserialize(json);
  const o = typeof json === 'string' ? JSON.parse(json) : json;
  for (const k of ['drawLen', 'follow', 'ghosts']) if (o && k in o) p[k] = o[k];
  const byId = new Map(((o && o.tracks) || []).map(t => [t && t.id, t]));
  for (const t of p.tracks) { const r = byId.get(t.id); if (r && r.seq && Array.isArray(r.seq.pat)) t.seq = r.seq; }
  return p;
}
function freshProject(m) {
  return S.newProject({ model: m.id, vals: loadVals(m), name: 'Untitled', trackName: m.name + ' 1' });
}
let project;
{
  const raw = store.raw('synth.project');
  try { project = raw ? loadProject(raw) : null; } catch { project = null; }
  if (!project) {
    const fromHash = MODELS.find(m => '#' + m.id === location.hash);
    project = freshProject(fromHash || modelById(settings.model));
    const old303 = store.get('synth.seq303', null);
    if (old303 && project.tracks[0].model === 'tb303') project.tracks[0].seq = old303;
  }
  for (const t of project.tracks) if (!t.vals || typeof t.vals !== 'object') t.vals = loadVals(modelById(t.model));
}
const hist = new S.History(200);
const trk = () => project.tracks.find(t => t.id === project.selTrack) || project.tracks[0];
let model, vals;
function bind() { const t = trk(); project.selTrack = t.id; model = modelById(t.model); t.model = model.id; vals = t.vals = Object.assign(defaults(model), t.vals); }
bind();

let saveT = 0;
function save() {
  clearTimeout(saveT); saveT = 0;
  store.set('synth.settings', settings);
  store.set('synth.v.' + model.id, vals);
  store.setRaw('synth.project', S.serialize(project));
}
function persist() { clearTimeout(saveT); saveT = setTimeout(save, 400); }
function flush() { if (saveT) save(); } // write a pending save now (before the current model/track changes, or the page goes away)

/* --------------------------------------------------------- patching */
function buildPatch(tr, sr) {
  const m = modelById(tr.model), v = tr.vals, P = {};
  for (const c of m.controls) P[c.id] = c.conv ? c.conv(v[c.id]) : v[c.id];
  return m.map(P, v, { drift: settings.drift / 10, hiss: 1, sr: sr || (ctx ? ctx.sampleRate : 48000) });
}
const patchQ = new Set();
function queuePatch(tr = trk()) {
  if (!patchQ.size) requestAnimationFrame(() => { for (const t of patchQ) sendPatch(t); patchQ.clear(); });
  patchQ.add(tr);
}
function sendPatch(tr = trk()) { postTo(tr, { t: 'patch', p: buildPatch(tr) }); }
function setVal(id, v) {
  vals[id] = v;
  const u = ui.get(id); if (u) u();
  if (id === 'alg') drawAlgo();
  if (trk().preset) { trk().preset = null; renderHeads(); }
  queuePatch(); persist();
}
function refreshAll() { for (const u of ui.values()) u(); drawAlgo(); }

/* ------------------------------------------------------------- audio */
const nodes = new Map(); // track id -> { node, gain, pan, an, load, voices }
const quiet = p => { if (p && p.catch) p.catch(() => {}); };
// Internal rate cap: oversampling is a power of two with sampleRate × OS ≤ 384 kHz (more costs CPU for no audible gain)
const MAX_INTERNAL = 384000;
const osCap = sr => Math.max(1, 2 ** Math.floor(Math.log2(MAX_INTERNAL / sr + 1e-9)));
const osFor = sr => Math.min(settings.os, osCap(sr));
const kHz = x => (x / 1000).toFixed(1).replace(/\.0$/, '');
let pendCtx = null, failMsg = '', silentEl = null, devRate = +store.get('synth.devsr', 0) || 0;
function audioProblem() {
  if (window.isSecureContext === false) return 'Audio needs a secure page — reload this site over https://';
  if (!window.AudioContext || !window.AudioWorkletNode) return 'This browser can’t run the synth engine: it needs AudioWorklet (Safari 14.5+, Chrome 66+, Firefox 76+)';
  return '';
}
function audioFail(msg) { failMsg = msg; $('#cpu').textContent = msg; $('#cpu').classList.add('warn'); stickyNotice(msg); }
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function silentWav() { // 0.25 s of 8 kHz 16-bit mono silence
  const n = 2000, b = new DataView(new ArrayBuffer(44 + n * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) b.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, 8000, true); b.setUint32(28, 16000, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, 'data'); b.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}
// iOS plays Web Audio in the 'ambient' session, which the Ring/Silent switch mutes. Ask for 'playback' (Safari 16.4+);
// older iOS: a looping silent <audio> element moves the page to the playback category. Must run inside the user gesture.
function playbackSession(on) {
  const as = navigator.audioSession;
  if (as) { try { as.type = on ? 'playback' : 'auto'; } catch { /* not settable here */ } return; }
  if (!on) { if (silentEl) silentEl.pause(); return; }
  if (!isIOS()) return;
  if (!silentEl) {
    silentEl = document.createElement('audio');
    silentEl.setAttribute('x-webkit-airplay', 'deny'); silentEl.setAttribute('playsinline', '');
    silentEl.loop = true; silentEl.src = silentWav();
  }
  try { quiet(silentEl.play()); } catch { /* ignore */ }
}
// Resume a context that is suspended (no user activation yet) or 'interrupted' (iOS: call, Siri, another app).
// Registered in the capture phase of every gesture, so resume() runs while the gesture still counts.
function wake() {
  const c = ctx || pendCtx;
  if (!c || c.state === 'running' || c.state === 'closed') return;
  quiet(c.resume());
  if (silentEl && silentEl.paused) { try { quiet(silentEl.play()); } catch { /* ignore */ } }
}
function learnDevRate(r) { if (r && r !== devRate) { devRate = r; store.set('synth.devsr', r); } rateLabels(); }
// Never waits on resume(): the graph is built even while the context is suspended, and the next tap/key starts it.
async function powerOn() {
  if (ctx) { wake(); return; }
  if (powering) { wake(); return powering; }
  const why = audioProblem();
  if (why) { audioFail(why); throw new Error(why); }
  playbackSession(true);
  const opt = { latencyHint: 'interactive' };
  if (settings.sr) opt.sampleRate = settings.sr;
  let c;
  try { c = new AudioContext(opt); } catch {
    try { c = new AudioContext({ latencyHint: 'interactive' }); } catch (err) { audioFail('Audio could not start: ' + err.message); throw err; }
  }
  if (!settings.sr || c.sampleRate !== settings.sr) learnDevRate(c.sampleRate);
  else if (!devRate) { try { const d = new AudioContext(); learnDevRate(d.sampleRate); quiet(d.close()); } catch { /* unknown device rate */ } }
  pendCtx = c;
  c.onstatechange = () => { if (c === ctx || c === pendCtx) powerUI(); };
  quiet(c.resume()); // synchronous inside the gesture that called powerOn
  powerUI();
  const job = powering = (async () => {
    try {
      if (!c.audioWorklet) throw new Error('this browser has no AudioWorklet support');
      await c.audioWorklet.addModule('engine.js?v=' + VERSION);
      if (pendCtx !== c) throw new Error('cancelled');
      master = c.createGain(); master.gain.value = settings.master;
      an = c.createAnalyser(); an.fftSize = 8192; an.smoothingTimeConstant = 0.75;
      master.connect(c.destination); master.connect(an);
      metroBus = c.createGain(); metroBus.gain.value = 1; metroBus.connect(c.destination);
      ctx = c; pendCtx = null; failMsg = ''; hotT = 0;
      syncNodes();
    } catch (err) {
      const mine = ctx === c || pendCtx === c;
      if (pendCtx === c) pendCtx = null;
      if (ctx === c) { ctx = null; an = master = metroBus = null; nodes.clear(); }
      quiet(c.close());
      if (mine) { playbackSession(false); if (err.message !== 'cancelled') audioFail('Audio engine failed to start: ' + err.message); powerUI(); }
      throw err;
    }
    powerUI();
    if (c.state !== 'running') quiet(c.resume());
  })();
  try { await job; } finally { if (powering === job) powering = null; }
}
function powerOff() {
  const c = ctx || pendCtx;
  if (!c) return Promise.resolve();
  if (T.playing) stop();
  ctx = null; pendCtx = null; powering = null; an = null; master = null; metroBus = null;
  nodes.clear();
  seqRun.clear(); if (model.id === 'tb303') renderPanel();
  for (const k of [...held.keys()]) held.delete(k);
  hk.clear();
  for (const n of [...keyEls.keys()]) keyVis(n, false);
  playbackSession(false);
  powerUI();
  return c.close().catch(() => {});
}
function makeNode(tr) {
  const node = new AudioWorkletNode(ctx, 'synth-engine', {
    numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
    processorOptions: { os: osFor(ctx.sampleRate), patch: buildPatch(tr), song: songData(tr), seq: tr.model === 'tb303' ? seqPayload(tr) : null },
  });
  const gain = ctx.createGain(), pan = ctx.createStereoPanner(), a = ctx.createAnalyser();
  a.fftSize = 512;
  node.connect(gain); gain.connect(pan); pan.connect(master); pan.connect(a);
  const N = { node, gain, pan, an: a, load: 0, voices: 0, buf: new Float32Array(512), peak: 0 };
  node.port.onmessage = e => {
    const d = e.data;
    if (d.t === 'stats') { N.load = d.load; N.voices = d.voices; statsText(); }
    else if (d.t === 'step' && tr.id === project.selTrack && (seqRun.has(tr.id) || (T.playing && seqOf(tr).sync))) seqStep(d.s);
  };
  if (T.playing && T.a) node.port.postMessage(Object.assign({ t: 'transport', play: true, seek: true }, T.a));
  return N;
}
function syncNodes() {
  if (!ctx) return;
  const ids = new Set(project.tracks.map(t => t.id));
  for (const [id, N] of nodes) if (!ids.has(id)) { N.node.port.postMessage({ t: 'panic' }); N.pan.disconnect(); N.node.disconnect(); nodes.delete(id); }
  for (const t of project.tracks) if (!nodes.has(t.id)) nodes.set(t.id, makeNode(t));
  mix();
}
function audible(t) {
  const solo = project.tracks.some(x => x.solo);
  return !t.mute && (!solo || t.solo);
}
function mix() {
  if (!ctx) return;
  for (const t of project.tracks) {
    const N = nodes.get(t.id); if (!N) continue;
    N.gain.gain.setTargetAtTime(audible(t) ? t.vol : 0, ctx.currentTime, 0.015);
    N.pan.pan.setTargetAtTime(t.pan, ctx.currentTime, 0.015);
  }
}
function postTo(tr, m) { const N = tr && nodes.get(tr.id); if (N) N.node.port.postMessage(m); }
function postAll(m) { for (const N of nodes.values()) N.node.port.postMessage(m); }
/* status: the Power LED shows a context that is actually running; a suspended/interrupted one asks for a tap */
let noticeT = 0, sticky = '', pauseT = 0;
function showNotice(txt) { const el = $('#notice'); el.textContent = txt; el.hidden = !txt; }
function notice(txt, ms) { clearTimeout(noticeT); noticeT = 0; showNotice(txt); if (ms) noticeT = setTimeout(() => { noticeT = 0; showNotice(sticky); }, ms); }
function stickyNotice(txt) { sticky = txt; if (!noticeT) showNotice(txt); }
function powerUI() {
  const c = ctx || pendCtx, run = !!c && c.state === 'running', cpu = $('#cpu');
  $('#power').setAttribute('aria-pressed', run ? 'true' : 'false');
  clearTimeout(pauseT);
  if (ctx) rateText(); else $('#rate').textContent = pendCtx ? 'Starting engine…' : 'Engine off';
  if (run) { if (!/^DSP/.test(cpu.textContent)) cpu.textContent = 'DSP load —'; cpu.classList.remove('warn'); stickyNotice(failMsg); return; }
  if (!c) { cpu.textContent = failMsg || 'Press Power or play a key'; cpu.classList.toggle('warn', !!failMsg); stickyNotice(failMsg); return; }
  pauseT = setTimeout(() => { // a fresh context is 'suspended' for a moment even when allowed to start: only nag if it stays that way
    const k = ctx || pendCtx;
    if (!k || k.state === 'running' || k.state === 'closed') return;
    const msg = k.state === 'interrupted' ? 'Audio was interrupted by the system — tap a key or Power to resume' : 'Audio is paused — tap a key or Power to start it';
    cpu.textContent = msg; cpu.classList.add('warn'); stickyNotice(msg);
  }, 400);
}
function rateText() {
  if (!ctx) return;
  const sr = ctx.sampleRate, os = osFor(sr);
  let s = `${kHz(sr)} kHz × ${os} = ${kHz(sr * os)} kHz · 64-bit`;
  if (os < settings.os) s += ` (${settings.os}× capped)`;
  if (devRate && sr !== devRate) s += ` · resampled to ${kHz(devRate)} kHz`;
  $('#rate').textContent = s;
}
// Option labels: rates other than the device's are resampled by the browser; OS above the 384 kHz cap is reduced
function rateLabels() {
  const base = o => { if (!o.dataset.l) o.dataset.l = o.textContent; return o.dataset.l; };
  for (const o of $('#sr').options) {
    const v = +o.value;
    o.textContent = !v ? base(o) + (devRate ? ` (${kHz(devRate)} kHz)` : '') : base(o) + (devRate && v !== devRate ? ' — resampled' : '');
  }
  const sr = ctx ? ctx.sampleRate : settings.sr || devRate;
  for (const o of $('#os').options) {
    const v = +o.value, cap = sr ? osCap(sr) : 8;
    o.textContent = base(o) + (v > cap ? ` → ${cap}× at ${kHz(sr)} kHz` : '');
  }
}
let statT = 0, hotT = 0;
function statsText() {
  const now = performance.now();
  if (now - statT < 200 || !ctx || ctx.state !== 'running') return;
  statT = now;
  let load = 0, voices = 0;
  for (const N of nodes.values()) { load += N.load; voices += N.voices; }
  const pct = Math.round(load * 100), el = $('#cpu');
  el.textContent = `DSP load ${pct}% · ${voices} voice${voices === 1 ? '' : 's'} · ${nodes.size} track${nodes.size === 1 ? '' : 's'}`;
  el.classList.toggle('warn', pct > 75);
  if (pct > 75) el.textContent += ' — lower oversampling';
  // safeguard: summed load above 85% for 2 s (all tracks share one audio thread) -> drop oversampling one step
  if (load > 0.85 && osFor(ctx.sampleRate) > 1) { if (!hotT) hotT = now; else if (now - hotT > 2000) lowerOS(); }
  else hotT = 0;
}
function lowerOS() {
  hotT = 0;
  const v = osFor(ctx.sampleRate) / 2;
  settings.os = v; $('#os').value = String(v); persist();
  postAll({ t: 'os', v }); rateText(); rateLabels();
  notice(`DSP load stayed above 85% — oversampling lowered to ${v}× to avoid dropouts`, 9000);
}

/* --------------------------------------------------------- song data */
const CCK = { bend: 0, wheel: 1, sus: 2, at: 3 };
function songData(tr, start = -Infinity, end = Infinity) {
  const notes = [], cc = [];
  for (const n of tr.notes) {
    if (n.t < start - 1e-9 && n.t + n.d <= start) continue;
    if (n.t >= end) break;
    notes.push(n.t, Math.min(n.d, end - n.t), n.n, n.v);
  }
  for (const c of tr.cc) if (c.t < end) cc.push(c.t, CCK[c.k] ?? 1, c.v);
  return { notes, cc };
}
const songQ = new Map();
function sendSong(tr, now = false) {
  if (!ctx) return;
  clearTimeout(songQ.get(tr.id));
  if (now) { songQ.delete(tr.id); postTo(tr, Object.assign({ t: 'song' }, songData(tr))); return; }
  songQ.set(tr.id, setTimeout(() => { songQ.delete(tr.id); postTo(tr, Object.assign({ t: 'song' }, songData(tr))); }, 60));
}
function sendAllSongs() { for (const t of project.tracks) sendSong(t, true); }

/* ----------------------------------------------------------- editing */
let gesture = false;
function changed(trs = [trk()]) {
  for (const t of trs) { S.sortNotes(t.notes); t.cc.sort((a, b) => a.t - b.t); sendSong(t); }
  fitBars();
  persist();
  arr && arr.render(); roll && roll.render(); updateUndoUI();
}
function edit(label, fn, trs) {
  hist.record(project);
  fn();
  changed(trs || [trk()]);
}
function fitBars() {
  const bt = S.barTicks(project);
  let end = 0;
  for (const t of project.tracks) for (const n of t.notes) if (n.t + n.d > end) end = n.t + n.d;
  const need = Math.max(1, Math.ceil(end / bt));
  if (need > project.bars) { project.bars = need; $('#tBars').value = project.bars; }
}
function applyRestore(p, keepSound = false) {
  if (!p) return;
  if (keepSound) for (const t of p.tracks) { // undo/redo never reverts knob tweaks on a track that kept its instrument
    const cur = project.tracks.find(x => x.id === t.id);
    if (cur && cur.model === t.model) t.vals = cur.vals;
    if (cur && cur.seq) t.seq = cur.seq;
  }
  const prevSel = project.selTrack;
  project = p;
  bind();
  syncNodes();
  for (const t of project.tracks) { sendPatch(t); sendSong(t, true); }
  renderAll(!keepSound || prevSel !== project.selTrack);
  if (T.playing) reanchor(false);
  persist();
}
function undo() { applyRestore(hist.undo(project), true); updateUndoUI(); }
function redo() { applyRestore(hist.redo(project), true); updateUndoUI(); }
let undoT = 0;
function updateUndoUI() { // canUndoFrom may serialise the project, so coalesce bursts of calls into one per frame
  if (undoT) return;
  undoT = requestAnimationFrame(() => { undoT = 0; $('#tUndo').disabled = !hist.canUndoFrom(project); $('#tRedo').disabled = !hist.canRedoFrom(project); });
}

/* ---------------------------------------------------------- transport */
const T = { playing: false, rec: false, a: null, pos: 0, startPos: 0, take: 0, lastClr: 0 };
const fpt = () => ctx.sampleRate * 60 / (project.bpm * S.PPQ);
function loopInfo() { const L = project.loop; return { loop: !!(L.on && L.end > L.start), ls: L.start, le: L.end }; }
function anchor(F, tick) { const L = loopInfo(); return { frame: F, tick, fpt: fpt(), loop: L.loop, ls: L.ls, le: L.le, wrap: L.loop && tick < L.le }; }
function tickAt(F) {
  const a = T.a;
  let t = a.tick + (F - a.frame) / a.fpt;
  if (a.wrap && t >= a.le) t = a.ls + (t - a.le) % (a.le - a.ls);
  return t;
}
function outFrame(perfTs) { // frame of the audio that is (was) leaving the speakers at a performance.now() time
  const sr = ctx.sampleRate;
  const o = ctx.getOutputTimestamp ? ctx.getOutputTimestamp() : null;
  const ts = perfTs == null ? performance.now() : perfTs;
  if (o && o.performanceTime > 0 && o.contextTime > 0) return (o.contextTime + (ts - o.performanceTime) / 1000) * sr;
  return (ctx.currentTime - (ctx.outputLatency || 0) - (ctx.baseLatency || 0) - (performance.now() - ts) / 1000) * sr;
}
function curTick(perfTs) { return T.playing && T.a ? tickAt(outFrame(perfTs)) : T.pos; }
function postTransport(seek) { postAll(Object.assign({ t: 'transport', play: true, seek }, T.a)); }
async function play(from = T.pos, countBars = 0) {
  try { await powerOn(); } catch { return; }
  if (!ctx || T.playing) return;
  for (const t of project.tracks) if (songQ.has(t.id)) sendSong(t, true);
  const F = Math.round((ctx.currentTime + 0.06 + (ctx.baseLatency || 0)) * ctx.sampleRate);
  T.a = anchor(F, from - countBars * S.barTicks(project));
  T.playing = true; T.startPos = from; T.lastClr = from;
  postTransport(true);
  metroStart();
  transportUI();
}
function stop() {
  if (!T.playing) { if (T.pos !== 0) { T.pos = 0; posUI(); } return; }
  const t = curTick();
  if (T.rec) finishRec(t);
  postAll({ t: 'transport', play: false });
  T.playing = false; T.rec = false; T.a = null;
  T.pos = T.startPos;
  metroStop();
  if (!seqRun.has(project.selTrack)) for (const e of stepEls) e.classList.remove('now'); // synced 303 stopped with the song
  transportUI(); posUI();
}
function reanchor(seekTick) { // tempo/loop change (or a seek) while playing, applied in sync on every node
  if (!T.playing || !ctx) return;
  const F = Math.round((ctx.currentTime + 0.05) * ctx.sampleRate);
  const t = seekTick == null || seekTick === false ? tickAt(F) : seekTick;
  T.a = anchor(F, t);
  postTransport(seekTick != null && seekTick !== false);
  metroStart(F);
}
function seek(tick) {
  tick = Math.max(0, Math.round(tick));
  if (T.playing) { if (T.rec) finishRec(curTick()); reanchor(tick); T.startPos = tick; }
  else T.pos = tick;
  posUI();
}
function toggleRec() {
  if (T.rec) { finishRec(curTick()); T.rec = false; transportUI(); return; }
  if (!project.tracks.some(t => t.arm)) { trk().arm = true; renderHeads(); }
  hist.record(project); updateUndoUI();
  T.take = S.newId();
  if (T.playing) { T.rec = true; T.lastClr = curTick(); transportUI(); return; }
  T.rec = true;
  play(T.pos, project.metronome.countIn | 0);
}

/* metronome: Web Audio clicks scheduled ahead from the same transport anchor */
let metroTimer = null, metroDone = 0;
function metroStart(F) { metroDone = F != null ? Math.max(metroDone, F) : T.a.frame; clearInterval(metroTimer); metroTimer = setInterval(metroTick, 25); metroTick(); }
function metroStop() { clearInterval(metroTimer); metroTimer = null; }
function click(time, accent) {
  if (time < ctx.currentTime) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = accent ? 1760 : 1175;
  const v = project.metronome.vol * (accent ? 0.5 : 0.32);
  g.gain.setValueAtTime(0, time); g.gain.linearRampToValueAtTime(v, time + 0.001); g.gain.exponentialRampToValueAtTime(0.0005, time + 0.05);
  o.connect(g); g.connect(metroBus);
  o.start(time); o.stop(time + 0.06);
}
function metroTick() {
  if (!T.playing || !ctx || !T.a) return;
  const a = T.a, sr = ctx.sampleRate;
  const horizon = (ctx.currentTime + 0.15) * sr;
  if (horizon <= metroDone) return;
  const bt = S.beatTicks(project), bar = S.barTicks(project);
  const uA = a.tick + (metroDone - a.frame) / a.fpt, uB = a.tick + (horizon - a.frame) / a.fpt;
  const beats = (t0, t1, toFrame) => {
    for (let b = Math.ceil(t0 / bt - 1e-9) * bt; b < t1; b += bt) {
      if (project.metronome.on || (T.rec && b < 0)) click(toFrame(b) / sr, ((b % bar) + bar) % bar < 1);
    }
  };
  if (!a.wrap) beats(uA, uB, b => a.frame + (b - a.tick) * a.fpt);
  else {
    const L = a.le - a.ls;
    if (uA < a.le) beats(uA, Math.min(uB, a.le), b => a.frame + (b - a.tick) * a.fpt);
    for (let k = Math.max(0, Math.floor((Math.max(uA, a.le) - a.le) / L)); a.le + k * L < uB; k++) {
      const s = Math.max(uA, a.le + k * L), e = Math.min(uB, a.le + (k + 1) * L);
      if (e <= s) continue;
      const off = a.le + k * L - a.ls;
      beats(s - off, e - off, b => a.frame + (b + off - a.tick) * a.fpt);
    }
  }
  metroDone = horizon;
}

/* --------------------------------------------------------- recording */
const recLive = new Map(); // `${trackId}|${src}:${n}` -> { tr, n, t0, v }
function recStart(tr, key, n, v, ts) { recLive.set(tr.id + '|' + key, { tr, n, t0: curTick(ts), v }); }
function recEnd(tr, key, ts) {
  const k = tr.id + '|' + key, r = recLive.get(k);
  if (!r) return;
  recLive.delete(k);
  commitNote(r, curTick(ts));
}
function commitNote(r, t1) {
  const a = T.a;
  let t0 = r.t0;
  if (a && a.wrap && t1 < t0) t1 = a.le;
  if (t1 <= 0) return;
  if (t0 < 0) t0 = 0;
  const note = { id: S.newId(), t: Math.round(t0), d: Math.max(1, Math.round(t1 - t0)), n: r.n, v: clamp(Math.round(r.v * 127), 1, 127), take: T.take };
  if (project.rec.inputQuantize) S.quantize([note], { grid: project.quantize.grid || S.PPQ / 4, strength: 100, swing: project.quantize.swing, starts: true, ends: false });
  if (!project.tracks.includes(r.tr)) return;
  r.tr.notes.push(note);
  changed([r.tr]);
}
function finishRec(t) { for (const r of recLive.values()) commitNote(r, t); recLive.clear(); }
function recCC(trs, k, v, ts) {
  if (!T.rec || !T.playing) return;
  const t = Math.round(curTick(ts));
  if (t < 0) return;
  for (const tr of trs) {
    if (!tr.arm) continue;
    const last = tr.cc.length ? tr.cc[tr.cc.length - 1] : null;
    if (last && last.k === k && Math.abs(last.t - t) < 12) { last.v = v; continue; }
    tr.cc.push({ t, k, v, take: T.take });
    sendSong(tr);
  }
}
function replaceSweep(t) { // replace mode: wipe what the playhead passes on armed tracks (except this take)
  if (!T.rec || project.rec.mode !== 'replace' || t < 0) { T.lastClr = Math.max(T.lastClr, t); return; }
  const a = T.a, ranges = t >= T.lastClr ? [[T.lastClr, t]] : [[T.lastClr, a.le], [a.ls, t]];
  T.lastClr = t;
  for (const tr of project.tracks) {
    if (!tr.arm) continue;
    const before = tr.notes.length + tr.cc.length;
    tr.notes = tr.notes.filter(n => n.take === T.take || !ranges.some(([s, e]) => n.t >= s && n.t < e));
    if (tr.notes.length + tr.cc.length !== before) { sendSong(tr); arr && arr.render(); roll && roll.render(); }
  }
}

/* ------------------------------------------------- live input routing */
const held = new Map(); // `${src}:${n}` -> [track ids]
function targets(src) { // src 0 = on-screen/computer keyboard; 1..16 = MIDI channel
  const sel = project.selTrack;
  if (!src) return project.tracks.filter(t => t.id === sel || t.arm);
  const r = project.tracks.filter(t => t.ch === src || (t.ch === 0 && (t.id === sel || t.arm)));
  return r.length ? r : project.tracks.filter(t => t.id === sel);
}
function noteOn(n, v, src = 0, ts = performance.now()) {
  if (n < 0 || n > 127) return;
  const key = src + ':' + n;
  if (held.has(key)) noteOff(n, src, ts);
  const trs = targets(src);
  held.set(key, trs.map(t => t.id));
  keyVis(n, true);
  const send = () => { for (const t of trs) postTo(t, { t: 'on', n, v }); };
  if (!ctx) { powerOn().then(() => { if (held.has(key)) send(); }).catch(() => {}); }
  else { wake(); send(); } // queued while suspended; plays once the context runs
  if (T.rec) for (const t of trs) if (t.arm) recStart(t, key, n, v, ts);
  playingUI(trs);
}
function noteOff(n, src = 0, ts = performance.now()) {
  const key = src + ':' + n, ids = held.get(key);
  if (!ids) return;
  held.delete(key);
  for (const id of ids) {
    const t = project.tracks.find(x => x.id === id);
    if (!t) continue;
    postTo(t, { t: 'off', n });
    recEnd(t, key, ts);
  }
  if (![...held.keys()].some(k => k.endsWith(':' + n))) keyVis(n, false);
}
function ctl(kind, v, src = 0, ts = performance.now()) {
  const trs = targets(src);
  const m = kind === 'bend' ? { t: 'bend', v } : kind === 'wheel' ? { t: 'wheel', v } : kind === 'sus' ? { t: 'sus', v: !!v } : { t: 'at', v };
  for (const t of trs) postTo(t, m);
  recCC(trs, kind, kind === 'sus' ? (v ? 1 : 0) : v, ts);
}
function panic() {
  for (const t of project.tracks) seqToggle(t, false); // not quiet: the Run button and step lights must show it stopped
  for (const k of [...held.keys()]) { const [src, n] = k.split(':'); noteOff(+n, +src); }
  hk.clear();
  setSustain(false);
  postAll({ t: 'panic' });
  if (T.playing) { postTransport(true); }
}
function setSustain(on) {
  sustain = on;
  $('#hold').setAttribute('aria-pressed', on ? 'true' : 'false');
  ctl('sus', on ? 1 : 0, 0);
}
let playingT;
function playingUI(trs) {
  const el = $('#playing');
  el.textContent = '→ ' + trs.map(t => t.name).join(', ');
  clearTimeout(playingT); playingT = setTimeout(() => { el.textContent = ''; }, 2500);
}

/* -------------------------------------------------------- model nav */
function renderNav() {
  const nav = $('#models');
  nav.innerHTML = '';
  for (const m of MODELS) {
    const b = h('button', m === model ? 'on' : '');
    b.type = 'button';
    if (m === model) b.setAttribute('aria-current', 'true');
    b.title = `Use the ${m.name} on track “${trk().name}”`;
    b.append(h('span', 'yr', String(m.year)), h('span', 'nm', m.name), h('span', 'mk', m.maker));
    b.onclick = () => setTrackModel(trk(), m.id);
    nav.append(b);
  }
  const on = nav.querySelector('.on');
  if (on) {
    const l = on.offsetLeft - nav.offsetLeft, r = l + on.offsetWidth;
    if (l < nav.scrollLeft || r > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = l - 24;
  }
}
function setTrackModel(tr, id) {
  if (id === tr.model) return;
  flush(); // a pending save of the outgoing model's values must not be dropped
  const old = modelById(tr.model), m = modelById(id);
  hist.record(project);
  seqToggle(tr, false, true);
  postTo(tr, { t: 'panic' });
  if (new RegExp('^' + old.name.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + '( \\d+)?$').test(tr.name)) tr.name = m.name + ' ' + (project.tracks.indexOf(tr) + 1);
  tr.model = id; tr.vals = loadVals(m); tr.preset = null;
  if (tr.id === project.selTrack) { bind(); settings.model = id; renderNav(); renderPanel(); history.replaceState(null, '', '#' + id); }
  sendPatch(tr);
  if (id === 'tb303') seqSend(tr);
  renderHeads(); persist(); updateUndoUI();
}
function selectTrack(id) {
  if (id === project.selTrack && model.id === trk().model) return;
  for (const k of [...held.keys()]) { const [src, n] = k.split(':'); noteOff(+n, +src); }
  flush();
  project.selTrack = id;
  bind();
  renderNav(); renderPanel(); renderHeads();
  roll && roll.setTrack(); arr && arr.render();
  $('#tabTrack').textContent = 'Track: ' + trk().name;
  persist();
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
  nm.append(h('div', 'maker', model.maker), h('div', 'mname', model.name), h('div', 'mmodel', `${model.model} · ${model.year} · track “${trk().name}”`));
  if (th.stripes) { const s = h('div', 'stripes'); for (const c of th.stripes) { const i = h('i'); i.style.background = c; s.append(i); } nm.append(s); }
  plate.append(nm, h('div', 'tag', model.tag), presetUI());
  const secs = h('div', 'secs');
  let ops = null; // DX7 operator rows share one horizontal scroller so row 1's labels stay over every column
  model.sections.forEach((s, si) => {
    const se = h('div', 'sec' + (s.wide ? ' wide' : '') + (s.op ? ' op' : ''));
    se.append(h('h3', null, s.title));
    const cs = h('div', 'ctls');
    for (const c of s.c) cs.append(control(c, si));
    se.append(cs);
    if (s.op) { if (!ops) { ops = h('div', 'opswrap'); secs.append(ops); } ops.append(se); }
    else secs.append(se);
  });
  el.append(plate, secs);
  if (model.id === 'tb303') secs.append(seqUI(trk()));
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
function ariaVal(el, c) {
  el.setAttribute('aria-valuemin', c.min); el.setAttribute('aria-valuemax', c.max);
  el.setAttribute('aria-valuenow', vals[c.id]); el.setAttribute('aria-valuetext', fmt(c, vals[c.id]));
}
function knob(c) {
  const el = h('div', 'knob');
  el.tabIndex = 0; el.setAttribute('role', 'slider'); el.setAttribute('aria-label', c.label);
  el.innerHTML = `<svg viewBox="0 0 64 64"><g class="ticks">${TICKS}</g><circle class="skirt" cx="32" cy="32" r="25"/><g class="rot"><circle class="cap" cx="32" cy="32" r="17.5"/><circle class="shine" cx="32" cy="32" r="17.5"/><line class="ind" x1="32" y1="9" x2="32" y2="21"/></g></svg>`;
  const rot = el.querySelector('.rot');
  const upd = () => {
    rot.setAttribute('transform', `rotate(${(-135 + 270 * toPos(c, vals[c.id])).toFixed(2)} 32 32)`);
    ariaVal(el, c);
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
    ariaVal(el, c);
  };
  ui.set(c.id, upd); upd();
  drag(el, c);
  return el;
}
function numBox(c) {
  const el = h('div', 'num');
  el.tabIndex = 0; el.setAttribute('role', 'slider'); el.setAttribute('aria-label', c.label);
  const upd = () => { el.textContent = fmt(c, vals[c.id]); ariaVal(el, c); };
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
  const upd = () => bs.forEach((b, i) => { const on = vals[c.id] === i; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
  el.addEventListener('keydown', e => { // radio group: one tab stop, arrows move the selection
    const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault(); e.stopPropagation();
    const i = (vals[c.id] + d + c.opts.length) % c.opts.length;
    setVal(c.id, i); bs[i].focus();
  });
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

// Pointer drag with capture. Ends on pointerup/cancel, lost capture, or a mouse move with no button held
// (a context menu can swallow the pointerup), so a drag can never be left running.
function track(el, e, move, end) {
  let done = false;
  const mv = ev => { if (ev.pointerId !== e.pointerId) return; if (ev.pointerType === 'mouse' && !(ev.buttons & 1)) return fin(); move(ev); };
  const fin = ev => {
    if (done || (ev && ev.pointerId !== e.pointerId)) return;
    done = true;
    for (const [t, f] of L) el.removeEventListener(t, f);
    try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (end) end();
  };
  const L = [['pointermove', mv], ['pointerup', fin], ['pointercancel', fin], ['lostpointercapture', fin]];
  try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  for (const [t, f] of L) el.addEventListener(t, f);
}
const noMenu = el => el.addEventListener('contextmenu', e => e.preventDefault());
/* wheel: normalised delta; only taken when the control has focus, or the pointer rested on it and the page isn't scrolling */
let pageScrollT = 0;
const hoverT = new WeakMap(), wheelAcc = new WeakMap();
function hoverable(el) { el.addEventListener('pointerenter', () => hoverT.set(el, performance.now())); }
function wheelIn(el, e) {
  const d = e.deltaY || (e.shiftKey ? e.deltaX : 0); // Shift+wheel arrives as deltaX in Chromium/macOS
  if (!d) return null;
  const now = performance.now();
  if (document.activeElement !== el && (now - pageScrollT < 400 || now - (hoverT.get(el) || 0) < 300)) return null;
  e.preventDefault();
  return { px: d * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1), notch: e.deltaMode > 0 || Math.abs(d) >= 50 };
}
function wheelStep(el, w) { // whole steps (+ = up): one per mouse notch, one per 40 px of trackpad travel
  if (w.notch) return -Math.sign(w.px);
  const now = performance.now();
  let a = wheelAcc.get(el);
  if (!a || now - a.t > 200) { a = { v: 0, t: now }; wheelAcc.set(el, a); }
  a.t = now; a.v += w.px;
  const n = Math.trunc(a.v / 40); a.v -= n * 40;
  return -n;
}
function drag(el, c) {
  let dragging = false;
  noMenu(el); hoverable(el);
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.ctrlKey) return;
    e.preventDefault(); el.focus({ preventScroll: true });
    dragging = true;
    let p = toPos(c, vals[c.id]), yPrev = e.clientY; // accumulate per move, so pressing Shift mid-drag doesn't rescale what was already dragged
    const range = c.step ? (c.max - c.min) / c.step : 100;
    const base = range > 40 ? 0.0045 : Math.max(0.0045, 1 / (range * 22));
    showTip(el, c);
    track(el, e, ev => {
      p = clamp(p + (yPrev - ev.clientY) * (ev.shiftKey ? base * 0.2 : base), 0, 1); yPrev = ev.clientY;
      const v = fromPos(c, p);
      if (v !== vals[c.id]) setVal(c.id, v);
      showTip(el, c);
    }, () => { dragging = false; hideTip(400); });
  });
  el.addEventListener('dblclick', () => { setVal(c.id, c.def); showTip(el, c); hideTip(800); });
  el.addEventListener('wheel', e => {
    const w = wheelIn(el, e); if (!w) return;
    let v;
    if (c.step) { const n = wheelStep(el, w); if (!n) return; v = clamp(Math.round(vals[c.id] / c.step + n) * c.step, c.min, c.max); v = +v.toFixed(4); }
    else v = fromPos(c, toPos(c, vals[c.id]) + (w.notch ? -Math.sign(w.px) * 0.01 : clamp(-w.px * 0.001, -0.02, 0.02)) * (e.shiftKey ? 0.2 : 1));
    if (v !== vals[c.id]) setVal(c.id, v);
    showTip(el, c); hideTip(700);
  }, { passive: false });
  el.addEventListener('keydown', e => {
    const st = c.step ? c.step / (c.max - c.min) : (e.shiftKey ? 0.002 : 0.02), k = e.key;
    let v;
    if (k === 'ArrowUp' || k === 'ArrowRight') v = fromPos(c, toPos(c, vals[c.id]) + st);
    else if (k === 'ArrowDown' || k === 'ArrowLeft') v = fromPos(c, toPos(c, vals[c.id]) - st);
    else if (k === 'PageUp' || k === 'PageDown') v = fromPos(c, toPos(c, vals[c.id]) + (k === 'PageUp' ? 1 : -1) * Math.max(st, 0.1));
    else if (k === 'Home') v = c.min;
    else if (k === 'End') v = c.max;
    else return;
    e.preventDefault(); e.stopPropagation();
    setVal(c.id, v);
    showTip(el, c); hideTip(700);
  });
  el.addEventListener('pointerenter', () => { if (!dragging) showTip(el, c); });
  el.addEventListener('pointerleave', () => { if (!dragging) hideTip(); });
  el.addEventListener('blur', () => { if (!dragging) hideTip(); });
}

/* ---------------------------------------------------------- presets */
function userPresets(m = model) { return store.get('synth.user.' + m.id, []); }
function presetList(m) {
  return m.presets.map((p, i) => ({ key: 'f' + i, name: p.name, v: p.v, group: 'Factory' }))
    .concat(userPresets(m).map((p, i) => ({ key: 'u' + i, name: p.name, v: p.v, group: 'Saved' })));
}
function applyPreset(tr, p) {
  const m = modelById(tr.model);
  tr.vals = Object.assign(defaults(m), p.v);
  tr.preset = p.name;
  if (tr.id === project.selTrack) { bind(); refreshAll(); syncPresetSel(p.key); }
  sendPatch(tr); renderHeads(); persist();
}
let syncPresetSel = () => {};
function presetUI() {
  const w = h('div', 'presets');
  const sel = h('select'); sel.setAttribute('aria-label', 'Preset');
  const fill = () => {
    sel.innerHTML = '';
    const o0 = h('option', null, '— Presets —'); o0.value = ''; sel.append(o0);
    let grp = null, gname = '';
    for (const p of presetList(model)) {
      if (p.group !== gname) { grp = h('optgroup'); grp.label = p.group; gname = p.group; sel.append(grp); }
      const o = h('option', null, p.name); o.value = p.key; grp.append(o);
    }
  };
  fill();
  const del = h('button', null, 'Delete'); del.type = 'button'; del.title = 'Delete the selected saved sound';
  const delUI = () => { del.hidden = !/^u\d+$/.test(sel.value); };
  syncPresetSel = key => { // the entry just loaded (key), else the first one with the track's preset name
    const l = presetList(model), p = l.find(x => x.key === key && x.name === trk().preset) || l.find(x => x.name === trk().preset);
    sel.value = p ? p.key : ''; delUI();
  };
  const load = key => { const p = presetList(model).find(x => x.key === key); if (p) applyPreset(trk(), p); delUI(); };
  sel.onchange = () => load(sel.value);
  const step = d => {
    const keys = [...sel.querySelectorAll('option')].map(o => o.value).filter(Boolean);
    if (!keys.length) return;
    let i = keys.indexOf(sel.value);
    i = i < 0 ? (d > 0 ? 0 : keys.length - 1) : (i + d + keys.length) % keys.length; // from the blank entry: ▶ first, ◀ last
    sel.value = keys[i]; load(keys[i]);
  };
  const prev = h('button', null, '◀'); prev.type = 'button'; prev.title = 'Previous preset'; prev.onclick = () => step(-1);
  const next = h('button', null, '▶'); next.type = 'button'; next.title = 'Next preset'; next.onclick = () => step(1);
  const save = h('button', null, 'Save'); save.type = 'button';
  save.onclick = () => {
    const name = (prompt('Name this sound:', trk().preset && /^u\d+$/.test(sel.value) ? trk().preset : 'My ' + model.name + ' sound') || '').trim();
    if (!name) return;
    const up = userPresets(), i = up.findIndex(p => p.name === name);
    if (i >= 0 && !confirm(`Replace the saved sound “${name}”?`)) return;
    if (i >= 0) up[i] = { name, v: Object.assign({}, vals) }; else up.push({ name, v: Object.assign({}, vals) });
    store.set('synth.user.' + model.id, up);
    trk().preset = name;
    fill(); syncPresetSel('u' + (i >= 0 ? i : up.length - 1)); renderHeads(); persist();
  };
  del.onclick = () => {
    const m = /^u(\d+)$/.exec(sel.value); if (!m) return;
    const up = userPresets(), p = up[+m[1]];
    if (!p || !confirm(`Delete the saved sound “${p.name}”?`)) return;
    up.splice(+m[1], 1);
    store.set('synth.user.' + model.id, up);
    if (trk().preset === p.name) trk().preset = null;
    fill(); syncPresetSel(); renderHeads(); persist();
  };
  const init = h('button', null, 'Init'); init.type = 'button'; init.title = 'Reset every control to its default';
  init.onclick = () => applyPreset(trk(), { name: null, v: {} });
  w.append(prev, sel, next, save, del, init);
  syncPresetSel();
  return w;
}

/* ------------------------------------------------- DX7 algorithm view */
// Column (xs) and row (lvl: 0 = carriers) of each operator. Stacks are centred over their modulators; operators that
// share a modulator (6→3,4,5 in alg 22/24, 3→1,2 in 20/21, …) are then spread apart row by row, carriers first, and a
// modulator feeding several operators is re-centred over them. Every operator gets its own box.
function algoLayout(edges, car) {
  const ops = [1, 2, 3, 4, 5, 6], mods = {}, tgts = {}, lvl = {}, xs = {};
  for (const i of ops) { mods[i] = []; tgts[i] = []; lvl[i] = 0; }
  for (const [f, t] of edges) { mods[t].push(f); tgts[f].push(t); }
  for (let it = 0; it < 6; it++) for (const [f, t] of edges) lvl[f] = Math.max(lvl[f], lvl[t] + 1);
  let col = 0;
  const place = op => {
    if (xs[op] != null) return xs[op];
    const kids = mods[op].map(m => (xs[m] == null ? place(m) : xs[m]));
    xs[op] = kids.length ? kids.reduce((s, x) => s + x, 0) / kids.length : col++;
    return xs[op];
  };
  for (const c of [...car].sort((x, y) => x - y)) place(c);
  for (const i of ops) if (xs[i] == null) xs[i] = col++;
  const maxL = Math.max(...ops.map(i => lvl[i]));
  const shift = (op, d, seen = new Set()) => { // move an operator with the modulators that feed only it
    if (seen.has(op)) return;
    seen.add(op); xs[op] += d;
    for (const m of mods[op]) if (tgts[m].length === 1) shift(m, d, seen);
  };
  for (let L = 0; L <= maxL; L++) {
    const row = ops.filter(i => lvl[i] === L);
    if (L) for (const i of row) if (tgts[i].length > 1) shift(i, tgts[i].reduce((s, t) => s + xs[t], 0) / tgts[i].length - xs[i]);
    row.sort((p, q) => xs[p] - xs[q] || p - q);
    for (let k = 1; k < row.length; k++) { const d = xs[row[k - 1]] + 1 - xs[row[k]]; if (d > 1e-9) shift(row[k], d); }
  }
  const lo = Math.min(...ops.map(i => xs[i]));
  for (const i of ops) xs[i] -= lo;
  return { xs, lvl, maxL, cols: Math.max(...ops.map(i => xs[i])) + 1 };
}
function drawAlgo() {
  const box = $('#algo');
  if (model.id !== 'dx7') { box.hidden = true; return; }
  box.hidden = false;
  const a = DX_ALGS[clamp(Math.round(vals.alg), 1, 32) - 1];
  const [edges, car, fb] = a;
  const { xs, lvl, maxL, cols } = algoLayout(edges, car);
  const W = 44, Hh = 46, bw = 30, bh = 24;
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

/* ------------------------------------------------- TB-303 sequencer */
const SEQ_NOTES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B', 'C′'];
const st = (n, o, a, sl, g = 1) => ({ n, o, a, s: sl, g });
const SEQ_DEF = {
  bpm: 128, swing: 0, sync: false,
  pat: [st(0, 0, 1, 0), st(0, 0, 0, 0), st(12, 0, 0, 1), st(0, 0, 0, 0), st(3, 0, 1, 0), st(0, 0, 0, 1), st(10, 0, 0, 0), st(0, 0, 0, 0, 0),
    st(0, 0, 1, 0), st(7, 0, 0, 1), st(5, 0, 0, 0), st(3, 0, 0, 0), st(12, 0, 1, 1), st(0, 1, 0, 0), st(5, 0, 0, 0), st(6, 0, 1, 0)],
};
const seqRun = new Set();
const stepEls = [];
function seqOf(tr) {
  if (!tr.seq || !Array.isArray(tr.seq.pat) || tr.seq.pat.length !== 16) tr.seq = JSON.parse(JSON.stringify(SEQ_DEF));
  return tr.seq;
}
function seqPayload(tr, extra) {
  const q = seqOf(tr);
  return Object.assign({ pat: q.pat, len: 16, bpm: q.bpm, swing: q.swing / 100 * 0.5, root: 48, sync: !!q.sync, run: seqRun.has(tr.id) && !q.sync }, extra || {});
}
function seqSend(tr, extra) { postTo(tr, { t: 'seq', s: seqPayload(tr, extra) }); persist(); }
function seqToggle(tr, on, quiet) {
  if (!seqRun.has(tr.id) && !on) return;
  if (on) seqRun.add(tr.id); else seqRun.delete(tr.id);
  if (tr.id === project.selTrack && !quiet) {
    const b = $('#seqrun'); if (b) { b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.lastChild.textContent = on ? 'Stop' : 'Run'; }
    if (!on) for (const e of stepEls) e.classList.remove('now');
  }
  if (on && !ctx) powerOn().then(() => { if (seqRun.has(tr.id)) seqSend(tr); }).catch(() => {}); // Stop pressed while starting wins
  else seqSend(tr, { run: on });
}
function seqStep(i) { stepEls.forEach((e, k) => e.classList.toggle('now', k === i)); }
function seqRandom(q) {
  const scale = [0, 0, 3, 5, 7, 7, 10, 12];
  q.pat = q.pat.map(() => st(scale[(Math.random() * scale.length) | 0], Math.random() < 0.18 ? 1 : Math.random() < 0.08 ? -1 : 0,
    Math.random() < 0.3 ? 1 : 0, Math.random() < 0.22 ? 1 : 0, Math.random() < 0.82 ? 1 : 0));
  q.pat[0].g = 1;
}
function seqUI(tr) {
  stepEls.length = 0;
  const q = seqOf(tr);
  const send = () => seqSend(tr);
  const sec = h('div', 'sec seq');
  sec.append(h('h3', null, 'Pattern Sequencer'));
  const bar = h('div', 'seqbar');
  const running = seqRun.has(tr.id);
  const run = h('button', 'seqbtn run'); run.id = 'seqrun'; run.type = 'button';
  run.append(h('span', 'led'), h('span', null, running ? 'Stop' : 'Run'));
  run.setAttribute('aria-pressed', running ? 'true' : 'false');
  run.disabled = !!q.sync;
  run.onclick = () => seqToggle(tr, !seqRun.has(tr.id));
  const sync = h('button', 'seqbtn'); sync.type = 'button';
  sync.title = 'Lock the pattern to the song transport: it plays whenever the song plays, at the song tempo';
  const syncDraw = () => { sync.textContent = q.sync ? '⛓ Synced to song' : 'Sync to song'; sync.classList.toggle('on', !!q.sync); run.disabled = !!q.sync; };
  syncDraw();
  sync.onclick = () => { q.sync = !q.sync; if (q.sync) seqToggle(tr, false); syncDraw(); send(); };
  const numCtl = (label, get, set, min, max, unit) => {
    const w = h('div', 'seqnum'); const box = h('div', 'num'); box.tabIndex = 0;
    box.setAttribute('role', 'slider'); box.setAttribute('aria-label', label);
    box.setAttribute('aria-valuemin', min); box.setAttribute('aria-valuemax', max);
    const upd = () => { box.textContent = get() + unit; box.setAttribute('aria-valuenow', get()); box.setAttribute('aria-valuetext', get() + unit); };
    const put = v => { v = clamp(Math.round(v), min, max); if (v !== get()) { set(v); upd(); send(); } };
    upd(); noMenu(box); hoverable(box);
    box.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.ctrlKey) return;
      e.preventDefault(); box.focus({ preventScroll: true });
      let acc = get(), yPrev = e.clientY; // accumulated, so Shift mid-drag only changes the rate from here on
      track(box, e, ev => { acc = clamp(acc + (yPrev - ev.clientY) / (ev.shiftKey ? 8 : 2), min, max); yPrev = ev.clientY; put(acc); });
    });
    box.addEventListener('wheel', e => { const wv = wheelIn(box, e); if (wv) put(get() + wheelStep(box, wv)); }, { passive: false });
    box.addEventListener('keydown', e => {
      const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
      if (d == null && e.key !== 'Home' && e.key !== 'End') return;
      e.preventDefault(); e.stopPropagation();
      put(e.key === 'Home' ? min : e.key === 'End' ? max : get() + d);
    });
    w.append(box, h('label', null, label));
    return w;
  };
  const steps = h('div', 'steps');
  const redraw = [];
  const rnd = h('button', 'seqbtn', 'Randomise'); rnd.type = 'button'; rnd.onclick = () => { seqRandom(q); redraw.forEach(f => f()); send(); };
  const clr = h('button', 'seqbtn', 'Clear'); clr.type = 'button';
  clr.onclick = () => { q.pat = q.pat.map(() => st(0, 0, 0, 0, 1)); redraw.forEach(f => f()); send(); };
  const dflt = h('button', 'seqbtn', 'Demo'); dflt.type = 'button';
  dflt.onclick = () => { q.pat = JSON.parse(JSON.stringify(SEQ_DEF.pat)); redraw.forEach(f => f()); send(); };
  const toRoll = h('button', 'seqbtn', '→ Piano roll'); toRoll.type = 'button';
  toRoll.title = 'Write this pattern into the track as notes (1 bar at the playhead) so you can edit and arrange it';
  toRoll.onclick = () => edit('Pattern to notes', () => {
    const at = S.snapTick(T.playing ? curTick() : T.pos, S.barTicks(project), 'floor');
    let prev = null;
    q.pat.forEach((s, i) => {
      if (!s.g) { prev = null; return; }
      const n = 48 + s.n + 12 * s.o, t = at + i * 240;
      if (prev && prev.slide) { prev.note.d = t - prev.note.t + 60; }
      const note = { id: S.newId(), t, d: 120, n, v: s.a ? 127 : 80 };
      tr.notes.push(note);
      prev = { note, slide: !!s.s };
    });
  }, [tr]);
  bar.append(run, sync, numCtl('Tempo', () => q.bpm, v => { q.bpm = v; }, 40, 220, ''), numCtl('Swing', () => q.swing, v => { q.swing = v; }, 0, 50, '%'), rnd, dflt, clr, toRoll,
    h('span', 'seqhint', 'Drag a note up/down · ACC = accent · SLD = slide into next step · click the LED to make a rest'));
  q.pat.forEach((s, i) => {
    const col = h('div', 'step' + (i % 4 === 0 ? ' beat' : ''));
    const led = h('button', 'sled'); led.type = 'button'; led.title = 'Note / rest';
    const note = h('div', 'snote'); note.tabIndex = 0;
    note.setAttribute('role', 'slider'); note.setAttribute('aria-label', `Step ${i + 1} note`);
    note.setAttribute('aria-valuemin', 0); note.setAttribute('aria-valuemax', 12);
    const mk = (txt, key, val) => { const b = h('button', 'sbtn', txt); b.type = 'button'; b.onclick = () => { s[key] = s[key] === val ? 0 : val; draw(); send(); }; return b; };
    const up = mk('UP', 'o', 1), dn = mk('DN', 'o', -1), acc = mk('ACC', 'a', 1), sld = mk('SLD', 's', 1);
    led.onclick = () => { s.g = s.g ? 0 : 1; draw(); send(); };
    const draw = () => {
      note.textContent = s.g ? SEQ_NOTES[s.n] : '—';
      note.setAttribute('aria-valuenow', s.n); note.setAttribute('aria-valuetext', s.g ? SEQ_NOTES[s.n] : 'rest');
      col.classList.toggle('rest', !s.g);
      up.classList.toggle('on', s.o === 1); dn.classList.toggle('on', s.o === -1);
      acc.classList.toggle('on', !!s.a); sld.classList.toggle('on', !!s.s);
    };
    noMenu(note); hoverable(note);
    note.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.ctrlKey) return;
      e.preventDefault(); note.focus({ preventScroll: true });
      let a = s.n, yPrev = e.clientY;
      track(note, e, ev => { a = clamp(a + (yPrev - ev.clientY) / 9, 0, 12); yPrev = ev.clientY; const v = Math.round(a); if (v !== s.n) { s.n = v; s.g = 1; draw(); send(); } });
    });
    const nudge = d => { const v = clamp(s.n + d, 0, 12); if (v !== s.n) { s.n = v; s.g = 1; draw(); send(); } }; // a rest only becomes a note when the pitch actually moves
    note.addEventListener('wheel', e => { const wv = wheelIn(note, e); if (wv) nudge(wheelStep(note, wv)); }, { passive: false });
    note.addEventListener('keydown', e => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault(); e.stopPropagation();
      nudge(e.key === 'ArrowUp' ? 1 : -1);
    });
    draw(); redraw.push(draw);
    col.append(h('span', 'snum', String(i + 1)), led, note, up, dn, acc, sld);
    stepEls.push(col);
    steps.append(col);
  });
  sec.append(bar, steps);
  return sec;
}

/* ------------------------------------------------------ track headers */
function renderHeads() {
  const el = $('#heads');
  el.innerHTML = '';
  el.append(h('div', 'hruler', `${project.tracks.length} track${project.tracks.length === 1 ? '' : 's'}`));
  project.tracks.forEach((t, i) => {
    const row = h('div', 'head' + (t.id === project.selTrack ? ' sel' : ''));
    row.style.setProperty('--tc', t.color);
    row.dataset.id = t.id;
    row.addEventListener('pointerdown', e => { if (!e.target.closest('button, select, input')) selectTrack(t.id); });
    row.addEventListener('dblclick', e => { if (!e.target.closest('button, select, input')) openTab('roll'); });
    const top = h('div', 'hrow');
    const name = h('input', 'hname'); name.value = t.name; name.title = 'Track name'; name.setAttribute('aria-label', 'Track name');
    name.onchange = () => { hist.record(project); t.name = name.value.trim() || t.name; name.value = t.name; persist(); updateUndoUI(); if (t.id === project.selTrack) { $('#tabTrack').textContent = 'Track: ' + t.name; renderPanel(); } };
    name.addEventListener('keydown', e => { if (e.key === 'Enter') name.blur(); e.stopPropagation(); });
    const tb = (lbl, key, title, cls) => {
      const b = h('button', 'hb ' + cls, lbl); b.type = 'button'; b.title = title;
      b.setAttribute('aria-pressed', t[key] ? 'true' : 'false');
      b.onclick = () => {
        t[key] = !t[key];
        b.setAttribute('aria-pressed', t[key] ? 'true' : 'false');
        if (key !== 'arm') mix();
        if (key === 'arm' && !t.arm && T.rec) for (const [k, r] of recLive) if (r.tr === t) { commitNote(r, curTick()); recLive.delete(k); }
        arr && arr.render(); persist();
      };
      return b;
    };
    const meter = h('div', 'hmeter'); meter.append(h('i'));
    top.append(name, tb('M', 'mute', 'Mute', 'm'), tb('S', 'solo', 'Solo', 's'), tb('●', 'arm', 'Arm for recording', 'r'), meter);
    const bot = h('div', 'hrow');
    const msel = h('select', 'hmodel'); msel.title = 'Instrument'; msel.setAttribute('aria-label', 'Instrument');
    for (const m of MODELS) { const o = h('option', null, m.name); o.value = m.id; msel.append(o); }
    msel.value = t.model;
    msel.onchange = () => setTrackModel(t, msel.value);
    const psel = h('select', 'hpreset'); psel.title = 'Preset'; psel.setAttribute('aria-label', 'Preset');
    const o0 = h('option', null, t.preset ? t.preset : (t.preset === null ? 'Custom' : '—')); o0.value = ''; psel.append(o0);
    for (const p of presetList(modelById(t.model))) { const o = h('option', null, p.name); o.value = p.key; psel.append(o); }
    psel.value = '';
    psel.onchange = () => { const p = presetList(modelById(t.model)).find(x => x.key === psel.value); if (p) applyPreset(t, p); };
    const ch = h('select', 'hch'); ch.title = 'MIDI input channel'; ch.setAttribute('aria-label', 'MIDI input channel');
    for (let c = 0; c <= 16; c++) { const o = h('option', null, c ? 'Ch ' + c : 'Omni'); o.value = c; ch.append(o); }
    ch.value = t.ch;
    ch.onchange = () => { t.ch = +ch.value; persist(); };
    const vol = h('input', 'hvol'); vol.type = 'range'; vol.min = 0; vol.max = 1.25; vol.step = 0.01; vol.value = t.vol; vol.title = 'Volume'; vol.setAttribute('aria-label', 'Volume');
    vol.oninput = () => { t.vol = +vol.value; mix(); persist(); };
    vol.ondblclick = () => { t.vol = 0.8; vol.value = 0.8; mix(); persist(); };
    const pan = h('input', 'hpan'); pan.type = 'range'; pan.min = -1; pan.max = 1; pan.step = 0.01; pan.value = t.pan; pan.title = 'Pan (double-click to centre)'; pan.setAttribute('aria-label', 'Pan');
    pan.oninput = () => { t.pan = +pan.value; mix(); persist(); };
    pan.ondblclick = () => { t.pan = 0; pan.value = 0; mix(); persist(); };
    const dup = h('button', 'hb', '⧉'); dup.type = 'button'; dup.title = 'Duplicate track';
    dup.onclick = () => duplicateTrack(t);
    const del = h('button', 'hb', '✕'); del.type = 'button'; del.title = 'Delete track';
    del.onclick = () => deleteTrack(t);
    bot.append(msel, psel, ch, vol, pan, dup, del);
    row.append(top, bot);
    el.append(row);
    if (i === project.tracks.length - 1) row.classList.add('last');
  });
  $('#tabTrack').textContent = 'Track: ' + trk().name;
  arr && arr.render();
}
function addTrack(m = model, vals0 = null) {
  hist.record(project);
  const t = S.newTrack(project, { model: m.id, vals: vals0 ? JSON.parse(JSON.stringify(vals0)) : loadVals(m), name: `${m.name} ${project.tracks.length + 1}` });
  project.tracks.push(t);
  syncNodes();
  selectTrack(t.id);
  renderHeads(); persist(); updateUndoUI();
  return t;
}
function duplicateTrack(t) {
  hist.record(project);
  const c = S.newTrack(project, { model: t.model, vals: JSON.parse(JSON.stringify(t.vals)), name: t.name + ' copy', preset: t.preset });
  c.notes = S.cloneNotes(t.notes); c.cc = t.cc.map(x => ({ t: x.t, k: x.k, v: x.v }));
  c.vol = t.vol; c.pan = t.pan; c.ch = t.ch;
  if (t.seq) c.seq = JSON.parse(JSON.stringify(t.seq));
  project.tracks.splice(project.tracks.indexOf(t) + 1, 0, c);
  syncNodes(); sendSong(c, true);
  renderHeads(); persist(); updateUndoUI();
}
function deleteTrack(t) {
  if (project.tracks.length < 2) { alert('A project needs at least one track.'); return; }
  if (t.notes.length && !confirm(`Delete “${t.name}” and its ${t.notes.length} notes?`)) return;
  hist.record(project);
  const i = project.tracks.indexOf(t);
  project.tracks.splice(i, 1);
  seqRun.delete(t.id);
  if (project.selTrack === t.id) { project.selTrack = project.tracks[Math.max(0, i - 1)].id; bind(); renderNav(); renderPanel(); roll && roll.setTrack(); }
  syncNodes();
  renderHeads(); persist(); updateUndoUI();
}

/* ------------------------------------------------- arrangement + roll */
let arr = null, roll = null, range = null, lastArea = 'roll', notesClip = null, rangeClip = null;
function rangeUI() {
  const el = $('#aRange');
  const on = !!range;
  el.textContent = on ? `Bars ${S.fmtBBT(project, range[0])} → ${S.fmtBBT(project, range[1])}` : 'Drag across the lanes to select bars';
  for (const id of ['aCopy', 'aDup', 'aClear', 'aDel', 'aLoopSel']) $('#' + id).disabled = !on;
  $('#aPaste').disabled = !rangeClip;
}
function setLoop(s, e) {
  s = Math.max(0, Math.round(s)); e = Math.round(e);
  if (e <= s) return;
  project.loop.start = s; project.loop.end = e;
  if (!project.loop.on) project.loop.on = true;
  transportUI(); reanchor(false); persist();
  arr && arr.render(); roll && roll.render();
}
function initEditors() {
  arr = new Arrangement($('#lanes'), {
    getProject: () => project,
    selectTrack: id => selectTrack(id),
    openTrack: id => { selectTrack(id); openTab('roll'); },
    getPlayhead: () => curTick(),
    setPlayhead: t => seek(t),
    setLoop,
    getRange: () => range,
    setRange: (s, e) => { range = s == null || e == null || e <= s ? null : [Math.round(s), Math.round(e)]; rangeUI(); arr.render(); },
    rowHeight: 56,
  });
  roll = new PianoRoll($('#rollwrap'), {
    getProject: () => project,
    getTrack: () => trk(),
    edit: (label, fn) => edit(label, fn),
    beginEdit: () => { hist.record(project); gesture = true; updateUndoUI(); },
    endEdit: () => { gesture = false; changed(); },
    changed: () => { sendSong(trk()); arr && arr.render(); },
    audition: (n, v) => { postTo(trk(), { t: 'on', n, v: (v || 100) / 127 }); if (!ctx) powerOn().catch(() => {}); },
    auditionOff: n => postTo(trk(), { t: 'off', n }),
    getPlayhead: () => curTick(),
    setPlayhead: t => seek(t),
    setLoop,
    getSnap: () => project.snap,
    onSelect: n => { const el = $('#rSel'); if (el) el.textContent = n ? `${n} selected` : 'No selection (edits apply to all notes)'; },
  });
  $('#arrwrap').addEventListener('pointerdown', () => { lastArea = 'arr'; }, true);
  $('#rollwrap').addEventListener('pointerdown', () => { lastArea = 'roll'; }, true);
  rangeUI();
}

/* arrangement range operations */
function rangeOp(name) {
  if (name === 'paste') {
    if (!rangeClip) return;
    edit('Paste bars', () => S.pasteRange(project, rangeClip, S.snapTick(T.playing ? curTick() : T.pos, S.beatTicks(project), 'round'), { insert: false }), project.tracks);
    return;
  }
  if (name === 'insert') {
    const at = range ? range[0] : S.snapTick(T.pos, S.barTicks(project), 'floor');
    const n = parseInt(prompt('Insert how many bars?', '1'), 10);
    if (!(n > 0)) return;
    edit('Insert bars', () => S.insertTime(project, at, n * S.barTicks(project)), project.tracks);
    $('#tBars').value = project.bars;
    return;
  }
  if (!range) return;
  const [s, e] = range;
  if (name === 'copy') { rangeClip = S.copyRange(project, s, e); rangeUI(); return; }
  if (name === 'dup') { edit('Duplicate bars', () => S.duplicateRange(project, s, e), project.tracks); range = [e, e + (e - s)]; }
  if (name === 'clear') edit('Clear bars', () => S.clearRange(project, s, e), project.tracks);
  if (name === 'delete') { edit('Delete bars', () => S.deleteTime(project, s, e), project.tracks); range = null; }
  if (name === 'loop') setLoop(s, e);
  $('#tBars').value = project.bars;
  rangeUI(); arr.render(); roll.render();
}

/* piano-roll toolbar */
let tool = 'select';
function openTab(name) {
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.tab === name);
  $('#tab-inst').hidden = name !== 'inst';
  $('#tab-roll').hidden = name !== 'roll';
  if (name === 'roll') { roll.resize(); roll.render(); }
  store.set('synth.tab', name);
}
function gridSelect(value, onChange, withOff, title) {
  const s = h('select'); s.title = title || '';
  if (withOff) { const o = h('option', null, 'Off'); o.value = 0; s.append(o); }
  for (const g of S.GRIDS) { const o = h('option', null, g.label); o.value = g.t; s.append(o); }
  s.value = String(value);
  if (s.value !== String(value)) s.value = String(S.PPQ / 4);
  s.onchange = () => onChange(+s.value);
  return s;
}
function transform(label, fn) {
  const notes = roll.getTargetNotes();
  if (!notes.length) return;
  edit(label, () => fn(notes));
}
function quantizeNow() {
  const q = project.quantize;
  transform('Quantize', ns => S.quantize(ns, { grid: q.grid, strength: q.strength, swing: q.swing, starts: q.starts, ends: q.ends }));
}
function buildRollTools() {
  const bar = $('#rolltools');
  bar.innerHTML = '';
  const grp = (title, ...kids) => { const g = h('div', 'rgrp'); if (title) g.append(h('span', 'rlab', title)); g.append(...kids); bar.append(g); return g; };
  const btn = (txt, title, fn, cls) => { const b = h('button', cls || null, txt); b.type = 'button'; b.title = title; b.onclick = fn; return b; };
  const num = (val, min, max, step, title, onc, w) => { const i = h('input'); i.type = 'number'; i.min = min; i.max = max; i.step = step; i.value = val; i.title = title; i.style.width = (w || 52) + 'px'; i.onchange = () => onc(clamp(+i.value || 0, min, max)); i.addEventListener('keydown', e => e.stopPropagation()); return i; };
  const chk = (label, val, title, onc) => { const l = h('label', 'rchk'); const i = h('input'); i.type = 'checkbox'; i.checked = !!val; i.onchange = () => onc(i.checked); l.title = title; l.append(i, document.createTextNode(label)); return l; };
  // tools
  const tools = [['select', 'Select', 'Select / move / resize (1)'], ['draw', 'Draw', 'Draw notes (2)'], ['erase', 'Erase', 'Erase notes (3)']];
  const tb = tools.map(([k, l, ti]) => { const b = btn(l, ti, () => setTool(k)); b.dataset.tool = k; return b; });
  grp('Tool', ...tb);
  grp('Snap', gridSelect(project.snap, v => { project.snap = v; persist(); roll.render(); }, true, 'Grid that notes snap to while editing'),
    h('span', 'rlab', 'Length'), gridSelect(project.drawLen || 0, v => { project.drawLen = v; roll.setDrawLength(v); persist(); }, true, 'Length of new notes (Off = same as snap)'));
  const q = project.quantize;
  grp('Quantize', gridSelect(q.grid, v => { q.grid = v; persist(); }, false, 'Quantize grid'),
    h('span', 'rlab', 'Str'), num(q.strength, 0, 100, 5, 'Strength % (100 = hard)', v => { q.strength = v; persist(); }),
    h('span', 'rlab', 'Swing'), num(q.swing, 0, 100, 5, 'Swing % (100 = triplet feel)', v => { q.swing = v; persist(); }),
    chk('Starts', q.starts, 'Quantize note starts', v => { q.starts = v; persist(); }),
    chk('Ends', q.ends, 'Quantize note ends', v => { q.ends = v; persist(); }),
    btn('Quantize', 'Quantize the selection, or all notes when nothing is selected (Q)', quantizeNow, 'hot'));
  grp('Transpose', btn('−12', 'Down an octave', () => transform('Transpose', ns => S.transpose(ns, -12))), btn('−1', 'Down a semitone', () => transform('Transpose', ns => S.transpose(ns, -1))),
    btn('+1', 'Up a semitone', () => transform('Transpose', ns => S.transpose(ns, 1))), btn('+12', 'Up an octave', () => transform('Transpose', ns => S.transpose(ns, 12))));
  const vm = h('select'); vm.title = 'Velocity operation';
  for (const [k, l] of [['set', 'Set to'], ['scale', 'Scale %'], ['add', 'Add'], ['compress', 'Compress %'], ['random', 'Randomise ±'], ['ramp', 'Ramp up'], ['rampd', 'Ramp down']]) { const o = h('option', null, l); o.value = k; vm.append(o); }
  const vv = num(100, -127, 400, 1, 'Value', () => {}, 56);
  grp('Velocity', vm, vv, btn('Apply', 'Apply to selection (or all notes)', () => {
    const mode = vm.value, val = +vv.value;
    transform('Velocity', ns => mode === 'ramp' ? S.velocity(ns, { mode: 'ramp', value: [Math.max(1, Math.min(127, 127 - val)), 127] })
      : mode === 'rampd' ? S.velocity(ns, { mode: 'ramp', value: [127, Math.max(1, Math.min(127, 127 - val))] })
        : S.velocity(ns, { mode, value: val }));
  }));
  grp('Notes', btn('Legato', 'Extend each note to the next one', () => transform('Legato', ns => S.legato(ns, { gap: 0 }))),
    btn('Humanize', 'Small random timing and velocity changes', () => transform('Humanize', ns => S.humanize(ns, { timing: 12, velocity: 10, seed: (Math.random() * 1e9) | 0 }))),
    btn('×2', 'Stretch to double length (half speed)', () => transform('Stretch', ns => S.scaleTime(ns, 2))),
    btn('÷2', 'Compress to half length (double speed)', () => transform('Compress', ns => S.scaleTime(ns, 0.5))),
    btn('Reverse', 'Reverse note order in time', () => transform('Reverse', ns => S.reverse(ns))),
    btn('Fix overlaps', 'Trim overlapping notes of the same pitch and remove duplicates', () => transform('Fix overlaps', ns => S.fixOverlaps(ns, trk()))),
    btn('Split at playhead', 'Cut notes that cross the playhead', () => { const at = Math.round(curTick()); edit('Split', () => { const add = S.splitAt(roll.getTargetNotes(), at); trk().notes.push(...add); }); }));
  grp('Edit', btn('All', 'Select all (Ctrl/⌘ A)', () => roll.selectAll()), btn('Invert', 'Invert selection', () => roll.invertSelection()), btn('None', 'Deselect (Esc)', () => roll.selectNone()),
    btn('Cut', 'Cut (Ctrl/⌘ X)', () => clipOp('cut')), btn('Copy', 'Copy (Ctrl/⌘ C)', () => clipOp('copy')), btn('Paste', 'Paste at the insert point / playhead (Ctrl/⌘ V)', () => clipOp('paste')),
    btn('Duplicate', 'Duplicate selection after itself (Ctrl/⌘ D)', () => roll.duplicate()), btn('Delete', 'Delete selection (Del)', () => roll.deleteSelected()));
  const follow = chk('Follow', project.follow !== false, 'Scroll with the playhead', v => { project.follow = v; roll.setFollow(v); persist(); });
  const ghosts = chk('Ghosts', !!project.ghosts, 'Show other tracks’ notes faintly', v => { project.ghosts = v; roll.setGhosts(v); persist(); });
  grp('View', btn('−', 'Zoom out', () => roll.zoomX(1 / 1.4)), btn('+', 'Zoom in', () => roll.zoomX(1.4)), btn('Fit', 'Fit notes', () => roll.fit()), follow, ghosts);
  const sel = h('span', 'rsel'); sel.id = 'rSel'; sel.textContent = 'No selection (edits apply to all notes)';
  bar.append(sel);
  roll.setFollow(project.follow !== false); roll.setGhosts(!!project.ghosts); roll.setDrawLength(project.drawLen || 0);
  setTool(tool);
}
function setTool(k) {
  tool = k; roll.setTool(k);
  for (const b of document.querySelectorAll('#rolltools [data-tool]')) b.classList.toggle('on', b.dataset.tool === k);
}
function clipOp(op) {
  if (op === 'copy') { const c = roll.copy(); if (c) notesClip = c; }
  else if (op === 'cut') { const c = roll.cut(); if (c) notesClip = c; }
  else if (op === 'paste' && notesClip) roll.paste(notesClip);
}

/* ----------------------------------------------------- transport UI */
function transportUI() {
  $('#tPlay').classList.toggle('on', T.playing);
  $('#tPlay').setAttribute('aria-label', T.playing ? 'Stop' : 'Play');
  $('#tRec').setAttribute('aria-pressed', T.rec ? 'true' : 'false');
  $('#tLoop').setAttribute('aria-pressed', project.loop.on ? 'true' : 'false');
  $('#tMetro').setAttribute('aria-pressed', project.metronome.on ? 'true' : 'false');
  $('#tInQ').setAttribute('aria-pressed', project.rec.inputQuantize ? 'true' : 'false');
  document.body.classList.toggle('recording', T.rec);
}
function posUI(t = curTick()) {
  if (!T.playing) { roll && roll.setPlayhead(t); arr && arr.setPlayhead(t); }
  $('#tBBT').textContent = S.fmtBBT(project, Math.round(t));
  const s = S.ticksToSec(project, Math.max(0, t));
  $('#tTime').textContent = `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`;
}
function projectUI() {
  $('#tBpm').value = project.bpm; $('#tSigN').value = project.sig[0]; $('#tSigD').value = project.sig[1]; $('#tBars').value = project.bars;
  $('#tCount').value = String(project.metronome.countIn | 0); $('#tRecMode').value = project.rec.mode;
  transportUI(); posUI();
}
function renderAll(newTrack = true) {
  renderNav(); renderPanel(); renderHeads(); projectUI(); buildRollTools();
  if (newTrack) { roll && roll.setTrack(); arr && arr.fit(); } else { roll && roll.render(); arr && arr.render(); }
  updateUndoUI(); rangeUI();
}
function initTransport() {
  $('#tPlay').onclick = () => (T.playing ? stop() : play());
  $('#tStart').onclick = () => seek(project.loop.on && T.playing ? project.loop.start : 0);
  $('#tRec').onclick = toggleRec;
  $('#tLoop').onclick = () => { project.loop.on = !project.loop.on; transportUI(); reanchor(false); arr.render(); roll.render(); persist(); };
  $('#tMetro').onclick = () => { project.metronome.on = !project.metronome.on; transportUI(); persist(); };
  $('#tInQ').onclick = () => { project.rec.inputQuantize = !project.rec.inputQuantize; transportUI(); persist(); };
  $('#tCount').onchange = e => { project.metronome.countIn = +e.target.value; persist(); };
  $('#tRecMode').onchange = e => { project.rec.mode = e.target.value; persist(); };
  const numIn = (id, fn) => { const el = $('#' + id); el.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') el.blur(); }); el.onchange = () => fn(el); };
  numIn('tBpm', el => { project.bpm = clamp(+el.value || 120, 20, 300); el.value = project.bpm; reanchor(false); persist(); for (const t of project.tracks) if (t.model === 'tb303' && t.seq && t.seq.sync) seqSend(t); });
  numIn('tSigN', el => { project.sig = [clamp(Math.round(+el.value) || 4, 1, 16), project.sig[1]]; el.value = project.sig[0]; reanchor(false); arr.render(); roll.render(); persist(); });
  $('#tSigD').onchange = e => { project.sig = [project.sig[0], +e.target.value]; reanchor(false); arr.render(); roll.render(); persist(); };
  numIn('tBars', el => { project.bars = clamp(Math.round(+el.value) || 1, 1, 999); el.value = project.bars; arr.fit(); persist(); });
  $('#tUndo').onclick = undo; $('#tRedo').onclick = redo;
  $('#aAdd').onclick = () => addTrack();
  $('#aMulti').onclick = () => { project.tracks.forEach((t, i) => { t.ch = (i % 16) + 1; }); renderHeads(); persist(); };
  $('#aCopy').onclick = () => rangeOp('copy'); $('#aPaste').onclick = () => rangeOp('paste'); $('#aDup').onclick = () => rangeOp('dup');
  $('#aClear').onclick = () => rangeOp('clear'); $('#aDel').onclick = () => rangeOp('delete'); $('#aIns').onclick = () => rangeOp('insert');
  $('#aLoopSel').onclick = () => rangeOp('loop');
  for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => openTab(b.dataset.tab);
  // files
  $('#fNew').onclick = () => {
    if (!confirm('Start a new empty project? (The current one can be undone with Ctrl/⌘ Z.)')) return;
    hist.record(project);
    if (T.playing) stop();
    const p = freshProject(model);
    applyRestore(p);
  };
  $('#fSave').onclick = () => download(new Blob([S.serialize(project)], { type: 'application/json' }), slug(project.name) + '.synth.json');
  $('#fMidi').onclick = () => download(new Blob([S.exportMIDI(project)], { type: 'audio/midi' }), slug(project.name) + '.mid');
  $('#fOpen').onclick = () => $('#fFile').click();
  $('#fFile').onchange = async e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      if (/\.midi?$/i.test(f.name) || f.type.includes('midi')) importMidiFile(new Uint8Array(await f.arrayBuffer()), f.name);
      else { const p = loadProject(await f.text()); hist.record(project); if (T.playing) stop(); applyRestore(p); }
    } catch (err) { alert('Could not open that file: ' + err.message); }
  };
  $('#fBounce').onclick = () => openBounce();
  $('#bCancel').onclick = () => { $('#modal').hidden = true; };
  $('#bGo').onclick = () => bounce();
  $('#modal').addEventListener('pointerdown', e => { if (e.target.id === 'modal') $('#modal').hidden = true; });
}
function slug(s) { return (s || 'untitled').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'untitled'; }
function download(blob, name) {
  const url = URL.createObjectURL(blob), a = h('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function importMidiFile(bytes, fname) {
  const r = S.importMIDI(bytes);
  if (!r.tracks.length) { alert('That MIDI file has no notes.'); return; }
  hist.record(project);
  const empty = project.tracks.every(t => !t.notes.length && !t.cc.length);
  if (empty) { project.tracks = []; project.bpm = r.bpm; project.sig = r.sig; if (r.name) project.name = r.name; else project.name = fname.replace(/\.midi?$/i, ''); }
  const m = model;
  for (const it of r.tracks) {
    const t = S.newTrack(project, { model: m.id, vals: loadVals(m), name: it.name || `${m.name} ${project.tracks.length + 1}` });
    t.notes = it.notes.map(n => ({ id: S.newId(), t: n.t, d: n.d, n: n.n, v: n.v }));
    t.cc = it.cc.slice(); t.ch = 0;
    project.tracks.push(t);
  }
  project.selTrack = project.tracks[0].id;
  fitBars();
  const bt = S.barTicks(project);
  project.loop.start = 0; project.loop.end = Math.max(bt, Math.min(project.bars, 8) * bt);
  applyRestore(project);
}

/* ------------------------------------------------------------ bounce */
function openBounce() {
  $('#bRange').value = range ? 'sel' : project.loop.on ? 'loop' : 'song';
  $('#bRange').querySelector('[value=sel]').disabled = !range;
  $('#bNote').textContent = 'Renders every audible track (mute/solo respected) offline — no clicks or dropouts regardless of CPU.';
  $('#bGo').disabled = false;
  $('#modal').hidden = false;
}
async function bounce() {
  const rsel = $('#bRange').value, sr = +$('#bSr').value, bits = +$('#bBits').value, tail = +$('#bTail').value, norm = $('#bNorm').checked;
  const os = Math.min(+$('#bOs').value, osCap(sr)); // same 384 kHz internal cap as live playback
  const [start, end] = rsel === 'sel' && range ? range : rsel === 'loop' ? [project.loop.start, project.loop.end] : [0, S.songEnd(project)];
  if (!(end > start)) { alert('Nothing to render.'); return; }
  const note = $('#bNote'), go = $('#bGo');
  go.disabled = true;
  const secs = S.ticksToSec(project, end) - S.ticksToSec(project, start) + tail;
  const t0 = performance.now();
  note.textContent = `Rendering ${secs.toFixed(1)} s at ${kHz(sr)} kHz × ${os} (${kHz(sr * os)} kHz internal)…`;
  try {
    const oc = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(secs * sr), sampleRate: sr });
    await oc.audioWorklet.addModule('engine.js?v=' + VERSION);
    const bus = oc.createGain(); bus.connect(oc.destination);
    const f = sr * 60 / (project.bpm * S.PPQ);
    let n = 0;
    for (const tr of project.tracks) {
      if (!audible(tr)) continue;
      const synced = tr.model === 'tb303' && tr.seq && tr.seq.sync;
      if (!tr.notes.length && !synced) continue;
      const node = new AudioWorkletNode(oc, 'synth-engine', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
        processorOptions: { os, patch: buildPatch(tr, sr), song: songData(tr, start, end), transport: { play: true, frame: 0, tick: start, fpt: f, loop: false, end }, seq: synced ? seqPayload(tr, { run: false }) : null },
      });
      const g = oc.createGain(), p = oc.createStereoPanner();
      g.gain.value = tr.vol; p.pan.value = tr.pan;
      node.connect(g); g.connect(p); p.connect(bus);
      n++;
    }
    if (!n) { note.textContent = 'No audible tracks with notes in that range.'; go.disabled = false; return; }
    const buf = await oc.startRendering();
    const chs = [buf.getChannelData(0), buf.getChannelData(1)];
    let peak = 0;
    for (const c of chs) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > peak) peak = a; }
    const target = norm ? Math.pow(10, -0.3 / 20) : peak > 0.999 ? 0.999 : peak;
    if (peak > 0 && (norm || peak > 0.999)) { const k = target / peak; for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= k; }
    const wav = S.encodeWAV(chs, sr, bits);
    download(new Blob([wav], { type: 'audio/wav' }), `${slug(project.name)}-${sr / 1000}k-${bits}${bits === 32 ? 'f' : 'bit'}.wav`);
    note.textContent = `Done: ${secs.toFixed(1)} s rendered in ${((performance.now() - t0) / 1000).toFixed(1)} s · peak ${(20 * Math.log10(Math.max(1e-9, peak))).toFixed(1)} dBFS${peak > 0.999 && !norm ? ' (scaled to avoid clipping)' : ''}.`;
  } catch (err) {
    note.textContent = 'Render failed: ' + err.message;
  }
  go.disabled = false;
}

/* ---------------------------------------------------------- keyboard */
// Notes and the octave/velocity keys go by physical key (KeyboardEvent.code), so Shift/Option, AZERTY/QWERTZ and dead
// keys can't change which note a key plays or leave a note without its note-off. Labels show the user's own legends.
const CODEMAP = { KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17 };
const CTLKEYS = { KeyZ: -1, KeyX: 1, KeyC: -16, KeyV: 16 }; // octave − / +, velocity − / +
const keyLab = {}; // code -> legend (US defaults; replaced by the real layout when the browser tells us)
for (const c of [...Object.keys(CODEMAP), ...Object.keys(CTLKEYS)]) keyLab[c] = c.startsWith('Key') ? c.slice(3).toLowerCase() : c === 'Semicolon' ? ';' : "'";
const CUTKEYS = { KeyR: 'r', KeyM: 'm', KeyQ: 'q', Digit1: '1', Digit2: '2', Digit3: '3' }; // shortcut letters: their own legend, else this position
for (const c in CUTKEYS) keyLab[c] = CUTKEYS[c];
const KEY2CODE = Object.fromEntries(Object.entries(keyLab).map(([c, l]) => [l, c])); // for events with an empty .code
const KEYLAB = Object.fromEntries(Object.entries(CODEMAP).map(([c, v]) => [v, c])); // semitone -> code
function relabel() {
  const comp = 60 + 12 * octave;
  for (const [n, el] of keyEls) { const s = el.querySelector('.kb'); if (s) s.textContent = keyLab[KEYLAB[n - comp]] || ''; }
  for (const k of document.querySelectorAll('kbd[data-code]')) k.textContent = (keyLab[k.dataset.code] || '?').toUpperCase();
}
function learnLayout() {
  try {
    const kb = navigator.keyboard;
    if (!kb || !kb.getLayoutMap) return;
    kb.getLayoutMap().then(m => {
      let ch = false;
      for (const c in keyLab) { const v = m.get(c); if (v && v !== keyLab[c]) { keyLab[c] = v; ch = true; } }
      if (ch) relabel();
    }).catch(() => {});
  } catch { /* not available in this context */ }
}
const hk = new Map(); // physical key code -> note it is holding
function releaseKeys() { for (const n of hk.values()) noteOff(n); hk.clear(); }
const textEntry = t => !!t && (t.isContentEditable || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !/^(range|checkbox|radio|button|submit|reset|color|file)$/i.test(t.type)));
let kbFoc = null; // the element that last got focus from the keyboard (Tab, shortcuts), not from a click or touch
const kbFocus = t => !!t && t === kbFoc;
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
  const lit = new Set([...held.keys()].map(k => +k.split(':')[1]));
  for (let n = kbLo; n <= hi; n++) {
    const k = h('div', 'key ' + (isBlack(n) ? 'b' : 'w'));
    k.dataset.n = n;
    if (isBlack(n)) { k.style.left = `calc(${wi * ww - bw / 2}% )`; k.style.width = bw + '%'; }
    else { k.style.left = wi * ww + '%'; k.style.width = `calc(${ww}% + 1px)`; wi++; if (n % 12 === 0) k.append(h('span', 'nm', 'C' + (n / 12 - 1))); }
    const kc = KEYLAB[n - comp];
    if (kc && w > 600) k.append(h('span', 'kb', keyLab[kc]));
    if (lit.has(n)) k.classList.add('down');
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
    if (e.button > 0) return;
    const n = keyAt(e.clientX, e.clientY); if (n == null) return;
    el.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, n);
    noteOn(n, velAt(e.clientY, n), 0, e.timeStamp);
  });
  el.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    const n = keyAt(e.clientX, e.clientY), o = ptrs.get(e.pointerId);
    if (n === o) return;
    if (o != null && ![...ptrs.entries()].some(([id, v]) => id !== e.pointerId && v === o)) noteOff(o, 0, e.timeStamp);
    ptrs.set(e.pointerId, n);
    if (n != null) noteOn(n, velAt(e.clientY, n), 0, e.timeStamp);
  });
  const end = e => {
    if (!ptrs.has(e.pointerId)) return;
    const o = ptrs.get(e.pointerId); ptrs.delete(e.pointerId);
    if (o != null && ![...ptrs.values()].includes(o)) noteOff(o, 0, e.timeStamp);
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
  el.addEventListener('contextmenu', e => e.preventDefault());

  window.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;
    const t = e.target, k = (e.key || '').toLowerCase(), code = e.code || KEY2CODE[k] || '';
    const inRoll = !$('#tab-roll').hidden && lastArea === 'roll';
    if (k === 'escape') { // works whatever has focus
      if (!$('#modal').hidden) { $('#modal').hidden = true; return; }
      if (textEntry(t) || (t && t.tagName === 'SELECT')) t.blur();
      if (inRoll && roll.getSelection().length) roll.selectNone(); else panic();
      return;
    }
    if (textEntry(t) || !$('#modal').hidden) return; // only real text entry keeps the keys
    const mod = e.metaKey || e.ctrlKey;
    if (mod) {
      if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (k === 'y') { e.preventDefault(); redo(); }
      else if (k === 's') { e.preventDefault(); $('#fSave').click(); }
      else if (lastArea === 'arr' && range && ['c', 'x', 'v', 'd'].includes(k)) {
        e.preventDefault();
        if (k === 'c') rangeOp('copy'); else if (k === 'x') { rangeOp('copy'); rangeOp('delete'); } else if (k === 'v') rangeOp('paste'); else rangeOp('dup');
      } else if (lastArea === 'arr' && k === 'v' && rangeClip) { e.preventDefault(); rangeOp('paste'); }
      else if (inRoll) {
        if (k === 'a') { e.preventDefault(); roll.selectAll(); }
        else if (k === 'c') { e.preventDefault(); clipOp('copy'); }
        else if (k === 'x') { e.preventDefault(); clipOp('cut'); }
        else if (k === 'v') { e.preventDefault(); clipOp('paste'); }
        else if (k === 'd') { e.preventDefault(); roll.duplicate(); }
      }
      return;
    }
    const pk = code in CODEMAP || code in CTLKEYS, sk = /^[rmq123]$/.test(k) ? k : CUTKEYS[code] || '';
    if (t && t.tagName === 'SELECT') { // a tabbed-to select keeps arrows/Enter/type-ahead, but not the play keys; one left
      if (!pk && (kbFocus(t) || !(sk || k === ' '))) return; // focused by the mouse gives up the shortcut keys too
      e.preventDefault(); t.blur(); // preventDefault stops the type-ahead from silently picking another option
    }
    if (t && t.tagName === 'INPUT' && /^(arrow|page|home$|end$)/.test(k)) return; // focused slider/checkbox: native keys
    if (k === ' ' && t && (t.tagName === 'BUTTON' || (t.tagName === 'INPUT' && /^(checkbox|radio)$/i.test(t.type))) && kbFocus(t)) return; // Space activates a keyboard-focused control
    if (e.altKey && !(code in CODEMAP)) return;
    if (e.repeat) { if (pk || k === ' ' || k.startsWith('arrow')) e.preventDefault(); if (inRoll && k.startsWith('arrow')) nudgeKey(e, k); return; }
    if (code in CODEMAP) {
      e.preventDefault();
      if (e.code && !e.shiftKey && !e.altKey && k.length === 1 && keyLab[code] !== k) { keyLab[code] = k; relabel(); }
      const n = 60 + 12 * octave + CODEMAP[code];
      if (hk.has(code)) noteOff(hk.get(code), 0, e.timeStamp); // its keyup was lost (e.g. released under Cmd)
      hk.set(code, n);
      noteOn(n, settings.vel / 127, 0, e.timeStamp);
      return;
    }
    if (code in CTLKEYS) {
      e.preventDefault();
      const d = CTLKEYS[code];
      if (Math.abs(d) === 1) setOctave(octave + d); else setVel(settings.vel + d);
      return;
    }
    if (k === ' ') { e.preventDefault(); if (e.target && e.target.blur && e.target !== document.body) e.target.blur(); T.playing ? stop() : play(); return; }
    if (sk === 'r') { toggleRec(); return; }
    if (sk === 'm') { $('#tMetro').click(); return; }
    if (k === 'home') { e.preventDefault(); seek(0); return; }
    if (sk === 'q' && !$('#tab-roll').hidden) { quantizeNow(); return; }
    if ((k === 'delete' || k === 'backspace')) {
      e.preventDefault();
      if (lastArea === 'arr' && range) rangeOp('clear'); else if (!$('#tab-roll').hidden) roll.deleteSelected();
      return;
    }
    if (inRoll && k.startsWith('arrow')) { nudgeKey(e, k); return; }
    if (!$('#tab-roll').hidden && /^[123]$/.test(sk)) { setTool(['select', 'draw', 'erase'][+sk - 1]); return; }
  });
  window.addEventListener('keyup', e => {
    const k = (e.key || '').toLowerCase(), code = e.code || KEY2CODE[k] || '';
    if (hk.has(code)) { noteOff(hk.get(code), 0, e.timeStamp); hk.delete(code); }
    if (e.key === 'Meta' || e.key === 'OS') releaseKeys(); // macOS sends no keyup for keys released while Cmd is held
  });
  window.addEventListener('blur', releaseKeys);
  // a select/slider/checkbox changed with the mouse gives focus back to the page, so the computer keyboard plays again
  let ptrT = -1, keyT = 0;
  window.addEventListener('pointerdown', () => { ptrT = performance.now(); }, true);
  window.addEventListener('keydown', () => { keyT = performance.now(); }, true);
  document.addEventListener('focusin', e => { kbFoc = keyT > ptrT ? e.target : null; }, true); // input modality at focus time
  document.addEventListener('change', e => {
    const t = e.target;
    if (t && (t.tagName === 'SELECT' || (t.tagName === 'INPUT' && /^(range|checkbox|radio)$/i.test(t.type))) && ptrT >= keyT && t.blur) t.blur();
  }, true);
  learnLayout(); relabel();
}
function nudgeKey(e, k) {
  e.preventDefault();
  const snap = project.snap || S.PPQ / 4;
  if (k === 'arrowleft') roll.nudge(e.altKey ? -1 : -snap, 0);
  else if (k === 'arrowright') roll.nudge(e.altKey ? 1 : snap, 0);
  else if (k === 'arrowup') roll.nudge(0, e.shiftKey ? 12 : 1);
  else if (k === 'arrowdown') roll.nudge(0, e.shiftKey ? -12 : -1);
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
  noMenu(slot);
  slot.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.ctrlKey) return; // right/Ctrl-click: a context menu could swallow the release and strand the bend
    e.preventDefault();
    const r = slot.getBoundingClientRect();
    const at = ev => set(1 - (ev.clientY - r.top - 13) / (r.height - 26));
    at(e);
    track(slot, e, at, () => { if (spring) set(0.5); }); // ends on up/cancel/lost capture/no button: the bend always springs back
  });
  return set;
}
let setBendUI, setModUI;

/* -------------------------------------------------------------- MIDI */
// Web MIDI is only requested from the 'Enable MIDI' button (a permission prompt — in Firefox an add-on install dialog —
// should never be a side effect of Power); it connects by itself only when permission was already granted.
let midiInit = false;
async function initMIDI() {
  const b = $('#midi');
  if (!navigator.requestMIDIAccess) { b.textContent = 'MIDI: not supported in this browser'; b.disabled = true; b.classList.add('unsup'); return; }
  if (midiInit) return;
  midiInit = true;
  b.textContent = 'MIDI: connecting…';
  try {
    const m = await navigator.requestMIDIAccess();
    const hook = () => {
      const names = [];
      for (const inp of m.inputs.values()) { inp.onmidimessage = onMIDI; names.push(inp.name); }
      b.textContent = names.length ? 'MIDI: ' + names.join(', ') : 'MIDI: no devices';
      b.title = names.length ? 'Connected MIDI inputs' : 'Plug in a MIDI controller — it is picked up automatically';
    };
    hook(); m.onstatechange = hook;
  } catch {
    midiInit = false; // allow another try
    b.textContent = 'MIDI blocked — click to retry';
    b.title = 'If no prompt appears, allow MIDI for this site in the browser’s site settings';
  }
}
function initMIDIButton() {
  const b = $('#midi');
  if (!navigator.requestMIDIAccess) { initMIDI(); return; }
  b.onclick = () => initMIDI();
  try {
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'midi' }).then(s => {
        if (s.state === 'granted') initMIDI();
        s.onchange = () => { if (s.state === 'granted') initMIDI(); };
      }).catch(() => {});
    }
  } catch { /* 'midi' permission name unsupported */ }
}
function onMIDI(e) {
  const [st0, d1, d2] = e.data, cmd = st0 & 0xf0, ch = (st0 & 0x0f) + 1, ts = e.timeStamp;
  if (cmd === 0x90 && d2 > 0) noteOn(d1, d2 / 127, ch, ts);
  else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) noteOff(d1, ch, ts);
  else if (cmd === 0xb0) {
    if (d1 === 1) { ctl('wheel', d2 / 127, ch, ts); setModUI(d2 / 127, false); }
    else if (d1 === 64) { ctl('sus', d2 >= 64 ? 1 : 0, ch, ts); }
    else if (d1 === 120 || d1 === 123) { for (const k of [...held.keys()]) if (k.startsWith(ch + ':')) noteOff(+k.split(':')[1], ch, ts); }
  } else if (cmd === 0xe0) {
    const v = ((d2 << 7) | d1) / 8192 - 1;
    ctl('bend', v, ch, ts); setBendUI((v + 1) / 2, false);
  } else if (cmd === 0xd0) ctl('at', d1 / 127, ch, ts);
}

/* ------------------------------------------------------------- scope */
let scopeMode = 'wave';
const td = new Float32Array(8192), fd = new Float32Array(4096);
function drawScope() {
  const cv = $('#scope');
  if (!cv.offsetParent) return;
  const dpr = window.devicePixelRatio || 1;
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

/* ----------------------------------------------------- animation loop */
function frame() {
  requestAnimationFrame(frame);
  if (T.playing && T.a && ctx) {
    const t = curTick();
    posUI(t);
    roll && roll.setPlayhead(t); arr && arr.setPlayhead(t);
    replaceSweep(t);
    if (!project.loop.on && !T.rec && t > S.songEnd(project) + S.barTicks(project)) stop();
  }
  for (const t of project.tracks) {
    const N = nodes.get(t.id);
    const el = document.querySelector(`.head[data-id="${t.id}"] .hmeter i`);
    if (!el) continue;
    let p = 0;
    if (N) { N.an.getFloatTimeDomainData(N.buf); for (let i = 0; i < N.buf.length; i++) { const a = Math.abs(N.buf[i]); if (a > p) p = a; } }
    N && (N.peak = Math.max(p, N.peak * 0.88));
    const v = N ? N.peak : 0;
    el.style.width = Math.min(100, v > 1e-4 ? (1 + Math.log10(v) / 3) * 100 : 0).toFixed(1) + '%';
    el.classList.toggle('clip', v > 0.98);
  }
  drawScope();
}

/* -------------------------------------------------------------- boot */
function boot() {
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  defs.setAttribute('width', 0); defs.setAttribute('height', 0); defs.style.position = 'absolute';
  defs.innerHTML = '<defs><radialGradient id="knobShine" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity="0.22"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.04"/><stop offset="1" stop-color="#000" stop-opacity="0.25"/></radialGradient></defs>';
  document.body.prepend(defs);

  initEditors();
  initTransport();
  renderAll();
  buildKeys(); initKeys();
  openTab(store.get('synth.tab', 'inst'));

  // Power: on; off when the engine was running as the press began; a context the browser suspended/interrupted is resumed
  // rather than closed. The state is taken before wake() below runs: by the click it may already have resumed the context.
  let press = null;
  const pressStart = e => { if (e.repeat) return; const c = ctx || pendCtx; press = { el: e.target, c, run: !!c && c.state === 'running' }; };
  window.addEventListener('pointerdown', pressStart, true); window.addEventListener('keydown', pressStart, true);
  $('#power').onclick = () => {
    const c = ctx || pendCtx, p = press && press.c === c && press.el && press.el.closest && press.el.closest('#power') ? press : null; press = null;
    if (!c) powerOn().catch(() => {}); else if (p ? p.run : c.state === 'running') powerOff(); else wake();
  };
  // every gesture tries to (re)start a suspended context while it still counts as user activation (touch: on release)
  for (const t of ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click']) window.addEventListener(t, wake, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { releaseKeys(); flush(); } else wake(); });
  window.addEventListener('scroll', () => { pageScrollT = performance.now(); }, { capture: true, passive: true });
  const sr = $('#sr'), os = $('#os'), drift = $('#drift'), mst = $('#master'), vel = $('#vel');
  if (![...os.options].some(o => +o.value === settings.os)) settings.os = 4;
  sr.value = String(settings.sr); os.value = String(settings.os); drift.value = settings.drift; mst.value = settings.master;
  vel.value = settings.vel; $('#velv').textContent = settings.vel;
  rateLabels();
  // new context created synchronously in the handler, so it is still inside the user's gesture
  sr.onchange = () => { settings.sr = +sr.value; persist(); rateLabels(); if (ctx || pendCtx) { powerOff(); powerOn().catch(() => {}); } };
  os.onchange = () => { settings.os = +os.value; persist(); hotT = 0; if (ctx) postAll({ t: 'os', v: osFor(ctx.sampleRate) }); rateText(); rateLabels(); };
  drift.oninput = () => { settings.drift = +drift.value; persist(); for (const t of project.tracks) queuePatch(t); };
  mst.oninput = () => { settings.master = +mst.value; persist(); if (master) master.gain.setTargetAtTime(settings.master, ctx.currentTime, 0.02); };
  vel.oninput = () => setVel(+vel.value);
  $('#octdn').onclick = () => setOctave(octave - 1);
  $('#octup').onclick = () => setOctave(octave + 1);
  $('#panic').onclick = panic;
  $('#hold').onclick = () => setSustain(!sustain);
  $('#kbHide').onclick = () => {
    const row = $('#kbrow'), hide = !row.hidden;
    row.hidden = hide; $('#kbHide').textContent = hide ? '▴' : '▾'; $('#kbHide').setAttribute('aria-expanded', hide ? 'false' : 'true');
    store.set('synth.kbHidden', hide);
  };
  if (store.get('synth.kbHidden', false)) $('#kbHide').click();
  setBendUI = wheel('bend', true, v => ctl('bend', v * 2 - 1, 0));
  setModUI = wheel('modw', false, v => ctl('wheel', v, 0));
  for (const b of document.querySelectorAll('.scope-ctl button')) {
    b.onclick = () => { scopeMode = b.dataset.mode; for (const x of document.querySelectorAll('.scope-ctl button')) x.classList.toggle('on', x === b); };
  }
  let rw;
  window.addEventListener('resize', () => { clearTimeout(rw); rw = setTimeout(() => { buildKeys(); roll.resize(); arr.resize(); }, 120); });
  window.addEventListener('hashchange', () => { const m = MODELS.find(x => '#' + x.id === location.hash); if (m) setTrackModel(trk(), m.id); });
  window.addEventListener('pagehide', save);
  window.addEventListener('beforeunload', save);
  initMIDIButton();
  const why = audioProblem(); if (why) audioFail(why);
  powerUI();
  requestAnimationFrame(frame);
}
boot();
