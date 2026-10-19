import { MODELS, DX_ALGS, patchFor, groupSong } from './models.js?v=9';
import * as S from './song.js?v=9';
import { PianoRoll } from './roll.js?v=9';
import { Arrangement } from './arrange.js?v=9';
import * as core from './serum-core.js?v=9';
import { openAppStore, PROJECT_KEY, WT_DB, SMP_DB } from './appstore.js?v=9';
// canvas stage 1a (SPEC-canvas §5.8): project schema gate + uid; stage 1c: project v2 (cv-migrate toV2 / toV1 / the file
// mirror), the in-memory track (cv-model adopt: accessors onto the primary instrument), the canonical compile (cv-graph)
import * as CM from './cv-migrate.js?v=9';
import * as CG from './cv-graph.js?v=9';
import * as CMOD from './cv-model.js?v=9';
import { createAssetManager, portPoster, userIdsOf, userAssetIds, idKind, TEXT as ATEXT } from './assets.js?v=9';
import { createMidi, targets as midiTargets, noteCh, noteMsg } from './midi.js?v=9';
import { initApp } from './pwa.js?v=9';
import * as AC from './audioclock.js?v=9';
import { installGestures } from './gesture.js?v=9';
// stage 1b canvas shell (docs/canvas/IMPL-1b.md): SHELL lane cv-tray / cv-art, WORLD lane cv-world, MODULES lane cv-module / cv-cables
import * as cvTray from './cv-tray.js?v=9';
import * as cvArt from './cv-art.js?v=9';
import * as cvWorld from './cv-world.js?v=9';
import * as cvModule from './cv-module.js?v=9';
import * as cvCables from './cv-cables.js?v=9';
// stage 1e (IMPL-1e §4.6): per-device load estimates, soft caps and "Measure this device"
import * as COSTM from './cv-cost.js?v=9';
// the hardware front panels (docs/canvas/IMPL-panels.md, ENGINE lane): fixed-size classic instruments, Hardware / Simple
import * as cvPanel from './cv-panel.js?v=9';
// stage 1c: the classic panel as an instance (renderPanel, controls, preset plate, TB-303 sequencer with their track passed in)
import { ClassicPanel, fmt, SEQ_DEF } from './classic-panel.js?v=9';
import { fitCanvas } from './wk.js?v=9'; // (the OUT module's scope store: the same kit instance as the canvas, its zoom)
// stage 2a (IMPL-2a §5): the modulator modules' bodies (cv-mods-ui) and the mod layer (cv-modlayer: inspector, Mod list, parameter list)
import * as cvModsUI from './cv-mods-ui.js?v=9';
import { createModLayer, refusal as modRefusal, STYLE as MOD_STYLE } from './cv-modlayer.js?v=9';

const VERSION = '9';
const $ = (s, el = document) => el.querySelector(s);
const h = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
// App storage (appstore.js, SPEC-serum2 §12.6, lead sign-off on §0.8 item 7): the IndexedDB database `synth-app` (key /
// value store + the project autosave as one record per track), migrated once from the Phase-1 localStorage keys, which
// stay as the read-only fallback; without a working IndexedDB the Phase-1 localStorage store. The interface is the
// Phase-1 one (synchronous get / set on a cache). Every failed write — a quota error in particular — shows a notice
// (notices raised before the page is up wait for boot).
// SYNTH Canvas (SPEC-canvas §5.6, stage 1a): the store is the canvas build's own — database `synth-canvas`, keys stored as
// `synthc.*` (the `synth.*` names below map to them), asset stores WT_DB / SMP_DB — so on a shared origin (localhost)
// main's data is never read or written. Schema gate (§5.8): a project saved by a newer SYNTH Canvas (autosave, file, or
// another window writing while this one is open) is opened read-only for the session: autosave off (the store refuses
// too), Save disabled, and a notice whose tap applies the waiting update (pwa.js) or reloads. A newer FILE locks only
// itself: the project carries newerSchema (in memory and History, never saved: it is never written) and while it is
// the current one nothing is saved and Save is off; Undo / New / Open bring back a project that saves as usual (the
// store, holding the user's own older project, stays unlocked).
let booted = false;
const early = [];
let readOnly = 0; // the newer schema met by the store (0: none) — the session is locked
// nothing may save the current project (readOnly first: goReadOnly may run before `project` exists)
const roNow = () => !!readOnly || !!(project && project.newerSchema > CM.SCHEMA);
const SAVE_TITLE = 'Download this project as a .json file'; // (= index.html #fSave)
function roUI() { // #fSave follows roNow (after a load, Undo / Redo, New)
  const b = document.getElementById('fSave'), ro = roNow();
  if (b) { b.disabled = ro; b.title = ro ? CM.READ_ONLY_NOTICE : SAVE_TITLE; }
}
function storeError(e) {
  if (e && e.readOnly) { goReadOnly(e.newer); return; }
  const txt = e && e.notice ? e.notice : e && e.fallback ? 'Storage problem — the app keeps working on this browser’s local storage' : '';
  if (!txt) return;
  const ms = e.stale || e.restored ? 20000 : 8000; // working on an older copy: shown longer
  if (booted) notice(txt, ms); else early.push([txt, ms]);
}
function goReadOnly(n) {
  if (!readOnly) { readOnly = n || CM.SCHEMA + 1; store.lock(); }
  roUI();
  if (booted) readOnlyNotice();
}
function readOnlyNotice() {
  const msg = CM.READ_ONLY_NOTICE;
  noticeActs.set(msg, () => { if (app && app.accept) app.accept(); else location.reload(); });
  notice(msg, 30000);
}
const store = await openAppStore({ onError: storeError, schema: CM.SCHEMA });
const modelById = id => MODELS.find(m => m.id === id) || MODELS[1];

// lat: the user's "Output latency" offset in ms (header Latency control, R5) — playhead, recording and host.latency
const settings = Object.assign({ sr: 0, os: 4, drift: 5, master: 0.8, model: 'minimoog', vel: 100, lat: 0 }, store.get('synth.settings', {}));
settings.lat = clamp(Math.round(+settings.lat) || 0, -50, 400);
let ctx = null, an = null, master = null, metroBus = null, powering = null;
let octave = 0, sustain = false;
// the selected track's current instrument's classic panel (classic-panel.js ClassicPanel), or null (a Serum); stage 1e: one
// ClassicPanel per mounted classic instrument (classicPanels, 'trackId/dev'), cpanel the current one's (cpSync)
let cpanel = null;
const classicPanels = new Map();
const uiOf = () => (cpanel ? cpanel.ui : EMPTY_UI), EMPTY_UI = new Map(); // its value updaters (id → fn; '@seqrun', '@preset')

/* ---------------------------------------------- Serum preferences (§9.7) */
// App-wide, stored by the Serum panel (serum-ui.js normPrefs) under synth.sx.prefs; read here for the patches of every
// track (smoothing scale, silence tails), new Serum tracks (oversampling, author, 3D view) and the mod wheel → WT pos.
// SPEC-serum2 §13.10 adds mpeDefault, mpeBendX, mpeYBi, midiFromPreset and ultra (serum-ui PREFS_DEFAULT / normPrefs).
const SX_PREFS = { tooltips: 1, dblClick: 'type', wheel: 1, view3d: 0, wheelWt: 0, limitDrop: 1, silenceTails: 1, defOs: 2, author: '', askPreset: 0, smooth: 1,
  mpeDefault: 0, mpeBendX: 0, mpeYBi: 0, midiFromPreset: 1, ultra: 0 };
function readPrefs() {
  const o = store.get('synth.sx.prefs', null), p = Object.assign({}, SX_PREFS, o && typeof o === 'object' ? o : {});
  p.smooth = Number.isFinite(+p.smooth) ? clamp(+p.smooth, 0.01, 8) : 1;
  p.defOs = p.defOs === 1 || p.defOs === 4 ? p.defOs : 2;
  p.author = typeof p.author === 'string' ? p.author.slice(0, 64) : '';
  for (const k of ['view3d', 'wheelWt', 'silenceTails', 'askPreset', 'mpeDefault', 'mpeBendX', 'mpeYBi', 'midiFromPreset', 'ultra']) p[k] = p[k] ? 1 : 0;
  return p;
}
let prefs = readPrefs();

/* ----------------------------------------------------------- project */
function defaults(m) {
  if (m.defaults) return m.defaults(prefs); // custom panel (Serum): { s } with the preferences applied
  const v = {}; for (const c of m.controls) v[c.id] = c.def; return v;
}
// new sounds: a model's last-used panel values; a Serum track starts from the user's default preset (Save as Default
// Preset, synth.sx.default, §13.12) or Init with the preferences (§2.1)
function sxDefault() { const d = store.get('synth.sx.default', null); return d && d.v && d.v.s && typeof d.v.s === 'object' ? d : null; }
function loadVals(m) {
  if (m.custom) { const d = sxDefault(); return d ? { s: core.normalizeSerum(clone(d.v.s)) } : defaults(m); }
  return Object.assign(defaults(m), store.get('synth.v.' + m.id, {}));
}
const isSx = t => !!t && t.model === 'serum';
// Every track owns an FX rack state (any model; kept when the model changes, §2.5). FX state v2 everywhere (RULINGS2 F1):
// a track holds a v2 state (three racks of instances, §2.5); a v1 state reaching a track — an old project or autosave, a
// preset, a chain, the default preset — is migrated where it enters (fx-core normalizeFx = migrateFx1 for v1 input: S1-variant
// instances that render bit-identically to the Phase-1 rack, §2.6.3), with the track's Serum state as refs so the instances
// its rows / locks / MIDI map address are kept. fxOf() migrates anything that is still v1 (an object with `p`) the same way.
const isV2Fx = fx => !!fx && typeof fx === 'object' && fx.v >= 2 && Array.isArray(fx.racks);
const fxOk = fx => !!fx && typeof fx === 'object' && (isV2Fx(fx) || (!!fx.p && typeof fx.p === 'object'));
function fxOf(t) {
  if (isV2Fx(t.fx)) return t.fx;
  if (t.dev && !CMOD.fxDevOf(t)) return core.defaultFx2(); // (stage 1e: a classic primary cabled straight to OUT has no rack — an empty one, detached: nothing inserted)
  t.fx =fxOk(t.fx) ? fxLoad(t.fx, isSx(t) && t.vals ? t.vals.s : undefined) : core.defaultFx2();
  return t.fx;
}
// the rack of a new track: a Serum track's from the default preset when it has one (migrated with its Serum state)
function newFx(m) { const d = m && m.custom ? sxDefault() : null; return d && fxOk(d.fx) ? fxLoad(clone(d.fx), d.v.s) : core.defaultFx2(); }
// the base value n of FX destination `id` (static g.* ids live in the Serum state) in a track's FX state: the instance's
// parameter (§3.16.4 fxDest; v1 ids of Hyper's Dimension rows resolve through RENAME1) — MIDI-learned controllers (midi.js writeCC)
function fxSet(t, id, n, dev) {
  const fx = dev ? fxOfDev(t, dev) : fxOf(t);
  const d = core.fxDest(id, fx);
  if (d && d.inst && d.inst.p && typeof d.inst.p === 'object') d.inst.p[d.pid] = n;
}
const clone = x => JSON.parse(JSON.stringify(x));
// stage 1e (IMPL-1e §3.3): the FX state of device `id` — a Serum's own (dev.fx), a panel's — migrated in place as fxOf
// does the primary's (a classic instrument: the panel it feeds; none: the primary's, fxOf)
function fxOfDev(t, id) {
  let d = t && t.dev ? t.dev[id] : null;
  if (d && d.kind === 'synth' && d.model !== 'serum') { const p = CMOD.destOf(t, id); d = p && t.dev[p].kind === 'panel' ? t.dev[p] : null; }
  if (!d) return fxOf(t);
  if (isV2Fx(d.fx)) return d.fx;
  d.fx = fxOk(d.fx) ? fxLoad(d.fx, d.model === 'serum' && d.vals ? d.vals.s : undefined) : core.defaultFx2();
  return d.fx;
}
// the devices besides the primary and its FX (stage 1e: they enter from outside too): Serum states and FX states
// normalised as loadProject does the primary's, a classic instrument's values over its model's defaults (bind)
function normDevs(t) {
  if (!t || !t.dev) return;
  const pid = CMOD.primId(t), f = CMOD.fxDevOf(t);
  for (const id of Object.keys(t.dev)) {
    const d = t.dev[id];
    if (id === pid || (f && id === f.id) || !d || typeof d !== 'object') continue;
    if (d.kind === 'synth') {
      const m = modelById(d.model);
      d.model = m.id;
      if (m.custom) { d.vals = { s: core.normalizeSerum(d.vals && d.vals.s) }; d.fx = d.fx && typeof d.fx === 'object' ? fxLoad(d.fx, d.vals.s) : core.defaultFx2(); }
      else d.vals = Object.assign(defaults(m), d.vals);
    } else if (d.kind === 'panel') d.fx = d.fx && typeof d.fx === 'object' ? fxLoad(d.fx) : core.defaultFx2();
  }
}

// song.deserialize validates the core schema; carry over the extras this UI keeps (303 patterns, FX racks, view
// prefs). Serum states and FX racks are normalised here (they enter from outside: autosave, files, §11.8).
function fxLoad(fx, refs) {
  try { return core.normalizeFx(fx, refs); } catch (err) { console.warn('FX rack unreadable: the default rack', err); return core.defaultFx2(); }
}
// Canvas (SPEC-canvas §5.8): the project is brought to this build's schema first (cv-migrate upgrade; it gets its uid) —
// or, saved by a newer build, opened read-only: an autosave for the session (goReadOnly, once it parsed); a file (o.file)
// as itself (p.newerSchema: roNow while it is the current project). Stage 1f: a track holding several instruments (a 1e
// project: autosave or file) opens as one track per instrument (cv-migrate splitTracks), with one notice for the project
let splitFrom = null; // the last loadProject's input when splitTracks changed it (boot keeps an autosave's: PRE_1F)
function loadProject(json, lo = {}) {
  splitFrom = null;
  let o = json;
  if (typeof json === 'string') { try { o = JSON.parse(json); } catch { throw new Error('Not a valid project file'); } }
  const up = CM.upgrade(o);
  o = up.p;
  if (!up.readOnly) {
    const sp = CM.splitTracks(o, { name: id => modelById(id).name });
    if (sp.p !== o) splitFrom = json;
    o = sp.p;
    if (sp.notices.length) { const txt = sp.notices.join(' · '); if (booted) notice(txt, 30000); else early.push([txt, 30000]); }
  }
  const p = S.deserialize(o);
  CM.stamp(p, o);
  p.perf = S.normPerf(p.perf); // (stage 2a: { wheel: { v: 1 } | null })
  for (const k of ['drawLen', 'follow', 'ghosts']) if (o && k in o) p[k] = o[k];
  const byId = new Map(((o && o.tracks) || []).map(t => [t && t.id, t]));
  for (const t of p.tracks) { // a record song.js read as v1 (no valid devices): its 303 pattern and rack from the record
    const r = byId.get(t.id);
    if (t.dev) continue;
    if (r && r.seq && Array.isArray(r.seq.pat)) t.seq = r.seq;
    if (r && r.fx && typeof r.fx === 'object') t.fx = r.fx;
  }
  CMOD.adopt(p); // (SPEC-canvas §5.4: v2 tracks with their accessors; the code below reads the primary through them)
  for (const t of p.tracks) {
    // SPEC-serum2 §12.6: Serum states through normalizeSerum (v1 → v2 migration, §2.6), FX states through §2.6.3's
    // normalizeFx — a v1 rack (any model) is migrated, migrateFx1(normalizeFxV1(fx), refs), with the track's Serum state
    // as refs (the instances its rows / locks / MIDI map address are kept); the migrated rack renders bit-identically
    // (golden shard 4) and the project is saved with v2 racks (§15.1 item 6)
    if (isSx(t)) t.vals = { s: core.normalizeSerum(t.vals && t.vals.s) };
    if (CMOD.fxDevOf(t)) t.fx = t.fx && typeof t.fx === 'object' ? fxLoad(t.fx, isSx(t) ? t.vals.s : undefined) : core.defaultFx2(); // (no FX device: none)
    normDevs(t); // (stage 1e: every other instrument and panel the same way)
  }
  if (up.readOnly) { if (lo.file) p.newerSchema = up.from; else goReadOnly(up.from); }
  return p;
}
function freshProject(m) {
  const p = CM.stamp(S.newProject({ model: m.id, vals: loadVals(m), name: 'Untitled', trackName: m.name + ' 1' }));
  for (const t of p.tracks) { t.fx = newFx(m); seedPend.add(t.id); }
  p.perf = S.normPerf(null); // (stage 2a: no Mod Wheel module yet)
  return CMOD.adopt(p);
}
const PRE_1F = 'synth.project.pre1f'; // (stored as synthc.project.pre1f)
const seedPend = new Set(); // tracks whose next patch re-seeds the FX rack's LFO phases (§4.2: loads, track creation)
let project;
{
  const raw = store.loadProject();
  if (store.info().readOnly) goReadOnly(store.info().newer); // (a newer autosave, even an unreadable one, is never replaced)
  try { project = raw ? loadProject(raw) : null; } catch { project = null; }
  // (1f) an autosave split into one track per instrument: the stored project as it was, kept once under PRE_1F before the
  // first save replaces it — never overwritten, recoverable by hand (HANDOVER §6)
  if (project && splitFrom && !store.raw(PRE_1F)) store.setRaw(PRE_1F, typeof splitFrom === 'string' ? splitFrom : JSON.stringify(splitFrom));
  if (!project) {
    const fromHash = MODELS.find(m => '#' + m.id === location.hash);
    project = freshProject(fromHash || modelById(settings.model));
    const old303 = store.get('synth.seq303', null);
    if (old303 && project.tracks[0].model === 'tb303') project.tracks[0].seq = old303;
  }
  for (const t of project.tracks) { if (!t.vals || typeof t.vals !== 'object') t.vals = loadVals(modelById(t.model)); fxOf(t); }
}
const hist = new S.History(200);
const trk = () => project.tracks.find(t => t.id === project.selTrack) || project.tracks[0];
/* Stage 1e (IMPL-1e §4.5): several instruments per track. The globals model / vals and the classic panel cpanel mean the
   selected track's CURRENT instrument (curDev: the last tapped instrument module, default the primary; bind() follows it).
   The single-instrument services (ClassicPanel, the preset actions, Save / Delete / Init sound, the 303 page, the Serum and
   FX rack hosts) take (t, dev) as a device view: the primary is its track itself (the transition accessors), another
   instrument a track-shaped view of that device (instView: id 'trackId/dev'; model / vals / preset / seq / fx of the
   device; name / colour / notes of the track); trOf / dvOf give the track and the device back. */
const curDevs = new Map(); // track id → its current instrument
// (stage 1f: one instrument per track in the UI — the current instrument is always the primary; curDevs / setCur stay for
// the cv.add / cv.setCur hooks and milestone 3's parts, unread here)
const curOf = t => CMOD.primId(t);
const trOf = x => (x && x.track) || x, dvOf = x => (x && x.track ? x.devId : null);
const VIEW = {
  get d() { return (this.track.dev && this.track.dev[this.devId]) || {}; },
  get id() { return this.track.id + '/' + this.devId; },
  get name() { return this.track.name; }, get color() { return this.track.color; }, get notes() { return this.track.notes; },
  get prim() { return this.devId; },
  get model() { return this.d.model; },
  set model(v) { if (v !== this.d.model) CMOD.setModel(this.track, this.devId, v, { vals: this.d.vals, preset: this.d.preset }); },
  get vals() { return this.d.vals; }, set vals(v) { this.d.vals = v; },
  get preset() { return this.d.preset; }, set preset(v) { this.d.preset = v; },
  get seq() { return this.d.seq; }, set seq(v) { if (v === undefined) delete this.d.seq; else this.d.seq = v; },
  get fx() { return fxOfDev(this.track, this.devId); },
  set fx(v) { const d = this.d; if (d.model === 'serum') d.fx = v; else { const p = CMOD.destOf(this.track, this.devId); if (p && this.track.dev[p].kind === 'panel') this.track.dev[p].fx = v; } },
};
const views = new WeakMap(); // track → Map(dev → its view)
function instView(t, dev) {
  if (!t || !t.dev || dev == null || dev === CMOD.primId(t) || !CMOD.instOf(t, dev)) return t;
  let M = views.get(t);
  if (!M) views.set(t, M = new Map());
  let v = M.get(dev);
  if (!v) { v = Object.create(VIEW); v.track = t; v.devId = dev; M.set(dev, v); }
  return v;
}
const curView = (t = trk()) => instView(t, curOf(t));
let model, vals;
function bind() {
  const t = trk(), v = curView(t); project.selTrack = t.id; model = modelById(v.model); v.model = model.id;
  if (model.custom) { if (!v.vals || !v.vals.s) v.vals = defaults(model); vals = v.vals; } // keeps the state object (panel, undo)
  else vals = v.vals = Object.assign(defaults(model), v.vals);
}
bind();

let saveT = 0;
// now: the page is going away (pagehide / beforeunload / hidden) — the IndexedDB store starts its transaction in this task
// (appstore saveNow), as Phase 1 wrote localStorage synchronously here
function save(now) {
  clearTimeout(saveT); saveT = 0;
  if (rollViewT) rollViewSave(); // a Piano Roll row height still waiting for its debounce
  store.set('synth.settings', settings);
  if (!model.custom) store.set('synth.v.' + model.id, vals);
  // = song.serialize; never carries embedded wavetables (only saved files do, §7.10). Read-only (schema gate: the store
  // locked, or a newer file's project current): no project autosave — saveNow still writes the pending keys
  const ro = roNow();
  if (now === true) store.saveNow(ro ? null : project); else if (!ro) store.saveProject(project);
}
function persist() { clearTimeout(saveT); saveT = setTimeout(save, 400); }
function flush() { if (saveT) save(); } // write a pending save now (before the current model/track changes)
const saveNow = () => save(true);

/* --------------------------------------------------------- patching */
// offline: a bounce / resample / render (Serum's oversampling and the quality steps of the CPU safeguard do not apply;
// "Use Ultra quality when rendering" does, §13.10). patchFor (models.js, SPEC-serum2 §12.7) builds the track's whole
// patch (model map with the FX state, the quality caps and the app preferences; FX rack); only the live-session fields
// are added here: the rack re-seed, the oversampling cap and Q4's POLY cap (§14.3).
// The canonical compile (SPEC-canvas §5.5): cv-graph presents a track of today's shape (one instrument → at most one
// panel → OUT; a Serum with its own FX → OUT) as its v1 view — the very vals / FX objects the track holds — so the node
// gets today's message stream (tests/canonical-stream.test.mjs). Other shapes (stage 1e) compile their primary alone
// until the graph protocol lands.
// the legacy stream (today's {t: 'patch', p}, no device ids) is for a track of ONE instrument — the primary, sounding —
// and at most the one panel it feeds (c: its compileTrack). A canonical compile of several instruments (the others off or
// soloed out), of a primary off, or with a panel of its own beside it gets the graph protocol: the messages that name a
// device (303s, auditions, FX taps, monitors) need device ids (review H2; stage 1e IMPL §3.3)
function legacyOk(tr, c = CG.compileTrack(tr)) {
  if (!c.canonical) return false;
  if (!tr.dev) return true;
  const ids = CMOD.instIds(tr), f = CMOD.fxDevOf(tr);
  return ids.length === 1 && c.inst === ids[0] && Object.keys(tr.dev).every(k => !tr.dev[k] || tr.dev[k].kind !== 'panel' || (!!f && !f.own && k === f.id));
}
// Stage 2a (IMPL-2a §2.1, D11): a Serum's vals with its track's canvas mod rows injected into free matrix slots ({ s:
// merged }: compileSerum and fxModded2 both see them; vals.s untouched) — no rows: vals itself (the same bytes as before)
function modVals(tr, id, vals, m) {
  if (!m.custom || !tr.dev || !id || !vals || !vals.s) return vals;
  const inj = CG.injectMods({ vals }, CG.modRowsFor(tr, id));
  return inj.s === vals.s ? vals : Object.assign({}, vals, { s: inj.s });
}
function buildPatch(tr, sr, offline = false) {
  fxOf(tr); // (a v1 rack reaching the track is migrated in place first, as before)
  const c = CG.compileTrack(tr), V = c.canonical ? c.v1 : CM.primV1(tr);
  const m = modelById(V.model), s = m.custom && V.vals.s ? V.vals.s : null;
  const patch = patchFor(m, modVals(tr, c.canonical ? c.inst : CMOD.primId(tr), V.vals, m), V.fx, {
    sr: sr || (ctx ? ctx.sampleRate : 48000), bpm: project.bpm, drift: settings.drift / 10, hiss: 1,
    // offline: no quality caps (the CP defaults; the touch-device stream / grain pools differ by ≈ 1 MB and a render has no
    // deadline); live: the device defaults and the safeguard's step
    qr: offline ? null : qrOf(qrStep), prefs: offline || !prefs.ultra ? prefs : Object.assign({}, prefs, { ultra: 0 }), seed: seedPend.has(tr.id),
  });
  if (s) {
    patch.osCap = offline ? 0 : sxCap;
    if (!offline) capQ4(patch);
  }
  if (!offline) voiceSeen(tr, patch);
  return patch;
}
// Stage 1e (IMPL-1e §3.3): one instrument device's patch on a graphed node — cv-graph instPatch (a Serum with its own FX;
// a classic one without a rack: its panel is a {t: 'chain'}) with buildPatch's options and live fields (the Serum caps;
// the voice mode of the primary). A chain: the panel's FX state compiled as a classic track's rack (cv-graph chainPatch).
const liveOpts = (tr, sr, offline) => ({ sr: sr || (ctx ? ctx.sampleRate : 48000), bpm: project.bpm, drift: settings.drift / 10, hiss: 1,
  qr: offline ? null : qrOf(qrStep), prefs: offline || !prefs.ultra ? prefs : Object.assign({}, prefs, { ultra: 0 }), seed: seedPend.has(tr.id) });
function buildInstPatch(tr, id, sr, offline = false) {
  const d = tr.dev[id], m = modelById(d.model);
  const patch = CG.instPatch({ model: m.id, vals: d.vals, fx: m.custom ? fxOfDev(tr, id) : undefined }, liveOpts(tr, sr, offline), m.custom ? CG.modRowsFor(tr, id) : null); // (2a: its mod rows)
  if (m.custom) {
    patch.osCap = offline ? 0 : sxCap;
    if (!offline) capQ4(patch);
  }
  if (!offline && id === CMOD.primId(tr)) voiceSeen(tr, patch);
  return patch;
}
const buildChain = (tr, id, sr, offline = false) => CG.chainPatch(fxOfDev(tr, id), liveOpts(tr, sr, offline));
// a track's whole graph form (c: its compileTrack): {graph, patches: {id: patch}, chains: {id: {fxr, fxrT}}, seqs: {id: s},
// needs} — the processorOptions of a node / an offline render (offline: no caps; a 303 only when synced, not running)
function graphParts(tr, sr, offline = false, c = CG.compileTrack(tr)) {
  const g = c.canonical ? CG.compileGraph(tr) : c, patches = {}, chains = {}, seqs = {}, needs = new Set();
  for (const { id } of g.graph.insts) {
    const p = patches[id] = buildInstPatch(tr, id, sr, offline);
    for (const x of p.needs || []) needs.add(x);
    if (tr.dev[id].model === 'tb303' && (!offline || seqOf(tr, id).sync)) seqs[id] = seqPayload(tr, id, offline ? { run: false } : undefined);
  }
  for (const { id } of g.graph.chains) { const x = chains[id] = buildChain(tr, id, sr, offline); for (const n of x.fxr.needs || []) needs.add(n); }
  return { graph: Object.assign({}, g.graph), patches, chains, seqs, needs: [...needs] };
}
// the states a track's devices hold (the asset manager reads `~opsKey` / Convolve shapes from them; tracks() is the primary)
function learnStates(tr) {
  for (const id of Object.keys(tr.dev || {})) {
    const d = tr.dev[id];
    if (d && d.kind === 'synth' && d.model === 'serum') tables.learn({ s: d.vals && d.vals.s, fx: d.fx });
    else if (d && d.kind === 'panel' && d.fx) tables.learn({ fx: d.fx });
  }
}
const convOf = G => { for (const x of [...Object.values(G.chains), ...Object.values(G.patches)]) if (x.fxr && x.fxr.convMax) return x.fxr.convMax; return undefined; };
// §14.3 Q4 (live Serum patches): POLY ≤ 8 — the engine's voice count and CP.poly (the Active Voices source's scale and
// the snapshot's maxVoices), so the step changes nothing but the number of voices; voices above are released. Q6 (IMPL,
// M4 performance; see qrOf): POLY ≤ 4
function capQ4(patch) {
  const cap = qrStep >= 6 ? 4 : qrStep >= 4 ? 8 : 0;
  if (cap > 0 && patch.mode === 'poly' && patch.poly > cap) {
    patch.poly = cap;
    if (patch.serum && patch.serum.poly > cap) patch.serum = Object.assign({}, patch.serum, { poly: cap });
  }
  return patch;
}
/* R6: voice modes — what a chord on a track plays like (the instrument menu, the track tab, the chord notice) */
// A patch's voice mode (after capQ4; s: the track's Serum state — its POLY before the cap, its arpeggiator / clip player):
// mode 'mono' (one note: lowest / last wins) | 'unison' (every voice on one note) | 'poly'; n voices (Infinity: the
// Solina's every key); prio; cap: the CPU safeguard's POLY cap (Q4 / Q6) lowered n; seq 'Arp' | 'Seq': a Serum
// arpeggiator / clip player in front of the voices; label as shown ("Mono", "Poly 5", "Poly 4 (CPU cap) · Arp")
function voiceInfo(patch, s = null) {
  const div = patch.engine === 'divide', mode = div || patch.mode === 'poly' ? 'poly' : patch.mode === 'unison' ? 'unison' : 'mono';
  const n = div ? Infinity : mode === 'poly' ? Math.max(1, patch.poly | 0) : 1;
  const vo = s && s.voicing, sp = s && s.p;
  const cap = mode === 'poly' && !!vo && Number.isFinite(+vo.poly) && clamp(Math.round(+vo.poly), 1, 32) > n;
  const seq = sp && +sp['arp.on'] >= 0.5 ? 'Arp' : sp && +sp['clip.on'] >= 0.5 ? 'Seq' : '';
  const label = (mode === 'mono' ? 'Mono' : mode === 'unison' ? 'Unison' : div ? 'Poly' : 'Poly ' + n) + (cap ? ' (CPU cap)' : '') + (seq ? ' · ' + seq : '');
  return { mode, n, prio: patch.prio || 'last', cap, seq, label };
}
// a track's voice mode without building its patch (no FX rack, no Serum compile): the classic model's map (a few µs), the
// Serum state's voicing as compileSerum reads it; capped as buildPatch caps a live patch
function trackVoice(tr) {
  const m = modelById(tr.model), v = tr.vals || {};
  if (m.custom) {
    const s = v.s && typeof v.s === 'object' ? v.s : null, vo = (s && s.voicing) || {}, mono = +vo.mono >= 0.5;
    const n = Number.isFinite(+vo.poly) ? clamp(Math.round(+vo.poly), 1, 32) : 8;
    return voiceInfo(capQ4({ engine: 'serum', mode: mono ? 'mono' : 'poly', poly: mono ? 1 : n, prio: 'last' }), s);
  }
  const P = {};
  for (const c of m.controls) P[c.id] = c.conv ? c.conv(v[c.id]) : v[c.id];
  try { return voiceInfo(m.map(P, v, { drift: 0, hiss: 0, sr: 48000, bpm: project.bpm, smooth: 1, fx: null, qr: null })); } catch { return voiceInfo({ mode: 'poly', poly: 8 }); }
}
const voiceDef = new Map(); // model id → its default voice mode (the instrument menu's other entries; the chord notice)
function modelVoice(m) {
  if (!voiceDef.has(m.id)) voiceDef.set(m.id, m.custom ? voiceInfo({ engine: 'serum', mode: 'poly', poly: 8 }) : trackVoice({ model: m.id, vals: defaults(m) }));
  return voiceDef.get(m.id);
}
// what the instrument menu entry of each track's model and the track tab show (track id → label, option); a patch that
// changes a mode (an assign-mode knob, Serum's voicing, the CPU cap or its lifting) updates them (buildPatch)
const voiceShown = new Map(), voiceOpt = new Map();
function voiceSeen(tr, patch) {
  const l = voiceInfo(patch, isSx(tr) ? tr.vals.s : null).label;
  if (!voiceShown.has(tr.id) || voiceShown.get(tr.id) === l) return;
  voiceShown.set(tr.id, l);
  const o = voiceOpt.get(tr.id), v = o && o.lastChild, b = o && o.parentNode;
  if (o && o.value === tr.model) { // the row chip's voice span (its model name gives way to it, never the other way)
    if (v && v.className === 'hiv') v.textContent = l; else o.textContent = modelById(tr.model).name + ' · ' + l;
    if (b && b.className === 'hinst') b.title = instTitle(modelById(tr.model).name, l);
  }
  if (tr.id === project.selTrack) tabTrackUI();
}
// (stage 1e) a track of several instruments says so where one names its model / voice mode: "2 instruments"
const instN = t => (t && t.dev ? CMOD.instIds(t).length : 1);
const instsTxt = t => instN(t) + ' instruments';
function tabTrackUI() {
  const t = trk();
  if (!voiceShown.has(t.id)) voiceShown.set(t.id, trackVoice(t).label);
  $('#tabTrack').textContent = `Track: ${t.name} · ${instN(t) > 1 ? instsTxt(t) : voiceShown.get(t.id)}`;
  trkChipUI(); // (the top row's track chip shows the same: name, model · voice)
}
const patchQ = new Set();
function queuePatch(tr = trk()) {
  if (!patchQ.size) requestAnimationFrame(() => { for (const t of patchQ) if (project.tracks.includes(t)) sendPatch(t); patchQ.clear(); });
  patchQ.add(tr);
}
// The curve tables travel only when their content changed since the last patch this node received (keys per node,
// reset when the node is recreated): Serum's CT v2 and the sequencer's seqT by part (SPEC-serum2 §4.1, §4.4 — only the
// parts whose key changed, so an LFO, curve or clip-note drag re-sends one part, not the whole table), the FX rack's FXT
// whole. When nothing but tables changed, only the parts are posted ({t: 'ct'} / {t: 'sqt'}, §12.4: an LFO drag frame
// posts a few KB instead of the ≈ 25 KB patch).
function partDelta(keys, T) { // T {key, parts} → {key, parts} with the parts this node has not received, or null
  const parts = {};
  let any = false;
  for (const k of Object.keys(T.parts)) {
    const q = T.parts[k];
    if (keys.get(k) !== q.key) { keys.set(k, q.key); parts[k] = q; any = true; }
  }
  return any ? { key: T.key, parts } : null;
}
function ctDelta(N, serumT) {
  const d = partDelta(N.ctParts, serumT);
  if (!d && N.ctKey === serumT.key) return null;
  N.ctKey = serumT.key;
  return d || { key: serumT.key, parts: {} };
}
// deep equality of two compiled patches without their tables (typed arrays element-wise; CP.ctKey and SQP.key — the
// keys of the tables they were compiled with — ignored)
const SKIP_TOP = new Set(['serumT', 'seqT', 'fxrT']);
function sameVal(a, b, skip) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return a !== a && b !== b;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b) || a.constructor !== b.constructor || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !(a[i] !== a[i] && b[i] !== b[i])) return false;
    return true;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keep = k => !skip || !skip.has(k), ka = Object.keys(a).filter(keep), kb = Object.keys(b).filter(keep);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!sameVal(a[k], b[k], k === 'serum' ? SKIP_CP : k === 'seq' ? SKIP_SQ : null)) return false;
  }
  return true;
}
const SKIP_CP = new Set(['ctKey']), SKIP_SQ = new Set(['key']);
function sendPatch(tr = trk()) {
  const N = nodes.get(tr.id);
  if (!N) return;
  const c = CG.compileTrack(tr);
  if (!legacyOk(tr, c) || N.graphed) { sendGraph(tr, N, c); return; } // (stage 1e: not one instrument, or a node that is graphed)
  const p = buildPatch(tr);
  seedPend.delete(tr.id);
  // §9.5: the assets the patch can play (Serum needs ∪ FX needs) are posted before it; a patch that replaces a posted
  // variant of an asset (trim / fade, Convolve shaping) waits for the new variant, so the old one keeps playing
  if (!p.needs || !p.needs.length) { tables.release(tr.id); N.waitP = null; postPatch(N, p); return; }
  const at = { trackId: tr.id, s: isSx(tr) ? tr.vals.s : null, fx: fxOf(tr), convMax: p.fxr && p.fxr.convMax };
  const done = tables.ensure(p.needs, at);
  if (tables.ready(p.needs)) { N.waitP = null; postPatch(N, p); return; }
  N.waitP = p; // a newer patch of the track replaces a waiting one
  done.then(() => { if (N.waitP === p && nodes.get(tr.id) === N) { N.waitP = null; postPatch(N, p); } });
}
// the part keys of a node that starts with every table part of `patch` (processorOptions) and this patch (N: the node
// record, filled in)
function partCache(N, patch) {
  Object.assign(N, { engine: patch.engine, ctKey: '', ctParts: new Map(), sqParts: new Map(), xsKey: patch.fxrT ? patch.fxrT.key : '', last: null });
  if (patch.serumT) ctDelta(N, patch.serumT);
  if (patch.seqT) partDelta(N.sqParts, patch.seqT);
  N.last = Object.assign({}, patch); delete N.last.serumT; delete N.last.seqT; delete N.last.fxrT;
  return N;
}
// C: the part cache (a legacy node: the node record itself; a graphed node: its Inst's, N.insts), i: that Inst's id
function postPatch(N, p, C = N, i) {
  if (C.engine !== p.engine) { C.engine = p.engine; C.ctKey = ''; C.ctParts.clear(); C.sqParts.clear(); C.last = null; } // the engine drops its tables when the model changes
  let ct = null, sq = null;
  if (p.serumT) { ct = ctDelta(C, p.serumT); if (ct) p.serumT = ct; else delete p.serumT; }
  if (p.seqT) { sq = partDelta(C.sqParts, p.seqT); if (sq) p.seqT = sq; else delete p.seqT; }
  if (p.fxrT) { if (C.xsKey === p.fxrT.key) delete p.fxrT; else C.xsKey = p.fxrT.key; }
  if (C.last && !p.fxrT && sameVal(p, C.last, SKIP_TOP)) { // only tables changed
    if (ct && Object.keys(ct.parts).length) N.node.port.postMessage(i === undefined ? { t: 'ct', key: ct.key, parts: ct.parts } : { t: 'ct', i, key: ct.key, parts: ct.parts });
    if (sq) N.node.port.postMessage(i === undefined ? { t: 'sqt', parts: sq.parts } : { t: 'sqt', i, parts: sq.parts });
    return;
  }
  const last = Object.assign({}, p);
  delete last.serumT; delete last.seqT; delete last.fxrT;
  C.last = last;
  N.node.port.postMessage(i === undefined ? { t: 'patch', p } : { t: 'patch', i, p });
}
/* Stage 1e (IMPL-1e §2.5, §3.3): the graph protocol. A node that has received a {t: 'graph'} is graphed (N.graphed, sticky
   until the node is recreated) and is driven by these messages only, even once its track is canonical again; a canonical
   track's node that never was keeps today's stream (tests/canonical-stream.test.mjs). Per post: {t: 'graph'} when the
   structure key changed ({t: 'power', i, on} after it for an Inst whose `on` changed: the engine applies a power state it
   already has as nothing), then {t: 'patch', i, p} per Inst through its part cache (N.insts: id → {engine, ctKey,
   ctParts, sqParts, xsKey, last}) and {t: 'chain', c, fxr, fxrT?} per shared panel (N.chains: id → {xsKey, last}; fxrT
   absent = its tables unchanged, as a patch's). A post waits for the assets of every part as today's patch does — its
   graph, power and new 303 patterns with it (review H10, H11). */
const newPart = () => ({ engine: '', ctKey: '', ctParts: new Map(), sqParts: new Map(), xsKey: '', last: null });
const instCache = (N, id) => N.insts.get(id) || N.insts.set(id, newPart()).get(id);
// a node's first graph: its i0 / c0 are adopted by position (i0 → the primary; c0 → chains[0] when the primary is
// classic), so their caches start from the legacy ones (an unchanged part is not re-sent: its state and tails are kept)
function graphCache(N, tr, graph) {
  const legacy = !N.graphed && N.ctParts instanceof Map, pid = CMOD.primId(tr), f = CMOD.fxDevOf(tr);
  N.graphed = true; N.gkey = ''; N.gon = new Map(); N.waitP = null; N.insts = new Map(); N.chains = new Map(); N.osI = new Map();
  if (!legacy) return N;
  N.gon.set(pid, true); // (i0: the primary, sounding — a legacy node's one instrument; its pattern is there, its power diffed)
  N.insts.set(pid, { engine: N.engine, ctKey: N.ctKey, ctParts: N.ctParts, sqParts: N.sqParts, xsKey: N.xsKey, last: N.last });
  if (f && !f.own && N.last && N.last.fxr && graph.chains.length && graph.chains[0].id === f.id) N.chains.set(f.id, { xsKey: N.xsKey, last: N.last.fxr });
  return N;
}
function postChain(N, id, x) {
  const C = N.chains.get(id) || N.chains.set(id, { xsKey: '', last: null }).get(id);
  const fxrT = x.fxrT && C.xsKey !== x.fxrT.key ? x.fxrT : null;
  if (fxrT) C.xsKey = fxrT.key;
  if (!fxrT && C.last && sameVal(x.fxr, C.last)) return;
  C.last = x.fxr;
  N.node.port.postMessage(fxrT ? { t: 'chain', c: id, fxr: x.fxr, fxrT } : { t: 'chain', c: id, fxr: x.fxr });
}
function sendGraph(tr, N, c) {
  const G = graphParts(tr, ctx.sampleRate, false, c), post = m => N.node.port.postMessage(m);
  seedPend.delete(tr.id);
  if (!N.graphed) graphCache(N, tr, G.graph);
  // the structure goes with its parts, after their assets (review H11: while a post waits the node keeps its last graph —
  // a new Inst never plays the default patch, a new panel never passes dry); a new TB-303 Inst gets its pattern as its graph
  // goes, the current one (H10: a newer post replacing a waiting one cannot drop it)
  const go = () => {
    const fresh = [];
    if (N.gkey !== G.graph.key) {
      for (const x of G.graph.insts) if (!N.gon.has(x.id) && G.seqs[x.id]) fresh.push(x.id);
      N.gkey = G.graph.key;
      post(Object.assign({ t: 'graph' }, G.graph));
      for (const x of G.graph.insts) if (N.gon.has(x.id) && N.gon.get(x.id) !== x.on) post({ t: 'power', i: x.id, on: x.on });
      N.gon = new Map(G.graph.insts.map(x => [x.id, x.on]));
      for (const id of [...N.insts.keys()]) if (!(id in G.patches)) N.insts.delete(id);
      for (const id of [...N.chains.keys()]) if (!(id in G.chains)) N.chains.delete(id);
      for (const id of [...N.osI.keys()]) if (!(id in G.patches)) N.osI.delete(id);
      monitors.on.delete(tr.id); monitors.sync(); // (the parts its subscriptions show may have moved — asked again: a sync while this post waited went to the old structure; the first graph: device ids from now on)
    }
    for (const id of Object.keys(G.patches)) postPatch(N, G.patches[id], instCache(N, id), id);
    for (const id of Object.keys(G.chains)) postChain(N, id, G.chains[id]);
    for (const id of fresh) post({ t: 'seq', s: seqPayload(tr, id), i: id }); // (a new TB-303 Inst: its pattern, as a new node's options)
  };
  if (!G.needs.length) { tables.release(tr.id); N.waitP = null; go(); return; }
  learnStates(tr);
  const done = tables.ensure(G.needs, { trackId: tr.id, convMax: convOf(G) });
  if (tables.ready(G.needs)) { N.waitP = null; go(); return; }
  N.waitP = go; // (a newer post of the track replaces a waiting one)
  done.then(() => { if (N.waitP === go && nodes.get(tr.id) === N) { N.waitP = null; go(); } });
}
function queueAll() { for (const t of project.tracks) queuePatch(t); }
// a classic panel wrote a value (ClassicPanel set): its preset becomes Custom, the patch, autosave
function valChanged(t, id) { // (t: a device view, stage 1e)
  if (id === 'alg') drawAlgo();
  if (t.preset) { t.preset = null; renderHeads(); }
  queuePatch(trOf(t)); persist();
}
function refreshAll() { if (cpanel) cpanel.refresh(); drawAlgo(); }

/* ------------------------------------------------------------- audio */
const nodes = new Map(); // track id -> { node, gain, pan, an, load, voices }
const quiet = p => { if (p && p.catch) p.catch(() => {}); };
// Internal rate cap: oversampling is a power of two with sampleRate × OS ≤ 384 kHz (more costs CPU for no audible gain)
const MAX_INTERNAL = 384000;
const osCap = sr => Math.max(1, 2 ** Math.floor(Math.log2(MAX_INTERNAL / sr + 1e-9)));
const osFor = sr => Math.min(settings.os, osCap(sr));
// A Serum track runs at its own Global quality (1/2/4×) instead of the app setting, capped like every track at 384 kHz
// and by sxCap, the CPU safeguard's cap for Serum tracks (lead sign-off on SPEC-serum deviation 9). Session only.
// Halving Serum's oversampling recovers only a quarter of its cost, so once sxCap is 1 the safeguard takes the quality
// steps of SPEC-serum2 §14.3 (qrStep 1–4, + the IMPL steps 5–6, below; the Phase-1 unison cap is Q2's qr.uniMax, applied by the DSP to A, B
// and C). Choosing a Quality (GLOBAL page, the app's oversampling) or reloading lifts every step. Offline renders use
// neither; they render at Ultra (4×) with the preference "Use Ultra quality when rendering" (§12.6).
let sxCap = 8, qrStep = 0;
// device class of the §14.2 budgets (touch: pointer coarse, or a touch seen) — passed to every budget holder
let touchDev = (() => { try { return matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints || 0) > 0; } catch { return false; } })();
// the Piano Roll's touch defaults (18 px rows, the ≥ 14 px automatic floor, grab tabs, the Modifiers group): a coarse
// primary pointer, or an iPad (a trackpad makes its pointer fine) — not a mouse-driven touchscreen laptop (maxTouchPoints
// > 0 there too); a finger or pen on the roll still turns them on (roll.js tseen / coarse, rollFing)
const rollTouchDev = (() => { try { const n = navigator; return matchMedia('(pointer: coarse)').matches || /iP(hone|ad|od)/.test(n.userAgent) || (n.platform === 'MacIntel' && n.maxTouchPoints > 1); } catch { return false; } })();
// §14.3 quality caps at step k: CP.qr [uniMax, grainsMax, specHopMul, specStreams, grainsProc] (+ FXP.convMax). Q5 and Q6
// are IMPL additions (M4 performance): after Q4 a dense Sample / Granular patch (8 voices × 3 oscillators × unison 16,
// warps per grain) still measured 0.32 / 0.45 at OS 1 on an M4 Max — beyond real time on a 1.5–3× slower iPad, with no
// step left; Q5 (unison ≤ 2, 32 / 64 grains, 2 spectral streams) brings it to 0.21 / 0.29, Q6 (POLY ≤ 4) to 0.10 / 0.21
function qrOf(k) {
  const q = { uniMax: 16, grainsMax: 256, specHopMul: 1, specStreams: touchDev ? 16 : 32, grainsProc: touchDev ? 256 : 512, convMax: 10 };
  if (k >= 1) { q.grainsMax = 128; q.grainsProc = 256; q.specHopMul = 2; }        // Q1
  if (k >= 2) { q.uniMax = 4; q.grainsMax = 64; q.grainsProc = 128; q.specStreams = 8; } // Q2
  if (k >= 3) { q.convMax = 2; q.specStreams = 4; }                               // Q3 (Q4: POLY ≤ 8, buildPatch)
  if (k >= 5) { q.uniMax = 2; q.grainsMax = 32; q.grainsProc = 64; q.specStreams = 2; }  // Q5 (Q6: POLY ≤ 4, buildPatch)
  return q;
}
const QR_STEPS = 6;
const QR_NOTICE = ['', 'fewer grains and spectral frames', 'unison ≤ 4 voices, fewer grains and spectral streams',
  'Convolve tails ≤ 2 s, fewer spectral streams', 'polyphony ≤ 8 voices', 'unison ≤ 2 voices, fewer grains and spectral streams',
  'polyphony ≤ 4 voices'];
const sxQuality = tr => { const o = tr.vals && tr.vals.s && tr.vals.s.global ? tr.vals.s.global.os : 2; return o === 1 || o === 4 ? o : 2; };
const sxOSFor = (tr, sr, offline = false) => Math.min(offline && prefs.ultra ? 4 : sxQuality(tr), osCap(sr), offline ? 8 : sxCap);
// lifts every CPU-safeguard step (a Quality chosen on the GLOBAL page or the app's oversampling)
function liftCaps() {
  hotT = 0;
  if (sxCap < 8 || qrStep > 0) { sxCap = 8; qrStep = 0; for (const t of project.tracks) if (hasSx(t)) queuePatch(t); }
  if (ctx) for (const [id, N] of nodes) if (N.osI && N.osI.size) { // (stage 1e: the instruments lowered alone go back up)
    for (const i of N.osI.keys()) postTo({ id }, { t: 'os', v: osFor(ctx.sampleRate) }, i);
    N.osI.clear();
  }
  if (ctx) rateText();
  cvRelabel(); // (the modules' safeguard badges go)
}
const trackOS = (tr, sr) => (isSx(tr) ? sxOSFor(tr, sr) : osFor(sr));
// DSP scripts (classic scripts, one global scope per context; SPEC-serum2 §0.3, §12.1) load before the engine, all
// requested at once (none reads another's global at load, so their evaluation order does not matter); a missing or
// broken one only degrades its feature (Serum tracks silent, FX racks bypassed, …). The same list, in this order, is
// injected on the main thread (wk.loadDSP) for the panels' displays.
const DSP_FILES = ['sx-base.js', 'sx-filt2.js', 'sx-warp.js', 'sx-mod.js', 'sx-sample.js', 'sx-gran.js', 'sx-spec.js', 'sx-seq.js',
  'serum-dsp.js', 'fx-mods2.js', 'fx-dsp.js'];
const DSP_URLS = DSP_FILES.map(f => f + '?v=' + VERSION);
async function addModules(c) {
  const res = await Promise.allSettled(DSP_URLS.map(u => addModule(c, u)));
  res.forEach((r, i) => { if (r.status === 'rejected') console.warn('DSP script not loaded: ' + DSP_URLS[i] + ' (' + (r.reason && r.reason.message) + ')'); });
  await addModule(c, 'engine.js?v=' + VERSION);
}
// A worklet script the browser could not fetch — offline, in a browser that does not hand worklet requests to the service
// worker (sw.js) — is fetched by the page, which the worker answers from its cache, and added from a blob: URL (the same
// script: the DSP scripts and engine.js are classic scripts without imports). Any other failure stands.
async function addModule(c, url) {
  try { await c.audioWorklet.addModule(url); } catch (err) {
    let text = null;
    try { const r = await fetch(url); if (r.ok) text = await r.text(); } catch { /* not cached either */ }
    if (text == null || typeof Blob !== 'function' || typeof URL.createObjectURL !== 'function') throw err;
    const b = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
    try { await c.audioWorklet.addModule(b); } finally { URL.revokeObjectURL(b); }
  }
}
const kHz = x => (x / 1000).toFixed(1).replace(/\.0$/, '');
let pendCtx = null, failMsg = '', silentEl = null, devRate = +store.get('synth.devsr', 0) || 0;
// SPEC-canvas §9.4: SYNTH Canvas needs iPadOS / Safari 16.4+ (overflow: clip and @container: 16, dvh: 15.4, the playback
// audio session: 16.4), Chrome 108+, Firefox 110+ — checked by feature where the browser can say (CSS.supports; Safari on
// iOS / iPadOS: navigator.audioSession), never by guessing
const PLATFORM_MIN = 'SYNTH Canvas needs iPadOS / Safari 16.4 or later (Chrome 108+, Firefox 110+ on a computer)';
function audioProblem() {
  if (window.isSecureContext === false) return 'Audio needs a secure page — reload this site over https://';
  if (!window.AudioContext || !window.AudioWorkletNode) return 'This browser can’t run the synth engine (no AudioWorklet): ' + PLATFORM_MIN;
  return '';
}
function platformProblem() {
  const C = window.CSS, ua = navigator.userAgent || '';
  if (!C || typeof C.supports !== 'function') return '';
  const css = C.supports('overflow', 'clip') && C.supports('container-type', 'inline-size') && C.supports('height', '1dvh');
  const safariIOS = isIOS() && /Version\/\d.*Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return css && !(safariIOS && !('audioSession' in navigator)) ? '' : PLATFORM_MIN + ' — some parts may not work in this browser';
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
// Registered in the capture phase of every gesture, so resume() runs while the gesture still counts. A context powerOn
// holds suspended while its nodes are built (holdCtx) is left alone once it has run; one that never ran (WebKit: a
// finger's activation comes on release, the power-on started at the press) is unlocked by this gesture and suspended
// again — the resume at the engine's ready is then allowed, outside any gesture
const ranCtx = new WeakSet(); // contexts that have run (WebKit: unlocked — a resume outside a gesture is allowed)
const resumeCtx = c => { const r = c.resume(); quiet(r && r.then ? r.then(() => { ranCtx.add(c); }) : r); };
function wake() {
  const c = ctx || pendCtx;
  if (!c || c.state === 'running' || c.state === 'closed' || (c === holdCtx && ranCtx.has(c))) return;
  resumeCtx(c);
  if (c === holdCtx) quiet(c.suspend()); // (still held: no render before the warm-up is done)
  if (silentEl && silentEl.paused) { try { quiet(silentEl.play()); } catch { /* ignore */ } }
}
function learnDevRate(r) { if (r && r !== devRate) { devRate = r; store.set('synth.devsr', r); } rateLabels(); }
// The audible clock (audioclock.js, R5): WebKit — Safari, every iPad browser, the Home-Screen app — stamps
// getOutputTimestamp at render, so its output path (outputLatency, IO buffer + ring, stalls) is subtracted there; + the
// user's offset (settings.lat) everywhere
const CLK = AC.createClock(isIOS() || navigator.vendor === 'Apple Computer, Inc.', settings.lat);
// WebKit power-on: the first processor's JIT warm-up (≈ 0.25–0.6 s on the worklet thread, engine.js warmUp) would stall
// a running context, and WebKit keeps every stall as output latency for the context's life. So the nodes are built with
// the context suspended (holdCtx: no wake(), no paused nag) and it resumes at the engine's {t: 'ready'} (3 s at most); a
// resume iOS refuses outside the gesture is left to wake() at the next tap.
let holdCtx = null, readyF = null, meterT = 0;
function whenReady(ms) {
  return new Promise(res => {
    const f = () => { for (const N of nodes.values()) if (!N.ready) return; done(); };
    const done = () => { clearTimeout(tm); if (readyF === f) readyF = null; res(); };
    const tm = setTimeout(done, ms);
    readyF = f;
  });
}
// the stall meter (audioclock meterSample): every 5 ms while the engine starts (stalls in script evaluation and the
// processor constructors), then every animation frame (frame()); the drift baseline is taken 2 s after the start
function clockSample(c = ctx) {
  if (!c || !AC.meterSample(CLK, performance.now() / 1000, c.currentTime, c.state === 'running')) return;
  if (ctx) rateText();
  if (AC.driftDue(CLK)) driftNotice();
}
function meterRun(c) {
  clearInterval(meterT); meterT = 0;
  if (c) meterT = setInterval(() => { if (c === ctx || c === pendCtx) clockSample(c); else meterRun(null); }, 5);
}
// WebKit's ring lead only resets with a new context, and only once the old one is gone (await close, not in one handler)
const DRIFT_TXT = 'Audio timing drifted — tap to resync';
function driftNotice() {
  noticeActs.set(DRIFT_TXT, () => { noticeActs.delete(DRIFT_TXT); notice('', 0); resync(); });
  notice(DRIFT_TXT, 30000);
}
async function resync() { await powerOff(); try { await powerOn(); } catch { /* powerOn reports it */ } }
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
  AC.resetClock(CLK); meterRun(c);
  c.onstatechange = () => { if (c.state === 'running') ranCtx.add(c); if (c === ctx || c === pendCtx) powerUI(); };
  resumeCtx(c); // synchronous inside the gesture that called powerOn
  powerUI();
  const job = powering = (async () => {
    try {
      if (!c.audioWorklet) throw new Error('this browser has no AudioWorklet support');
      await addModules(c);
      if (pendCtx !== c) throw new Error('cancelled');
      const hold = CLK.webkit && typeof c.suspend === 'function';
      if (hold) {
        holdCtx = c;
        try { await c.suspend(); } catch { /* built running: the warm-up stall is measured instead */ }
        if (pendCtx !== c) throw new Error('cancelled');
        powerUI();
      }
      master = c.createGain(); master.gain.value = settings.master;
      an = c.createAnalyser(); an.fftSize = 8192; an.smoothingTimeConstant = 0.75;
      master.connect(c.destination); master.connect(an);
      metroBus = c.createGain(); metroBus.gain.value = 1; metroBus.connect(c.destination);
      ctx = c; pendCtx = null; failMsg = ''; hotT = 0;
      const ready = hold ? whenReady(3000) : null;
      syncNodes();
      if (ready) { readyF && readyF(); await ready; if (ctx !== c) throw new Error('cancelled'); }
    } catch (err) {
      if (holdCtx === c) holdCtx = null;
      const mine = ctx === c || pendCtx === c;
      if (pendCtx === c) pendCtx = null;
      if (ctx === c) { ctx = null; an = master = metroBus = null; nodes.clear(); }
      quiet(c.close());
      if (mine) { meterRun(null); playbackSession(false); if (err.message !== 'cancelled') audioFail('Audio engine failed to start: ' + err.message); powerUI(); }
      throw err;
    }
    if (holdCtx === c) holdCtx = null;
    powerUI();
    if (c.state !== 'running') quiet(c.resume());
    setTimeout(() => { if (ctx === c) { meterRun(null); AC.settle(CLK); } }, 2000);
  })();
  try { await job; } finally { if (powering === job) powering = null; }
}
function powerOff() {
  const c = ctx || pendCtx;
  if (!c) return Promise.resolve();
  if (T.playing) stop();
  previewStop(); previewEnd(); // (the kept preview node belongs to this context)
  ctx = null; pendCtx = null; powering = null; an = null; master = null; metroBus = null;
  nodes.clear(); meterRun(null);
  if (cvView) for (const m of cvView.modules.values()) if (m.setCpu) m.setCpu(null); // (no engine: no module CPU)
  if (readyF) readyF(); // a power-on waiting for the engine's 'ready' gives up now (no nodes left)
  seqRun.clear(); for (const P of classicPanels.values()) if (!P.dead && P.model.id === 'tb303') P.seqRunUI(false); // (every 303 shown: RUN off)
  for (const k of [...held.keys()]) held.delete(k);
  hk.clear();
  for (const n of [...keyEls.keys()]) keyVis(n, false);
  playbackSession(false);
  powerUI();
  return c.close().catch(() => {});
}
function makeNode(tr) {
  // stage 1e: a track of a graph shape gets a graphed node, built from processorOptions graph / patches / chains / seqs
  // (IMPL-1e §2.5; offline renders the same, renderOffline); a canonical one today's options
  const sr = ctx.sampleRate, c = CG.compileTrack(tr), G = legacyOk(tr, c) ? null : graphParts(tr, sr, false, c);
  const patch = G ? null : buildPatch(tr); // a new node always gets the curve tables (and a fresh rack)
  seedPend.delete(tr.id);
  const po = { os: trackOS(tr, sr), hostOS: osFor(sr), patch, song: songData(tr), seq: !G && tr.model === 'tb303' ? seqPayload(tr) : null,
    trackId: tr.id }; // the MIDI OUT registry of the worklet scope (SPEC-serum2 §7.9)
  if (G) Object.assign(po, { graph: G.graph, patches: G.patches, chains: G.chains, seqs: G.seqs });
  const node = new AudioWorkletNode(ctx, 'synth-engine', {
    numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
    processorOptions: po,
  });
  const gain = ctx.createGain(), pan = ctx.createStereoPanner(), a = ctx.createAnalyser();
  a.fftSize = 512;
  node.connect(gain); gain.connect(pan); pan.connect(master); pan.connect(a);
  const N0 = { node, gain, pan, an: a, load: 0, voices: 0, os: 0, buf: new Float32Array(512), peak: 0, fxph: null, phWait: [], waitP: null };
  const N = G ? graphCache(N0, tr, G.graph) : partCache(N0, patch);
  if (G) { // (every part starts with its options: the caches hold them)
    N.gkey = G.graph.key; N.gon = new Map(G.graph.insts.map(x => [x.id, x.on]));
    for (const id of Object.keys(G.patches)) N.insts.set(id, partCache({}, G.patches[id]));
    for (const id of Object.keys(G.chains)) N.chains.set(id, { xsKey: G.chains[id].fxrT ? G.chains[id].fxrT.key : '', last: G.chains[id].fxr });
  }
  const id = tr.id;
  node.port.onmessage = e => {
    const d = e.data, t = project.tracks.find(x => x.id === id) || tr;
    if (d.t === 'stats') { N.load = d.load; N.voices = d.voices; N.os = d.os || 0; statsText(); if (Array.isArray(d.per)) cvCpu(id, N, d.per); }
    else if (d.t === 'ready') { N.ready = true; if (readyF) readyF(); } // the processor is built (the first: warmed up)
    else if (d.t === 'step') { // (a graphed node names the 303: d.i; legacy: the primary)
      const dev = typeof d.i === 'string' ? d.i : CMOD.primId(t);
      if (t.id === project.selTrack && (seqRun.has(t.id + '/' + dev) || (T.playing && seqOf(t, dev).sync))) seqStepTo(t, dev, d.s);
    }
    else if (d.t === 'smon') { if (d.fxph && primFx(t, N, d)) N.fxph = d.fxph; monitors.deliver(id, d); }
    else if (d.t === 'fxph') { if (d.v && primFx(t, N, d)) N.fxph = d.v; for (const f of N.phWait.splice(0)) f(d.v); }
    else if (d.t === 'fxover' && Array.isArray(d.ids)) { // §8.5: the rack's 32 MB cap left these instances bypassed
      const part = typeof d.c === 'string' ? d.c : typeof d.i === 'string' ? d.i : null, fx = part ? fxOfDev(t, part.replace(/\/fx$/, '')) : fxOf(t);
      const names = d.ids.map(x => (isV2Fx(fx) && core.instLabel(fx, x)) || x);
      notice(`FX memory limit reached — ${names.join(', ')} bypassed (track “${t.name}”)`, 8000);
    }
  };
  if (T.playing && T.a) node.port.postMessage(Object.assign({ t: 'transport', play: true, seek: true }, T.a));
  if (G) { if (G.needs.length) { learnStates(tr); tables.ensure(G.needs, { trackId: tr.id, node, convMax: convOf(G) }); } }
  else if (patch.needs) tables.ensure(patch.needs, { trackId: tr.id, node, s: isSx(tr) ? tr.vals.s : null, fx: fxOf(tr), convMax: patch.fxr && patch.fxr.convMax });
  const mw = monitors.wanted(id, N);
  if (mw.length) { node.port.postMessage({ t: 'mon', ids: mw }); monitors.on.set(id, mw.join()); }
  return N;
}
// the modules' CPU on their top bars (SPEC-canvas §10 1d): the engine's load per Inst / Chain of the track shown, smoothed
// over ≈ 1 s (stats arrive every 0.25 s of audio; a part's time is counted in whole ms, unbiased but noisy), kept per
// module key (N.cpu). A legacy node's i0 is the primary's module, c0 its FX module (a Serum: its own FX, prim + '/fx'); a
// graphed node's part ids are the module keys (stage 1e: device ids, iN/fx)
function cpuKey(t, N, part) {
  if (N.graphed) return part;
  const p = CMOD.primId(t);
  if (part === 'i0') return p;
  if (part !== 'c0') return null;
  const f = CMOD.fxDevOf(t);
  return f && !f.own ? f.id : p + '/fx';
}
function cvCpu(id, N, per) {
  const t = project.tracks.find(x => x.id === id), old = N.cpu || {}, sm = {};
  if (!t) return;
  // (rebuilt from this report: a part the engine no longer has — a removed device — leaves N.cpu, review H9)
  for (const e of per) { const k = e && typeof e.id === 'string' ? cpuKey(t, N, e.id) : null; if (k && Number.isFinite(e.load)) sm[k] = old[k] === undefined ? e.load : old[k] + 0.25 * (e.load - old[k]); }
  N.cpu = sm;
  if (!cvView || cvView.trackId !== id) return;
  for (const k of Object.keys(sm)) { const m = cvView.modules.get(k); if (m && m.setCpu) m.setCpu(sm[k]); }
}
// a smon / fxph from the primary's FX (its phases are N.fxph: phase memory, presets): a legacy node's every one
function primFx(t, N, d) {
  if (!N.graphed || (d.i === undefined && d.c === undefined)) return true;
  const f = CMOD.fxDevOf(t);
  return !!f && (f.own ? d.i === f.id || d.c === f.id + '/fx' : d.c === f.id);
}
function syncNodes() {
  if (!ctx) return;
  const ids = new Set(project.tracks.map(t => t.id));
  for (const [id, N] of nodes) {
    if (ids.has(id)) continue;
    N.node.port.postMessage({ t: 'panic' }); N.node.port.postMessage({ t: 'bye' }); // bye: leave the MIDI OUT registry (§7.9)
    N.pan.disconnect(); N.node.disconnect(); nodes.delete(id); tables.release(id);
  }
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
// dev (stage 1e): the device the message is for — on a graphed node it gains `i` (an instrument; a Serum's own FX 'iN/fx':
// its Serum) or `c` (a panel), and with aud an audition note `aud` (that Inst alone); legacy nodes never get them
function postTo(tr, m, dev, aud) {
  const N = tr && nodes.get(tr.id);
  if (!N) return;
  if (dev != null && N.graphed) {
    const t = project.tracks.find(x => x.id === tr.id), d = t && t.dev ? t.dev[dev] : null;
    m = Object.assign({}, m, d && d.kind === 'panel' ? { c: dev } : { i: String(dev).replace(/\/fx$/, '') });
    if (aud && m.i) m.aud = 1;
  }
  N.node.port.postMessage(m);
}
function postAll(m) { for (const N of nodes.values()) N.node.port.postMessage(m); }
/* status: the Power LED shows a context that is actually running; a suspended/interrupted one asks for a tap */
// The notice line: a timed message (notice), else the sticky one (audio problems), else the factory generation progress
// (genProgress, §9.7). The progress text alone carries the tap-to-cancel action.
let noticeT = 0, sticky = '', pauseT = 0, genTxt = '';
const noticeActs = new Map(); // notice text → its tap action (attached only while that text shows)
function showNotice(txt) {
  const el = $('#notice');
  el.textContent = txt; el.hidden = !txt;
  if (txt && txt === genTxt) { el.dataset.gen = '1'; el.onclick = genCancel; return; }
  if (el.dataset.gen) delete el.dataset.gen;
  const act = txt ? noticeActs.get(txt) : null;
  el.onclick = act || null;
  if (act) el.dataset.act = '1'; else if (el.dataset.act) delete el.dataset.act;
}
const idleNotice = () => sticky || genTxt;
function notice(txt, ms) { clearTimeout(noticeT); noticeT = 0; showNotice(txt); if (ms) noticeT = setTimeout(() => { noticeT = 0; showNotice(idleNotice()); }, ms); }
function stickyNotice(txt) { sticky = txt; if (!noticeT) showNotice(idleNotice()); }
function powerUI() {
  const c = ctx || pendCtx, run = !!c && c.state === 'running', cpu = $('#cpu'), hold = !!c && c === holdCtx;
  $('#power').setAttribute('aria-pressed', run ? 'true' : 'false');
  clearTimeout(pauseT);
  if (ctx && !hold) rateText(); else $('#rate').textContent = c ? 'Starting engine…' : 'Engine off';
  if (run) { if (!/^DSP/.test(cpu.textContent)) cpu.textContent = 'DSP load —'; cpu.classList.remove('warn'); stickyNotice(failMsg); return; }
  if (!c) { cpu.textContent = failMsg || 'Press Power or play a key'; cpu.classList.toggle('warn', !!failMsg); stickyNotice(failMsg); return; }
  // suspended by powerOn while the nodes are built (WebKit): not a pause to nag about
  if (hold) { cpu.textContent = 'Warming up the engine…'; cpu.classList.remove('warn'); stickyNotice(failMsg); return; }
  pauseT = setTimeout(() => { // a fresh context is 'suspended' for a moment even when allowed to start: only nag if it stays that way
    const k = ctx || pendCtx;
    if (!k || k === holdCtx || k.state === 'running' || k.state === 'closed') return;
    const msg = k.state === 'interrupted' ? 'Audio was interrupted by the system — tap a key or Power to resume' : 'Audio is paused — tap a key or Power to start it';
    cpu.textContent = msg; cpu.classList.add('warn'); stickyNotice(msg);
  }, 400);
}
function rateText() {
  if (!ctx || ctx === holdCtx) return;
  const sr = ctx.sampleRate, os = osFor(sr);
  let s = `${kHz(sr)} kHz × ${os} = ${kHz(sr * os)} kHz · 64-bit`;
  if (os < settings.os) s += ` (${settings.os}× capped)`;
  if (devRate && sr !== devRate) s += ` · resampled to ${kHz(devRate)} kHz`;
  // Serum tracks run at their own oversampling (Global quality, CPU cap)
  const sx = [...new Set(project.tracks.filter(isSx).map(t => sxOSFor(t, sr)))].sort((a, b) => a - b);
  const capped = project.tracks.some(t => isSx(t) && sxOSFor(t, sr) < Math.min(sxQuality(t), osCap(sr)));
  // (Q4 / Q6 cap Serum's polyphony: shown here and on the capped tracks' labels until a Quality choice lifts it, R7)
  if (sx.length) s += ` · Serum ${sx.map(x => kHz(sr * x)).join('/')} kHz${capped ? ' (CPU cap)' : ''}${qrStep ? ` · quality step Q${qrStep}${qrStep >= 4 ? `, polyphony ≤ ${qrStep >= 6 ? 4 : 8}` : ''} (CPU cap)` : ''}`;
  // (how far the heard audio trails the rendered: the Latency popover's readout — not here, where it widened the
  // header to two rows at 1280–1400 px with the engine on)
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
  if (load > 0.85 && (maxOS() > 1 || qrLever())) { if (!hotT) hotT = now; else if (now - hotT > (load > 1 ? 1000 : 2000)) lowerOS(); }
  else hotT = 0;
}
// highest oversampling in use: the app setting (instruments of the other models) and Serum instruments (their own; a
// device has the track's `vals` shape: sxOSFor reads it). Stage 1e: every instrument of a track, not only its primary
const devsOf = t => (t.dev ? CMOD.instIds(t).map(id => t.dev[id]) : [t]);
const hasSx = t => devsOf(t).some(d => d.model === 'serum'), hasPlain = t => devsOf(t).some(d => d.model !== 'serum');
function plainOS() { return project.tracks.some(hasPlain) ? osFor(ctx.sampleRate) : 0; }
function sxMaxOS() { let m = 0; for (const t of project.tracks) for (const d of devsOf(t)) if (d.model === 'serum') m = Math.max(m, sxOSFor(d, ctx.sampleRate)); return m; }
function maxOS() { return Math.max(plainOS(), sxMaxOS()); }
const qrLever = () => qrStep < QR_STEPS && project.tracks.some(hasSx);
// a graphed node's load by group (its parts' smoothed loads, N.cpu); a legacy node's by its model
function groupLoads(t, N) {
  if (!N.graphed || !N.cpu) return isSx(t) ? [0, N.load] : [N.load, 0];
  let lp = 0, ls = 0;
  for (const k of Object.keys(N.cpu)) { const d = t.dev[k.replace(/\/fx$/, '')]; if (d && d.model === 'serum') ls += N.cpu[k]; else lp += N.cpu[k]; }
  return [lp, ls];
}
// stage 1e: the heaviest classic Inst of the busiest track, when that track's node is graphed (it is lowered alone,
// {t: 'os', i, v}, session only: N.osI); null → today's broadcast of the app setting
function heavyInst() {
  let top = null;
  for (const t of project.tracks) { const N = nodes.get(t.id); if (N && hasPlain(t) && (!top || N.load > top.N.load)) top = { t, N }; }
  if (!top || !top.N.graphed || !top.N.cpu) return null;
  const { t, N } = top, base = osFor(ctx.sampleRate);
  let h = null;
  for (const id of Object.keys(N.cpu)) {
    const d = t.dev[id], os = N.osI.has(id) ? N.osI.get(id) : base;
    if (d && d.kind === 'synth' && d.model !== 'serum' && os > 1 && (!h || N.cpu[id] > h.load)) h = { t, N, id, os, load: N.cpu[id] };
  }
  return h;
}
// the badge of a module the safeguard capped (IMPL-1e §3.3; lane C2 draws it): 'OS 4→2' | 'Q3' | null
function capsOf(t, dev) {
  const id = dev || CMOD.primId(t), d = t && t.dev ? t.dev[id] : null, N = t && nodes.get(t.id);
  if (!d || d.kind !== 'synth' || !ctx) return null;
  const sr = ctx.sampleRate;
  if (d.model === 'serum') {
    const own = Math.min(sxQuality(d), osCap(sr)), os = sxOSFor(d, sr);
    return os < own ? `OS ${own}→${os}` : qrStep ? 'Q' + qrStep : null;
  }
  const v = N && N.osI ? N.osI.get(id) : undefined;
  return v !== undefined && v < osFor(sr) ? `OS ${osFor(sr)}→${v}` : null;
}
// one step down for the group carrying more of the load (the per-node loads the processors report): the app setting
// for the other models (persisted, as the select shows it), or the Serum tracks' caps (session only): their
// oversampling first (never above a track's own quality, §11.4 sign-off), at 1× their unison voices; the other group
// when the first has nothing left to lower
function lowerOS() {
  hotT = 0;
  const po = plainOS(), so = sxMaxOS();
  let lp = 0, ls = 0;
  for (const t of project.tracks) { const N = nodes.get(t.id); if (N) { const g = groupLoads(t, N); lp += g[0]; ls += g[1]; } }
  const sxFirst = ls >= lp && (so > 1 || qrLever());
  const h = !sxFirst && po > 1 ? heavyInst() : null;
  if (h) { // (stage 1e: a graphed track's heaviest classic instrument alone)
    const v = h.os / 2, d = h.t.dev[h.id];
    h.N.osI.set(h.id, v);
    postTo(h.t, { t: 'os', v }, h.id);
    notice(`DSP load stayed above 85% — oversampling of ${d.name || modelById(d.model).name} (track “${h.t.name}”) lowered to ${v}× to avoid dropouts`, 9000);
  } else if (!sxFirst && po > 1) {
    const v = po / 2;
    settings.os = v; $('#os').value = String(v); persist();
    postAll({ t: 'os', v }); rateText(); rateLabels();
    for (const [id, N] of nodes) if (N.osI) for (const [i, o] of [...N.osI]) { // (the instruments lowered alone below it stay there)
      if (o < v) postTo({ id }, { t: 'os', v: o }, i); else N.osI.delete(i);
    }
    notice(`DSP load stayed above 85% — oversampling lowered to ${v}× to avoid dropouts`, 9000);
  } else if (so > 1) {
    sxCap = so / 2;
    for (const t of project.tracks) if (hasSx(t)) queuePatch(t);
    rateText();
    notice(`DSP load stayed above 85% — Serum oversampling capped at ${sxCap}× to avoid dropouts`, 9000);
  } else if (qrLever()) { // §14.3: Q1 … Q4 (+ Q5, Q6) after the oversampling cap, one per step, each named in a notice
    qrStep++;
    for (const t of project.tracks) if (hasSx(t)) queuePatch(t);
    rateText();
    notice(`DSP load stayed above 85% — Serum quality step Q${qrStep}: ${QR_NOTICE[qrStep]} to avoid dropouts`, 9000);
  }
  cvRelabel(); // (the modules' safeguard badges, capsOf)
}

/* --------------------------------------------------------- song data */
const CCK = { bend: 0, wheel: 1, sus: 2, at: 3 };
// R7 B4: a Piano Roll gesture appends and moves notes in place (sorted again only at its end): the engine (and the break
// below) need them in order — a sorted copy (song.sortNotes order) when they are not
function inOrder(a, cmp) { for (let i = 1; i < a.length; i++) if (cmp(a[i - 1], a[i]) > 0) return a.slice().sort(cmp); return a; }
const noteCmp = (a, b) => a.t - b.t || a.n - b.n, ccCmp = (a, b) => a.t - b.t;
function songData(tr, start = -Infinity, end = Infinity) {
  const notes = [], cc = [];
  for (const n of inOrder(tr.notes, noteCmp)) {
    if (n.t < start - 1e-9 && n.t + n.d <= start) continue;
    if (n.t >= end) break;
    notes.push(n.t, Math.min(n.d, end - n.t), n.n, n.v);
  }
  for (const c of inOrder(tr.cc, ccCmp)) if (c.t < end) cc.push(c.t, CCK[c.k] ?? 1, c.v);
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
  for (const t of trs) { S.sortNotes(t.notes); t.cc.sort((a, b) => a.t - b.t); sendSong(t); chordCheck(t); }
  fitBars();
  persist();
  arr && arr.render(); roll && roll.render(); updateUndoUI();
}
// R6: chords a track cannot play — ≥ 2 pitches starting within CHORD_TK on a mono / unison track, or more pitches than
// its voices on a poly one (legato overlaps never count; an arpeggiator / clip player plays chords its own way): a notice
// once per track and session. Its tap switches the track to the first polyphonic model with voices for the chord
// (setTrackModel: undoable), else opens the instrument picker (a Serum track — its voicing is in its panel —, a chord
// beyond every model)
const CHORD_TK = S.PPQ / 32; // a 128th: a drawn chord's notes share a tick, a played one's lie within ≈ 15 ms at 120 BPM
const POLY_TO = ['prophet5', 'juno60', 'jupiter8', 'dx7'], chordWarned = new Set();
function chordSize(notes) { // the most pitches starting together (notes sorted)
  let k = 0;
  for (let i = 0, j = 0; i < notes.length; i = j) {
    const ps = new Set();
    while (j < notes.length && notes[j].t - notes[i].t <= CHORD_TK) ps.add(notes[j++].n);
    if (ps.size > k) k = ps.size;
  }
  return k;
}
function chordCheck(t) {
  // (U8) several instruments: the primary's voicing says little about what plays (zones split the keys) and the tap would
  // replace the primary — no notice
  if (chordWarned.has(t.id) || t.notes.length < 2 || instN(t) > 1) return;
  const v = trackVoice(t), k = chordSize(t.notes);
  if (v.seq || k <= (v.mode === 'poly' ? v.n : 1)) return;
  chordWarned.add(t.id);
  // the voices a switch would really give: setTrackModel loads the model's last-used values (loadVals) — a saved Unison /
  // Solo plays one note
  const voiceTo = x => trackVoice({ model: x.id, vals: loadVals(x) });
  const m = modelById(t.model), to = m.custom ? null : POLY_TO.map(modelById).find(x => x !== m && voiceTo(x).n >= k);
  const what = v.mode !== 'poly' ? `is ${v.mode === 'unison' ? 'in unison mode' : 'monophonic'} — its chords play one note`
    : `has ${v.n} voices${v.cap ? ' (CPU cap)' : ''} — a chord of ${k} notes drops some`;
  const txt = `“${t.name}” ${what}. Tap to ${to ? `switch it to the ${to.name} (${voiceTo(to).n} voices; Undo restores it)` : 'open its instrument'}`;
  noticeActs.set(txt, () => {
    noticeActs.delete(txt); notice('', 0);
    const tr = project.tracks.find(x => x.id === t.id); // (undo / redo replace the track objects)
    if (!tr) return;
    // (re-checked: the last-used values may have changed during the 15 s; flush lands a pending save first)
    if (to && tr.model === m.id && (flush(), voiceTo(to).n >= k)) setTrackModel(tr, to.id); else instPicker(tr);
  });
  notice(txt, 15000);
}
function instPicker(tr) { // the track's instrument on the canvas and the Sources tray to replace it (a Serum: its voicing in its panel)
  selectTrack(tr.id); openTab('canvas'); cvOpenSources('replace'); cvReveal(tr.id);
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
// the knob-tweak policy (§11.8) per device — the device ids are per track and never reused, so the same id is the same
// device (stage 1e: never one device's state into another id: a re-patch, Make primary, Delete of a primary): an instrument
// keeps its pattern, and its values and own FX when it kept its model; a panel its FX state. Stage 1c's "a track's rack is
// kept when its model changes": the primary's rack, when the primary is the same device and its rack moved between its
// panel and the Serum (classic ↔ Serum: one track's FX device is not in the other)
// (stage 2a) Save with preset / Keep on canvas move a row between track.mods (History) and the Serum's matrix (a knob
// tweak's state, kept): undoing / redoing one of them (modMove) takes the performance slots of the matrix from the
// snapshot too — a slot both sides hold empty or with a wheel / velo / at / bend row; every other row stays as it is now
const MOD_MOVE = /^(Save with preset|Keep on canvas)$/;
let modMove = false;
function modMoveBack(was, now) {
  const A = was && was.s && Array.isArray(was.s.matrix) ? was.s.matrix : null, B = now && now.s && Array.isArray(now.s.matrix) ? now.s.matrix : null;
  if (!A || !B) return;
  const perf = r => !r || !r.src || !!CMOD.SRC_MOD[r.src];
  let M = null;
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    if (!perf(A[i]) || !perf(B[i]) || JSON.stringify(A[i]) === JSON.stringify(B[i])) continue;
    if (!M) M = B.slice();
    M[i] = A[i];
  }
  if (M) now.s.matrix = M;
}
function keepDevs(t, cur) {
  if (!cur || !t.dev || !cur.dev) return;
  for (const id of Object.keys(t.dev)) {
    const d = t.dev[id], c = cur.dev[id];
    if (!d || !c || typeof d !== 'object' || typeof c !== 'object' || d.kind !== c.kind) continue;
    if (d.kind === 'synth') { if (d.model === c.model) { const was = modMove ? d.vals : null; d.vals = c.vals; if (c.fx) d.fx = c.fx; if (was) modMoveBack(was, c.vals); } if (c.seq) d.seq = c.seq; }
    else if (d.kind === 'panel' && c.fx) d.fx = c.fx;
  }
  const fa = CMOD.fxDevOf(t), fb = CMOD.fxDevOf(cur);
  if (fa && fb && fb.dev.fx && fa.id !== fb.id && CMOD.primId(t) === CMOD.primId(cur) && (fa.own ? !(fb.id in t.dev) : fb.own && !(fa.id in cur.dev))) fa.dev.fx = fb.dev.fx;
}
function applyRestore(p, keepSound = false) {
  if (!p) return;
  CMOD.adopt(p); // (History snapshots and loads are plain objects: the accessors first)
  // undo / redo never revert knob tweaks (per device) — within one project: an undo of Open / New brings back another project
  // (1f review: track ids repeat across projects; its sound is its own)
  if (keepSound && p.uid === project.uid) for (const t of p.tracks) keepDevs(t, project.tracks.find(x => x.id === t.id));
  else for (const t of p.tracks) seedPend.add(t.id); // a loaded project re-seeds the racks' LFO phases
  for (const t of p.tracks) fxOf(t);
  const prevSel = project.selTrack;
  project = p;
  bind();
  syncNodes();
  for (const t of project.tracks) { sendPatch(t); sendSong(t, true); }
  renderAll(!keepSound || prevSel !== project.selTrack);
  if (T.playing) reanchor(false);
  roUI(); // (a newer file's project read-only; Undo / New away from it: saved again)
  persist();
  cvModSync(); // (stage 2a: the open inspector / Mod list re-read the project)
}
function undo() { modMove = MOD_MOVE.test(hist.undoLabel); try { applyRestore(hist.undo(project), true); } finally { modMove = false; } updateUndoUI(); }
function redo() { modMove = MOD_MOVE.test(hist.redoLabel); try { applyRestore(hist.redo(project), true); } finally { modMove = false; } updateUndoUI(); }
let undoT = 0;
function updateUndoUI() { // canUndoFrom may serialise the project, so coalesce bursts of calls into one per frame
  if (undoT) return;
  undoT = requestAnimationFrame(() => { undoT = 0; $('#tUndo').disabled = !hist.canUndoFrom(project); $('#tRedo').disabled = !hist.canRedoFrom(project); });
}

/* ---------------------------------------------------------- transport */
// a: the anchor the nodes play from (render frames); as: the anchors still sounding, oldest first (the play() start,
// then each seek / tempo / loop change while playing: an older one's audio is heard until the next one's frame comes out
// of the speakers); seekA: the latest seek's anchor (recTick)
const T = { playing: false, rec: false, a: null, as: [], seekA: null, pos: 0, startPos: 0, take: 0, lastClr: 0 };
const fpt = () => ctx.sampleRate * 60 / (project.bpm * S.PPQ);
function loopInfo() { const L = project.loop; return { loop: !!(L.on && L.end > L.start), ls: L.start, le: L.end }; }
function anchor(F, tick) { const L = loopInfo(); return { frame: F, tick, fpt: fpt(), loop: L.loop, ls: L.ls, le: L.le, wrap: L.loop && tick < L.le }; }
// frame of the audio that is (was) leaving the speakers at a performance.now() time (audioclock.js: WebKit's render-stamped
// timestamp less its output path; + the Latency setting)
function outFrame(perfTs) { const now = performance.now(); return AC.outFrame(CLK, ctx, perfTs == null ? now : perfTs, now); }
// s the heard audio trails the rendered (Serum's clip recorder, host.latency; the header readout): below 0 when the
// Latency setting asks for more than the clock's own delay (the playhead and recording apply it as it is)
function outLatency() { return ctx ? clamp(ctx.currentTime - outFrame() / ctx.sampleRate, -0.1, 1) : 0; }
// the heard song position: on the latest anchor heard (T.as) — before a seek / tempo change is heard the audio before it,
// at a start the start tick (never ticks before it: no backwards jump of the playhead once the output delay is allowed for)
function curTick(perfTs) { return T.playing && T.a ? AC.heardTick(outFrame(perfTs), T.as) : T.pos; }
// the recorded position: after a seek the take reads the seek's line from the jump on (extrapolated back while the old
// audio is still heard: a key pressed after the jump belongs to it, its start and end on one line); else curTick
function recTick(perfTs) {
  const s = T.playing ? T.seekA : null;
  if (!s || !T.as.includes(s)) return curTick(perfTs);
  const F = outFrame(perfTs);
  return F < s.frame ? AC.tickAt(F, s) : AC.heardTick(F, T.as);
}
// fresh: a start / seek (the engine plays the anchor tick's notes even when the message arrives a little late); never on the
// re-sends to a node created mid-song (makeNode) or after a panic, or a tempo / loop change
function postTransport(seek) { postAll(Object.assign({ t: 'transport', play: true, seek }, seek ? { fresh: true } : null, T.a)); }
async function play(from = T.pos, countBars = 0) {
  try { await powerOn(); } catch { return; }
  if (!ctx || T.playing) return;
  for (const t of project.tracks) if (songQ.has(t.id)) sendSong(t, true);
  const F = Math.round((ctx.currentTime + 0.06 + (ctx.baseLatency || 0)) * ctx.sampleRate);
  T.a = anchor(F, from - countBars * S.barTicks(project)); T.as = [T.a]; T.seekA = null;
  T.playing = true; T.startPos = from; T.lastClr = from;
  postTransport(true);
  metroStart();
  transportUI();
}
function stop() {
  if (!T.playing) { if (T.pos !== 0) { T.pos = 0; posUI(); } return; }
  const t = recTick();
  if (T.rec) finishRec(t);
  postAll({ t: 'transport', play: false });
  T.playing = false; T.rec = false; T.a = T.seekA = null; T.as = [];
  T.pos = T.startPos;
  metroStop();
  for (const [k, P] of classicPanels) if (!seqRun.has(k) && !P.dead) P.seqStep(-1); // synced 303s stopped with the song
  transportUI(); posUI();
}
function reanchor(seekTick) { // tempo/loop change (or a seek) while playing, applied in sync on every node
  if (!T.playing || !ctx) return;
  const sr = ctx.sampleRate, F = Math.round((ctx.currentTime + 0.05) * sr), H = outFrame(), sk = seekTick != null && seekTick !== false;
  const t = sk ? seekTick : AC.tickAt(F, T.a);
  // an anchor not rendered yet never sounds: the nodes' single pending slot (engine tp.pend) takes this one instead
  const p = T.a.frame > ctx.currentTime * sr ? T.as.pop() : null;
  T.a = anchor(F, t); T.as.push(T.a);
  if (sk || (p && p === T.seekA)) T.seekA = T.a; // (a seek replaced before it sounded: this one carries its jump)
  let j = -1; for (let i = 0; i < T.as.length - 1; i++) if (T.as[i].frame <= H) j = i;
  if (j > 0) T.as.splice(0, j); // the anchors before the latest one heard are gone
  postTransport(sk);
  metroStart(F);
}
function seek(tick) {
  tick = Math.max(0, Math.round(tick));
  if (T.playing) { if (T.rec) finishRec(recTick()); reanchor(tick); T.startPos = tick; }
  else T.pos = tick;
  posUI();
}
function toggleRec() {
  if (T.rec) { finishRec(recTick()); T.rec = false; transportUI(); return; }
  if (!project.tracks.some(t => t.arm)) { trk().arm = true; renderHeads(); }
  hist.record(project); updateUndoUI();
  T.take = S.newId();
  if (T.playing) { T.rec = true; T.lastClr = curTick(); transportUI(); return; }
  T.rec = true;
  play(T.pos, project.metronome.countIn | 0);
}

/* output latency: the header Latency control (R5) */
// settings.lat (ms, −50 … +400) is added to the clock's own estimate for the playhead, recording and host.latency.
// Presets Auto (+0) and Bluetooth: a top-up to about BT_MS of output delay in all, over what the clock already allows
// (outputLatency includes Bluetooth on iPadOS 18.4+ and desktops — a flat +200 counted it twice; none reported before
// 18.4: +200); a fine slider with ±5 ms steps, and a live readout of what the clock measures. Kept in this device's
// synth.settings (latBT: the Bluetooth preset chosen; the installed app on an iPad keeps its own).
const BT_MS = 200;
// the hardware delay the clock already allows (s): WebKit the smoothed outputLatency (Bluetooth on iPadOS 18.4+, a fixed
// 512 / sr in a Private tab, 0 before 18.4); Chromium the speaker stamp's device delay (= outputLatency)
const latHw = () => (!ctx || ctx === holdCtx ? 0 : CLK.webkit ? CLK.outLat || +ctx.outputLatency || 0 : +ctx.outputLatency || 0);
const btLat = () => Math.max(0, BT_MS - Math.round(latHw() * 1000));
// the engine off where outputLatency is reported: the top-up is not known yet (never a blind +200)
const btBlind = () => (!ctx || ctx === holdCtx) && 'outputLatency' in ((window.AudioContext || window.webkitAudioContext || {}).prototype || {});
const latName = v => (settings.latBT ? 'Bluetooth' : v === 0 ? 'Auto' : (v > 0 ? '+' : '') + v + ' ms');
function setLat(v, bt) {
  settings.lat = clamp(Math.round(+v) || 0, -50, 400); settings.latBT = !!bt; CLK.user = settings.lat;
  persist(); latUI(); rateText();
}
// a preset button: 'bt' the Bluetooth top-up as measured now, else its ms
function latPreset(k) { if (k === 'bt') { if (!btBlind()) setLat(btLat(), true); } else setLat(k); }
function latUI() {
  const v = settings.lat, b = $('#lat');
  b.textContent = latName(v); b.setAttribute('aria-label', 'Output latency: ' + latName(v));
  $('#latR').value = String(v); $('#latV').textContent = (v > 0 ? '+' : '') + v + ' ms';
  for (const p of $('#latPop').querySelectorAll('[data-lat]')) {
    p.setAttribute('aria-pressed', (p.dataset.lat === 'bt' ? !!settings.latBT : !settings.latBT && +p.dataset.lat === v) ? 'true' : 'false');
  }
  btUI();
}
function btUI() { // the Bluetooth preset: its top-up as measured now (latRead refreshes it while the popover is open)
  const p = [...$('#latPop').querySelectorAll('[data-lat]')].find(x => x.dataset.lat === 'bt');
  if (!p) return;
  const blind = btBlind(), hw = Math.round(latHw() * 1000);
  p.disabled = blind;
  p.textContent = blind ? 'Bluetooth' : `Bluetooth +${btLat()} ms`;
  p.title = blind ? 'Start the engine first: it measures the Bluetooth delay' : `About ${BT_MS} ms of output delay in all: ${hw} ms already allowed + ${btLat()} ms`;
}
function latRead() {
  btUI();
  const el = $('#latInfo'), ms = x => (x == null ? '—' : (x * 1000).toFixed(1) + ' ms');
  const eng = CLK.webkit ? 'WebKit, stamped at render' : 'Chromium, stamped at the speaker';
  if (!ctx || ctx === holdCtx) { el.textContent = `engine    ${eng}\nThe measured numbers show while the engine runs.`; return; }
  const I = AC.clockInfo(CLK, ctx, performance.now());
  el.textContent = [`engine    ${eng}`, `output    ${I.out == null ? 'not reported' : ms(I.out)}`, `base      ${ms(I.base)}`,
    `stamp     ${ms(I.stamp)} behind currentTime`, CLK.webkit ? `ring      ${ms(I.ring)} (estimate)` : '',
    `stalls    ${ms(I.stall)}${CLK.webkit ? '' : ' (not added here)'}`, `IO step   ${ms(I.io)}`,
    `heard     ${ms(outLatency())} after render`, `allowed   ${ms(I.auto)} auto + ${ms(I.user)} yours`].filter(Boolean).join('\n');
}
function initLatency() {
  const btn = $('#lat'), pop = $('#latPop'), r = $('#latR');
  let tmr = 0;
  const close = () => { if (pop.hidden) return; pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); clearInterval(tmr); tmr = 0; };
  const open = () => {
    pop.hidden = false; btn.setAttribute('aria-expanded', 'true');
    pop.style.transform = ''; // kept inside the viewport (the header wraps on a narrow screen)
    const b = pop.getBoundingClientRect(), dx = Math.min(0, innerWidth - 8 - b.right) || Math.max(0, 8 - b.left);
    if (dx) pop.style.transform = `translateX(${dx}px)`;
    latRead(); tmr = setInterval(latRead, 250);
  };
  btn.onclick = () => (pop.hidden ? open() : close());
  r.oninput = () => setLat(r.value);
  for (const b of pop.querySelectorAll('[data-lat]')) b.onclick = () => latPreset(b.dataset.lat);
  for (const b of pop.querySelectorAll('[data-step]')) b.onclick = () => setLat(settings.lat + +b.dataset.step);
  document.addEventListener('pointerdown', e => { if (!pop.hidden && !(e.target && e.target.closest && e.target.closest('.latf'))) close(); }, true);
  const esc = e => { if (e.key === 'Escape' && !pop.hidden) { e.preventDefault(); e.stopPropagation(); close(); btn.focus(); } }; // (not a panic)
  btn.addEventListener('keydown', esc); pop.addEventListener('keydown', esc);
  latUI();
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
function recStart(tr, key, n, v, ts) { recLive.set(tr.id + '|' + key, { tr, n, t0: recTick(ts), v }); }
function recEnd(tr, key, ts) {
  const k = tr.id + '|' + key, r = recLive.get(k);
  if (!r) return;
  recLive.delete(k);
  commitNote(r, recTick(ts));
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
  const t = Math.round(recTick(ts));
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
// SPEC-serum2 §12.6: the targets of an input are midi.js's (Phase-1 rule + the MPE zone: a track whose Serum state has
// MPE on receives every channel of its input); notes of MPE tracks carry their channel ({t: 'on', n, v, ch}).
const held = new Map(); // `${src}:${n}` -> [[track id, ch]] (ch: midi.js noteCh of the note-on; its note-off carries it)
function targets(src) { return midiTargets(project.tracks, project.selTrack, src); } // src 0 = on-screen/computer keyboard; 1..16 = MIDI channel
function noteOn(n, v, src = 0, ts = performance.now()) {
  if (n < 0 || n > 127) return;
  const key = src + ':' + n;
  if (held.has(key)) noteOff(n, src, ts);
  const trs = targets(src);
  const chs = trs.map(t => noteCh(t, src));
  held.set(key, trs.map((t, i) => [t.id, chs[i]]));
  keyVis(n, true);
  const send = () => { trs.forEach((t, i) => postTo(t, noteMsg(t, { t: 'on', n, v }, src, chs[i]))); };
  if (!ctx) { powerOn().then(() => { if (held.has(key)) send(); }).catch(() => {}); }
  else { wake(); send(); } // queued while suspended; plays once the context runs
  if (T.rec) for (const t of trs) if (t.arm) recStart(t, key, n, v, ts);
  for (const t of trs) inputNote(t, 1, n, v, ts, false);
  playingUI(trs);
}
// rv: release velocity of a MIDI note-off (0–1; Serum's Release Velocity source), absent for other note-offs
function noteOff(n, src = 0, ts = performance.now(), rv) {
  const key = src + ':' + n, ids = held.get(key);
  if (!ids) return;
  held.delete(key);
  for (const [id, ch] of ids) {
    const t = project.tracks.find(x => x.id === id);
    if (!t) continue;
    postTo(t, noteMsg(t, rv == null ? { t: 'off', n } : { t: 'off', n, rv }, src, ch));
    recEnd(t, key, ts);
    inputNote(t, 0, n, 0, ts, false);
  }
  if (![...held.keys()].some(k => k.endsWith(':' + n))) keyVis(n, false);
}
function heldNotes(src) { const p = src + ':'; return [...held.keys()].filter(k => k.startsWith(p)).map(k => +k.slice(p.length)); }
// trs: the tracks (default: the input's targets); midi.js passes the non-MPE targets of an MPE expression.
// Stage 2a (SPEC §7.10): the live wheel also reaches every track holding a Mod Wheel cable (wheelTracks: the project's
// wheel placed, a 'wheel' row on the track) — one physical wheel; it is recorded into trs only (the armed ones, as today).
// Without the module the posts are today's. perfLive keeps the last value each track was sent (the modules' readouts)
const perfLive = new Map(); // track id → { wheel, at, bend }
const wheelTracks = () => CMOD.wheelTracks(project);
function ctl(kind, v, src = 0, ts = performance.now(), trs = targets(src)) {
  const m = kind === 'bend' ? { t: 'bend', v } : kind === 'wheel' ? { t: 'wheel', v } : kind === 'sus' ? { t: 'sus', v: !!v } : { t: 'at', v };
  const to = kind === 'wheel' ? trs.concat(wheelTracks().filter(t => !trs.includes(t))) : trs;
  for (const t of to) {
    postTo(t, m);
    if (kind !== 'sus') { const L = perfLive.get(t.id) || perfLive.set(t.id, {}).get(t.id); L[kind] = v; }
  }
  recCC(trs, kind, kind === 'sus' ? (v ? 1 : 0) : v, ts);
  if (kind === 'wheel') wheelToWt(v);
  if (kind !== 'sus') cvModLive(kind); // (lane D: the canvas Mod Wheel / Aftertouch / Bend module follows)
}
// the value a Velocity / Aftertouch / Bend / Mod Wheel module shows on track t (kind 'wheel' | 'at' | 'bend'; bend −1…1,
// the others 0…1): during playback the track's recorded lane at the heard tick, when it has one there; else the last
// live value sent to the track (0: none yet)
function perfValue(kind, t = trk()) {
  if (!t || (kind !== 'wheel' && kind !== 'at' && kind !== 'bend')) return 0;
  if (T.playing && Array.isArray(t.cc)) {
    const tick = curTick();
    let v, at = -Infinity;
    for (const c of t.cc) if (c.k === kind && c.t <= tick && c.t >= at) { at = c.t; v = c.v; }
    if (v !== undefined) return v;
  }
  const L = perfLive.get(t.id);
  return L && L[kind] !== undefined ? L[kind] : 0;
}
// Live input of a track, beyond the engine: the panel's input listener (host.onInput — clip recording, key lights; never
// the panel's own auditions) and the last input note group of a Serum track (render-last, §12.6 / §13.2.5: a group
// starts at a note-on while no input note of the track is held and ends at its last note-off; ≤ 16 notes
// {n, vel, on, off} in seconds from the group's first note-on; auditions count)
const inputSubs = new Map(); // track id → Map(dev → fn(on, n, vel 1–127, t ms)): each Serum panel of the track its own (U6)
const lastIn = new Map();    // track id → { t0, held: Map(n → note | null), notes: [{n, vel, on, off}] }
const GROUP_MAX = 16;
const lastV = new Map(); // track id → the last note-on velocity (0–1), the Velocity module's readout (stage 2a)
const lastVel = (t = trk()) => (t && lastV.has(t.id) ? lastV.get(t.id) : 0);
// The group follows the physical keys (§12.6): every held key is in `held` (null once the group stores no more notes), so
// the group ends at the last note-off however many notes it has; at most GROUP_MAX notes are stored
function inputNote(t, on, n, v, ts, audition) {
  if (on) { lastV.set(t.id, v); cvModLive('velo'); } // (lane D: the Velocity module's readout)
  if (!audition) { const S = inputSubs.get(t.id); if (S) for (const f of [...S.values()]) { try { f(on ? 1 : 0, n, on ? Math.max(1, Math.round(v * 127)) : 0, ts); } catch (err) { console.warn(err); } } }
  if (!hasSx(t)) return; // (render-last: any Serum instrument of the track, stage 1e)
  let g = lastIn.get(t.id);
  if (on) {
    if (!g || g.held.size === 0) { g = { t0: ts, held: new Map(), notes: [] }; lastIn.set(t.id, g); }
    const old = g.held.get(n);
    if (old && old.off < 0) old.off = Math.max(old.on, (ts - g.t0) / 1000);
    if (g.notes.length >= GROUP_MAX) { g.held.set(n, null); return; }
    const x = { n, vel: v, on: Math.max(0, (ts - g.t0) / 1000), off: -1 };
    g.notes.push(x); g.held.set(n, x);
  } else if (g) {
    if (!g.held.has(n)) return;
    const x = g.held.get(n);
    g.held.delete(n);
    if (x) x.off = Math.max(x.on, (ts - g.t0) / 1000);
  }
}
function panic() {
  for (const t of project.tracks) seqToggle(t, false); // not quiet: the Run button and step lights must show it stopped
  for (const k of [...held.keys()]) { const [src, n] = k.split(':'); noteOff(+n, +src); }
  hk.clear();
  setSustain(false);
  postAll({ t: 'panic' });
  if (T.playing) postAll(Object.assign({ t: 'transport', play: true, seek: true }, T.a)); // (not fresh: the old anchor replays nothing, R7 B1)
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
// (the canvas shell: the Sources tray's tiles replace the model nav; the selected track's model is marked there, and its
// drawing shows on the top row's track chip)
function renderNav() {
  if (shell.tiles) shell.tiles.setCurrent(model.id);
  if (shell.tiles && shell.src && shell.src.isOpen() && shell.tiles.mode() === 'replace') srcModeUI('replace'); // (its track's name)
  trkChipUI();
}
// o.ui 'flow' | 'hw': the synth in that layout (the Sources tray's Simple | Hardware), inside this step — the same model
// switches its layout (its own step), so the tray's switch goes both ways. Stage 1e: tr0 a device view — that instrument
// is replaced (cv-model setModel: its kept-FX rules); the track's primary as before (tr.model: the 1c reshape)
function setTrackModel(tr0, id, o = null) {
  const tr = trOf(tr0), dev = dvOf(tr0) || CMOD.primId(tr), v = instView(tr, dev), prim = dev === CMOD.primId(tr);
  const ui = o && (o.ui === 'flow' || o.ui === 'hw') && !modelById(id).custom ? o.ui : null;
  if (id === v.model) { if (ui && tr === trk() && instUi(tr, dev) !== ui) cvSetLayout(ui, dev); return; }
  flush(); // a pending save of the outgoing model's values must not be dropped
  const old = modelById(v.model), m = modelById(id);
  hist.record(project, 'Replace ' + old.name);
  seqToggle(tr, false, true, dev);
  postTo(tr, { t: 'panic' });
  if (prim && new RegExp('^' + old.name.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + '( \\d+)?$').test(tr.name)) tr.name = m.name + ' ' + (project.tracks.indexOf(tr) + 1);
  if (prim) { tr.model = id; tr.vals = loadVals(m); tr.preset = null; } // tr.fx (the track's rack) is kept
  else CMOD.setModel(tr, dev, id, { vals: loadVals(m) });
  if (ui === 'flow' || (ui === 'hw' && instUi(tr, dev) === 'flow')) layUi(tr, ui, dev); // (Hardware on an untouched track: no lay key)
  if (tr.id === project.selTrack) {
    if (dev === curOf(tr)) { bind(); settings.model = id; renderNav(); history.replaceState(null, '', '#' + id); }
    renderPanel(tr, dev);
  }
  sendPatch(tr);
  if (id === 'tb303') { if (prim) seqSend(tr); else seqSend(tr, dev); }
  if (ctx) rateText();
  renderHeads(); persist(); updateUndoUI();
}
function selectTrack(id) {
  if (id === project.selTrack && model.id === curView(trk()).model) return;
  for (const k of [...held.keys()]) { const [src, n] = k.split(':'); noteOff(+n, +src); }
  flush();
  project.selTrack = id;
  bind();
  renderNav(); renderViews(); renderHeads();
  roll && roll.setTrack(); arr && arr.render();
  tabTrackUI();
  persist();
}
// the current instrument of track t (a tap on its module, a press in its panel, its module menu): the globals and the
// panel services follow (bind, cpanel), the Sources tray's tile and its replace text
function setCur(t, dev) {
  if (!t || dev !== CMOD.primId(t) || curOf(t) === dev) return; // (1f: only the primary — the cv.setCur hook)
  if (t === trk()) flush(); // (the outgoing model's values: save writes synth.v.<model> from vals)
  curDevs.set(t.id, dev);
  if (t !== trk()) return;
  bind(); cpSync(); renderNav(); aboutUI(model); drawAlgo(); tabTrackUI();
}

/* ------------------------------------------------------------ panel */
// A classic instrument shows its Hardware layout (cv-panel: the real front panel, fixed size) unless the track chose the
// Simple one (track.lay.<dev>.ui === 'flow': today's flowing sections at its model's fixed width, cvModule.FLOW_W). A model
// whose hardware panel is not drawn yet (or fails validation) shows today's panel in either (IMPL-panels §7).
const hwLayoutOf = m => (m && !m.custom ? cvPanel.usable(m.id, m) : null);
function instUi(t, dev) { // (stage 1e: instrument dev, default the current one; its lay key is its device id)
  const d = dev == null && t ? curOf(t) : dev, v = t ? instView(t, d) : null;
  if (!t || isSx(v)) return 'flow';
  const e = t.lay && typeof t.lay === 'object' ? t.lay[d || cvModule.ID.inst] : null;
  return e && e.ui === 'flow' ? 'flow' : 'hw';
}
// the page's services for a ClassicPanel (one per mounted classic instrument: its own track — a device view —, values and
// updaters)
const classicHost = {
  doc: document,
  changed: valChanged,
  presetTouched: () => { renderHeads(); persist(); },
  kit: { track: (...a) => track(...a), pressOrTap: (...a) => pressOrTap(...a), noMenu: el => noMenu(el), hoverable: el => hoverable(el),
    wheelIn: (el, e) => wheelIn(el, e), wheelStep: (el, w) => wheelStep(el, w), tip: (el, text) => tipText(el, text), untip: ms => hideTip(ms) },
  presets: { list: m => presetList(m), cur: t => presetCur(t), load: (t, key) => presetLoad(key, t), step: (t, d) => presetStep(d, t),
    save: t => presetSave(t), del: t => presetDelete(t), init: t => presetInit(t), touch: (t, key) => presetKeys.set(t.id, key) },
  chip: () => cvChipSync(),
  presetNo: t => { const c = presetCur(t); return c && /^f\d+$/.test(c.key) ? +c.key.slice(1) + 1 : null; }, // the factory number (1-based)
  seq: { of: tr => seqOf(tr), send: tr => seqSend(tr), running: tr => seqRun.has(tr.id), toggle: (tr, on) => seqToggle(tr, on), toRoll: seqToRoll,
    hw: tr => { let st = seqHw.get(tr.id); if (!st) seqHw.set(tr.id, st = { cur: 0, mode: 'pitch' }); return st; } },
  dx: tr => hwDx(tr),
};
const panelKey = v => { const t = trOf(v); return t ? t.id + '/' + (dvOf(v) || CMOD.primId(t)) : ''; };
const classicOf = v => { const P = v && classicPanels.get(panelKey(v)); return P && !P.dead && P.track === v ? P : null; };
function cpSync() { const t = trk(), P = classicPanels.get(t.id + '/' + curOf(t)); cpanel = P && !P.dead ? P : null; }
function aboutUI(m) { $('#about-title').textContent = `${m.maker} ${m.name} (${m.year})`; $('#about').textContent = m.about; }
// the element instrument dev of t renders into: its module body (cvBodyEl; the primary's is #inst), or without the canvas
// DOM #inst for the current one
const instEl = (t, dev) => (cvOn() ? cvBodyEl(t, dev) : dev === curOf(t) ? $('#inst') : null);
function renderPanel(t = trk(), dev = curOf(t)) {
  const v = instView(t, dev), m = modelById(v.model), key = t.id + '/' + dev, el = instEl(t, dev);
  const old = classicPanels.get(key);
  if (old) { old.destroy(); classicPanels.delete(key); }
  if (!el) { cpSync(); return; }
  for (const [k, P] of classicPanels) if (P.root === el) { P.destroy(); classicPanels.delete(k); } // (#inst: another track's primary)
  for (const a of ['style', 'data-hw', 'data-ptr', 'data-knurl', 'data-cap']) el.removeAttribute(a); // (a hardware panel's size and --hw-* go)
  cvBuilt.set(key, el);
  const cur = t === trk() && dev === curOf(t);
  if (m.custom) { renderCustom(el, t, dev); cpSync(); cvPanelDone(); return; }
  sxDropEl(el);
  const L = instUi(t, dev) === 'hw' ? hwLayoutOf(m) : null;
  classicPanels.set(key, new ClassicPanel(el, { track: v, model: m, layout: L, host: classicHost })); // (Hardware: presets through the chip and the ⋯ menu)
  cpSync();
  if (cur) { aboutUI(m); drawAlgo(); }
  cvPanelDone();
}
// every instrument of the selected track (the current one alone without the canvas DOM); one cvRender after them
function renderPanels(t = trk()) {
  if (!cvOn()) { renderPanel(t, curOf(t)); return; }
  const was = cvBusy;
  cvBusy = true;
  try { for (const id of CMOD.instIds(t)) renderPanel(t, id); } finally { cvBusy = was; }
  cvPanelDone();
}
const syncPresetSel = k => { if (cpanel) cpanel.syncPreset(k); else cvChipSync(); };
// the TB-303's hardware step entry state (IMPL-panels §6.2): a step cursor and PITCH / TIME mode per track (session only, never
// in the project)
const seqHw = new Map(); // track id → { cur, mode }
// the DX7's select-and-set workflow (IMPL-panels §6.3): {op, param (the button), eg, mode} per track, session only
const dxHw = new Map(); // track id → { op, param, eg, mode }
function hwDx(tr) {
  let st = dxHw.get(tr.id);
  if (!st) dxHw.set(tr.id, st = { op: 1, param: 7, eg: 1, mode: 'edit' });
  const m = modelById(tr.model);
  return {
    state: st, algs: DX_ALGS, layout: algoLayout, presets: m.presets.length,
    load: n => { if (tr.model === m.id) presetLoad('f' + (n - 1), tr); },
    presetName: () => tr.preset,
  };
}

/* tooltip */
const tip = $('#tip');
let tipHide;
function tipText(el, text) { // #tip with free text over el (screen px: right under the canvas transform too)
  clearTimeout(tipHide);
  const r = el.getBoundingClientRect();
  tip.textContent = text;
  tip.style.left = (r.left + r.width / 2) + 'px';
  tip.style.top = (r.top - 6) + 'px';
  tip.classList.add('show');
}
function hideTip(delay = 0) { clearTimeout(tipHide); tipHide = setTimeout(() => tip.classList.remove('show'), delay); }

// Pointer drag with capture. Ends on pointerup/cancel, lost capture, or a mouse move with no button held
// (a context menu can swallow the pointerup), so a drag can never be left running. abort (optional) runs first when
// the two-finger layer (gesture.js) cancels the drag — a pointercancel flagged e.gesture === 'two-finger': it puts back
// what the drag changed (a plain pointercancel keeps it, as before).
function track(el, e, move, end, abort) {
  let done = false;
  const mv = ev => { if (ev.pointerId !== e.pointerId) return; if (ev.pointerType === 'mouse' && !(ev.buttons & 1)) return fin(); move(ev); };
  const fin = ev => {
    if (done || (ev && ev.pointerId !== e.pointerId)) return;
    done = true;
    for (const [t, f] of L) el.removeEventListener(t, f);
    try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (abort && ev && ev.type === 'pointercancel' && ev.gesture === 'two-finger') abort();
    if (end) end();
  };
  const L = [['pointermove', mv], ['pointerup', fin], ['pointercancel', fin], ['lostpointercapture', fin]];
  try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  for (const [t, f] of L) el.addEventListener(t, f);
}
// A press that acts at once for a mouse or pen, but for a finger on its tap's release (≤ 10 px): a scroll or a
// two-finger gesture (gesture.js cancels the first finger) starting there never selects or closes anything.
// ok(e): the press (and the release) counts.
function pressOrTap(el, ok, fn) {
  let p = null;
  el.addEventListener('pointerdown', e => {
    p = null;
    if (!ok(e)) return;
    if (e.pointerType === 'touch') p = { id: e.pointerId, x: e.clientX, y: e.clientY }; else fn(e);
  });
  el.addEventListener('pointerup', e => { const P = p; p = null; if (P && P.id === e.pointerId && Math.hypot(e.clientX - P.x, e.clientY - P.y) <= 10 && ok(e)) fn(e); });
  el.addEventListener('pointercancel', e => { if (p && p.id === e.pointerId) p = null; });
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
  if (document.activeElement !== el && (now - pageScrollT < 400 || now - (hoverT.get(el) || 0) < 300 || cvWheelVeto())) return null;
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
/* ---------------------------------------------------------- presets */
function userPresets(m = model) { return store.get('synth.user.' + m.id, []); }
function presetList(m) {
  return m.presets.map((p, i) => ({ key: 'f' + i, name: p.name, v: p.v, group: 'Factory' }))
    .concat(userPresets(m).map((p, i) => ({ key: 'u' + i, name: p.name, v: p.v, group: 'Saved' })));
}
function applyPreset(tr, p) { // (tr: a device view, stage 1e)
  const m = modelById(tr.model), t = trOf(tr), cur = t.id === project.selTrack && panelKey(tr) === t.id + '/' + curOf(t);
  tr.vals = Object.assign(defaults(m), p.v);
  tr.preset = p.name;
  presetKeys.set(tr.id, p.key || null);
  if (cur) bind();
  const P = classicOf(tr);
  if (P) { P.refresh(); if (cur) drawAlgo(); P.syncPreset(p.key); } else if (cur) { drawAlgo(); syncPresetSel(p.key); }
  sendPatch(t); renderHeads(); persist();
}
// The preset actions, shared by the Simple panel's preset plate, the module chip (◀ ▶) and its ⋯ menu (Save / Delete /
// Init: the Hardware panel has no plate; IMPL-panels §7.4), each on a track (default: the selected one). The current
// entry: the one last loaded on that track (presetKeys), else the first with the track's preset name. Stage 1e: each on
// an instrument (a device view: its id 'trackId/dev'; default the selected track's current instrument)
const presetKeys = new Map(); // track id (a view's id) → the key of the entry last loaded
function presetCur(t = curView()) { const l = presetList(modelById(t.model)), k = presetKeys.get(t.id); return l.find(x => x.key === k && x.name === t.preset) || l.find(x => x.name === t.preset) || null; }
function presetLoad(key, t = curView()) { const p = presetList(modelById(t.model)).find(x => x.key === key); if (p) applyPreset(t, p); return !!p; }
function presetStep(d, t = curView()) { // ◀ ▶: from the blank / Custom entry, ▶ the first, ◀ the last
  const keys = presetList(modelById(t.model)).map(p => p.key);
  if (!keys.length) return;
  const cur = presetCur(t);
  let i = cur ? keys.indexOf(cur.key) : -1;
  i = i < 0 ? (d > 0 ? 0 : keys.length - 1) : (i + d + keys.length) % keys.length;
  presetLoad(keys[i], t);
}
function presetSave(t = curView()) {
  const m = modelById(t.model), cur = presetCur(t);
  const name = (prompt('Name this sound:', t.preset && cur && /^u\d+$/.test(cur.key) ? t.preset : 'My ' + m.name + ' sound') || '').trim();
  if (!name) return;
  const up = userPresets(m), i = up.findIndex(p => p.name === name);
  if (i >= 0 && !confirm(`Replace the saved sound “${name}”?`)) return;
  if (i >= 0) up[i] = { name, v: Object.assign({}, t.vals) }; else up.push({ name, v: Object.assign({}, t.vals) });
  store.set('synth.user.' + m.id, up);
  t.preset = name; presetKeys.set(t.id, 'u' + (i >= 0 ? i : up.length - 1));
  presetShown(t); renderHeads(); persist();
}
const presetSaved = (t = curView()) => { const c = presetCur(t); return c && /^u\d+$/.test(c.key) ? c : null; }; // a saved sound is loaded
function presetDelete(t = curView()) {
  const c = presetSaved(t), mm = c && /^u(\d+)$/.exec(c.key), m = modelById(t.model);
  if (!mm) return;
  const up = userPresets(m), p = up[+mm[1]];
  if (!p || !confirm(`Delete the saved sound “${p.name}”?`)) return;
  up.splice(+mm[1], 1);
  store.set('synth.user.' + m.id, up);
  if (t.preset === p.name) t.preset = null;
  presetKeys.delete(t.id);
  presetShown(t); renderHeads(); persist();
}
function presetInit(t = curView()) { presetKeys.delete(t.id); applyPreset(t, { name: null, v: {} }); }
// the track's preset name changed outside a load: its panel's plate and the chip follow
function presetShown(t) { const P = classicOf(t); if (P) P.syncPreset(presetKeys.get(t.id)); else if (trOf(t) === trk()) cvChipSync(); }

/* ------------------------------------------ Serum and the FX racks (SPEC-serum §11.8) */
// The panel modules (serum-ui.js, fx-ui.js and their siblings) and wt.js / wtstore.js load on first use, so the other
// models start as before and a failure there leaves them working. The DSP scripts also run on the main thread for the
// panel's displays (wk.loadDSP).
const hostStore = { get: (k, d) => store.get(k, d), set: (k, v) => store.set(k, v) };
let uiLoad = null;
function uiMods() {
  if (!uiLoad) {
    uiLoad = Promise.all([import('./serum-ui.js?v=' + VERSION), import('./fx-ui.js?v=' + VERSION), import('./wk.js?v=' + VERSION), wtMod()])
      .then(([sx, fxui, wk]) => wk.loadDSP(DSP_URLS).then(() => { kitPrefs(wk); return { sx, fxui, wk }; }));
    uiLoad.catch(err => { console.error('Serum panel modules failed to load', err); uiLoad = null; });
  }
  return uiLoad;
}
// the widget preferences (§9.7: tooltips, double-click, mouse wheel) hold for every panel, the FX tab's rack included
function kitPrefs(wk) { if (wk && wk.setPrefs) wk.setPrefs({ tooltips: prefs.tooltips, dblClick: prefs.dblClick, wheel: prefs.wheel }); }

// Assets in the worklet (SPEC-serum2 §9.5, §11.12): the asset manager of assets.js (owner S1) generalises the Phase-1
// wavetable manager to samples, multisamples, spectral analyses and impulse responses: each id is built off the main
// thread and posted once per AudioContext before the patches that need it, reference-counted over every track's
// patch.needs, freed when unreferenced. Its Phase-1 surface (ensure, entries, list, rows, embed, restore, update …) and
// the panel hosts host.wt / host.smp are used below. Factory content is generated on demand with a progress notice
// (lead sign-off on §0.8 item 9).
const tables = createAssetManager({
  ctxOf: () => ctx,
  post: portPoster(nodes),
  tracks: () => project.tracks,
  edit: (t, fn, o) => sxEdit(t, fn, o),
  editFx: (t, fn, o) => fxEdit(t, fn, o),
  defaultState: () => core.defaultSerum(),
  refresh: () => sxRefresh(),
  notify: txt => notice(txt, 5000),
  progress: genProgress,
  touch: touchDev,
  zoneOf: o => zoneOf(o),
  // the canvas build's own asset databases (SPEC-canvas §5.6; main's are synth-wt / synth-smp)
  stores: {
    wt: () => import('./wtstore.js?v=' + VERSION).then(m => m.openStore({ name: WT_DB }).catch(() => m.memoryStore())),
    smp: () => import('./smpstore.js?v=' + VERSION).then(m => m.openStore({ name: SMP_DB }).catch(() => m.memoryStore())),
  },
});
const wtHost = tables.host.wt, smpHost = tables.host.smp;
const wtMod = () => tables.wtMod();
// factory generation progress (§9.7): "Generating factory sounds… n %" with a cancel action while it runs
// in the notice line's idle slot (below timed notices and the sticky audio message, which it never clears); the tap-to-
// cancel action is attached only while the line shows the progress text (showNotice)
let genT = 0;
function genCancel() { smpHost.cancel(); genProgress(null); }
function genProgress(p) {
  clearTimeout(genT); genT = 0;
  if (!p) {
    if (!genTxt) return;
    const was = genTxt;
    genTxt = '';
    if (!noticeT && $('#notice').textContent === was) showNotice(sticky);
    return;
  }
  const pct = p.total > 0 ? Math.round(100 * p.done / p.total) : 0;
  genTxt = `${ATEXT.generating} ${pct} %${p.name ? ' (' + p.name + ')' : ''} — tap to cancel`;
  if (!noticeT && !sticky) showNotice(genTxt);
  genT = setTimeout(() => genProgress(null), 60000); // a stalled generation does not keep the notice forever
}
// the user assets (wavetables, noises; samples, multisamples, IRs) a track references (project / preset files, §9.8)
const userTables = s => (s ? userIdsOf(s) : []);
const userSmps = (s, fx) => userAssetIds(s || null, fx || null);

// snapshot / FX meter subscriptions (smon, §11.6; SPEC-canvas §6.8, §6.9, §9.3): one per mounted module with live
// displays, keyed by (track, device) — a Serum panel (its device), an FX panel (its device; a Serum's own FX: the
// Serum's) — each live while its module is (cvLive: the CANVAS view, on screen, not folded) and never for a hidden page,
// naming what it shows by `role` ('inst': an instrument's snapshot, 'fx': an FX panel's meters, 'both'; the engine parts
// are resolved per node: partsOf). A track's node sends snapshots of the parts of its live subscriptions ({t: 'mon',
// ids}; on: their ids, sorted, joined). A legacy node's parts are i0 / c0 and its snapshot reaches every subscription of
// the track (stage 1d); a graphed node's are device ids (stage 1e) and its snapshot ({t: 'smon', i | c}) reaches the
// subscriptions showing that part (a Serum's whole device — panel and own FX — is its Inst part: one message, its
// snapshot with its own FX's meters; review H5).
//   sub(trackId, dev, {role, live() → bool, deliver(d)}) → off   (role: 'both' by default; `parts` ['i0'] / ['c0'] /
//   both, stage 1d's form, are read as the role)
function partsOf(t, N, dev, role) {
  const inst = role !== 'fx', fx = role !== 'inst';
  if (!N || !N.graphed || !t || !t.dev) return [...(inst ? ['i0'] : []), ...(fx ? ['c0'] : [])];
  if (typeof dev !== 'string') return [];
  const own = /\/fx$/.test(dev), d = t.dev[own ? dev.slice(0, -3) : dev];
  if (own) return fx ? (d && d.model === 'serum' ? [dev.slice(0, -3)] : [dev]) : [];
  if (!d) return [];
  if (d.kind === 'panel') return fx ? [dev] : [];
  // a Serum: its Inst part alone, whatever the role — its message carries its own FX's meters and phases ({i, s, gr, fxph,
  // ftap}); its 'iN/fx' part as well would post a second message without the snapshot (blanking the panel's) and tap twice
  if (d.model === 'serum') return [dev];
  const out = inst ? [dev] : [];
  if (fx) { const p = CMOD.destOf(t, dev); if (p && t.dev[p].kind === 'panel') out.push(p); }
  return out;
}
const roleOf = o => (o.role ? o.role : Array.isArray(o.parts) && o.parts.length ? (o.parts.includes('i0') ? (o.parts.includes('c0') ? 'both' : 'inst') : 'fx') : 'both');
const monitors = {
  subs: new Set(), on: new Map(),
  sub(trackId, dev, o) {
    const S = { trackId, dev, role: roleOf(o), live: o.live, deliver: o.deliver, cur: [] };
    this.subs.add(S);
    this.sync();
    return () => { if (this.subs.delete(S)) this.sync(); };
  },
  wanted(id, N0) { // → the parts to monitor, sorted ([] = none)
    const w = new Set();
    if (document.hidden) return [];
    const N = N0 || nodes.get(id), t = project.tracks.find(x => x.id === id);
    for (const S of this.subs) if (S.trackId === id) {
      S.cur = partsOf(t, N, S.dev, S.role);
      try { if (S.live()) for (const q of S.cur) w.add(q); } catch (err) { console.warn(err); }
    }
    return [...w].sort();
  },
  sync() {
    const ids = new Set(this.on.keys());
    for (const S of this.subs) ids.add(S.trackId);
    for (const id of ids) {
      const w = this.wanted(id), k = w.join();
      if ((this.on.get(id) || '') === k) continue;
      if (k) this.on.set(id, k); else this.on.delete(id);
      postTo({ id }, { t: 'mon', ids: w });
    }
    if (peerStale.size && !peerT) peerT = requestAnimationFrame(peerRun); // a peer edited while this one was hidden
  },
  deliver(id, d) {
    const part = typeof d.i === 'string' ? d.i : typeof d.c === 'string' ? d.c : null;
    for (const S of [...this.subs]) if (S.trackId === id && S.deliver && (part === null || S.cur.includes(part) || (d.i === part && S.cur.includes(part + '/fx')))) S.deliver(d);
  },
  // the meters and phases of an FX part arrive (N.fxph fresh): dev's (default: the primary's FX)
  fx(id, dev) {
    const on = (this.on.get(id) || '').split(','), N = nodes.get(id);
    if (!N || !N.graphed) return on.includes('c0');
    const t = project.tracks.find(x => x.id === id), f = dev || (t && CMOD.fxDevOf(t) ? CMOD.fxDevOf(t).id : null);
    return partsOf(t, N, f, 'fx').some(q => on.includes(q));
  },
};
// the Serum panel's subscription (SerumUI host.monitor: on while it is built and the page shows): per (track, device)
const sxMons = new Map(); // trackId/dev → off
function sxMonitor(t, on, dev = CMOD.primId(t)) {
  const id = t.id, key = id + '/' + dev, off = sxMons.get(key);
  if (!on) { if (off) { sxMons.delete(key); off(); } return; }
  if (off) { monitors.sync(); return; }
  sxMons.set(key, monitors.sub(id, dev, { role: 'both', // (its snapshot, and its FX page's meters; stage 1e: that device's panel)
    live: () => { const r = sxRecOf(id, dev); return !!r && r.trackId === id && cvLive(dev); },
    deliver: d => { const r = sxRecOf(id, dev); if (r && r.ui && r.trackId === id) { r.ui.setSnapshot(d); if (r === sxPanel) zoneWarm(id, d.s); } },
  }));
}
// "Switch to Single Sample" (host.smp.saveFrom → zoneOf): the zone sample the panel's recent voice plays, from the
// snapshot's zone index and the multisample's record (read once per multisample, cached)
const msRecs = new Map();
function zoneWarm(id, sn) {
  const t = project.tracks.find(x => x.id === id);
  if (!sn || !sn.zone || !isSx(t)) return;
  for (let o = 0; o < 3; o++) {
    const O = t.vals.s.osc[o], m = O && O.type === 'multi' ? O.multi : '';
    if (!m || sn.zone[o] < 0 || msRecs.has(m)) continue;
    msRecs.set(m, null);
    Promise.resolve(smpHost.record(m)).then(r => msRecs.set(m, r || null), () => msRecs.delete(m));
  }
}
function zoneOf(o) {
  const t = project.tracks.find(x => x.id === sxPanel.trackId), sn = sxPanel.ui && sxPanel.ui.snap;
  if (!isSx(t) || !sn || !sn.zone || !(o >= 0 && o < 3)) return null;
  const O = t.vals.s.osc[o], r = O && O.multi ? msRecs.get(O.multi) : null, z = sn.zone[o];
  return r && Array.isArray(r.zones) && z >= 0 && z < r.zones.length && r.zones[z] ? r.zones[z].smp || null : null;
}

// FX rack edits (any track, either view): the host compiles and sends unless the edit is UI-only; seed = the edit
// loaded a chain / module preset (§4.2). Not in the undo history (knob-tweak policy, §11.8).
// Stage 1e: t a device view (its Serum's own FX / its panel), or fxEditDev(t, dev) — dev a Serum, a panel or null (the
// primary's FX)
function fxEdit(t, fn, o) { fxEditDev(trOf(t), dvOf(t), fn, o); }
function fxEditDev(t, dev, fn, o) {
  fn(fxOfDev(t, dev));
  if (o && o.ui) { persist(); return; }
  if (o && o.seed) seedPend.add(t.id);
  const d = dev && t.dev ? t.dev[dev] : null;
  if (d ? d.model === 'serum' : isSx(t)) sxDirty.add(d ? instView(t, dev).id : t.id);
  queuePatch(t); persist();
}
const sxDirty = new Set(); // Serum tracks edited since their preset was loaded / saved (program change asks, §9.10)
function sxEdit(t, fn, o) { // (t: a device view, stage 1e)
  const s = t && t.vals && t.vals.s;
  if (!s) return;
  const os = s.global.os;
  fn(s);
  if (o && o.ui) { persist(); return; }
  if (o && o.seed) seedPend.add(trOf(t).id);
  sxDirty.add(t.id);
  queuePatch(trOf(t)); persist();
  if (s.global.os !== os && ctx) rateText();
  if (o && o.label === 'Init Preset') { t.preset = 'Init'; sxKeys.delete(t.id); sxDirty.delete(t.id); renderHeads(); } // the panel's menu
}
let sxRefT = 0;
function sxRefresh() { // repaint the mounted panel and rack (outside edits: MIDI, program change, wheel, new tables)
  if (sxRefT) return;
  // (+ the canvas: a preset load or a MIDI power change re-derives the FX module's subtitle and the cable's route label)
  sxRefT = requestAnimationFrame(() => { sxRefT = 0; for (const r of sxRecs()) if (r.ui) r.ui.refresh(); for (const r of fxRecs()) if (r.ui) r.ui.refresh(); cvRelabel(); });
}
// app preferences changed (the panel stores them): every Serum track is recompiled — the MPE preferences, smoothing
// and Ultra reach compileSerum (§12.6, §13.10) — and the rack preferences (smoothing, silence tails) reach every track
function prefsChanged() {
  const old = prefs;
  prefs = readPrefs();
  const all = old.smooth !== prefs.smooth || old.silenceTails !== prefs.silenceTails;
  for (const t of project.tracks) if (all || isSx(t)) queuePatch(t);
  if (uiLoad) uiLoad.then(M => kitPrefs(M.wk), () => {});
}
// the latest LFO phases of a track's rack (FXRack.phases(): fxLayout order, NaN = no LFO) → the FX state (v2 inst.ph by
// instance, v1 fx.phase; fx-core storePhases): saved with presets and projects, no re-seed (§8.1, §11.8)
function setPhases(t, v) { if (v) core.storePhases(fxOf(t), v); }
const MODFX = ['fx.hyper.on', 'fx.flg.on', 'fx.phs.on', 'fx.cho.on'];
const PH_TYPES = new Set(['hyper', 'flg', 'phs', 'cho', 'bode']);
function hasLfoFx(fx) { // a rack whose phases are worth reading back (an enabled module with an LFO)
  if (!isV2Fx(fx)) return MODFX.some(id => fx.p[id] >= 0.5);
  return core.fxLayout(fx).inst.length > 0 && fx.racks.some(r => r && Array.isArray(r.mods) && r.mods.some(function on(I) {
    return !!I && ((PH_TYPES.has(I.type) && !!I.p && I.p.on >= 0.5) || (Array.isArray(I.br) && I.br.some(b => Array.isArray(b) && b.some(on))));
  }));
}
function syncPhases() {
  const jobs = [];
  for (const t of project.tracks) {
    const N = nodes.get(t.id), fx = fxOf(t);
    if (!N || !hasLfoFx(fx)) continue;
    if (monitors.fx(t.id) && N.fxph) { setPhases(t, N.fxph); continue; }
    jobs.push(new Promise(res => {
      const tm = setTimeout(res, 300);
      N.phWait.push(v => { clearTimeout(tm); setPhases(t, v); res(); });
      N.node.port.postMessage({ t: 'fxph' });
    }));
  }
  return Promise.all(jobs);
}
// the Save download: the project plus the user wavetables and user samples / multisamples / IRs its tracks reference
// (§7.10, SPEC-serum2 §9.8: Convolve IRs of any track; never in the autosave)
async function projectFile() {
  await syncPhases();
  const ids = new Set(), sm = new Set();
  for (const t of project.tracks) {
    const s = isSx(t) && t.vals.s ? t.vals.s : null;
    for (const id of userTables(s)) ids.add(id);
    for (const id of userSmps(s, fxOf(t))) sm.add(id);
    for (const k of Object.keys(t.dev || {})) { // (stage 1e: every other Serum and panel of the track)
      const d = t.dev[k], x = d && d.kind === 'synth' && d.model === 'serum' && d.vals ? d.vals.s : null;
      if (!d || (d.kind !== 'panel' && !x)) continue;
      for (const id of userTables(x)) ids.add(id);
      for (const id of userSmps(x, d.fx)) sm.add(id);
    }
  }
  const o = CM.mirror(JSON.parse(S.serialize(project))); // (SPEC-canvas §5.8: main opens it as each track's primary + its FX)
  if (ids.size) o.wts = await tables.embed([...ids]);
  if (sm.size) o.smps = await tables.embedSmps([...sm]);
  persist();
  return JSON.stringify(o);
}
// "Save as classic project" (SPEC-canvas §5.4, the regret path): the file the classic SYNTH (main) opens — each track's
// instrument with its FX (cv-migrate toV1: today's shape converts exactly). What main cannot hold is listed first (null:
// the user declined). (A read-only project too: it writes nothing here.)
async function classicFile() {
  const r = CM.toV1(JSON.parse(await projectFile()));
  if (r.lost.length && !confirm('The classic SYNTH can’t hold everything in this project:\n• ' + r.lost.join('\n• ') + '\n\nSave it anyway?')) return null;
  return JSON.stringify(r.p);
}
// embedded assets of a project / preset / pack file go into the stores (identical ids skipped), never into the state
async function restoreEmbedded(o) {
  if (!o || typeof o !== 'object') return;
  if (o.wts) { await tables.restore(o.wts); delete o.wts; }
  if (o.smps) { await tables.restoreSmps(o.smps); delete o.smps; }
}

/* Serum presets (§9.10, §11.8; SPEC-serum2 §13.11): factory (serum-core FACTORY_PRESETS v2: the new presets, then the
   migrated Phase-1 ones) + user presets (synth.user.serum in the app store; ratings / tags / comments in the preset's
   `meta`). Files: one preset ({type: 'synth.serum.preset', …, wts, smps}) or a pack ({type: 'synth.serum.pack', v: 1,
   name, presets, wts, smps}, also as pack.json inside a ZIP, §9.8); user assets are always embedded (deviation 14). */
const SXM = MODELS.find(m => m.id === 'serum');
const sxUser = () => { const l = store.get('synth.user.serum', []); return Array.isArray(l) ? l.filter(p => p && typeof p.name === 'string' && p.v && p.v.s) : []; };
const sxKeys = new Map(); // track id → key of the preset it was loaded from
function sxPresetList() {
  const row = (p, user) => {
    const s = p.v.s || {}, m = p.meta && typeof p.meta === 'object' ? p.meta : {};
    const r = { key: (user ? 'u:' : 'f:') + p.name, name: p.name, cat: p.cat || (user ? 'User' : ''), author: s.author || '', user };
    if (Array.isArray(s.tags)) r.tags = s.tags.slice();
    if (user) { if (m.stars !== undefined) r.stars = m.stars; if (Array.isArray(m.tags)) r.tags = m.tags.slice(); if (typeof m.comments === 'string') r.comments = m.comments; }
    return r;
  };
  return SXM.presets.map(p => row(p, false)).concat(sxUser().map(p => row(p, true)));
}
function sxPreset(key) {
  if (typeof key !== 'string') return null;
  if (key.startsWith('f:')) return SXM.presets.find(p => 'f:' + p.name === key) || null;
  if (key.startsWith('u:')) return sxUser().find(p => 'u:' + p.name === key) || null;
  return null;
}
function sxCurrent(t) {
  const k = sxKeys.get(t.id);
  if (k && sxPreset(k)) return k;
  if (!t.preset) return null;
  return sxPreset('u:' + t.preset) ? 'u:' + t.preset : sxPreset('f:' + t.preset) ? 'f:' + t.preset : null;
}
// applyPreset / applyPresetFx build new states (never Object.assign of preset objects: factory presets are frozen). FX: the
// v2 rule (a v1 preset rack migrates with the new Serum state as refs; locked racks kept, the incoming Serum state's rows
// follow renamed instances, locked parameters keep their values, §11.2)
function sxLoad(t, key) { // (t: a device view, stage 1e)
  const p = sxPreset(key);
  if (!p || !isSx(t)) return false;
  const s = core.applyPreset(t.vals.s, p, { midiFromPreset: prefs.midiFromPreset });
  const cur = fxOf(t), pfx = p.fx && typeof p.fx === 'object' ? p.fx : null;
  t.fx = core.applyPresetFx(cur, pfx || core.defaultFx2(), s);
  t.vals.s = s;
  t.preset = p.name; sxKeys.set(t.id, key); sxDirty.delete(t.id);
  seedPend.add(trOf(t).id);
  sendPatch(trOf(t));
  renderHeads(); persist(); sxRefresh();
  if (ctx) rateText();
  cvModReload(trOf(t)); // (stage 2a: the canvas cables stay — re-injected by that compile —; the preset cables re-derived)
  return true;
}
function sxSaveUser(up) { store.set('synth.user.serum', up); }
function sxSave(t, name, cat) { // (t: a device view; the FX phase memory is the primary's alone, N.fxph)
  name = String(name || '').trim().slice(0, 64);
  if (!name || !isSx(t)) return null;
  const N = dvOf(t) ? null : nodes.get(t.id);
  if (N && N.fxph) setPhases(t, N.fxph); // the rack's current LFO phases (phase memory)
  const up = sxUser(), i = up.findIndex(p => p.name === name);
  const entry = { name, cat: String(cat || 'User').trim().slice(0, 32) || 'User', v: { s: clone(t.vals.s) }, fx: clone(fxOf(t)) };
  if (i >= 0 && up[i].meta) entry.meta = up[i].meta; // overwriting keeps its rating / tags / comments
  if (i >= 0) up[i] = entry; else up.push(entry);
  sxSaveUser(up);
  t.preset = name; sxKeys.set(t.id, 'u:' + name); sxDirty.delete(t.id);
  renderHeads(); persist();
  if (N && !monitors.fx(t.id)) { // monitoring off: ask the rack for its phases and complete the stored preset
    N.phWait.push(v => {
      if (!v) return;
      setPhases(t, v);
      const l = sxUser(), e = l.find(p => p.name === name);
      if (e) { e.fx = clone(fxOf(t)); sxSaveUser(l); }
      persist();
    });
    N.node.port.postMessage({ t: 'fxph' });
  }
  return 'u:' + name;
}
// user presets: rename / move / ratings (the browser's menu, §13.11)
function sxUserEdit(key, fn) {
  const up = sxUser(), e = up.find(p => 'u:' + p.name === key);
  if (!e) return null;
  const r = fn(e, up);
  sxSaveUser(up);
  return r;
}
function sxRename(key, name) {
  name = String(name || '').trim().slice(0, 64);
  if (!name || sxPreset('u:' + name)) return null;
  const k = sxUserEdit(key, e => { e.name = name; return 'u:' + name; });
  if (!k) return null;
  for (const [tid, x] of sxKeys) if (x === key) { sxKeys.set(tid, k); const t = project.tracks.find(y => y.id === tid); if (t) t.preset = name; }
  renderHeads(); persist();
  return k;
}
// the embedded assets of a set of presets (user tables and samples their states and racks reference)
async function presetAssets(list) {
  const ids = new Set(), sm = new Set();
  for (const p of list) {
    const s = core.normalizeSerum(clone(p.v.s));
    for (const id of userTables(s)) ids.add(id);
    for (const id of userSmps(s, p.fx || null)) sm.add(id);
  }
  const o = {};
  if (ids.size) o.wts = await tables.embed([...ids]);
  if (sm.size) o.smps = await tables.embedSmps([...sm]);
  return o;
}
async function sxExport(key) {
  const p = sxPreset(key);
  if (!p) return;
  const o = Object.assign({ type: 'synth.serum.preset' }, clone(p), await presetAssets([p]));
  download(new Blob([JSON.stringify(o)], { type: 'application/json' }), slug(p.name) + '.serum.json');
}
async function sxExportPack(keys) {
  const list = (Array.isArray(keys) ? keys : []).map(sxPreset).filter(Boolean);
  if (!list.length) return;
  const name = list.length === 1 ? list[0].name : 'Preset Pack';
  const o = Object.assign({ type: 'synth.serum.pack', v: 1, name, presets: list.map(clone) }, await presetAssets(list));
  download(new Blob([JSON.stringify(o)], { type: 'application/json' }), slug(name) + '.serum-pack.json');
}
// a preset / pack file (JSON, or a ZIP holding pack.json) → its object
async function presetFileObject(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) { // PK: a ZIP
    const { smp } = await tables.smpMods();
    const inflate = typeof DecompressionStream === 'function' ? async b => new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()) : null;
    const e = smp.zipEntries(bytes, inflate).find(x => /(^|\/)pack\.json$/i.test(x.name));
    if (!e) throw new Error('no pack.json in that ZIP');
    return JSON.parse(new TextDecoder().decode(await e.data()));
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function sxImport(file) {
  const o = await presetFileObject(file);
  const list = Array.isArray(o) ? o : o && Array.isArray(o.presets) ? o.presets : [o];
  const up = sxUser();
  let key = null;
  for (const p of list) {
    if (!p || typeof p !== 'object' || !p.v || !p.v.s) continue;
    await restoreEmbedded(p);
    const base = String(p.name || 'Imported').trim().slice(0, 64) || 'Imported';
    let name = base, k = 2;
    while (up.some(x => x.name === name)) name = base.slice(0, 58) + ' ' + k++;
    const s = core.normalizeSerum(p.v.s), e = { name, cat: String(p.cat || 'User').slice(0, 32), v: { s }, fx: core.normalizeFx(p.fx || core.defaultFx2(), s) };
    if (p.meta && typeof p.meta === 'object') e.meta = clone(p.meta);
    up.push(e);
    key = 'u:' + name;
  }
  if (o && !Array.isArray(o)) await restoreEmbedded(o);
  if (!key) return null;
  sxSaveUser(up);
  return key;
}
// MIDI program change n → the n-th entry of the browser's current filtered, sorted list (§9.10, §11.8)
function programChange(trs, n) {
  const sx = trs.filter(isSx);
  if (!sx.length) return;
  uiMods().then(M => {
    const list = M.sx.browserList(sxPresetList(), store.get(M.sx.BROWSER_KEY, null)), p = list[n];
    if (!p) return;
    for (const t of sx) {
      if (!project.tracks.includes(t)) continue;
      const ask = sxPanel.ui && sxPanel.trackId === t.id ? !sxPanel.ui.confirmChange()
        : prefs.askPreset && sxDirty.has(t.id) && !confirm('Discard changes to “' + (t.preset || 'Init') + '”?');
      if (!ask) sxLoad(t, p.key);
    }
  }, () => {});
}

/* MIDI (SPEC-serum2 §12.6, B19): Web MIDI input, MPE zone routing and MIDI Learn live in midi.js (role I2); main.js is
   its host and keeps the live input routing shared with the on-screen and computer keyboards (held notes, recording,
   power, the wheels). Learned controllers write their destinations (FX destinations through fxSet); MIDI Learn stores the
   next controller 0–119 in s.midi. */
const midi = createMidi({
  targets: src => targets(src),
  noteOn: (n, v, src, ts) => noteOn(n, v, src, ts),
  noteOff: (n, src, ts, rv) => noteOff(n, src, ts, rv),
  ctl: (kind, v, src, ts, trs) => ctl(kind, v, src, ts, trs || targets(src)),
  post: (t, m) => postTo(t, m),
  // stage 1e: the Serum instruments of a track ([{id, s, fx, prim}], the primary first): each has its own learn map
  instsOf: t => (t.dev ? CMOD.instIds(t).filter(id => t.dev[id].model === 'serum').map(id => ({ id, s: t.dev[id].vals.s, fx: fxOfDev(t, id), prim: id === CMOD.primId(t) })) : []),
  heldNotes: src => heldNotes(src),
  programChange: (trs, n) => programChange(trs, n),
  modUI: v => { if (setModUI) setModUI(v, false); },
  bendUI: v => { if (setBendUI) setBendUI(v, false); },
  track: id => project.tracks.find(x => x.id === id),
  isSx: t => isSx(t),
  fxSet: (t, id, n, dev) => fxSet(t, id, n, dev),
  changed: (t, patch, refresh) => { sxDirty.add(t.id); if (patch) queuePatch(t); persist(); if (refresh) sxRefresh(); },
  notice: (txt, ms) => notice(txt, ms),
  button: () => $('#midi'),
});
const midiLearn = (id, dest, dev = null) => midi.learn(id, dev, dest); // (dev: the Serum instrument; null: the primary)
const cancelLearn = say => midi.cancelLearn(say);
const midiForget = (t, dest, dev = null) => midi.forget(t, dest, dev);
// preference "Mod wheel → WT Pos": while a WT editor is open the wheel scrubs its oscillator's WT POS (§9.9)
let wtEdit = null; // { id: track id, dev: its Serum (U7: the one whose editor is open, not always the primary), osc }
function wheelToWt(v) {
  if (!prefs.wheelWt || !wtEdit) return;
  const t = project.tracks.find(x => x.id === wtEdit.id), x = t && (!t.dev || CMOD.instOf(t, wtEdit.dev)) ? instView(t, wtEdit.dev) : null;
  if (!x || !isSx(x)) return;
  x.vals.s.p[['a', 'b', 'c'][wtEdit.osc] + '.wt'] = clamp(+v || 0, 0, 1);
  sxDirty.add(t.id);
  queuePatch(t); persist(); sxRefresh();
}

/* ------------------------------------------------ offline renders (bounce, resample, render-last; §9.6) */
// a track's offline render parts: {patch} (one instrument, legacyOk: as live) or graphParts' graph form with patch null (stage 1e)
function offParts(tr, sr) {
  const c = CG.compileTrack(tr);
  return legacyOk(tr, c) ? { patch: buildPatch(tr, sr, true) } : Object.assign({ patch: null }, graphParts(tr, sr, true, c));
}
// One OfflineAudioContext at rate sr with the §0.3 scripts and one engine node per item {tr, patch, os, song,
// transport, seq?, gain?, pan?}: the assets every patch needs are built for sr (IRs at that rate, factory content
// generated or awaited) and given to the first node (wavetables as `wts`, §9 entries as `smps`); every node carries its
// track id, so MIDI OUT between the rendered tracks works as live (§7.9). at = {s, fx} for patches of states that are
// not the project's tracks (render-last of a preset, …). Stage 1e: an item of a graph-shaped track carries graphParts'
// {graph, patches, chains, seqs, needs} (patch null): its node is built as the live one (offline = live, IMPL-1e §3.3).
async function renderOffline(sr, frames, items, at) {
  if (!window.OfflineAudioContext) throw new Error('offline rendering is not available in this browser');
  const oc = new OfflineAudioContext({ numberOfChannels: 2, length: Math.max(128, Math.ceil(frames)), sampleRate: sr });
  await addModules(oc);
  const ids = new Set();
  for (const x of items) {
    for (const id of (x.patch && x.patch.needs) || x.needs || []) ids.add(id);
    if (x.graph && x.tr) learnStates(x.tr);
  }
  const ents = ids.size ? await tables.entries([...ids], sr, at) : [];
  const wts = ents.filter(e => idKind(e.id) === 'wt'), smps = ents.filter(e => idKind(e.id) !== 'wt');
  const bus = oc.createGain(); bus.connect(oc.destination);
  items.forEach((x, n) => {
    const po = { os: x.os, hostOS: x.hostOS || x.os, offline: true, patch: x.patch, wts: n === 0 && wts.length ? wts : null,
      smps: n === 0 && smps.length ? smps : null, song: x.song, transport: x.transport, seq: x.seq || null, trackId: x.tr ? x.tr.id : '' };
    if (x.graph) Object.assign(po, { graph: x.graph, patches: x.patches, chains: x.chains, seqs: x.seqs });
    const node = new AudioWorkletNode(oc, 'synth-engine', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      processorOptions: po,
    });
    const g = oc.createGain(), pn = oc.createStereoPanner();
    g.gain.value = x.gain === undefined ? 1 : x.gain; pn.pan.value = x.pan || 0;
    node.connect(g); g.connect(pn); pn.connect(bus);
  });
  return oc.startRendering();
}
// the frame after which the output stays below thr for hold frames (searched from `from`), else the end
function tailEnd(chs, from, thr, hold, max) {
  const L = chs[0], R = chs[1], end = Math.min(L.length, max);
  let q = 0;
  for (let i = Math.max(0, from); i < end; i++) {
    if (Math.abs(L[i]) < thr && Math.abs(R[i]) < thr) { if (++q >= hold) return i + 1; } else q = 0;
  }
  return end;
}
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = n => NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1); // the app's naming: C4 = MIDI 60

// Resample to (§9.8, SPEC-serum2 §12.6 B25; target 'A' | 'B' | 'C' | 'AB' | 'sel'): note 60, velocity 127, one bar at
// the song tempo through the patch and its FX rack, offline at 44.1 kHz (the Phase-1 recipe); the release tail ends once
// the output stays below −90 dBFS for 50 ms (at most 2 s). The render is imported into the chosen oscillator (AB: L → A,
// R → B) as its type takes it: a Wavetable oscillator gets a wavetable (the Phase-1 recipe); a Sample, Granular or
// Spectral oscillator gets a user sample (§9.1 `smp:` origin "resample"; root 60, folder Renders) and keeps its type and
// sample options (only the trim of the previous sample is dropped); a Multisample oscillator becomes a Sample oscillator.
async function resampleTo(t, target) { // (t: a device view — a Serum besides the primary renders alone, buildInstPatch)
  if (!isSx(t)) return;
  const W = await wtMod(), sr = 44100, s = t.vals.s, bt = S.barTicks(project), fpt = sr * 60 / (project.bpm * S.PPQ);
  const gate = Math.round(bt * fpt), patch = dvOf(t) ? buildInstPatch(trOf(t), dvOf(t), sr, true) : buildPatch(t, sr, true);
  const buf = await renderOffline(sr, gate + 2 * sr, [{ tr: null, patch, os: sxOSFor(t, sr, true), hostOS: osCap(sr),
    song: { notes: [0, bt, 60, 127], cc: [] }, transport: { play: true, frame: 0, tick: 0, fpt, loop: false } }], { s, fx: fxOf(t) });
  const chs = [buf.getChannelData(0), buf.getChannelData(1)];
  const end = tailEnd(chs, gate, Math.pow(10, -90 / 20), Math.round(0.05 * sr), chs[0].length);
  const L = chs[0].slice(0, end), R = chs[1].slice(0, end);
  const size = String(Math.round(sr / ((s.global.a4 || 440) * Math.pow(2, -9 / 12))));
  const make = x => { const tb = W.tableFromWav({ sr, ch: [x] }, { mode: 'manual', size }); if (tb.frames.length > 256) tb.frames = tb.frames.filter((f, i) => i % Math.ceil(tb.frames.length / 256) === 0).slice(0, 256); return tb; };
  const named = rows => (Array.isArray(rows) ? rows : []).filter(r => r && /^Resample \d+/.test(r.name)).length;
  const n = 1 + named(tables.rows) + named(tables.smpRows);
  const isSmp = o => ['sample', 'gran', 'spec', 'multi'].includes(s.osc[o] && s.osc[o].type);
  // one oscillator's import: [o, kind, id] — a wavetable (wt) or a user sample (smp) of the channel(s) given
  const save = async (o, chans, name) => {
    if (isSmp(o)) {
      const id = await tables.saveRecord({ kind: 'smp', name, rate: sr, ch: chans.length, len: chans[0].length, L: chans[0], R: chans[1] || null, root: 60, loop: null },
        { name, folder: 'Renders', odf: true });
      return [o, 'smp', id];
    }
    let m = chans[0];
    if (chans.length > 1) { m = new Float32Array(chans[0].length); for (let i = 0; i < m.length; i++) m[i] = 0.5 * (chans[0][i] + chans[1][i]); }
    return [o, 'wt', await wtHost.saveNew(make(m), name)];
  };
  const toOsc = (st, [o, kind, id]) => {
    const O = st.osc[o];
    if (kind === 'smp') {
      if (O.type === 'multi') O.type = 'sample';
      O.smp = id;
      if (O.smpo && O.smpo.ops && typeof O.smpo.ops === 'object') O.smpo.ops.trim = null; // frames of the previous sample
    } else { if (O.type && O.type !== 'wt') O.type = 'wt'; O.wt = id; }
  };
  let done;
  if (target === 'AB') done = [await save(0, [L], `Resample ${n} L`), await save(1, [R], `Resample ${n} R`)];
  else {
    const o = target === 'B' ? 1 : target === 'C' ? 2 : target === 'A' ? 0 : s.ui && s.ui.osc >= 0 && s.ui.osc < 3 ? s.ui.osc | 0 : 0;
    done = [await save(o, [L, R], `Resample ${n}`)];
  }
  sxEdit(t, st => { for (const d of done) toOsc(st, d); }, { label: 'Resample' });
  sxRefresh();
}

// Render last note (§13.2.5, deviation 21): the track's last input note group replayed offline (live context rate) as
// song notes from tick 0 through the current patch, FX rack and assets, the sequencer included — the same path as a
// bounce of those notes. Ends once the output stays below −80 dBFS for 50 ms after the last note-off (≤ 10 s later).
// The 24-bit WAV is downloaded and stored as a user sample in the Renders folder; the result is handed back for the
// header's drag-export. shift: the current preset as JSON (+ its user assets) instead. Stage 1e: o.dev, a Serum instrument
// of the track (default the primary), rendered alone through its own FX (buildInstPatch); a canonical track's primary
// renders as before (buildPatch).
async function renderLast(t, o) {
  const dev = (o && o.dev) || CMOD.primId(t), d = t.dev ? t.dev[dev] : null, legacy = dev === CMOD.primId(t) && legacyOk(t);
  if (legacy ? !isSx(t) : !d || d.model !== 'serum') throw new Error('Rendering needs a Serum track');
  const s = legacy ? t.vals.s : d.vals.s, fx = legacy ? fxOf(t) : fxOfDev(t, dev), pn = legacy ? t.preset : d.preset;
  const name = (pn || 'Init').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Init';
  if (o && o.shift) {
    const pre = Object.assign({ type: 'synth.serum.preset', name, v: { s: clone(s) }, fx: clone(fx) }, await presetAssets([{ v: { s }, fx }]));
    download(new Blob([JSON.stringify(pre)], { type: 'application/json' }), slug(name) + '.serum.json');
    return null;
  }
  const g = lastIn.get(t.id);
  if (!g || !g.notes.length) throw new Error('Play a note first');
  const now = (performance.now() - g.t0) / 1000;
  const group = g.notes.map(x => ({ n: x.n, vel: x.vel, on: x.on, off: x.off >= 0 ? x.off : Math.max(x.on, now) }));
  const sr = ctx ? ctx.sampleRate : settings.sr || devRate || 48000, bpm = project.bpm;
  const song = groupSong(group, bpm), last = Math.max(...group.map(x => x.off)), fpt = sr * 60 / (bpm * S.PPQ);
  const patch = legacy ? buildPatch(t, sr, true) : buildInstPatch(t, dev, sr, true);
  const buf = await renderOffline(sr, (last + 10.05) * sr, [{ tr: t, patch, os: sxOSFor(legacy ? t : d, sr, true), hostOS: osCap(sr), song,
    transport: { play: true, frame: 0, tick: 0, fpt, loop: false } }], { s, fx });
  const chs = [buf.getChannelData(0), buf.getChannelData(1)];
  const end = tailEnd(chs, Math.round(last * sr), Math.pow(10, -80 / 20), Math.round(0.05 * sr), Math.round((last + 10) * sr));
  const L = chs[0].slice(0, end), R = chs[1].slice(0, end), low = Math.min(...group.map(x => x.n));
  const file = `${name} ${noteName(low)}.wav`, blob = new Blob([S.encodeWAV([L, R], sr, 24)], { type: 'audio/wav' });
  download(blob, file);
  tables.saveRecord({ kind: 'smp', name: file.replace(/\.wav$/, ''), rate: sr, ch: 2, len: L.length, L, R, root: low, loop: null },
    { name: file.replace(/\.wav$/, ''), folder: 'Renders', odf: true }).catch(err => console.warn('render not stored', err));
  return { name: file, blob };
}

// Preset preview (§12.6, B25): one dedicated node at a time in the live context (no assets in processorOptions: the
// preset's needs go through the asset manager as track 'preview'; no track id, so its MIDI OUT goes nowhere, §7.9),
// playing the preset's preview clip (s.clip.preview) or a fallback clip (seq-core FALLBACK_CLIPS: chord, bass line, lead
// phrase — by category) for at most 4 s. A finished preview's node is kept for PV_KEEP and plays the next preview (a
// browser auto-previews preset after preset: a processor built per preview costs the audio thread ≈ 1–3 ms each time);
// then {t: 'bye'} ends its processor (it fades out and stops processing, §7.9) and it is disconnected. Its patches go
// through the track nodes' part-keyed delivery (postPatch, §4.1): a macro drag posts what changed, once per frame.
const PV_KEEP = 8000;
const pv = { node: null, gain: null, N: null, t: 0, keep: 0, raf: 0, key: null, s: null, fx: null };
function previewEnd() { // the kept node goes: bye (its processor fades out and ends), then disconnected
  clearTimeout(pv.keep); pv.keep = 0;
  const node = pv.node, g = pv.gain;
  pv.node = null; pv.gain = null; pv.N = null;
  if (!node) return;
  try { node.port.postMessage({ t: 'bye' }); } catch { /* gone */ }
  setTimeout(() => { try { node.disconnect(); if (g) g.disconnect(); } catch { /* gone */ } }, 80);
}
function previewStop() {
  clearTimeout(pv.t); pv.t = 0;
  if (pv.raf) { cancelAnimationFrame(pv.raf); pv.raf = 0; }
  pv.key = null; pv.s = null; pv.fx = null;
  if (pv.node) { // silent at once (panic: 5 ms output fade; the gain also closes over the output stage's DC-blocker
    // decay), kept for the next preview
    try { pv.node.port.postMessage({ t: 'panic' }); pv.node.port.postMessage({ t: 'transport', play: false }); } catch { /* gone */ }
    if (pv.gain && ctx) pv.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
    clearTimeout(pv.keep); pv.keep = setTimeout(previewEnd, PV_KEEP);
  }
  tables.release('preview');
}
function previewNotes(p, s, clip) {
  if (Array.isArray(clip) && clip.length) return clip.map(x => (Array.isArray(x) ? { t: x[0] * S.PPQ / 4, d: x[1] * S.PPQ / 4, n: x[2], v: x[3] } : x));
  const C = s.clip && Array.isArray(s.clip.clips) ? s.clip.clips : [], k = s.clip ? s.clip.preview : -1;
  const own = k >= 0 && C[k] && Array.isArray(C[k].notes) && C[k].notes.length ? C[k] : null;
  const cat = String(p.cat || '') + ' ' + String(p.name || ''), fb = core.FALLBACK_CLIPS[/bass/i.test(cat) ? 1 : /lead|pluck|arp|seq|key/i.test(cat) ? 2 : 0];
  return core.clipTrackNotes(own || fb, 0);
}
function previewPatch() {
  const patch = patchFor(SXM, { s: pv.s }, pv.fx, { sr: ctx.sampleRate, bpm: project.bpm, drift: settings.drift / 10, hiss: 1, qr: qrOf(qrStep),
    prefs: Object.assign({}, prefs, { ultra: 0 }) });
  patch.osCap = sxCap;
  return capQ4(patch);
}
function preview(key, clip) {
  previewStop();
  if (key === null || key === undefined) return;
  const p = sxPreset(key);
  if (!p) return;
  const go = () => {
    if (!ctx) return;
    pv.key = key; pv.s = core.normalizeSerum(clone(p.v.s)); pv.fx = core.normalizeFx(clone(p.fx || core.defaultFx2()), pv.s);
    const sr = ctx.sampleRate, patch = previewPatch(), fpt = sr * 60 / (project.bpm * S.PPQ);
    const notes = previewNotes(p, pv.s, clip).filter(x => x.t < 4 * sr / fpt), flat = [];
    for (const x of notes.sort((a, b) => a.t - b.t)) flat.push(x.t, x.d, x.n, clamp(x.v, 1, 127));
    const F = Math.round((ctx.currentTime + 0.05 + (ctx.baseLatency || 0)) * sr);
    const song = { notes: flat, cc: [] }, transport = { play: true, frame: F, tick: 0, fpt, loop: false }, needs = patch.needs;
    if (pv.node && pv.node.context !== ctx) previewEnd(); // kept from another (closed) context
    let node = pv.node;
    if (node) { // the kept node: the new patch (changed parts only), then the clip from F (≥ 50 ms ahead: the gain is open by then)
      clearTimeout(pv.keep); pv.keep = 0;
      if (pv.gain) { pv.gain.gain.cancelScheduledValues(ctx.currentTime); pv.gain.gain.setTargetAtTime(1, ctx.currentTime, 0.005); }
      postPatch(pv.N, patch);
      node.port.postMessage(Object.assign({ t: 'song' }, song));
      node.port.postMessage(Object.assign({ t: 'transport' }, transport));
    } else {
      node = new AudioWorkletNode(ctx, 'synth-engine', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
        processorOptions: { os: Math.min(sxQuality({ vals: { s: pv.s } }), osCap(sr), sxCap), hostOS: osFor(sr), patch, song, transport },
      });
      const g = ctx.createGain();
      node.connect(g); g.connect(master);
      pv.node = node; pv.gain = g; pv.N = partCache({ node }, patch);
    }
    if (needs && needs.length) tables.ensure(needs, { trackId: 'preview', node, s: pv.s, fx: pv.fx, convMax: patch.fxr && patch.fxr.convMax });
    pv.t = setTimeout(() => { if (pv.key === key && pv.node === node) previewStop(); }, 4000);
  };
  if (ctx) go(); else powerOn().then(go, () => {});
}
// the preset browser's macro strip while a preview plays: the preview node plays with these macro values (§13.11)
function previewMacros(v) {
  if (!pv.node || !pv.s || !Array.isArray(v)) return;
  for (let k = 0; k < v.length && k < pv.s.macros.length; k++) if (Number.isFinite(+v[k])) pv.s.macros[k].v = clamp(+v[k], 0, 1);
  if (!pv.raf) pv.raf = requestAnimationFrame(() => { pv.raf = 0; if (pv.node && pv.s) postPatch(pv.N, previewPatch()); });
}

// CLIP slot "Copy to Track ▸" (§7.5.6): the clip's notes (ticks relative to the paste point) at the song playhead, one
// project-history step
function clipToTrack(trackId, notes) {
  const tr = project.tracks.find(x => x.id === trackId);
  if (!tr || !Array.isArray(notes) || !notes.length) return;
  const at = Math.max(0, Math.round(curTick()));
  edit('Copy clip to track', () => {
    for (const x of notes) {
      if (!x || !(x.n >= 0 && x.n <= 127)) continue;
      tr.notes.push({ id: S.newId(), t: Math.max(0, Math.round(at + (+x.t || 0))), d: Math.max(1, Math.round(+x.d || 1)), n: x.n | 0, v: clamp(Math.round(+x.v || 100), 1, 127) });
    }
  }, [tr]);
  notice(`Copied ${notes.length} note${notes.length === 1 ? '' : 's'} to “${tr.name}”`, 3000);
}
// TUN FILE ▸ Load .scl/.kbm/.tun… (§13.10): a file picker; the texts through tuning.js (tuningState keeps a loaded
// .scl when only a .kbm comes, §11.4) → {name, kind, scl, kbm, tab} | {error} | null (cancelled)
function tuningFile(cur) {
  return new Promise(res => {
    const inp = h('input');
    inp.type = 'file'; inp.multiple = true; inp.accept = '.scl,.kbm,.tun,text/plain';
    inp.onchange = async () => {
      const fs = [...(inp.files || [])];
      if (!fs.length) { res(null); return; }
      const files = {};
      for (const f of fs.slice(0, 3)) {
        if (f.size > 16384) { res({ error: f.name + ' is too large' }); return; }
        const ext = (/\.(scl|kbm|tun)$/i.exec(f.name) || [])[1];
        if (ext) files[ext.toLowerCase()] = await f.text();
        if (ext && !files.name) files.name = f.name.replace(/\.(scl|kbm|tun)$/i, '');
      }
      res(core.tuningState(files, cur || null));
    };
    inp.click();
  });
}

// Stage 2a (IMPL-2a §2.4): the canvas mod rows on knob destId of Serum dev that compile (placed), as matrix rows ({id, src:
// the Serum source, amt, bi, byp, out}) for serum-ui haloArcs and the knob menu
function sxExtra(t, dev, destId) {
  const rows = t && t.dev ? CG.modRowsFor(t, dev) : [], key = dev + ':' + destId, mine = rows.filter(r => r.dst === key);
  if (!mine.length) return [];
  const on = new Set(CG.injectMods(t.dev[dev], rows).placed.map(x => x.id));
  return mine.filter(r => on.has(r.id)).map(r => ({ id: r.id, src: CMOD.MOD_SRC[r.src], amt: r.amt, bi: r.bi, byp: r.byp, out: r.out }));
}
// a Serum module's "mods n/64" (stage 2a, IMPL-2a §2.4; cvBadge): null without canvas rows to it (the badge keeps the
// safeguard's text); else cv-graph modBudget { preset, canvas, left, max } and text 'mods <preset + canvas>/64'
function modCount(t, dev = t && CMOD.primId(t)) {
  const d = t && t.dev && t.dev[dev];
  if (!d || d.model !== 'serum' || !CG.modRowsFor(t, dev).length) return null;
  const b = CG.modBudget(t, dev);
  return Object.assign(b, { text: 'mods ' + Math.min(b.max, b.preset + b.canvas) + '/' + b.max });
}
// the Serum panel's host (§8.8, RULINGS host additions, SPEC-serum2 §11.15); bound to a track id, reading the live
// project each call. Stage 1e: bound to one Serum instrument of the track (dv, default the primary): its state, own FX,
// presets, resample and tuning through its device view
function sxHost(t0, dv) {
  const id = t0.id, T = () => project.tracks.find(x => x.id === id) || t0, dev = dv || CMOD.primId(t0) || 'i1'; // (stage 1e: its device)
  const V = () => instView(T(), dev);
  return {
    state: () => V().vals.s,
    edit: (fn, o) => { sxEdit(V(), fn, o); if (!(o && o.ui)) peerRefresh(id, 2, dev); else cvRemeasure(id, dev); cvChipSync(); }, // (the FX module follows: peerRefresh; (2a) a page switch: the knob ends re-measured)
    fx: () => fxOf(V()),
    editFx: (fn, o) => { fxEdit(V(), fn, o); peerRefresh(id, 2, dev); },
    v2Fx: true, // the FX state may become a v2 state in place (fx-ui / sx-ui-mix conversion, §2.6.3)
    bpm: () => project.bpm,
    sampleRate: () => (ctx ? ctx.sampleRate : settings.sr || devRate || 48000),
    wt: wtHost,
    smp: smpHost,
    audition: {
      on: (n, v) => { if (!ctx) powerOn().catch(() => {}); postTo(T(), { t: 'on', n, v }, dev, true); inputNote(T(), 1, n, v, performance.now(), true); },
      off: n => { postTo(T(), { t: 'off', n }, dev, true); inputNote(T(), 0, n, 0, performance.now(), true); },
    },
    monitor: on => sxMonitor(T(), on, dev),
    dev, // (its [data-dest] resolve inside [data-dev], SPEC §8.6)
    extraRows: destId => sxExtra(T(), dev, destId), // (stage 2a: the canvas cables on a knob — its halo, the knob menu)
    fxTap: inst => postTo({ id }, { t: 'fxtap', id: typeof inst === 'string' ? inst : '' }, dev),   // (the FX page's Delay overlay)
    presets: {
      list: sxPresetList,
      get: key => sxPreset(key),
      load: key => { sxLoad(V(), key); },
      save: ({ name, cat }) => sxSave(V(), name, cat),
      del: key => {
        if (typeof key !== 'string' || !key.startsWith('u:')) return;
        sxSaveUser(sxUser().filter(p => 'u:' + p.name !== key));
        for (const [tid, k] of sxKeys) if (k === key) sxKeys.delete(tid);
      },
      rename: (key, name) => sxRename(key, name),
      move: (key, cat) => { sxUserEdit(key, e => { e.cat = String(cat || 'User').trim().slice(0, 32) || 'User'; }); },
      setMeta: (key, m) => { sxUserEdit(key, e => { e.meta = Object.assign({}, e.meta && typeof e.meta === 'object' ? e.meta : {}, m || {}); }); },
      exportFile: key => { sxExport(key).catch(err => notice('Export failed: ' + err.message, 4000)); },
      exportPack: keys => { sxExportPack(keys).catch(err => notice('Export failed: ' + err.message, 4000)); },
      importFile: file => sxImport(file),
      current: () => sxCurrent(V()),
    },
    midiLearn: dest => midiLearn(id, dest, dev),
    midiForget: dest => midiForget(T(), dest, dev),
    resample: target => resampleTo(V(), target),
    renderLast: o => renderLast(T(), Object.assign({ dev }, o || {})),
    preview: (key, clip) => preview(key, clip),
    previewMacros: v => previewMacros(v),
    tracks: () => project.tracks.filter(x => x.id !== id).map(x => ({ id: x.id, name: x.name, model: x.model })),
    seqCmd: (cmd, arg) => postTo(T(), { t: 'seqcmd', cmd, arg }, dev),
    onInput: fn => { // (per Serum of the track, U6)
      let S = inputSubs.get(id);
      if (typeof fn === 'function') { if (!S) inputSubs.set(id, S = new Map()); S.set(dev, fn); } else if (S) { S.delete(dev); if (!S.size) inputSubs.delete(id); }
    },
    clipToTrack: (trackId, notes) => clipToTrack(trackId, notes),
    download: (name, blob) => download(blob, name),
    tuningFile: () => tuningFile(V().vals.s.global.tun),
    metronome: on => { project.metronome.on = !!on; transportUI(); persist(); },
    latency: () => outLatency(), // the playhead's output delay (audioclock.js + the Latency setting): clip records line up with it
    qualityChosen: () => liftCaps(),
    storage: hostStore,
    notify: txt => notice(txt, 3500),
    editorOpen: o => { wtEdit = o === 0 || o === 1 || o === 2 ? { id, dev, osc: o } : wtEdit && (wtEdit.id !== id || wtEdit.dev !== dev) ? wtEdit : null; }, // (another one's open editor stays)
    prefsChanged,
  };
}
// the FX rack host: any track's FX (Serum's parameter locks hold, §9.6); a Serum's own FX show the three racks. Stage 1e:
// the rack of rec.dev — a Serum instrument (its own FX), a shared panel, or null (the primary's FX: fxOf)
function fxHost(t0, rec = fxTab) {
  const id = t0.id, T = () => project.tracks.find(x => x.id === id) || t0;
  const sx = () => { const t = T(), d = rec.dev && t.dev ? t.dev[rec.dev] : null; return d ? (d.kind === 'synth' && d.model === 'serum' ? rec.dev : null) : isSx(t) ? CMOD.primId(t) : null; };
  const own = () => { const k = sx(); return k ? instView(T(), k) : null; }; // (the Serum whose own FX this rack is)
  return {
    fx: () => fxOfDev(T(), rec.dev),
    editFx: (fn, o) => { fxEditDev(T(), rec.dev, fn, o); peerRefresh(id, 1, sx()); }, // (the Serum panel follows: peerRefresh)
    v2Fx: true,
    racks: () => (sx() ? 3 : 1),
    irs: smpHost,
    state: () => { const v = own(); return v ? v.vals.s : null; },
    edit: (fn, o) => { const v = own(); if (v) { sxEdit(v, fn, o); peerRefresh(id, 1, sx()); } },
    bpm: () => project.bpm,
    gr: () => (rec.trackId === id ? rec.gr : null),
    // the rack's monitor tap (§13.5 Delay spectrum overlay): instance id ('' off) → the node; the latest 1024 frames
    tap: () => (rec.trackId === id ? rec.ftap || null : null),
    setTap: inst => postTo({ id }, { t: 'fxtap', id: typeof inst === 'string' ? inst : '' }, rec.dev), // (a panel: c; a Serum's own: i)
    locked: dest => { const v = own(); return !!v && !!v.vals.s && v.vals.s.locks.p.includes(dest); },
    storage: hostStore,
    notify: txt => notice(txt, 3500),
  };
}

// The mounted Serum panels: rebuilt when the track or its state container changes (another project, a model change),
// refreshed otherwise (undo keeps the container, §11.8). sxPanel: the selected track's primary's (it lives in #inst);
// stage 1e: the track's other Serum instruments' in serumPanels ('trackId/dev'), each in its module body
const sxRecMk = () => ({ ui: null, trackId: null, dev: null, vals: null, box: null, el: null, gen: 0, drop() { sxDrop(this); } });
const sxPanel = sxRecMk();
const serumPanels = new Map();
const sxRecs = () => [sxPanel, ...serumPanels.values()];
function sxDrop(r) {
  r.gen++;
  const u = r.ui, tid = r.trackId;
  r.ui = null; r.trackId = null; r.vals = null;
  if (u && (!wtEdit || (wtEdit.id === tid && wtEdit.dev === r.dev))) wtEdit = null; // (its own editor only, U7)
  cancelLearn(!!u);
  if (u) { try { u.destroy(); } catch (err) { console.warn(err); } }
  monitors.sync();
}
function sxRec(t, dev) {
  if (dev === CMOD.primId(t)) return sxPanel;
  const k = t.id + '/' + dev;
  let r = serumPanels.get(k);
  if (!r) serumPanels.set(k, r = sxRecMk());
  return r;
}
function sxRecOf(id, dev) { const t = project.tracks.find(x => x.id === id); return !t ? null : dev === CMOD.primId(t) ? sxPanel : serumPanels.get(id + '/' + dev) || null; }
function sxDropEl(el) { for (const r of sxRecs()) if (r.el === el && (r.ui || r.box)) { sxDrop(r); r.box = null; } } // (a classic panel goes where it was)
function renderCustom(el, t = trk(), dev = curOf(t)) {
  const v = instView(t, dev), m = modelById(v.model), rec = sxRec(t, dev);
  if (t === trk() && dev === curOf(t)) { aboutUI(m); drawAlgo(); }
  if (rec.ui && rec.trackId === t.id && rec.vals === v.vals) { rec.ui.refresh(); return; }
  sxDrop(rec);
  el.className = `inst custom m-${m.id}`;
  el.innerHTML = '';
  const box = h('div', 'sxhost');
  box.append(h('p', 'boot', 'Loading the ' + m.name + ' panel…'));
  el.append(box);
  rec.box = box; rec.el = el;
  const gen = rec.gen;
  if (!tables.WT) tables.list(); // user tables for the menus
  tables.smpMods().catch(() => {}); // sample catalogues and the stored user samples for the menus
  cvBuild(uiMods()).then(M => {
    if (gen !== rec.gen) return;
    box.innerHTML = '';
    try {
      rec.trackId = t.id; rec.dev = dev; rec.vals = v.vals;
      rec.ui = new M.sx.SerumUI(box, sxHost(t, dev));
    } catch (err) {
      console.error(err);
      rec.ui = null; rec.trackId = null;
      box.innerHTML = '';
      box.append(h('p', 'boot', 'The panel could not be shown (' + err.message + '). The sound still plays.'));
    }
  }, err => { if (gen === rec.gen) { box.innerHTML = ''; box.append(h('p', 'boot', 'The panel could not be loaded (' + err.message + '). Reload the page to try again.')); } });
}
// the FX rack (every track): the rack UI bound to track.fx — the canvas's FX module keeps it mounted (sx: built for a
// Serum's three racks)
// One FXRackUI per FX panel (SPEC-canvas §10 1c): a panel record holds its rack UI, its track and device, the meters its
// monitor subscription delivers, and its host reads them from it. fxTab: the selected track's primary's FX (in #fxrack);
// stage 1e: a record per other panel and per other Serum's own FX (fxPanels, 'trackId/key'), each in its module body
const fxPanelRec = () => ({ ui: null, trackId: null, dev: null, key: null, fx: null, sx: false, gr: null, ftap: null, gen: 0, mon: null, el: null });
const fxTab = fxPanelRec();
const fxPanels = new Map();
const fxRecs = () => [fxTab, ...fxPanels.values()];
function fxRec(t, key) {
  if (key === cvHomeKeys(t).fx) return fxTab;
  const k = t.id + '/' + key;
  let r = fxPanels.get(k);
  if (!r) fxPanels.set(k, r = fxPanelRec());
  return r;
}
function fxRecOf(id, key) { const t = project.tracks.find(x => x.id === id); return !t ? null : key === cvHomeKeys(t).fx ? fxTab : fxPanels.get(id + '/' + key) || null; }
// (today's openTab drops it when the FX tab hides; the canvas FX module keeps it: openTab no longer drops it, IMPL-1b §4.8)
function dropFxTab() { if (!cvView) fxDrop(); }
function fxDrop(rec = fxTab) {
  rec.gen++;
  const u = rec.ui;
  rec.ui = null; rec.trackId = null; rec.dev = null; rec.fx = null; rec.gr = null; rec.ftap = null;
  if (u) { try { u.destroy(); } catch (err) { console.warn(err); } }
  if (rec.mon) { const off = rec.mon; rec.mon = null; off(); }
  monitors.sync();
}
// every FX module of the selected track (its panels, its Serums' own FX)
function renderFxTabs(t = trk()) { for (const d of cvModule.devicesOf(t)) if (d.kind === 'fx') renderFxTab(t, d.key); }
// the FX module `key` of track t ('fxN' a shared panel, 'iN/fx' a Serum's own FX; default the primary's FX)
function renderFxTab(t = trk(), key = cvHomeKeys(t).fx) {
  const home = key === cvHomeKeys(t).fx, box = cvOn() ? (key ? cvBodyEl(t, key) : null) : home ? $('#fxrack') : null;
  if (!box) return;
  const own = key && /\/fx$/.test(key) ? key.slice(0, -3) : null, dev = own || key || null, rec = fxRec(t, key);
  const ft = home ? $('#fxtitle') : null; // (today's FX tab header; on the canvas the FX module's title says it)
  if (ft) ft.textContent = `FX rack · track “${t.name}” (${modelById(t.model).name})`;
  if (key) cvBuilt.set(t.id + '/' + key, box);
  const fx = fxOfDev(t, dev), sx = own ? true : !dev && isSx(t);
  if (rec.ui && rec.trackId === t.id && rec.fx === fx && rec.sx === sx) { rec.ui.refresh(); return; }
  fxDrop(rec);
  box.innerHTML = '';
  box.append(h('p', 'boot', 'Loading the FX rack…'));
  rec.el = box;
  const gen = rec.gen;
  cvBuild(uiMods()).then(M => {
    if (gen !== rec.gen) return;
    box.innerHTML = '';
    try {
      rec.trackId = t.id; rec.dev = dev; rec.key = key; rec.fx = fx; rec.sx = sx;
      rec.ui = new M.fxui.FXRackUI(box, fxHost(t, rec), { embedded: false, dsp: globalThis.FXDSP || null, racks: sx ? 3 : 1, v2Fx: true });
      if (rec.ui && rec.ui.el && dev) rec.ui.el.setAttribute('data-dev', dev); // (its fx.<inst>.<pid> dests: that device's)
      rec.mon = monitors.sub(t.id, dev, { role: 'fx', live: () => rec.trackId === t.id && !!rec.ui && cvLive(key), deliver: d => { rec.gr = d.gr || null; rec.ftap = d.ftap || null; } });
    } catch (err) {
      console.error(err);
      rec.ui = null; rec.trackId = null;
      box.innerHTML = '';
      box.append(h('p', 'boot', 'The FX rack could not be shown (' + err.message + ').'));
    }
    monitors.sync();
  }, err => { if (gen === rec.gen) { box.innerHTML = ''; box.append(h('p', 'boot', 'The FX rack could not be loaded (' + err.message + ').')); } });
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
// Stage 1e: per device (a track may hold several 303s). seqRun is keyed trackId + '/' + dev; a bare track id means its
// primary (and delete(trackId) stops every one of the track), so stage-1d callers keep working. seqOf(t, dev),
// seqPayload(t, dev?, extra?), seqSend(t, dev?, extra?), seqToggle(t, on, quiet, dev?): dev omitted = the primary (a
// legacy node's messages never name it: postTo). seqStepTo(t, dev, s): the step a node reports → that 303's panel.
class SeqRun extends Set {
  key(k) { if (k.includes('/')) return k; const t = project.tracks.find(x => x.id === k); return k + '/' + ((t && CMOD.primId(t)) || 'i1'); }
  has(k) { return super.has(this.key(k)); }
  add(k) { return super.add(this.key(k)); }
  delete(k) { if (k.includes('/')) return super.delete(k); let n = false; for (const x of [...this]) if (x.startsWith(k + '/')) n = super.delete(x) || n; return n; }
}
const seqRun = new SeqRun();
function seqOf(tr, dev) {
  const d = (tr.dev && CMOD.instOf(tr, dev)) || tr;
  if (!d.seq || !Array.isArray(d.seq.pat) || d.seq.pat.length !== 16) d.seq = JSON.parse(JSON.stringify(SEQ_DEF));
  return d.seq;
}
const devArgs = (a, b) => (typeof a === 'string' ? [a, b] : a == null ? [null, b] : [null, a]); // (dev?, extra?)
function seqPayload(tr, a, b) {
  const [dev, extra] = devArgs(a, b), q = seqOf(tr, dev);
  return Object.assign({ pat: q.pat, len: 16, bpm: q.bpm, swing: q.swing / 100 * 0.5, root: 48, sync: !!q.sync, run: seqRun.has(dev ? tr.id + '/' + dev : tr.id) && !q.sync }, extra || {});
}
function seqSend(tr, a, b) { let [dev, extra] = devArgs(a, b); if (tr.track) { dev = tr.devId; tr = tr.track; } postTo(tr, { t: 'seq', s: seqPayload(tr, dev, extra) }, dev); persist(); }
function seqToggle(tr, on, quiet, dev = null) { // (tr: a track with dev, or a device view: the 303 page's)
  if (tr.track) { dev = tr.devId; tr = tr.track; }
  const k = dev ? tr.id + '/' + dev : tr.id;
  if (!seqRun.has(k) && !on) return;
  if (on) seqRun.add(k); else seqRun.delete(seqRun.key(k));
  const P = !quiet && classicPanels.get(seqRun.key(k));
  if (P && !P.dead) P.seqRunUI(on); // (its RUN button, the step lights, a hardware panel's RUN LED)
  if (on && !ctx) powerOn().then(() => { if (seqRun.has(k)) seqSend(tr, dev); }).catch(() => {}); // Stop pressed while starting wins
  else seqSend(tr, dev, { run: on });
}
function seqStep(tr, i) { const P = classicOf(tr); if (P) P.seqStep(i); }
// a step a node reports (d.i: the 303 on a graphed node; legacy: the primary) → that 303's panel (stage 1e)
function seqStepTo(t, dev, s) { const P = classicPanels.get(t.id + '/' + dev); if (P && !P.dead) P.seqStep(s); }
// "→ Piano roll": the pattern written into the track as notes (1 bar at the playhead), one undo step
function seqToRoll(tr0, q) {
  const tr = trOf(tr0);
  edit('Pattern to notes', () => {
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
}

/* ------------------------------------------------------ track headers */
function renderHeads() {
  const el = $('#heads');
  el.innerHTML = ''; voiceOpt.clear();
  el.append(h('div', 'hruler', `${project.tracks.length} track${project.tracks.length === 1 ? '' : 's'}`));
  project.tracks.forEach((t, i) => {
    const row = h('div', 'head' + (t.id === project.selTrack ? ' sel' : ''));
    row.style.setProperty('--tc', t.color);
    row.dataset.id = t.id;
    pressOrTap(row, e => !e.target.closest('button, select, input'), () => selectTrack(t.id)); // (a finger: on the tap's release)
    row.addEventListener('dblclick', e => { if (!e.target.closest('button, select, input')) openTab('roll'); });
    const top = h('div', 'hrow');
    const name = h('input', 'hname'); name.value = t.name; name.title = 'Track name'; name.setAttribute('aria-label', 'Track name');
    name.onchange = () => { hist.record(project); t.name = name.value.trim() || t.name; name.value = t.name; persist(); updateUndoUI(); if (t.id === project.selTrack) { tabTrackUI(); renderPanels(); } };
    name.addEventListener('keydown', e => { if (e.key === 'Enter') name.blur(); e.stopPropagation(); });
    const tb = (lbl, key, title, cls) => {
      const b = h('button', 'hb ' + cls, lbl); b.type = 'button'; b.title = title;
      b.setAttribute('aria-pressed', t[key] ? 'true' : 'false');
      b.onclick = () => {
        t[key] = !t[key];
        b.setAttribute('aria-pressed', t[key] ? 'true' : 'false');
        if (key !== 'arm') mix();
        if (key === 'arm' && !t.arm && T.rec) for (const [k, r] of recLive) if (r.tr === t) { commitNote(r, recTick()); recLive.delete(k); }
        arr && arr.render(); persist();
      };
      return b;
    };
    const meter = h('div', 'hmeter'); meter.append(h('i'));
    top.append(name, tb('M', 'mute', 'Mute', 'm'), tb('S', 'solo', 'Solo', 's'), tb('●', 'arm', 'Arm for recording', 'r'), meter);
    const bot = h('div', 'hrow');
    // the instrument chip (its drawing, model · voice mode, R6: as its patch plays); the preset select lives on the
    // instrument module's bar now (cv-module), the other models in the chip's menu (instItems)
    voiceShown.set(t.id, trackVoice(t).label);
    const ichip = instChip(t);
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
    bot.append(ichip, ch, vol, pan, dup, del);
    row.append(top, bot);
    el.append(row);
    if (i === project.tracks.length - 1) row.classList.add('last');
  });
  trkDotsUI();
  tabTrackUI();
  cvChipSync(); // the instrument module's preset chip ('Custom' after a knob tweak, a Serum preset loaded)
  if (shell.top && shell.nTr !== project.tracks.length) { shell.nTr = project.tracks.length; applyKbHeight(); } // (the top tray's row stops)
  arr && arr.render();
}
function addTrack(m = model, vals0 = null, o = null) {
  hist.record(project);
  const t = S.newTrack(project, { model: m.id, vals: vals0 ? JSON.parse(JSON.stringify(vals0)) : loadVals(m), name: `${m.name} ${project.tracks.length + 1}` });
  t.fx = newFx(m); seedPend.add(t.id);
  if (o && o.ui === 'flow' && !m.custom) t.lay = { [cvModule.ID.inst]: { x: 0, y: 0, ui: 'flow' } }; // (the Sources tray's Simple)
  project.tracks.push(t);
  CMOD.adopt(project);
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
  seedPend.add(c.id);
  if (t.dev) { // (stage 1e: every instrument, panel and cable with their fields — any shape; adopt reads the devices)
    for (const k of ['model', 'vals', 'preset', 'seq', 'fx']) delete c[k];
    Object.assign(c, { prim: t.prim, nid: t.nid, dev: clone(t.dev), wires: clone(t.wires) });
    if (t.mods) c.mods = clone(t.mods);
  } else { if (t.seq) c.seq = clone(t.seq); c.fx = clone(fxOf(t)); }
  if (t.lay) c.lay = clone(t.lay); // (the canvas layout, view only)
  project.tracks.splice(project.tracks.indexOf(t) + 1, 0, c);
  CMOD.adopt(project); // (the copy's devices keep their ids: they are per track)
  syncNodes(); sendSong(c, true);
  renderHeads(); persist(); updateUndoUI();
}
function deleteTrack(t) {
  if (project.tracks.length < 2) { alert('A project needs at least one track.'); return; }
  if (t.notes.length && !confirm(`Delete “${t.name}” and its ${t.notes.length} notes?`)) return;
  hist.record(project);
  const i = project.tracks.indexOf(t);
  project.tracks.splice(i, 1);
  seqRun.delete(t.id); inputSubs.delete(t.id); lastIn.delete(t.id);
  if (project.selTrack === t.id) { project.selTrack = project.tracks[Math.max(0, i - 1)].id; bind(); renderNav(); renderViews(); roll && roll.setTrack(); }
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
  $('#aBars').classList.toggle('has', on || !!rangeClip); // (the folded "Bars ▾" of a narrow window: something to do)
}
function setLoop(s, e) {
  s = Math.max(0, Math.round(s)); e = Math.round(e);
  if (e <= s) return;
  project.loop.start = s; project.loop.end = e;
  if (!project.loop.on) project.loop.on = true;
  transportUI(); reanchor(false); persist();
  arr && arr.render(); roll && roll.render();
}
// a two-finger gesture took a ruler drag over (arrange.js restore, roll.js _rollback): the loop as at the press, its on
// flag too (setLoop turns it on)
function restoreLoop(L) {
  Object.assign(project.loop, { start: L.start, end: L.end, on: !!L.on });
  transportUI(); reanchor(false); persist();
  arr && arr.render(); roll && roll.render();
}
function initEditors() {
  arr = new Arrangement($('#lanes'), {
    getProject: () => project,
    selectTrack: id => selectTrack(id),
    // a double-tapped lane opens its track in the roll at the tapped bar (t: its tick)
    openTrack: (id, t) => { selectTrack(id); openTab('roll'); if (Number.isFinite(t)) roll.reveal(t); },
    getPlayhead: () => curTick(),
    setPlayhead: t => seek(t),
    setLoop,
    restoreLoop,
    getRange: () => range,
    setRange: (s, e) => { range = s == null || e == null || e <= s ? null : [Math.round(s), Math.round(e)]; rangeUI(); arr.render(); },
    rowHeight: 56,
  });
  // a preview's note-off goes to the node its note-on went to (pitch → track ids, note-on order): the selection may have
  // moved in between (selectTrack → roll.setTrack ends a held gesture after selTrack changed; a _blip's 170 ms off), and
  // a preview voice is the preview's own (R7 B5) — the song's / the keys' note-offs never release it
  const audTr = new Map();
  roll = new PianoRoll($('#rollwrap'), {
    getProject: () => project,
    getTrack: () => trk(),
    edit: (label, fn) => edit(label, fn),
    beginEdit: () => { hist.record(project); gesture = true; updateUndoUI(); },
    endEdit: () => { gesture = false; changed(); },
    changed: () => { sendSong(trk()); arr && arr.render(); },
    // aud: a preview — a voice of its own, never the song's (R7 B5: tapping a chord note while the loop plays kept cutting it)
    // stage 1e: on a graphed node every powered instrument whose key zone holds n hears it, transposed (the engine routes
    // a preview to one Inst: i); the receivers [[dev, pitch]] are kept for the note-off (a legacy node: to: null, as before)
    audition: (n, v) => {
      const t = trk(), N = nodes.get(t.id), to = N && N.graphed && t.dev ? CG.powered(t).map(id => [id, CG.zoneOf(t.dev[id])])
        .filter(([, z]) => n >= z.lo && n <= z.hi && n + z.xp >= 0 && n + z.xp <= 127).map(([id, z]) => [id, n + z.xp]) : null;
      let q = audTr.get(n); if (!q) audTr.set(n, q = []); q.push({ id: t.id, to });
      if (to) for (const [id, m] of to) postTo(t, { t: 'on', n: m, v: (v || 100) / 127, aud: 1 }, id, true);
      else postTo(t, { t: 'on', n, v: (v || 100) / 127, aud: 1 });
      if (!ctx) powerOn().catch(() => {});
    },
    auditionOff: n => {
      const q = audTr.get(n), r = q ? q.shift() : null; if (q && !q.length) audTr.delete(n);
      const tr = r ? { id: r.id } : trk();
      if (r && r.to) for (const [id, m] of r.to) postTo(tr, { t: 'off', n: m, aud: 1 }, id, true);
      else postTo(tr, { t: 'off', n, aud: 1 });
    },
    getPlayhead: () => curTick(),
    setPlayhead: t => seek(t),
    setLoop,
    restoreLoop,
    getSnap: () => project.snap,
    onSelect: n => { const el = $('#rSel'); if (el) el.textContent = n ? `${n} selected` : 'No selection (edits apply to all notes)'; },
    touch: rollTouchDev, // taller default rows; automatic sizing keeps rows ≥ 14 px (the roll scrolls instead)
    rollRowH: rollView.rowH,
    onRows: r => { rollView.rowH = r; clearTimeout(rollViewT); rollViewT = setTimeout(rollViewSave, 300); },
    // the toolbar's touch modifier latches (buildRollTools); a finger or pen on the roll shows them
    mods: e => { if (e && e.pointerType && e.pointerType !== 'mouse' && !rollFing) { rollFing = true; rollLatchUI(); } return rollMods(e); },
    consumeMods: () => rollConsume(),
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
// CANVAS │ ROLL (the canvas shell): 'roll', or else 'canvas' — a view saved before the canvas ('inst' / 'fx') opens CANVAS.
// The FX rack lives in its canvas module now (always mounted), so no tab builds or drops it.
function openTab(name) {
  name = name === 'roll' ? 'roll' : 'canvas';
  for (const b of document.querySelectorAll('.tabs button')) { const on = b.dataset.tab === name; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  $('#tab-inst').hidden = name !== 'canvas';
  $('#tab-roll').hidden = name !== 'roll';
  if (name === 'roll') { if (shell.src) { shell.src.close(); shell.fx.close(); } roll.resize(); roll.render(); } // (the side trays are the canvas's)
  if (world) world.setActive(name === 'canvas');
  // a default camera owed since a track switch under ROLL: now, on the real band (setActive measured it)
  if (name === 'canvas' && cvCamDef && cvView && cvCamDef === CM.camKey(project.uid, cvView.trackId)) cvCamRestore(trk());
  monitors.sync();
  store.set('synth.tab', name);
}
// the instrument panels, the FX racks (always mounted on the canvas; today's FX tab only while shown) and the canvas
// modules follow the selected track (stage 1e: every device body of it)
function renderViews() {
  if (cvSwitching()) { cvSwitch(); return; } // (a track switch on the canvas: the bodies mount over frames)
  if (cvMount) cvMountEnd(); // (a switch still mounting: this render completes it at once)
  cvBusy = true;
  try { renderPanels(); } finally { cvBusy = false; }
  const fx = $('#tab-fx');
  if (cvOn()) renderFxTabs(); else if (fx && !fx.hidden) renderFxTab();
  cvRender();
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
// Touch modifier latches of the Piano Roll — wk.modifierBar's keys, labels and rules, the roll's own set (no Serum kit
// load, no latch carried over from another surface): Fine = no snap (Shift-drag), Alt = a drag copies / the velocity lane
// paints, Shift = taps add to (or remove from) the selection. Tap = the next roll gesture, double-tap = locked until
// tapped off. Shown on a coarse-pointer device / an iPad, or once a finger / pen touches the roll (host.mods).
const rollLatch = { fine: 0, alt: 0, shift: 0 }, rollLatchT = {}, rollLatchB = {}; // B: the buttons, [button, label] per key
let rollFing = false, rollLatchG = null;
function rollMods(e) {
  const sh = !!(e && e.shiftKey);
  return { fine: sh || rollLatch.fine > 0, alt: !!(e && e.altKey) || rollLatch.alt > 0, shift: sh || rollLatch.shift > 0 };
}
function rollConsume() { let ch = false; for (const k in rollLatch) if (rollLatch[k] === 1) { rollLatch[k] = 0; ch = true; } if (ch) rollLatchUI(); }
function rollLatchUI() {
  if (rollLatchG) rollLatchG.style.display = rollTouchDev || rollFing ? '' : 'none';
  for (const k in rollLatchB) {
    const [b, l] = rollLatchB[k], st = rollLatch[k];
    b.classList.toggle('on', st > 0);
    b.style.boxShadow = st === 2 ? 'inset 0 -2px 0 currentColor' : ''; // locked
    b.setAttribute('aria-pressed', st > 0 ? 'true' : 'false');
    b.setAttribute('aria-label', l + (st === 2 ? ' (locked)' : st === 1 ? ' (next gesture)' : ''));
  }
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
  // touch modifier latches (rollLatch): tap = next gesture, double-tap = lock, tap again = off
  const latch = [['fine', 'Fine', 'Fine: drag without snapping (= Shift-drag)'], ['alt', 'Alt', 'Alt: dragging a note copies it; on the velocity lane, paint'],
    ['shift', 'Shift', 'Shift: tap notes to add them to (or take them out of) the selection; hold-drag adds a box']].map(([k, l, ti]) => {
    const b = btn(l, ti + ' · tap: next gesture, double-tap: lock', e => {
      const t = (e && e.timeStamp) || Date.now(), st = rollLatch[k];
      rollLatch[k] = st === 1 && rollLatchT[k] != null && t - rollLatchT[k] < 350 ? 2 : st ? 0 : 1;
      rollLatchT[k] = t; rollLatchUI();
    });
    b.dataset.mod = k; rollLatchB[k] = [b, l]; return b;
  });
  rollLatchG = grp('Modifiers', ...latch); rollLatchG.id = 'rollMods';
  rollLatchUI();
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
  // Keys −/+: the row height (the keys' size; also pinch up / down, Alt-wheel), kept for this device
  const keyZ = (txt, label, d) => { const b = btn(txt, label + ' (row height, kept on this device)', () => roll.zoomRows(d)); b.setAttribute('aria-label', label); return b; };
  grp('View', btn('−', 'Zoom out', () => roll.zoomX(1 / 1.4)), btn('+', 'Zoom in', () => roll.zoomX(1.4)), btn('Fit', 'Fit notes', () => roll.fit()),
    h('span', 'rlab', 'Keys'), keyZ('−', 'Smaller keys', -1), keyZ('+', 'Bigger keys', 1), follow, ghosts);
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
  renderNav(); renderViews(); renderHeads(); projectUI(); buildRollTools();
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
  numIn('tBpm', el => { project.bpm = clamp(+el.value || 120, 20, 300); el.value = project.bpm; reanchor(false); persist(); for (const t of project.tracks) if (t.model === 'tb303' && t.seq && t.seq.sync) seqSend(t); queueAll(); });
  numIn('tSigN', el => { project.sig = [clamp(Math.round(+el.value) || 4, 1, 16), project.sig[1]]; el.value = project.sig[0]; reanchor(false); arr.render(); roll.render(); persist(); });
  $('#tSigD').onchange = e => { project.sig = [project.sig[0], +e.target.value]; reanchor(false); arr.render(); roll.render(); persist(); };
  numIn('tBars', el => { project.bars = clamp(Math.round(+el.value) || 1, 1, 999); el.value = project.bars; arr.fit(); persist(); });
  $('#tUndo').onclick = undo; $('#tRedo').onclick = redo;
  $('#aAdd').onclick = () => cvOpenSources('track'); // (+ Track: pick its instrument in the Sources tray)
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
    curDevs.clear(); // (another project: each track opens on its primary, whatever ids repeat — review H13)
    applyRestore(p);
  };
  $('#fSave').onclick = () => projectFile().then(txt => download(new Blob([txt], { type: 'application/json' }), slug(project.name) + '.synth.json'),
    err => alert('Could not save the project: ' + err.message));
  $('#fSaveV1').onclick = () => classicFile().then(r => { if (r) download(new Blob([r], { type: 'application/json' }), slug(project.name) + '.classic.synth.json'); },
    err => alert('Could not save the project: ' + err.message));
  $('#fMidi').onclick = () => download(new Blob([S.exportMIDI(project)], { type: 'audio/midi' }), slug(project.name) + '.mid');
  $('#fOpen').onclick = () => $('#fFile').click();
  $('#fFile').onchange = async e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      if (/\.midi?$/i.test(f.name) || f.type.includes('midi')) importMidiFile(new Uint8Array(await f.arrayBuffer()), f.name);
      else {
        let o;
        try { o = JSON.parse(await f.text()); } catch { throw new Error('Not a valid project file'); }
        flush(); // a pending autosave of the current project lands first
        // embedded user wavetables and samples (§7.10, SPEC-serum2 §9.8) go into their stores, never into the project
        await restoreEmbedded(o);
        const p = loadProject(o, { file: true }); hist.record(project); if (T.playing) stop(); curDevs.clear(); applyRestore(p);
        if (p.newerSchema) readOnlyNotice(); // (saved by a newer build: this project read-only, the store not locked)
      }
    } catch (err) { alert('Could not open that file: ' + err.message); }
  };
  $('#fBounce').onclick = () => openBounce();
  $('#bCancel').onclick = () => { $('#modal').hidden = true; };
  bounceButton();
  pressOrTap($('#modal'), e => e.target.id === 'modal', () => { $('#modal').hidden = true; }); // the backdrop (a finger: on release)
}
function slug(s) { return (s || 'untitled').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'untitled'; }
// The files the page hands over (Save, Export MIDI, Bounce WAV, presets, wavetables…). The iPad / iPhone home-screen app
// may not download a blob: link (iPadOS has ignored it there, or shown the file with no way back): there the share sheet
// takes the file (Save to Files, AirDrop…). Sharing needs a fresh tap: a file that is ready later (a bounce, a slow save)
// is offered to tap through `later(go)` (the caller's own control), else on the notice line.
function download(blob, name, later) {
  const file = shareable(blob, name);
  if (file) shareFile(file, later, false); else saveLink(blob, name);
}
function saveLink(blob, name) {
  const url = URL.createObjectURL(blob), a = h('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function shareable(blob, name) {
  const nav = navigator;
  if (!app || !app.platform.ios || nav.standalone !== true || typeof nav.share !== 'function' || typeof nav.canShare !== 'function' || typeof File !== 'function') return null;
  try { const f = new File([blob], name, { type: blob.type || 'application/octet-stream' }); return nav.canShare({ files: [f] }) ? f : null; } catch { return null; }
}
function shareFile(file, later, again) {
  const offer = () => {
    const go = () => shareFile(file, null, true);
    if (typeof later === 'function') { later(go); return; }
    const msg = file.name + ' is ready — tap here to save or share it';
    noticeActs.set(msg, () => { noticeActs.delete(msg); notice('', 0); go(); });
    notice(msg, 60000);
  };
  const ua = navigator.userActivation;
  if (!again && ua && ua.isActive === false) { offer(); return; } // the tap that asked for it has expired
  let p;
  try { p = navigator.share({ files: [file] }); } catch (err) { p = Promise.reject(err); }
  Promise.resolve(p).catch(err => {
    const why = err && err.name;
    if (why === 'AbortError') return; // the user closed the sheet
    if (why === 'NotAllowedError' && !again) { offer(); return; }
    console.warn('SYNTH: sharing ' + file.name + ' (' + (err && err.message) + ') — downloading it instead');
    saveLink(file, file.name);
  });
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
    t.fx = newFx(m); seedPend.add(t.id);
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
// the dialog's main button: Render & download (Save WAV… while a rendered file waits for a tap to be shared)
function bounceButton() { const go = $('#bGo'); go.textContent = 'Render & download'; go.onclick = () => bounce(); }
function openBounce() {
  bounceButton();
  $('#bRange').value = range ? 'sel' : project.loop.on ? 'loop' : 'song';
  $('#bRange').querySelector('[value=sel]').disabled = !range;
  $('#bNote').textContent = 'Renders every audible track (mute/solo respected) offline — no clicks or dropouts regardless of CPU.';
  $('#bGo').disabled = false;
  $('#modal').hidden = false;
}
// The track ids a compiled patch sends MIDI OUT to (§7.9: arp / clip pane with MIDI OUT ≠ Off and a target; seq.outIds)
function midiOutIds(p) {
  const q = p && p.seq;
  if (!q || !q.active || !Array.isArray(q.outIds)) return [];
  const ids = [];
  for (const G of [q.arpG, q.clipG]) {
    const id = G && G[1] > 0 && G[6] >= 0 ? q.outIds[G[6]] : null;
    if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
// The tracks a bounce renders, in project order, with their offline patches and mix gains: every audible track with notes
// (or a synced 303), plus the MIDI OUT graph as it plays live (§7.9) — every audible target of a source with notes,
// even with no notes of its own, and every source with notes whose target is audible, a muted or soloed-out one at gain
// 0 (live, its node keeps running at gain 0 and drives the target)
// (stage 1e: a graph-shaped track's item carries its graph form, offParts; a synced 303 is any powered one of the track)
const syncedOf = tr => (tr.dev ? CG.powered(tr) : []).some(id => tr.dev[id].model === 'tb303' && tr.dev[id].seq && tr.dev[id].seq.sync);
function bounceSet(sr) {
  const P = new Map(), partsOf = tr => { if (!P.has(tr)) P.set(tr, offParts(tr, sr)); return P.get(tr); };
  const want = new Map();
  for (const tr of project.tracks) {
    const synced = (tr.model === 'tb303' && tr.seq && tr.seq.sync) || syncedOf(tr);
    if (audible(tr) && (tr.notes.length || synced)) want.set(tr, tr.vol);
  }
  for (const tr of project.tracks) {
    if (!hasSx(tr) || !tr.notes.length) continue;
    const x = partsOf(tr);
    for (const id of (x.patch ? [x.patch] : Object.values(x.patches)).flatMap(midiOutIds)) {
      const tg = project.tracks.find(x => x.id === id);
      if (!tg || tg === tr || !audible(tg)) continue;
      if (!want.has(tg)) want.set(tg, tg.vol);
      if (!want.has(tr)) want.set(tr, 0);
    }
  }
  return project.tracks.filter(tr => want.has(tr)).map(tr => Object.assign({ tr, gain: want.get(tr) }, partsOf(tr)));
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
    const f = sr * 60 / (project.bpm * S.PPQ);
    const items = [];
    for (const x of bounceSet(sr)) {
      const { tr, patch, gain } = x, synced = tr.model === 'tb303' && tr.seq && tr.seq.sync;
      // a Serum track renders at its own quality (Ultra with "Use Ultra quality when rendering") regardless of the
      // dialog (§11.4, SPEC-serum2 §12.6); every node carries its track id: MIDI OUT between the bounced tracks (§7.9)
      items.push(Object.assign({ tr, patch, os: isSx(tr) ? sxOSFor(tr, sr, true) : os, hostOS: os, song: songData(tr, start, end),
        transport: { play: true, frame: 0, tick: start, fpt: f, loop: false, end }, seq: patch && synced ? seqPayload(tr, { run: false }) : null, gain, pan: tr.pan },
      x.graph ? { graph: x.graph, patches: x.patches, chains: x.chains, seqs: x.seqs, needs: x.needs } : null));
    }
    if (!items.length) { note.textContent = 'No audible tracks with notes in that range.'; go.disabled = false; return; }
    const buf = await renderOffline(sr, Math.ceil(secs * sr), items);
    const chs = [buf.getChannelData(0), buf.getChannelData(1)];
    let peak = 0;
    for (const c of chs) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > peak) peak = a; }
    const target = norm ? Math.pow(10, -0.3 / 20) : peak > 0.999 ? 0.999 : peak;
    if (peak > 0 && (norm || peak > 0.999)) { const k = target / peak; for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= k; }
    const wav = S.encodeWAV(chs, sr, bits);
    const done = `Done: ${secs.toFixed(1)} s rendered in ${((performance.now() - t0) / 1000).toFixed(1)} s · peak ${(20 * Math.log10(Math.max(1e-9, peak))).toFixed(1)} dBFS${peak > 0.999 && !norm ? ' (scaled to avoid clipping)' : ''}.`;
    note.textContent = done;
    // (the home-screen app on iPad / iPhone shares the file, which needs a fresh tap after a render: Save WAV… here)
    download(new Blob([wav], { type: 'audio/wav' }), `${slug(project.name)}-${sr / 1000}k-${bits}${bits === 32 ? 'f' : 'bit'}.wav`, share => {
      note.textContent = done + ' Tap Save WAV… to keep the file.';
      go.textContent = 'Save WAV…';
      go.onclick = () => { bounceButton(); share(); };
    });
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
// The on-screen keyboard's view (synth.kbSize {h, kw}, px, 0 = the default for the screen; synth.kbHidden): the key height
// (the grip on the panel's top edge; the panel never takes more than 60 % of the window) and the white-key width (the Key
// size slider; 0 fits 2–5 whole octaves to the width, the Phase-1 look)
const KB_H = [70, 360], KB_W = [16, 96];
const kbSize = (() => {
  const o = store.get('synth.kbSize', null), n = (v, [a, b]) => (Number.isFinite(+v) && +v > 0 ? clamp(Math.round(+v), a, b) : 0);
  return o && typeof o === 'object' ? { h: n(o.h, KB_H), kw: n(o.kw, KB_W) } : { h: 0, kw: 0 };
})();
const kbSave = () => store.set('synth.kbSize', { h: kbSize.h, kw: kbSize.kw });
// The Piano Roll's row height (synth.rollView {rowH}, px 5–56; 0 = sized to each track): a per-device choice (pinch,
// Keys −/+, Alt-wheel; fingers want taller rows than a mouse), not the project's. Written 300 ms after the last change
// (Alt-wheel streams), or by save().
const rollView = (() => {
  const o = store.get('synth.rollView', null), r = o && typeof o === 'object' ? +o.rowH : 0;
  return { rowH: Number.isFinite(r) && r > 0 ? clamp(Math.round(r), 5, 56) : 0 };
})();
let rollViewT = 0;
const rollViewSave = () => { clearTimeout(rollViewT); rollViewT = 0; store.set('synth.rollView', { rowH: rollView.rowH }); };
// The keys shown at a width of W px: kw = 0 fits whole octaves (2–5), else as many whole white keys of kw px as fit (at
// least an octave, C to C; at most the 75 of MIDI 0–127). The range starts on a C at or below the computer keys' octave
// (60 + 12·octave) — further below the more octaves fit — and fills upwards (downwards once it reaches G9).
function kbRange(W, kw, oct) {
  const nW = kw > 0 ? clamp(Math.floor(W / kw), 8, 75) : (W < 430 ? 2 : W < 700 ? 3 : W < 1050 ? 4 : 5) * 7 + 1;
  let lo = clamp(60 + 12 * oct - 12 * Math.floor((Math.floor((nW - 1) / 7) - 1) / 2), 0, 120), hi = lo, c = 1;
  while (c < nW && hi < 127) { hi++; if (!isBlack(hi)) c++; }
  while (c < nW && lo > 0) { lo--; if (!isBlack(lo)) c++; }
  return { lo, hi, nW: c };
}
let kbLo = 48, kbHi = 96, kbW = 0, kbPx = 0; // the range shown, the width it was laid out for and its white-key width (px)
// (Re)builds the keys. Notes held on them are kept: the pointers are captured by #keys (not by a key) and remember their
// note, so a rebuild under a finger (octave, key size, resize) still releases it, and held notes stay lit.
function buildKeys() {
  const el = $('#keys');
  el.innerHTML = ''; keyEls.clear();
  const w = el.clientWidth || window.innerWidth, R = kbRange(w, kbSize.kw, octave);
  kbLo = R.lo; kbHi = R.hi; kbW = w; kbPx = w / R.nW;
  const ww = 100 / R.nW, bw = ww * 0.62;
  let wi = 0;
  const comp = 60 + 12 * octave;
  const lit = new Set([...held.keys()].map(k => +k.split(':')[1]));
  for (let n = R.lo; n <= R.hi; n++) {
    const k = h('div', 'key ' + (isBlack(n) ? 'b' : 'w'));
    k.dataset.n = n;
    if (isBlack(n)) { k.style.left = `calc(${wi * ww - bw / 2}% )`; k.style.width = bw + '%'; }
    else { k.style.left = wi * ww + '%'; k.style.width = `calc(${ww}% + 1px)`; wi++; if (n % 12 === 0 && (kbPx >= 17 || !kbSize.kw)) k.append(h('span', 'nm', 'C' + (n / 12 - 1))); }
    const kc = KEYLAB[n - comp];
    if (kc && w > 600 && kbPx >= 22) k.append(h('span', 'kb', keyLab[kc])); // (labels only where they fit)
    if (lit.has(n)) k.classList.add('down');
    keyEls.set(n, k);
    el.append(k);
  }
  $('#octv').textContent = 'Oct ' + (octave > 0 ? '+' : '') + octave;
  // the slider spans the widths that differ at this width: from the widest that still shows all 75 keys to the narrowest
  // that shows one octave (8 white keys); a saved width outside them is kept, the slider just shows its end
  const s = $('#kbw');
  s.min = String(Math.max(KB_W[0], Math.floor(w / 75))); s.max = String(clamp(Math.floor(w / 9) + 1, KB_W[0] + 8, KB_W[1]));
  s.value = String(kbSize.kw || clamp(Math.round(kbPx), KB_W[0], KB_W[1]));
  s.setAttribute('aria-valuetext', `${R.nW} white keys, ${noteName(R.lo)} to ${noteName(R.hi)}${kbSize.kw ? '' : ' (fitted to the screen)'}`);
}
function setKeyWidth(px, save = true) {
  kbSize.kw = px > 0 ? clamp(Math.round(px), KB_W[0], KB_W[1]) : 0;
  buildKeys();
  if (save) kbSave();
}
let kbH = 170; // the key height in use (px)
const kbDefH = () => (window.innerWidth <= 900 ? 128 : 170); // = style.css .keys
// the panel's height besides the keys (toolbar, padding), measured while the keys are shown (a notice floats over the
// canvas, out of flow: style.css .notice)
function kbChrome() {
  const d = $('#perf').offsetHeight - $('#keys').offsetHeight;
  return !$('#kbrow').hidden && d > 0 ? d : 64;
}
// The canvas shell's one height budget (cv-tray budget, replacing the 60 % rule): the canvas between the trays keeps
// ≥ 240 px. kbMaxH: the most the keys may take when the keyboard tray leads (the top tray pushed to its one row).
const kbMaxH = (chrome = kbChrome()) => clamp(Math.floor(cvTray.budget({ vh: trayVh(), top: cvTray.TOP_ROW, bottom: chrome + KB_H[1],
  active: 'bottom', topMin: cvTray.TOP_ROW, bottomMin: chrome + KB_H[0] }).bottom - chrome), KB_H[0], KB_H[1]);
// The keys and the top tray as the budget allows: the chosen key height (kbSize.h within 70 px … kbMaxH; 0 = the screen's
// default) and the top tray's wanted height, the tray dragged last (shell.lead) winning and the other pushed toward its
// fold — never below one row / 70 px keys (a window too small for the rule: the canvas gets what is left)
function applyKbHeight(chrome = kbChrome()) {
  const max = kbMaxH(chrome), g = $('#kbGrip'), p = $('#perf'), keys = !$('#kbrow').hidden;
  const want = kbSize.h ? clamp(kbSize.h, KB_H[0], max) : kbDefH();
  const B = cvTray.budget({ vh: trayVh(), top: topWant(), bottom: chrome + (keys ? want : 0), active: shell.lead,
    topMin: cvTray.TOP_ROW, bottomMin: chrome + (keys ? KB_H[0] : 0) });
  kbH = keys ? clamp(Math.floor(B.bottom - chrome), KB_H[0], Math.max(KB_H[0], want)) : want;
  p.style.setProperty('--kbh', kbH + 'px');
  p.classList.toggle('short', kbH < 100); // the wheels drop their labels
  g.setAttribute('aria-valuenow', String(kbH)); g.setAttribute('aria-valuemax', String(Math.max(max, kbH)));
  g.setAttribute('aria-valuetext', `${kbH} pixels${kbSize.h ? '' : ' (default)'}`);
  topShow(B.top);
}
// px: the key height (0 = the default for the screen), within 70 px … kbMaxH. Asking for that limit or more while the
// keys already reach it keeps the height chosen before (was; a drag's: at its start), so one chosen in a taller window
// comes back when there is room again. The keyboard tray leads from then on (the budget pushes the top tray).
function setKbHeight(px, save = true, chrome = kbChrome(), was = kbSize.h) {
  const max = kbMaxH(chrome), p = Math.round(px), shown = Math.min(was || kbDefH(), max); // (the budget lowers a default too)
  kbSize.h = !(px > 0) ? 0 : p < max ? Math.max(KB_H[0], p) : p >= shown && shown >= max ? was : max;
  shell.lead = 'bottom';
  applyKbHeight(chrome);
  if (save) kbSave();
}
function setKbHidden(on, save = true) {
  const b = $('#kbHide');
  if (on) releasePtrs(); // fingers on the keys as they go: their notes end now
  $('#kbrow').hidden = on; $('#perf').classList.toggle('min', on);
  b.setAttribute('aria-expanded', on ? 'false' : 'true');
  b.querySelector('span').textContent = on ? 'Show keys' : 'Hide keys';
  b.title = on ? 'Show the on-screen keyboard' : 'Hide the on-screen keyboard (the controls stay)';
  if (save) store.set('synth.kbHidden', on);
  applyKbHeight(); // (the top tray may take the room the keys leave)
  if (!on) buildKeys(); // laid out for the width they now have
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
const ptrs = new Map(); // pointer id -> the note it holds on the keys (null: between keys)
function releasePtrs() {
  const el = $('#keys');
  for (const [id, n] of [...ptrs]) {
    ptrs.delete(id);
    try { el.releasePointerCapture(id); } catch { /* already released */ }
    if (n != null && ![...ptrs.values()].includes(n)) noteOff(n);
  }
}
// fn on a double-click (the mouse: its own dblclick) or a double tap (touch, pen: touch browsers need not send dblclick, so
// theirs is ignored): two taps < 450 ms and 16 px apart, each a press of < 350 ms that moved < 4 px and changed nothing (the
// element's value kept, still(): e.g. no drag), so quick nudges of a control are not a reset
function onDouble(el, fn, still = () => true) {
  let down = null, tap = null, type = 'mouse';
  el.addEventListener('dblclick', () => { if (type === 'mouse') fn(); });
  el.addEventListener('pointerdown', e => {
    type = e.pointerType || 'mouse';
    down = e.button > 0 || type === 'mouse' ? null : { t: e.timeStamp, x: e.clientX, y: e.clientY, v: el.value };
  });
  el.addEventListener('pointerup', e => {
    const d = down; down = null;
    if (!d || e.timeStamp - d.t > 350 || Math.hypot(e.clientX - d.x, e.clientY - d.y) >= 4 || el.value !== d.v || !still()) { tap = null; return; }
    if (tap && d.t - tap.t < 450 && Math.hypot(d.x - tap.x, d.y - tap.y) < 16) { tap = null; fn(); } else tap = { t: e.timeStamp, x: d.x, y: d.y };
  });
}
// the keyboard's view controls: Hide / Show keys, the height grip (drag; arrows, Page Up / Down, Home / End when focused;
// double-click / double-tap or Enter / Delete / Backspace resets) and the Key size slider (double-click / double-tap or
// Delete / Backspace: fitted to the screen again)
function initKbView() {
  const grip = $('#kbGrip'), kw = $('#kbw');
  $('#kbHide').onclick = () => setKbHidden(!$('#kbrow').hidden);
  const hid = !!store.get('synth.kbHidden', false);
  setKbHidden(hid, false); // (shown: sized and laid out for the width)
  if (hid) applyKbHeight();
  // the height grip on the shell's grip helper (cv-tray trayGrip, shared with the top tray): drag (up = taller), arrows ±10
  // (Shift ±1), Page Up / Down ±40, Home / End, Enter / Delete / Backspace and double-click / double-tap = the default
  let d = null; // a drag's start: the panel's chrome and the height chosen before it
  shell.kb = cvTray.trayGrip(grip, {
    edge: 'bottom', label: 'Keyboard height', step: 10,
    get: () => kbH, min: () => KB_H[0], max: () => kbMaxH(d ? d.chrome : kbChrome()),
    text: v => `${v} pixels${kbSize.h ? '' : ' (default)'}`,
    start: () => { d = { chrome: kbChrome(), was: kbSize.h }; },
    set: (px, phase) => {
      if (phase === 'move' && d) setKbHeight(Math.max(KB_H[0], px), false, d.chrome, d.was);
      else if (phase === 'end') { if (d) kbSave(); d = null; }
      else if (phase === 'cancel') { if (d) { kbSize.h = d.was; applyKbHeight(d.chrome); } d = null; } // a two-finger gesture: as it was, nothing saved
      else if (phase === 'reset') setKbHeight(0);
      else if (phase === 'key') setKbHeight(px);
    },
    onDouble: () => setKbHeight(0),
  });
  kw.addEventListener('input', () => setKeyWidth(+kw.value || KB_W[0], false));
  kw.addEventListener('change', kbSave);
  onDouble(kw, () => setKeyWidth(0));
  kw.addEventListener('keydown', e => { // (the arrows, Page Up / Down, Home / End are the slider's own)
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    e.preventDefault(); e.stopPropagation(); // (not the page's Delete: the piano roll's selected notes stay)
    setKeyWidth(0);
  });
  if (typeof ResizeObserver === 'function') { // the keys' own width can change without a window resize (a scrollbar)
    let q = 0;
    new ResizeObserver(() => {
      if (!q) q = requestAnimationFrame(() => { q = 0; const w = $('#keys').clientWidth; if (w && w !== kbW) buildKeys(); });
    }).observe($('#keys'));
  }
}
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
    if (e.defaultPrevented) return; // consumed by a control (Serum panel menus, overlays, editors)
    const t = e.target, k = (e.key || '').toLowerCase(), code = e.code || KEY2CODE[k] || '';
    const inRoll = !$('#tab-roll').hidden && lastArea === 'roll';
    if (k === 'escape') { // works whatever has focus
      if (!$('#modal').hidden) { $('#modal').hidden = true; return; }
      if (app && app.sheetOpen()) { app.closeSheet(); return; }
      if (cvShellEscape() || cvWorldEscape()) return; // stage 1b: a popover / tray / sheet, then a canvas drag / edit state / selection
      if (cancelLearn(true)) return; // a pending MIDI Learn, not a panic
      if (textEntry(t) || (t && t.tagName === 'SELECT')) t.blur();
      if (inRoll && roll.getSelection().length) roll.selectNone(); else panic();
      return;
    }
    if (textEntry(t) || !$('#modal').hidden || (app && app.sheetOpen())) return; // only real text entry keeps the keys
    if (cvWorldKey(e)) return; // stage 1b: canvas shortcuts (only while focus is in #viewport; never Space or a play key)
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

/* ------------------------------------------------------------- scope */
let scopeMode = 'wave';
const td = new Float32Array(8192), fd = new Float32Array(4096);
function drawScope() {
  const cv = $('#scope');
  if (!cv.offsetParent || (cvView && !cvView.live(cvModule.ID.out))) return; // (canvas: only while OUT is live — on screen, not folded)
  // the store through the kit (wk.fitCanvas): dpr capped at 2 and, in the OUT module, the camera's zoom (clamp(dpr·k,
  // 0.5, 2), SPEC §4.4): sharp at 200 %, no full-size store per frame at 50 %. The context draws in CSS px
  const W = cv.clientWidth, H = cv.clientHeight;
  const g = fitCanvas(cv, W, H);
  if (!g) return;
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
  if (ctx && !meterT) clockSample(ctx); // (the stall meter; its 5 ms timer while the engine starts)
  if (T.playing && T.a && ctx) {
    const t = curTick();
    posUI(t);
    roll && roll.setPlayhead(t, true); arr && arr.setPlayhead(t, true); // drawn in this frame, not the next
    replaceSweep(t);
    cvModPlay(); // (stage 2a: the modulator modules show the selected track's lanes)
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

/* ============================================== canvas shell, stage 1b (docs/canvas/IMPL-1b.md §2, §4.8) */
// Three lanes build it in parallel; each edits only its own region below and the main.js functions IMPL-1b §2.3 gives it.
// The functions here are the cross-lane entry points: their names and signatures are fixed by the contract (each lane
// replaces only its own stubs' bodies). Until a lane lands, its stubs keep today's behaviour.
/* ---------------------------------------------- cv SHELL: top tray, keyboard tray, side trays, ≡ / ⚙, chips */
// The shell around the canvas (IMPL-1b §5.1, SPEC-canvas §2.1–§2.4): the top tray (one 48 px row; its grip reveals the
// arrangement toolbar, the ruler and the track rows, heights snapped to whole rows), the keyboard tray on the same grip
// helper (cv-tray trayGrip), one height budget for both (cv-tray budget: the canvas keeps ≥ 240 px, the tray dragged last
// wins and pushes the other toward its fold), the side trays (Sources: the synth drawings, tap or drag; Effects), the
// ≡ / ⚙ / ⋯ / Bars ▾ / track-list popovers and the Help sheet in #ov. Tray heights and widths persist in synth.cv.trays.
const shell = { top: null, kb: null, src: null, fx: null, tiles: null, fxTiles: null, measure: null, menus: [], sheet: null, lead: 'bottom', leadWas: 'bottom',
  topH: 0, topLast: 0, topShown: 0, safeTop: 0, chrome: 0, srcAsk: false, drop: null, dropOn: null, chipModel: '', instT: 0, dots: [], nTr: 0 };
const oneRow = () => cvTray.topSnaps(1)[1]; // the arrangement toolbar, the ruler and one track row
const trayVh = () => Math.max(0, (window.innerHeight || 800) - shell.safeTop);
function trayPref() { const p = store.get(cvTray.TRAY_PREF, null); return p && typeof p === 'object' ? p : {}; }
function trayPrefSave() { store.set(cvTray.TRAY_PREF, Object.assign({}, trayPref(), { top: shell.topH, topLast: shell.topLast })); }
// the top tray's wanted height within its stops for this many tracks (its shown height comes from the budget)
function topWant() { const S = cvTray.topSnaps(project.tracks.length); return clamp(shell.topH || cvTray.TOP_ROW, cvTray.TOP_ROW, S[S.length - 1]); }
// the most the top tray may take when it leads (the keys pushed down to their least)
function topMaxH() {
  const S = cvTray.topSnaps(project.tracks.length), keys = !$('#kbrow').hidden, chrome = shell.chrome || kbChrome(), lo = chrome + (keys ? KB_H[0] : 0);
  const B = cvTray.budget({ vh: trayVh(), top: S[S.length - 1], bottom: lo, active: 'top', topMin: cvTray.TOP_ROW, bottomMin: lo });
  return Math.max(cvTray.TOP_ROW, Math.min(S[S.length - 1], Math.floor(B.top)));
}
// the top tray at the budget's px: its height (CSS --cv-top), folded to its row below the first track row
function topShow(px) {
  const el = $('#topTray'), h = Math.max(cvTray.TOP_ROW, Math.round(px)), was = shell.topShown;
  shell.topShown = h;
  el.style.setProperty('--cv-top', h + 'px');
  const folded = h <= cvTray.TOP_ROW + 2;
  el.classList.toggle('collapsed', folded);
  if (was && was <= cvTray.TOP_ROW + 2 && !folded && arr) arr.resize(); // (hidden, the lanes had no width)
  if (shell.top) shell.top.sync();
}
// the top grip's phases (cv-tray trayGrip): a drag follows the finger, its release snaps to whole rows
function topSet(px, phase) {
  const el = $('#topTray');
  if (phase === 'reset') px = shell.topShown > cvTray.TOP_ROW + 2 ? cvTray.TOP_ROW : oneRow();
  shell.topH = Math.max(cvTray.TOP_ROW, Math.round(px));
  if (phase === 'move') { el.classList.add('drag'); applyKbHeight(shell.chrome || undefined); return; }
  el.classList.remove('drag');
  if (phase === 'cancel') shell.lead = shell.leadWas; // a two-finger gesture: as it was, nothing saved
  else { shell.lead = 'top'; if (shell.topH > cvTray.TOP_ROW) shell.topLast = shell.topH; }
  applyKbHeight();
  shell.chrome = 0;
  if (phase !== 'cancel') trayPrefSave();
}
// double-tap / double-click on the top grip: folded ↔ the last height
function topToggle() {
  if (shell.topShown > cvTray.TOP_ROW + 2) { shell.topLast = Math.max(shell.topH, oneRow()); shell.topH = cvTray.TOP_ROW; }
  else { shell.topH = Math.max(shell.topLast || 0, oneRow()); shell.lead = 'top'; }
  applyKbHeight(); trayPrefSave();
}
// the status bar's strip above the top tray (env(safe-area-inset-top), the installed app): out of the budget's height
function shellMeasure() {
  let s = 0;
  try { const cs = typeof getComputedStyle === 'function' ? getComputedStyle($('#topTray')) : null; s = cs ? parseFloat(cs.paddingTop) || 0 : 0; } catch { s = 0; }
  shell.safeTop = s;
}
// the selected track in the top row: chip (colour, drawing, name, model · voice) and its dot
function trkChipUI() {
  const t = trk(), c = $('#trkChip');
  if (!c) return;
  c.style.setProperty('--tc', t.color);
  $('#trkChip .cv-cn').textContent = t.name;
  $('#trkChip .cv-cv').textContent = instN(t) > 1 ? instsTxt(t) : modelById(t.model).name + ' · ' + (voiceShown.get(t.id) || trackVoice(t).label);
  if (shell.chipModel !== t.model) { shell.chipModel = t.model; $('#trkChip .cv-cart').innerHTML = cvArt.chip(t.model); }
  c.setAttribute('aria-label', `Track “${t.name}” (${modelById(t.model).name}) — the track list`);
  for (const d of shell.dots) { const on = d.dataset.id === t.id; d.classList.toggle('on', on); d.setAttribute('aria-pressed', on ? 'true' : 'false'); }
}
// one dot per track (tap selects); rebuilt with the track rows
function trkDotsUI() {
  const box = $('#trkDots');
  if (!box) return;
  box.innerHTML = '';
  shell.dots = project.tracks.map(t => {
    const d = h('button', 'cv-dot'); d.type = 'button'; d.dataset.id = t.id;
    d.style.setProperty('--tc', t.color);
    d.title = t.name; d.setAttribute('aria-label', 'Select track “' + t.name + '”');
    d.onclick = () => selectTrack(t.id);
    box.append(d);
    return d;
  });
  trkChipUI();
}
// the track list under the chip's ▾: every track (tap selects) and + Add track
function trkListUI() {
  const pop = $('#trkPop');
  pop.innerHTML = '';
  for (const t of project.tracks) {
    const b = h('button', 'cv-tpi' + (t.id === project.selTrack ? ' on' : '')); b.type = 'button'; b.setAttribute('role', 'menuitem');
    b.style.setProperty('--tc', t.color);
    const art = h('span', 'cv-cart'); art.innerHTML = cvArt.chip(t.model); art.setAttribute('aria-hidden', 'true');
    const tx = h('span', 'cv-tpt'); tx.append(h('b', null, t.name), h('small', null, instN(t) > 1 ? instsTxt(t) : modelById(t.model).name + ' · ' + (voiceShown.get(t.id) || trackVoice(t).label)));
    b.append(h('span', 'cv-sw'), art, tx);
    b.onclick = () => selectTrack(t.id);
    pop.append(b);
  }
  const add = h('button', 'cv-tpi add', '+ Add a track…'); add.type = 'button'; add.setAttribute('role', 'menuitem');
  add.onclick = () => cvOpenSources('track');
  pop.append(add);
}
// the track rows' instrument chip: tap → the instrument on the canvas; long-press / right-click → its menu
function instItems(t) { // every model, named with its voice mode (R6: the track's own as its patch plays)
  return MODELS.map(m => ({ value: m.id, label: m.name + ' · ' + (m.id === t.model ? voiceShown.get(t.id) || trackVoice(t).label : modelVoice(m).label) }));
}
function instMenu(t, x, y) {
  shell.instT = performance.now();
  const tr = () => project.tracks.find(q => q.id === t.id);
  const change = id => { const q = tr(); if (!q) return; selectTrack(q.id); if (!cvDropInstrument(id, null)) setTrackModel(trk(), id); };
  cvTray.popupMenu(x, y, [
    { label: 'Change instrument', sub: instItems(t).map(it => ({ label: it.label, checked: it.value === t.model, action: () => change(it.value) })) },
    { label: 'Show on canvas', action: () => { const q = tr(); if (q) instShow(q); } },
    { label: 'Open piano roll', action: () => { const q = tr(); if (q) { selectTrack(q.id); openTab('roll'); } } },
    { sep: true },
    { label: 'Replace with… (Sources tray)', action: () => { const q = tr(); if (q) { selectTrack(q.id); cvOpenSources('replace'); } } },
  ]);
}
function instShow(t) { selectTrack(t.id); if ($('#tab-inst').hidden) openTab('canvas'); cvReveal(t.id); }
function instTitle(name, tv) { return `${name} · ${tv} — tap: show it on the canvas · hold or right-click: change the instrument, open the roll`; }
function instChip(t) {
  const m = modelById(t.model), tv = voiceShown.get(t.id) || trackVoice(t).label;
  const b = h('button', 'hinst'); b.type = 'button';
  b.title = instTitle(m.name, tv);
  b.setAttribute('aria-label', `Instrument ${m.name}: show it on the canvas (menu: change it)`);
  const art = h('span', 'hia'); art.setAttribute('aria-hidden', 'true'); art.innerHTML = cvArt.chip(t.model);
  // model · voice mode: three spans, the model name ellipsised first (style.css .hin / .his / .hiv; ≤ 900 px only the voice
  // mode: the drawing names the model), the voice mode always whole
  const lab = h('span', 'hil'), many = instN(t) > 1;
  if (many) lab.append(h('span', 'hin', instsTxt(t))); else lab.append(h('span', 'hin', m.name), h('span', 'his', ' · '), h('span', 'hiv', tv));
  lab.value = many ? '' : t.model; // (voiceSeen relabels its .hiv while it names the model)
  voiceOpt.set(t.id, lab);
  b.append(art, lab);
  b.onclick = () => { if (performance.now() - shell.instT > 700) instShow(t); }; // (not the release of a long-press)
  cvTray.menuSource(b);
  b.addEventListener('contextmenu', e => { e.preventDefault(); instMenu(t, e.clientX, e.clientY); });
  return b;
}
/* the Sources tray: tap → replace the selected track's instrument (or, opened by + Track, a new track); drag → the canvas
   (anywhere on it: replaces the instrument, the true-size outline pinned to it — stage 1f: one instrument per track again)
   or the track list (a new track) */
function srcModeUI(mode) {
  if (!shell.tiles) return;
  shell.tiles.setMode(mode);
  const p = $('#srcMode');
  p.innerHTML = '';
  if (mode === 'track') p.append('Tap one for ', h('b', null, 'a new track'), ', or drag it onto the track list.');
  else p.append('Tap one to use it in place of the ', h('b', null, model.name), ' on ', h('b', null, '“' + trk().name + '”'),
    ', or drag it onto the canvas. Drag it onto the track list for a new track.');
}
function srcOver(t) {
  if (!t || typeof t.closest !== 'function') return null;
  if (t.closest('#topTray')) return 'tracks';
  if (!$('#tab-inst').hidden && t.closest('#viewport')) return 'canvas';
  return null;
}
// the Sources tray's "Hardware | Simple" switch (stage 1c, the user's request): a classic synth picked or dropped comes in
// that layout (lay.<dev>.ui = 'flow' or none, as the module's ⋯ → Simple / Hardware layout), inside the add's / replace's
// own undo step; a tap on the current model's tile switches its layout to the tray's (both ways: Simple and back to Hardware)
const TRAY_LAYOUT = 'synth.cv.trayLayout';
const srcUi = id => (!shell.tiles || modelById(id).custom ? null : shell.tiles.layout() === 'flow' ? 'flow' : 'hw');
function srcPick(id, mode) {
  const ui = srcUi(id), v = curView();
  // the tray stays open (the user's rule: only its rail, its ✕ or Escape close it); after a new track it goes back to
  // replacing the (new) selected track's instrument
  if (mode === 'track') { addTrack(modelById(id), null, { ui }); srcModeUI('replace'); return; }
  if (!cvDropInstrument(id, null, { ui }, v)) setTrackModel(v, id, { ui }); // (the same model: only the layout, if asked)
}
function srcDragEnd() {
  if (world) { world.ghost(null); world.dragPointer(null); world.setDragging(false); }
  $('#topTray').classList.remove('cv-dropt');
  shell.drop = null;
}
const srcDrag = {
  move(id, i) {
    const tracks = i.over === 'tracks';
    $('#topTray').classList.toggle('cv-dropt', tracks);
    if (!world) return;
    // over the canvas a drop replaces the instrument in place: the true-size outline sits on its module (its top-left, the
    // new size), not under the finger — the drop never moves it
    const t = trk(), k = cvHomeKeys(t).inst, im = i.over === 'canvas' && cvView ? cvView.modules.get(k) : null, ir = im ? im.rect() : null;
    if (i.over === 'canvas') {
      const sz = cvModuleSize(id), was = t.model, label = modelById(id).name + (id === was ? '' : ' · replaces ' + modelById(was).name);
      const c = ir ? world.toClient(ir.x, ir.y) : null;
      shell.drop = c ? world.ghost({ x: c.x, y: c.y, w: sz.w, h: sz.h, dx: 0, dy: 0, snap: false, label }) : world.ghost({ x: i.x, y: i.y, w: sz.w, h: sz.h, label });
    } else { world.ghost(null); shell.drop = null; }
    // edge pan once the pointer has left the tray (not while it is still over it), never over the track list nor over the
    // canvas while the outline is pinned to the module (a pan would only carry it away)
    world.dragPointer(tracks || ir || !i.left ? null : { x: i.x, y: i.y, pointerType: i.pointerType });
  },
  begin(id, i) { if (world) world.setDragging(true); srcDrag.move(id, i); }, // (the minimap steps aside for the whole drag, U14)
  drop(id, i) {
    const rect = shell.drop;
    srcDragEnd();
    const ui = srcUi(id);
    if (i.over === 'tracks') { addTrack(modelById(id), null, { ui }); return true; }
    if (i.over !== 'canvas') return false;
    if (!cvDropInstrument(id, rect, { ui })) setTrackModel(curView(), id, { ui }); // (the same model: only the layout, if asked)
    return true;
  },
  cancel() { srcDragEnd(); },
};
function sideChanged(which, on) {
  if (!on) return;
  if (which === 'src') { if (!shell.srcAsk) srcModeUI('replace'); shell.srcAsk = false; }
  // a narrow window (portrait, Stage Manager): the tray not in use folds to its rail
  const other = which === 'src' ? shell.fx : shell.src; // (null while initShell restores the first one)
  if (other && (window.innerWidth || 1400) < 1100) other.close();
}
// the meter (rate · load · latency): a tap shows its whole text over the row
function meterUI() {
  const m = $('#meter');
  let off = null;
  const close = () => { if (!m.classList.contains('open')) return false; m.classList.remove('open'); if (off) { off(); off = null; } return true; };
  m.addEventListener('click', e => {
    if (e.target && e.target.closest && e.target.closest('.latf button, .latpop')) return;
    if (close()) return;
    m.classList.add('open');
    const f = ev => { if (!m.contains(ev.target)) close(); };
    document.addEventListener('pointerdown', f, true);
    off = () => document.removeEventListener('pointerdown', f, true);
  });
  return { close };
}
// ≡ → Help & about: today's help text and the footer, moved into a sheet in #ov while it is open
function helpSheet() {
  const parts = $('#helpParts'), kids = [...parts.children], body = h('div', 'cv-help');
  for (const k of kids) body.append(k);
  if (shell.sheet) shell.sheet.close();
  shell.sheet = cvTray.sheet({ title: 'Help & about', body, layer: $('#ov'), wide: true,
    onClose: () => { for (const k of kids) parts.append(k); shell.sheet = null; } });
}
function initShell() {
  shellMeasure();
  const P = trayPref();
  shell.topH = P.top === 0 || P.top > 0 ? Math.max(cvTray.TOP_ROW, +P.top) : oneRow(); // (first run: one track row shown)
  shell.topLast = +P.topLast > cvTray.TOP_ROW ? +P.topLast : oneRow();
  // the top tray's grip: drag (snaps to whole rows on release), keys, double-tap = folded ↔ the last height
  shell.top = cvTray.trayGrip($('#topGrip'), {
    edge: 'top', label: 'Track list height', step: cvTray.ROW_H,
    get: () => shell.topShown || cvTray.TOP_ROW, set: topSet, min: () => cvTray.TOP_ROW, max: () => topMaxH(),
    snaps: () => cvTray.topSnaps(project.tracks.length), onDouble: topToggle,
    start: () => { shell.leadWas = shell.lead; shell.lead = 'top'; shell.chrome = kbChrome(); },
    text: v => (v <= cvTray.TOP_ROW + 2 ? 'folded to one row' : `${Math.max(0, Math.round((v - oneRow()) / cvTray.ROW_H) + 1)} track rows`),
  });
  // the menus: ≡ (file, app, help), ⚙ (settings), the transport's ⋯ and the arrangement's Bars ▾ (narrow windows), tracks
  shell.menus = [
    cvTray.menuPop($('#appMenuBtn'), $('#appMenu')),
    cvTray.menuPop($('#gearBtn'), $('#gearPop'), { pick: false, onOpen: () => { $('#masterG').value = $('#master').value; } }),
    cvTray.menuPop($('#tMore'), $('#tMorePop'), { attr: 'data-open', pick: false }),
    cvTray.menuPop($('#aBars'), $('#aEdit'), { attr: 'data-open' }),
    cvTray.menuPop($('#trkChip'), $('#trkPop'), { onOpen: trkListUI }),
    // narrow windows (≤ 740 px): "⏻ ▾" shows Power and the meter (with its latency button) folded out of the row
    cvTray.menuPop($('#engMore'), $('#engPop'), { attr: 'data-open', pick: false, onClose: () => { if (shell.meter) shell.meter.close(); } }),
  ];
  shell.meter = meterUI();
  // ⚙'s master level (shown where the top row's folds away, ≤ 1099 px): drives #master (its handler sets and saves)
  $('#masterG').oninput = () => { const m = $('#master'); m.value = $('#masterG').value; if (m.oninput) m.oninput(); };
  $('#helpBtn').onclick = () => helpSheet();
  const pm = $('#pinchMode');
  pm.value = store.get('synth.cv.pinch', 'canvas') === 'page' ? 'page' : 'canvas';
  pm.onchange = () => { const v = pm.value === 'page' ? 'page' : 'canvas'; if (world) world.setPinchMode(v); else store.set('synth.cv.pinch', v); };
  $('#rollhelp').onclick = () => $('#rollhelp').classList.toggle('open');
  // the side trays (a tap on the rail opens; the keyboard and the top row keep them open while played)
  const keep = t => !!(t && t.closest && t.closest('#perf, #topRow, .wk-ctx, .wk-pop'));
  shell.src = cvTray.sideTray($('#srcTray'), { side: 'left', key: 'src', store, rail: $('#srcRail'), panel: $('#srcPanel'), grip: $('#srcGrip'),
    label: 'Sources', keepOpen: keep, onChange: on => sideChanged('src', on) });
  shell.fx = cvTray.sideTray($('#fxTray'), { side: 'right', key: 'fx', store, rail: $('#fxRail'), panel: $('#fxPanel'), grip: $('#fxGrip'),
    label: 'Effects', keepOpen: keep, onChange: on => sideChanged('fx', on) });
  $('#srcClose').onclick = () => shell.src.close();
  $('#fxClose').onclick = () => shell.fx.close();
  shell.tiles = cvTray.sourcesTray($('#srcList'), { models: MODELS, tray: $('#srcTray'), layer: $('#ov'), pick: srcPick, drag: srcDrag,
    overOf: srcOver, canvasGhost: () => !!world && !$('#tab-inst').hidden, // (a drag out of the tray leaves it open: the user's rule)
    layoutEl: $('#srcLayout'), layout: store.get(TRAY_LAYOUT, 'hw'), onLayout: l => store.set(TRAY_LAYOUT, l),
    // (stage 2a) the Modulators section: a tap adds one where Tidy would, a drop where it lands (modPick / modTileDrag)
    mods: MOD_TILES, modsEl: $('#srcMods'), modsSec: $('#srcModSec'), modPick: id => modAdd(id, null), modDrag: modTileDrag,
    modCanvasGhost: () => !!world && !$('#tab-inst').hidden, toWorld: (x, y) => { const W = cvW(); return W && typeof W.toWorld === 'function' ? W.toWorld(x, y) : null; } });
  srcModeUI('replace');
  // the Effects tray (stage 1e, IMPL-1e §4.3; 1f: no panel tile): the rack's effects — a tap or a drop anywhere on the
  // canvas puts one into the track's FX (its panel, a Serum's own); the tray never closes by itself
  const fxl = $('#fxList');
  if (fxl) shell.fxTiles = cvTray.effectsTray(fxl, { items: FX_ITEMS, panel: false, pick: fxPick, drag: fxDrag, overOf: fxOver, tray: $('#fxTray'), layer: $('#ov'),
    canvasGhost: () => !!world && !$('#tab-inst').hidden, // (over the canvas the world draws the target module's outline)
    cost: id => COSTM.label(COSTM.estimate(id, devFactor())), toWorld: (x, y) => { const W = cvW(); return W && typeof W.toWorld === 'function' ? W.toWorld(x, y) : null; } });
  costLabels();
  // ⚙ → Measure this device (its line in the Canvas section): the trays' load labels follow this device's speed
  const gp = $('#gearPop');
  if (gp) {
    const f = h('div', 'field'), b = h('button', 'tt', 'Measure this device'), st = h('span', 'cv-measure');
    b.type = 'button'; b.title = 'Render a few standard voices off-line to learn this device’s speed: the trays’ load estimates and the instrument limits use it';
    const fv = +store.get(DEV_FACTOR, 0);
    if (fv > 0) st.textContent = '×' + (Math.round(fv * 100) / 100);
    b.onclick = () => { cvMeasure(b, st); };
    f.append(h('span', null, 'Load estimates'), b, st);
    gp.append(f);
    shell.measure = { btn: b, st };
  }
  if ((window.innerWidth || 1400) < 1100 && shell.src.isOpen() && shell.fx.isOpen()) shell.fx.close();
  // the top tray animates its height from now on (not from the stylesheet's 48 px to the restored height at load)
  setTimeout(() => $('#topTray').classList.remove('still'), 80); // (a timer: a page opened in a background tab gets no frames)
  if (globalThis.__synthTest && typeof globalThis.__synthTest === 'object') { // (tests/cv-shell-sim.test.mjs, main.test menus)
    globalThis.__synthTest.shell = { shell, openTab, instItems, instMenu, cvOpenSources, srcPick, srcDrag, srcOver, topSet, topToggle,
      topWant, topMaxH, kbMaxH: c => kbMaxH(c), applyKbHeight, trkListUI, helpSheet, cvShellEscape };
  }
}
function cvShellEscape() { // Escape: closes an open ≡ / ⚙ popover, side tray or sheet → true
  if (modLayer && modLayer.close()) return true; // (stage 2a: the mod inspector / parameter list / Mod list)
  if (shell.sheet) { shell.sheet.close(); return true; }
  for (const m of shell.menus) if (m.close()) return true;
  if (shell.meter && shell.meter.close()) return true;
  if (shell.src && shell.src.close()) return true;
  return !!(shell.fx && shell.fx.close());
}
function cvOpenSources(mode) { // opens the Sources tray; mode 'replace' (a tap replaces trk()'s instrument) | 'track' (a tap adds a track)
  if (!shell.src) return;
  if ($('#tab-inst').hidden) openTab('canvas'); // (the side trays belong to the CANVAS view)
  shell.srcAsk = true;
  srcModeUI(mode === 'track' ? 'track' : 'replace');
  if (shell.src.isOpen()) shell.srcAsk = false; else shell.src.open();
}
/* ---------------------------------------------- cv WORLD: camera, gestures, toolbar, canvas keys */
let world = null; // the CANVAS view's cv-world World (initWorld); null before it and wherever it cannot be built
// the camera over #world (pan / pinch / wheel, momentum, native-zoom hand-over, on-screen tracking, toolbar); a failure leaves the app
// working without it (world = null: the gesture hooks fall back to today's scrolling, the stubs answer false)
function initWorld() {
  const vp = $('#viewport'), w = $('#world');
  if (!vp || !w) { world = null; return; }
  try {
    world = cvWorld.createWorld(vp, { world: w, overlay: $('#overlay'), toolbar: $('#cvToolbar'), layer: $('#ov'),
      isBackground: el => cvModule.isBackground(el), onTidy: () => cvTidy(), store });
    world.on('movestart', () => hideTip()); // (the kit's popups and tip close in the world: wk.closeTransient)
  } catch (err) { world = null; console.warn('Canvas camera unavailable — the panels stay where they are', err); }
}
// Escape: ends a canvas drag, leaves edit state, then deselects → true — only while focus is on the canvas (the viewport, a
// module root or its bar; = cv-world canvasFocus, SPEC §4.8), as the roll's own selection does: with focus anywhere else
// (a key, Hold, a tray, after a track-row chip's reveal) Escape stays today's panic at once
function cvWorldEscape() {
  if (!world) return false;
  const vp = $('#viewport'), a = document.activeElement;
  let on = !!a && a === vp;
  if (!on && a && vp && vp.contains(a) && !/^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName || '') && !a.isContentEditable) {
    for (let n = a; n && n !== vp && typeof n.hasAttribute === 'function'; n = n.parentNode) {
      if (n.hasAttribute('data-cv-bar')) { on = true; break; }
      if (n.hasAttribute('data-cv-mod')) { on = n === a; break; }
    }
  }
  return on ? world.escape() : false;
}
function cvWorldKey(e) { return world ? world.key(e) : false; } // canvas shortcuts while focus is in #viewport (0, 1, arrows, ⌘/Ctrl-A) → true
function cvWheelVeto() { return world ? world.wheelVeto() : false; } // a camera move < 300 ms ago: knobs leave the wheel to the canvas
/* ---------------------------------------------- cv MODULES: modules, cables, layout, camera prefs */
// The selected track's modules (cv-module createTrackView, device-driven: one module per device, its key the device id,
// IMPL-1e §4.1): the primary's body is today's #inst (classic renderPanel or the whole SerumUI) and its FX module's the
// FX rack (#fxrack: FXRackUI, kept mounted) — moved by reference, ids kept, from #cvParts into the module bodies and back
// —, OUT holds the scope; every other device gets an element of its own (cvBodyEl: a ClassicPanel, a SerumUI or an
// FXRackUI built into it, destroyed with its module). .about opens from an instrument's ⋯ → About. Positions, folds and
// z live in track.lay (one History step per move / fold; bring-to-front none); the camera lives in device prefs
// (CAM_PREF, keyed by CM.camKey(project uid, track id)), never in History. Without the canvas DOM (no #cvParts / #world: an
// index.html from before the shell) nothing moves and today's tabs keep working (the current instrument in #inst).
const cvParts = { home: null, root: null, inst: null, fx: null, scope: null, about: null };
let cvView = null, cvViewKey = '', cvViewSig = '', cvTestWorld = null, cvBusy = false, cvHold = false, cvCamT = 0, cvCamPend = null;
const cvSeen = new Map(); // model id → the measured {w, h} of its instrument module on this device (drop outlines)
const cvChips = new Map(); // 'trackId/dev' → an instrument module's preset chip {key: 'trackId/dev/model', el, sel, sig}
const cvEls = new Map(); // 'trackId/key' → the body element of a device besides the primary and its FX (made here, mounted by its module)
const cvBuilt = new Map(); // 'trackId/key' → the element its panel was last built into (a module mounting another one is due a build)
const cvMounted = new Map(); // module key → {el, tid}: what the current view's module bodies hold
const cvDue = new Set(); // module keys mounted without their panel (a new device, a kind change, the bodies re-homed): built after the sync
const cvW = () => cvTestWorld || world;
const cvOn = () => !!cvParts.home;
// a new module's place on the dots — while the toolbar's Snap is on (U16: off, where it was put, in whole px)
const cvDot = v => { const W = cvW(); return W && typeof W.snapOn === 'function' && !W.snapOn() ? Math.round(v) : Math.round(v / cvWorld.DOT) * cvWorld.DOT; };
function initModules() {
  const home = $('#cvParts'), root = $('#world');
  if (!home || !root) return;
  Object.assign(cvParts, { home, root, inst: $('#inst'), fx: $('#fxrack'), scope: $('.scope'), about: $('.about') });
  home.hidden = true;
  const tw = globalThis.__synthTest && globalThis.__synthTest.cvWorld; // (tests/canvas-sim: a scripted world)
  if (typeof tw === 'function') cvTestWorld = tw(root);
  const W = cvW();
  if (W && typeof W.on === 'function') {
    W.on('cameraend', d => cvCamQueue((d && d.cam) || W.cam));
    W.on('screen', () => monitors.sync()); // (a module went on / off screen: its live displays follow, CULL_MARGIN early)
    W.on('resize', e => cvCamResized(e)); // (the keyboard tray sized after boot, a rotation: an untouched default follows)
    W.on('mods', m => { if (cvView) cvView.setModsVisible(m); }); // (stage 2a: the toolbar ∿ — Always / On select / Never)
  }
  window.addEventListener('pagehide', cvCamFlush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cvCamFlush(); });
  initModLayer(); // (stage 2a)
}
// a module's live displays run: the CANVAS view is up, the module is on screen (cv-world's plan, 256 px early) and not
// folded (Z1: nothing changes look — only off-screen work pauses). Without the canvas DOM: today's tabs (the FX rack
// exists only while its tab shows)
function cvLive(key) {
  if (!cvView) return key === curOf(trk()) ? !$('#tab-inst').hidden : true;
  return !$('#tab-inst').hidden && cvView.live(key);
}
// the keys whose bodies are today's parts: the primary's (#inst) and its FX's (#fxrack: a Serum's own 'iN/fx', a classic
// primary's panel)
function cvHomeKeys(t) { const f = t && t.dev ? CMOD.fxDevOf(t) : null; return { inst: t && t.dev ? CMOD.primId(t) : cvModule.ID.inst, fx: f ? (f.own ? f.id + '/fx' : f.id) : null }; }
const kindOfKey = (t, key) => {
  const d = t && t.dev ? t.dev[key] : null;
  if (key === 'wheel' ? CMOD.hasWheel(project) : !!d && cvModule.MOD_ORDER.includes(d.kind)) return 'mod'; // (stage 2a: a modulator)
  return /\/fx$/.test(key) || (d && d.kind === 'panel') ? 'fx' : d && d.kind === 'out' ? 'out' : d && d.kind === 'synth' ? 'inst' : null;
};
// the element device `key` of t renders into (its module body holds it)
function cvBodyEl(t, key) {
  const P = cvParts, H = cvHomeKeys(t), kind = kindOfKey(t, key);
  if (kind === 'out') return P.scope;
  if (key === H.inst) return P.inst;
  if (key === H.fx) return P.fx;
  const k = t.id + '/' + key;
  let el = cvEls.get(k);
  if (!el) {
    el = h('section', kind === 'fx' ? 'fxtab' : 'inst');
    el.setAttribute('aria-label', kind === 'fx' ? 'Effects rack' : 'Instrument panel');
    cvEls.set(k, el);
  }
  return el;
}
// host.bodies.mount: the device's element into its module body; its panel built after the sync when it is not yet (cvDue).
// A press in an instrument's body makes it the current one (setCur)
function cvMountBody(key, b) {
  if (kindOfKey(trk(), key) === 'mod') { modMount(key, b); return; } // (stage 2a: a modulator's body, cv-mods-ui)
  const t = trk(), kind = kindOfKey(t, key), el = cvBodyEl(t, key);
  if (kind === 'out') b.classList.add('cv-out');
  b.append(el);
  cvMounted.set(key, { el, tid: t.id });
  if (kind === 'inst') b.addEventListener('pointerdown', () => { const x = trk(); if (cvView && cvView.trackId === x.id) setCur(x, key); }, { passive: true });
  if (kind !== 'out' && cvBuilt.get(t.id + '/' + key) !== el) cvDue.add(key);
}
// host.bodies.unmount: the module went (removed, its kind changed, the view rebuilt): today's parts go home (their panels
// stay until the next render, as before); a device's own element takes its panel with it — except while the same track's
// view is rebuilt (cvKeep: the primary or its FX changed, U4): it waits there, detached, for its new module (cvKept)
let cvKeep = null; // key → {el, tid}: the device elements a sig rebuild set aside
function cvUnmountBody(key) {
  if (modUnmount(key)) return;
  const M = cvMounted.get(key);
  cvMounted.delete(key); cvDue.delete(key);
  if (!M) return;
  const P = cvParts, el = M.el;
  if (el === P.inst || el === P.fx || el === P.scope) { if (P.home) P.home.append(el); return; }
  if (cvKeep) { cvKeep.set(key, M); if (typeof el.remove === 'function') el.remove(); return; }
  cvDropBody(key, M);
}
function cvDropBody(key, M) { // a device's own element and its panel go
  const el = M.el, k = M.tid + '/' + key;
  if (cvEls.get(k) === el) cvEls.delete(k);
  if (cvBuilt.get(k) === el) cvBuilt.delete(k);
  const C = classicPanels.get(k), R = serumPanels.get(k), F = fxPanels.get(k);
  if (C && C.root === el) { C.destroy(); classicPanels.delete(k); }
  if (R && R.el === el) { sxDrop(R); serumPanels.delete(k); }
  if (F && F.el === el) { fxDrop(F); fxPanels.delete(k); }
  if (typeof el.remove === 'function') el.remove();
}
// the bodies mounted without their panel: built now (not while a track switch mounts them over frames) → any built
function cvBodiesDue() {
  if (!cvDue.size || cvHold || cvMount || !cvView) return false;
  const t = trk(), due = [...cvDue], was = cvBusy;
  cvDue.clear();
  cvBusy = true;
  try { for (const k of due) { const kind = kindOfKey(t, k); if (kind === 'inst') renderPanel(t, k); else if (kind === 'fx') renderFxTab(t, k); } } finally { cvBusy = was; }
  return true;
}
function cvRender() {
  if (!cvOn()) return;
  const t = trk(), key = project.uid + '/' + t.id, W = cvW(), H = cvHomeKeys(t), sig = H.inst + '|' + H.fx;
  if (cvView && cvViewKey === key && cvViewSig === sig) { cvView.sync(t); cvRoom(false); }
  else {
    // a new track (its camera), or the primary / its FX changed (#inst / #fxrack move to their new modules: a rebuild)
    const same = !!cvView && cvViewKey === key;
    if (!same) cvCamFlush(); // the outgoing track's camera first
    // the same track (a sig change): the device bodies that keep their element survive the rebuild (U4: only the ones
    // that change home — the new primary / FX in #inst / #fxrack, the old ones in elements of their own — are built)
    if (same) cvKeep = new Map();
    if (cvView) { try { cvView.destroy(); } finally { if (!same) cvKeep = null; } cvView = null; }
    if (W && typeof W.clear === 'function') W.clear();
    for (const k of [...cvChips.keys()]) if (!k.startsWith(t.id + '/')) cvChips.delete(k);
    cvViewKey = key; cvViewSig = sig;
    try { cvView = cvModule.createTrackView(W, t, cvHost()); }
    finally { const K = cvKeep; cvKeep = null; if (K) for (const [k, M] of K) { const N = cvMounted.get(k); if (!N || N.el !== M.el) cvDropBody(k, M); } }
    // (stage 1f: the audio cables are read-only — host.patch false —; stage 2a: the jack hook drags mod cables onto knobs)
    modDrag = cvView.cableDrag(modDragOpts);
    cvRoom(true);
    if (!same) cvCamRestore(t);
    monitors.sync();
  }
  if (cvBodiesDue() && cvView) { cvView.sync(trk()); cvRoom(false); }
  cvModDecor();
}
// an instrument's size — always fixed, nothing is resizable (the user's rule, 2026-10-18): a classic one in its Hardware
// layout its panel's (cv-panel sizeOf), in its Simple layout (or a model whose panel is not drawn yet) its model's
// width (cvModule.FLOW_W: everything fits; the height measured), a Serum W_SERUM
function cvInstSize(t, dev = curOf(t)) {
  const m = modelById(instView(t, dev).model), L = m.custom || instUi(t, dev) === 'flow' ? null : hwLayoutOf(m);
  return { fixed: L ? cvPanel.sizeOf(L, m) : { w: cvModule.defaultW(cvModule.ID.inst, m.id) } };
}
// a fixed-size instrument makes room (IMPL-panels §7.3): the modules right of it that it now overlaps move right
// together (cvModule.makeRoom) — after a build (a load, a track switch: stage-1b layouts, whose FX / OUT sit where a
// 1080 px panel ended) or a size change (the layout toggle, a replace). Written to track.lay without a step of its own:
// inside the toggle's / replace's step, else a view normalisation (like a z write). Stage 1e: every instrument, the
// primary first
let cvRoomSig = '';
function cvRoom(built) {
  if (!cvView) return;
  const t = trk(), ins = CMOD.instIds(t).map(k => [k, cvView.modules.get(k)]).filter(([, m]) => m && m.fixed);
  if (!ins.length) { cvRoomSig = ''; return; }
  const sig = cvView.trackId + ':' + ins.map(([k, m]) => k + '=' + m.w + 'x' + (m.fixed.h || 0)).join(',');
  if (!built && sig === cvRoomSig) return;
  cvRoomSig = sig;
  let moved = false;
  for (const [K, m] of ins) {
    const rects = {};
    for (const [k, mm] of cvView.modules) rects[k] = mm.rect();
    const mv = cvModule.makeRoom(rects, K);
    if (!mv) continue;
    const old = t.lay && typeof t.lay === 'object' ? t.lay : {};
    for (const k of Object.keys(mv)) {
      const mm = cvView.modules.get(k), o = old[k] || {}, e = { x: mv[k].x, y: mv[k].y };
      if (mm && mm.fold) e.fold = 1;
      if (o.z != null) e.z = o.z;
      if (o.ui === 'flow') e.ui = 'flow';
      cvLay(k, e, 'end', 'room');
      if (mm) mm.setPos(e.x, e.y, false);
    }
    // the instrument pinned too (a Tidy-placed one would re-tidy from the new widths)
    if (!old[K]) { const e = { x: Math.round(m.x), y: Math.round(m.y) }; if (m.fold) e.fold = 1; cvLay(K, e, 'end', 'pin'); }
    moved = true;
  }
  if (moved) cvView.sync(trk());
}
// the ⋯ menu's layout items: Hardware (the real front panel) or Simple (today's flowing panel; both fixed sizes);
// one History step; values, presets and the 303 pattern live in the track, so every control comes back as it was
// track.lay.<dev>.ui without a step of its own (the caller's): the instrument's entry from the module's place when it has none
function layUi(t, ui, dev = curOf(t)) {
  const K = dev, lay = Object.assign({}, t.lay && typeof t.lay === 'object' ? t.lay : {}), m = cvView && cvView.trackId === t.id ? cvView.modules.get(K) : null;
  const e = lay[K] ? Object.assign({}, lay[K]) : m ? { x: Math.round(m.x), y: Math.round(m.y) } : { x: 0, y: 0 };
  if (ui === 'flow') e.ui = 'flow'; else delete e.ui;
  lay[K] = e;
  t.lay = lay;
}
function cvSetLayout(want, dev) {
  const t = trk(), K = dev || curOf(t);
  if (isSx(instView(t, K)) || (want !== 'hw' && want !== 'flow') || instUi(t, K) === want) return;
  hist.record(project, want === 'flow' ? 'Simple layout' : 'Hardware layout');
  const lay = Object.assign({}, t.lay && typeof t.lay === 'object' ? t.lay : {}), m = cvView && cvView.modules.get(K);
  const e = lay[K] ? Object.assign({}, lay[K]) : m ? { x: Math.round(m.x), y: Math.round(m.y) } : { x: 0, y: 0 };
  if (!lay[K] && m) { if (m.fold) e.fold = 1; if (m.zSet) e.z = m.z; }
  if (want === 'flow') e.ui = 'flow'; else delete e.ui;
  lay[K] = e;
  if (cvView) for (const [k, mm] of cvView.modules) { // the pins (as cvLay's first write): Tidy-placed modules stay where they stand
    if (k === K || lay[k] || (cvOtherFx(k) && lay[cvOtherFx(k)])) continue;
    const p = { x: Math.round(mm.x), y: Math.round(mm.y) };
    if (mm.fold) p.fold = 1;
    lay[k] = p;
  }
  t.lay = lay;
  persist();
  renderPanel(t, K); // (→ cvPanelDone → cvRender → sync: the module's size follows, room is made)
  updateUndoUI();
}
function cvHost() {
  const P = cvParts;
  return {
    root: P.root, doc: document,
    devices: t => cvDevices(t),
    bodies: { mount: cvMountBody, unmount: cvUnmountBody },
    // (stage 2a) the project wheel and the preset rows for the mod cables, their visibility (the toolbar ∿), the badges' taps
    project: () => project, presetRows: true, mods: (W => (W && typeof W.modsMode === 'function' ? W.modsMode() : undefined))(cvW()),
    cables: { onSelect: modCableSel, onAction: modCableAct, menu: modCableMenu, onHint: txt => notice(txt, 6000) },
    title: cvTitle,
    menu: cvMenu,
    size: key => { const t = trk(); return CMOD.instOf(t, key) ? cvInstSize(t, key) : null; },
    // (stage 1f: no ⏻, no key-zone pill — host.power / host.zone not given —, read-only cables)
    badge: key => cvBadge(key),
    patch: false,
    select: key => { const t = trk(); if (CMOD.instOf(t, key)) setCur(t, key); },
    lay: cvLay,
    shown: () => monitors.sync(),
  };
}
const cvDevName = (t, key) => { const d = t.dev && t.dev[key]; return d && d.kind === 'synth' ? d.name || modelById(d.model).name : cvTitle(key).title; };
function cvTitle(key) {
  const t = trk(), kind = kindOfKey(t, key), d = t.dev && t.dev[key];
  if (kind === 'inst') { const m = modelById(d.model); return { title: d.name || m.name, sub: t.name, chip: cvChip(t, key) }; }
  if (kind === 'mod') { const mk = modKindOfKey(t, key); return { title: CMOD.MOD_LABEL[mk] || key, sub: key === 'wheel' ? 'every track' : t.name }; }
  if (kind === 'fx') {
    const own = /\/fx$/.test(key) ? key.slice(0, -3) : null, fx = fxOfDev(t, own || key);
    if (own) { const s = t.dev[own]; return { title: 'Serum FX (own)', sub: cvCables.routeLabel(s && s.vals && s.vals.s, fx) || 'no effects' }; }
    const n = fx && Array.isArray(fx.racks) ? fx.racks.reduce((a, r) => a + (r && Array.isArray(r.mods) ? r.mods.length : 0), 0) : 0, N = CG.devNum(key);
    return { title: (d && d.name) || (N > 1 ? 'FX Panel ' + N : 'FX Panel'), sub: n ? n + (n === 1 ? ' effect' : ' effects') : 'empty' };
  }
  return { title: 'OUT', sub: 'master output' };
}
// an instrument module's chip: a classic one's ◀ preset select ▶ (the Hardware panel has no preset plate: the chip
// loads, the ⋯ menu saves / deletes / inits) / a Serum's preset name
function cvChip(t, dev = curOf(t)) {
  const v = instView(t, dev), m = modelById(v.model), ck = t.id + '/' + dev, key = ck + '/' + m.id;
  let C = cvChips.get(ck);
  if (!C || C.key !== key) {
    let el, sel;
    const here = () => { const x = instView(trk(), dev); return x.model === m.id ? x : null; };
    if (m.custom) { el = sel = h('span', 'cv-pname'); el.title = 'Preset (change it in the panel’s browser)'; }
    else {
      sel = h('select', 'cv-psel');
      sel.title = 'Preset'; sel.setAttribute('aria-label', 'Preset');
      sel.onchange = () => { const k = sel.value, x = here(); sel.value = ''; if (x) presetLoad(k, x); };
      const step = (txt, d, lab) => { const b = h('button', 'cv-pstep', txt); b.type = 'button'; b.title = lab; b.setAttribute('aria-label', lab); b.onclick = e => { e.stopPropagation(); const x = here(); if (x) presetStep(d, x); }; return b; };
      el = h('span', 'cv-pchip');
      el.append(step('◀', -1, 'Previous preset'), sel, step('▶', 1, 'Next preset'));
    }
    cvChips.set(ck, C = { key, el, sel, sig: null });
  }
  cvChipFill(t, dev);
  return C.el;
}
function cvChipFill(t, dev = curOf(t)) {
  const v = instView(t, dev), m = modelById(v.model), C = cvChips.get(t.id + '/' + dev);
  if (!C || C.key !== t.id + '/' + dev + '/' + m.id) return;
  if (m.custom) { const s = v.preset || 'Init'; if (C.el.textContent !== s) C.el.textContent = s; return; }
  const list = presetList(m), sig = list.length + ':' + v.preset;
  if (sig === C.sig) return;
  C.sig = sig;
  const sel = C.sel;
  sel.innerHTML = '';
  const o0 = h('option', null, v.preset ? v.preset : v.preset === null ? 'Custom' : '—'); o0.value = ''; sel.append(o0);
  let grp = null, gname = '';
  for (const p of list) {
    if (p.group !== gname) { grp = h('optgroup'); grp.label = p.group; gname = p.group; sel.append(grp); }
    const o = h('option', null, p.name); o.value = p.key; grp.append(o);
  }
  sel.value = '';
}
function cvChipSync() { // a preset name changed (a panel's preset UI, a Serum edit): the chips, the hardware preset displays
  const t = trk();
  if (cvView) for (const id of CMOD.instIds(t)) cvChipFill(t, id);
  for (const [k, P] of classicPanels) if (!P.dead && k.startsWith(t.id + '/')) { const u = P.ui.get('@preset'); if (u) u(); }
}
// the ⋯ menu of module `key` (cvMenu(kind, key) as stage 1b called it still works): an instrument's About / Replace,
// layouts and sound actions; Fold, Bring to front, Tidy (stage 1f: no device items — one instrument per track)
function cvMenu(a, b) {
  const key = b === undefined ? a : b, V = cvView, m = V && V.modules.get(key);
  if (!m) return [];
  const t = trk(), kind = kindOfKey(t, key);
  const fold = { label: m.fold ? 'Unfold' : 'Fold', action: () => V.toggleFold(key) };
  const front = { label: 'Bring to front', action: () => V.front(key) };
  const tidyI = { label: 'Tidy the canvas', action: () => cvTidy() };
  if (kind === 'inst') {
    const v = instView(t, key), mdl = modelById(v.model), here = fn => () => { setCur(trk(), key); fn(); };
    const head = [{ label: 'About the ' + mdl.name + '…', action: here(cvAbout) }, { label: 'Replace with…', action: here(() => cvOpenSources('replace')) }];
    if (mdl.custom) return [...head, { label: 'Modulation list…', action: () => modList() }, { sep: true }, fold, front, { sep: true }, tidyI]; // (Serum: its own browser saves; 2a: its mod rows)
    // a classic synth: its real front panel (default) or today's simple panel; the sound actions of its preset plate
    const u = instUi(t, key), hw = !!hwLayoutOf(mdl);
    return [...head, { sep: true },
      { label: hw ? 'Hardware layout' : 'Hardware layout (not drawn yet)', checked: u === 'hw', action: () => cvSetLayout('hw', key) },
      { label: 'Simple layout', checked: u === 'flow', action: () => cvSetLayout('flow', key) },
      { sep: true },
      { label: 'Save sound…', action: () => presetSave(v) }, { label: 'Delete saved sound', action: () => presetDelete(v), disabled: !presetSaved(v) }, { label: 'Init sound', action: () => presetInit(v) },
      { sep: true }, fold, front, { sep: true }, tidyI];
  }
  if (kind === 'mod') return [{ label: 'Delete', action: () => modDelete(key) }, { label: 'Modulation list…', action: () => modList() }, { sep: true }, fold, front, { sep: true }, tidyI];
  return kind === 'fx' ? [fold, front, { sep: true }, tidyI] : [fold];
}
// the FX key whose lay entry stands for `key`'s (stage 1b: fx1 ↔ i1/fx across a classic ↔ Serum change) — null while both
// are modules of the shown view (1e: a Serum primary's own FX beside a shared panel fx1 — each keeps its own place)
function cvOtherFx(key) {
  const ID = cvModule.ID, o = key === ID.fx ? ID.sxFx : key === ID.sxFx ? ID.fx : null;
  return o && !(cvView && cvView.modules.has(o)) ? o : null;
}
// track.lay writes (cv-module host.lay): 'start' opens the undo step, 'end' writes the entry (alone: bring to front, pins,
// no step). The step is recorded at that 'end', just before the write and only when the layout really changes: a drop on
// the cell it left or a cancelled drag (Escape, a second finger) records nothing, so the redo stack survives
let cvLayPend = null; // {key, what, label, was}: the move / fold 'start' opened (was: the track's lay as JSON)
function cvLay(key, entry, phase, what) {
  if (phase === 'start') {
    const m = cvView && cvView.modules.get(key), verb = what === 'fold' ? 'Fold' : 'Move';
    cvLayPend = { key, what, label: verb + ' ' + (m ? m.title : key), was: JSON.stringify(trk().lay || null) };
    return;
  }
  if (phase === 'cancel') { if (cvLayPend && cvLayPend.key === key) cvLayPend = null; return; }
  if (phase !== 'end' || !entry) return;
  const t = trk(), p = cvLayPend && cvLayPend.key === key && cvLayPend.what === what ? cvLayPend : null;
  if (p) {
    cvLayPend = null;
    const nx = cvOtherFx(key);
    const next = Object.assign({}, t.lay && typeof t.lay === 'object' ? t.lay : {}, { [key]: entry });
    if (nx) delete next[nx];
    if (JSON.stringify(next) === p.was) return; // (nothing moved: no step, no write)
    hist.record(project, p.label); updateUndoUI();
  }
  if (!t.lay || typeof t.lay !== 'object') t.lay = {};
  t.lay[key] = entry;
  // one FX entry at most (fx1 | i1/fx): layOf's fallback then carries the place across a classic ↔ Serum change, never a
  // stale one from before (in the step 'start' opened; an entry here holds x, y, fold and z, so nothing is lost) — unless
  // the other is a module of its own (1e: a Serum primary's i1/fx beside a shared panel fx1: cvOtherFx)
  const ox = cvOtherFx(key);
  if (ox) delete t.lay[ox];
  persist(); updateUndoUI();
}
// About: the current instrument's text and the DX7 algorithm diagram (.about, kept by reference) in a sheet
function cvAbout() {
  const a = cvParts.about;
  if (!a) return;
  aboutUI(model); drawAlgo();
  const title = $('#about-title').textContent || model.name, back = () => { if (cvParts.home) cvParts.home.append(a); };
  try { if (cvTray.sheet({ title, body: a, layer: $('#ov') || document.body, onClose: back })) return; } catch (err) { /* the SHELL lane's sheet not in yet */ }
  const wrap = h('div', 'cv-lite'), dlg = h('div', 'cv-lite-dlg'), x = h('button', 'cv-lite-x', '✕');
  dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-label', title);
  x.type = 'button'; x.setAttribute('aria-label', 'Close');
  const close = () => { wrap.remove(); back(); };
  x.onclick = close; wrap.onclick = e => { if (e.target === wrap) close(); };
  dlg.append(x, a); wrap.append(dlg); ($('#ov') || document.body).append(wrap);
}
// the camera: saved 500 ms after a move ends (one LRU record), restored on a track switch / load, else the default: the
// primary instrument's top-left 24 px inside the visible band, at k = 1 when its whole width fits there (its FX module
// beside it too when both fit at an editable zoom), else at the k that fits its width — its bar's chip, ⋯ and ▾ clear the
// rails (portrait) — never below READ_K. While ROLL shows the band has no size: the default is owed (cvCamDef) and
// computed when CANVAS opens (openTab)
let cvCamLast = null; // {key, cam}: the camera last restored or saved (an unchanged camera writes nothing)
let cvCamDef = null; // the camKey whose default camera is owed (computed while the canvas was hidden)
const camSame = (a, b) => !!a && !!b && Math.abs(a.tx - b.tx) < 0.5 && Math.abs(a.ty - b.ty) < 0.5 && Math.abs(a.k - b.k) < 1e-4;
function cvCamQueue(cam) {
  if (!cam || !cvView) return;
  const key = CM.camKey(project.uid, cvView.trackId);
  if (cvCamLast && cvCamLast.key === key && camSame(cvCamLast.cam, cam)) { clearTimeout(cvCamT); cvCamT = 0; cvCamPend = null; return; }
  cvCamPend = { key, cam: { tx: cam.tx, ty: cam.ty, k: cam.k } };
  clearTimeout(cvCamT); cvCamT = setTimeout(cvCamFlush, 500);
}
function cvCamFlush() {
  clearTimeout(cvCamT); cvCamT = 0;
  const p = cvCamPend;
  cvCamPend = null;
  if (!p) return;
  store.set(cvModule.CAM_PREF, cvModule.camPut(store.get(cvModule.CAM_PREF, null), p.key, p.cam));
  cvCamLast = p;
}
// the canvas changed size (U14: the keyboard tray sized after the boot's camera, a rotation): a camera still at its untouched
// default (none stored for the track, the camera where the default put it) is derived again — no bar under the toolbar.
// (1g) A moved top / left edge (the top tray's grip: "dragging the track tray down should not move the canvas") was kept
// still by the world (e.dx / e.dy): an untouched default stays untouched (shifted with it) and is derived again only when
// the width changed too (a rotation)
function cvCamResized(e) {
  const W = cvW();
  if (!cvView || !W || $('#tab-inst').hidden) return;
  const key = CM.camKey(project.uid, cvView.trackId), mv = !!e && !!(e.dx || e.dy);
  if (mv && cvCamLast && cvCamLast.key === key && !cvCamPend) {
    const c = cvCamLast.cam, s = { tx: c.tx - e.dx, ty: c.ty - e.dy, k: c.k };
    if (camSame(s, W.cam)) cvCamLast = { key, cam: s };
  }
  if (mv && !e.dw) return;
  if (!cvCamLast || cvCamLast.key !== key || cvCamPend || !camSame(cvCamLast.cam, W.cam) || cvModule.camGet(store.get(cvModule.CAM_PREF, null), key)) return;
  cvCamRestore(trk());
}
function cvCamRestore(t) {
  const W = cvW();
  if (!W || !cvView || typeof W.setCamera !== 'function') return;
  const key = CM.camKey(project.uid, t.id), c = cvModule.camGet(store.get(cvModule.CAM_PREF, null), key);
  if (c) { cvCamDef = null; cvCamLast = { key, cam: c }; W.setCamera(c, { animate: false }); return; }
  const H = cvHomeKeys(t), m = cvView.modules.get(H.inst);
  if (!m) return;
  const b = W.band();
  if ($('#tab-inst').hidden || !(b.right > b.left && b.bottom > b.top)) { cvCamDef = key; return; } // (ROLL: a 0 × 0 viewport)
  cvCamDef = null;
  const o = W.toClient(0, 0), cam = W.cam, r = m.rect(), P = 24, bw = b.right - b.left - 2 * P;
  // (U3) the left edge framed is the key-zone pill's (outside the instruments' left edge: Tidy stacks them at one x), so it
  // never sits under the rail; the instrument alone fits with it (its bar's ⋯ / ▾ stay inside the band)
  const x0 = r.x - Math.max(0, ...CMOD.instIds(t).map(id => { const q = cvView.modules.get(id); return q && Math.abs(q.x - r.x) < 1 ? q.zoneW || 0 : 0; }));
  const fm = H.fx && cvView.modules.get(H.fx), f = fm && fm.rect();
  const kAll = f ? bw / Math.max(1, f.x + f.w - r.x) : 0; // the instrument and the FX module side by side
  let k = kAll >= cvWorld.EDIT_K ? Math.min(1, kAll) : Math.max(cvWorld.READ_K, Math.min(1, bw / Math.max(1, r.x + r.w - x0)));
  const ox = o.x - cam.tx, oy = o.y - cam.ty, camAt = kk => ({ k: kk, tx: Math.round(b.left - ox + P - x0 * kk), ty: Math.round(b.top - oy + P - r.y * kk) });
  // no module's top bar (nor an instrument's key-zone pill under it) under the floating toolbar or the minimap (U14:
  // world.reserved, client px): a lower k, never below READ_K, lifts a stacked instrument's bar above them
  const R = typeof W.reserved === 'function' ? W.reserved() || [] : [], BH = cvModule.BAR_H, ZH = 74; // (the pill: 26 px, 48 px down)
  for (let i = 0; i < 8 && R.length; i++) {
    const c = camAt(k);
    let want = k;
    for (const mm of cvView.modules.values()) {
      const q = mm.rect(), zw = mm.zoneW || 0, hh = zw ? ZH : BH, L = ox + c.tx + (q.x - zw) * k, T = oy + c.ty + q.y * k, Rr = ox + c.tx + (q.x + q.w) * k, Bb = T + hh * k;
      for (const z of R) if (L < z.right && z.left < Rr && T < z.bottom && z.top < Bb && q.y + hh > r.y) want = Math.min(want, (z.top - 8 - b.top - P) / (q.y - r.y + hh));
    }
    if (!(want < k) || want < cvWorld.READ_K) break;
    k = want;
  }
  const d = camAt(k);
  cvCamLast = { key, cam: d }; // (the default is not stored until the user moves away from it)
  W.setCamera(d, { animate: false });
}
// Serum panel ↔ its own FX module: both edit the same FX (and Serum state); an edit in one refreshes the other on the next
// frame (never the one that made it). A peer that is not showing its body is refreshed when it shows again
// (monitors.sync). Stage 1e: per Serum instrument (dev): bit 1 its panel, bit 2 its own FX module
let peerT = 0;
const peerQ = new Map(), peerStale = new Map(); // panel record → its module key
function peerRefresh(id, bit, dev) {
  if (!cvView) return;
  const t = project.tracks.find(x => x.id === id), d = dev || (t ? CMOD.primId(t) : null);
  const rec = !d || !t ? null : bit === 1 ? sxRecOf(id, d) : fxRecOf(id, d + '/fx'), key = bit === 1 ? d : d + '/fx';
  if (!rec || !rec.ui || rec.trackId !== id) { if (cvView.trackId === id) cvRelabel(); return; }
  peerQ.set(rec, key);
  if (!peerT) peerT = requestAnimationFrame(peerRun);
}
function peerRun() {
  peerT = 0;
  const q = new Map([...peerStale, ...peerQ]);
  peerQ.clear(); peerStale.clear();
  for (const [rec, key] of q) if (rec.ui) { if (cvLive(key)) rec.ui.refresh(); else peerStale.set(rec, key); }
  cvRelabel();
}
let cvRelT = 0;
function cvRelabel() { // titles, chips, badges and the Serum's route label after an edit (coalesced)
  if (cvRelT || !cvView) return;
  cvRelT = requestAnimationFrame(() => { cvRelT = 0; if (cvView && cvView.trackId === trk().id) cvView.refresh(trk()); });
}
// a synth dropped anywhere on the canvas (stage 1f: one instrument per track again), ⋯ → Replace with… or a tap in the
// Sources tray's replace mode: replaces the instrument (v: its device view; default the current one = the primary) in
// place (SPEC §2.7), one History step, an undo notice
function cvDropInstrument(modelId, at, o = null, v0 = null) {
  const t = trk(), v = v0 || curView(t), dev = dvOf(v) || CMOD.primId(t), m = MODELS.find(x => x.id === modelId);
  if (!m || m.id === v.model) return false;
  const old = modelById(v.model), id = t.id;
  setTrackModel(v, m.id, o); // (renderPanel → cvPanelDone: the FX module and the titles follow)
  // the step the replacement left on top of History (or the equal one it kept): the tap undoes it only while it is still
  // the newest — after a later step (a move, a knob, a note) the old instrument comes back as a step of its own instead,
  // never undoing that later edit (an undo / redo makes a new entry object: the safe branch too)
  const step = hist.u[hist.u.length - 1];
  cvUndoNotice(`Replaced ${old.name} with ${m.name} · tap to undo`, step, () => {
    const tr = project.tracks.find(x => x.id === id), d = tr && CMOD.instOf(tr, dev);
    return d && d.model === m.id ? () => setTrackModel(instView(tr, dev), old.id) : null; // (null: already undone, or replaced again)
  });
  return true;
}
// a notice whose tap undoes `step` while it is the newest History step, else runs what alt() gives (null: nothing left)
function cvUndoNotice(msg, step, alt, ms = 8000) {
  noticeActs.set(msg, () => {
    noticeActs.delete(msg); notice('', 0);
    const f = alt();
    if (!f) return;
    if (hist.u[hist.u.length - 1] === step) undo(); else f();
  });
  notice(msg, ms);
}
function cvReveal(trackId, key = null) {
  if (project.tracks.some(t => t.id === trackId)) selectTrack(trackId);
  const roll = $('#tab-roll');
  if (roll && !roll.hidden) openTab('canvas');
  const W = cvW(), k = key || cvHomeKeys(trk()).inst;
  if (W && cvView && cvView.modules.has(k) && typeof W.focusItem === 'function') W.focusItem(k, { k: W.k < cvWorld.READ_K ? 1 : W.k, edit: false });
}
// the Sources drop outline of `modelId`: its hardware size while the tray's switch is on Hardware (a drop replaces it in
// place, in that layout), else the Simple size measured on this device (or its fixed width and a guessed height)
function cvModuleSize(modelId) {
  const mdl = MODELS.find(x => x.id === modelId), L = mdl ? hwLayoutOf(mdl) : null, t = trk(), cur = curOf(t);
  if (L && srcUi(modelId) === 'hw') return cvPanel.sizeOf(L, mdl);
  const m = cvView && cvView.modules.get(cur);
  if (m && instView(t, cur).model === modelId && !(m.fixed && m.fixed.h) && !m.fold) { const r = m.rect(); if (r.h > cvModule.BAR_H * 3) cvSeen.set(modelId, { w: r.w, h: r.h }); }
  return cvSeen.get(modelId) || cvModule.sizeFor(modelId);
}
function cvTidy() {
  const t = trk();
  if (!cvView) return;
  const td = cvModule.tidy(t, cvView.sizes(), cvView.devices()), old = t.lay && typeof t.lay === 'object' ? t.lay : {}, lay = Object.assign({}, old);
  const other = cvOtherFx;
  for (const k in td) {
    const e = { x: td[k].x, y: td[k].y }, ox = other(k), o = old[k] || (ox && old[ox]); // (the FX fold through a model change)
    if (o && o.fold) e.fold = 1;
    if (old[k] && old[k].ui === 'flow') e.ui = 'flow'; // (the instrument's layout choice stays: Tidy only moves modules, never a size)
    lay[k] = e;
    if (ox) delete lay[ox]; // one FX entry at most (cvLay)
  }
  // already tidy: no step (a recorded no-op would still drop the redo stack); cvModule.tidy is pure, so the step is
  // taken here, before the write
  if (t.lay && typeof t.lay === 'object' && JSON.stringify(lay) === JSON.stringify(t.lay)) { cvView.sync(t); return; }
  hist.record(project, 'Tidy'); updateUndoUI();
  t.lay = lay;
  persist();
  cvView.sync(t);
}

/* ---------------------------------------------- cv DEVICES (stage 1e, IMPL-1e §4.5; 1f: hooks and the Effects tray) */
// Stage 1f (the user's iPad report: five hardware panels on one canvas lag): one instrument per track in the UI again. The
// engine graph, the model's editing API and per-device records stay (milestone 3); what is left here: the test hooks
// (__synthTest.cv add / power / zone: a host-level several-instrument track for the graph tests) and the Effects tray.
// After every edit of the track's devices: the patch (a graph shape: {t: 'graph'} + its parts), the view, the track rows
function cvAfter(t) {
  queuePatch(t);
  if (t === trk()) { bind(); cpSync(); renderNav(); }
  cvRender(); renderHeads(); persist(); updateUndoUI();
}
// the modules Tidy still places, pinned where they stand (a device added beside them must not re-tidy them: they would
// jump), as a copy of track.lay for the edit's step to write
function cvPinned(t) {
  const lay = Object.assign({}, t.lay && typeof t.lay === 'object' ? t.lay : {});
  if (cvView && cvView.trackId === t.id) for (const [k, m] of cvView.modules) if (!lay[k]) { const e = { x: Math.round(m.x), y: Math.round(m.y) }; if (m.fold) e.fold = 1; lay[k] = e; }
  return lay;
}
// the device-speed factor (⚙ → Measure this device; 1 = the reference machine) in the device prefs
const DEV_FACTOR = 'synth.' + COSTM.PREF;
const devFactor = () => { const f = +store.get(DEV_FACTOR, 0); return Number.isFinite(f) && f > 0 ? f : 1; };
// (hook __synthTest.cv.add: no UI adds an instrument since 1f) a new instrument at `at` (else where Tidy puts it),
// auto-patched (cv-model addInst: to the panel most instruments share, else OUT), one History step, the notice "Added
// Juno-60 · tap to undo". The soft caps of §9.2 (cv-cost softCap, touch devices) are kept: a second heavy Serum asks
// first, the 4th instrument warns in the notice
function cvAddInstrument(modelId, at, o = null) {
  const t = trk(), m = MODELS.find(x => x.id === modelId);
  if (!m || !t.dev) return null;
  if (CMOD.instIds(t).length >= CG.LIMITS.inst) { notice(`At most ${CG.LIMITS.inst} instruments per track`, 4000); return null; }
  const vals = loadVals(m), cap = COSTM.softCap(t, { kind: 'synth', model: m.id, vals }, { touch: touchDev, factor: devFactor() });
  if (cap.confirm && !confirm(cap.confirm)) return null;
  flush();
  hist.record(project, 'Add ' + m.name);
  const lay = cvPinned(t), ui = o && o.ui === 'flow' && !m.custom ? 'flow' : null;
  const id = CMOD.addInst(t, m.id, { vals, fx: m.custom ? newFx(m) : undefined });
  if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) lay[id] = Object.assign({ x: cvDot(at.x), y: cvDot(at.y) }, ui ? { ui } : null);
  else if (ui) lay[id] = { x: 0, y: 0, ui };
  t.lay = lay;
  seedPend.add(t.id);
  sendPatch(t);
  if (m.id === 'tb303') seqSend(t, id);
  cvAfter(t);
  const step = hist.u[hist.u.length - 1], tid = t.id;
  cvUndoNotice((cap.warn ? cap.warn + ' · ' : '') + `Added ${m.name} · tap to undo`, step, () => {
    const tr = project.tracks.find(x => x.id === tid);
    return tr && CMOD.instOf(tr, id) && CMOD.instIds(tr).length > 1 ? () => cvDeleteInst(tr, id) : null;
  }, cap.warn ? 12000 : 8000);
  return id;
}
function cvDeleteInst(t, key) { // (the add's notice once a later step was taken: the instrument goes as a step of its own)
  hist.record(project, 'Delete ' + cvDevName(t, key));
  seqToggle(t, false, true, key);
  CMOD.removeInst(t, key);
  cvAfter(t);
}
// (hook __synthTest.cv.power) power: off — no notes, its sequencer stops, its voices fade (the engine's {t: 'power'});
// settings and controller state kept. One History step
function cvPower(key, on) {
  const t = trk(), d = CMOD.instOf(t, key);
  if (!d || (d.on !== false) === !!on) { if (cvView) cvView.refresh(t); return; }
  hist.record(project, (on ? 'Power on ' : 'Power off ') + cvDevName(t, key));
  CMOD.setPower(t, key, !!on);
  cvAfter(t);
}
// (hook __synthTest.cv.zone) a key zone: edits of one instrument's zone within 2 s are one History step
let cvZoneLast = null;
function cvZone(key, z) {
  const t = trk();
  if (!CMOD.instOf(t, key)) return;
  const now = performance.now(), L = cvZoneLast;
  if (!(L && L.key === key && L.tid === t.id && now - L.t < 2000 && hist.u[hist.u.length - 1] === L.step)) hist.record(project, 'Key zone of ' + cvDevName(t, key));
  CMOD.setZone(t, key, z);
  cvZoneLast = { key, tid: t.id, t: now, step: hist.u[hist.u.length - 1] };
  cvAfter(t);
}
// the badge on an instrument's bar: the CPU safeguard's cap (capsOf: 'OS 4→2' | 'Qn' | null) — 1f: nothing else (a
// track's one instrument is cabled to OUT: no "not connected")
// (stage 2a) a Serum with canvas mod rows: "mods n/64" (modCount) in its place
function cvBadge(key) { const t = trk(); if (!CMOD.instOf(t, key)) return null; const m = modCount(t, key); return m ? m.text : capsOf(t, key); }
// Effects tray (SPEC §2.4, §2.8): fx-ui's addMenuItems list — the rack's "+" menu: the 13 effects alphabetically, then the
// 3 splitters — read from serum-core's FXTYPES (the same list, before fx-ui loads with the first rack)
const FX_ITEMS = (() => {
  const L = Array.isArray(core.FXTYPES) ? core.FXTYPES : [];
  return [...L.filter(x => !x.split).sort((a, b) => (a.id < b.id ? -1 : 1)), ...L.filter(x => x.split)].map(x => ({ type: x.id, label: x.label, group: x.split ? 'Splitters' : 'Effects' }));
})();
const fxName = type => (FX_ITEMS.find(x => x.type === type) || { label: type }).label;
// a new instance of `type` at the end of a v2 FX state's Main rack, selected (fx-ui addInst's edit) → its id | null
function fxAddInst(fx, type) {
  const nid = core.newInstance(fx, type, { rack: 0 });
  if (nid) { fx.ui = fx.ui && typeof fx.ui === 'object' ? fx.ui : {}; fx.ui.sel = nid; }
  return nid;
}
// an effect tile into a panel module (or a Serum's own FX): the instance at the end of its Main rack as the rack's "+"
// menu adds it — an FX edit, so the knob-tweak policy holds (§11.8: FX rack edits are not History steps; its ⋯ removes it)
function cvAddEffect(t, key, type) {
  const own = /\/fx$/.test(key) ? key.slice(0, -3) : null, dev = own || key;
  if (kindOfKey(t, key) !== 'fx') return null;
  let nid = null;
  fxEditDev(t, dev, fx => { nid = fxAddInst(fx, type); }, { seed: true });
  if (!nid) { notice('No room for another module here', 3500); return null; }
  const r = fxRecOf(t.id, key);
  if (r && r.ui) r.ui.refresh();
  if (own) peerRefresh(t.id, 1, own);
  cvRelabel();
  notice(`Added ${fxName(type)} to ${cvTitle(key).title}`, 3500);
  return nid;
}
// the module under a tray drag's pointer (any part of it) → {key, kind} | null
function cvModUnder(el) {
  for (let n = el, i = 0; n && i < 64 && typeof n.getAttribute === 'function'; n = n.parentNode, i++) {
    const k = n.getAttribute('data-cv-mod');
    if (k != null) return cvView && cvView.modules.has(k) ? { key: k, kind: n.getAttribute('data-cv-kind') } : null;
  }
  return null;
}
// the module under an Effects drag: an FX module (into its rack), an instrument (U11: into its FX), else empty canvas
function fxOver(target) {
  if (srcOver(target) !== 'canvas') return null;
  const M = cvModUnder(target);
  return M && M.kind === 'fx' ? { over: 'panel', key: M.key } : M && M.kind === 'inst' ? { over: 'inst', key: M.key } : 'canvas';
}
// an effect into instrument dev's FX (its panel, a Serum's own). Since 1f a classic instrument always feeds a panel (the
// split gives one cabled straight into OUT an empty panel; no UI removes it): without one (a hook-made shape) nothing
function fxInto(t, dev, id) {
  const d = t.dev[dev], k = d && d.model === 'serum' ? dev + '/fx' : CMOD.destOf(t, dev);
  return k && kindOfKey(t, k) === 'fx' ? cvAddEffect(t, k, id) : null;
}
// a tap on an Effects tile: the effect goes into the track's FX
function fxPick(id) { const t = trk(); fxInto(t, curOf(t), id); }
// the module an Effects drop goes into: a panel module or an instrument under the pointer (its FX), else (empty canvas)
// the track's FX module — its panel, a Serum's own FX
function fxTarget(t, i) {
  if ((i.over === 'panel' || i.over === 'inst') && i.key && cvView && cvView.modules.has(i.key)) return i.key;
  return i.over === 'canvas' || i.over === 'panel' || i.over === 'inst' ? cvHomeKeys(t).fx || CMOD.primId(t) : null;
}
// an Effects tile dragged out (stage 1f: a drop anywhere on the canvas goes into the track's FX): the outline on the module
// it goes into (pinned there: no edge pan), the toolbar and the minimap aside for the whole drag (U14)
const fxDrag = {
  move(id, i) {
    const W = cvW(), t = trk(), k = fxTarget(t, i), M = k && cvView ? cvView.modules.get(k) : null;
    if (!W || typeof W.ghost !== 'function') return;
    if (!M) { W.ghost(null); return; }
    const r = M.rect(), c = W.toClient(r.x, r.y);
    W.ghost({ x: c.x, y: c.y, w: r.w, h: r.h, dx: 0, dy: 0, snap: false, label: fxName(id) + ' → ' + M.title });
  },
  begin(id, i) { if (world) world.setDragging(true); fxDrag.move(id, i); },
  end() { const W = cvW(); if (W && typeof W.ghost === 'function') W.ghost(null); if (world) { world.dragPointer(null); world.setDragging(false); } },
  drop(id, i) {
    fxDrag.end();
    const t = trk(), k = fxTarget(t, i);
    if (!k) return false;
    if (kindOfKey(t, k) === 'fx') cvAddEffect(t, k, id); else fxInto(t, k, id);
    return true;
  },
  cancel() { fxDrag.end(); },
};
// the trays' load labels on this device (cv-cost estimates × the measured factor): the Sources tiles' and the Effects
// tiles' (refreshed after a measurement)
function costLabels() {
  const f = devFactor();
  if (shell.tiles) for (const b of shell.tiles.tiles()) {
    const id = b.getAttribute('data-model'), txt = COSTM.label(COSTM.estimate(id, f));
    let c = [...(b.children || [])].find(x => x.className === 'cv-tcost');
    if (!c) { c = h('span', 'cv-tcost'); b.append(c); }
    if (c.textContent !== txt) c.textContent = txt;
    c.title = 'Estimated DSP load on this device: ' + txt;
  }
  if (shell.fxTiles) shell.fxTiles.refresh();
}
// ⚙ → Measure this device (§9.1): a Worker renders three standard rows (cv-cost measureDevice), progress on the button's
// line, a second press cancels; the factor goes to the device prefs and the tray labels redraw
let measureAC = null;
function cvMeasure(btn, st) {
  if (measureAC) { measureAC.abort(); return null; }
  const ac = measureAC = typeof AbortController === 'function' ? new AbortController() : { signal: null, abort() {} };
  btn.textContent = 'Cancel'; st.textContent = '0 %';
  return COSTM.measureDevice({ progress: x => { st.textContent = Math.round(x * 100) + ' %'; }, signal: ac.signal }).then(f => {
    store.set(DEV_FACTOR, f);
    st.textContent = '×' + (Math.round(f * 100) / 100);
    costLabels();
  }, err => {
    st.textContent = '';
    if (!err || err.name !== 'AbortError') notice((err && err.message) || 'This device could not be measured', 6000);
  }).finally(() => { if (measureAC === ac) measureAC = null; btn.textContent = 'Measure this device'; });
}

/* ---------------------------------------------- cv MODULATION (stage 2a, IMPL-2a §5): modulator modules, mod cables, the mod layer */
// The project Mod Wheel (one per project, shown on every track: D9) and a track's Velocity / Aftertouch / Bend (devices ve
// / at / bd) are modules with one mod-out jack (cv-module kind 'mod'); its drag onto a Serum knob (one of its own FX knobs
// too) is a row of track.mods (cv-model addMod), compiled into that Serum's matrix by buildPatch (cv-graph injectMods).
// Their bodies (cv-mods-ui) show the host's live values: the wheel ↔ ctl('wheel') and the perf tray's #modw both ways,
// playback the selected track's lanes (perfValue), Velocity the last note (lastVel). The mod layer (cv-modlayer) edits the
// rows: the inspector (a badge's tap), the parameter list (a jack's tap, a drop on a module's bar), the Mod list (a Serum's
// or a modulator's ⋯ → Modulation list…). History: a drag onto a knob records its own step; the layer's edits open theirs
// at the gesture's first change (modPre: the snapshot before it) and name it at its end (modStep, the layer's label); a
// preset row's edits are the Serum's own (sxEdit: knob tweaks, no step). After each: queuePatch, the halos, the view
const MOD_TILES = [{ id: 'wheel', name: 'Mod Wheel', scope: 'project' }, { id: 'velo', name: 'Velocity', scope: 'track' },
  { id: 'at', name: 'Aftertouch', scope: 'track' }, { id: 'bend', name: 'Bend', scope: 'track' }];
const modKindOfKey = (t, key) => (key === 'wheel' ? 'wheel' : t && t.dev && t.dev[key] ? t.dev[key].kind : null);
const modKeyOf = kind => (kind === 'wheel' ? 'wheel' : CMOD.MOD_DEV[kind] || null);
const modSplit = dst => { const i = typeof dst === 'string' ? dst.indexOf(':') : -1; return i > 0 ? { dev: dst.slice(0, i), pid: dst.slice(i + 1) } : null; };
const isSerumDev = (t, dev) => { const d = t && t.dev ? t.dev[dev] : null; return !!d && d.kind === 'synth' && d.model === 'serum'; };
const serumIds = t => CMOD.instIds(t).filter(k => isSerumDev(t, k));
let modLayer = null, modHostO = null, modDrag = null, modPend = null, modSelHost = false, modMenuId = null;
const modBodies = new Map(); // module key → its cv-mods-ui body (+ kind)
// the view's devices: the track's (its modulators among them) and the project's wheel once placed
function cvDevices(t) {
  const L = cvModule.devicesOf(t);
  if (CMOD.hasWheel(project)) L.push({ key: 'wheel', kind: 'mod', mod: 'wheel', model: null, dev: null });
  return L;
}
/* ---- the bodies and their live values */
const modValue = (kind, t = trk()) => (kind === 'velo' ? lastVel(t) : perfValue(kind, t));
function modMount(key, b) {
  const kind = modKindOfKey(trk(), key), o = { doc: document, get: () => modValue(kind) };
  modUnmount(key);
  if (kind === 'wheel') Object.assign(o, { label: 'Mod Wheel', set: v => { ctl('wheel', v, 0); if (setModUI) setModUI(v, false); }, onJump: modJump });
  const B = cvModsUI.bodyFor(kind, o);
  if (!B) return;
  B.kind = kind;
  b.append(B.el);
  modBodies.set(key, B);
  if (kind === 'wheel') B.setOthers(modOthers());
}
function modUnmount(key) { const B = modBodies.get(key); if (!B) return false; modBodies.delete(key); B.destroy(); return true; }
// a value was sent (ctl: the wheel, aftertouch, bend; inputNote: a velocity): the modules of that kind redraw (a dragged
// wheel ignores it)
function cvModLive(kind) { if (modBodies.size) for (const B of modBodies.values()) if (B.kind === kind) B.update(modValue(kind)); }
function cvModPlay() { if (modBodies.size) for (const B of modBodies.values()) if (B.kind !== 'velo') B.update(modValue(B.kind)); } // (frame(), playing)
// the wheel's "+N on other tracks": its cables there; a tap shows the first such track
const modOthers = () => { const id = trk().id; return CMOD.wheelRows(project).byTrack.filter(x => x.trackId !== id).reduce((n, x) => n + x.rows.length, 0); };
function modJump() { const id = trk().id, x = CMOD.wheelRows(project).byTrack.find(y => y.trackId !== id); if (x) cvReveal(x.trackId, 'wheel'); }
// every render: the tray's tiles greyed where their singleton stands, the wheel's count
function cvModDecor() {
  const T = shell.tiles, t = trk();
  if (T && typeof T.setPlaced === 'function') {
    T.setPlaced('wheel', CMOD.hasWheel(project) ? 'already in this project' : null);
    for (const k of ['velo', 'at', 'bend']) T.setPlaced(k, t.dev && t.dev[CMOD.MOD_DEV[k]] ? 'already on this track' : null);
  }
  const W = modBodies.get('wheel');
  if (W) W.setOthers(modOthers());
}
/* ---- adding (the Sources tray's Modulators) and deleting (⋯) */
// a tap: left of the instruments, as Tidy's column, below what stands there; a drop: where it lands (on the dots)
function modSpot(t) {
  const x = -Math.ceil((cvModule.W_MOD + cvModule.GAP) / cvWorld.DOT) * cvWorld.DOT;
  let y = 0;
  if (cvView && cvView.trackId === t.id) for (const r of Object.values(cvView.rects())) if (r && r.x < x + cvModule.W_MOD && r.x + r.w > x) y = Math.max(y, r.y + r.h + cvModule.VGAP);
  return { x, y: Math.ceil(y / cvWorld.DOT) * cvWorld.DOT };
}
function modAdd(kind, at) {
  const t = trk(), key = modKeyOf(kind), name = CMOD.MOD_LABEL[kind];
  if (!key || !t.dev) return null;
  if (kind === 'wheel' ? CMOD.hasWheel(project) : key in t.dev) { notice(name + (kind === 'wheel' ? ' is already in this project' : ' is already on this track'), 3500); return null; }
  hist.record(project, kind === 'wheel' ? 'Place Mod Wheel' : 'Add ' + name);
  const lay = cvPinned(t);
  if (kind === 'wheel') CMOD.placeWheel(project); else CMOD.addModDev(t, kind);
  lay[key] = at && Number.isFinite(at.x) && Number.isFinite(at.y) ? { x: cvDot(at.x), y: cvDot(at.y) } : modSpot(t);
  t.lay = lay;
  cvAfter(t);
  const step = hist.u[hist.u.length - 1], tid = t.id;
  cvUndoNotice(`Added ${name} · tap to undo`, step, () => {
    const tr = project.tracks.find(x => x.id === tid);
    return tr && (kind === 'wheel' ? CMOD.hasWheel(project) : tr.dev && key in tr.dev) ? () => { if (trk() !== tr) selectTrack(tid); modDelete(key, true); } : null;
  });
  return key;
}
const modTileDrag = { // a Modulators tile dragged out: its true-size outline under the pointer over the canvas
  move(id, i) {
    if (!world) return;
    if (i.over === 'canvas') shell.drop = world.ghost({ x: i.x, y: i.y, w: cvModule.W_MOD, h: cvModule.MOD_H[id] || cvModule.MOD_H.at, label: '+ ' + (CMOD.MOD_LABEL[id] || id) });
    else { world.ghost(null); shell.drop = null; }
    world.dragPointer(!i.left ? null : { x: i.x, y: i.y, pointerType: i.pointerType });
  },
  begin(id, i) { if (world) world.setDragging(true); modTileDrag.move(id, i); },
  drop(id, i) {
    const r = shell.drop, h = cvModule.MOD_H[id] || cvModule.MOD_H.at;
    srcDragEnd();
    if (i.over !== 'canvas') return false;
    modAdd(id, r || (i.at ? { x: i.at.x - cvModule.W_MOD / 2, y: i.at.y - h / 2 } : null));
    return true;
  },
  cancel() { srcDragEnd(); },
};
// ⋯ → Delete: a modulator and its cables, one step (the wheel: from every track, asked first when it has cables)
function modDelete(key, quiet) {
  const t = trk(), kind = modKindOfKey(t, key);
  if (key === 'wheel') {
    if (!CMOD.hasWheel(project)) return false;
    const B = CMOD.wheelRows(project).byTrack, n = B.reduce((a, x) => a + x.rows.length, 0);
    if (n && !quiet && !confirm(`Remove the Mod Wheel and its ${n} cable${n === 1 ? '' : 's'} on ${B.length} track${B.length === 1 ? '' : 's'}?`)) return false;
    hist.record(project, 'Delete Mod Wheel');
    for (const x of CMOD.removeWheel(project).byTrack) { const tr = project.tracks.find(y => y.id === x.trackId); if (tr && tr !== t) queuePatch(tr); }
  } else {
    if (!cvModule.MOD_ORDER.includes(kind)) return false;
    hist.record(project, 'Delete ' + CMOD.MOD_LABEL[kind]);
    CMOD.removeModDev(t, key);
  }
  cvModAfter(t);
  cvModSync();
  return true;
}
/* ---- names, checks, the drag onto a knob */
function modLabel(id) { // canvas-form ids: a source ('wheel', 've.out'), a knob ('i1:f.cutoff'), a device ('i1')
  const t = trk();
  if (typeof id !== 'string' || !id) return '';
  if (CMOD.MOD_SRC[id]) return CMOD.MOD_LABEL[CMOD.MOD_SRC[id]];
  const D = modSplit(id);
  if (!D) return t.dev && t.dev[id] ? cvDevName(t, id) : '';
  const d = t.dev ? t.dev[D.dev] : null;
  if (isSerumDev(t, D.dev)) { try { return core.destLabel(D.pid, d.vals.s, d.fx) || D.pid; } catch (err) { return D.pid; } }
  const c = d && d.kind === 'synth' ? (modelById(d.model).controls || []).find(x => x.id === D.pid) : null;
  return c ? c.label : D.pid;
}
// can src modulate knob dst ('<dev>:<param>') of this track → {ok, why} (the refusal texts of §2.13)
function modCan(src, dst) {
  const t = trk(), D = modSplit(dst), d = D && t.dev ? t.dev[D.dev] : null;
  const no = (code, x) => ({ ok: false, why: modRefusal(code, Object.assign({ src: modLabel(src), dst: modLabel(dst) }, x)) });
  if (!d) return no('nomod');
  const r = CMOD.destOk(d, D.pid);
  if (!r.ok) return r.stage ? no('stage', { stage: r.stage }) : no('nomod');
  const b = CG.modBudget(t, D.dev);
  if (b.left.length || b.preset + b.canvas >= b.max) return no('full', { dev: cvDevName(t, D.dev), used: b.preset + b.canvas, max: b.max });
  return { ok: true, why: '' };
}
// the knobs a drag lights up: every modulatable one of the track's Serums (memoised per drag)
function modMarks() {
  const t = trk(), memo = new Map();
  return (dev, id) => { const k = dev + ':' + id; if (!memo.has(k)) memo.set(k, isSerumDev(t, dev) && CMOD.destOk(t.dev[dev], id).ok); return memo.get(k); };
}
// a drag released on a knob: one step "Modulate <knob> with <source>", the new cable selected
function modConnect(src, dst) {
  const t = trk(), D = modSplit(dst), ok = modCan(src, dst);
  if (!ok.ok) { notice(ok.why, 4000); return null; }
  hist.record(project, 'Modulate ' + modLabel(dst) + ' with ' + modLabel(src));
  const r = CMOD.addMod(t, src, dst, { project, name: cvDevName(t, D.dev) });
  if (!r.ok) { notice(r.why || modRefusal(r.code), 4000); updateUndoUI(); return null; }
  modPend = null;
  cvModAfter(t);
  modSelect(r.row.id);
  cvModSync();
  return r.row.id;
}
const modAt = el => { const r = el && typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null; return r ? { x: r.left, y: r.bottom + 6 } : { x: undefined, y: undefined }; };
// the parameter list of the Serum a cable is aimed at (a drop on its bar, a tap on the jack); elsewhere the reason
function modDests(src, dev, el) {
  const t = trk();
  if (!dev || !isSerumDev(t, dev)) { notice(dev && t.dev && t.dev[dev] ? modRefusal('stage', {}) : 'Drag a modulation cable onto a Serum knob', 4000); return false; }
  const p = modAt(el);
  return modLayer ? modLayer.openDestList(src, dev, p.x, p.y) : false;
}
const modDragOpts = {
  canMod: (src, dst) => modCan(src, dst),
  markDests: () => modMarks(),
  onMod: (src, dst) => { modConnect(src, dst); },
  onRefuse: (src, dst, why) => notice(why || modRefusal('nomod'), 4000),
  onBarDrop: (src, key) => { const m = cvView && cvView.modules.get(key); modDests(src, String(key).split('/')[0], m ? m.bar : null); },
  onJackTap: (src, el) => { const S = serumIds(trk()); if (S.length) modDests(src, S[0], el); else notice('Modulation cables end on a Serum’s knobs (classic knobs from stage 2b)', 4000); },
};
function modSelect(id) { if (!cvView) return; modSelHost = true; try { cvView.cables.select(id); } finally { modSelHost = false; } }
/* ---- the mod cables' badges (cv-cables host.cables) */
// a tap on a badge (selected or not): the inspector at it — after the event, so a long-press / right-click (its menu) does not
function modCableSel(id) {
  if (modSelHost || !id || !modLayer) return;
  modMenuId = null;
  Promise.resolve().then(() => {
    const c = cvView && cvView.cables.list().find(x => x.id === id);
    if (modMenuId === id || !c || c.kind !== 'mod') return;
    const p = modAt(cvView.cables.badge(id));
    modLayer.openInspector(c.preset ? { preset: c.dev, slot: c.slot } : id, p.x, p.y);
  });
}
function modCableMenu(id) {
  modMenuId = id;
  const c = cvView && cvView.cables.list().find(x => x.id === id);
  if (!c || c.kind !== 'mod') return [];
  return [{ label: 'Edit…', action: () => { const p = modAt(cvView && cvView.cables.badge(id)); if (modLayer) modLayer.openInspector(c.preset ? { preset: c.dev, slot: c.slot } : id, p.x, p.y); } }];
}
function modCableAct(id, a) { // Disconnect (the menu, the Delete key): a canvas row one step; a preset row the Serum's edit
  const t = trk(), c = cvView && cvView.cables.list().find(x => x.id === id);
  if (a !== 'disconnect' || !c || c.kind !== 'mod') return;
  if (c.preset) modRemove({ preset: c.dev, slot: c.slot });
  else { hist.record(project, 'Disconnect'); CMOD.removeMod(t, id); }
  cvModAfter(t);
  cvModSync();
}
/* ---- the mod layer's host */
function modPre() { // a canvas row is about to change: the gesture's step (once; its label at modStep)
  if (modPend && modPend.e && hist.u[hist.u.length - 1] === modPend.e) return;
  modPend = { e: hist.record(project, 'Modulation') ? hist.u[hist.u.length - 1] : null };
}
function modStep(label) {
  const P = modPend, t = trk();
  modPend = null;
  if (P && P.e && hist.u[hist.u.length - 1] === P.e) P.e.label = label;
  cvModAfter(t);
  sxRefresh(); // (a preset row's edit: the Serum's matrix page)
}
// after every row edit: the patch, the Serum's halos, the view (cables, the "mods n/64" badge), the track rows
function cvModAfter(t) { queuePatch(t); modHalos(t); cvRender(); renderHeads(); persist(); updateUndoUI(); }
function modHalos(t) {
  for (const d of serumIds(t)) {
    const r = sxRecOf(t.id, d);
    if (r && r.ui && r.trackId === t.id && typeof r.ui.paintMods === 'function') { try { r.ui.paintMods(true); } catch (err) { console.warn(err); } }
  }
}
function modEdit(key, f) {
  const t = trk();
  if (typeof key === 'string') {
    modPre();
    if (!CMOD.setMod(t, key, f).ok) return null;
    queuePatch(t); modHalos(t);
    const r = (t.mods || []).find(x => x.id === key);
    return r ? Object.assign({}, r) : null;
  }
  if (!key || !isSerumDev(t, key.preset)) return null;
  let out = null;
  sxEdit(instView(t, key.preset), s => { const M = s.matrix.slice(); M[key.slot] = out = core.normRow(Object.assign({}, M[key.slot], f)); s.matrix = M; });
  modHalos(t);
  return out;
}
function modRemove(key) {
  const t = trk();
  if (typeof key === 'string') { modPre(); const r = CMOD.removeMod(t, key); queuePatch(t); return r; }
  if (!key || !isSerumDev(t, key.preset)) return null;
  sxEdit(instView(t, key.preset), s => { const M = s.matrix.slice(); M[key.slot] = core.normRow(null); s.matrix = M; });
  return { ok: true };
}
// Save with preset / Keep on canvas: the row moves between track.mods and the Serum's matrix (applied through sxEdit: its
// panel and the patch follow); the compile is the same (cv-model keeps the slot)
function modToPreset(id) {
  const t = trk(), r0 = (t.mods || []).find(x => x.id === id), D = r0 && modSplit(r0.dst);
  if (!D || !isSerumDev(t, D.dev)) return { ok: false, why: 'No such cable' };
  modPre();
  const v = instView(t, D.dev), r = CMOD.toPreset(t, id, v.vals.s);
  if (r.ok) sxEdit(v, s => { s.matrix = r.matrix; });
  return r;
}
function modFromPreset(dev, slot) {
  const t = trk();
  if (!isSerumDev(t, dev)) return { ok: false, why: 'No such Serum' };
  modPre();
  const r = CMOD.fromPreset(t, dev, slot, { project });
  if (r.ok) sxEdit(instView(t, dev), s => { s.matrix = r.matrix; });
  return r;
}
// a Serum's destinations as its matrix menu groups them (serum-core destMenu: the sections, one group per FX instance)
function modDescs(dev) {
  const t = trk(), d = isSerumDev(t, dev) ? t.dev[dev] : null, out = [];
  if (d) for (const g of core.destMenu(d.vals.s, d.fx, { matrix: true })) for (const it of g.items) out.push({ id: it.id, label: it.label, group: g.group, nomod: false });
  return out;
}
function modSources(dev) { // the Serum's own sources (the aux menu)
  const t = trk(), d = isSerumDev(t, dev) ? t.dev[dev] : null, out = [];
  if (d) for (const g of core.srcMenu(d.vals.s)) for (const it of g.items) out.push({ id: it.id, label: it.label, group: g.group });
  return out;
}
function initModLayer() {
  if (modLayer) return;
  try {
    if (document.head && !document.getElementById('cvModStyle')) { const st = h('style'); st.id = 'cvModStyle'; st.textContent = MOD_STYLE; document.head.append(st); } // (the layer's styles, once)
    modLayer = createModLayer(modHostO = {
      doc: document, layer: $('#ov') || document.body,
      descs: modDescs, sources: modSources,
      rowsOf: dev => { const t = trk(); return dev ? CG.modRowsFor(t, dev) : Array.isArray(t.mods) ? t.mods.slice() : []; },
      presetRows: dev => { const d = trk().dev[dev]; return d ? CMOD.presetRows(d) : []; },
      budget: dev => CG.modBudget(trk(), dev),
      edit: modEdit, remove: modRemove, toPreset: modToPreset, fromPreset: modFromPreset,
      connect: (src, dst) => { // (the parameter list: no step here — the layer names it)
        const ok = modCan(src, dst);
        if (!ok.ok) return { ok: false, why: ok.why };
        modPre();
        const t = trk(), D = modSplit(dst), r = CMOD.addMod(t, src, dst, { project, name: cvDevName(t, D.dev) });
        if (r.ok) queuePatch(t);
        return r;
      },
      select: modSelect, notice: txt => notice(txt, 4000), labelOf: modLabel, step: modStep, confirm: q => confirm(q),
    });
  } catch (err) { modLayer = null; console.warn('The modulation inspector is unavailable', err); }
}
// ⋯ → Modulation list…: every mod row of the track by Serum (canvas and preset), the budgets
function modList() { const t = trk(); if (modLayer) modLayer.openList(t.name, serumIds(t).map(id => ({ id, label: cvDevName(t, id) }))); }
// undo / redo / a load (applyRestore), a preset load (sxLoad): the open inspector and Mod list re-read; no gesture open
function cvModSync() { modPend = null; if (modLayer) modLayer.sync(); }
function cvModReload(t) { if (t === trk()) cvRender(); cvModSync(); }
// a Serum page switch (its ui edits): the knob ends of its module measured again (next frame: the page is built)
let modMeasT = 0;
const modMeasQ = new Set();
function cvRemeasure(id, dev) {
  modMeasQ.add(id + '\n' + dev);
  if (!modMeasT) modMeasT = requestAnimationFrame(() => {
    modMeasT = 0;
    for (const q of modMeasQ) { const [tid, d] = q.split('\n'); if (cvView && cvView.trackId === tid) cvView.remeasure(d); }
    modMeasQ.clear();
  });
}

// Track switch (SPEC-canvas §2.12, stage 1c): the new track's module frames go up at once (their sizes from its layout, its
// camera restored), then the bodies mount over the next frames — the one nearest the view's centre first, as many per
// frame as fit in CV_SLICE_MS (at least one) — with the world hidden ([data-cv-mounting]: visibility hidden) until the
// last is built (a Serum panel / an FX rack: until its UI is up, at most CV_MOUNT_MAX ms), then shown with a short fade:
// nothing half-built, no pop, and the modules render exactly as they will (Z1). Off the canvas (ROLL, no world) a switch
// renders at once, as before. Stage 1e: one job per device body
const CV_SLICE_MS = 12, CV_MOUNT_MAX = 500; // (past it the frames show with the panel's own "Loading…": never a long blank canvas)
let cvMount = null, cvBuilds = 0; // the switch mounting { key, jobs, t0, raf }; UI builds in flight (uiMods)
function cvBuild(p) { cvBuilds++; return p.finally(() => { cvBuilds = Math.max(0, cvBuilds - 1); }); }
function cvSwitching() {
  if (!cvOn() || !cvView || !cvViewKey || $('#tab-inst').hidden || typeof requestAnimationFrame !== 'function') return false;
  return cvViewKey !== project.uid + '/' + trk().id;
}
function cvSwitch() {
  if (cvMount) cvMountEnd(false);
  cvHold = true;
  try { cvRender(); } finally { cvHold = false; } // (the frames and the camera; the bodies still hold the outgoing panels, hidden until replaced)
  cvDue.clear(); // (the jobs below build every body)
  const vp = $('#viewport'), W = cvW(), b = W && typeof W.band === 'function' ? W.band() : null, t = trk();
  if (vp) vp.setAttribute('data-cv-mounting', '');
  const dist = key => { // the module's centre from the band's centre (screen px)
    const m = cvView && cvView.modules.get(key);
    if (!m || !b || !W.toClient) return 0;
    const r = m.rect(), c = W.toClient(r.x + r.w / 2, r.y + Math.min(r.h, 600) / 2);
    return Math.hypot(c.x - (b.left + b.right) / 2, c.y - (b.top + b.bottom) / 2);
  };
  const jobs = (cvView ? [...cvView.modules.keys()] : []).map(key => [key, kindOfKey(t, key)]).filter(([, k]) => k === 'inst' || k === 'fx')
    .map(([key, kind]) => ({ key, run: kind === 'inst' ? () => { cvBusy = true; try { renderPanel(t, key); } finally { cvBusy = false; } } : () => renderFxTab(t, key) }))
    .sort((x, y) => dist(x.key) - dist(y.key));
  cvMount = { key: cvViewKey, jobs, t0: performance.now(), raf: requestAnimationFrame(cvMountStep) };
}
function cvJob(j) { try { j.run(); cvRender(); } catch (err) { console.error(err); } } // (the frames follow each body: titles, sizes)
function cvMountStep() {
  const M = cvMount;
  if (!M) return;
  M.raf = 0;
  if (M.key !== cvViewKey) { cvMountEnd(); return; } // (another render took over: finish now, never left hidden)
  const t0 = performance.now();
  while (M.jobs.length) { cvJob(M.jobs.shift()); if (performance.now() - t0 >= CV_SLICE_MS) break; } // (at least one a frame)
  if (M.jobs.length || (cvBuilds > 0 && performance.now() - M.t0 < CV_MOUNT_MAX)) { M.raf = requestAnimationFrame(cvMountStep); return; }
  cvMountEnd(true);
}
// the switch is done (or superseded: show false): any job left runs now, the world shows (the fade is CSS's)
function cvMountEnd(show = true) {
  const M = cvMount;
  if (!M) return;
  cvMount = null;
  if (M.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(M.raf);
  if (show) for (const j of M.jobs.splice(0)) cvJob(j);
  const vp = $('#viewport');
  if (vp && show) vp.removeAttribute('data-cv-mounting');
  if (show) { cvRender(); monitors.sync(); }
}
// a panel rendered outside renderViews (a model change, a track rename, a 303 pattern): the modules follow (titles, sizes,
// the bodies a model change re-homed)
function cvPanelDone() {
  if (cvBusy || !cvView) return;
  if (cvMount) { cvMountEnd(); return; } // (an edit during a switch's mounting — a model change —: it completes now)
  cvRender();
}
if (globalThis.__synthTest && typeof globalThis.__synthTest === 'object') { // (tests/canvas-sim.test.mjs, canvas-1e-sim)
  globalThis.__synthTest.cv = {
    view: () => cvView, parts: cvParts, world: () => cvW(), sxPanel, fxTab, monitors, hist, undo, redo, render: cvRender,
    renderViews, tidy: cvTidy, drop: cvDropInstrument, reveal: cvReveal, size: cvModuleSize, live: cvLive, camFlush: cvCamFlush,
    chipSync: cvChipSync, heads: renderHeads, duplicateTrack, openTab, about: cvAbout, menu: cvMenu, peer: () => ({ peerT, peerQ, peerStale }),
    setLayout: cvSetLayout, instUi, hw: () => (cpanel ? cpanel.hw : null), presetStep, presetInit, panel: () => cpanel, classicFile,
    // (stage 1e)
    // (stage 1e; 1f: add / power / zone are hooks only — no UI reaches them — for the host and engine-protocol tests)
    add: cvAddInstrument, power: cvPower, zone: cvZone,
    badge: cvBadge, cur: () => curOf(trk()), setCur: key => setCur(trk(), key), view1e: k => instView(trk(), k),
    fx: { pick: fxPick, drag: fxDrag, over: fxOver, items: FX_ITEMS, tiles: () => shell.fxTiles, addEffect: (key, type) => cvAddEffect(trk(), key, type) },
    classicPanels, serumPanels, fxPanels, bodyEl: key => cvBodyEl(trk(), key), measure: cvMeasure, costLabels, devFactor, setTrackModel, renderPanels,
    touch: (t0 => v => { touchDev = v == null ? t0 : !!v; })(touchDev), // (the soft caps' touch rule; null: back to this device's)
    wheelToWt, chordCheck, mount: () => (cvMount ? { jobs: cvMount.jobs.map(j => j.key) } : null), // (a switch's mounting: the bodies still to build)

    // (stage 2a, tests/canvas-2a-sim)
    mod: { add: modAdd, drag: modTileDrag, del: modDelete, opts: modDragOpts, connect: modConnect, can: modCan, marks: modMarks, layer: () => modLayer, host: () => modHostO,
      bodies: modBodies, sel: modCableSel, act: modCableAct, cmenu: modCableMenu, list: modList, label: modLabel, descs: modDescs, decor: cvModDecor, cableDrag: () => modDrag },
  };
}

/* -------------------------------------------------------------- boot */
let app = null; // pwa.js initApp's controller
// a node (or a text node's element) inside something the user types into — the only places text may be selected
const TEXT_FIELD = 'input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=color]), textarea, select, [contenteditable]:not([contenteditable="false"])';
function isTextField(t) {
  const el = t && t.nodeType === 3 ? t.parentElement : t;
  return !!(el && typeof el.closest === 'function' && el.closest(TEXT_FIELD));
}
function boot() {
  // the two-finger layer (gesture.js) first: its window capture listeners run before every other (pressStart, wake, the
  // keys …), so a two-finger pan / pinch never presses what it lands on; the page's pinch-zoom stays the browser's. Over
  // the canvas its script pan and pinch drive the camera (the hooks answer false elsewhere, and while there is no world)
  installGestures(window, { pan: (sx, sy, at) => (world ? world.hooks.pan(sx, sy, at) : false), zoom: (f, cx, cy, at) => (world ? world.hooks.zoom(f, cx, cy, at) : false) });
  // (main's boot drops build 8's 'synth-ui.scale' key here; the canvas build never had it and leaves main's keys alone)
  // no text selection outside fields: iPadOS can still start one (word select + loupe) on a double-tap or hold where
  // style.css's user-select: none leaves a gap
  document.addEventListener('selectstart', e => { if (!isTextField(e.target)) e.preventDefault(); });
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  defs.setAttribute('width', 0); defs.setAttribute('height', 0); defs.style.position = 'absolute';
  defs.innerHTML = '<defs><radialGradient id="knobShine" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity="0.22"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.04"/><stop offset="1" stop-color="#000" stop-opacity="0.25"/></radialGradient></defs>';
  document.body.prepend(defs);

  initEditors();
  initTransport();
  initShell(); initWorld(); initModules(); // the stage-1b canvas shell (IMPL-1b §6: this order; renderAll then mounts the modules)
  renderAll();
  buildKeys(); initKeys();
  openTab(store.get('synth.tab', 'canvas'));

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
  // hidden: iOS may never send pagehide after this, so an IndexedDB save starts now (an unchanged project writes no
  // record); localStorage: a pending save is written (Phase 1)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { releaseKeys(); if (store.mode !== 'ls' || saveT) saveNow(); } else wake();
    monitors.sync();
  });
  window.addEventListener('scroll', () => { pageScrollT = performance.now(); }, { capture: true, passive: true });
  const sr = $('#sr'), os = $('#os'), drift = $('#drift'), mst = $('#master'), vel = $('#vel');
  if (![...os.options].some(o => +o.value === settings.os)) settings.os = 4;
  sr.value = String(settings.sr); os.value = String(settings.os); drift.value = settings.drift; mst.value = settings.master;
  vel.value = settings.vel; $('#velv').textContent = settings.vel;
  rateLabels();
  // new context created synchronously in the handler, so it is still inside the user's gesture
  sr.onchange = () => { settings.sr = +sr.value; persist(); rateLabels(); if (ctx || pendCtx) { powerOff(); powerOn().catch(() => {}); } };
  os.onchange = () => {
    settings.os = +os.value; persist();
    liftCaps(); // a quality choice lifts the CPU caps
    if (ctx) postAll({ t: 'os', v: osFor(ctx.sampleRate) }); // (Serum tracks keep their own, §11.4)
    rateText(); rateLabels();
  };
  drift.oninput = () => { settings.drift = +drift.value; persist(); for (const t of project.tracks) queuePatch(t); };
  mst.oninput = () => { settings.master = +mst.value; persist(); if (master) master.gain.setTargetAtTime(settings.master, ctx.currentTime, 0.02); };
  initLatency();
  vel.oninput = () => setVel(+vel.value);
  $('#octdn').onclick = () => setOctave(octave - 1);
  $('#octup').onclick = () => setOctave(octave + 1);
  $('#panic').onclick = panic;
  $('#hold').onclick = () => setSustain(!sustain);
  initKbView();
  setBendUI = wheel('bend', true, v => ctl('bend', v * 2 - 1, 0));
  setModUI = wheel('modw', false, v => ctl('wheel', v, 0));
  for (const b of document.querySelectorAll('.scope-ctl button')) {
    b.onclick = () => { scopeMode = b.dataset.mode; for (const x of document.querySelectorAll('.scope-ctl button')) x.classList.toggle('on', x === b); };
  }
  // a new window size (rotation, Split View): the keyboard's height and keys, the roll and the arrangement re-fitted
  function relayout() { shellMeasure(); applyKbHeight(); buildKeys(); roll.resize(); arr.resize(); }
  let rw;
  window.addEventListener('resize', () => { clearTimeout(rw); rw = setTimeout(relayout, 120); });
  window.addEventListener('hashchange', () => { const m = MODELS.find(x => '#' + x.id === location.hash); if (m) setTrackModel(curView(), m.id); });
  window.addEventListener('pagehide', saveNow);
  window.addEventListener('beforeunload', saveNow);
  midi.wire();
  // the installed app (pwa.js): Full screen / Install app buttons, offline service worker, update toast — an update
  // reloads only when the user asks, after the project is saved
  app = initApp({ version: VERSION, notice, beforeReload: async () => { releaseKeys(); save(); await store.flush(); } });
  const why = audioProblem(); if (why) audioFail(why);
  powerUI();
  booted = true;
  // the notices raised while the page was starting (storage, the 1f split) and the platform one (SPEC-canvas §9.4): one line
  // (1f review: each replaced the one before); a recovered project's tap-to-download notice carries them before it
  const E = early.splice(0), old = platformProblem();
  if (old) E.push([old, 20000]);
  const pre = E.map(x => x[0]).join(' · ');
  if (E.length) notice(pre, Math.max(...E.map(x => x[1])));
  recoveredNotice(pre);
  if (readOnly) goReadOnly(readOnly); // a newer project met while starting: Save disabled, the notice (SPEC-canvas §5.8)
  requestAnimationFrame(frame);
}
// §12.6 storage: a project autosaved by a session that could not open the database (it ran on the older localStorage copy)
// was kept separately by this run's re-sync (appstore '#rec:'): offered as a project file to download (open it with
// File › Open to continue from it)
function recoveredNotice(pre = '') {
  const inf = store.info(), txt = inf.conflicts.includes(PROJECT_KEY) && store.recovered ? store.recovered('synth.project') : null;
  if (!txt) return;
  let ok = false;
  try { ok = !!S.deserialize(txt); } catch { ok = false; }
  if (!ok) return;
  const msg = (pre ? pre + ' · ' : '') + 'A project saved while the stored data could not be opened was kept separately — tap to download it';
  noticeActs.set(msg, () => { download(new Blob([txt], { type: 'application/json' }), 'recovered-project.synth.json'); noticeActs.delete(msg); notice('', 0); });
  notice(msg, 30000);
}
// Test hook: the node simulation of the page (tests/main-sim.mjs) sets globalThis.__synthTest before importing this module
// and reaches the hosts and a few internals through it. A browser never sets it; nothing here depends on it.
if (globalThis.__synthTest && typeof globalThis.__synthTest === 'object') {
  globalThis.__synthTest.api = {
    project: () => project, nodes, tables, store, prefs: () => prefs, sxHost, fxHost, buildPatch, sendPatch, queuePatch, prefsChanged,
    powerOn, noteOn, noteOff, renderLast, resampleTo, preview, previewStop, previewEnd, clipToTrack, lastIn, inputSubs, liftCaps, lowerOS,
    caps: () => ({ sxCap, qrStep }), setTrackModel, addTrack, selectTrack, save, flush, sxLoad, sxSave, sxPreset, midi, renderOffline,
    songData, sxOSFor, pv, bounceSet, genProgress, notice, stickyNotice, deleteTrack, capQ4, ctx: () => ctx,
    capsOf, postTo, seqOf, seqSend, seqRun, seqStepTo, buildInstPatch, graphParts, offParts, monitors, partsOf, applyRestore, // (stage 1e host)
    clock: () => CLK, curTick, outLatency, transport: () => T, settings: () => settings, latPreset, // (the audio clock, R5)
    held, kbRange, kbMaxH, app: () => app, kb: () => ({ h: kbH, kw: kbSize.kw, hSet: kbSize.h, lo: kbLo, hi: kbHi, w: kbW, px: kbPx, notes: [...keyEls.keys()], ptrs: new Map(ptrs) }),
    roll: () => roll, arr: () => arr,
    ctl, wheelTracks, perfValue, lastVel, modCount, sxExtra, injectMods: CG.injectMods, // (stage 2a host)
  };
}
boot();
