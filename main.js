import { MODELS, DX_ALGS, patchFor, groupSong, classicOf as isClassicModel, isSxModel, isSerumModel, isRigModel, isSxId } from './models.js?v=9'; // ((9) classicOf as isClassicModel: main's classicOf is the classic-panel lookup)
import * as S from './song.js?v=9';
import { PianoRoll, drumRowsOf } from './roll.js?v=9';
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
import { initApp, inShell } from './pwa.js?v=9';
import * as AC from './audioclock.js?v=9';
import { installGestures } from './gesture.js?v=9';
// stage 1b canvas shell (docs/canvas/IMPL-1b.md): SHELL lane cv-tray / cv-art, WORLD lane cv-world, MODULES lane cv-module / cv-cables
import * as cvTray from './cv-tray.js?v=9';
import * as cvArt from './cv-art.js?v=9';
import * as cvWorld from './cv-world.js?v=9';
import * as cvModule from './cv-module.js?v=9';
import * as cvCables from './cv-cables.js?v=9';
import * as cvCordsMod from './cv-cords.js?v=9'; // ((WC, fixer K) the rope at rest (restPath) and the knob rim's cut (clip): the rig's badges and aims
// stage 1e (IMPL-1e §4.6): per-device load estimates, soft caps and "Measure this device"
import * as COSTM from './cv-cost.js?v=9';
// the hardware front panels (docs/canvas/IMPL-panels.md, ENGINE lane): fixed-size classic instruments, Hardware / Simple
import * as cvPanel from './cv-panel.js?v=9';
import * as cvKeys from './cv-keys.js?v=9'; // (1i, IMPL-1i §6) the hardware keyboards' host (perfHost), the 303's pitch root
import { FACES } from './cv-face.js?v=9'; // (1h) the hardware faces' registry: a re-mounted panel is told (cvMountBody)
// stage 1c: the classic panel as an instance (renderPanel, controls, preset plate, TB-303 sequencer with their track passed in)
import { ClassicPanel, fmt, SEQ_DEF } from './classic-panel.js?v=9';
import { fitCanvas, menuOpen as wkMenuOpen, contextMenu as wkContextMenu, discBox as wkDiscBox } from './wk.js?v=9'; // (the OUT module's scope store: the same kit instance as the canvas, its zoom; a kit menu open: the canvas Delete key)
// stage 2a (IMPL-2a §5): the modulator modules' bodies (cv-mods-ui) and the mod layer (cv-modlayer: inspector, Mod list, parameter list)
import * as cvModsUI from './cv-mods-ui.js?v=9';
import { xferOf as modXferOf, xferInv as modXferInv, targetsOf as modTargetsOf, srcOf as modSrcOf, descs as modDescsOf } from './cv-mods.js?v=9'; // (2b: the classic halos' knob units)
import { createModLayer, refusal as modRefusal, STYLE as MOD_STYLE } from './cv-modlayer.js?v=9';
// milestone 3 (IMPL-3 §2.4–2.7, lane D): a Serum taken apart — its parts as modules of one host (sx-host / sx-ui-mod, loaded
// with the panels), its internal cables as views of its state (sx-edges)
import * as SE from './sx-edges.js?v=9';
// (stage WC, IMPL-WC §2.3; lane H) the rig's rules (rig-core: the display name RIG.NAME — every word with the synth's name reads it —, the
// gate, the named states, the catalogue, the cord rules, the words); its faces (rig-ui) load with the panels (uiMods)
import * as RC from './rig-core.js?v=9';
// stage 7a (IMPL-7a §10): the drum machines — drum-core's pure model (memory, the panel's state machine, the {t: 'seq'}
// payload, → Piano roll) and cv-drum's host (the panels' sessions, heard-time LEDs, pads), wired below (DRUM); 7b (IMPL-7b
// §10): the TR-606 beside the 808 — every record by its machine (normDrum(·, model)), SYNC 303s (link303 / n303)
import * as DC from './drum-core.js?v=9';
import * as cvDrum from './cv-drum.js?v=9';
// stage 7d + 8 (IMPL-8 Part A, §14.1): the Pads module — pads-core's pure model (project.pads, schema 11: the grid, targets,
// hardware bindings) and cv-pads' host (PADS below: the held state, the counts per (track, note) — every press a hit, the
// last release ends —, the mod values, the lights, the hardware echo) and its body on the canvas; a project-level module
// shown on every track (the Mod Wheel's placement), playing any track through noteOn's explicit targets
import * as PC from './pads-core.js?v=9';
import * as cvPads from './cv-pads.js?v=9';
// stage 9 (IMPL-9 §6): the 900 Series — patch-core's pure record (PT: modules, cords, the payload, the rack; PC is pads-core's),
// the family's table (MG: model15, the presets), cv-patch's host (PATCH below: the plug drag, the menus, the modules' faces)
import * as PT from './patch-core.js?v=9';
import * as MG from './moog-core.js?v=9';
import * as cvPatch from './cv-patch.js?v=9';
// stage M (IMPL-M §3, §5.1, §5.3; lane U): the master OUT (scope, loudness, true peak, correlation, A/B, Mono) and the Master row
import * as MUI from './master-ui.js?v=9';

const VERSION = '9';
const RIG = RC.RIG;
// The iPad app (IMPL-A §3): its WKWebView injects the marker window.SYNTH_SHELL (an object: os, app, build, sha, site,
// restarted, post(m) → a promise of the native reply) and serves the site as synth://app/. SHELL is that marker there, null
// in every browser — where each shell seam below is dormant (A1). shellEng: the engine's on / off as last told to native
// (Q4: the screen stays awake while it is on); shellBootMs: performance.now() at the end of boot (probe)
const SHELL = inShell(globalThis, globalThis.location) && globalThis.SYNTH_SHELL && typeof globalThis.SYNTH_SHELL === 'object' ? globalThis.SYNTH_SHELL : null;
let shellEng = false, shellBootMs = 0;
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
// (IMPL-A §5.4) the app reloaded the page after the system reclaimed its WebContent process: said first, once (the
// marker's `restarted` is one-shot — native swaps it back after ready)
if (SHELL && SHELL.restarted === true) early.push(['SYNTH restarted (the system reclaimed memory) — the project came back from its last autosave', 20000]);
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
// (milestone 3, R7) every track into the project through cv-model adopt — no transition accessors; for one stage the sims
// (__synthTest) and dev builds (?dev=1) install the throwing guard accessors, so a stray track.model / vals / fx read or
// write throws instead of reading undefined or adding an enumerable field autosave and History would save
const GUARDS = !!globalThis.__synthTest || /[?&]dev=1(&|$)/.test((globalThis.location && location.search) || '');
const adopt = p => CMOD.adopt(p, { guard: GUARDS });

// lat: the user's "Output latency" offset in ms (header Latency control, R5) — playhead, recording and host.latency
const settings = Object.assign({ sr: 0, os: 4, drift: 5, master: 0.8, model: 'minimoog', vel: 100, lat: 0 }, store.get('synth.settings', {}));
settings.lat = clamp(Math.round(+settings.lat) || 0, -50, 400);
let ctx = null, an = null, master = null, metroBus = null, powering = null;
// (IMPL-M §1.1, §2.1) the master: mnode MASTER's record (beside `nodes`, never in it); mono the Mono stage; master (above) the
// Volume — the listening level; mSplit / anL / anR the stereo image scope's analysers (O1)
let mnode = null, mono = null, mSplit = null, anL = null, anR = null;
let octave = 0, sustain = false;
// one ClassicPanel (classic-panel.js) per mounted classic instrument (classicPanels, 'trackId/dev'); curPanel(): the selected
// track's current instrument's, or null (a Serum, not built) — (milestone 3, R6) read, never a global
const classicPanels = new Map();
const curPanel = () => { const t = trk(), P = classicPanels.get(t.id + '/' + curOf(t)); return P && !P.dead ? P : null; };

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
  const v = {}; for (const c of m.controls) v[c.id] = c.def;
  if (m.family === 'patch') v.p = {}; // ((9, §1.2) a 900 Series: the controller's flat ids, its modules' knobs in vals.p)
  return v;
}
// new sounds: a model's last-used panel values; a Serum track starts from the user's default preset (Save as Default
// Preset, synth.sx.default, §13.12) or Init with the preferences (§2.1)
function sxDefault() { const d = store.get('synth.sx.default', null); return d && d.v && d.v.s && typeof d.v.s === 'object' ? d : null; }
function loadVals(m) {
  if (isSxModel(m)) { const d = isSerumModel(m) ? sxDefault() : null; return d ? { s: core.normalizeSerum(clone(d.v.s)) } : defaults(m); } // ((WC) Save as Default Preset is the Serum's: a rig starts from its own defaults, rigStarter)
  if (m.family === 'patch') return defaults(m); // ((9) no last-used values: a patch's knobs belong to its record — save() keeps none)
  return Object.assign(defaults(m), store.get('synth.v.' + m.id, {}));
}
// (milestone 3, R2) a track's instruments are read as devices — instOf(t, dev) (cv-model: the primary by default), a device
// view (instView) — never through a track's v1 fields: isSxRec(x) for a device or a view, isSxDev(t, dev), the track's Serum-engine
// ids (sxIds, the primary first)
// (stage WC, IMPL-WC §8.1) two questions the literal 'serum' / m.custom answered at once. "Runs on the Serum engine" — the Serum AND the
// rig (the compile, payload, voices, OS caps, quality steps, own FX rack, presets machinery, modulation): isSxRec(d) for a device or a view,
// isSxDev(t, dev), sxIds(t), models.js isSxModel / isSxId. "Is the bundled Serum" — its complete panel, its menus, Info, naming:
// models.js isSerumModel (no site here means it of a device: the panel code tests the model). "Is the rig" (its parts view, its
// faces): isRigDev(t, dev), models.js isRigModel
const instOf = (t, dev) => CMOD.instOf(t, dev);
const isSxRec = d => !!d && isSxId(d.model);
const isSxDev = (t, dev) => { const d = t && t.dev ? t.dev[dev] : null; return !!d && d.kind === 'synth' && isSxId(d.model); };
const sxIds = t => (t && t.dev ? CMOD.instIds(t).filter(k => isSxDev(t, k)) : []);
const isRigDev = (t, dev) => { const d = t && t.dev ? t.dev[dev] : null; return !!d && d.kind === 'synth' && d.model === RIG.ID; };
// (7a, IMPL-7a §1.1, §6) a drum machine (models.js family 'drums': the TR-808, 7b the TR-606, 7c the TR-909) is a device
// too: its record dev.drum (the pattern memory, panel state, extras, note map, sample slots — drum-core normDrum) is made on
// first read when missing — (7b §3.1, review #4) always by the device's model: a machine never gets (or keeps) another's
// record ((7c §6) the record's m — an 808's has none — against the model: three ways, never the binary 606 test)
const isDrumDev = (t, dev) => { const d = t && t.dev ? t.dev[dev] : null; return !!d && d.kind === 'synth' && S.isDrum(d.model); };
const drumDevs = t => (t && t.dev ? CMOD.instIds(t).filter(k => isDrumDev(t, k)) : []);
// (9, IMPL-9 §1.2, §6) a 900 Series (models.js family 'patch', model m900) is a device too: its modules and cords in dev.patch
// (patch-core's record — normPatch: a fresh one, the controller alone, when missing), its knobs in vals (the controller's flat
// ids; vals.p the modules', `_t`-tagged); the track's notes play its controller (the engine's kind 'patch')
const isPatchDev = (t, dev) => { const d = t && t.dev ? t.dev[dev] : null; return !!d && d.kind === 'synth' && PT.isPatchModel(d.model); };
const patchDevs = t => (t && t.dev ? CMOD.instIds(t).filter(k => isPatchDev(t, k)) : []);
function patchOf(t, dev) {
  if (!isPatchDev(t, dev)) return null;
  const d = t.dev[dev], f = PT.familyOf(d.model);
  if (!d.patch || typeof d.patch !== 'object' || d.patch.f !== f || !d.patch.mods || !Array.isArray(d.patch.cords)) d.patch = PT.normPatch(d.patch, f);
  return d.patch;
}
// a new 900 Series device's record and knobs (§1.4): the Model 15 set patched as Classic bass (model15: numbered past any
// vals.p orphan), or — a module tile on another track (type) — the controller and that module, nothing patched (Q5);
// (9b, IMPL-9b §1.2, §6) a set tile's (set: a FAMILY.sets id — 's35' / 's55') that set patched as its starter (makeSet; the
// Model 15's = makeSet('m15'), bit-identical)
function patchNew(t, dev, type = null, set = null) {
  const d = t.dev[dev], f = PT.familyOf(d.model);
  if (type) { const r = PT.addModule(PT.fresh(f), d.vals, type); d.patch = r.mid ? r.rec : PT.fresh(f); return; }
  const r = (set && MG.makeSet(set, d.vals)) || MG.model15(d.vals);
  if (!r) { d.patch = PT.fresh(f); return; }                          // (no module numbers left in vals.p's range: the controller alone, as the module tile's refusal above)
  d.patch = r.rec; d.vals = r.vals;
}
function drumOf(t, dev) {
  if (!isDrumDev(t, dev)) return null;
  const d = t.dev[dev];
  if (!d.drum || typeof d.drum !== 'object' || !Array.isArray(d.drum.keys) || (d.drum.m || 'tr808') !== d.model) d.drum = DC.normDrum(d.drum, d.model);
  return d.drum;
}
// (§5) the sample slots that are on, of every drum machine of the track, each id once: the worklet entries its payloads
// name — ensured (levels 2: TUNING's ± 1 octave plays level 0 or 1) with the patch's own needs, never instead of them;
// (7c §1.2) by the machine's own sound keys (PERS[model].sounds: the 909's ride and crash are rd / cr on ids 7 / 8)
const drumLv = t => (drumDevs(t).length && !sxIds(t).length ? 2 : 0); // (the playback levels a drum track's samples ask; 0: the default, full)
const drumSnds = (t, dev) => DC.PERS[t.dev[dev].model].sounds;
function drumNeeds(t) {
  const out = [];
  for (const k of drumDevs(t)) {
    const D = drumOf(t, k);
    for (const s of drumSnds(t, k)) { const e = D.smp && D.smp[s]; if (e && e.on && typeof e.id === 'string' && !out.includes(e.id)) out.push(e.id); }
  }
  return out;
}
// Every track owns an FX rack state (any model; kept when the model changes, §2.5). FX state v2 everywhere (RULINGS2 F1):
// a track holds a v2 state (three racks of instances, §2.5); a v1 state reaching a track — an old project or autosave, a
// preset, a chain, the default preset — is migrated where it enters (fx-core normalizeFx = migrateFx1 for v1 input: S1-variant
// instances that render bit-identically to the Phase-1 rack, §2.6.3), with the track's Serum state as refs so the instances
// its rows / locks / MIDI map address are kept. fxOfDev() migrates anything that is still v1 (an object with `p`) the same way.
const isV2Fx = fx => !!fx && typeof fx === 'object' && fx.v >= 2 && Array.isArray(fx.racks);
const fxOk = fx => !!fx && typeof fx === 'object' && (isV2Fx(fx) || (!!fx.p && typeof fx.p === 'object'));
// the rack of a new track: a Serum track's from the default preset when it has one (migrated with its Serum state)
// ((WC) the default preset is the Serum's: a rig's rack is the plain default one)
function newFx(m) { const d = isSerumModel(m) ? sxDefault() : null; return d && fxOk(d.fx) ? fxLoad(clone(d.fx), d.v.s) : core.defaultFx2(); }
// the base value n of FX destination `id` (static g.* ids live in the Serum state) in a track's FX state: the instance's
// parameter (§3.16.4 fxDest; v1 ids of Hyper's Dimension rows resolve through RENAME1) — MIDI-learned controllers (midi.js writeCC)
function fxSet(t, id, n, dev) { // (dev: the instrument whose FX — null: the primary's)
  const fx = fxOfDev(t, dev);
  const d = core.fxDest(id, fx);
  if (d && d.inst && d.inst.p && typeof d.inst.p === 'object') d.inst.p[d.pid] = n;
}
const clone = x => JSON.parse(JSON.stringify(x));
// stage 1e (IMPL-1e §3.3): the FX state of device `id` — a Serum's own (dev.fx), a panel's, a classic instrument's the panel
// it feeds; id null: the primary's (R3: fxOf's job, fxOf gone) — migrated in place (a v1 rack: fxLoad with the Serum state
// as refs). No such rack (a classic cabled straight to OUT): an empty one, detached — nothing is inserted
function fxOfDev(t, id) {
  if (id == null && t && t.dev) id = CMOD.primId(t);
  let d = t && t.dev ? t.dev[id] : null;
  if (d && d.kind === 'synth' && !isSxRec(d)) { const p = CMOD.destOf(t, id); d = p && t.dev[p].kind === 'panel' ? t.dev[p] : null; }
  if (!d) return core.defaultFx2();
  if (isV2Fx(d.fx)) return d.fx;
  d.fx = fxOk(d.fx) ? fxLoad(d.fx, isSxRec(d) && d.vals ? d.vals.s : undefined) : core.defaultFx2();
  return d.fx;
}
// every device of a track as it enters (a load: autosave, file, History's restore keeps the live states): Serum states
// through normalizeSerum (v1 → v2, §2.6), FX states through §2.6.3's normalizeFx — a v1 rack (any model) migrated with
// its Serum state as refs (the instances its rows / locks / MIDI map address are kept; the migrated rack renders
// bit-identically, golden shard 4) —, a classic instrument's values over its model's defaults, an unknown model as
// modelById reads it (R5: the primary and its FX too — loadProject's lines and bind's writes were this, for it alone)
function normDevs(t) {
  if (!t || !t.dev) return;
  for (const id of Object.keys(t.dev)) {
    const d = t.dev[id];
    if (!d || typeof d !== 'object') continue;
    if (d.kind === 'synth') {
      const m = modelById(d.model);
      d.model = m.id;
      if (isSxModel(m)) { d.vals = { s: core.normalizeSerum(d.vals && d.vals.s) }; d.fx = d.fx && typeof d.fx === 'object' ? fxLoad(d.fx, d.vals.s) : core.defaultFx2(); }
      else d.vals = Object.assign(defaults(m), d.vals);
      if (S.isDrum(m.id) && !(d.drum && typeof d.drum === 'object')) d.drum = DC.normDrum(undefined, m.id); // (7a: a drum machine without its record — an empty memory, the defaults; 7b: its machine's)
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
  const say = L => { if (!L.length) return; const txt = L.join(' · '); if (booted) notice(txt, 30000); else early.push([txt, 30000]); };
  if (!up.readOnly) {
    const sp = CM.splitTracks(o, { name: id => modelById(id).name });
    if (sp.p !== o) splitFrom = json;
    o = sp.p;
    say(sp.notices.concat(Array.isArray(up.notes) ? up.notes : [])); // ((WC, §2.4) upgrade()'s notes: a Serum shown as parts opens whole — its notice, the 1f idiom)
  }
  const p = S.deserialize(o);
  CM.stamp(p, o);
  p.perf = S.normPerf(p.perf); // (stage 2a: { wheel: { v: 1 } | null })
  p.pads = PC.normPads(p.pads); // (8, §10.1: the Pads modules — deserialize bounds a file's; anything else [])
  if (p.master && p.master.fx) p.master.fx = fxLoad(p.master.fx); // ((M, §2.3) the master rack: normalised as a panel's)
  for (const k of ['drawLen', 'follow', 'ghosts']) if (o && k in o) p[k] = o[k];
  const byId = new Map(((o && o.tracks) || []).map(t => [t && t.id, t]));
  for (const t of p.tracks) { // a record song.js read as v1 (no valid devices): its 303 pattern and rack from the record
    const r = byId.get(t.id);
    if (t.dev) continue;
    if (r && r.seq && Array.isArray(r.seq.pat)) t.seq = r.seq;
    if (r && r.fx && typeof r.fx === 'object') t.fx = r.fx;
  }
  adopt(p); // (SPEC-canvas §5.4: v2 tracks, a v1 record converted in place)
  for (const t of p.tracks) normDevs(t); // (SPEC-serum2 §12.6, §15.1 item 6: every device normalised; saved with v2 racks)
  for (const t of p.tracks) for (const k of patchDevs(t)) t.dev[k].vals = PT.pruneVals(t.dev[k].vals, patchOf(t, k)); // ((9, §1.2) a 900 Series' orphan knobs go at a load only — History's restores keep them, §1.5)
  CMOD.prunePads(p); // ((8, review #28) a row whose Pads module or mod pad is gone — a partial or hostile file —, a lay entry of a missing module)
  if (up.readOnly) { if (lo.file) p.newerSchema = up.from; else goReadOnly(up.from); }
  return p;
}
function freshProject(m) {
  const p = adopt(CM.stamp(S.newProject({ model: m.id, vals: loadVals(m), name: 'Untitled', trackName: m.name + ' 1' })));
  for (const t of p.tracks) { newRack(t, m); seedPend.add(t.id); for (const k of patchDevs(t)) { patchNew(t, k); t.dev[k].vals = PT.pruneVals(t.dev[k].vals, t.dev[k].patch); } } // ((9) #m900: the Model 15 set as Classic bass, §1.4)
  p.perf = S.normPerf(null); // (stage 2a: no Mod Wheel module yet)
  p.pads = PC.normPads(p.pads); CMOD.prunePads(p); // ((8) no Pads module yet: [])
  return p;
}
// a new track's rack (R5: on its FX device once adopted — a Serum's own, a classic's panel): the default preset's (newFx)
function newRack(t, m) { const f = CMOD.fxDevOf(t); if (f) f.dev.fx = newFx(m); }
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
    const old303 = store.get('synth.seq303', null), d0 = instOf(project.tracks[0]);
    if (old303 && d0.model === 'tb303') d0.seq = old303;
  }
}
const hist = new S.History(200);
const trk = () => project.tracks.find(t => t.id === project.selTrack) || project.tracks[0];
/* Stage 1e (IMPL-1e §4.5): several instruments per track. The selected track's CURRENT instrument (curDev: the last tapped
   instrument module, default the primary) is read where it is meant — curView(), curModel(), curPanel() (milestone 3, R6:
   no globals model / vals / cpanel). The single-instrument services (ClassicPanel, the preset actions, Save / Delete / Init
   sound, the 303 page, the Serum and FX rack hosts) take a device view: a track-shaped view of one instrument (instView:
   id 'trackId/dev'; model / vals / preset / seq / fx of the device; name / colour / notes of the track), the primary's
   too (R1); trOf / dvOf give the track and the device back. */
const curDevs = new Map(); // track id → its current instrument
// (stage 1f: one instrument per track in the UI — the current instrument is always the primary; curDevs / setCur stay for
// the cv.add / cv.setCur hooks and milestone 3's parts, unread here)
const curOf = t => CMOD.primId(t);
// (milestone 3, R1) every instrument has its view, the primary too (instView never hands out the track): dvOf(x) its device
// (a bare track: its primary), isPrim(x) the track's primary. (R4) A view's id is 'trackId/dev' for every instrument, the
// primary too: the key of every session map (presetKeys, sxKeys, sxDirty, voiceShown, voiceOpt, seqHw, dxHw; none saved)
const trOf = x => (x && x.track) || x, dvOf = x => (x && x.track ? x.devId : x && x.dev ? CMOD.primId(x) : null);
const isPrim = x => !x || !x.track || x.devId === CMOD.primId(x.track);
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
  set fx(v) { const d = this.d; if (isSxRec(d)) d.fx = v; else { const p = CMOD.destOf(this.track, this.devId); if (p && this.track.dev[p].kind === 'panel') this.track.dev[p].fx = v; } },
};
const views = new WeakMap(); // track → Map(dev → its view)
function instView(t, dev) {
  if (dev == null && t && t.dev) dev = CMOD.primId(t);
  if (!t || !t.dev || dev == null || !CMOD.instOf(t, dev)) return t;
  let M = views.get(t);
  if (!M) views.set(t, M = new Map());
  let v = M.get(dev);
  if (!v) { v = Object.create(VIEW); v.track = t; v.devId = dev; M.set(dev, v); }
  return v;
}
const curView = (t = trk()) => instView(t, curOf(t));
// a session map's key 'trackId/dev' (R4; a bare track id: its primary) → that instrument's view | null
const viewOfKey = k => { const i = typeof k === 'string' ? k.indexOf('/') : -1, t = project.tracks.find(x => x.id === (i < 0 ? k : k.slice(0, i))); return t ? instView(t, i < 0 ? null : k.slice(i + 1)) : null; };
// the current instrument's model (R6: read, never a global)
const curModel = () => { const t = trk(); return modelById(instOf(t, curOf(t)).model); };
let bound = ''; // (the instrument bind() last saw, 'trackId/dev:model': selectTrack re-binds when it changed)
function bind() { // (R5: reads only — every device is normalised as it enters, normDevs; R6: no globals)
  const t = trk(), iv = curView(t); project.selTrack = t.id; bound = iv.id + ':' + iv.model;
}
bind();

let saveT = 0;
// now: the page is going away (pagehide / beforeunload / hidden) — the IndexedDB store starts its transaction in this task
// (appstore saveNow), as Phase 1 wrote localStorage synchronously here
function save(now) {
  clearTimeout(saveT); saveT = 0;
  if (rollViewT) rollViewSave(); // a Piano Roll row height still waiting for its debounce
  store.set('synth.settings', settings);
  // the per-model value memory (R6: the current instrument's view, written per model as before — a new instrument of the
  // model starts there, loadVals)
  const iv = curView(), m = modelById(iv.model);
  if (!isSxModel(m) && m.family !== 'patch' && iv.track && iv.vals) store.set('synth.v.' + m.id, iv.vals); // ((9) a patch's knobs belong to its record: none kept)
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
  // (9, IMPL-9 §3.6 P-1) a 900 Series is graphed: a muted / soloed-out one is powered off by {t: 'power', i} (graph nodes only)
  if (ids.some(k => isPatchDev(tr, k))) return false;
  // (2b) a track with a ModCore payload is graphed: its rows name device ids (dst.inst 'i2', chain 'fx1'), which the
  // legacy node's i0 / c0 are not — a 2a-only track (no payload) keeps today's stream
  if (!buildMods(tr).off) return false;
  return ids.length === 1 && c.inst === ids[0] && Object.keys(tr.dev).every(k => !tr.dev[k] || tr.dev[k].kind !== 'panel' || (!!f && !f.own && k === f.id));
}
// Stage 2b (IMPL-2b §3.1): the track's {t: 'mods'} payload — cv-graph compileMods (memoised there by content: a knob turn
// on an uncabled instrument rebuilds nothing; `key` is the content key the poster compares), or { off: true } when
// nothing is left for ModCore to evaluate (no rows, ext slots or value sources: a track whose modules were deleted, or
// a 2a-only track) — the posting from queuePatch's path and into processorOptions is the integrator's (lane D)
function buildMods(tr) { // ((8, §5.3) padVal: a mod pad's live value — not in the memo signature: a press never reposts)
  const pay = tr && tr.dev ? CG.compileMods(tr, project, { smooth: prefs.smooth, qr: null, ultra: 0, padVal: padValOf }) : null;
  const out = pay && (pay.rows.length || pay.ext.length || pay.vals.length) ? pay : { t: 'mods', i: tr && tr.id, off: true, key: 'off' };
  if (tr) modsLast.set(tr.id, out);
  modsBuilt++;
  return out;
}
// (fixer C, C4) the payload last built per track, for the paths that run at the monitor rate or per pointer move (cpSnap,
// modVal, the cables' dashed set, the meters): they read it, never compile — every edit path rebuilds it through
// queuePatch → postMods on the next frame (a frame's staleness, harmless there)
const modsLast = new Map(); // track id → payload | { off }
let modsBuilt = 0; // (tests: the builds counted)
const modsPay = tr => (tr && modsLast.get(tr.id)) || buildMods(tr);
// the cables' dashed rows as one Set per refresh (cv-module asks host.cables.dashedSet once per cablesOf: one build, never one per cable)
const dashedOf = t => { const p = buildMods(t); return new Set(p.off ? [] : p.dashed); };
const modsExt = tr => { const p = buildMods(tr); return p.off ? [] : p.ext; }; // (the track's ext slots, for the injections)
// (lane D) the payload an offline render carries (processorOptions.mods; null without one)
const modsFor = tr => { const p = buildMods(tr); return p.off ? null : p; };
// (lane D) post the track's {t: 'mods'} to its node when the content key changed since the node's last (N.modsKey; a new
// node's payload travels in its processorOptions): a knob turn on an instrument never reposts it — a cabled classic
// knob's turn does (its transfer is in the key) —; {off: true} once after a posted payload when nothing is left (N1:
// a track that never had one gets no message at all). (fixer C, U2 / P4) while a classic knob drag holds the node
// (N.modsHold: valChanged's 'move' phase) a repost goes at most every MODS_MIN_MS — the rest waits on a timer —, and the
// gesture's end ('end') posts at once: a 15-move drag is a few reposts, not fifteen (the knob's own value still goes with
// every frame's patch; the repost carries only its transfer)
const MODS_MIN_MS = 66;
function postMods(tr, N) {
  const pay = buildMods(tr);
  if (N.modsKey === pay.key) return false;
  const now = performance.now();
  if (N.modsHold && !pay.off && now - (N.modsAt || 0) < MODS_MIN_MS) {
    if (!N.modsT) N.modsT = setTimeout(() => { N.modsT = 0; if (nodes.get(tr.id) === N && project.tracks.includes(tr)) postMods(tr, N); }, Math.max(1, MODS_MIN_MS - (now - (N.modsAt || 0))));
    return false;
  }
  if (N.modsT) { clearTimeout(N.modsT); N.modsT = 0; }
  const was = N.modsKey;
  N.modsKey = pay.key; N.modsAt = now;
  if (pay.off && (was === undefined || was === 'off')) return false;
  N.node.port.postMessage(pay);
  return true;
}
// Stage 2a (IMPL-2a §2.1, D11): a Serum's vals with its track's canvas mod rows injected into free matrix slots ({ s:
// merged }: compileSerum and fxModded2 both see them; vals.s untouched) — no rows: vals itself (the same bytes as before).
// 2b: with the track's ext slots and modules (ext rows, PER NOTE slot injection); a merged vals holding ext rows carries a
// non-enumerable `ext` mark so buildPatch compiles it with the ext flag (IMPL-2b §3.2; the merged copy is transient)
function modVals(tr, id, vals, m) {
  if (!isSxModel(m) || !tr.dev || !id || !vals || !vals.s) return vals;
  const rows = CG.modRowsFor(tr, id);
  if (!rows.length) return vals; // (no rows: nothing compiled — the track's payload is not even built)
  const inj = CG.injectMods({ vals }, rows, modsExt(tr), tr);
  if (inj.s === vals.s) return vals;
  const v = Object.assign({}, vals, { s: inj.s });
  if (inj.placed.some(x => /^ext\d+$/.test(x.src))) Object.defineProperty(v, 'ext', { value: true });
  return v;
}
function buildPatch(tr, sr, offline = false) {
  fxOfDev(tr, null); // (a v1 rack reaching the primary's FX device is migrated in place first, as before)
  const c = CG.compileTrack(tr), v1 = c.canonical ? c.v1 : CM.primV1(tr); // (the compile's plain v1 view of the primary)
  const m = modelById(v1.model), s = isSxModel(m) && v1.vals.s ? v1.vals.s : null;
  const mv = modVals(tr, c.canonical ? c.inst : CMOD.primId(tr), v1.vals, m);
  const patch = patchFor(m, mv, v1.fx, {
    sr: sr || (ctx ? ctx.sampleRate : 48000), bpm: project.bpm, drift: settings.drift / 10, hiss: 1, ext: mv.ext === true, // (2b: ext rows injected)
    // offline: no quality caps (the CP defaults; the touch-device stream / grain pools differ by ≈ 1 MB and a render has no
    // deadline); live: the device defaults and the safeguard's step
    qr: offline ? null : qrOf(qrStep), prefs: offline || !prefs.ultra ? prefs : Object.assign({}, prefs, { ultra: 0 }), seed: seedPend.has(tr.id),
  });
  if (s) {
    patch.osCap = offline ? 0 : sxCap;
    if (!offline) capQ4(patch);
  }
  if (!offline) voiceSeen(tr, CMOD.primId(tr), patch);
  return patch;
}
// Stage 1e (IMPL-1e §3.3): one instrument device's patch on a graphed node — cv-graph instPatch (a Serum with its own FX;
// a classic one without a rack: its panel is a {t: 'chain'}) with buildPatch's options and live fields (the Serum caps;
// the voice mode of the primary). A chain: the panel's FX state compiled as a classic track's rack (cv-graph chainPatch).
const liveOpts = (tr, sr, offline) => ({ sr: sr || (ctx ? ctx.sampleRate : 48000), bpm: project.bpm, drift: settings.drift / 10, hiss: 1,
  qr: offline ? null : qrOf(qrStep), prefs: offline || !prefs.ultra ? prefs : Object.assign({}, prefs, { ultra: 0 }), seed: seedPend.has(tr.id) });
function buildInstPatch(tr, id, sr, offline = false) {
  const d = tr.dev[id], m = modelById(d.model);
  const patch = CG.instPatch({ model: m.id, vals: d.vals, fx: isSxModel(m) ? fxOfDev(tr, id) : undefined }, liveOpts(tr, sr, offline), isSxModel(m) ? CG.modRowsFor(tr, id) : null, isSxModel(m) ? modsExt(tr) : null, tr); // (2a / 2b: its mod rows, the track's ext slots)
  if (isSxModel(m)) {
    patch.osCap = offline ? 0 : sxCap;
    if (!offline) capQ4(patch);
  }
  if (!offline) voiceSeen(tr, id, patch); // (R4: every instrument's voice label)
  return patch;
}
const buildChain = (tr, id, sr, offline = false) => CG.chainPatch(fxOfDev(tr, id), liveOpts(tr, sr, offline)); // (2b: unchanged — a cabled chain takes its vector from ModCore at run time)
// a track's whole graph form (c: its compileTrack): {graph, patches: {id: patch}, chains: {id: {fxr, fxrT}}, seqs: {id: s},
// needs} — the processorOptions of a node / an offline render (offline: no caps; a 303 only when synced, not running; a drum machine always, never running)
function graphParts(tr, sr, offline = false, c = CG.compileTrack(tr)) {
  const g = c.canonical ? CG.compileGraph(tr) : c, patches = {}, chains = {}, seqs = {}, needs = new Set();
  for (const { id } of g.graph.insts) {
    const p = patches[id] = buildInstPatch(tr, id, sr, offline);
    for (const x of p.needs || []) needs.add(x);
    if (tr.dev[id].model === 'tb303' && (!offline || seqOf(tr, id).sync)) seqs[id] = seqPayload(tr, id, offline ? { run: false } : undefined);
    else if (isDrumDev(tr, id)) seqs[id] = drumPayload(tr, id, offline); // (7a: a drum machine's plan and tables — offline too, SYNC off included: its notes play through its map, mutes and slots; a fresh session, never running)
    else if (isPatchDev(tr, id)) seqs[id] = patchPayload(tr, id); // ((9) a 900 Series' graph payload {pg, pk} — offline too: a bounce = live)
  }
  for (const x of drumNeeds(tr)) needs.add(x); // (7a §5: its sample slots that are on)
  for (const { id } of g.graph.chains) { const x = chains[id] = buildChain(tr, id, sr, offline); for (const n of x.fxr.needs || []) needs.add(n); }
  return { graph: ptPower(tr, Object.assign({}, g.graph), offline), patches, chains, seqs, needs: [...needs] };
}
// (9, IMPL-9 §3.6 P-1, the lead's decision) a muted or soloed-out track's 900 Series is off on the live node — the graph's `on`
// false (and its key marked: the change is posted with {t: 'power'}) —, so a silent patch costs nothing; heard again it starts
// fresh, its held keys restruck (the engine's power). Offline (a bounce: audible tracks only) never. (SC §1.3) A sidechain source
// stays on — keyed by a heard track or the master, transitively (scKeyed): the ghost kick sounds at gain 0 live as in the bounce
function ptPower(tr, graph, offline) {
  if (offline || audible(tr)) return graph;
  const off = graph.insts.filter(x => x.on && isPatchDev(tr, x.id)).map(x => x.id);
  if (!off.length || scKeyed(tr)) return graph;
  return Object.assign(graph, { insts: graph.insts.map(x => (off.includes(x.id) ? Object.assign({}, x, { on: false }) : x)), key: graph.key + '|p1:' + off.join() });
}
// the states a track's devices hold (the asset manager reads `~opsKey` / Convolve shapes from them; tracks() is the primary)
function learnStates(tr) {
  for (const id of Object.keys(tr.dev || {})) {
    const d = tr.dev[id];
    if (d && d.kind === 'synth' && isSxRec(d)) tables.learn({ s: d.vals && d.vals.s, fx: d.fx });
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
  if (patch.engine === 'drums') return { mode: 'drums', n: 16, prio: 'last', cap: false, seq: '', label: 'Drums' }; // (7a §8: one circuit per sound, any chord)
  const div = patch.engine === 'divide', mode = div || patch.mode === 'poly' ? 'poly' : patch.mode === 'unison' ? 'unison' : 'mono';
  const n = div ? Infinity : mode === 'poly' ? Math.max(1, patch.poly | 0) : 1;
  const vo = s && s.voicing, sp = s && s.p;
  const cap = mode === 'poly' && !!vo && Number.isFinite(+vo.poly) && clamp(Math.round(+vo.poly), 1, 32) > n;
  const seq = sp && +sp['arp.on'] >= 0.5 ? 'Arp' : sp && +sp['clip.on'] >= 0.5 ? 'Seq' : '';
  const label = (mode === 'mono' ? 'Mono' : mode === 'unison' ? 'Unison' : div ? 'Poly' : 'Poly ' + n) + (cap ? ' (CPU cap)' : '') + (seq ? ' · ' + seq : '');
  return { mode, n, prio: patch.prio || 'last', cap, seq, label };
}
// an instrument's voice mode without building its patch (no FX rack, no Serum compile): the classic model's map (a few µs),
// the Serum state's voicing as compileSerum reads it; capped as buildPatch caps a live patch. d: a device ({ model, vals };
// a track's: instOf(t))
function trackVoice(d) {
  const m = modelById(d.model), v = d.vals || {};
  if (isSxModel(m)) {
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
  if (!voiceDef.has(m.id)) voiceDef.set(m.id, isSxModel(m) ? voiceInfo({ engine: 'serum', mode: 'poly', poly: 8 }) : trackVoice({ model: m.id, vals: defaults(m) }));
  return voiceDef.get(m.id);
}
// what the instrument menu entry of each instrument's model and the track tab show ('trackId/dev' → label, option; the
// row chip and the tab: the primary's, vkey(t)); a patch that changes a mode (an assign-mode knob, Serum's voicing, the CPU
// cap or its lifting) updates them (buildPatch, buildInstPatch: R4 — every instrument's)
const voiceShown = new Map(), voiceOpt = new Map();
const vkey = (t, dev = CMOD.primId(t)) => t.id + '/' + dev;
function voiceSeen(tr, dev, patch) {
  const d = instOf(tr, dev), k = vkey(tr, dev), l = voiceInfo(patch, isSxRec(d) ? d.vals.s : null).label;
  if (!voiceShown.has(k) || voiceShown.get(k) === l) return;
  voiceShown.set(k, l);
  const o = voiceOpt.get(k), sp = o && o.lastChild, b = o && o.parentNode;
  if (o && o.value === d.model) { // the row chip's voice span (its model name gives way to it, never the other way)
    if (sp && sp.className === 'hiv') sp.textContent = l; else o.textContent = modelById(d.model).name + ' · ' + l;
    if (b && b.className === 'hinst') b.title = instTitle(modelById(d.model).name, l);
  }
  if (tr.id === project.selTrack && dev === CMOD.primId(tr)) tabTrackUI();
}
// (stage 1e) a track of several instruments says so where one names its model / voice mode: "2 instruments"
const instN = t => (t && t.dev ? CMOD.instIds(t).length : 1);
const instsTxt = t => instN(t) + ' instruments';
function tabTrackUI() {
  const t = trk();
  if (!voiceShown.has(vkey(t))) voiceShown.set(vkey(t), trackVoice(instOf(t)).label);
  $('#tabTrack').textContent = cvMaster ? `Master · keys play ${t.name}` : `Track: ${t.name} · ${instN(t) > 1 ? instsTxt(t) : voiceShown.get(vkey(t))}`; // ((M) the master canvas: the keys still play the track
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
  scSync(tr); // ((SC §1.1) every FX state reaches the node here: its key edges first — an edge exists before the FXP naming its source lands
  const c = CG.compileTrack(tr);
  if (!legacyOk(tr, c) || N.graphed) { sendGraph(tr, N, c); return; } // (stage 1e: not one instrument, or a node that is graphed)
  const p = buildPatch(tr);
  seedPend.delete(tr.id);
  // §9.5: the assets the patch can play (Serum needs ∪ FX needs) are posted before it; a patch that replaces a posted
  // variant of an asset (trim / fade, Convolve shaping) waits for the new variant, so the old one keeps playing
  // (7a §5) a drum machine's track: its sample slots that are on join the patch's needs (ensure replaces a track's list)
  const dn = drumNeeds(tr), needs = dn.length ? [...new Set([...(p.needs || []), ...dn])] : p.needs;
  N.drIds = dn.join();
  if (!needs || !needs.length) { tables.release(tr.id); N.waitP = null; postPatch(N, p); return; }
  const d = instOf(tr), at = { trackId: tr.id, s: isSxRec(d) ? d.vals.s : null, fx: fxOfDev(tr, null), convMax: p.fxr && p.fxr.convMax };
  if (drumLv(tr)) at.levels = drumLv(tr);
  const done = tables.ensure(needs, at);
  if (tables.ready(needs)) { N.waitP = null; postPatch(N, p); return; }
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
  if (C.engine !== p.engine) { // the engine drops its tables when the model changes
    // ((7a) leaving 'drums' the Inst drops its DrSeq (engine setPatch): the payload key held for it goes, so the machine's
    // next drumSend — an undo / redo bringing it back — posts again, never deduped against a sequencer that is gone)
    // ((9) leaving 'patch' likewise: a machine re-entered starts with an empty graph (engine ptEmpty) — its payload goes again)
    if ((C.engine === 'drums' || C.engine === 'patch') && N.drPk) { if (i === undefined) N.drPk.clear(); else N.drPk.delete(i); }
    C.engine = p.engine; C.ctKey = ''; C.ctParts.clear(); C.sqParts.clear(); C.last = null;
  }
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
  N.drIds = drumNeeds(tr).join(); // ((7a) the drum slots its needs hold: drumSend asks again when they change)
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
    for (const id of fresh) { // (a new TB-303 Inst: its pattern, as a new node's options; (7a) a drum machine's payload, its content key kept)
      if (isDrumDev(tr, id)) { const s = drumPayload(tr, id); drPkOf(N).set(id, s.pk); post({ t: 'seq', s, i: id }); }
      else if (isPatchDev(tr, id)) { const s = G.seqs[id]; drPkOf(N).set(id, s.pk); post({ t: 'seq', s, i: id }); } // ((9) a new 900 Series Inst: its graph payload, its content key kept
      else post({ t: 'seq', s: seqPayload(tr, id), i: id });
    }
    postMods(tr, N); // (2b: the ModCore payload after the parts it names; off once when the rows went)
  };
  if (!G.needs.length) { tables.release(tr.id); N.waitP = null; go(); return; }
  learnStates(tr);
  const gat = { trackId: tr.id, convMax: convOf(G) };
  if (drumLv(tr)) gat.levels = drumLv(tr); // (7a §5: a drum machine's slots: 2 levels)
  const done = tables.ensure(G.needs, gat);
  if (tables.ready(G.needs)) { N.waitP = null; go(); return; }
  // ((9, review 1 F3) a 900 Series' graph payloads that patchSend held while this post waited follow it: its knobs ({t: patch}, in go) first)
  const late = () => { go(); const L = N.ptLate; N.ptLate = null; if (L) for (const [d, f] of L) patchSend(ptT(tr) || tr, d, f); };
  N.waitP = late; // (a newer post of the track replaces a waiting one)
  done.then(() => { if (N.waitP === late && nodes.get(tr.id) === N) { N.waitP = null; late(); } });
}
function queueAll() { for (const t of project.tracks) queuePatch(t); masterSend(); } // ((M, §2.1) the master chain too (the tempo): posted when it changed
// a classic panel wrote a value (ClassicPanel set): its preset becomes Custom, the patch, autosave
function valChanged(iv, id, ph) { // (iv: the panel's device view, stage 1e; ph (2b U2): a drag's 'move' / 'end', else nothing)
  const tr = trOf(iv), N = nodes.get(tr.id);
  if (ph === 'end') { if (N) N.modsHold = false; queuePatch(tr); return; } // (the gesture's end writes no value: the held repost goes with the frame — a rollback's preset name stays)
  if (id === 'alg') drawAlgo();
  if (iv.preset) { iv.preset = null; renderHeads(); }
  const k = tr.id + '/' + dvOf(iv);
  if (N && ph === 'move') N.modsHold = true; // (postMods: the transfer reposts of a cabled knob's drag coalesced)
  cpVer.set(k, (cpVer.get(k) || 0) + 1); // ((C4) the halo transfers' cache key: the instrument's values moved)
  queuePatch(tr); persist();
}
function refreshAll() { const P = curPanel(); if (P) P.refresh(); drawAlgo(); }

/* ------------------------------------------------------------- audio */
const nodes = new Map(); // track id -> { node, gain, pan, an (the meter's), sc (the OUT scope's), load, voices }
const quiet = p => { if (p && p.catch) p.catch(() => {}); };
// Internal rate cap: oversampling is a power of two with sampleRate × OS ≤ 384 kHz (more costs CPU for no audible gain)
const MAX_INTERNAL = 384000;
const osCap = sr => Math.max(1, 2 ** Math.floor(Math.log2(MAX_INTERNAL / sr + 1e-9)));
// the app setting (⚙ Oversampling: the models other than Serum), capped at 384 kHz and by plCap, the CPU safeguard's broadcast
// step (session only, as sxCap: idle-DSP review #9 — it was written into the setting, so a heavy moment lowered every later
// session; a Quality choice or a reload lifts it, liftCaps)
let plCap = 8;
const osFor = sr => Math.min(settings.os, osCap(sr), plCap);
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
// (d: a Serum device or view — R2: never a track)
const sxQuality = d => { const o = d.vals && d.vals.s && d.vals.s.global ? d.vals.s.global.os : 2; return o === 1 || o === 4 ? o : 2; };
const sxOSFor = (d, sr, offline = false) => Math.min(offline && prefs.ultra ? 4 : sxQuality(d), osCap(sr), offline ? 8 : sxCap);
// lifts every CPU-safeguard step (a Quality chosen on the GLOBAL page or the app's oversampling)
function liftCaps() {
  hotT = 0;
  if (sxCap < 8 || qrStep > 0) { sxCap = 8; qrStep = 0; for (const t of project.tracks) if (hasSx(t)) queuePatch(t); }
  if (plCap < 8) { plCap = 8; if (ctx) postAll({ t: 'os', v: osFor(ctx.sampleRate) }); } // (the other models back to the setting)
  if (ctx) for (const [id, N] of nodes) if (N.osI && N.osI.size) { // (stage 1e: the instruments lowered alone go back up)
    for (const i of N.osI.keys()) postTo({ id }, { t: 'os', v: osFor(ctx.sampleRate) }, i);
    N.osI.clear();
  }
  if (ctx) rateText();
  cvRelabel(); // (the modules' safeguard badges go)
}
const trackOS = (tr, sr) => { const d = instOf(tr); return isSxRec(d) ? sxOSFor(d, sr) : osFor(sr); }; // (a node's OS: its primary's)
// DSP scripts (classic scripts, one global scope per context; SPEC-serum2 §0.3, §12.1) load before the engine, all
// requested at once (none reads another's global at load, so their evaluation order does not matter); a missing or
// broken one only degrades its feature (Serum tracks silent, FX racks bypassed, …). The same list, in this order, is
// injected on the main thread (wk.loadDSP) for the panels' displays.
const DSP_FILES = ['sx-base.js', 'sx-filt2.js', 'sx-warp.js', 'sx-mod.js', 'sx-sample.js', 'sx-gran.js', 'sx-spec.js', 'sx-seq.js',
  'serum-dsp.js', 'fx-mods2.js', 'fx-dsp.js', 'dr-808.js', 'dr-seq.js', 'mod-core.js', 'patch-dsp.js', 'moog-dsp.js', 'master-dsp.js']; // ((M) the master meters, last)
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
    const f = () => { for (const N of nodes.values()) if (!N.ready) return; if (mnode && !mnode.ready) return; done(); }; // ((M) MASTER too)
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
      // (IMPL-M §1.1, §3) the mix: every track's pan → MASTER ('synth-master': the master FX rack and the meters; made once, here,
      // before any track node — held on WebKit) → the Mono stage → the Volume (settings.master: the listening level, never in a
      // file) → destination; `an` (8192: the master OUT's scope) and O1's splitter (two 2048 analysers: its image) off MASTER's
      // output — what is exported, pre-Mono, pre-Volume. The metronome stays outside the mix
      mnode = makeMaster(c);
      mono = c.createGain(); master = c.createGain(); master.gain.value = settings.master;
      an = c.createAnalyser(); an.fftSize = 8192; an.smoothingTimeConstant = 0.75;
      mnode.node.connect(an); mnode.node.connect(mono); mono.connect(master); master.connect(c.destination);
      if (typeof c.createChannelSplitter === 'function') {
        mSplit = c.createChannelSplitter(2); anL = c.createAnalyser(); anR = c.createAnalyser(); anL.fftSize = anR.fftSize = 2048;
        mnode.node.connect(mSplit); mSplit.connect(anL, 0); mSplit.connect(anR, 1);
      }
      monoApply();
      metroBus = c.createGain(); metroBus.gain.value = 1; metroBus.connect(c.destination);
      ctx = c; pendCtx = null; failMsg = ''; hotT = 0;
      const ready = hold ? whenReady(3000) : null;
      masterSync(); // (its rack, its subscriptions, the A/B as the session has them — before the tracks: §1.1)
      syncNodes();
      if (ready) { readyF && readyF(); await ready; if (ctx !== c) throw new Error('cancelled'); }
    } catch (err) {
      if (holdCtx === c) holdCtx = null;
      const mine = ctx === c || pendCtx === c;
      if (pendCtx === c) pendCtx = null;
      if (ctx === c) { ctx = null; an = master = metroBus = null; nodes.clear(); masterGone(); }
      else if (!ctx && mnode && mnode.node.context === c) masterGone();
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
  nodes.clear(); masterGone(); meterRun(null);
  if (cvView) for (const m of cvView.modules.values()) if (m.setCpu) m.setCpu(null); // (no engine: no module CPU)
  if (readyF) readyF(); // a power-on waiting for the engine's 'ready' gives up now (no nodes left)
  seqRun.clear(); for (const P of classicPanels.values()) if (!P.dead && P.model.id === 'tb303') P.seqRunUI(false); // (every 303 shown: RUN off)
  PERF.release(); // (1i: every bed and controller lets go)
  DRUM.panic(); // ((7a) every drum machine's session stops, nothing queued or lit; their payload keys went with the nodes)
  PADS.release({ hw: true }); // ((8, review #7) the Pads host ends its own pd<k> keys first — hardware pads too, the counts reset)
  for (const k of [...held.keys()]) { const [src, n] = k.split(':'); if (numSrc(src)) noteOff(+n, +src); } // ((8, R1-D) the keyboard's / MIDI's notes end through noteOff, as panic's: the pads following a track count the off — the nodes are gone, so no posts)
  for (const k of [...held.keys()]) held.delete(k);
  hk.clear();
  for (const n of [...keyEls.keys()]) keyVis(n, false);
  rollHeld();
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
  const pd = CMOD.primId(tr), dseq = !G && isDrumDev(tr, pd) ? drumPayload(tr, pd) : null; // ((7a) a drum machine's payload, §10.1)
  const po = { os: trackOS(tr, sr), hostOS: osFor(sr), patch, song: songData(tr), seq: !G && instOf(tr).model === 'tb303' ? seqPayload(tr) : dseq,
    trackId: tr.id }; // the MIDI OUT registry of the worklet scope (SPEC-serum2 §7.9)
  if (G) Object.assign(po, { graph: G.graph, patches: G.patches, chains: G.chains, seqs: G.seqs });
  const mods = G ? modsFor(tr) : null; // (2b: the ModCore payload with the parts, IMPL-2b §2.2; a legacy node has none)
  if (mods) po.mods = mods;
  const node = new AudioWorkletNode(ctx, 'synth-engine', { // ((SC §1.1) one stereo input on every Track node — the sidechain KEY, MASTER's options: fixed at construction, so a first key never rebuilds a node; unconnected it reads [] / [[]])
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
    processorOptions: po,
  });
  const gain = ctx.createGain(), pan = ctx.createStereoPanner(), a = ctx.createAnalyser(), sc = ctx.createAnalyser();
  a.fftSize = 512; // (the meter: the last 512 samples — a bigger window would hand it the oldest ones)
  sc.fftSize = 8192; sc.smoothingTimeConstant = 0.75; // (the OUT scope's own, the master's old size: scopeSource; the rack is in the node, so this is the chain after its FX, fader and pan)
  node.connect(gain); gain.connect(pan); pan.connect(mnode.node); pan.connect(a); pan.connect(sc); // ((M) the sum: MASTER's input
  const N0 = { node, gain, pan, an: a, sc, load: 0, voices: 0, os: 0, buf: new Float32Array(512), peak: 0, fxph: new Map(), phWait: new Map(), waitP: null, modsKey: mods ? mods.key : undefined,
    scIn: new Map() }; // ((SC §1.1) the key edges into this node: source id → { s: its node, kg: the edge's GainNode } — never `sc`, the OUT scope's analyser)
  const N = G ? graphCache(N0, tr, G.graph) : partCache(N0, patch);
  if (G) { // (every part starts with its options: the caches hold them)
    N.gkey = G.graph.key; N.gon = new Map(G.graph.insts.map(x => [x.id, x.on]));
    for (const id of Object.keys(G.patches)) N.insts.set(id, partCache({}, G.patches[id]));
    for (const id of Object.keys(G.chains)) N.chains.set(id, { xsKey: G.chains[id].fxrT ? G.chains[id].fxrT.key : '', last: G.chains[id].fxr });
  }
  if (dseq) drPkOf(N).set(pd, dseq.pk); // ((7a) what its options hold: an unchanged payload is not posted again)
  if (G) for (const k of Object.keys(G.seqs)) if (G.seqs[k] && G.seqs[k].pk) drPkOf(N).set(k, G.seqs[k].pk);
  N.drIds = drumNeeds(tr).join();
  const id = tr.id;
  node.port.onmessage = e => {
    const d = e.data, t = project.tracks.find(x => x.id === id) || tr;
    if (d.t === 'stats') { N.load = d.load; N.voices = d.voices; N.os = d.os || 0; if (d.snd === 1) sndT = performance.now(); statsText(); if (Array.isArray(d.per)) cvCpu(id, N, d.per); }
    else if (d.t === 'ready') { N.ready = true; if (readyF) readyF(); } // the processor is built (the first: warmed up)
    else if (d.t === 'step') { // (a graphed node names the 303: d.i; legacy: the primary)
      const dev = typeof d.i === 'string' ? d.i : CMOD.primId(t);
      // (7a, IMPL-7a §3.5) a drum machine's post (d.m: its measure) — to its panel at the heard time, COMPOSE's recording;
      // never the 303 branch, whose seqOf would write a 303 pattern onto the drum device
      if (d.m != null) { if (isDrumDev(t, dev)) DRUM.step(instView(t, dev), dev, d); }
      else if (t.id === project.selTrack && (seqRun.has(t.id + '/' + dev) || (T.playing && seqOf(t, dev).sync))) seqStepTo(t, dev, d.s);
    }
    else if (d.t === 'drumsErr') drumsErr(t); // ((7a) dr-808.js / dr-seq.js missing in the worklet: that machine is silent)
    else if (d.t === 'ptErr') ptErr(t, d); // ((9) patch-dsp.js / moog-dsp.js missing (why 'load'), or a payload item the machine dropped
    else if (d.t === 'smon') { if (d.fxph) { const k = rackKey(t, N, d); if (k) N.fxph.set(k, d.fxph); } monitors.deliver(id, d); }
    else if (d.t === 'modsErr') { N.modsKey = undefined; console.warn('ModCore rejected the payload' + (d.key ? ' ' + d.key : '') + ' of track ' + t.name); } // ((E6) the node dropped it: the next build reposts
    else if (d.t === 'fxph') { // (a rack's answer: its phase memory, its waiters)
      const k = rackKey(t, N, d), W = k ? N.phWait.get(k) : null;
      if (d.v && k) N.fxph.set(k, d.v);
      if (W) { N.phWait.delete(k); for (const f of W) f(d.v); }
    }
    else if (d.t === 'fxover' && Array.isArray(d.ids)) { // §8.5: the rack's 32 MB cap left these instances bypassed
      const part = typeof d.c === 'string' ? d.c : typeof d.i === 'string' ? d.i : null, fx = fxOfDev(t, part ? part.replace(/\/fx$/, '') : null); // (a legacy node: the primary's rack)
      const names = d.ids.map(x => (isV2Fx(fx) && core.instLabel(fx, x)) || x);
      notice(`FX memory limit reached — ${names.join(', ')} bypassed (track “${t.name}”)`, 8000);
    }
  };
  if (T.playing && T.a) node.port.postMessage(Object.assign({ t: 'transport', play: true, seek: true }, T.a));
  const lv = drumLv(tr) ? { levels: drumLv(tr) } : null, dn = drumNeeds(tr); // ((7a §5) a drum machine's slots that are on: 2 levels)
  if (G) { if (G.needs.length) { learnStates(tr); tables.ensure(G.needs, Object.assign({ trackId: tr.id, node, convMax: convOf(G) }, lv)); } }
  else if (patch.needs || dn.length) tables.ensure(dn.length ? [...new Set([...(patch.needs || []), ...dn])] : patch.needs, Object.assign({ trackId: tr.id, node, s: isSxRec(instOf(tr)) ? instOf(tr).vals.s : null, fx: fxOfDev(tr, null), convMax: patch.fxr && patch.fxr.convMax }, lv));
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
// (R3) the FX phase memory per rack: N.fxph and N.phWait are Maps by rack key — the device holding the rack: a Serum's id
// for its own FX, a panel's id. The rack a smon / fxph message is about: a legacy node's every one is its track's one rack
// (the primary's FX device: a Serum itself, a classic's panel); a graphed node names it ({i} a Serum's own FX, {c} a
// panel, 'iN/fx' that Serum's). rackKeys: the racks a node holds (a legacy node: that one; graphed: every Serum and panel)
function rackKey(t, N, d) {
  if (!N.graphed || (d.i === undefined && d.c === undefined)) { const f = CMOD.fxDevOf(t); return f ? f.id : null; }
  if (typeof d.c === 'string') return d.c.replace(/\/fx$/, '');
  return typeof d.i === 'string' && isSxDev(t, d.i) ? d.i : null;
}
function rackKeys(t, N) {
  if (!N.graphed) { const f = CMOD.fxDevOf(t); return f ? [f.id] : []; }
  return [...sxIds(t), ...Object.keys(t.dev).filter(k => t.dev[k] && t.dev[k].kind === 'panel')];
}
// ask rack k of track t's node for its phases (the engine answers per part: a legacy node's one rack, else {i} / {c}); f gets them
function askPhases(t, N, k, f) {
  (N.phWait.get(k) || N.phWait.set(k, []).get(k)).push(f);
  postTo(t, { t: 'fxph' }, k);
}
function syncNodes() {
  if (!ctx) return;
  const ids = new Set(project.tracks.map(t => t.id));
  for (const [id, N] of nodes) {
    if (ids.has(id)) continue;
    N.node.port.postMessage({ t: 'panic' }); N.node.port.postMessage({ t: 'bye' }); // bye: leave the MIDI OUT registry (§7.9)
    scCut(N); // ((SC §1.1) the key edges INTO it first: node.disconnect() cuts its outputs only, and a fed processor is never let go)
    N.pan.disconnect(); N.node.disconnect(); nodes.delete(id); tables.release(id);
  }
  for (const t of project.tracks) if (!nodes.has(t.id)) nodes.set(t.id, makeNode(t));
  scAll(); // ((SC §1.1) the key edges: a dropped source's go, a rebuilt one's re-bind, a new node's are made)
  mix();
}
function audible(t) {
  const solo = project.tracks.some(x => x.solo);
  return !t.mute && (!solo || t.solo);
}
function mix() {
  ptDim(); // ((9, §4.3) the shown 900 Series' cords dim with its track's mute / solo — the engine or not)
  if (!ctx) return;
  for (const t of project.tracks) {
    const N = nodes.get(t.id); if (!N) continue;
    N.gain.gain.setTargetAtTime(audible(t) ? t.vol : 0, ctx.currentTime, 0.015);
    N.pan.pan.setTargetAtTime(t.pan, ctx.currentTime, 0.015);
  }
  ptHeardSync();
}
// ((9) P-1: a track's 900 Series off / on with its mute / solo (ptPower), next frame — (SC §1.3) a sidechain source stays on: heard =
// audible or keyed (the ghost kick: a muted 900 Series keying a heard track, or the master, keeps sounding at gain 0). ptPower reads
// the project (scKeyed), so a 900 track sent earlier in the same frame's queue already had its power right
function ptHeardSync() {
  let K = null;
  for (const t of project.tracks) {
    const N = nodes.get(t.id); if (!N || !patchDevs(t).length) continue;
    const h = audible(t) || (K || (K = scKeySet())).has(t.id);
    if (N.ptHeard !== h) { N.ptHeard = h; queuePatch(t); }
  }
}
/* ---------------------------------------------------------- the sidechain (IMPL-SC §1, §6.1, §7) */
// Every Track node has one stereo input (§1.1): the KEY, the sum of the sources its v3 compressors name. Each edge is src.node →
// kg (its own GainNode) → node (input 0): kg 1 when a v3 compressor of the track names the source, 0 when only Duckers do — the
// edge then only orders the processing (Web Audio renders a node's sources first: the source writes its note frames to the
// registry before the keyed track reads them, S2). The source's own output is tapped: before its fader, pan and mute (the ghost kick).
// The sources a rack's sidechain units name (a Ducker; a v3 compressor — §5.1 `nv`: only a keyed compressor is a v3), splitter
// branches included, in walk order: [[source id, is a compressor]] appended to out
function scUnitsOf(fx, out) {
  if (!isV2Fx(fx)) return out;
  const one = I => {
    if (!I || typeof I !== 'object') return;
    const s = I.sub && typeof I.sub.src === 'string' ? I.sub.src : '';
    if (s && (I.type === 'duck' || (I.type === 'cmp' && I.v === 3))) out.push([s, I.type === 'cmp']);
    if (Array.isArray(I.br)) for (const B of I.br) if (Array.isArray(B)) for (const c of B) one(c);
  };
  for (const R of Array.isArray(fx.racks) ? fx.racks : []) if (R && Array.isArray(R.mods)) for (const I of R.mods) one(I);
  return out;
}
// a track's: every rack it holds (each panel's, each Serum's own — racks 0–2), device order; the master's
const scUnits = t => { const out = []; if (t && t.dev) for (const id of Object.keys(t.dev)) { const d = t.dev[id]; if (d && (d.kind === 'panel' || isSxDev(t, id))) scUnitsOf(d.fx, out); } return out; };
const scMasterUnits = () => (hasMasterFx() ? scUnitsOf(project.master.fx, []) : []);
// b is upstream of a over the edges E (a's sources, theirs …)
function scReach(E, a, b) {
  const seen = new Set(), st = [a];
  while (st.length) {
    const x = st.pop();
    if (x === b) return true;
    if (seen.has(x)) continue;
    seen.add(x);
    const m = E.get(x); if (m) for (const y of m.keys()) st.push(y);
  }
  return false;
}
// (§1.1, §1.4) the project's key edges — E: keyed track id → Map(source id → kg's gain) — built in a fixed order (project order, then
// each track's units in walk order): an edge is refused when it names the track itself or would close a loop with the edges accepted
// before it (a cycle without a DelayNode is muted by Web Audio, S5), and dropped when it names no track of the project (a deleted
// source: the unit idles, its id kept for undo). A function of the project alone — never of the nodes (the bounce reads it with the
// power off, §7.2). bad: the refused [track id, source id] pairs
function scGraph(p = project) {
  const ids = new Set(p.tracks.map(t => t.id)), E = new Map(), bad = [];
  for (const t of p.tracks) {
    for (const [s, cmp] of scUnits(t)) {
      if (!ids.has(s)) continue;
      const m = E.get(t.id);
      if (m && m.has(s)) { if (cmp) m.set(s, 1); continue; }
      if (s === t.id || scReach(E, s, t.id)) { bad.push([t.id, s]); continue; }
      (m || E.set(t.id, new Map()).get(t.id)).set(s, cmp ? 1 : 0);
    }
  }
  return { E, bad };
}
const scWant = (t, G = scGraph()) => (t && G.E.get(t.id)) || new Map(); // (source id → gain)
const scSrcs = (t, G) => new Map([...scWant(t, G)].filter(([id]) => nodes.has(id))); // (those with a node)
const scCycle = (t, src) => !!t && (src === t.id || scReach(scGraph().E, src, t.id));
// the track ids a heard track or the master keys from, transitively (§1.3; the bounce's closure without its MIDI OUT half)
function scKeySet(G = scGraph()) {
  const K = new Set(), st = [], add = id => { if (!K.has(id)) { K.add(id); st.push(id); } };
  for (const [s] of scMasterUnits()) add(s);
  for (const t of project.tracks) if (audible(t)) { const m = G.E.get(t.id); if (m) for (const s of m.keys()) add(s); }
  while (st.length) { const m = G.E.get(st.pop()); if (m) for (const s of m.keys()) add(s); }
  return K;
}
const scKeyed = t => !!t && scKeySet().has(t.id);
// (§7.1) any sidechain unit with a source, in any track's rack or the master's (asked at an anchor: a walk of the racks)
const scAny = () => project.tracks.some(t => scUnits(t).length > 0) || scMasterUnits().length > 0;
// a node's key edges cut (its drop: the source's tap and the GainNode both; either may be gone already)
function scCut(N) {
  if (!N || !N.scIn) return;
  for (const e of N.scIn.values()) { try { e.s.disconnect(e.kg); } catch { /* cut with its node */ } try { e.kg.disconnect(); } catch { /* gone */ } }
  N.scIn.clear();
}
const scSaid = new Set(); // ('track>source': a refused edge's notice, once a session)
// track t's node gets the edges its units name (G's): an edge whose source left them — or whose node was rebuilt under its id —
// is cut, a missing one made, every gain set (0 ↔ 1 moves only a compressor's key). → whether an edge came or went
function scSync1(t, G) {
  const N = t && nodes.get(t.id);
  if (!N || !ctx) return false;
  const want = G.E.get(t.id), E = N.scIn;
  let ch = false;
  for (const [id, e] of E) {
    const S = nodes.get(id);
    if (want && want.has(id) && S && S.node === e.s) continue;
    try { e.s.disconnect(e.kg); } catch { /* the source's node went: its outputs are cut */ }
    try { e.kg.disconnect(); } catch { /* gone */ }
    E.delete(id); ch = true;
  }
  if (want) for (const [id, g] of want) {
    const S = nodes.get(id);
    if (!S) continue;
    const e = E.get(id);
    if (e) { if (e.kg.gain.value !== g) e.kg.gain.value = g; continue; }
    const kg = ctx.createGain();
    kg.gain.value = g; S.node.connect(kg); kg.connect(N.node, 0, 0);
    E.set(id, { s: S.node, kg }); ch = true;
  }
  for (const [k, s] of G.bad) {
    if (k !== t.id || scSaid.has(k + '>' + s)) continue;
    scSaid.add(k + '>' + s);
    const nm = id => { const x = project.tracks.find(y => y.id === id); return x ? '“' + x.name + '”' : id; };
    notice(s === k ? `Not connected: ${nm(k)} can't duck with itself` : `Not connected: ${nm(s)} already ducks with ${nm(k)} — a loop would need a delay`, 6000);
  }
  return ch;
}
// (sendPatch, before it posts: every FX state passes there) a track's edges; when they change, every other track's too (a loop
// refused before may be allowed now) and the 900 Series' power (a keyed one stays on). A track without units or edges: nothing
function scSync(t) {
  const N = t && nodes.get(t.id);
  if (!N || !ctx || (!N.scIn.size && !scUnits(t).length)) return false;
  const G = scGraph();
  if (!scSync1(t, G)) return false;
  for (const u of project.tracks) if (u !== t) scSync1(u, G);
  ptHeardSync();
  return true;
}
// (syncNodes, after its creation loop) every track's
function scAll() {
  if (!ctx) return;
  const G = scGraph();
  for (const t of project.tracks) scSync1(t, G);
}
// (§6.1) the source menus' host member: self (the keyed track's id; the master: null), uid (the project's — a rack clipboard pasted
// into another project blanks its sources, §1.3), list (project order; a shared name told apart by the track's number in the list:
// "Kick · 3"; drum: a drum machine source), notes(id) (a drum machine source: its lanes' primaries and names, drumRowsOf — the notes
// the registry stores —, else null: the 128 notes), ok(id) ('' or why the source is refused: the track itself, a loop)
function scSources(self) {
  const L = project.tracks, cnt = new Map();
  for (const t of L) cnt.set(t.name, (cnt.get(t.name) || 0) + 1);
  const list = L.map((t, i) => ({ id: t.id, name: cnt.get(t.name) > 1 ? t.name + ' · ' + (i + 1) : t.name, drum: drumDevs(t).length > 0 }));
  const nameOf = id => { const e = list.find(x => x.id === id); return e ? e.name : id; };
  let E = null;
  return {
    self: self == null ? null : self, uid: project.uid || '', list,
    notes: id => { const t = L.find(x => x.id === id), k = t ? drumDevs(t)[0] : null; return k ? drumRowsOf(t.dev[k]) : null; },
    ok: id => {
      if (self == null || typeof id !== 'string') return '';
      if (id === self) return 'A track can\'t duck with itself. Pick another source.';
      if (!E) E = scGraph().E;
      return scReach(E, id, self) ? `${nameOf(id)} already ducks with ${nameOf(self)} — a loop would need a delay. Pick another source.` : '';
    },
  };
}
// (§1.3) track ids are reused (song.js: the highest + 1): a new track's id passes every source a unit names — the master's too — so
// a deleted source kept for undo never re-binds to a newcomer; undefined when song.js's own pick is past them already
function scFreshId() {
  const k = id => { const x = /^trk_(\d{1,9})$/.exec(id); return x ? +x[1] : 0; };
  let n = 0, m = 0;
  for (const t of project.tracks) { n = Math.max(n, k(t.id)); for (const [s] of scUnits(t)) m = Math.max(m, k(s)); }
  for (const [s] of scMasterUnits()) m = Math.max(m, k(s));
  return m > n ? 'trk_' + (m + 1) : undefined;
}
// dev (stage 1e): the device the message is for — on a graphed node it gains `i` (an instrument; a Serum's own FX 'iN/fx':
// its Serum) or `c` (a panel), and with aud an audition note `aud` (that Inst alone); legacy nodes never get them
function postTo(tr, m, dev, aud) {
  if (tr && tr.id === MASTER) { if (mnode) mnode.node.port.postMessage(m); return; } // ((M) MASTER: its monitors, its rack's tap
  const N = tr && nodes.get(tr.id);
  if (!N) return;
  if (dev != null && N.graphed) {
    const t = project.tracks.find(x => x.id === tr.id), d = t && t.dev ? t.dev[dev] : null;
    m = Object.assign({}, m, d && d.kind === 'panel' ? { c: dev } : { i: String(dev).replace(/\/fx$/, '') });
    if (aud && m.i) m.aud = 1;
  }
  N.node.port.postMessage(m);
}
// every track's node; (IMPL-M §2.1) a transport or a panic reaches MASTER too — one rule, so no site misses it ('os' never does)
function postAll(m) {
  for (const N of nodes.values()) N.node.port.postMessage(m);
  if (mnode && (m.t === 'transport' || m.t === 'panic')) mnode.node.port.postMessage(m);
}
/* ---------------------------------------------------------- the master (IMPL-M §2) */
// MASTER's record (§2.1): { node, ready, load, lat, cpu, xsKey, last, waitC, gr, ftap, fxph } — beside `nodes`, never in it
// (syncNodes would drop it, statsText count it as a track, postAll reach it with 'os'). Its rack is project.master.fx (absent:
// an empty master — no key until the first edit), compiled with qr null live and offline (§2.1: the safeguard's quality steps
// never reach it — the same rack both ways, M2). Not in History (the track racks' knob policy); an undo keeps it (keepMaster).
const MASTER = 'master', MASTER_NAME = 'Master', MASTER_TINT = '#f2a33a';
function makeMaster(c) {
  const node = new AudioWorkletNode(c, 'synth-master', {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
  });
  const M = { node, ready: false, load: 0, lat: 0, cpu: undefined, xsKey: '', last: null, waitC: null, gr: null, ftap: null, fxph: null, phWait: null };
  node.port.onmessage = e => masterMsg(M, e.data);
  return M;
}
function masterMsg(M, d) {
  if (M !== mnode || !d) return;
  if (d.t === 'ready') { M.ready = true; if (readyF) readyF(); }
  else if (d.t === 'stats') { M.load = +d.load || 0; M.lat = d.lat | 0; statsText(); masterCpu(d.per); }
  else if (d.t === 'mmon') monitors.deliver(MASTER, d);
  else if (d.t === 'smon') { if (d.fxph) M.fxph = d.fxph; monitors.deliver(MASTER, d); }
  else if (d.t === 'fxph') { if (d.v) M.fxph = d.v; if (M.phWait) { const f = M.phWait; M.phWait = null; f(d.v); } }
  else if (d.t === 'ab') abShown(!!d.on, d.g, d.lim);
  else if (d.t === 'fxover' && Array.isArray(d.ids)) { const fx = masterFx(); notice(`FX memory limit reached — ${d.ids.map(x => (isV2Fx(fx) && core.instLabel(fx, x)) || x).join(', ')} bypassed (the master)`, 8000); }
}
// powerOff / a failed start: the record goes with its context (its assets' claim too)
function masterGone() {
  mnode = null; mono = mSplit = anL = anR = null; tables.release(MASTER);
  if (mrow) mrow.clear(); // (F5: no engine, no levels — the row and the OUT go to silence at once, not to the last reading)
  if (mout) mout.clear();
}
// the rack module's CPU slot on the master canvas (smoothed as a track part's)
function masterCpu(per) {
  const e = Array.isArray(per) ? per.find(x => x && x.id === 'mfx') : null, M = mnode;
  if (!e || !M || !Number.isFinite(e.load)) return;
  M.cpu = M.cpu === undefined ? e.load : M.cpu + 0.25 * (e.load - M.cpu);
  const m = cvMaster && cvView ? cvView.modules.get('mfx') : null;
  if (m && m.setCpu) m.setCpu(M.cpu);
}
// the master's FX rack: project.master.fx, or (none yet) one detached default per project — a UI-only edit stays in it; the first
// real edit makes it the project's (§2.3: absent = empty, no key until then)
let mfx0 = null, mfx0P = null;
const hasMasterFx = (p = project) => !!(p && p.master && isV2Fx(p.master.fx));
function masterFx() {
  if (hasMasterFx()) return project.master.fx;
  if (mfx0P !== project) { mfx0P = project; mfx0 = core.defaultFx2(); }
  return mfx0;
}
// a rack's instances (MAIN — the master's only rack —, a splitter's branches counted)
function fxCount(fx) {
  const R = isV2Fx(fx) && fx.racks[0] && Array.isArray(fx.racks[0].mods) ? fx.racks[0].mods : [];
  let n = 0;
  for (const I of R) { n++; if (I && Array.isArray(I.br)) for (const B of I.br) if (Array.isArray(B)) n += B.length; }
  return n;
}
const masterN = () => (hasMasterFx() ? fxCount(project.master.fx) : 0);
// the master chain {fxr, fxrT} at rate sr: the Track's chain compile (cv-graph chainPatch) with qr null — never the safeguard's step
const masterChain = sr => CG.chainPatch(masterFx(), { sr, bpm: project.bpm, prefs, seed: seedPend.has(MASTER), qr: null });
// the chain to MASTER when it changed (fxrT only when its tables did; deduped as a panel's postChain), after the assets it needs
// (a Convolve's IR: the asset manager's 'master' claim, posted to MASTER — its store messages land in the scope's shared store).
// An untouched project posts nothing (MASTER's fresh rack is calm: its copy path); a project whose master went (a load, New)
// posts the empty rack once, so the old one stops
function masterSend() {
  const M = mnode;
  if (!M || !ctx) return;
  if (!hasMasterFx() && !M.last) { seedPend.delete(MASTER); tables.release(MASTER); return; }
  const fx = masterFx(), x = masterChain(ctx.sampleRate), needs = (x.fxr && x.fxr.needs) || [];
  seedPend.delete(MASTER);
  const go = () => {
    M.waitC = null;
    const fxrT = x.fxrT && M.xsKey !== x.fxrT.key ? x.fxrT : null;
    if (fxrT) M.xsKey = fxrT.key;
    if (!fxrT && M.last && sameVal(x.fxr, M.last)) return;
    M.last = x.fxr;
    M.node.port.postMessage(fxrT ? { t: 'chain', fxr: x.fxr, fxrT } : { t: 'chain', fxr: x.fxr });
  };
  if (!needs.length) { tables.release(MASTER); go(); return; }
  tables.learn({ fx });
  const done = tables.ensure(needs, { trackId: MASTER, node: M.node, fx, convMax: x.fxr.convMax });
  if (tables.ready(needs)) { go(); return; }
  M.waitC = go; // (a newer chain replaces a waiting one)
  done.then(() => { if (M.waitC === go && mnode === M) go(); });
}
// a new MASTER (powerOn): its rack, its meters' subscriptions, the session's A/B
function masterSync() {
  if (!mnode) return;
  masterSend();
  monitors.on.delete(MASTER); monitors.sync();
  if (mstate.ab) { mstate.g = null; mstate.lim = false; abShow(); mnode.node.port.postMessage({ t: 'bypass', on: true, g: true }); } // (the new MASTER measures the match afresh: pending until it answers)
}
// (§2.2) the master rack's edits (its FX module, the asset manager's relink): mutate, compile, post, persist — never a History
// step (a track rack's knob policy) and no fxPrune (the master has no mod rows); seed: a chain / module preset loaded
function masterEdit(fn, o) {
  const fx = masterFx();
  fn(fx);
  if (o && o.ui) { if (hasMasterFx()) persist(); return; }
  if (!project.master || typeof project.master !== 'object') project.master = {};
  project.master.fx = fx;
  if (o && o.seed) seedPend.add(MASTER);
  masterSend(); persist();
  masterRelabel();
  ptHeardSync(); // ((SC §1.3) a muted 900 Series the master's Ducker names stays on)
}
// keepMaster (§2.3): an undo / redo within the project keeps the current master rack — the snapshot's lay comes back with its step
function keepMaster(p, cur) {
  const fx = cur && cur.master && cur.master.fx;
  if (fx) { if (!p.master || typeof p.master !== 'object') p.master = {}; p.master.fx = fx; }
  else if (p.master && typeof p.master === 'object') { delete p.master.fx; if (!p.master.lay) delete p.master; }
}
/* the listening controls (§3: never in a file — M2): Mono (the mono stage), the A/B (MASTER's own crossfade, level-matched: Q3);
   session state, not saved (a reload resets both, so nobody forgets one on) */
const mstate = { mono: false, ab: false, g: null, lim: false }; // (g: the A/B's frozen match in dB — null while pending (no valid match yet) —, lim: the boost was capped by the input's headroom)
function monoApply() { if (mono) { mono.channelCountMode = mstate.mono ? 'explicit' : 'max'; mono.channelCount = mstate.mono ? 1 : 2; } }
function monoSet(on) {
  mstate.mono = !!on; monoApply();
  if (mrow) mrow.setMono(mstate.mono);
  if (mout) mout.setMono(mstate.mono);
}
// both buttons from the session's state: off plain, else the match (null: pending "A/B …"; lim: "(peak-limited)")
function abShow() {
  const g = mstate.ab ? mstate.g : undefined;
  if (mrow) mrow.setBypass(mstate.ab, g, mstate.lim);
  if (mout) mout.setBypass(mstate.ab, g, mstate.lim);
}
function abSet(on) {
  mstate.ab = !!on; mstate.g = null; mstate.lim = false; // (a tap: pending until MASTER answers with its match)
  abShow();
  if (mnode) mnode.node.port.postMessage({ t: 'bypass', on: mstate.ab, g: true }); // (g true: MASTER freezes the match at the tap)
}
// MASTER's answer {t: 'ab', on, g, lim}: g the match gain it froze (null: still pending — both short-term meters are not valid yet),
// lim: the boost was capped by the input's headroom (the button reads "A/B −3.2 dB", "A/B …", "A/B +2.1 dB (peak-limited)")
function abShown(on, g, lim) {
  if (on !== mstate.ab) return; // (a later tap is on its way)
  mstate.g = g === null ? null : Number.isFinite(g) ? g : 0;
  mstate.lim = !!lim && mstate.g !== null;
  abShow();
}
// R1-3: a project change (Open, New, an undo of either) ends the A/B — its frozen match belongs to the old project's rack: the new
// one would play its bypassed signal that many dB off
function abEnd() { if (mstate.ab) abSet(false); }
/* status: the Power LED shows a context that is actually running; a suspended/interrupted one asks for a tap */
// The notice line: a timed message (notice), else the sticky one (audio problems), else the factory generation progress
// (genProgress, §9.7). The progress text alone carries the tap-to-cancel action.
let noticeT = 0, sticky = '', pauseT = 0, genTxt = '';
const noticeActs = new Map(); // notice text → its tap action (attached only while that text shows)
function showNotice(txt) {
  const el = $('#notice');
  el.textContent = txt; el.hidden = !txt;
  if (txt) noticePlace();
  if (txt && txt === genTxt) { el.dataset.gen = '1'; el.onclick = genCancel; return; }
  if (el.dataset.gen) delete el.dataset.gen;
  const act = txt ? noticeActs.get(txt) : null;
  el.onclick = act || null;
  if (act) el.dataset.act = '1'; else if (el.dataset.act) delete el.dataset.act;
}
// ((WC pre-deploy [toast]) the 8 s "· tap to undo" lay centred on the canvas toolbar's row: a tap meant for Fit / Tidy landed on it and
// undid the last step) the line goes where cv-tray noticeSpot says over the boxes measured now — beside the toolbar's row, else above it
// past the minimap, else above both; with no toolbar (the roll) centred, clear of the keyboard's grip —, placed again while it shows
// when one of them moves: the stage's size (a window, a tray's height), the toolbar's (folded, the page-zoom chip, the canvas hidden), the
// minimap shown or hidden, the Sources tray opened, shut or sized (sideChanged; it moves the toolbar). (round 2 — the skeptic: a narrow
// window with the tray open left no room clear, the line kept the stylesheet's spot over the tray, the fold button, the tab) the top
// grip too, the line measured at each width a room offers (fit: its real wrap — whole words carried down — never an estimate), the
// stage taken from where it shows (a short window's track list runs over its top)
let noticeRO = null;
const noticeSeen = new WeakSet();
function noticePlace() {
  const el = $('#notice');
  if (!el || el.hidden || typeof el.getBoundingClientRect !== 'function') return;
  const box = n => { const r = n && typeof n.getBoundingClientRect === 'function' ? n.getBoundingClientRect() : null; return r && r.width > 0 && r.height > 0 ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null; };
  const st = el.style, map = $('#cvToolbar .cv-minimap'), st0 = box($('#stage')), perf = box($('#perf'));
  // (round 2) the stage's top where it shows: under the track list's rows where a short window lets them run over it (its Master row)
  let headB = -Infinity; for (const s of ['#topRow', '#arrbar', '#studio', '#mfoot']) { const r = box($(s)); if (r && r.bottom > headB) headB = r.bottom; }
  const stage = st0 && headB > st0.top ? Object.assign({}, st0, { top: Math.min(headB, st0.bottom - 1) }) : st0;
  if (noticeRO === null && typeof ResizeObserver === 'function') { try { noticeRO = new ResizeObserver(() => noticePlace()); for (const s of ['#stage', '#cvToolbar', '#srcTray']) noticeRO.observe($(s)); } catch (err) { noticeRO = false; } }
  if (noticeRO && map && !noticeSeen.has(map)) { noticeSeen.add(map); try { noticeRO.observe(map); } catch (err) { /* gone */ } }
  st.left = '0px'; st.transform = 'none'; st.maxWidth = 'none'; // (its one-line size)
  const n = el.getBoundingClientRect(), tray = $('#srcTray'), tab = $('#srcTab'), tb = box(tab);
  const open = !!stage && tray.classList.contains('open') && !!box(tray), L = stage ? stage.left + (open ? +tray.offsetWidth || 0 : 0) : 0; // (the tray's place when its glide ends)
  const g = box($('#kbGrip')), dy = stage && perf ? stage.bottom - perf.top : 0; // (the grip rides the keyboard tray's edge: where it rests, a fold still gliding)
  let lh = 0; try { lh = typeof getComputedStyle === 'function' ? parseFloat(getComputedStyle(el).lineHeight) || 0 : 0; } catch (err) { lh = 0; }
  const fit = mw => { st.maxWidth = mw + 'px'; const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, lines: lh > 0 ? 1 + Math.max(0, Math.round((r.height - n.height) / lh)) : 0 }; };
  const q = stage && perf ? cvTray.noticeSpot({ stage, bar: box($('#cvToolbar .cv-tb')), map: box(map), grip: g && { left: g.left, top: g.top + dy, right: g.right, bottom: g.bottom + dy },
    tray: open ? { left: stage.left, top: stage.top, right: L, bottom: stage.bottom } : null,
    tab: tb ? { left: L, top: tb.top, right: L + (+tab.offsetWidth || tb.right - tb.left), bottom: tb.bottom } : null, top: box($('#topGrip')), w: n.width, h: n.height, fit }) : null;
  if (!q) { st.left = st.transform = st.maxWidth = st.bottom = ''; return; } // (the stylesheet's spot)
  // (its foot over the keyboard tray's top edge — the stage's foot at rest, folded too (translateY(100%)): measured from the stage, never
  // from a tray still gliding)
  st.left = Math.round(q.x - perf.left) + 'px'; st.bottom = 'calc(100% + ' + Math.round(stage.bottom - q.bottom) + 'px)'; st.maxWidth = Math.floor(q.maxW) + 'px';
}
const idleNotice = () => sticky || genTxt;
let noticeLog = null; // (cvDeleteSel, while its paths run: what they say, in order — a refusal's reason joins the press's notice)
function notice(txt, ms) { if (noticeLog && txt) noticeLog.push(txt); clearTimeout(noticeT); noticeT = 0; showNotice(txt); if (ms) noticeT = setTimeout(() => { noticeT = 0; showNotice(idleNotice()); }, ms); }
function stickyNotice(txt) { sticky = txt; if (!noticeT) showNotice(idleNotice()); }
function powerUI() {
  const c = ctx || pendCtx, run = !!c && c.state === 'running', cpu = $('#cpu'), hold = !!c && c === holdCtx;
  // (IMPL-A §3.2 item 4) the app: the engine on / off told to native on each change — every power transition passes here
  // (powerOn, its failure, powerOff, resync); native keeps the screen awake while it is on (Q4)
  if (SHELL && !!c !== shellEng) { shellEng = !!c; shellPost({ t: 'engine', on: shellEng }); }
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
  if (os < settings.os) s += os < Math.min(settings.os, osCap(sr)) ? ` (${settings.os}× · CPU cap)` : ` (${settings.os}× capped)`;
  if (devRate && sr !== devRate) s += ` · resampled to ${kHz(devRate)} kHz`;
  // Serum instruments run at their own oversampling (Global quality, CPU cap) — (R2) every Serum of every track
  const sxs = project.tracks.flatMap(t => sxIds(t).map(id => t.dev[id]));
  const sx = [...new Set(sxs.map(d => sxOSFor(d, sr)))].sort((a, b) => a - b);
  const capped = sxs.some(d => sxOSFor(d, sr) < Math.min(sxQuality(d), osCap(sr)));
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
let statT = 0, hotT = 0, sndT = -Infinity; // sndT: the last report of a track that sounded ({t: 'stats'} snd: the safeguard's arm)
function statsText() {
  const now = performance.now();
  if (now - statT < 200 || !ctx || ctx.state !== 'running') return;
  statT = now;
  let load = 0, voices = 0;
  for (const N of nodes.values()) { load += N.load; voices += N.voices; }
  if (mnode) load += mnode.load; // ((M, §2.1) MASTER's too: the safeguard's sum — its levers stay the tracks')
  const pct = Math.round(load * 100), el = $('#cpu');
  el.textContent = `DSP load ${pct}% · ${voices} voice${voices === 1 ? '' : 's'} · ${nodes.size} track${nodes.size === 1 ? '' : 's'}`;
  el.classList.toggle('warn', pct > 75);
  if (pct > 75) el.textContent += ' — lower oversampling';
  // safeguard: summed load above 85% for 2 s (all tracks share one audio thread) -> drop oversampling one step — armed only while
  // an instrument sounds or did within 2.5 s (review #9: the engine's 2 s quiet rule, §6.4, plus a report: the tail right after
  // the playing, staccato gaps). Its levers lower what renders; in silence every instrument is skipped and the load is the racks'
  // (MASTER's, a sidechain panel on zeros) or a starved thread's — on Windows the idle denormal load stepped all down to 1×
  // (snd: a voice in any quantum of the report's window — a drum's short hit between two reports; a 900 Series is never quiet)
  if (load > 0.85 && now - sndT < 2500 && (maxOS() > 1 || qrLever())) { if (!hotT) hotT = now; else if (now - hotT > (load > 1 ? 1000 : 2000)) lowerOS(); }
  else hotT = 0;
}
// highest oversampling in use: the app setting (instruments of the other models) and Serum instruments (their own; a
// device has the track's `vals` shape: sxOSFor reads it). Stage 1e: every instrument of a track, not only its primary
const devsOf = t => (t.dev ? CMOD.instIds(t).map(id => t.dev[id]) : [t]);
const hasSx = t => devsOf(t).some(isSxRec), hasPlain = t => devsOf(t).some(d => !isSxRec(d));
function plainOS() { return project.tracks.some(hasPlain) ? osFor(ctx.sampleRate) : 0; }
function sxMaxOS() { let m = 0; for (const t of project.tracks) for (const d of devsOf(t)) if (isSxRec(d)) m = Math.max(m, sxOSFor(d, ctx.sampleRate)); return m; }
function maxOS() { return Math.max(plainOS(), sxMaxOS()); }
const qrLever = () => qrStep < QR_STEPS && project.tracks.some(hasSx);
// a graphed node's load by group (its parts' smoothed loads, N.cpu); a legacy node's by its model
function groupLoads(t, N) {
  if (!N.graphed || !N.cpu) return isSxRec(instOf(t)) ? [0, N.load] : [N.load, 0]; // (a legacy node: its one instrument)
  let lp = 0, ls = 0;
  for (const k of Object.keys(N.cpu)) { const d = t.dev[k.replace(/\/fx$/, '')]; if (isSxRec(d)) ls += N.cpu[k]; else lp += N.cpu[k]; }
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
    if (d && d.kind === 'synth' && !isSxRec(d) && os > 1 && (!h || N.cpu[id] > h.load)) h = { t, N, id, os, load: N.cpu[id] };
  }
  return h;
}
// the badge of a module the safeguard capped (IMPL-1e §3.3; lane C2 draws it): 'OS 4→2' | 'Q3' | null
function capsOf(t, dev) {
  const id = dev || curOf(t), d = t && t.dev ? t.dev[id] : null, N = t && nodes.get(t.id);
  if (!d || d.kind !== 'synth' || !ctx) return null;
  const sr = ctx.sampleRate;
  if (isSxRec(d)) {
    const own = Math.min(sxQuality(d), osCap(sr)), os = sxOSFor(d, sr);
    return os < own ? `OS ${own}→${os}` : qrStep ? 'Q' + qrStep : null;
  }
  const v = N && N.osI ? N.osI.get(id) : undefined;
  return v !== undefined && v < osFor(sr) ? `OS ${osFor(sr)}→${v}` : null;
}
// ((9, IMPL-9 §4.7) a 900 Series lowered: FM into audio inputs aliases differently and a feedback cord's one-sample delay grows)
const PT_OS_TXT = ' (cords into audio inputs may sound different at lower oversampling)';
// one step down for the group carrying more of the load (the per-node loads the processors report): the other models'
// oversampling (plCap under the app setting — session only: the setting, its select and what is saved stay the user's, #9),
// or the Serum tracks' caps (session only): their oversampling first (never above a track's own quality, §11.4 sign-off), at
// 1× their unison voices; the other group when the first has nothing left to lower
// ((M, §2.1) a heavy master is the user's call, as a heavy track rack: the levers stay the tracks', the notice names it when
// MASTER's load is the largest single share)
const masterTop = () => !!mnode && mnode.load > 0 && [...nodes.values()].every(N => mnode.load >= N.load);
const MASTER_TOP = ' · the master effects take the largest share';
function lowerOS() {
  hotT = 0;
  const mx = masterTop() ? MASTER_TOP : '';
  const po = plainOS(), so = sxMaxOS();
  let lp = 0, ls = 0;
  for (const t of project.tracks) { const N = nodes.get(t.id); if (N) { const g = groupLoads(t, N); lp += g[0]; ls += g[1]; } }
  const sxFirst = ls >= lp && (so > 1 || qrLever());
  const h = !sxFirst && po > 1 ? heavyInst() : null;
  if (h) { // (stage 1e: a graphed track's heaviest classic instrument alone)
    const v = h.os / 2, d = h.t.dev[h.id];
    h.N.osI.set(h.id, v);
    postTo(h.t, { t: 'os', v }, h.id);
    notice(`DSP load stayed above 85% — oversampling of ${d.name || modelById(d.model).name} (track “${h.t.name}”) lowered to ${v}× to avoid dropouts${isPatchDev(h.t, h.id) ? PT_OS_TXT : ''}${mx}`, 9000);
  } else if (!sxFirst && po > 1) {
    const v = po / 2;
    plCap = v;
    postAll({ t: 'os', v }); rateText(); rateLabels();
    for (const [id, N] of nodes) if (N.osI) for (const [i, o] of [...N.osI]) { // (the instruments lowered alone below it stay there)
      if (o < v) postTo({ id }, { t: 'os', v: o }, i); else N.osI.delete(i);
    }
    notice(`DSP load stayed above 85% — oversampling lowered to ${v}× to avoid dropouts${project.tracks.some(t => patchDevs(t).length) ? PT_OS_TXT : ''}${mx}`, 9000);
  } else if (so > 1) {
    sxCap = so / 2;
    for (const t of project.tracks) if (hasSx(t)) queuePatch(t);
    rateText();
    notice(`DSP load stayed above 85% — Serum oversampling capped at ${sxCap}× to avoid dropouts${mx}`, 9000);
  } else if (qrLever()) { // §14.3: Q1 … Q4 (+ Q5, Q6) after the oversampling cap, one per step, each named in a notice
    qrStep++;
    for (const t of project.tracks) if (hasSx(t)) queuePatch(t);
    rateText();
    notice(`DSP load stayed above 85% — Serum quality step Q${qrStep}: ${QR_NOTICE[qrStep]} to avoid dropouts${mx}`, 9000);
  }
  cvRelabel(); // (the modules' safeguard badges, capsOf)
}

/* --------------------------------------------------------- song data */
const CCK = { bend: 0, wheel: 1, sus: 2, at: 3 };
// R7 B4: a Piano Roll gesture appends and moves notes in place (sorted again only at its end): the engine (and the break
// below) need them in order — a sorted copy (song.sortNotes order) when they are not
function inOrder(a, cmp) { for (let i = 1; i < a.length; i++) if (cmp(a[i - 1], a[i]) > 0) return a.slice().sort(cmp); return a; }
const noteCmp = (a, b) => a.t - b.t || a.n - b.n, ccCmp = (a, b) => a.t - b.t;
// ((R review R-1) the live song leaves out a recorded note whose key is still down — recCutN —; a bounce (a range) has every note)
function songData(tr, start = -Infinity, end = Infinity) {
  const notes = [], cc = [], live = start === -Infinity;
  for (const n of inOrder(tr.notes, noteCmp)) {
    if (live && recCutN.has(n)) continue;
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
  const vi = trackVoice(instOf(t)), k = chordSize(t.notes);
  if (vi.seq || vi.mode === 'drums' || k <= (vi.mode === 'poly' ? vi.n : 1)) return; // ((7a §8) a drum track: never)
  chordWarned.add(t.id);
  // the voices a switch would really give: setTrackModel loads the model's last-used values (loadVals) — a saved Unison /
  // Solo plays one note
  const voiceTo = x => trackVoice({ model: x.id, vals: loadVals(x) });
  const m = modelById(instOf(t).model), to = isSxModel(m) || m.family === 'patch' ? null : POLY_TO.map(modelById).find(x => x !== m && voiceTo(x).n >= k); // ((9) a 900 Series is mono by design: its instrument, never a switch)
  const what = vi.mode !== 'poly' ? `is ${vi.mode === 'unison' ? 'in unison mode' : 'monophonic'} — its chords play one note`
    : `has ${vi.n} voices${vi.cap ? ' (CPU cap)' : ''} — a chord of ${k} notes drops some`;
  const txt = `“${t.name}” ${what}. Tap to ${to ? `switch it to the ${to.name} (${voiceTo(to).n} voices; Undo restores it)` : 'open its instrument'}`;
  noticeActs.set(txt, () => {
    noticeActs.delete(txt); notice('', 0);
    const tr = project.tracks.find(x => x.id === t.id); // (undo / redo replace the track objects)
    if (!tr) return;
    // (re-checked: the last-used values may have changed during the 15 s; flush lands a pending save first)
    if (to && instOf(tr).model === m.id && (flush(), voiceTo(to).n >= k)) setTrackModel(tr, to.id); else instPicker(tr);
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
// tweak's state, kept): their step carries the move (entry.meta {trackId, dev, slot, row}, kept by History across undo /
// redo) and undoing / redoing it moves that row alone — out of its slot while the slot still holds it, back in while the
// slot is free; else the matrix stays as it is and the notice says so. The step is the one History really undid (its
// no-op steps skipped): read after hist.undo / hist.redo
const MOD_MOVE = /^(Save with preset|Keep on canvas)$/;
let modMove = null; // { mv: the step's meta, put: the row goes back into its slot }
function modMoveBack(p, { mv, put }) {
  const t = p.tracks.find(x => x.id === mv.trackId), d = t && t.dev ? t.dev[mv.dev] : null;
  const s = d && d.kind === 'synth' && isSxRec(d) && d.vals ? d.vals.s : null, M = s && Array.isArray(s.matrix) ? s.matrix : null;
  if (!M || !(mv.slot >= 0 && mv.slot < M.length)) return;
  const r = M[mv.slot], free = !r || !r.src, same = JSON.stringify(r) === JSON.stringify(mv.row);
  if (put ? same : free) return; // (already so)
  if (put ? free : same) { const N = M.slice(); N[mv.slot] = put ? JSON.parse(JSON.stringify(mv.row)) : core.normRow(null); s.matrix = N; return; }
  notice(`${cvDevName(t, mv.dev)}’s mod slot ${mv.slot + 1} ${put ? 'is in use: the row was not put back' : 'changed since: left as it is'}`, 5000);
}
const modMoveOf = (e, put) => (e && e.meta && MOD_MOVE.test(e.label) ? { mv: e.meta, put: put.test(e.label) } : null);
function keepDevs(t, cur) {
  if (!cur || !t.dev || !cur.dev) return;
  for (const id of Object.keys(t.dev)) {
    const d = t.dev[id], c = cur.dev[id];
    if (!d || !c || typeof d !== 'object' || typeof c !== 'object' || d.kind !== c.kind) continue;
    if (d.kind === 'synth') { if (d.model === c.model) { d.vals = c.vals; if (c.fx) d.fx = c.fx; if (c.drum) d.drum = c.drum; } if (c.seq) d.seq = c.seq; } // ((7a §6) a drum machine's pattern memory as the 303's)
    else if (d.kind === 'panel' && c.fx) d.fx = c.fx;
  }
  const fa = CMOD.fxDevOf(t), fb = CMOD.fxDevOf(cur);
  if (fa && fb && fb.dev.fx && fa.id !== fb.id && CMOD.primId(t) === CMOD.primId(cur) && (fa.own ? !(fb.id in t.dev) : fb.own && !(fa.id in cur.dev))) fa.dev.fx = fb.dev.fx;
}
function applyRestore(p, keepSound = false) {
  if (!p) return;
  PATCH.cancel(); // ((9, §1.5) a cord drag ends first: a new cord vanishes, a pulled plug springs back)
  PERF.release(); // (1i review F1: every bed and controller lets go while its track is still the selected one: the restored track is a new object, the old panels' offs would be dropped)
  PADS.release({ hw: true }); // ((8, §10.3) every pad's notes end while their tracks are still the project's (a track the restore drops included)
  adopt(p); // (History snapshots and loads are plain objects: adopted first)
  if (!Array.isArray(p.pads)) p.pads = PC.normPads(p.pads); // ((8) a snapshot taken before any Pads module: none)
  // undo / redo never revert knob tweaks (per device) — within one project: an undo of Open / New brings back another project
  // (1f review: track ids repeat across projects; its sound is its own)
  const ptSeq = keepSound && p.uid === project.uid && ptBack && Array.isArray(ptBack.mv.seq) && ptBack.mv.seq.length ? ptBack.mv : null; // ((9b, review 2 F1) a preset step's sequencers)
  if (keepSound && p.uid === project.uid) { for (const t of p.tracks) keepDevs(t, project.tracks.find(x => x.id === t.id)); keepMaster(p, project); if (modMove) modMoveBack(p, modMove); if (sxBack) sxBackApply(p, sxBack); if (drBack) drBackApply(p, drBack); if (ptBack) ptBackApply(p, ptBack); } // ((3) a Serum's fields a canvas step wrote: back, §2.4 / §2.5; (7a) → Piano roll's SYNC; (9) a patch step's knobs, §1.5; (M) the master rack, §2.3)
  else { for (const t of p.tracks) seedPend.add(t.id); seedPend.add(MASTER); if (p !== project) abEnd(); } // a loaded project re-seeds the racks' LFO phases (the master's too); (M, R1-3) and ends the A/B (its match belongs to the old master)
  for (const t of p.tracks) fxOfDev(t, null); // (the primary's rack: a v1 one migrated in place)
  recCutMark(p); // ((R review R-1) the notes of keys still down, found again in the restored tracks: kept out of the songs sent below)
  const prevSel = project.selTrack;
  project = p;
  bind();
  syncNodes();
  masterSend(); // ((M) the master chain when it changed — an undo kept it: nothing posted)
  PADS.rebuild(); padLitAll(); // ((8, §10.3) the host from the restored project.pads — its views, its subscriptions (a track back from an undo)
  // ((7a) the sessions: the records the panels read (a machine changed: a fresh session), the tempo — (7c review #1) before the
  // payloads, which read them: a synced 909's flam ticks are its session's tempo's, so a stale one never goes first)
  drumChanged(); DRUM.bpm(project.bpm);
  for (const t of project.tracks) { sendPatch(t); sendSong(t, true); for (const k of drumDevs(t)) drumSend(t, k); for (const k of patchDevs(t)) patchSend(t, k); } // ((7a) its payload, when it changed; (9) a 900 Series' graph)
  if (ptSeq) { const t = project.tracks.find(x => x.id === ptSeq.trackId); if (t && isPatchDev(t, ptSeq.dev)) ptStart(t, ptSeq.dev, ptSeq.seq); } // ((9b, review 2 F1) the clocks as the restored knobs say)
  renderAll(!keepSound || prevSel !== project.selTrack);
  ptShow(); // ((9) the cords from the restored record, the faces' knobs)
  if (T.playing) reanchor(false);
  roUI(); // (a newer file's project read-only; Undo / New away from it: saved again)
  persist();
  cvModSync(); // (stage 2a: the open inspector / Mod list re-read the project)
}
// own true: a "tap to undo" undoing its own step (the newest), never the held notes of the pass in progress (R-2)
function undo(own) {
  PATCH.cancel();
  if (own !== true && T.rec && T.step !== T.pass && recDropPass()) { updateUndoUI(); return; } // ((R review R-2) the pass in progress held its only content)
  const p = hist.undo(project), rec = !!p && recHold(); // ((R-5) an undo that finds nothing changes nothing)
  modMove = p && modMoveOf(hist.r[hist.r.length - 1], /^Keep/); sxBack = p && sxBackOf(hist.r[hist.r.length - 1], false); drBack = p && drBackOf(hist.r[hist.r.length - 1], false); ptBack = p && ptBackOf(hist.r[hist.r.length - 1], false);
  try { if (rec) keepArm(p); applyRestore(p, true); } finally { modMove = null; sxBack = null; drBack = null; ptBack = null; if (rec) recResume(); }
  updateUndoUI();
}
function redo() {
  PATCH.cancel();
  const p = hist.redo(project), rec = !!p && recHold();
  modMove = p && modMoveOf(hist.u[hist.u.length - 1], /^Save/); sxBack = p && sxBackOf(hist.u[hist.u.length - 1], true); drBack = p && drBackOf(hist.u[hist.u.length - 1], true); ptBack = p && ptBackOf(hist.u[hist.u.length - 1], true);
  try { if (rec) keepArm(p); applyRestore(p, true); } finally { modMove = null; sxBack = null; drBack = null; ptBack = null; if (rec) recResume(); }
  updateUndoUI();
}
// (R) an undo / redo while recording: the notes held now are the undone pass's — dropped, never committed (the restore's own
// releases included) —; nothing records a step during the restore (recIdle: what the take changes then is the old project's),
// and the pass's next change records its step again (T.step −1) — unless a step of the take is the newest again (review R-8:
// an edit made in the middle of the pass undone — after a redo or another undo between too, a pass's later step undone back
// to its first: passStep, by identity —; the pass that step belongs to carries on in it). Only when something is restored (R-5)
let recIdle = false;
function recHold() { if (!T.rec) return false; recLive.clear(); recIdle = true; return true; }
function recResume() {
  recIdle = false;
  const e = hist.u[hist.u.length - 1], s = e ? passStep.get(e) : null;
  if (s && s.take === T.take) { T.stepE = e; T.step = s.pass; } else T.step = -1;
}
// (R review R-2) Ctrl+Z while the pass in progress has no step yet: the notes held from it are its whole content — they are
// dropped (its boundary state); an empty pass with nothing held undoes the pass before (false). Undo follows what happened:
// only the keys that went down after the step hist.undo would take back (u: History.seq at the key-down; a step that changed
// nothing is skipped there — the roll's Q with nothing to move —, so here) — a step recorded since (a roll edit) is undone
// first (false: hist.undo, the held notes going with the restore)
function recDropPass() {
  const top = hist.u[hist.u.length - 1]; let X, n = 0;
  for (const [k, r] of recLive) {
    if (r.p !== T.pass) continue;
    if (top && top.seq > r.u) { if (X === undefined) X = hist.undoStep(project); if (X && X.seq > r.u) continue; } // (a step since: a real one first)
    recLive.delete(k); n++;
  }
  return n > 0;
}
// (R review R-10) arming is not undoable (Ableton): a restore while recording keeps the live tracks' arm, by id (one project)
function keepArm(p) {
  if (!p || p.uid !== project.uid || !Array.isArray(p.tracks)) return;
  for (const t of p.tracks) { const c = project.tracks.find(x => x.id === t.id); if (c) t.arm = !!c.arm; }
}
let undoT = 0;
function updateUndoUI() { // canUndoFrom may serialise the project, so coalesce bursts of calls into one per frame
  if (undoT) return;
  undoT = requestAnimationFrame(() => { undoT = 0; $('#tUndo').disabled = !hist.canUndoFrom(project); $('#tRedo').disabled = !hist.canRedoFrom(project); });
}

/* ---------------------------------------------------------- transport */
// a: the anchor the nodes play from (render frames); as: the anchors still sounding, oldest first (the play() start,
// then each seek / tempo / loop change while playing: an older one's audio is heard until the next one's frame comes out
// of the speakers); seekA: the latest seek's anchor (recTick)
// ((R, IMPL-R §2) pass: the take's loop pass heard (passAt), pass0 its first, step: the pass whose undo step the take's changes
// join — −1 none yet —, stepE that step's History entry)
const T = { playing: false, rec: false, a: null, as: [], seekA: null, pos: 0, startPos: 0, take: 0, lastClr: 0, padRec: new Set(), pass: 0, pass0: 0, step: -1, stepE: null }; // ((8, §4.3) padRec: the take's pad-recorded track ids
// ((R review R-8) every pass step's History entry → { take, pass }: whichever of a take's steps is the newest again resumes)
const passStep = new WeakMap();
const fpt = () => ctx.sampleRate * 60 / (project.bpm * S.PPQ);
function loopInfo() { const L = project.loop; return { loop: !!(L.on && L.end > L.start), ls: L.start, le: L.end }; }
function anchor(F, tick) { const L = loopInfo(); return { frame: F, tick, fpt: fpt(), loop: L.loop, ls: L.ls, le: L.le, wrap: L.loop && tick < L.le }; }
// (R) the loop pass at frame F on anchor a: the pass it was made in (passOf: a re-anchor's, a seek in a looping song one more —
// a new pass —; play() 0) + the wraps on its line (audioclock tickAt's). Kept beside the anchor, never posted with it
const passOf = new WeakMap();
// (R review R-4) the anchors that carry a seek's jump (reanchor: T.seekA's): a pass reached on one of them, before it wraps, is
// the seek's — never a wrap's
const seekAs = new WeakSet();
const seekPass = p => T.as.some(x => seekAs.has(x) && (passOf.get(x) || 0) === p);
function passAt(F, a) {
  const t = a.tick + (F - a.frame) / a.fpt;
  return (passOf.get(a) || 0) + (a.wrap && t >= a.le ? 1 + Math.floor((t - a.le) / (a.le - a.ls)) : 0);
}
// the pass heard at frame F: on the anchor heardTick reads
function heardPass(F) { const as = T.as; for (let i = as.length - 1; i >= 0; i--) if (F >= as[i].frame) return passAt(F, as[i]); return as.length ? passOf.get(as[0]) || 0 : 0; }
// (review R-11) the chase floor: the engine starts a song note only at its start (engine.js songEvents) — from a start's / seek's
// anchor tick on, from ls after a wrap, from a panic's tick on —, so the roll's key strip lights none started before it (its 4th
// setPlayhead argument). chase: anchor → [pass, floor] in that pass of its line (a later pass: ls; an earlier, before a panic
// rendered ahead of the heard pass: none); a tempo / loop re-anchor (no release) inherits its frame's. Beside the anchor, never posted
const chase = new WeakMap();
function floorAt(F, a) { const c = chase.get(a), q = passAt(F, a); return !c ? -Infinity : q > c[0] ? a.ls : q < c[0] ? Infinity : c[1]; }
function heardFloor(F) { const as = T.as; for (let i = as.length - 1; i >= 0; i--) if (F >= as[i].frame) return floorAt(F, as[i]); return as.length ? floorAt(F, as[0]) : -Infinity; }
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
// ((R) recP: the loop pass of that position — its anchor's, as the tick). (R review R-7) A seek line that loops is never
// extrapolated back past its own tick (⏮ to the loop start: never before the loop, unheard there and overwriting what is)
let recP = 0;
function recTick(perfTs) {
  if (!T.playing || !T.a) { recP = T.pass; return T.pos; }
  const s = T.seekA, F = outFrame(perfTs);
  if (s && T.as.includes(s) && F < s.frame) { recP = passOf.get(s) || 0; const t = AC.tickAt(F, s); return s.wrap ? Math.max(s.tick, t) : t; }
  recP = heardPass(F);
  return AC.heardTick(F, T.as);
}
// fresh: a start / seek (the engine plays the anchor tick's notes even when the message arrives a little late); never on the
// re-sends to a node created mid-song (makeNode) or after a panic, or a tempo / loop change
function postTransport(seek) { postAll(Object.assign({ t: 'transport', play: true, seek }, seek ? { fresh: true } : null, T.a)); }
// (IMPL-M P-1 (b), the lead's decision) while the master holds an effect every anchor is on a quantum boundary (≤ 2.7 ms later):
// a start is then on the bounce's partition — bit-exact with it from a silent history; an empty master moves nothing. (SC §7.1)
// So too while any rack holds a sidechain unit with a source (scAny, asked here: undo / load / a removal never leave a count stale)
const mAlign = F => (masterN() > 0 || scAny() ? Math.ceil(F / 128) * 128 : F);
async function play(from = T.pos, countBars = 0) {
  try { await powerOn(); } catch { return; }
  if (!ctx || T.playing) return;
  for (const t of project.tracks) if (songQ.has(t.id)) sendSong(t, true);
  const F = mAlign(Math.round((ctx.currentTime + 0.06 + (ctx.baseLatency || 0)) * ctx.sampleRate));
  T.a = anchor(F, from - countBars * S.barTicks(project)); T.as = [T.a]; T.seekA = null; chase.set(T.a, [0, T.a.tick]);
  T.playing = true; T.startPos = from; T.lastClr = from;
  postTransport(true);
  DRUM.transport(true); // ((7a) the synced drum machines' START state and LEDs follow the song)
  PADS.transport(true); // ((8, §6.2) the pads following roll notes check the heard tick each frame)
  metroStart();
  transportUI();
}
function stop() {
  if (!T.playing) { if (T.pos !== 0) { T.pos = 0; posUI(); } return; }
  const t = recTick();
  if (T.rec) { recAdv(recP); finishRec(t); }
  postAll({ t: 'transport', play: false });
  T.playing = false; T.rec = false; T.a = T.seekA = null; T.as = [];
  recCutEnd(); // ((R review R-1) the song stopped: the notes of keys still down join it)
  T.pos = T.startPos;
  metroStop();
  for (const [k, P] of classicPanels) if (!seqRun.has(k) && !P.dead) P.seqStep(-1); // synced 303s stopped with the song
  DRUM.transport(false); // ((7a) and the synced drum machines: their LEDs back to the flashing key)
  PADS.transport(false);
  transportUI(); posUI();
}
function reanchor(seekTick) { // tempo/loop change (or a seek) while playing, applied in sync on every node
  if (!T.playing || !ctx) return;
  const sr = ctx.sampleRate, F = mAlign(Math.round((ctx.currentTime + 0.05) * sr)), H = outFrame(), sk = seekTick != null && seekTick !== false;
  const t = sk ? seekTick : AC.tickAt(F, T.a), pa = passAt(F, T.a) + (sk && T.a.wrap ? 1 : 0); // ((R) a seek while looping: a new pass)
  const fl = sk ? t : floorAt(F, T.a); // ((review R-11) a seek starts from its tick; a tempo / loop change releases nothing)
  // an anchor not rendered yet never sounds: the nodes' single pending slot (engine tp.pend) takes this one instead
  const p = T.a.frame > ctx.currentTime * sr ? T.as.pop() : null;
  T.a = anchor(F, t); T.as.push(T.a); passOf.set(T.a, pa); chase.set(T.a, [pa, fl]);
  if (sk || (p && p === T.seekA)) { T.seekA = T.a; seekAs.add(T.a); } // (a seek replaced before it sounded: this one carries its jump)
  let j = -1; for (let i = 0; i < T.as.length - 1; i++) if (T.as[i].frame <= H) j = i;
  if (j > 0) T.as.splice(0, j); // the anchors before the latest one heard are gone
  postTransport(sk);
  metroStart(F);
}
function seek(tick) {
  tick = Math.max(0, Math.round(tick));
  if (T.playing) { if (T.rec) finishRec(recTick()); reanchor(tick); T.startPos = tick; DRUM.transport(true); } // ((7b review 1 #1) a seek ends a synced 606's D.S. / heard key, as ▶ / ■)
  else T.pos = tick;
  posUI();
}
// (R, IMPL-R §2) no History step here: each loop pass records its own before its first change (recStep)
function toggleRec() {
  if (T.rec) { const t = recTick(); recAdv(recP); finishRec(t); T.rec = false; transportUI(); return; }
  if (!project.tracks.some(t => t.arm)) { trk().arm = true; renderHeads(); }
  T.take = S.newId(); T.padRec.clear(); // ((8) a new take: no pad-recorded track yet)
  T.step = -1; T.stepE = null; // (no step of an earlier take is ever resumed, R-8)
  if (T.playing) { T.lastClr = curTick(); recTick(); T.pass = T.pass0 = recP; T.rec = true; transportUI(); return; }
  T.pass = T.pass0 = 0; // (play()'s anchor: pass 0)
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
// (R, IMPL-R) Every loop pass of a take is one undo step (Ableton): a pass's first change — a note, an overwrite, a CC, a
// Replace sweep — records the state before it (recStep: none for a pass that recorded nothing; a take without a loop is one
// pass, "Record"). The pass is the heard one (recTick's recP, the frame's heardPass): when it moves on, a note still held from
// an earlier pass ends at the loop end there — the wrap's cut — and is committed into its own pass's step (recAdv). An undo
// while recording takes the pass in progress back to its boundary (undo: the held notes dropped, T.step −1) and recording
// carries on.
const recLive = new Map(); // `${trackId}|${src}:${n}` -> { tr, n, t0, v, p: its pass, u: History.seq at its key-down (R-2) }
// (R review R-1) a note committed while its key is still down (a loop boundary, a seek, ● / arm off while playing) is in the
// project and its pass's step at once, but kept out of the engine until the key is up: the song's copy of it would take the
// held voice over in the next pass and its note-off silence it. recLive's key → { id: its track's, nid: the note's id, note };
// recCutN the notes (songData leaves them out: a WeakSet — History snapshots serialise the notes). A restore (undo / redo,
// recording or not) brings new objects: recCutMark finds each again by its id before the songs are sent — an entry whose
// note the restore took away waits unmarked (a redo may bring it back) until its key is up
const recCut = new Map(), recCutN = new WeakSet();
function recCutDrop(id) { for (const [k, c] of recCut) if (id == null || c.id === id) { recCut.delete(k); if (c.note) recCutN.delete(c.note); } }
function recCutMark(p) {
  const same = p.uid === project.uid; // (another project's track ids repeat: nothing of it is held)
  for (const c of recCut.values()) {
    if (c.note) recCutN.delete(c.note);
    const t = same ? p.tracks.find(x => x.id === c.id) : null;
    c.note = (t && t.notes.find(x => x.id === c.nid)) || null;
    if (c.note) recCutN.add(c.note);
  }
}
// (the song stopped: every held note's commit to the engine now)
function recCutEnd() {
  const ids = new Set([...recCut.values()].map(c => c.id));
  recCutDrop();
  for (const t of project.tracks) if (ids.has(t.id)) sendSong(t);
}
// (u: History.seq when the key went down — R-2: the steps after it have a higher seq)
function recStart(tr, key, n, v, ts) { const t0 = recTick(ts); recAdv(recP); recLive.set(tr.id + '|' + key, { tr, n, t0, v, p: recP, u: hist.seq }); }
// a key's release (recording or not): its note committed; one committed while it was down reaches the engine now
function recEnd(tr, key, ts) {
  const k = tr.id + '|' + key;
  if (recLive.has(k)) {
    const t1 = recTick(ts); recAdv(recP); // (released in a later pass: committed at its loop end there)
    const r = recLive.get(k);
    if (r) { recLive.delete(k); commitNote(r, t1); }
  }
  const c = recCut.get(k);
  if (c) { recCut.delete(k); if (c.note) recCutN.delete(c.note); sendSong(tr); }
}
// k: the recLive key of a note whose key is still down (R-1)
function commitNote(r, t1, k) {
  const a = T.a;
  let t0 = r.t0;
  if (a && a.wrap && t1 < t0) t1 = a.le;
  if (t1 <= 0) return;
  if (t0 < 0) t0 = 0;
  const note = { id: S.newId(), t: Math.round(t0), d: Math.max(1, Math.round(t1 - t0)), n: r.n, v: clamp(Math.round(r.v * 127), 1, 127), take: T.take };
  if (project.rec.inputQuantize) S.quantize([note], { grid: project.quantize.grid || S.PPQ / 4, strength: 100, swing: project.quantize.swing, starts: true, ends: false });
  // (R review R-3) played inside a loop: a start snapped to the loop end wraps to its start (Ableton: the downbeat it was aimed
  // at), one snapped before an off-grid loop start is clamped to it — never outside the loop (unheard there, overwriting the
  // bar after it); a lead-in before the loop keeps its place
  if (a && a.wrap && r.t0 >= a.ls && r.t0 < a.le) {
    if (note.t >= a.le) note.t = a.ls + (note.t - a.le);
    else if (note.t < a.ls) note.t = a.ls;
  }
  if (!project.tracks.includes(r.tr)) return;
  recStep();
  overwrite(r.tr, note);
  r.tr.notes.push(note);
  if (k != null) { recCut.set(k, { id: r.tr.id, nid: note.id, note }); recCutN.add(note); }
  changed([r.tr]);
}
// (R) a recorded note overwrites its pitch on its track (Ableton; Overdub and Replace, the take's earlier passes too): one
// starting inside its final span (after input quantize) goes, one running into it ends where it starts (gone below 1 tick);
// other pitches untouched. ((R review R-9) a removal gives the track a new array, as the Replace sweep: the caches keyed on
// the array and its length — the pads following the track — see a delete-one-push-one)
function overwrite(tr, x) {
  const s = x.t, e = x.t + x.d, L = tr.notes, keep = [];
  for (const o of L) {
    if (o.n === x.n && o.t < e && o.t + o.d > s) {
      if (o.t >= s) continue;
      o.d = s - o.t;
      if (o.d < 1) continue;
    }
    keep.push(o);
  }
  if (keep.length !== L.length) tr.notes = keep;
}
// (the keys still down: their notes kept out of the engine until they are up, R-1)
function finishRec(t) { for (const [k, r] of recLive) commitNote(r, t, k); recLive.clear(); }
// (R) the take's undo step for the pass heard, before its first change ("Record pass N" while it loops) — again after any
// other step came on top of it (an edit mid-pass: undo then follows what happened). (R review R-6) Never in the middle of a
// roll gesture (beginEdit's step holds the state before it: what is recorded meanwhile joins it, as an edit; the pass's next
// change after it records its step again); (R-8) joining the pass's step drops the redo stack, as History.record does
function recStep() {
  if (gesture) { T.step = -1; return; }
  if (recIdle) return;
  if (T.step === T.pass && hist.u[hist.u.length - 1] === T.stepE) { if (hist.r.length) { hist.dropRedo(); updateUndoUI(); } return; }
  T.step = T.pass;
  hist.record(project, T.pass > T.pass0 || (T.a && T.a.wrap) ? 'Record pass ' + (T.pass - T.pass0 + 1) : 'Record', true);
  T.stepE = hist.u[hist.u.length - 1];
  passStep.set(T.stepE, { take: T.take, pass: T.pass });
  updateUndoUI();
}
// (R) the heard pass moved on to p: what is still held from an earlier one ends at the loop end (in that pass's step).
// (R review R-4) Replace: a wrap (never a seek — its anchor is made in the next pass: seekPass) first sweeps the old pass's
// tail [lastClr, le) into the old pass's step; the frame's sweep then covers [ls, t] in the new one. A re-anchor made just
// before the loop end (a tempo change, an undo's restore: its anchor already in the next pass while the old line is heard)
// is no seek: the heard wrap sweeps
function recAdv(p) {
  if (!T.rec || !(p > T.pass)) return;
  const a = T.a, le = a ? a.le : 0;
  if (project.rec.mode === 'replace' && a && a.wrap && !seekPass(p) && T.lastClr > a.ls) { sweep([[T.lastClr, a.le]]); T.lastClr = a.ls; }
  for (const [k, r] of recLive) if (r.p < p) { recLive.delete(k); commitNote(r, le, k); }
  T.pass = p;
}
function recCC(trs, k, v, ts) {
  if (!T.rec || !T.playing) return;
  const t = Math.round(recTick(ts));
  if (t < 0) return;
  recAdv(recP);
  for (const tr of trs) {
    if (!tr.arm && !T.padRec.has(tr.id)) continue; // ((8, §4.3 review #8) a pad's target records its Pencil aftertouch, armed or not)
    recStep();
    const last = tr.cc.length ? tr.cc[tr.cc.length - 1] : null;
    if (last && last.k === k && Math.abs(last.t - t) < 12) { last.v = v; continue; }
    tr.cc.push({ t, k, v, take: T.take });
    sendSong(tr);
  }
}
function replaceSweep(t) { // replace mode: wipe what the playhead passes on armed tracks — (8) and the take's pad-recorded ones — (except this take)
  if (!T.rec || project.rec.mode !== 'replace' || t < 0) { T.lastClr = Math.max(T.lastClr, t); return; }
  const a = T.a, ranges = t >= T.lastClr ? [[T.lastClr, t]] : [[T.lastClr, a.le], [a.ls, t]];
  T.lastClr = t;
  sweep(ranges);
}
function sweep(ranges) { // (the ranges [s, e) of every armed / pad-recorded track, the take's notes kept)
  for (const tr of project.tracks) {
    if (!tr.arm && !T.padRec.has(tr.id)) continue; // ((8, §4.3 review #8) a pad's target, armed or not: Q5's rule in replace mode)
    const keep = tr.notes.filter(n => n.take === T.take || !ranges.some(([s, e]) => n.t >= s && n.t < e));
    if (keep.length !== tr.notes.length) { recStep(); tr.notes = keep; sendSong(tr); arr && arr.render(); roll && roll.render(); } // ((R) in the pass's step)
  }
}

/* ------------------------------------------------- live input routing */
// SPEC-serum2 §12.6: the targets of an input are midi.js's (Phase-1 rule + the MPE zone: a track whose Serum state has
// MPE on receives every channel of its input); notes of MPE tracks carry their channel ({t: 'on', n, v, ch}).
const held = new Map(); // `${src}:${n}` -> [[track id, ch]] (ch: midi.js noteCh of the note-on; its note-off carries it)
function targets(src) { return midiTargets(project.tracks, project.selTrack, src); } // src 0 = on-screen/computer keyboard; 1..16 = MIDI channel
// (8, §4.1–§4.2) a source is the keyboard's 0, a MIDI channel 1–16 — or a Pads module's 'pd<k>' (k: the Pads host's session
// number of its target track; no ':' in it): the host alone ends those keys (review #7) — the generic loops below skip them,
// and a tray key's light counts only a held key that reached the selected track (a numeric source, or a pad's note on it)
const numSrc = src => /^\d+$/.test(String(src));
const heldSel = (k, ids) => numSrc(k.slice(0, k.indexOf(':'))) || (Array.isArray(ids) && ids.some(x => x[0] === project.selTrack));
const heldLit = () => new Set([...held].filter(([k, ids]) => heldSel(k, ids)).map(([k]) => +k.slice(k.indexOf(':') + 1)));
// (R, IMPL-R §3) the held notes that reached track id — the roll's key strip (heldLit's rule on that track exactly: a MIDI
// channel's note routed only elsewhere stays dark there); rollHeld passes the selected track's to the roll when they change
const heldOn = id => { const L = []; for (const [k, ids] of held) if (Array.isArray(ids) && ids.some(x => x[0] === id)) L.push(+k.slice(k.indexOf(':') + 1)); return L; };
function rollHeld() { if (roll) roll.setHeld(heldOn(project.selTrack)); }
let padNext = null; // ((8, §7.2) the pad inspector's "Play it": the next input note, once)
// trs: the tracks the note goes to (default: the input's targets); (8) a pad passes its target track and o.rec 'target' —
// that track records it whenever recording runs, armed or not (Q5) and joins the take's T.padRec (§4.3)
function noteOn(n, v, src = 0, ts = performance.now(), trs = targets(src), o) {
  if (!(n >= 0 && n <= 127)) return; // (1i: NaN too — it was held, lit, recorded and posted)
  const key = src + ':' + n;
  if (held.has(key)) noteOff(n, src, ts);
  const chs = trs.map(t => noteCh(t, src));
  held.set(key, trs.map((t, i) => [t.id, chs[i]]));
  if (typeof src !== 'string' || trs.includes(trk())) keyVis(n, true); // ((8) a pad's note on another track never lights the tray)
  rollHeld();
  const send = () => { trs.forEach((t, i) => postTo(t, noteMsg(t, { t: 'on', n, v }, src, chs[i]))); };
  if (!ctx) { powerOn().then(() => { if (held.has(key)) send(); }).catch(() => {}); }
  else { wake(); send(); } // queued while suspended; plays once the context runs
  const tgt = !!o && o.rec === 'target';
  if (T.rec) for (const t of trs) if (t.arm || tgt) { recStart(t, key, n, v, ts); if (tgt) T.padRec.add(t.id); }
  for (const t of trs) inputNote(t, 1, n, v, ts, false);
  playingUI(trs);
  if (padNext && typeof src !== 'string') { const f = padNext; padNext = null; f(n); }
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
  if (![...held].some(([k, ids]) => k.endsWith(':' + n) && heldSel(k, ids))) keyVis(n, false); // ((8) a pad's note held on another track keeps no tray key lit)
  rollHeld();
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
  if (kind !== 'sus' && to.includes(trk())) PERF.live(kind, v); // (1i §5.2: the hardware wheels show what reached the selected track)
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
const lastV = new Map(), lastN = new Map(); // track id → the last note-on velocity (0–1) / note: the Velocity / (2b) Note modules' readouts
const lastVel = (t = trk()) => (t && lastV.has(t.id) ? lastV.get(t.id) : 0);
const lastNote = (t = trk()) => (t && lastN.has(t.id) ? lastN.get(t.id) : null);
// The group follows the physical keys (§12.6): every held key is in `held` (null once the group stores no more notes), so
// the group ends at the last note-off however many notes it has; at most GROUP_MAX notes are stored
function inputNote(t, on, n, v, ts, audition) {
  if (on) { lastV.set(t.id, v); lastN.set(t.id, n); cvModLive('velo'); cvModLive('note'); } // (lane D: the Velocity / Note modules' readouts)
  if (!audition) { const S = inputSubs.get(t.id); if (S) for (const f of [...S.values()]) { try { f(on ? 1 : 0, n, on ? Math.max(1, Math.round(v * 127)) : 0, ts); } catch (err) { console.warn(err); } } }
  if (!audition) { const L = padIns.get(t.id); if (L) for (const f of [...L]) { try { f(n, !!on); } catch (err) { console.warn(err); } } } // ((8, §6.2) a Pads module's pads following the track's live notes)
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
  PATCH.cancel(); // ((9) a cord drag in flight ends)
  for (const t of project.tracks) seqToggle(t, false); // not quiet: the Run button and step lights must show it stopped
  PERF.release(); // (1i: the beds drop their pointers — a finger still down leaves no count — and the springs go home)
  DRUM.panic(); // ((7a) the drum machines' sessions stop — a free machine's START —, their queued posts and lights go, the pads let go)
  PADS.release({ hw: true }); // ((8, review #7) the Pads host ends its pd<k> keys itself — hardware pads too, its counts reset — before the loop)
  for (const k of [...held.keys()]) { const [src, n] = k.split(':'); if (numSrc(src)) noteOff(+n, +src); }
  hk.clear();
  setSustain(false);
  postAll({ t: 'panic' });
  for (const t of project.tracks) for (const k of drumDevs(t)) drumSend(t, k, 'now', null, true); // ((7a) their payloads say so: not running)
  if (T.playing) {
    // ((review R-11) the chase floor: the anchor rendered now restarts nothing before this tick of its line — a later one, not
    // rendered yet, becomes a seek from its own tick)
    const Fr = ctx.currentTime * ctx.sampleRate;
    for (const a of T.as) chase.set(a, a.frame > Fr ? [passOf.get(a) || 0, a.tick] : [passAt(Fr, a), AC.tickAt(Fr, a)]);
    postAll(Object.assign({ t: 'transport', play: true, seek: true }, T.a)); // (not fresh: the old anchor replays nothing, R7 B1)
  }
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
  if (shell.tiles) shell.tiles.setCurrent(curModel().id);
  if (shell.tiles && shell.src && shell.src.isOpen() && shell.tiles.mode() === 'replace') srcModeUI('replace'); // (its track's name)
  trkChipUI();
}
// o.ui 'flow' | 'hw': the synth in that layout (the Sources tray's Simple | Hardware), inside this step — the same model
// switches its layout (its own step), so the tray's switch goes both ways. Stage 1e: tr0 a device view — that instrument
// is replaced (cv-model setModel: its kept-FX rules); the track's primary as before (tr.model: the 1c reshape).
// (WC, IMPL-WC §3.5) a rig: o.module — a module tile's first drop: the blank (rigBlank: every source off) and that module in this
// step (rigFirst); o.keepLay — Make it a <NAME>: o.vals / o.preset kept, the parts' old places kept (sxModelLay's purge skipped)
function setTrackModel(tr0, id, o = null) {
  const tr = trOf(tr0), dev = dvOf(tr0), iv = instView(tr, dev), prim = dev === CMOD.primId(tr);
  const ui = S.isDrum(id) || PT.isPatchModel(id) ? 'hw' : o && (o.ui === 'flow' || o.ui === 'hw') && !isSxModel(modelById(id)) ? o.ui : null; // ((7a §8) a drum machine: Hardware only; (9) a 900 Series too)
  if (id === iv.model) { if (ui && tr === trk() && instUi(tr, dev) !== ui) cvSetLayout(ui, dev); return; }
  // (P, §3.1) a Serum replaced by a classic unfolds its own FX into a panel — one more device: at CMOD.DEV_MAX cv-model setModel
  // refuses ({ ok: false, why }, nothing touched) — its rule asked here before the step, said; its why if it refuses after all
  const full = isSxRec(iv) && !isSxId(id) ? CMOD.devFull(tr) : '';
  if (full) { notice(full, 4000); return full; }
  flush(); // a pending save of the outgoing model's values must not be dropped
  const old = modelById(iv.model), m = modelById(id), name0 = tr.name;
  hist.record(project, 'Replace ' + old.name);
  seqToggle(tr, false, true, dev);
  postTo(tr, { t: 'panic' });
  if (prim && new RegExp('^' + old.name.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + '( \\d+)?$').test(tr.name)) tr.name = m.name + ' ' + (project.tracks.indexOf(tr) + 1);
  const n0 = CG.modRowsFor(tr, dev).length, nm = 'the ' + (tr.dev && tr.dev[dev] ? cvDevName(tr, dev) : 'instrument'); // ((U10) the device being replaced, by its name)
  const wasDrum = isDrumDev(tr, dev), wasPatch = isPatchDev(tr, dev), wasRig = isRigDev(tr, dev);
  if (wasPatch) { PATCH.cancel(); PATCH.lamps(tr, dev, null); } // ((9b) its lamps' queue goes with it)
  const rigM = isRigModel(m), keep = rigM && !!o && !!o.keepLay && !!o.vals;
  const sm = CMOD.setModel(tr, dev, id, keep ? { vals: o.vals, preset: o.preset == null ? null : o.preset } : { vals: rigM && o && o.module ? { s: RC.rigBlank() } : loadVals(m) }); // (R5: the primary too — its rack kept by the kept-FX rules, the 1c reshape; (C11) the values with the model: the rows judged against the NEW model's values)
  if (sm && sm.ok === false) { tr.name = name0; hist.prune(project); notice(sm.why, 4000); updateUndoUI(); renderHeads(); return sm.why; } // ((P) refused: nothing changed, no step)
  // (7a §6, §10.1) setModel changes the device in place: a drum machine leaves with its record (the Replace undo brings it
  // back from History) and one arrives with an empty memory; the machine's session starts again either way — (7b) 808 ↔ 606
  // too: a switch away and to, the new machine's own record (normDrum(·, id)), its payload forced after the patch below (the
  // engine keeps one that overtakes the patch in drPend: its m names the machine)
  if (wasDrum || S.isDrum(id)) { const d = tr.dev[dev]; if (S.isDrum(id)) d.drum = DC.normDrum(undefined, id); else delete d.drum; drumForget(tr, dev); }
  // (9, §1.4, §6) a 900 Series arrives with the Model 15 set as Classic bass — or (o.pm: a module tile) the controller and that
  // module —, its payload forced after the patch below; one leaves with its record, its knobs (vals.p) and its modules' places
  if (wasPatch || PT.isPatchModel(id)) {
    const d = tr.dev[dev];
    if (PT.isPatchModel(id)) patchNew(tr, dev, o && o.pm, o && o.set); else delete d.patch;
    if (wasPatch && tr.lay && typeof tr.lay === 'object') { const lay = Object.assign({}, tr.lay); for (const k of Object.keys(lay)) if (k.startsWith(dev + '/')) delete lay[k]; tr.lay = lay; }
  }
  // (stage 2a) a Serum's cables to a classic one are dropped (the model setter / setModel): said (cv-model setModel's text)
  const gone = n0 - CG.modRowsFor(tr, dev).length, why = gone > 0 ? `${gone} modulation cable${gone > 1 ? 's' : ''} to ${nm} removed: the new model has no such knobs` : ''; // (2b: rows whose param id survives stay)
  if (why) notice(why, 6000);
  if (n0) cpHalos(tr); // ((U11) the rows went or changed: the classic halos and the eff subscription follow, not the next edit)
  if (ui === 'flow' || (ui === 'hw' && layFlow(tr, dev))) layUi(tr, ui, dev); // (Hardware on an untouched track: no lay key)
  if (!keep) sxModelLay(tr, dev); // ((3) the old Serum's part places go; (WC) Make it a <NAME> keeps them)
  if (rigM && o && o.module) rigFirst(tr, dev, o.module); // ((WC) the dropped module, its auto-plug, the group's first layout
  else if (keep && !Object.keys(tr.lay || {}).some(k => k.startsWith(dev + '/') && k !== dev + '/fx')) tr.lay = sxLayParts(tr, dev); // ((WC) no old places: Tidy's group
  if (tr.id === project.selTrack) {
    if (dev === curOf(tr)) { bind(); settings.model = id; renderNav(); history.replaceState(null, '', '#' + id); }
    renderPanel(tr, dev);
    if (PT.isPatchModel(id) && cvView && cvView.trackId === tr.id) cvCamRestore(tr); // ((9, §4.5) its rack framed — unless the user's camera is stored for the track)
    if (wasPatch || PT.isPatchModel(id) || wasRig || isRigModel(m)) ptShow(); // ((9) its cords, or none; (WC) a rig's buffer, or none)
  }
  sendPatch(tr);
  if (id === 'tb303') { if (prim) seqSend(tr); else seqSend(tr, dev); }
  else if (S.isDrum(id)) drumSend(tr, dev, 'now', null, true); // ((7a) its plan and tables after the drums patch)
  else if (PT.isPatchModel(id)) patchSend(tr, dev, true); // ((9, review #25) its graph after the patch kind, forced)
  if (id === 'tr606') offer303(iv); // ((7b §3.8) beside a free-running TB-303: the one-time offer, after the replace's notice)
  if (tr.id === project.selTrack && roll) { roll.refreshRows(); rollDrumUI(); } // ((7a) the roll's drum rows come and go with the model)
  if (ctx) rateText();
  padsRefresh(); // ((8) a Pads module's drum pads on this track: lit by its new machine, or "No Kick on … any more")
  renderHeads(); persist(); updateUndoUI();
  return why;
}
function selectTrack(id) {
  const back = cvMaster && masterOff(); // ((M, §5.2) any track pick leaves the master canvas first — the selected track's too
  const iv = curView(trk());
  if (id === project.selTrack && bound === iv.id + ':' + iv.model) { if (back) { renderViews(); tabTrackUI(); ptShow(); } return; }
  PATCH.cancel(); // ((9) a cord drag on the outgoing track ends)
  PERF.release(); // (1i review F2: the springs and the Pencil's aftertouch go home on the track they moved, before the selection moves)
  DRUM.release(); // ((7a) a drum machine's pads and held CLEAR too)
  // ((8, review #7) a pad's pd<k> key is the Pads host's: skipped here — a hardware pad held across the switch keeps sounding,
  // the canvas pointers end with the old view's body (its destroy); a latch stays)
  for (const k of [...held.keys()]) { const [src, n] = k.split(':'); if (numSrc(src)) noteOff(+n, +src); }
  flush();
  project.selTrack = id;
  bind();
  // ((8, R1-G) a pad's hold that outlives the switch (a latch, a hardware pad): its key is lit by the new selection's rule, either way)
  { const L = heldLit(); for (const [n, el] of keyEls) if (el.classList.contains('down') !== L.has(n)) keyVis(n, L.has(n)); }
  renderNav(); renderViews(); renderHeads();
  roll && roll.setTrack(); arr && arr.render();
  rollDrumUI();
  tabTrackUI();
  ptShow(); // ((9) the shown track's cords (none: []), the cord buffer while a 900 Series is shown, §4.3)
  persist();
}
// the current instrument of track t (a tap on its module, a press in its panel, its module menu): the panel services follow
// (bind, curPanel), the Sources tray's tile and its replace text
function setCur(t, dev) {
  if (!t || dev !== CMOD.primId(t) || curOf(t) === dev) return; // (1f: only the primary — the cv.setCur hook)
  if (t === trk()) flush(); // (the outgoing instrument's values: save writes synth.v.<model> from the current view)
  curDevs.set(t.id, dev);
  if (t !== trk()) return;
  bind(); renderNav(); aboutUI(curModel()); drawAlgo(); tabTrackUI();
}

/* ------------------------------------------------------------ panel */
// A classic instrument shows its Hardware layout (cv-panel: the real front panel, fixed size) unless the track chose the
// Simple one (track.lay.<dev>.ui === 'flow': today's flowing sections at its model's fixed width, cvModule.FLOW_W). A model
// whose hardware panel is not drawn yet (or fails validation) shows today's panel in either (IMPL-panels §7).
const hwLayoutOf = m => (m && !isSxModel(m) ? cvPanel.usable(m.id, m) : null);
function instUi(t, dev) { // (stage 1e: instrument dev, default the current one; its lay key is its device id)
  const d = dev == null && t ? curOf(t) : dev;
  if (!t || isSxDev(t, d)) return 'flow';
  if (isDrumDev(t, d) || isPatchDev(t, d)) return 'hw'; // ((7a §8) a drum machine: its real front panel only — no Simple layout; (9) a 900 Series' console too)
  return layFlow(t, d || cvModule.ID.inst) ? 'flow' : 'hw';
}
// the track's layout entry of instrument dev asks for the Simple layout (lay.<dev>.ui; what instUi reads for a classic one)
const layFlow = (t, dev) => { const e = t && t.lay && typeof t.lay === 'object' ? t.lay[dev] : null; return !!e && e.ui === 'flow'; };
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
  // (2b, IMPL-2b §6.2) the press-and-hold / right-click mod menu of a classic control: its canvas rows (Bypass / Disconnect,
  // one step each), Connect to… (the source picker); the panel's `track` is a device view
  modMenu: {
    rows: (v, ctl) => { const t = trOf(v), dev = dvOf(v); return t === trk() ? CG.modRowsFor(t, dev).filter(r => r.dst === dev + ':' + ctl).map(r => ({ id: r.id, src: r.src, label: modLabel(r.src), byp: !!r.byp })) : []; },
    bypass: (v, id, on) => { const t = trOf(v); if (t !== trk()) return; hist.record(project, 'Mod bypass'); CMOD.setMod(t, id, { byp: on ? 1 : 0 }); cvModAfter(t); cvModSync(); },
    disconnect: (v, id) => { const t = trOf(v); if (t !== trk()) return; hist.record(project, 'Disconnect'); CMOD.removeMod(t, id); cvModAfter(t); cvModSync(); },
    connect: (v, ctl, el) => { const t = trOf(v), dev = dvOf(v); if (t === trk()) modSrcPick(dev + ':' + ctl, el); },
    canMod: (v, ctl) => { const t = trOf(v), dev = dvOf(v); return !!(t.dev && t.dev[dev]) && CMOD.destOk(t.dev[dev], ctl).ok; },
  },
};
// (1i, IMPL-1i §6.1) the hardware keys and controllers: the on-screen keyboard's note path and the tray wheels' ctl, for the
// selected track's panels only (a stale panel plays nothing); held(): the notes lit now (a bed mounts lit)
const PERF = cvKeys.perfHost({ noteOn: (n, v, ts) => noteOn(n, v, 0, ts), noteOff: (n, ts) => noteOff(n, 0, ts), ctl: (k, v) => ctl(k, v, 0),
  live: k => (perfLive.get(trk().id) || {})[k] || 0, held: () => [...heldLit()], // ((8) a pad's note on another track never lights the selected synth's bed)
  bendUI: v => setBendUI && setBendUI((v + 1) / 2, false), modUI: v => setModUI && setModUI(v, false), sel: v => trOf(v) === trk() });
classicHost.perf = PERF;
// (7a, IMPL-7a §10.1) the drum machines' host (cv-drum drumHost; its deps in cv-drum.js's header): START/STOP synced is the
// project's ▶ / ■ and TEMPO the project tempo (§13 answer 1), the pads the selected track's note path, posts and lights at
// the heard time (outFrame); main's drum section below does the rest (drumSend, drumToRoll, drumLoad, drumLearn …)
const DRUM = cvDrum.drumHost({
  mem: x => { const t = drumTrack(x); return t ? drumOf(t, dvOf(x)) : null; },
  put: (x, D) => drumPut(x, D),
  send: (x, D, S0, at) => drumSend(x, null, at, S0),
  play: () => { if (!T.playing) play(); }, stop: () => { if (T.playing) stop(); },
  playing: () => T.playing, bpm: () => project.bpm, setBpm: (v, ph) => drumSetBpm(v, ph),
  heard: ts => (ctx && ctx !== holdCtx ? outFrame(ts) : NaN), rate: () => (ctx ? ctx.sampleRate : 48000), barTicks: () => S.barTicks(project),
  noteOn: (x, n, v, ts) => noteOn(n, v, 0, ts), noteOff: (x, n, ts) => noteOff(n, 0, ts),
  sel: x => !!x && trOf(x).id === project.selTrack,
  notice: (text, ms, onTap) => { if (onTap) noticeActs.set(text, () => { noticeActs.delete(text); notice('', 0); onTap(); }); notice(text, ms); },
  toRoll: (x, bars) => drumToRoll(x, bars), confirm: text => confirm(text),
  loadSample: (x, sound) => drumLoad(x, sound), learn: (x, fn) => drumLearn(x, fn), monitor: (x, on) => drumMonitor(x, on),
  loop: () => loopInfo(), // ((7a review 2 #4) the extras' hint: a synced cycle longer than the song loop)
  link303: (x, s) => link303(x, s), n303: () => n303(), // ((7b §3.8) SYNC 303s: the 606's button, its state)
});
classicHost.drum = DRUM;
// (8, IMPL-8 §4, §5.3, §6, §8; §17 lane U's deps) the Pads host (cv-pads padsHost): every Pads module's held state, apart from
// any DOM (a hardware pad plays with its module off screen). A pad names its tracks: noteOn's explicit targets with src
// 'pd<k>' (k the host's session number of the track: its own held keys) and o.rec 'target' (the target records, armed or
// not: Q5) — never the selected track by default; a mod pad's value to the value table of every track holding its rows
// (modVal: no repost); a drum hit's REC and the lights through the drum host by the track's machine view; one History step
// per mapping edit (step, the edit, changed)
const trackById = id => project.tracks.find(t => t.id === id) || null;
const padMods = () => (Array.isArray(project.pads) ? project.pads : []);
const padMod = id => padMods().find(M => M && M.id === id) || null;
function padValOf(id) { return PADS.value(id); } // (compileMods' padVal: the live value, the pad's lo at rest)
const padDrumView = t => { const k = cvPads.drumDev(t); return k ? instView(t, k) : null; }; // (the drum host keys its entries by the panels' view)
const midiOk = () => { const n = globalThis.navigator; return !!n && typeof n.requestMIDIAccess === 'function'; }; // (§8.1: no iPad browser has Web MIDI)
// the host's drum lights: one drum-host lit subscription per track for all its subscribers — made again when the track's
// machine is forgotten (a Replace, a delete: drumForget) once it holds its next one, or the track comes back (an undo)
const padLit = new Map(); // track id → { fns: Set(fn(mask)), off: fn | null }
function padLitSync(id) {
  const e = padLit.get(id);
  if (!e) return;
  const t = e.fns.size ? trackById(id) : null, v = t ? padDrumView(t) : null;
  if (!v) { if (e.off) { const f = e.off; e.off = null; f(); } if (!e.fns.size) padLit.delete(id); return; }
  if (!e.off) e.off = DRUM.api(v).lit(mask => { for (const f of [...e.fns]) { try { f(mask); } catch (err) { console.warn(err); } } });
}
const padLitAll = () => { for (const id of [...padLit.keys()]) padLitSync(id); };
function padLitDrop(id) { const e = padLit.get(id); if (e && e.off) { e.off = null; queueMicrotask(() => padLitSync(id)); } } // (the forgotten entry took its subscription with it)
const padIns = new Map(); // track id → Set(fn(n, on)): the host's live input notes of a track (inputNote: the tray, MIDI, other pads)
let padFoot = new Map(); // module id → its footprint's width when the edit in flight took its History step (padsChanged: a Grid… resize)
const PADS = cvPads.padsHost({
  project: () => project,
  noteOn: (tr, n, v, ts, src) => { const t = trackById(tr); if (t) noteOn(n, v, src, ts, [t], { rec: 'target' }); },
  noteOff: (tr, n, ts, src) => noteOff(n, src, ts),
  ctl: (tr, kind, v, ts) => { const t = trackById(tr); if (t) ctl(kind, v, 0, ts, [t]); }, // (the Pencil's aftertouch: that track alone)
  modVal: (src, v) => { const q = PC.padOfSrc(src); if (q) for (const t of CMOD.padTracks(project, src)) modVal(t, q.id, 'p' + q.i, v); },
  drumRec: (tr, s, v, ts) => { const t = trackById(tr), x = t && padDrumView(t); return x ? DRUM.rec(x, s, v, ts) : false; },
  drumLit: (tr, fn) => {
    let e = padLit.get(tr);
    if (!e) padLit.set(tr, (e = { fns: new Set(), off: null }));
    e.fns.add(fn); padLitSync(tr);
    return () => { e.fns.delete(fn); padLitSync(tr); };
  },
  monSync: () => monitors.sync(), // (review #29: drumMonitor's live reads PADS.wants — a change of it alone syncs)
  inputSub: (tr, fn) => {
    let S = padIns.get(tr);
    if (!S) padIns.set(tr, (S = new Set()));
    S.add(fn);
    return () => { const L = padIns.get(tr); if (L && L.delete(fn) && !L.size) padIns.delete(tr); };
  },
  heardTick: () => curTick(), live: id => cvLive(id), drumOf: (t, dev) => drumOf(t, dev),
  step: label => { padFoot = new Map(padMods().map(M => [M.id, cvPads.moduleSize(M).fixed.w])); hist.record(project, label); updateUndoUI(); }, changed: o => padsChanged(o), undo: () => undo(true), rowsOf: src => padRowsOf(src),
  learnPad: () => midi.learnPad(), cancelLearn: () => midi.cancelLearn(true), midiOk: () => midiOk(),
  inputs: () => midi.inputs(), outputs: () => midi.outputs(), hwOut: (port, b) => midi.send(port, b),
  nextNote: fn => { padNext = fn; return () => { if (padNext === fn) padNext = null; }; },
  jump: (tr, id) => cvReveal(tr, id), modelName: m => { const x = MODELS.find(y => y.id === m); return x ? x.name : ''; },
  notice: (text, ms, onTap) => { if (onTap) noticeActs.set(text, () => { noticeActs.delete(text); notice('', 0); onTap(); }); notice(text, ms); },
  confirm: text => confirm(text), raf: f => requestAnimationFrame(f), now: () => performance.now(),
});
// a mod pad's rows on every track, for its inspector: [{ track, label }]
function padRowsOf(src) {
  const out = [];
  for (const x of CMOD.padRows(project, src).byTrack) {
    const t = trackById(x.trackId);
    if (t) for (const id of x.rows) { const r = (t.mods || []).find(m => m && m.id === id); if (r) out.push({ track: t.name, label: modLabel(r.dst, t) }); }
  }
  return out;
}
// after a Pads edit (its History step taken before it): the rows of a pad whose Modulation went off, in the same step (review
// #31: those tracks' payloads); a mod pad's rest value / range to the tables of the tracks holding it (no repost); the canvas
// (the module's fixed size, its jacks, title and cables; the tray's "<PC.MAX_MODS> Pads modules"), the save
function padsChanged(o) {
  const hit = new Set();
  for (const s of o && Array.isArray(o.drop) ? o.drop : []) for (const x of CMOD.dropPadRows(project, s).byTrack) hit.add(x.trackId);
  for (const t of project.tracks) {
    if (hit.has(t.id)) { queuePatch(t); continue; }
    const pay = o && o.id && t.dev ? modsPay(t) : null;
    if (pay && !pay.off) for (const e of pay.vals) { const q = e && PC.padOfSrc(e.id); if (q && q.id === o.id) modVal(t, q.id, 'p' + q.i, PADS.value(e.id)); }
  }
  // (R2-F9) a module that grew or shrank (Grid…): its place on the OTHER tracks, where it stands in Tidy's column (the first lay
  // write there pinned it at the old width), keeps the column's right edge — else it covers their instrument. A place the user
  // moved stays, as does this track's (§1.3: the top-left corner fixed, the user sees it happen); undo / redo carry it (the step)
  for (const M of padMods()) {
    const w0 = padFoot.get(M.id), w1 = cvPads.moduleSize(M).fixed.w, x0 = -cvModule.roundW(w0 + cvModule.MOD_GAP), x1 = -cvModule.roundW(w1 + cvModule.MOD_GAP);
    if (w0 != null && w1 !== w0) for (const t of project.tracks) { const e = t !== trk() && t.lay && typeof t.lay === 'object' ? t.lay[M.id] : null; if (e && e.x === x0) t.lay = Object.assign({}, t.lay, { [M.id]: Object.assign({}, e, { x: x1 }) }); }
  }
  padFoot = new Map();
  cvRender();
  if (hit.size) cvModSync();
  persist(); updateUndoUI();
}
// the Pads modules after the tracks changed under them (a Replace, a track deleted, an undo): the lights' subscriptions, the
// pads' warnings ("No Kick on “Drums” any more"), the "+N on other tracks"
function padsRefresh() { padLitAll(); PADS.resync(); for (const B of modBodies.values()) if (B.kind === 'pads') B.sync(); }
// a window blur / a hidden page: the beds and controllers let go, but a MIDI or tray note still sounds — its bed light stays (1i review F4)
function perfLetGo() { PERF.release(); for (const n of heldLit()) PERF.lit(n, true); } // ((8) the notes that reached the selected track)
const panelKey = v => { const t = trOf(v); return t ? t.id + '/' + dvOf(v) : ''; };
const classicOf = v => { const P = v && classicPanels.get(panelKey(v)); return P && !P.dead && P.track === v ? P : null; };
function aboutUI(m) { $('#about-title').textContent = `${m.maker ? m.maker + ' ' : ''}${m.name} (${m.year})`; $('#about').textContent = m.about; } // ((WC, §2.2) a maker-less model (the rig): no maker clause
// the element instrument dev of t renders into: its module body's own element (cvBodyEl — R6: the primary's too); none
// without the canvas DOM
const instEl = (t, dev) => (cvOn() ? cvBodyEl(t, dev) : null);
function renderPanel(t = trk(), dev = curOf(t)) {
  const iv = instView(t, dev), m = modelById(iv.model), key = t.id + '/' + dev, el = instEl(t, dev);
  const old = classicPanels.get(key);
  if (old) { old.destroy(); classicPanels.delete(key); }
  if (!el) return;
  for (const [k, P] of classicPanels) if (P.root === el) { P.destroy(); classicPanels.delete(k); } // (a panel built there under another key)
  for (const a of ['style', 'data-hw', 'data-ptr', 'data-knurl', 'data-cap']) el.removeAttribute(a); // (a hardware panel's size and --hw-* go)
  cvBuilt.set(key, el);
  const cur = t === trk() && dev === curOf(t);
  if (isSxModel(m)) { renderCustom(el, t, dev); cvPanelDone(); return; }
  sxDropEl(el);
  const L = instUi(t, dev) === 'hw' ? hwLayoutOf(m) : null;
  classicPanels.set(key, new ClassicPanel(el, { track: iv, model: m, layout: L, host: classicHost })); // (Hardware: presets through the chip and the ⋯ menu)
  if (t.dev && CG.modRowsFor(t, dev).length) cpHalos(t, dev); // (2b: its halos, the monitor subscription)
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
const syncPresetSel = k => { const P = curPanel(); if (P) P.syncPreset(k); else cvChipSync(); };
// the TB-303's hardware step entry state (IMPL-panels §6.2): a step cursor and PITCH / TIME mode per track (session only, never
// in the project)
const seqHw = new Map(); // 'trackId/dev' (the 303's view id, R4) → { cur, mode }
// the DX7's select-and-set workflow (IMPL-panels §6.3): {op, param (the button), eg, mode} per track, session only
const dxHw = new Map(); // 'trackId/dev' (the DX7's view id, R4) → { op, param, eg, mode }
function hwDx(iv) { // (iv: the DX7 panel's device view)
  let st = dxHw.get(iv.id);
  if (!st) dxHw.set(iv.id, st = { op: 1, param: 7, eg: 1, mode: 'edit' });
  const m = modelById(iv.model);
  return {
    state: st, algs: DX_ALGS, layout: algoLayout, presets: m.presets.length,
    load: n => { if (iv.model === m.id) presetLoad('f' + (n - 1), iv); },
    presetName: () => iv.preset,
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
function userPresets(m = curModel()) { return store.get('synth.user.' + m.id, []); }
function presetList(m) {
  return m.presets.map((p, i) => ({ key: 'f' + i, name: p.name, v: p.v, group: 'Factory' }))
    .concat(userPresets(m).map((p, i) => ({ key: 'u' + i, name: p.name, v: p.v, group: 'Saved' })));
}
function applyPreset(iv, p) { // (iv: a device view, stage 1e)
  const m = modelById(iv.model), t = trOf(iv), cur = t.id === project.selTrack && panelKey(iv) === t.id + '/' + curOf(t);
  iv.vals = Object.assign(defaults(m), p.v);
  iv.preset = p.name;
  presetKeys.set(iv.id, p.key || null);
  if (cur) bind();
  const P = classicOf(iv);
  if (P) { P.refresh(); if (cur) drawAlgo(); P.syncPreset(p.key); } else if (cur) { drawAlgo(); syncPresetSel(p.key); }
  sendPatch(t); renderHeads(); persist();
}
// The preset actions, shared by the Simple panel's preset plate, the module chip (◀ ▶) and its ⋯ menu (Save / Delete /
// Init: the Hardware panel has no plate; IMPL-panels §7.4), each on a track (default: the selected one). The current
// entry: the one last loaded on that track (presetKeys), else the first with the track's preset name. Stage 1e: each on
// an instrument (a device view: its id 'trackId/dev'; default the selected track's current instrument)
const presetKeys = new Map(); // 'trackId/dev' (a view's id, R4) → the key of the entry last loaded
function presetCur(iv = curView()) { const l = presetList(modelById(iv.model)), k = presetKeys.get(iv.id); return l.find(x => x.key === k && x.name === iv.preset) || l.find(x => x.name === iv.preset) || null; }
function presetLoad(key, iv = curView()) { const p = presetList(modelById(iv.model)).find(x => x.key === key); if (p) applyPreset(iv, p); return !!p; }
function presetStep(d, iv = curView()) { // ◀ ▶: from the blank / Custom entry, ▶ the first, ◀ the last
  const keys = presetList(modelById(iv.model)).map(p => p.key);
  if (!keys.length) return;
  const cur = presetCur(iv);
  let i = cur ? keys.indexOf(cur.key) : -1;
  i = i < 0 ? (d > 0 ? 0 : keys.length - 1) : (i + d + keys.length) % keys.length;
  presetLoad(keys[i], iv);
}
function presetSave(iv = curView()) {
  const m = modelById(iv.model), cur = presetCur(iv);
  const name = (prompt('Name this sound:', iv.preset && cur && /^u\d+$/.test(cur.key) ? iv.preset : 'My ' + m.name + ' sound') || '').trim();
  if (!name) return;
  const up = userPresets(m), i = up.findIndex(p => p.name === name);
  if (i >= 0 && !confirm(`Replace the saved sound “${name}”?`)) return;
  if (i >= 0) up[i] = { name, v: Object.assign({}, iv.vals) }; else up.push({ name, v: Object.assign({}, iv.vals) });
  store.set('synth.user.' + m.id, up);
  iv.preset = name; presetKeys.set(iv.id, 'u' + (i >= 0 ? i : up.length - 1));
  presetShown(iv); renderHeads(); persist();
}
const presetSaved = (iv = curView()) => { const c = presetCur(iv); return c && /^u\d+$/.test(c.key) ? c : null; }; // a saved sound is loaded
function presetDelete(iv = curView()) {
  const c = presetSaved(iv), mm = c && /^u(\d+)$/.exec(c.key), m = modelById(iv.model);
  if (!mm) return;
  const up = userPresets(m), p = up[+mm[1]];
  if (!p || !confirm(`Delete the saved sound “${p.name}”?`)) return;
  up.splice(+mm[1], 1);
  store.set('synth.user.' + m.id, up);
  if (iv.preset === p.name) iv.preset = null;
  presetKeys.delete(iv.id);
  presetShown(iv); renderHeads(); persist();
}
function presetInit(iv = curView()) { presetKeys.delete(iv.id); applyPreset(iv, { name: null, v: {} }); }
// the instrument's preset name changed outside a load: its panel's plate and the chip follow
function presetShown(iv) { const P = classicOf(iv); if (P) P.syncPreset(presetKeys.get(iv.id)); else if (trOf(iv) === trk()) cvChipSync(); }

/* ------------------------------------------ Serum and the FX racks (SPEC-serum §11.8) */
// The panel modules (serum-ui.js, fx-ui.js and their siblings) and wt.js / wtstore.js load on first use, so the other
// models start as before and a failure there leaves them working. The DSP scripts also run on the main thread for the
// panel's displays (wk.loadDSP).
const hostStore = { get: (k, d) => store.get(k, d), set: (k, v) => store.set(k, v) };
let uiLoad = null;
function uiMods() {
  if (!uiLoad) {
    uiLoad = Promise.all([import('./serum-ui.js?v=' + VERSION), import('./fx-ui.js?v=' + VERSION), import('./wk.js?v=' + VERSION), wtMod(), import('./sx-ui-mod.js?v=' + VERSION), import('./rig-ui.js?v=' + VERSION)])
      .then(([sx, fxui, wk, , mod, rig]) => wk.loadDSP(DSP_URLS).then(() => { kitPrefs(wk); return { sx, fxui, wk, mod, rig }; })); // ((3) mod: the part views, PART_W; (WC) rig: the rig's faces, rig-ui)
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
  // (R4) the sound states it reads and edits: every Serum instrument (its state, its own FX) and every FX panel of every
  // track — another Serum's samples and IRs are in use too
  states: () => project.tracks.flatMap(t => Object.keys(t.dev).filter(k => isSxDev(t, k) || (t.dev[k] && t.dev[k].kind === 'panel') || isDrumDev(t, k))
    .map(k => (isDrumDev(t, k) ? { track: t, dev: k, s: null, fx: null, drum: drumOf(t, k) } // ((7a §5) a drum machine: its sample slots)
      : { track: t, dev: k, s: isSxDev(t, k) ? t.dev[k].vals.s : null, fx: t.dev[k].fx })))
    .concat(hasMasterFx() ? [{ track: { id: MASTER, name: MASTER_NAME }, dev: 'mfx', s: null, fx: project.master.fx }] : []), // ((M, §2.2) the master rack: its IRs' users, relinks, learn, gc)
  edit: (x, fn, o) => sxEdit(instView(x.track, x.dev), fn, o),
  editFx: (x, fn, o) => (x.track && x.track.id === MASTER ? masterEdit(fn, o) : fxEditDev(x.track, x.dev, fn, o)),
  editDrum: (x, fn) => drumEdit(x.track, x.dev, fn), // ((7a) a relinked slot)
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
const userSmps = (s, fx, drum) => userAssetIds(s || null, fx || null, drum || null); // ((7a) a drum machine's loaded slots too)

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
  if (role === 'none') return []; // ((3, §2.9) a track-level subscription: the ModCore meters' 'mods' id alone)
  const inst = role !== 'fx', fx = role !== 'inst';
  if (!N || !N.graphed || !t || !t.dev) return [...(inst ? ['i0'] : []), ...(fx ? ['c0'] : [])];
  if (typeof dev !== 'string') return [];
  const own = /\/fx$/.test(dev), d = t.dev[own ? dev.slice(0, -3) : dev];
  if (own) return fx ? (isSxRec(d) ? [dev.slice(0, -3)] : [dev]) : [];
  if (!d) return [];
  if (d.kind === 'panel') return fx ? [dev] : [];
  // a Serum: its Inst part alone, whatever the role — its message carries its own FX's meters and phases ({i, s, gr, fxph,
  // ftap}); its 'iN/fx' part as well would post a second message without the snapshot (blanking the panel's) and tap twice
  if (isSxRec(d)) return [dev];
  const out = inst ? [dev] : [];
  if (fx) { const p = CMOD.destOf(t, dev); if (p && t.dev[p].kind === 'panel') out.push(p); }
  return out;
}
const roleOf = o => (o.role ? o.role : Array.isArray(o.parts) && o.parts.length ? (o.parts.includes('i0') ? (o.parts.includes('c0') ? 'both' : 'inst') : 'fx') : 'both');
const monitors = {
  subs: new Set(), on: new Map(),
  sub(trackId, dev, o) {
    const S = { trackId, dev, role: roleOf(o), live: o.live, deliver: o.deliver, cur: [], mods: !!o.mods }; // (mods: the 'mods' monitor id — the ModCore's live meters, IMPL-2b)
    this.subs.add(S);
    this.sync();
    return () => { if (this.subs.delete(S)) this.sync(); };
  },
  wanted(id, N0) { // → the parts to monitor, sorted ([] = none)
    const w = new Set();
    if (document.hidden) return [];
    if (id === MASTER) { // ((M, §2.2) MASTER's ids are its subscriptions' devs: 'meters' (the row, the OUT), 'mfx' (the rack module)
      for (const S of this.subs) if (S.trackId === MASTER) { S.cur = [S.dev]; try { if (S.live()) w.add(S.dev); } catch (err) { console.warn(err); } }
      return [...w].sort();
    }
    const N = N0 || nodes.get(id), t = project.tracks.find(x => x.id === id);
    for (const S of this.subs) if (S.trackId === id) {
      S.cur = partsOf(t, N, S.dev, S.role);
      try { if (S.live()) { for (const q of S.cur) w.add(q); if (S.mods) w.add('mods'); } } catch (err) { console.warn(err); }
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
    if (id === MASTER) { const k = d.t === 'mmon' ? 'meters' : 'mfx'; for (const S of [...this.subs]) if (S.trackId === MASTER && S.dev === k && S.deliver) S.deliver(d); return; } // ((M) mmon → the meters, smon → the rack
    const part = typeof d.i === 'string' ? d.i : typeof d.c === 'string' ? d.c : null;
    if (part === null && d.mc) { for (const S of [...this.subs]) if (S.trackId === id && S.mods && S.deliver) S.deliver(d); return; } // (the meters' own message: never a part's snapshot)
    for (const S of [...this.subs]) if (S.trackId === id && S.deliver && (part === null || S.cur.includes(part) || (d.i === part && S.cur.includes(part + '/fx')) || (S.role === 'none' && S.mods && d.mc))) S.deliver(d); // ((3) a track-level meters subscription takes mc wherever it rides)
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
function sxMonitor(t, on, dev = curOf(t)) { // (R6: dev default the current instrument)
  const id = t.id, key = id + '/' + dev, off = sxMons.get(key);
  if (!on) { if (off) { sxMons.delete(key); off(); } return; }
  if (off) { monitors.sync(); return; }
  sxMons.set(key, monitors.sub(id, dev, { role: 'both', // (its snapshot, and its FX page's meters; stage 1e: that device's panel)
    live: () => { const r = sxRecOf(id, dev); return !!r && r.trackId === id && ((r.mode === 'parts' && r.ui && typeof r.ui.anyShown === 'function' ? r.ui.anyShown() : cvLive(dev)) || sxInjLive(id, dev)); }, // ((3, H4) parts: while any of its views is shown; review 2: or a canvas ENV injected into it)
    deliver: d => { const r = sxRecOf(id, dev); if (r && r.ui && r.trackId === id) { r.ui.setSnapshot(d); zoneWarm(id, dev, d.s); } sxInjSnap(id, dev, d && d.s); }, // (R2: every Serum's zones; review 2: a canvas ENV injected into it)
  }));
}
// "Switch to Single Sample" (host.smp.saveFrom → zoneOf): the zone sample the panel's recent voice plays, from the
// snapshot's zone index and the multisample's record (read once per multisample, cached)
const msRecs = new Map();
function zoneWarm(id, dev, sn) { // (R2: Serum dev of track id, the snapshot its panel got)
  const t = project.tracks.find(x => x.id === id), d = t ? instOf(t, dev) : null;
  if (!sn || !sn.zone || !isSxRec(d)) return;
  for (let o = 0; o < 3; o++) {
    const O = d.vals.s.osc[o], m = O && O.type === 'multi' ? O.multi : '';
    if (!m || sn.zone[o] < 0 || msRecs.has(m)) continue;
    msRecs.set(m, null);
    Promise.resolve(smpHost.record(m)).then(r => msRecs.set(m, r || null), () => msRecs.delete(m));
  }
}
function zoneOf(o, dev) { // (R6: Serum dev of the selected track — default its current instrument —, its panel record's snapshot)
  const t = trk(), k = dev || curOf(t), rec = sxRecOf(t.id, k), d = instOf(t, k), sn = rec && rec.ui && rec.trackId === t.id && rec.ui.snap;
  if (!isSxRec(d) || !sn || !sn.zone || !(o >= 0 && o < 3)) return null;
  const O = d.vals.s.osc[o], r = O && O.multi ? msRecs.get(O.multi) : null, z = sn.zone[o];
  return r && Array.isArray(r.zones) && z >= 0 && z < r.zones.length && r.zones[z] ? r.zones[z].smp || null : null;
}

// FX rack edits (any track, either view): the host compiles and sends unless the edit is UI-only; seed = the edit
// loaded a chain / module preset (§4.2). Not in the undo history (knob-tweak policy, §11.8).
// Stage 1e: t a device view (its Serum's own FX / its panel), or fxEditDev(t, dev) — dev a Serum, a panel or null (the
// primary's FX)
function fxEdit(t, fn, o) { fxEditDev(trOf(t), dvOf(t), fn, o); }
function fxEditDev(t, dev, fn, o) {
  if (dev == null && t.dev) { const f = CMOD.fxDevOf(t); dev = f ? f.id : null; } // (no device named: the primary's FX device — a Serum's own, a classic's panel)
  fn(fxOfDev(t, dev));
  if (o && o.ui) { persist(); return; }
  fxPrune(t, dev);
  if (o && o.seed) seedPend.add(t.id);
  const d = dev && t.dev ? t.dev[dev] : null;
  if (isSxRec(d)) sxDirty.add(instView(t, dev).id); // (a Serum's own FX: that Serum edited since its preset)
  queuePatch(t); persist();
}
// (2b, fixer C ← fixer B) an effect instance removed from a rack takes the canvas cables on its knobs with it
// (cv-model pruneRows, once merged: validate does not report such rows); said as removeInst says it
function fxPrune(t, dev) {
  if (typeof CMOD.pruneRows !== 'function' || !t.dev || !dev || !CG.modRowsFor(t, dev).length) return 0;
  let r = null;
  try { r = CMOD.pruneRows(t, dev); } catch (err) { console.warn(err); return 0; }
  const n = typeof r === 'number' ? r : r && Array.isArray(r.rows) ? r.rows.length : r && typeof r.n === 'number' ? r.n : Array.isArray(r) ? r.length : 0;
  if (n > 0) { notice(`${n} modulation cable${n > 1 ? 's' : ''} removed with the effect`, 5000); modHalos(t); cvRender(); }
  return n;
}
const sxDirty = new Set(); // Serums ('trackId/dev', R4) edited since their preset was loaded / saved (program change asks, §9.10)
function sxEdit(x, fn, o) { // (x: a device view, stage 1e; a bare track — the asset manager's —: its primary)
  const iv = x && instView(trOf(x), dvOf(x)), s = iv && iv.vals && iv.vals.s;
  if (!s) return;
  const os = s.global.os;
  fn(s);
  if (o && o.ui) { persist(); return; }
  if (o && o.seed) { seedPend.add(trOf(iv).id); sxPruneAuto(trOf(iv), dvOf(iv)); } // ((3) a preset-like load in the panel — Init Preset, Hybridize, its undo / redo of a load: §3's prune)
  sxDirty.add(iv.id);
  queuePatch(trOf(iv)); persist();
  if (s.global.os !== os && ctx) rateText();
  if (o && o.label === 'Init Preset') { iv.preset = 'Init'; sxKeys.delete(iv.id); sxDirty.delete(iv.id); renderHeads(); } // the panel's menu
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
  for (const t of project.tracks) if (all || hasSx(t)) queuePatch(t);
  if (all) masterSend(); // ((M) its rack's smoothing / silence tails
  if (uiLoad) uiLoad.then(M => kitPrefs(M.wk), () => {});
}
// the latest LFO phases of a track's rack (FXRack.phases(): fxLayout order, NaN = no LFO) → the FX state (v2 inst.ph by
// instance, v1 fx.phase; fx-core storePhases): saved with presets and projects, no re-seed (§8.1, §11.8)
function setPhases(fx, v) { if (v) core.storePhases(fx, v); } // (R3: a rack, not a track)
const MODFX = ['fx.hyper.on', 'fx.flg.on', 'fx.phs.on', 'fx.cho.on'];
const PH_TYPES = new Set(['hyper', 'flg', 'phs', 'cho', 'bode']);
function hasLfoFx(fx) { // a rack whose phases are worth reading back (an enabled module with an LFO)
  if (!isV2Fx(fx)) return MODFX.some(id => fx.p[id] >= 0.5);
  return core.fxLayout(fx).inst.length > 0 && fx.racks.some(r => r && Array.isArray(r.mods) && r.mods.some(function on(I) {
    return !!I && ((PH_TYPES.has(I.type) && !!I.p && I.p.on >= 0.5) || (Array.isArray(I.br) && I.br.some(b => Array.isArray(b) && b.some(on))));
  }));
}
function syncPhases() { // (R3: every rack of every track — its node's last phases while its monitor is on, else asked)
  const jobs = [];
  for (const t of project.tracks) {
    const N = nodes.get(t.id);
    if (!N) continue;
    for (const k of rackKeys(t, N)) {
      const fx = fxOfDev(t, k);
      if (!hasLfoFx(fx)) continue;
      if (monitors.fx(t.id, k) && N.fxph.get(k)) { setPhases(fx, N.fxph.get(k)); continue; }
      jobs.push(new Promise(res => {
        const tm = setTimeout(res, 300);
        askPhases(t, N, k, v => { clearTimeout(tm); setPhases(fx, v); res(); });
      }));
    }
  }
  const M = mnode, mfx = hasMasterFx() ? project.master.fx : null; // ((M) the master rack's phase memory: asked of MASTER
  if (M && mfx && hasLfoFx(mfx)) jobs.push(new Promise(res => { const tm = setTimeout(res, 300); M.phWait = v => { clearTimeout(tm); setPhases(mfx, v); res(); }; postTo({ id: MASTER }, { t: 'fxph' }); }));
  return Promise.all(jobs);
}
// the Save download: the project plus the user wavetables and user samples / multisamples / IRs its tracks reference
// (§7.10, SPEC-serum2 §9.8: Convolve IRs of any track; never in the autosave)
async function projectFile() {
  await syncPhases();
  const ids = new Set(), sm = new Set();
  for (const t of project.tracks) {
    for (const k of Object.keys(t.dev || {})) { // (every Serum and panel of the track, the primary's among them — R2)
      const d = t.dev[k], x = d && d.kind === 'synth' && isSxRec(d) && d.vals ? d.vals.s : null, dr = isDrumDev(t, k) ? drumOf(t, k) : null; // ((7a) a drum machine's slots)
      if (!d || (d.kind !== 'panel' && !x && !dr)) continue;
      for (const id of userTables(x)) ids.add(id);
      for (const id of userSmps(x, d.fx, dr)) sm.add(id);
    }
  }
  if (hasMasterFx()) for (const id of userSmps(null, project.master.fx, null)) sm.add(id); // ((M) the master rack's IRs too
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
const sxKeys = new Map(); // 'trackId/dev' (R4) → key of the preset that Serum was loaded from
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
function sxCurrent(iv) { // (iv: a Serum's device view)
  const k = sxKeys.get(iv.id);
  if (k && sxPreset(k)) return k;
  if (!iv.preset) return null;
  return sxPreset('u:' + iv.preset) ? 'u:' + iv.preset : sxPreset('f:' + iv.preset) ? 'f:' + iv.preset : null;
}
// applyPreset / applyPresetFx build new states (never Object.assign of preset objects: factory presets are frozen). FX: the
// v2 rule (a v1 preset rack migrates with the new Serum state as refs; locked racks kept, the incoming Serum state's rows
// follow renamed instances, locked parameters keep their values, §11.2)
function sxLoad(x, key) { // (x: a device view, stage 1e; a bare track: its primary)
  const p = sxPreset(key), iv = x && instView(trOf(x), dvOf(x));
  if (!p || !isSxRec(iv)) return false;
  const s = core.applyPreset(iv.vals.s, p, { midiFromPreset: prefs.midiFromPreset });
  const cur = iv.fx, pfx = p.fx && typeof p.fx === 'object' ? p.fx : null;
  iv.fx = core.applyPresetFx(cur, pfx || core.defaultFx2(), s);
  iv.vals.s = s;
  iv.preset = p.name; sxKeys.set(iv.id, key); sxDirty.delete(iv.id);
  sxPruneAuto(trOf(iv), dvOf(iv)); // ((3) the automatic part places it left off and unread go, §3)
  seedPend.add(trOf(iv).id);
  sendPatch(trOf(iv));
  renderHeads(); persist(); sxRefresh();
  if (ctx) rateText();
  cvModReload(trOf(iv)); // (stage 2a: the canvas cables stay — re-injected by that compile —; the preset cables re-derived)
  return true;
}
function sxSaveUser(up) { store.set('synth.user.serum', up); }
function sxSave(x, name, cat) { // (x: a device view, a bare track its primary; R3: its own rack's phase memory, N.fxph by rack)
  name = String(name || '').trim().slice(0, 64);
  const iv = x && instView(trOf(x), dvOf(x));
  if (!name || !isSxRec(iv)) return null;
  const t = trOf(iv), dev = dvOf(iv), N = nodes.get(t.id), fx = fxOfDev(t, dev);
  if (N && N.fxph.get(dev)) setPhases(fx, N.fxph.get(dev)); // the rack's current LFO phases (phase memory)
  const up = sxUser(), i = up.findIndex(p => p.name === name);
  const entry = { name, cat: String(cat || 'User').trim().slice(0, 32) || 'User', v: { s: clone(iv.vals.s) }, fx: core.blankSrc(fx) }; // ((SC §1.3) no track id leaves the project: its sidechain sources blank
  if (i >= 0 && up[i].meta) entry.meta = up[i].meta; // overwriting keeps its rating / tags / comments
  if (i >= 0) up[i] = entry; else up.push(entry);
  sxSaveUser(up);
  iv.preset = name; sxKeys.set(iv.id, 'u:' + name); sxDirty.delete(iv.id);
  renderHeads(); persist();
  if (N && !monitors.fx(t.id, dev)) { // monitoring off: ask the rack for its phases and complete the stored preset
    askPhases(t, N, dev, v => {
      if (!v) return;
      setPhases(fx, v);
      const l = sxUser(), e = l.find(p => p.name === name);
      if (e) { e.fx = core.blankSrc(fx); sxSaveUser(l); }
      persist();
    });
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
  for (const [vid, x] of sxKeys) if (x === key) { sxKeys.set(vid, k); const iv = viewOfKey(vid); if (iv) iv.preset = name; }
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
// MIDI program change n → the n-th entry of the browser's current filtered, sorted list (§9.10, §11.8): each target track's
// primary instrument (named: CMOD.primId — R2), when it is a Serum; the confirm through that device's panel when it is up
function programChange(trs, n) {
  const sx = trs.filter(t => isSxDev(t, CMOD.primId(t)));
  if (!sx.length) return;
  uiMods().then(M => {
    const list = M.sx.browserList(sxPresetList(), store.get(M.sx.BROWSER_KEY, null)), p = list[n];
    if (!p) return;
    for (const t of sx) {
      if (!project.tracks.includes(t)) continue;
      const dev = CMOD.primId(t), iv = instView(t, dev), r = sxRecOf(t.id, dev);
      const ask = r && r.ui && r.trackId === t.id ? !r.ui.confirmChange()
        : prefs.askPreset && sxDirty.has(iv.id) && !confirm('Discard changes to “' + (iv.preset || 'Init') + '”?');
      if (!ask) sxLoad(iv, p.key);
    }
  }, () => {});
}

/* MIDI (SPEC-serum2 §12.6, B19): Web MIDI input, MPE zone routing and MIDI Learn live in midi.js (role I2); main.js is
   its host and keeps the live input routing shared with the on-screen and computer keyboards (held notes, recording,
   power, the wheels). Learned controllers write their destinations (FX destinations through fxSet); MIDI Learn stores the
   next controller 0–119 in s.midi. */
// (IMPL-B §6) what the host callbacks received, for SHELL.probe().midi: n messages (notes, every CC once — the wheel and the
// pedal ride theirs —, bend, channel pressure), the last wheel (0…1) and bend (−1…1)
const midiSeen = { n: 0, wheel: 0, bend: 0 };
const midi = createMidi({
  targets: src => targets(src),
  noteOn: (n, v, src, ts) => (midiSeen.n++, noteOn(n, v, src, ts)),
  noteOff: (n, src, ts, rv) => (midiSeen.n++, noteOff(n, src, ts, rv)),
  ctl: (kind, v, src, ts, trs) => {
    if (kind === 'wheel') midiSeen.wheel = v; else if (kind === 'bend') midiSeen.bend = v;
    if (kind === 'bend' || kind === 'at') midiSeen.n++;
    return ctl(kind, v, src, ts, trs || targets(src));
  },
  post: (t, m) => postTo(t, m),
  // stage 1e: the Serum instruments of a track ([{id, s, fx, prim}], the primary first): each has its own learn map
  instsOf: t => (t.dev ? CMOD.instIds(t).filter(id => isSxRec(t.dev[id])).map(id => ({ id, s: t.dev[id].vals.s, fx: fxOfDev(t, id), prim: id === CMOD.primId(t) })) : []),
  heldNotes: src => heldNotes(src),
  programChange: (trs, n) => programChange(trs, n),
  modUI: v => { if (setModUI) setModUI(v, false); },
  bendUI: v => { if (setBendUI) setBendUI(v, false); },
  track: id => project.tracks.find(x => x.id === id),
  fxSet: (t, id, n, dev) => fxSet(t, id, n, dev),
  // (R4: the Serum learned / forgotten — dev —, else every Serum of the track a mapped controller may have written)
  changed: (t, patch, refresh, dev) => { for (const k of dev ? [dev] : sxIds(t)) sxDirty.add(vkey(t, k)); if (patch) queuePatch(t); persist(); if (refresh) sxRefresh(); },
  notice: (txt, ms) => notice(txt, ms),
  button: () => $('#midi'),
  modCC: (ch, cc, v) => (midiSeen.n++, modCC(ch, cc, v)), // (2b: the canvas CC modules, CC learn)
  // (8, §8.2) a learned hardware pad plays its canvas pad and goes nowhere else (true); a port gone ends its pads' notes (review #9)
  padIn: (e, port, ts) => PADS.midiIn(e, port, ts),
  ports: names => { PADS.ports(names); for (const B of modBodies.values()) if (B.kind === 'pads') B.sync(); }, // (the footers' hardware dots)
});
const midiLearn = (id, dest, dev = null) => midi.learn(id, dev, dest); // (dev: the Serum instrument; null: the primary)
const cancelLearn = say => midi.cancelLearn(say);
const midiForget = (t, dest, dev = null) => midi.forget(t, dest, dev);
// preference "Mod wheel → WT Pos": while a WT editor is open the wheel scrubs its oscillator's WT POS (§9.9)
let wtEdit = null; // { id: track id, dev: its Serum (U7: the one whose editor is open, not always the primary), osc }
function wheelToWt(v) {
  if (!prefs.wheelWt || !wtEdit) return;
  const t = project.tracks.find(x => x.id === wtEdit.id), iv = t && (!t.dev || CMOD.instOf(t, wtEdit.dev)) ? instView(t, wtEdit.dev) : null;
  if (!iv || !isSxRec(iv)) return;
  iv.vals.s.p[['a', 'b', 'c'][wtEdit.osc] + '.wt'] = clamp(+v || 0, 0, 1);
  sxDirty.add(iv.id);
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
// (IMPL-M §1.1, §4) o.master — only the bounce's: { fxr, fxrT (none: an empty master), transport, frames, lmax, needs }: bus →
// MASTER (offline: the same processor, made after every item so node 0's stores are there for its rack, nodes[0] stays the first
// track) → destination; lmax frames more are rendered (a host-side bound of its path latency) and the buffer carries MASTER's
// report: buf.master = { lat (mlat: the frames to drop; null without the report), fin (mfinal: i, tpMax, pk, lra — null without
// it) }, both awaited ≤ 1 s after the render. Resample and render-last stay pre-master (no o.master)
async function renderOffline(sr, frames, items, at, o = null) {
  if (!window.OfflineAudioContext) throw new Error('offline rendering is not available in this browser');
  const mo = o && o.master ? o.master : null, lmax = mo ? Math.max(0, Math.ceil(+mo.lmax || 0)) : 0;
  const oc = new OfflineAudioContext({ numberOfChannels: 2, length: Math.max(128, Math.ceil(frames)) + lmax, sampleRate: sr });
  await addModules(oc);
  const ids = new Set();
  for (const it of items) {
    for (const id of [...((it.patch && it.patch.needs) || []), ...(it.needs || [])]) ids.add(id); // ((7a) a drum track's slots beside its patch's needs)
    if (it.graph && it.tr) learnStates(it.tr);
  }
  if (mo && Array.isArray(mo.needs) && mo.needs.length) { for (const id of mo.needs) ids.add(id); tables.learn({ fx: masterFx() }); } // ((M, §4) the master rack's IRs join the union)
  const ents = ids.size ? await tables.entries([...ids], sr, at) : [];
  const wts = ents.filter(e => idKind(e.id) === 'wt'), smps = ents.filter(e => idKind(e.id) !== 'wt');
  const bus = oc.createGain(), made = [], byId = new Map();
  items.forEach((it, n) => {
    const po = { os: it.os, hostOS: it.hostOS || it.os, offline: true, patch: it.patch, wts: n === 0 && wts.length ? wts : null,
      smps: n === 0 && smps.length ? smps : null, song: it.song, transport: it.transport, seq: it.seq || null, trackId: it.tr ? it.tr.id : '' };
    if (it.graph) Object.assign(po, { graph: it.graph, patches: it.patches, chains: it.chains, seqs: it.seqs });
    if (it.mods) po.mods = it.mods; // (2b: the ModCore payload, handled after the parts)
    const node = new AudioWorkletNode(oc, 'synth-engine', { // ((SC §1.1) the live node's options: one stereo input, the key)
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
      processorOptions: po,
    });
    const g = oc.createGain(), pn = oc.createStereoPanner();
    g.gain.value = it.gain === undefined ? 1 : it.gain; pn.pan.value = it.pan || 0;
    node.connect(g); g.connect(pn); pn.connect(bus);
    made.push(node); if (it.tr) byId.set(it.tr.id, node);
  });
  // ((SC §7.2) the key edges as live: src.node → kg → node, kg the item's gain for that source (1 a compressor's key, 0 order only))
  items.forEach((it, n) => {
    if (!Array.isArray(it.sc)) return;
    for (const [id, gv] of it.sc) {
      const s = byId.get(id);
      if (!s || s === made[n]) continue;
      const kg = oc.createGain();
      kg.gain.value = gv; s.connect(kg); kg.connect(made[n], 0, 0);
    }
  });
  if (!mo) { bus.connect(oc.destination); return oc.startRendering(); }
  const rep = { lat: null, fin: null, wake: null };
  const mn = new AudioWorkletNode(oc, 'synth-master', {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
    processorOptions: Object.assign({ offline: true, transport: mo.transport, frames: mo.frames }, mo.fxr ? { fxr: mo.fxr, fxrT: mo.fxrT } : null), // (no bypass: Q2)
  });
  mn.port.onmessage = e => { const d = e.data; if (d && d.t === 'mlat') rep.lat = +d.lat || 0; else if (d && d.t === 'mfinal') rep.fin = d; if (rep.wake) rep.wake(); };
  bus.connect(mn); mn.connect(oc.destination);
  const buf = await oc.startRendering();
  if (rep.lat === null || rep.fin === null) await new Promise(res => { const tm = setTimeout(res, 1000); rep.wake = () => { if (rep.lat !== null && rep.fin !== null) { clearTimeout(tm); res(); } }; });
  rep.wake = null;
  buf.master = { lat: rep.lat, fin: rep.fin };
  return buf;
}
// (IMPL-M §4) a host-side upper bound of a rack's path latency (frames at sr): every Distortion's 15, every compressor at its
// look-ahead cap (10 ms) — all in series, a splitter's branches summed (an over-estimate costs nothing: MASTER reports the real one)
function latBound(fx, sr) {
  const R = isV2Fx(fx) && fx.racks[0] && Array.isArray(fx.racks[0].mods) ? fx.racks[0].mods : [];
  const one = I => (I && I.type === 'dist' ? 15 : I && I.type === 'cmp' ? Math.ceil(0.01 * sr) + 2 : 0);
  let n = 0;
  for (const I of R) { n += one(I); if (I && Array.isArray(I.br)) for (const B of I.br) if (Array.isArray(B)) for (const c of B) n += one(c); }
  return n;
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
// (O2, R1-5) Auto tail: the end of what is audible, found from the render's END — the last frame at or above thr, searched back down
// to `from` (the song's end), plus `keep` frames, at most `max` frames past `from`. A scan forward for the first quiet gap would stop
// at a delay's first 0.5 s of silence between echoes and drop the rest
function tailLast(chs, from, thr, keep, max) {
  const L = chs[0], R = chs[1], len = L.length;
  let i = len - 1;
  while (i >= from && !(Math.abs(L[i]) >= thr || Math.abs(R[i]) >= thr)) i--;
  return Math.min(len, Math.max(from, i + 1) + keep, from + max);
}
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = n => NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1); // the app's naming: C4 = MIDI 60

// Resample to (§9.8, SPEC-serum2 §12.6 B25; target 'A' | 'B' | 'C' | 'AB' | 'sel'): note 60, velocity 127, one bar at
// the song tempo through the patch and its FX rack, offline at 44.1 kHz (the Phase-1 recipe); the release tail ends once
// the output stays below −90 dBFS for 50 ms (at most 2 s). The render is imported into the chosen oscillator (AB: L → A,
// R → B) as its type takes it: a Wavetable oscillator gets a wavetable (the Phase-1 recipe); a Sample, Granular or
// Spectral oscillator gets a user sample (§9.1 `smp:` origin "resample"; root 60, folder Renders) and keeps its type and
// sample options (only the trim of the previous sample is dropped); a Multisample oscillator becomes a Sample oscillator.
async function resampleTo(x, target) { // (x: a device view — a Serum besides the primary renders alone, buildInstPatch; a bare track: its primary)
  const iv = x && instView(trOf(x), dvOf(x));
  if (!isSxRec(iv)) return;
  const W = await wtMod(), sr = 44100, s = iv.vals.s, bt = S.barTicks(project), fpt = sr * 60 / (project.bpm * S.PPQ);
  const gate = Math.round(bt * fpt), patch = isPrim(iv) ? buildPatch(trOf(iv), sr, true) : buildInstPatch(trOf(iv), dvOf(iv), sr, true); // (R1: the primary through buildPatch, its bytes)
  const buf = await renderOffline(sr, gate + 2 * sr, [{ tr: null, patch, os: sxOSFor(iv, sr, true), hostOS: osCap(sr),
    song: { notes: [0, bt, 60, 127], cc: [] }, transport: { play: true, frame: 0, tick: 0, fpt, loop: false } }], { s, fx: iv.fx });
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
  sxEdit(iv, st => { for (const d of done) toOsc(st, d); }, { label: 'Resample' });
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
  const dev = (o && o.dev) || curOf(t), d = t.dev ? t.dev[dev] : null, legacy = dev === CMOD.primId(t) && legacyOk(t); // (legacy: the primary of a one-instrument node)
  if (!isSxDev(t, dev)) throw new Error('Rendering needs a Serum-engine track'); // ((WC, G13) a rig renders too: no word of one model
  const s = d.vals.s, fx = fxOfDev(t, dev), pn = d.preset; // (the primary's FX device is its own: fxOf's rack — R2)
  const name = (pn || 'Init').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Init';
  if (o && o.shift) {
    const pre = Object.assign({ type: 'synth.serum.preset', name, v: { s: clone(s) }, fx: core.blankSrc(fx) }, await presetAssets([{ v: { s }, fx }])); // ((SC §1.3) sources blank)
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
  const buf = await renderOffline(sr, (last + 10.05) * sr, [{ tr: t, patch, os: sxOSFor(d, sr, true), hostOS: osCap(sr), song,
    transport: { play: true, frame: 0, tick: 0, fpt, loop: false }, mods: modsFor(t) }], { s, fx }); // (2b: the Serum alone on a legacy node — its ext rows run; rows to other devices find no Inst there)
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
      node.connect(g); g.connect(mnode ? mnode.node : master); // ((M) the sum: through the master effects, counted by its meters)
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
// .scl when only a .kbm comes, §11.4) → {name, kind, scl, kbm, tab} | {error} | null (cancelled). iOS / iPadOS (the app,
// Safari): no accept — its document picker greys a .scl under this filter (an unknown extension's dynamic type); the
// extension and tuningState check the file instead; the input sits hidden in the document while open (the app's WKWebView
// never fires change on a detached one — the module pickers' way, wk.js pickFile) (IMPL-A fix R1-F3)
function tuningFile(cur) {
  return new Promise(res => {
    const inp = h('input');
    inp.type = 'file'; inp.multiple = true; inp.accept = isIOS() ? '' : '.scl,.kbm,.tun,text/plain';
    inp.style.display = 'none';
    const done = r => { inp.remove(); res(r); };
    inp.onchange = async () => {
      const fs = [...(inp.files || [])];
      if (!fs.length) { done(null); return; }
      const files = {};
      for (const f of fs.slice(0, 3)) {
        if (f.size > 16384) { done({ error: f.name + ' is too large' }); return; }
        const ext = (/\.(scl|kbm|tun)$/i.exec(f.name) || [])[1];
        if (ext) files[ext.toLowerCase()] = await f.text();
        if (ext && !files.name) files.name = f.name.replace(/\.(scl|kbm|tun)$/i, '');
      }
      done(core.tuningState(files, cur || null));
    };
    inp.addEventListener('cancel', () => done(null));
    document.body.appendChild(inp);
    inp.click();
  });
}

// Stage 2a (IMPL-2a §2.4): the canvas mod rows on knob destId of Serum dev that compile (placed), as matrix rows ({id, src:
// the Serum source, amt, bi, byp, out}) for serum-ui haloArcs and the knob menu
function sxExtra(t, dev, destId) {
  const rows = t && t.dev ? CG.modRowsFor(t, dev) : [], key = dev + ':' + destId, mine = rows.filter(r => r.dst === key);
  if (!mine.length) return [];
  const on = new Map(CG.injectMods(t.dev[dev], rows, modsExt(t), t).placed.map(x => [x.id, x.src])); // (2b: the Serum source each reads — ext<k>, an injected lfo<k> / env<k>, a native id)
  return mine.filter(r => on.has(r.id)).map(r => sxRow(t, r, on.get(r.id) || CMOD.MOD_SRC[r.src]));
}
// a canvas row as serum-ui / fx-ui read it: the Serum source it reads, (fixer C, U6) the host's label of the canvas source
// ("LFO 1", a macro knob by its name; an ext source has no Serum name) and (U5) the source's polarity (bend / chaos swing both ways)
const sxRow = (t, r, src) => ({ id: r.id, src, amt: r.amt, bi: r.bi, byp: r.byp, out: r.out, label: modLabelIn(t, r.src), pol: /^(bend|chaos)$/.test(cvCables.srcKind(r.src) || CMOD.MOD_SRC[r.src] || '') ? 'bi' : 'uni' });
// (fixer C, U6) the Serum's matrix page: every canvas row compiled into Serum dev, with the slot it took as a tag
// ("ext 1", an injected "LFO 3" / "ENV 2", a native "Velocity"; one the compile left out "not compiled") and its destination
function sxMatrixRows(t, dev) {
  const rows = t && t.dev && t.dev[dev] ? CG.modRowsFor(t, dev) : [];
  if (!rows.length) return [];
  const inj = CG.injectMods(t.dev[dev], rows, modsExt(t), t), on = new Map(inj.placed.map(x => [x.id, x.src]));
  const tag = src => { const m = /^(ext|lfo|env|chaos)(\d+)$/.exec(src || ''); return m ? (m[1] === 'ext' ? 'ext ' : m[1].toUpperCase() + ' ') + m[2] : src ? (CMOD.MOD_LABEL[CMOD.SRC_MOD && CMOD.SRC_MOD[src]] || src) : 'not compiled'; };
  return rows.map(r => { const D = modSplit(r.dst), src = on.get(r.id) || null; return Object.assign(sxRow(t, r, src || CMOD.MOD_SRC[r.src] || r.src), { dst: D ? D.pid : r.dst, tag: tag(src) }); });
}
// a Serum module's "mods n/64" (stage 2a, IMPL-2a §2.4; cvBadge): null without canvas rows to it (the badge keeps the
// safeguard's text); else cv-graph modBudget { preset, canvas, left, max } and text 'mods <preset + canvas>/64', ' · N not
// compiled' while rows find no slot (as the Mod list). modLeftN: the count last seen per Serum (cvModReload tells a rise)
const modLeftN = new Map(); // '<track id>/<dev>' → rows not compiled
function modCount(t, dev = t && curOf(t)) {
  const d = t && t.dev && t.dev[dev];
  if (!d || (d.kind !== 'synth' && d.kind !== 'panel') || !CG.modRowsFor(t, dev).length) return null;
  const b = modBudgetOf(t, dev), n = b.left.length, sx = d.kind === 'synth' && isSxRec(d);
  modLeftN.set(t.id + '/' + dev, n);
  return Object.assign(b, { text: 'mods ' + (sx ? Math.min(b.max, b.preset + b.canvas) + '/' + b.max : b.canvas + n) + (n ? ' · ' + n + ' not compiled' : '') }); // (2b: a classic / panel "mods n")
}
// (fixer C, U9) cv-graph modBudget with `canvas` on a classic / panel device as DISTINCT row ids (a cable whose knob moves
// several things — a Juno Env A, a selector — compiles into several payload rows; the badge and the Mod list count cables)
function modBudgetOf(t, dev) {
  const b = CG.modBudget(t, dev, project);
  if (!isSxDev(t, dev)) { const p = buildMods(t); if (!p.off) { const mine = new Set(CG.modRowsFor(t, dev).map(r => r.id)); b.canvas = new Set(p.rows.filter(r => mine.has(r.id)).map(r => r.id)).size; } }
  return b;
}
// the Serum panel's host (§8.8, RULINGS host additions, SPEC-serum2 §11.15); bound to a track id, reading the live
// project each call. Stage 1e: bound to one Serum instrument of the track (dv, default the primary): its state, own FX,
// presets, resample and tuning through its device view
function sxHost(t0, dv) {
  const id = t0.id, T = () => project.tracks.find(x => x.id === id) || t0, dev = dv || curOf(t0) || 'i1'; // (stage 1e: its device; R6: default the current instrument)
  const V = () => instView(T(), dev);
  return {
    state: () => V().vals.s,
    edit: (fn, o) => { sxEdit(V(), fn, o); if (!(o && o.ui)) peerRefresh(id, 2, dev); else cvRemeasure(id, dev); cvChipSync(); }, // (the FX module follows: peerRefresh; (2a) a page switch: the knob ends re-measured)
    fx: () => fxOfDev(T(), dev),
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
    extraMatrix: () => sxMatrixRows(T(), dev), // ((2b U6) the matrix page: every canvas row compiled into this Serum, its slot tag)
    fxTap: inst => postTo({ id }, { t: 'fxtap', id: typeof inst === 'string' ? inst : '' }, dev),   // (the FX page's Delay overlay)
    fxCost, // (the FX page's "+" menu: each effect's load estimate on this device)
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
    tracks: () => project.tracks.filter(q => q.id !== id).map(q => ({ id: q.id, name: q.name, model: instOf(q).model })), // (MIDI OUT targets: each track's instrument)
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
    scSources: () => scSources(id), // ((SC §6.1, the lead's (d)) the Serum panel's FX page: serum-ui's adapter forwards it to its rack's source menus
    envSwap: (a, b) => rigEnvSwap(T(), dev, a, b), // ((WC, §3.4) the kit's Swap / label drag with ENV 1 a party on a rig: rig-core's slot move, one step
    envInit: () => (isRigDev(T(), dev) ? (rigEnvInit(T(), dev), true) : false), // ((WC, §3.4; review 1 P3-1) the kit's Init Module on ENV 1 of a rig (a knob's menu too): envFromAmp
    get words() { return isRigDev(T(), dev) ? RIG_KIT_WORDS : null; }, // ((WC, G13) the kit's own texts a rig's dialogs show: rig-core's words
  };
}
// the FX rack host: any track's FX (Serum's parameter locks hold, §9.6); a Serum's own FX show the three racks. Stage 1e:
// the rack of rec.dev — a Serum instrument (its own FX), a shared panel, or null (the primary's FX: fxOf)
function fxHost(t0, rec = fxRecOf(t0.id, fxKeyOf(t0)) || fxPanelRec()) { // (R6: default the current instrument's FX record, else a detached one)
  const id = t0.id, T = () => project.tracks.find(x => x.id === id) || t0;
  const sx = () => { const t = T(), d = rec.dev && t.dev ? t.dev[rec.dev] : null; return d ? (d.kind === 'synth' && isSxRec(d) ? rec.dev : null) : isSxDev(t, curOf(t)) ? curOf(t) : null; }; // (no device named: the current instrument's FX)
  const own = () => { const k = sx(); return k ? instView(T(), k) : null; }; // (the Serum whose own FX this rack is)
  return {
    fx: () => fxOfDev(T(), rec.dev),
    editFx: (fn, o) => { fxEditDev(T(), rec.dev, fn, o); peerRefresh(id, 1, sx()); }, // (the Serum panel follows: peerRefresh)
    v2Fx: true,
    racks: () => (sx() ? 3 : 1),
    irs: smpHost,
    state: () => { const iv = own(); return iv ? iv.vals.s : null; },
    edit: (fn, o) => { const iv = own(); if (iv) { sxEdit(iv, fn, o); peerRefresh(id, 1, sx()); } },
    bpm: () => project.bpm,
    gr: () => (rec.trackId === id ? rec.gr : null),
    // the rack's monitor tap (§13.5 Delay spectrum overlay): instance id ('' off) → the node; the latest 1024 frames
    tap: () => (rec.trackId === id ? rec.ftap || null : null),
    setTap: inst => postTo({ id }, { t: 'fxtap', id: typeof inst === 'string' ? inst : '' }, rec.dev), // (a panel: c; a Serum's own: i)
    locked: dest => { const iv = own(); return !!iv && !!iv.vals.s && iv.vals.s.locks.p.includes(dest); },
    storage: hostStore,
    notify: txt => notice(txt, 3500),
    extraRows: destId => { const k = sx(); return k ? sxExtra(T(), k, destId) : []; }, // ((2b U5) a Serum's own FX: the canvas cables on its knobs — the rack's control menu names them; modHalos paints them)
    scSources: () => scSources(id), // ((SC §6.1) the Ducker's TRIGGER / the compressor's key menus: this track is self
  };
}

// The mounted Serum panels: rebuilt when the track or its state container changes (another project, a model change),
// refreshed otherwise (undo keeps the container, §11.8). One record per Serum instrument (serumPanels, 'trackId/dev' →
// { ui, el, box, gen … }), each in its module body — (milestone 3, R6) the primary's too: no singleton, no #inst.
// Milestone 3 (IMPL-3 §2.4, lane D): the record is the Serum's host and its views, { host (= ui: the SerumUI), views, mode }:
// mode 'bundled' (the host's shell in box) or 'parts' (VOICE in box, each part module's panel in its body: views, module key
// → { V, el }); a view switch (lay[dev].ui: (WC) a rig's, and its undo) changes the views, never the host — its
// panel undo, dirty and view state survive (sxViews)
const sxRecMk = () => ({ ui: null, trackId: null, dev: null, vals: null, box: null, el: null, gen: 0, views: null, mode: null, drop() { sxDrop(this); }, get host() { return this.ui; } });
const serumPanels = new Map();
const sxRecs = () => [...serumPanels.values()];
function sxDrop(r) {
  r.gen++;
  const u = r.ui, tid = r.trackId;
  r.ui = null; r.trackId = null; r.vals = null; r.views = null; r.mode = null; // ((3) its views go with the host)
  if (u && (!wtEdit || (wtEdit.id === tid && wtEdit.dev === r.dev))) wtEdit = null; // (its own editor only, U7)
  cancelLearn(!!u);
  if (u) { try { u.destroy(); } catch (err) { console.warn(err); } }
  monitors.sync();
}
function sxRec(t, dev) {
  const k = t.id + '/' + dev;
  let r = serumPanels.get(k);
  if (!r) serumPanels.set(k, r = sxRecMk());
  return r;
}
function sxRecOf(id, dev) { return serumPanels.get(id + '/' + dev) || null; }
function sxDropEl(el) { for (const r of sxRecs()) if (r.el === el && (r.ui || r.box)) { sxDrop(r); r.box = null; } } // (a classic panel goes where it was)
function renderCustom(el, t = trk(), dev = curOf(t)) {
  const iv = instView(t, dev), m = modelById(iv.model), rec = sxRec(t, dev);
  if (t === trk() && dev === curOf(t)) { aboutUI(m); drawAlgo(); }
  if (rec.ui && rec.trackId === t.id && rec.vals === iv.vals) { rec.ui.refresh(); sxViews(t, dev); return; } // ((3) a view switch: the same host)
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
      if (M.mod) { SXMOD = M.mod; SXW = M.mod.PART_W || null; }
      rigUiOf(M); // ((WC) the rig's faces and its jack menu: rig-ui's host, once
      const tr = project.tracks.find(x => x.id === t.id) || t, parts = !isSerumModel(m) && !!SXMOD && sxParts(tr, dev); // ((3) built in the view its flag names; (WC) the bundled Serum is always whole: sxParts is the rig's)
      rec.trackId = t.id; rec.dev = dev; rec.vals = iv.vals; rec.views = new Map();
      rec.ui = new M.sx.SerumUI(box, sxHost(t, dev), parts ? { parts: true } : undefined);
      rec.mode = parts && rec.ui.bundled === false ? 'parts' : 'bundled';
      sxViews(tr, dev);
      if (parts) cvRelabel(); // (the bars' power slots and the part titles: the part views are in now)
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
// monitor subscription delivers, and its host reads them from it. One record per FX module (fxPanels, 'trackId/key': a
// panel, a Serum's own FX), each in its module body — (milestone 3, R6) the primary's FX too: no singleton, no #fxrack
const fxPanelRec = () => ({ ui: null, trackId: null, dev: null, key: null, fx: null, sx: false, gr: null, ftap: null, gen: 0, mon: null, el: null });
const fxPanels = new Map();
const fxRecs = () => [...fxPanels.values()];
function fxRec(t, key) {
  const k = t.id + '/' + key;
  let r = fxPanels.get(k);
  if (!r) fxPanels.set(k, r = fxPanelRec());
  return r;
}
function fxRecOf(id, key) { return fxPanels.get(id + '/' + key) || null; }
// the FX module key of instrument dev of t (default the current one): a Serum's own 'iN/fx', a classic's panel; null: none
function fxKeyOf(t, dev = curOf(t)) {
  if (!t || !t.dev) return null;
  if (isSxDev(t, dev)) return dev + '/fx';
  const p = CMOD.destOf(t, dev);
  return p && t.dev[p] && t.dev[p].kind === 'panel' ? p : null;
}
function fxDrop(rec) {
  rec.gen++;
  const u = rec.ui;
  rec.ui = null; rec.trackId = null; rec.dev = null; rec.fx = null; rec.gr = null; rec.ftap = null;
  if (u) { try { u.destroy(); } catch (err) { console.warn(err); } }
  if (rec.mon) { const off = rec.mon; rec.mon = null; off(); }
  monitors.sync();
}
// every FX module of the selected track (its panels, its Serums' own FX)
function renderFxTabs(t = trk()) { for (const d of cvModule.devicesOf(t)) if (d.kind === 'fx') renderFxTab(t, d.key); }
// the FX module `key` of track t ('fxN' a shared panel, 'iN/fx' a Serum's own FX; default the current instrument's FX), in
// its module body's own element (R6: the primary's FX too; its title is the module's)
function renderFxTab(t = trk(), key = fxKeyOf(t)) {
  const box = cvOn() && key ? cvBodyEl(t, key) : null;
  if (!box) return;
  const own = key && /\/fx$/.test(key) ? key.slice(0, -3) : null, dev = own || key || null, rec = fxRec(t, key);
  cvBuilt.set(t.id + '/' + key, box);
  const fx = fxOfDev(t, dev), sx = own ? true : !dev && isSxDev(t, curOf(t));
  if (rec.ui && rec.trackId === t.id && rec.fx === fx && rec.sx === sx) { rec.ui.refresh(); if (key) fxHalos(t, key); return; } // (halos: the rows of the track as it is now, after an undo too)
  fxDrop(rec);
  box.innerHTML = '';
  box.append(h('p', 'boot', 'Loading the FX rack…'));
  rec.el = box;
  const gen = rec.gen;
  cvBuild(uiMods()).then(M => {
    rigUiOf(M); // ((WC) the panels are in: rig-ui's host with them (an FX rack loads them first on a classic track)
    if (gen !== rec.gen) return;
    box.innerHTML = '';
    try {
      rec.trackId = t.id; rec.dev = dev; rec.key = key; rec.fx = fx; rec.sx = sx;
      rec.ui = new M.fxui.FXRackUI(box, fxHost(t, rec), { embedded: false, dsp: globalThis.FXDSP || null, racks: sx ? 3 : 1, v2Fx: true, cost: fxCost }); // (cost: the "+" menu's estimates)
      if (rec.ui && rec.ui.el && dev) rec.ui.el.setAttribute('data-dev', dev); // (its fx.<inst>.<pid> dests: that device's)
      if (key) fxHalos(t, key); // ((U5, halos fix) a Serum's own FX / a shared panel: the canvas rows' halos from the start)
      rec.mon = monitors.sub(t.id, dev, { role: 'fx', live: () => rec.trackId === t.id && !!rec.ui && cvLive(key), deliver: d => { rec.gr = d.gr || null; rec.ftap = d.ftap || null; if (key) fxLive(t.id, key, rec, d); } });
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
function drawAlgo() { // (the current instrument's: R6, its view)
  const box = $('#algo'), iv = curView(), alg = iv.vals && iv.vals.alg;
  if (iv.model !== 'dx7') { box.hidden = true; return; }
  box.hidden = false;
  const a = DX_ALGS[clamp(Math.round(alg), 1, 32) - 1];
  const [edges, car, fb] = a;
  const { xs, lvl, maxL, cols } = algoLayout(edges, car);
  const W = 44, Hh = 46, bw = 30, bh = 24;
  const width = cols * W + 20, height = (maxL + 1) * Hh + 40;
  const P = i => ({ x: 10 + xs[i] * W + W / 2, y: 14 + (maxL - lvl[i]) * Hh + bh / 2 });
  let s = `<svg viewBox="0 0 ${width} ${height}" width="${width * 1.3}" role="img" aria-label="Algorithm ${Math.round(alg)} diagram">`;
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
  box.innerHTML = `<p class="help" style="margin:0 0 6px">Algorithm ${Math.round(alg)} — carriers (filled) feed the output bus; the loop marks operator feedback.</p>` + s;
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
  return Object.assign({ pat: q.pat, len: 16, bpm: q.bpm, swing: q.swing / 100 * 0.5, root: cvKeys.SEQ_ROOT, sync: !!q.sync, run: seqRun.has(dev ? tr.id + '/' + dev : tr.id) && !q.sync }, extra || {});
}
function seqSend(tr, a, b) { let [dev, extra] = devArgs(a, b); if (tr.track) { dev = tr.devId; tr = tr.track; } postTo(tr, { t: 'seq', s: seqPayload(tr, dev, extra) }, dev); persist(); link303Chk(); } // ((7b) its SYNC: the 606's SYNC 303s button)
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
      const n = cvKeys.seqNote(s), t = at + i * 240; // (1i: the 303's one root, its keys' audition too)
      if (prev && prev.slide) { prev.note.d = t - prev.note.t + 60; }
      const note = { id: S.newId(), t, d: 120, n, v: s.a ? 127 : 80 };
      tr.notes.push(note);
      prev = { note, slide: !!s.s };
    });
  }, [tr]);
}

/* ------------------------------------------------- drum machines (stage 7a) */
// IMPL-7a §10.1: the page's drum machines run through cv-drum's drumHost (DRUM, below the classic host): each machine's
// session (drum-core press(state, record, input); never saved), its step posts and monitor lights at their heard time,
// the pads. A panel's `track` is a device view (id 'trackId/dev'); every dep resolves the track by that id (undo / load
// replace the track objects). The record (dev.drum) is written back without a History step (the 303's policy, §6); the
// machine hears of it through drumSend.
const drumTrack = x => { const o = x ? trOf(x) : null, id = o && typeof o === 'object' ? o.id : null; return id == null ? null : project.tracks.find(t => t.id === id) || null; };
const drumSess = (t, dev) => DRUM.api(instView(t, dev)).state().S;
const drPkOf = N => N.drPk || (N.drPk = new Map()); // (dev → the content key of the payload the node holds)
// the {t: 'seq'} payload (drum-core payload, §3.5): the plan, the clock, the note map, the mute mask, the slots — offline
// (a bounce, a render; SYNC on or off — a machine's notes need its tables) from a fresh session: synced or silent, never
// running; (7c review #1) at the project tempo, as the live session — a synced 909's flams are whole ticks at that tempo;
// (7c review 1 F2) with the live session's plan inputs (DC.planSess: the 909's / 606's TRACK WRITE pointer and chosen key, the
// 606's D.S.) — the bounce plays the measure heard, not the track's first; the 808's none
function drumPayload(t, dev, offline = false) {
  const D = drumOf(t, dev);
  return DC.payload(D, offline ? Object.assign(DC.initState(instOf(t, dev).model), { bpm: project.bpm }, DC.planSess(D, drumSess(t, dev))) : drumSess(t, dev), 'now'); // ((7b) the machine's own fresh session)
}
// drumSend(view | track, dev?, at, S?, force): the payload to the machine when its content key changed (or `at` asks for a
// swap, or force). A slot switched on or off first re-sends the track's patch (its needs: the patch's and the slots', 2
// levels); a payload naming a slot whose entry is still being built waits for it (§5: the {t: 'smp'} entry before the
// payload naming it — the machine plays the circuit until then), a newer payload of the machine replacing a waiting one
function drumSend(x, dev0, at = 'now', S0 = null, force = false) {
  const t = drumTrack(x), dev = x && x.track ? x.devId : dev0 != null ? dev0 : t && CMOD.primId(t);
  if (!t || !isDrumDev(t, dev)) return;
  persist();
  const N = nodes.get(t.id);
  if (!N) return;
  const s = DC.payload(drumOf(t, dev), S0 || drumSess(t, dev), at), pk = drPkOf(N);
  if (!force && at === 'now' && pk.get(dev) === s.pk) return;
  pk.set(dev, s.pk);
  if (drumNeeds(t).join() !== (N.drIds || '')) sendPatch(t);
  const W = N.drWait || (N.drWait = new Map()), post = () => { W.delete(dev); postTo(t, { t: 'seq', s }, dev); };
  const wait = (s.smp || []).filter(e => e && e.on && !tables.sent.has(e.id) && tables.pend.has(e.id)).map(e => tables.pend.get(e.id));
  if (!wait.length) { post(); return; }
  W.set(dev, post);
  const go = () => { if (W.get(dev) === post && nodes.get(t.id) === N) post(); };
  Promise.all(wait).then(go, go);
}
// every drum machine's panel re-reads its record (undo / redo, a load: new track objects, the records kept or restored)
function drumChanged() { for (const t of project.tracks) for (const k of drumDevs(t)) DRUM.changed(instView(t, k)); }
// a machine leaves (its track deleted, its model replaced): its session, monitor and the node's payload key go
function drumForget(t, dev) {
  const iv = instView(t, dev);
  drumMonitor(iv, false); DRUM.forget(iv);
  padLitDrop(t.id); // ((8) a Pads module lit from it: subscribed again to the track's next machine (padsRefresh)
  const N = nodes.get(t.id);
  if (N && N.drPk) N.drPk.delete(dev);
}
// the record written back by the panel's state machine (put): no History step; MAP… re-reads the roll's drum rows
function drumPut(x, D) {
  const t = drumTrack(x), dev = dvOf(x);
  if (!t || !isDrumDev(t, dev) || !D) return;
  const was = t.dev[dev].drum;
  t.dev[dev].drum = D;
  persist();
  if (roll && t.id === project.selTrack && (!was || was.map !== D.map)) { roll.refreshRows(); rollDrumUI(); }
}
// the asset manager's edit of a machine's record (a relinked sample slot, §5): written, sent, its panel told
function drumEdit(x, dev, fn) {
  const t = drumTrack(x), D = t ? drumOf(t, dev) : null;
  if (!D || typeof fn !== 'function') return;
  const E = clone(D);
  fn(E);
  t.dev[dev].drum = DC.normDrum(E, instOf(t, dev).model); // ((7b review #4) a 606's record stays a 606's: its patterns, chains and tracks)
  drumSend(t, dev); DRUM.changed(instView(t, dev));
}
/* ------------------------------------------------- the 900 Series (stage 9) */
// IMPL-9 §3.1–§3.2, §6: a patch instrument's graph — patch-core payload(rec): {pg, pk}, pk its content key (colours, names and
// cord ids never in it) — reaches its Inst as {t: 'seq', s} after its {t: 'patch'} (pv: the knobs, models.js map); the node's
// key per device (drPkOf, the drum machines' map): an unchanged graph is never posted again (the engine's graph() allocates and
// re-plans: a knob or a colour is no graph change); force: after a kind change (the key may hold an equal graph from before).
// (9b, IMPL-9b §1.4) with the device's vals: the routing panels' live rows ride in it (a bus switch's flip changes pk)
function patchPayload(t, dev) { const rec = patchOf(t, dev); return PT.payload(rec, rec.f, t.dev[dev].vals); }
function patchSend(t, dev, force = false) {
  const N = t ? nodes.get(t.id) : null;
  if (!N || !isPatchDev(t, dev)) return false;
  if (typeof N.waitP === 'function') { // a graph post waiting on assets (a Convolve IR rebuilding): its knobs go with it — the graph after them (sendGraph's late)
    if (!N.ptLate) N.ptLate = new Map();
    N.ptLate.set(dev, force || N.ptLate.get(dev) === true);
    return false;
  }
  const s = patchPayload(t, dev), pk = drPkOf(N);
  if (!force && pk.get(dev) === s.pk) return false;
  pk.set(dev, s.pk);
  postTo(t, { t: 'seq', s }, dev);
  return true;
}
// {t: 'ptErr', why, i?} (E9): 'load' — the patch scripts missing in the worklet: that 900 Series is silent (one notice a
// session); 'graph' (P, review F1 / R2) — the evaluator could not build the patch (a throw on an extreme one: the machine keeps
// its previous graph): a notice once a burst — every report keeps the burst open, so edits that keep failing say it once, and a
// new one after PT_GRAPH_QUIET_MS without any; any other why — a payload item the machine dropped (a newer file's module, a
// cord it refused): a console line
const PT_GRAPH_QUIET_MS = 30000;
let ptErrSaid = false, ptGraphAt = -Infinity;
function ptErr(t, d) {
  console.warn('900 Series: the patch engine ' + (d.why === 'load' ? 'did not load' : 'dropped a payload item (' + d.why + ')') + ' — track “' + t.name + '”');
  if (d.why === 'graph') {
    const T0 = Date.now(), fresh = T0 - ptGraphAt > PT_GRAPH_QUIET_MS;
    ptGraphAt = T0;
    if (fresh) notice('This patch is too complex to run — the last working version stays in use', 10000);
    return;
  }
  if (d.why !== 'load' || ptErrSaid) return;
  ptErrSaid = true;
  notice('The patch engine did not load: this 900 Series is silent', 10000);
}
// a synced machine with a step that sounds plays with no notes (the bounce's "audible", §4.4 — the 303's syncedOf)
function drumAudible(t, dev) {
  const D = drumOf(t, dev);
  return !!D && D.x.sync && DC.compilePlan(D, D.ui, D.x).st.some(m => (m & 0xFFE) !== 0);
}
// TEMPO / FINE while synced set the project tempo (§13 answer 1) — the tempo box's path, one History step per gesture
// (ph 'move' inside a drag: recorded at its first change; 'end' at its lift; none: one key / wheel step)
let drBpmG = false;
function setProjectBpm(v) {
  project.bpm = clamp(+v || 120, 20, 300);
  $('#tBpm').value = project.bpm;
  reanchor(false); persist();
  for (const t of project.tracks) for (const id of CMOD.instIds(t)) { const d = t.dev[id]; if (d.model === 'tb303' && d.seq && d.seq.sync) seqSend(t, id); }
  queueAll();
  DRUM.bpm(project.bpm); // ((7a) the synced machines' TEMPO shows it)
}
function drumSetBpm(v, ph) {
  v = clamp(Math.round(+v * 100) / 100, 20, 300);
  if (!(v > 0)) return;
  const g = drBpmG;
  if (ph === 'end') drBpmG = false;
  if (v === project.bpm) { if (ph === 'end') updateUndoUI(); return; }
  if (!(g && (ph === 'move' || ph === 'end'))) hist.record(project, 'Tempo');
  if (ph === 'move') drBpmG = true;
  setProjectBpm(v);
  updateUndoUI();
}
// TAP (the header, joined to BPM; ≤ 900 px in ⋯, #tTapM — the user, 2026-10-26: "a tap button for tapping in the tempo"): from
// the 2nd tap the tempo is 60 / the mean of the last ≤ TAP_N intervals, a whole BPM (20–300), set through setProjectBpm (the
// tempo box's path: a playing song re-anchors, synced machines follow). A gap ≥ TAP_GAP ms or an interval > 2× the running
// mean starts a new sequence (that tap its first). One History step "Tempo" a sequence, recorded at its first change — again
// only when another step came on top of it (an undo, an edit), never with a drum TEMPO drag's (drBpmG) — and always its own
// (forced: a top step that holds this state already is another action's, maybe with meta: one ↶ would take back both): ts
// the tap's time (ms, an event's timeStamp)
const TAP_GAP = 2000, TAP_N = 8;
let tapTs = [], tapStep = null;
function tapTempo(ts) {
  const L = tapTs, n = L.length, dt = ts - L[n - 1];
  if (!n || !(dt > 0) || dt >= TAP_GAP || (n > 1 && dt > 2 * (L[n - 1] - L[0]) / (n - 1))) { L.length = 0; tapStep = null; }
  L.push(ts);
  if (L.length > TAP_N + 1) L.shift();
  if (L.length < 2) return;
  const v = clamp(Math.round(60000 * (L.length - 1) / (L[L.length - 1] - L[0])), 20, 300);
  if (v === project.bpm) return;
  if (!tapStep || hist.u[hist.u.length - 1] !== tapStep) { hist.record(project, 'Tempo', true); tapStep = hist.u[hist.u.length - 1]; }
  setProjectBpm(v);
  updateUndoUI();
}
// the press taps at once (pointerdown: no click delay on a touch screen; not a right / middle button) and its click is no
// second tap; a click with no pointer before it (detail 0: VoiceOver, Switch Control) is one. Enter, and Space when focused
// from the keyboard (focused by a press, Space stays Play / stop, as for every button), tap on their keydown — taken, so no
// click of their own (a held key's repeats taken, no taps). No letter shortcut: the computer keyboard's letters play notes.
// A two-finger gesture landing on it (gesture.js: a pointercancel flagged 'two-finger' before the lift) takes its tap back —
// the tempo, the step it opened (that one only), the sequence as it was. b: #tTap or ⋯'s #tTapM — one sequence for both
function initTap(b) {
  let back = null, downAt = -Infinity, odd = false; // back: { id, L, step, bpm } — the state before the press still down
  const hit = ts => {
    tapTempo(ts > 0 ? ts : performance.now());
    odd = !odd; b.classList.toggle('fa', odd); b.classList.toggle('fb', !odd); // (the flash: a new animation-name restarts it, no forced layout)
  };
  // the flash's class goes when it ends, or is cancelled as the button hides (⋯ closed, ≤ 900 px): an animation left on it
  // would play again each time it shows. Only the current one's (a tap mid-flash cancels the old one; its end may come late)
  const off = e => { if (e.animationName === (odd ? 'tapfa' : 'tapfb')) b.classList.remove('fa', 'fb'); };
  b.addEventListener('animationend', off); b.addEventListener('animationcancel', off);
  b.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    e.preventDefault(); // (no compatibility mouse events: a press takes no focus — Space after tapping still plays / stops)
    back = { id: e.pointerId, L: tapTs.slice(), step: tapStep, bpm: project.bpm };
    downAt = e.timeStamp;
    hit(e.timeStamp);
  });
  b.addEventListener('pointerup', e => { if (back && back.id === e.pointerId) back = null; });
  b.addEventListener('pointercancel', e => {
    if (e.gesture !== 'two-finger' || !back || back.id !== e.pointerId) return;
    const o = back, own = tapStep !== o.step && hist.u[hist.u.length - 1] === tapStep; // (own: this tap opened the top step)
    back = null;
    tapTs = o.L; tapStep = o.step;
    if (project.bpm !== o.bpm) setProjectBpm(o.bpm);
    if (own) hist._drop(hist.u.pop());
    updateUndoUI();
  });
  b.addEventListener('click', e => { if (!e.detail && !(e.timeStamp - downAt < 1000)) hit(e.timeStamp); });
  b.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && !(e.key === ' ' && kbFocus(b))) return;
    e.preventDefault(); // (the page's keys skip it: main initKeys reads defaultPrevented)
    if (!e.repeat) hit(e.timeStamp);
  });
}
// "→ Piano roll" (§4.3): what the plan plays for `bars` bars from the playhead floored to a bar, as notes (v 100 / 127,
// the sounds' primaries, the sequencer's own whole-tick swung positions) — one History step "Pattern to notes" whose meta
// puts SYNC back on its undo (keepDevs keeps the record with SYNC off: drBack) — then SYNC off and the machine stopped, so
// the pattern is not heard twice; the notice's tap undoes both. (7b review 1 #4, the lead's decision) The machine's own TEMPO
// (the 808's TEMPO + FINE) is set to the project tempo with it — its stopped clock (the 606's open hat's cut after ■) then
// reads what the synced pattern's read — and put back by the same undo (meta.drumSync k0 / k1)
function drumToRoll(x, bars) {
  const t = drumTrack(x), dev = dvOf(x), D = t ? drumOf(t, dev) : null;
  if (!D) return;
  const bt = S.barTicks(project), nb = clamp(Math.round(+bars) || 4, 1, 999), t0 = S.snapTick(T.playing ? curTick() : T.pos, bt, 'floor');
  // ((7b review #5) the machine's own primaries: a 606's map read as a 606's — HT on 45 / 47 keeps them; (7c §4, §10) drum-core's
  // rollPlan / rollOpts: the 808's / 606's today's plan and options, the 909's plan as the synced sequencer plays it at the
  // project tempo — its flams' whole ticks — carrying its shuffle, flams and accents)
  const d = instOf(t, dev);
  const notes = DC.toNotes(DC.rollPlan(D, project.bpm, drumSess(t, dev)), Object.assign({ t0, t1: t0 + nb * bt }, DC.rollOpts(D, d))); // ((7c review 1 F2) the session: TRACK WRITE's measure heard)
  if (!notes.length) { notice('Nothing to write: the pattern has no hits there', 4000); return; }
  flush();
  hist.record(project, 'Pattern to notes');
  const step = hist.u[hist.u.length - 1], sync0 = !!D.x.sync, ids = [], D1 = DC.withTempo(D, project.bpm), k0 = drTempoOf(D), k1 = drTempoOf(D1);
  if (step) { step.label = 'Pattern to notes'; step.meta = { drumSync: { track: t.id, dev, sync: sync0, k0, k1 } }; } // (an equal top step is this one: its undo is this edit's)
  for (const q of notes) { const id = S.newId(); ids.push(id); t.notes.push({ id, t: q.t, d: q.d, n: q.n, v: q.v }); }
  changed([t]); sendSong(t, true); // (the notes now, not after changed()'s 60 ms: they reach the worklet with the SYNC-off payload, so a step due between is played once)
  const iv = instView(t, dev);
  if (D1 !== D) drumPut(iv, D1); // (first: the SYNC-off payload carries the tempo)
  DRUM.press(iv, { k: 'sync', v: false });
  if (drumSess(t, dev).run) DRUM.press(iv, { k: 'start' }); // (a free machine running: stopped too)
  if (D1 !== D) drumSend(iv); // (a machine already SYNC off and stopped: no press sent — its tempo, once)
  DRUM.changed(iv);
  const m = modelById(d.model), short = m.name.replace(/^TR-/, ''); // ("the 808's own sequencer", "the 606's")
  cvUndoNotice(`Written to the piano roll · the ${short}’s own sequencer is off so it isn’t heard twice · tap to undo`, step, () => {
    const tr = project.tracks.find(y => y.id === t.id);
    if (!tr || !isDrumDev(tr, dev) || !tr.notes.some(y => ids.includes(y.id))) return null; // (already undone, or replaced)
    return () => { // (a later step on top: both put back as a step of their own)
      hist.record(project, 'Undo pattern to notes');
      tr.notes = tr.notes.filter(y => !ids.includes(y.id));
      changed([tr]); sendSong(tr, true); // (with the SYNC-on payload: no step heard twice)
      const iv2 = instView(tr, dev), Dn = drumOf(tr, dev), Db = drTempoPut(Dn, k0);
      if (Db !== Dn) drumPut(iv2, Db); // ((7b review 1 #4) its own TEMPO back)
      if (sync0) DRUM.press(iv2, { k: 'sync', v: true });
      if (Db !== Dn) { drumSend(iv2); DRUM.changed(iv2); }
    };
  });
}
// (7b review 1 #4) a machine's own tempo knobs { m, tempo, fine? } (→ Piano roll's undo), and a record with them put back —
// the same machine's only (a Replace since: left alone); the same record when they are already so. (7c) By the record's
// machine, three ways: the 606's and the 909's TEMPO in BPM, the 808's TEMPO + FINE (a 909 read as an 808 came back an 808)
const drMach = D => (D.m === 'tr606' || D.m === 'tr909' ? D.m : 'tr808');
const drTempoOf = D => (drMach(D) === 'tr808' ? { m: 'tr808', tempo: D.ui.tempo, fine: D.ui.fine } : { m: D.m, tempo: D.ui.tempo });
function drTempoPut(D, k) {
  if (!D || !k || typeof k !== 'object' || drMach(D) !== k.m) return D;
  const u = k.m === 'tr808' ? { tempo: k.tempo, fine: k.fine } : { tempo: k.tempo };
  return Object.keys(u).every(f => D.ui[f] === u[f]) ? D : DC.normDrum(Object.assign({}, D, { ui: Object.assign({}, D.ui, u) }), k.m);
}
let drBack = null; // { mv: the "Pattern to notes" step's meta.drumSync, redo } — read after hist.undo / hist.redo
const drBackOf = (e, redo) => (e && e.meta && e.meta.drumSync && typeof e.meta.drumSync === 'object' ? { mv: e.meta.drumSync, redo } : null);
function drBackApply(p, { mv, redo }) {
  const t = p.tracks.find(x => x.id === mv.track), D = t ? drumOf(t, mv.dev) : null, y = redo ? false : !!mv.sync;
  if (D && D.x.sync !== y) t.dev[mv.dev].drum = Object.assign({}, D, { x: Object.assign({}, D.x, { sync: y }) });
  const D2 = t ? drumOf(t, mv.dev) : null, D3 = drTempoPut(D2, redo ? mv.k1 : mv.k0); // ((7b review 1 #4) its TEMPO (FINE) too)
  if (D3 !== D2) t.dev[mv.dev].drum = D3;
}
// (7b §3.8, §10) SYNC 303s — the TR-606 was the TB-303's partner, but a new 303's sequencer runs on its own clock (SYNC off)
// while a new 606 follows the song. n303() → { n, synced }: the project's TB-303s (every device) and whether all are on SYNC
// (the 606's button: hidden with none, "303s synced" when all are); link303Chk tells the drum panels (DRUM.link303()) when that
// changes — a 303's SYNC (seqSend), the project's 303s (renderHeads: an add, a delete, a Replace, an undo, a load)
const tb303s = () => { const out = []; for (const t of project.tracks) for (const id of CMOD.instIds(t)) { const d = t.dev[id]; if (d && d.kind === 'synth' && d.model === 'tb303') out.push({ t, id }); } return out; };
function n303() { const L = tb303s(); return { n: L.length, synced: L.every(({ t, id }) => !!(t.dev[id].seq && t.dev[id].seq.sync)) }; }
let l303 = '';
function link303Chk() { const r = n303(), k = r.n + ':' + r.synced; if (k !== l303) { l303 = k; DRUM.link303(); } }
// an open TB-303 panel reads its SYNC / Run / SWING when it is built (classic-panel seqParts): rebuilt after someone else wrote them
function seq303UI(L) { for (const { t, id } of L) { const P = classicPanels.get(t.id + '/' + id); if (P && !P.dead) renderPanel(t, id); } }
// SYNC 303s (the drum panel's dr:link, or the offer's tap; s = drum-core swing303 of the machine's swing): every TB-303 to
// SYNC (its free run stopped), its swing s — the 303's 0–50 is s / 200 of a 16th, the drum machines' 50–75 % whole ticks:
// s = 4 · (P − 50), equal before rounding, clamped at 50 (62.5 %, said in the notice). Not a History step (a 303's pattern
// state never is, keepDevs); the notice's tap puts each one's sync, swing and run back
function link303(x, s) {
  const L = tb303s();
  if (!L.length) return;
  const sw = clamp(Math.round(+s) || 0, 0, 50), t0 = drumTrack(x), D = t0 ? drumOf(t0, dvOf(x)) : null, cut = !!D && 4 * (D.x.swing - 50) > 50, back = [];
  for (const { t, id } of L) {
    const q = seqOf(t, id), run = seqRun.has(t.id + '/' + id);
    back.push({ tid: t.id, id, sync: !!q.sync, swing: q.swing, run });
    q.sync = true; q.swing = sw;
    if (run) seqToggle(t, false, true, id); else seqSend(t, id); // (one payload each: SYNC, its swing, not running)
  }
  seq303UI(L); link303Chk();
  const n = L.length, msg = `${n} TB-303${n > 1 ? 's now follow' : ' now follows'} the song${cut ? ', swung as far as the TB-303 swings' : ''} · tap to undo`;
  noticeActs.set(msg, () => { noticeActs.delete(msg); notice('', 0); unlink303(back); });
  notice(msg, 8000);
}
function unlink303(back) {
  const L = [];
  for (const b of back) {
    const t = project.tracks.find(y => y.id === b.tid), d = t && t.dev ? t.dev[b.id] : null;
    if (!d || d.kind !== 'synth' || d.model !== 'tb303') continue; // (gone, or replaced since)
    const q = seqOf(t, b.id);
    q.sync = b.sync; q.swing = b.swing;
    if (b.run) seqToggle(t, true, true, b.id); else seqSend(t, b.id);
    L.push({ t, id: b.id });
  }
  seq303UI(L); link303Chk();
}
// the one-time offer (§3.8): a 606 arrives (the Drums view's tap or drop, Replace with…, + Track) in a project with a TB-303
// on its own clock — once per project in a session, after the arrival's own notice (a microtask: the caller's "Replaced … ·
// tap to undo" first; ↶ still undoes it); its tap is the 606's SYNC 303s
const offered303 = new Set(); // (project uids)
function offer303(x) {
  const tid = trOf(x).id, dev = dvOf(x);
  queueMicrotask(() => {
    const t = project.tracks.find(y => y.id === tid), key = project.uid || '';
    if (!t || !isDrumDev(t, dev) || offered303.has(key)) return;
    const free = tb303s().filter(({ t: u, id }) => !(u.dev[id].seq && u.dev[id].seq.sync));
    if (!free.length) return;
    offered303.add(key);
    const names = [...new Set(free.map(({ t: u }) => '“' + u.name + '”'))].join(', ');
    const msg = free.length > 1 ? `The TB-303s on ${names} run on their own clocks — sync them to the song so they play locked? · Sync`
      : `The TB-303 on ${names} runs on its own clock — sync it to the song so the two play locked? · Sync`;
    noticeActs.set(msg, () => {
      noticeActs.delete(msg); notice('', 0);
      const u = project.tracks.find(y => y.id === tid);
      if (u && isDrumDev(u, dev)) DRUM.api(instView(u, dev)).link(); // (the 606's own press: its swing → the 303s')
    });
    notice(msg, 12000);
  });
}
// MAP… learn (§4.1): the next note played into the machine's track (keys, pads, MIDI) → fn(n), once
function drumLearn(x, fn) {
  const t = drumTrack(x);
  if (!t || typeof fn !== 'function') return () => {};
  const id = t.id, key = 'learn/' + dvOf(x), M = inputSubs.get(id) || inputSubs.set(id, new Map()).get(id);
  const off = () => { const L = inputSubs.get(id); if (L && L.get(key) === f) { L.delete(key); if (!L.size) inputSubs.delete(id); } };
  const f = (on, n) => { if (!on) return; off(); fn(n); };
  M.set(key, f);
  return off;
}
// SOUNDS… Load… (§5): the file picker (or `files`: the tests) → the sample importer (assets.js: WAV / AIFF, FLAC / OGG /
// MP3 / M4A decoded; the store's content-hash ids) → { id, name } | null — ≤ 10 s, within the machine's own memory (32 MiB
// on touch devices, 64 MiB elsewhere: the importer's estimate at 2 playback levels, ≈ ¾ of 8 bytes a frame and channel)
const DR_SLOT_S = 10, drMemCap = () => (touchDev ? 32 : 64) * 1048576;
const drEst = r => 6 * (r.ch || 1) * Math.round((r.len || 0) * Math.min(1, 48000 / (r.rate || 48000)));
function drumFiles() {
  return new Promise(res => {
    const inp = h('input');
    inp.type = 'file'; inp.accept = 'audio/*,.wav,.wave,.aif,.aiff,.aifc,.flac,.ogg,.mp3,.m4a';
    inp.style.display = 'none'; // (in the document: a detached input never fires change / cancel in the app's WKWebView — IMPL-A fixer N)
    const done = r => { inp.remove(); res(r); };
    inp.onchange = () => done([...(inp.files || [])]);
    inp.addEventListener('cancel', () => done(null));
    document.body.appendChild(inp);
    inp.click();
  });
}
async function drumLoad(x, sound, files = null) {
  const fs = files || await drumFiles();
  if (!fs || !fs.length) return null;
  const id = await smpHost.import(fs.slice(0, 1), { kind: 'smp' });
  const rec = id ? await smpHost.record(id) : null;
  if (!rec) return null;
  const sec = rec.len / rec.rate, name = String(rec.name || 'Sample').slice(0, 64);
  if (!(sec <= DR_SLOT_S + 0.05)) { notice(`“${name}” is ${sec.toFixed(1)} s long — a drum slot takes up to ${DR_SLOT_S} s`, 6000); return null; }
  const t = drumTrack(x), D = t ? drumOf(t, dvOf(x)) : null;
  let bytes = drEst(rec);
  for (const s of D ? drumSnds(t, dvOf(x)) : []) { // ((7c) the machine's own slots: the 909's ride and crash counted)
    const e = D && D.smp ? D.smp[s] : null;
    if (!e || !e.on || s === sound || e.id === id) continue;
    const r = await smpHost.record(e.id);
    if (r) bytes += drEst(r);
  }
  if (bytes > drMemCap()) { notice(`Not enough memory for “${name}” in this drum machine (${Math.round(bytes / 1048576)} of ${drMemCap() / 1048576} MB)`, 6000); return null; }
  return { id, name };
}
// the drum monitor (§3.5: the pads' lights, the circuits' levels) while a panel's pads are mounted (cv-drum api.lit)
const drMons = new Map(); // 'trackId/dev' → off
function drumMonitor(x, on) {
  const t = drumTrack(x), dev = dvOf(x);
  if (!t || dev == null) return;
  const id = t.id, key = id + '/' + dev, off = drMons.get(key);
  if (!on) { if (off) { drMons.delete(key); off(); } return; }
  if (off) return;
  drMons.set(key, monitors.sub(id, dev, { role: 'inst', live: () => (project.selTrack === id && cvLive(dev)) || PADS.wants(id), // ((8, §6.2) or a shown Pads module lights from this machine)
    deliver: d => { const iv = d && d.dr ? viewOfKey(key) : null; if (iv && iv.track) DRUM.mon(iv, d.dr); } }));
}
let drErr = false;
function drumsErr(t) { // (engine: dr-808.js or dr-seq.js missing in the worklet — once a session)
  if (drErr) return;
  drErr = true;
  console.warn('SYNTH: the drum machine scripts did not load in the audio engine — “' + t.name + '” plays nothing');
  notice('The drum machine’s sound engine did not load — reload the page to hear it', 8000);
}

/* ------------------------------------------------------ track headers */
function renderHeads() {
  link303Chk(); // ((7b) the project's TB-303s may have changed — a track added, deleted, replaced, an undo, a load: SYNC 303s)
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
        if (key === 'arm' && !t.arm && T.rec) for (const [k, r] of recLive) if (r.tr === t) { commitNote(r, recTick(), k); recLive.delete(k); } // ((R review R-1) its key still down)
        arr && arr.render(); persist();
      };
      return b;
    };
    const meter = h('div', 'hmeter'); meter.append(h('i'));
    top.append(name, tb('M', 'mute', 'Mute', 'm'), tb('S', 'solo', 'Solo', 's'), tb('●', 'arm', 'Arm for recording', 'r'), meter);
    const bot = h('div', 'hrow');
    // the instrument chip (its drawing, model · voice mode, R6: as its patch plays); the preset select lives on the
    // instrument module's bar now (cv-module), the other models in the chip's menu (instItems)
    voiceShown.set(vkey(t), trackVoice(instOf(t)).label);
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
function addTrack(m = curModel(), vals0 = null, o = null) {
  hist.record(project);
  const t = S.newTrack(project, { id: scFreshId(), model: m.id, vals: vals0 ? JSON.parse(JSON.stringify(vals0)) : loadVals(m), name: `${m.name} ${project.tracks.length + 1}` }); // ((SC §1.3) id: past every sidechain source named)
  seedPend.add(t.id);
  if (o && o.ui === 'flow' && isClassicModel(m)) t.lay = { [cvModule.ID.inst]: { x: 0, y: 0, ui: 'flow' } }; // (the Sources tray's Simple)
  project.tracks.push(t);
  adopt(project);
  if (m.family === 'drums') drumOf(t, CMOD.primId(t)); // ((7a) its record: an empty memory, the defaults; 7b: its machine's)
  if (m.family === 'patch') patchNew(t, CMOD.primId(t), o && o.pm, o && o.set); // ((9, §1.4) the Model 15 set as Classic bass, or (a module tile) the controller and that module; (9b) a set tile's set
  if (isRigModel(m) && o && o.module) rigFirst(t, CMOD.primId(t), o.module); // ((WC, integration fixer L — review WC-int B4) a module tile's new track: the blank and that module, as its Replace (setTrackModel o.module)
  newRack(t, m);
  syncNodes();
  selectTrack(t.id);
  renderHeads(); persist(); updateUndoUI();
  if (m.id === 'tr606') offer303(instView(t, CMOD.primId(t))); // ((7b §3.8) the Drums view's + Track / a drop on the track list)
  return t;
}
function duplicateTrack(t) {
  hist.record(project);
  const d0 = instOf(t), c = S.newTrack(project, { id: scFreshId(), model: d0.model, vals: JSON.parse(JSON.stringify(d0.vals)), name: t.name + ' copy', preset: d0.preset }); // ((SC §1.3) a fresh id)
  c.notes = S.cloneNotes(t.notes); c.cc = t.cc.map(x => ({ t: x.t, k: x.k, v: x.v }));
  c.vol = t.vol; c.pan = t.pan; c.ch = t.ch;
  seedPend.add(c.id);
  // (stage 1e: every instrument, panel and cable with their fields — any shape; adopt reads the devices)
  for (const k of ['model', 'vals', 'preset', 'seq', 'fx']) delete c[k];
  Object.assign(c, { prim: t.prim, nid: t.nid, dev: clone(t.dev), wires: clone(t.wires) });
  if (t.mods) c.mods = clone(t.mods);
  if (t.mid !== undefined) c.mid = t.mid; // (2a: row ids never reused)
  if (t.lay) c.lay = clone(t.lay); // (the canvas layout, view only)
  project.tracks.splice(project.tracks.indexOf(t) + 1, 0, c);
  adopt(project); // (the copy's devices keep their ids: they are per track)
  syncNodes(); sendSong(c, true);
  renderHeads(); persist(); updateUndoUI();
}
function deleteTrack(t) {
  if (project.tracks.length < 2) { alert('A project needs at least one track.'); return; }
  if (t.notes.length && !confirm(`Delete “${t.name}” and its ${t.notes.length} notes?`)) return;
  hist.record(project);
  const i = project.tracks.indexOf(t);
  if (project.selTrack === t.id) { PATCH.cancel(); PERF.release(); } // ((9) its cord drag) // (1i review F3: its beds' keys end while it is still the selected track)
  for (const k of drumDevs(t)) drumForget(t, k); // ((7a) its drum machines' sessions)
  for (const k of patchDevs(t)) PATCH.lamps(t, k, null); // ((9b) its 900 Series' lamps' queue
  PADS.endTrack(t.id); // ((8, D9) every pad's notes on it end — the targets stay (an undo brings the track back)
  project.tracks.splice(i, 1);
  seqRun.delete(t.id); inputSubs.delete(t.id); lastIn.delete(t.id); recCutDrop(t.id);
  if (project.selTrack === t.id) { project.selTrack = project.tracks[Math.max(0, i - 1)].id; bind(); renderNav(); renderViews(); roll && roll.setTrack(); rollDrumUI(); ptShow(); }
  syncNodes();
  padsRefresh(); // ((8) its pads warn, their lights and "+N" follow)
  renderHeads(); persist(); updateUndoUI();
}

/* ------------------------------------------------- arrangement + roll */
let arr = null, roll = null, range = null, lastArea = 'roll', notesClip = null, rangeClip = null;
let cvArea = false; // (the canvas Delete key) the canvas pressed after the arrangement: its selection, not the bars' range, is Delete's
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
    // (7a, IMPL-7a §4.2) a drum track's named rows (its machine's mapped primaries, kick at the bottom) and the saved
    // "Drum rows" choice (compact rows: on by default)
    drumRows: t => drumRowsOf(instOf(t)), drumRowsOn: store.get(ROLL_DRUM, true) !== false,
    heldNotes: () => heldOn(project.selTrack), // ((R) its key strip's held notes on a track switch)
  });
  $('#arrwrap').addEventListener('pointerdown', () => { lastArea = 'arr'; cvArea = false; }, true);
  $('#rollwrap').addEventListener('pointerdown', () => { lastArea = 'roll'; }, true);
  const vp = $('#viewport');
  if (vp) vp.addEventListener('pointerdown', () => { cvArea = true; }, { capture: true, passive: true }); // (the canvas Delete key: pressed last, the canvas's)
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
  if (name === 'roll') { if (shell.src) shell.src.close(); roll.resize(); roll.render(); } // (the side tray is the canvas's)
  if (world) world.setActive(name === 'canvas');
  // a default camera owed since a track switch under ROLL: now, on the real band (setActive measured it)
  if (name === 'canvas' && cvCamDef && cvView && cvCamDef === CM.camKey(project.uid, cvView.trackId)) cvCamRestore(trk());
  PADS.resync(); // ((8, R1-C) a Pads module hidden with the canvas wants no lights: the drum monitors it held on go off with ROLL, back with CANVAS)
  monitors.sync();
  if (name === 'canvas') sxReshow();
  store.set('synth.tab', name);
}
// the instrument panels, the FX racks (always mounted on the canvas; today's FX tab only while shown) and the canvas
// modules follow the selected track (stage 1e: every device body of it)
function renderViews() {
  if (cvMaster && cvOn()) { cvRender(); return; } // ((M, §5.2) the master canvas: its view alone — the track's panels are built when it is left
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
  // ((7a §4.2) on a drum track a transpose changes which drums play: asked first)
  const xp = k => () => { if (roll.isDrum() && !confirm('Transposing a drum track changes which drums play. Transpose anyway?')) return; transform('Transpose', ns => S.transpose(ns, k)); };
  grp('Transpose', btn('−12', 'Down an octave', xp(-12)), btn('−1', 'Down a semitone', xp(-1)), btn('+1', 'Up a semitone', xp(1)), btn('+12', 'Up an octave', xp(12)));
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
  // ((7a §4.2) a drum track's compact named rows, or the full keyboard: kept on this device; shown on a drum track only)
  rollDrumChk = chk('Drum rows', store.get(ROLL_DRUM, true) !== false, 'Show only the drum machine’s named rows (off: the whole keyboard)', v => { store.set(ROLL_DRUM, !!v); roll.setDrumRows(v); });
  rollDrumChk.id = 'rollDrums';
  // Keys −/+: the row height (the keys' size; also pinch up / down, Alt-wheel), kept for this device
  const keyZ = (txt, label, d) => { const b = btn(txt, label + ' (row height, kept on this device)', () => roll.zoomRows(d)); b.setAttribute('aria-label', label); return b; };
  grp('View', btn('−', 'Zoom out', () => roll.zoomX(1 / 1.4)), btn('+', 'Zoom in', () => roll.zoomX(1.4)), btn('Fit', 'Fit notes', () => roll.fit()),
    h('span', 'rlab', 'Keys'), keyZ('−', 'Smaller keys', -1), keyZ('+', 'Bigger keys', 1), follow, ghosts, rollDrumChk);
  const sel = h('span', 'rsel'); sel.id = 'rSel'; sel.textContent = 'No selection (edits apply to all notes)';
  bar.append(sel);
  roll.setFollow(project.follow !== false); roll.setGhosts(!!project.ghosts); roll.setDrawLength(project.drawLen || 0);
  setTool(tool);
  rollDrumUI();
}
// (7a) the "Drum rows" toggle shows on a drum track only (the roll's isDrum: the track has named rows)
const ROLL_DRUM = 'synth.roll.drumRows';
let rollDrumChk = null;
function rollDrumUI() { if (rollDrumChk && roll) rollDrumChk.hidden = !roll.isDrum(); }
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
  DRUM.loop(); // ((7a review 2 #4) the loop may have changed: the drum panels' hint)
  $('#tMetro').setAttribute('aria-pressed', project.metronome.on ? 'true' : 'false');
  $('#tInQ').setAttribute('aria-pressed', project.rec.inputQuantize ? 'true' : 'false');
  document.body.classList.toggle('recording', T.rec);
}
function posUI(t = curTick()) {
  if (!T.playing) { roll && roll.setPlayhead(t, false, false); arr && arr.setPlayhead(t); }
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
  if (newTrack) { roll && roll.setTrack(); arr && arr.fit(); } else { roll && (roll.refreshRows(), roll.render()); arr && arr.render(); } // ((7a) refreshRows: a drum map restored)
  rollDrumUI();
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
  numIn('tBpm', el => setProjectBpm(+el.value || 120)); // ((7a) the same path as a synced drum machine's TEMPO)
  initTap($('#tTap')); initTap($('#tTapM')); // (TAP joined to it, ⋯'s ≤ 900 px: tap tempo)
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
    const p = freshProject(curModel());
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
    if (f) await openFile(f);
  };
  $('#fBounce').onclick = () => openBounce();
  $('#bCancel').onclick = () => { $('#modal').hidden = true; };
  $('#bNorm').onchange = () => normUI(); // ((M, O4) Loudness: its target beside it
  bounceButton();
  pressOrTap($('#modal'), e => e.target.id === 'modal', () => { $('#modal').hidden = true; }); // the backdrop (a finger: on release)
}
// Open / Import… (#fFile) and a file the iPad app was handed from the Files app (SYNTH_SHELL.openFile, IMPL-A §4.3): f a
// File (or a Blob with a name) — a MIDI file imported, else a project (its embedded assets into their stores, the schema
// gate's read-only notice); true when opened
async function openFile(f) {
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
  } catch (err) { alert('Could not open that file: ' + err.message); return false; }
  return true;
}
function slug(s) { return (s || 'untitled').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'untitled'; }
// The files the page hands over (Save, Export MIDI, Bounce WAV, presets, wavetables…). The iPad / iPhone home-screen app
// may not download a blob: link (iPadOS has ignored it there, or shown the file with no way back): there the share sheet
// takes the file (Save to Files, AirDrop…). Sharing needs a fresh tap: a file that is ready later (a bounce, a slow save)
// is offered to tap through `later(go)` (the caller's own control), else on the notice line. The iPad app: the download
// link before any of that — its WKDownload takes the blob to the share sheet without a copy in the page (IMPL-A §4.1,
// the lead's call: the bridge kept +290 MB of WebContent heap after a 100 MB file); the sheet's outcome never reaches the
// page, so a caller's `later` is offered every time (the bounce's Save WAV…: the same file again, no re-render).
function download(blob, name, later) {
  if (SHELL) { saveLink(blob, name); if (typeof later === 'function') later(() => saveLink(blob, name)); return; }
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
/* ---------------------------------------------- the iPad app's seams (IMPL-A §3.2, §4.1, §5) — SHELL only */
// a message to native nothing waits for (engine, bg, ready): never throws here
function shellPost(m) {
  try { quiet(SHELL.post(m)); } catch (err) { console.warn('SYNTH: the app did not take “' + (m && m.t) + '”', err); }
}
// The bridge (§4.1) — SYNTH_SHELL.save only (the smoke's integrity step; download() takes the link): the file announced
// (native opens tmp/<id>/<name>; no room → refused), sent as base64 in 2 MiB slices with their offset (a script message
// carries no ArrayBuffer), one in flight (each awaits its reply), then `end` — native closes it and shows the share sheet
// and answers when the sheet closes, { ok: true, done }. Any refusal: `abort` (native deletes what it has), then the
// download link (the app's WKDownload, §2.4). Resolves with end's reply, or { ok: false, error } after the fallback.
const SHELL_CHUNK = 2 * 1024 * 1024;
let shellN = 0; // (transfer ids: per transfer, unique across reloads)
async function shellSave(blob, name) {
  const id = 'f' + Date.now().toString(36) + '-' + (++shellN);
  const ask = async m => { const r = await SHELL.post(m); if (!r || r.ok !== true) throw new Error((r && r.error) || 'refused'); return r; };
  try {
    await ask({ t: 'file', id, name, type: blob.type, size: blob.size });
    for (let at = 0; at < blob.size; at += SHELL_CHUNK) await ask({ t: 'chunk', id, at, b64: await b64Of(blob.slice(at, at + SHELL_CHUNK)) });
    return await ask({ t: 'end', id });
  } catch (err) {
    const why = (err && err.message) || String(err);
    console.warn('SYNTH: saving ' + name + ' through the app failed (' + why + ') — downloading it instead');
    try { quiet(SHELL.post({ t: 'abort', id })); } catch { /* no bridge at all */ }
    saveLink(blob, name);
    return { ok: false, error: why };
  }
}
// base64 of a Blob (a slice): the builtin where there is one, else 32 KiB runs through fromCharCode (one apply over 2 MiB
// passes JavaScriptCore's argument limit) and btoa; and back (native → page: SHELL.openFile)
async function b64Of(b) {
  const u8 = new Uint8Array(await b.arrayBuffer());
  if (typeof u8.toBase64 === 'function') return u8.toBase64();
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function bytesOf(b64) {
  if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(b64);
  const s = atob(b64), u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}
// ⚙ Sound in background (the user's Q2 answer: a setting, the app only, default on — a device setting): off, the context is
// suspended while the page is hidden (boot's visibilitychange) and an interruption's end waits for the page to come back
const BG_KEY = 'synth.shell.bg';
const bgOn = () => store.get(BG_KEY, true) !== false;
const bgHeld = () => !!SHELL && document.hidden && !bgOn();
// the OUT scope's analyser read once: the largest |sample| of its window (0 with the engine off) — probe's `peak`
function anPeak() {
  if (!an || typeof an.getFloatTimeDomainData !== 'function') return 0;
  const a = new Float32Array(an.fftSize);
  an.getFloatTimeDomainData(a);
  let p = 0;
  for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > p) p = v; }
  return p;
}
// Help & about in the app (§3.2 item 6): the help text's App part (the browser's full screen, Install app) becomes the
// app's — the build it runs (the marker; app-build.json's date, read once), how projects cross from a browser, and the
// engine's rate and latencies while it is on (the device pass reads them here, §5.4). index.html keeps the web's text.
let shellBuild = null, shellBuildP = null;
function shellAppText() {
  const b = shellBuild || {}, sha = String(b.short || SHELL.sha || ''), day = typeof b.date === 'string' ? b.date.slice(0, 10) : '';
  const ms = x => (Number.isFinite(x) ? (x * 1000).toFixed(1) : '—');
  let t = ' this is the SYNTH app' + (SHELL.app ? ' ' + SHELL.app + (SHELL.build ? ' (' + SHELL.build + ')' : '') : '');
  if (sha) t += ', build ' + sha + (day ? ' (' + day + ')' : '');
  t += ' · site v' + VERSION + '. Projects saved in Safari or Chrome are separate: Save the file there and Open / Import… it here (or open it from the Files app).';
  if (ctx) t += ` Audio now: ${kHz(ctx.sampleRate)} kHz, base latency ${ms(ctx.baseLatency)} ms, output latency ${ms(ctx.outputLatency)} ms.`;
  return t;
}
function shellHelp(parts) {
  const b = [...parts.querySelectorAll('b')].find(x => x.textContent === 'App:');
  if (!b) return;
  let n;
  while ((n = b.nextSibling) && !(n.nodeType === 1 && /:$/.test(n.textContent))) n.remove(); // (up to the next label, if any)
  const t = document.createTextNode(shellAppText());
  b.after(t);
  if (!shellBuildP) {
    try { shellBuildP = fetch('app-build.json').then(r => r.json()).then(j => { shellBuild = j && typeof j === 'object' ? j : null; }, () => {}); } catch { shellBuildP = Promise.resolve(); }
  }
  shellBuildP.then(() => { t.textContent = shellAppText(); });
}
if (SHELL) {
  // native → page (the shell queues each until { t: 'ready' }, §4.3): a file opened from the Files app (Share → SYNTH) —
  // the same path as Open / Import…, true when opened; an audio interruption's end — the context resumed without a tap
  // (§5.3; another t ignored)
  SHELL.openFile = (name, b64) => openFile(new File([bytesOf(String(b64 || ''))], String(name || 'file')));
  SHELL.on = m => { if (m && m.t === 'resume' && !bgHeld()) wake(); };
  // the smoke's and the device pass's window into the engine (§9.2); the bridge by itself (the smoke's 100 MB integrity
  // check — no caller in the page)
  SHELL.probe = () => ({ ctx: ctx ? ctx.state : null, sr: ctx ? ctx.sampleRate : null,
    baseLatency: ctx && Number.isFinite(ctx.baseLatency) ? ctx.baseLatency : null, outputLatency: ctx && Number.isFinite(ctx.outputLatency) ? ctx.outputLatency : null,
    nodes: nodes.size, master: !!mnode, peak: anPeak(), held: held.size, cpu: $('#cpu').textContent, store: store.mode, bootMs: shellBootMs,
    midi: { ...midiSeen } });
  SHELL.save = (blob, name) => shellSave(blob, name);
}
function importMidiFile(bytes, fname) {
  const r = S.importMIDI(bytes);
  if (!r.tracks.length) { alert('That MIDI file has no notes.'); return; }
  hist.record(project);
  const empty = project.tracks.every(t => !t.notes.length && !t.cc.length), m0 = curModel(); // (the model before an empty project's tracks go: read after, there is no track)
  if (empty) { project.tracks = []; project.bpm = r.bpm; project.sig = r.sig; if (r.name) project.name = r.name; else project.name = fname.replace(/\.midi?$/i, ''); }
  let lost = 0;
  for (const it of r.tracks) {
    // ((7a §4.5) a channel-10 track comes in as a TR-808 track: it.model, its notes as they are; it.unmapped counts the
    // notes on keys the machine's map leaves silent)
    const m = typeof it.model === 'string' && S.isDrum(it.model) ? modelById(it.model) : m0;
    const t = S.newTrack(project, { id: scFreshId(), model: m.id, vals: loadVals(m), name: it.name || `${m.name} ${project.tracks.length + 1}` }); // ((SC §1.3) a fresh id)
    seedPend.add(t.id);
    t.notes = it.notes.map(n => ({ id: S.newId(), t: n.t, d: n.d, n: n.n, v: n.v }));
    t.cc = it.cc.slice(); t.ch = 0;
    project.tracks.push(t);
    adopt(project);
    newRack(t, m);
    if (m.family === 'drums') { drumOf(t, CMOD.primId(t)); lost += it.unmapped | 0; }
  }
  project.selTrack = project.tracks[0].id;
  fitBars();
  const bt = S.barTicks(project);
  project.loop.start = 0; project.loop.end = Math.max(bt, Math.min(project.bars, 8) * bt);
  applyRestore(project);
  if (lost) notice(`${lost} drum note${lost === 1 ? '' : 's'} on keys the TR-808 doesn’t map — kept in the roll, silent (MAP… on the 808 can give them a sound)`, 8000);
}

/* ------------------------------------------------------------ bounce */
// the dialog's main button: Render & download (Save WAV… while a rendered file waits for a tap to be shared)
function bounceButton() { const go = $('#bGo'); go.textContent = 'Render & download'; go.onclick = () => bounce(); }
// (IMPL-M §4, Q1 (a)) the rate and oversampling playback runs at — the dialog's "Same as playback" (its default)
const playRate = () => (ctx ? ctx.sampleRate : settings.sr || devRate || 48000);
const BOUNCE_NOTE = 'Renders every audible track (mute/solo respected) offline — no clicks or dropouts regardless of CPU.';
const AUTO_TAIL = 30; // ((M, O2) Auto: up to this many seconds past the song's end)
// the Normalise select (O4): 'off' | 'peak' | 'lufs' — (a select has no `checked`: a script that ticks it, as the old checkbox's
// drivers do — the frozen G0 bounce test's —, means Peak, the old box's meaning)
function normMode() { const e = $('#bNorm'); return e.checked === true ? 'peak' : e.value === 'peak' || e.value === 'lufs' ? e.value : 'off'; }
function openBounce() {
  bounceButton();
  $('#bRange').value = range ? 'sel' : project.loop.on ? 'loop' : 'song';
  $('#bRange').querySelector('[value=sel]').disabled = !range;
  { const sr = playRate(), a = $('#bSr').querySelector('[value="0"]'), b = $('#bOs').querySelector('[value="0"]');
    if (a) a.textContent = `Same as playback (${kHz(sr)} kHz)`;
    if (b) b.textContent = `Same as playback (${Math.min(settings.os, osCap(sr))}×)`; }
  { const t = mTarget(), g = $('#bTgt'); if (g) g.value = String(t === null ? -14 : t); }
  normUI();
  const n = masterN();
  $('#bNote').textContent = BOUNCE_NOTE + ' ' + (n ? `Through the master effects (${n})` : 'The master has no effects') + ' — Volume, Mono and A/B are listening controls and not in the file.';
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
// ((9, IMPL-9 §6, review #7) a powered 900 Series whose MAIN OUT is patched sounds with no notes — a Drone, an LFO: bounced too)
const syncedOf = tr => (tr.dev ? CG.powered(tr) : []).some(id => (tr.dev[id].model === 'tb303' && tr.dev[id].seq && tr.dev[id].seq.sync) || (isDrumDev(tr, id) && drumAudible(tr, id)) || (isPatchDev(tr, id) && PT.live(patchOf(tr, id), null, tr.dev[id].vals))); // ((7a) a synced drum machine with a step; (9b) a patch's routing rows count)
// ((SC §7.2) then the keying closure: every source of a rendered track's — and the master's — Duckers and keyed compressors renders
// too (scWant: the project's edges, never the nodes' — a bounce needs no power), a muted / soloed-out one at gain 0 (the ghost kick),
// transitively; a source so added brings the tracks whose MIDI OUT plays it and that have notes (its live input: at gain 0 unless
// heard), and one with no notes of its own, not synced, comes only with them. Each item carries sc: [[source id, kg gain]] of its
// edges whose source renders, built as live by renderOffline)
function bounceSet(sr) {
  const P = new Map(), partsOf = tr => { if (!P.has(tr)) P.set(tr, offParts(tr, sr)); return P.get(tr); };
  const want = new Map(), syn = new Map(), can = tr => !!(tr.notes.length || syn.get(tr));
  for (const tr of project.tracks) {
    const d = instOf(tr), synced = (d.model === 'tb303' && d.seq && d.seq.sync) || syncedOf(tr);
    syn.set(tr, !!synced);
    if (audible(tr) && (tr.notes.length || synced)) want.set(tr, tr.vol);
  }
  const outs = new Map(); // (a track with notes → the ids its MIDI OUT plays)
  for (const tr of project.tracks) {
    if (!hasSx(tr) || !tr.notes.length) continue;
    const x = partsOf(tr), ids = (x.patch ? [x.patch] : Object.values(x.patches)).flatMap(midiOutIds);
    outs.set(tr, ids);
    for (const id of ids) {
      const tg = project.tracks.find(x => x.id === id);
      if (!tg || tg === tr || !audible(tg)) continue;
      if (!want.has(tg)) want.set(tg, tg.vol);
      if (!want.has(tr)) want.set(tr, 0);
    }
  }
  const G = scGraph(), byId = new Map(project.tracks.map(t => [t.id, t])), todo = [...want.keys()];
  const put = x => { if (want.has(x)) return; want.set(x, audible(x) ? x.vol : 0); todo.push(x); };
  const src = x => {
    if (!x || want.has(x)) return;
    const drv = project.tracks.filter(d => d !== x && (outs.get(d) || []).includes(x.id));
    if (!can(x) && !drv.length) return;
    put(x);
    for (const d of drv) put(d);
  };
  for (const [s] of scMasterUnits()) src(byId.get(s));
  while (todo.length) { const m = G.E.get(todo.pop().id); if (m) for (const s of m.keys()) src(byId.get(s)); }
  return project.tracks.filter(tr => want.has(tr)).map(tr => {
    const m = G.E.get(tr.id), sc = m ? [...m].filter(([id]) => want.has(byId.get(id))) : [];
    return Object.assign({ tr, gain: want.get(tr) }, sc.length ? { sc } : null, partsOf(tr));
  });
}
// (F3) the main thread's copy of the meters (master-dsp.js: wk.loadDSP injects it once, as the panels' DSP; null when it is not there)
async function meterDSP() {
  if (!globalThis.MASTERDSP) {
    let tm = 0;
    try { const wk = await import('./wk.js?v=' + VERSION); await Promise.race([wk.loadDSP(['master-dsp.js?v=' + VERSION]), new Promise(r => { tm = setTimeout(r, 3000); })]); }
    catch (err) { console.warn('the master meters did not load', err); }
    clearTimeout(tm);
  }
  return globalThis.MASTERDSP || null;
}
// the integrated loudness (BS.1770, K-weighted and gated) of a stereo buffer, in 4 s slices with a breath between: a long render does not freeze the page
async function integratedOf(MD, chs, sr) {
  const m = new MD.Meters(sr), n = chs[0].length, step = Math.round(sr * 4);
  for (let o = 0; o < n; o += step) { m.push(chs[0], chs[1], Math.min(step, n - o), o); if (o + step < n) await new Promise(r => setTimeout(r)); }
  return m.summary().i;
}
// the target select shows only for Loudness
function normUI() { const g = $('#bTgt'); if (g) g.hidden = normMode() !== 'lufs'; }
async function bounce() {
  // (IMPL-M Q1 (a): "Same as playback" = 0, the live rate / ⚙ Oversampling; O2: Auto tail; O4: Normalise Off / Peak / Loudness)
  const rsel = $('#bRange').value, sr = +$('#bSr').value || playRate(), bits = +$('#bBits').value, tv = $('#bTail').value, auto = tv === 'auto', tail = auto ? AUTO_TAIL : +tv, nm = normMode(), norm = nm === 'peak';
  const os = Math.min(+$('#bOs').value || settings.os, osCap(sr)); // same 384 kHz internal cap as live playback
  const [start, end] = rsel === 'sel' && range ? range : rsel === 'loop' ? [project.loop.start, project.loop.end] : [0, S.songEnd(project)];
  if (!(end > start)) { alert('Nothing to render.'); return; }
  const note = $('#bNote'), go = $('#bGo');
  go.disabled = true;
  const songS = S.ticksToSec(project, end) - S.ticksToSec(project, start), secs = songS + tail;
  const t0 = performance.now();
  note.textContent = `Rendering ${auto ? songS.toFixed(1) + ' s + up to ' + AUTO_TAIL + ' s of tail' : secs.toFixed(1) + ' s'} at ${kHz(sr)} kHz × ${os} (${kHz(sr * os)} kHz internal)…`;
  try {
    const f = sr * 60 / (project.bpm * S.PPQ);
    const items = [];
    for (const x of bounceSet(sr)) {
      const { tr, patch, gain } = x, d = instOf(tr), synced = d.model === 'tb303' && d.seq && d.seq.sync, pd = CMOD.primId(tr), dr = patch && isDrumDev(tr, pd); // ((7a) a drum machine: its payload — synced or not: the notes play through its map, mutes and slots, as live —, its slots)
      // a Serum track renders at its own quality (Ultra with "Use Ultra quality when rendering") regardless of the
      // dialog (§11.4, SPEC-serum2 §12.6); every node carries its track id: MIDI OUT between the bounced tracks (§7.9)
      items.push(Object.assign({ tr, patch, os: isSxRec(d) ? sxOSFor(d, sr, true) : os, hostOS: os, song: songData(tr, start, end),
        transport: { play: true, frame: 0, tick: start, fpt: f, loop: false, end }, seq: patch && synced ? seqPayload(tr, { run: false }) : dr ? drumPayload(tr, pd, true) : null, gain, pan: tr.pan, mods: x.graph ? modsFor(tr) : null },
      x.graph ? { graph: x.graph, patches: x.patches, chains: x.chains, seqs: x.seqs, needs: x.needs } : patch && isDrumDev(tr, pd) ? { needs: drumNeeds(tr) } : null,
      x.sc ? { sc: x.sc } : null)); // ((SC §7.2) its key edges: renderOffline builds them as live)
    }
    if (!items.length) { note.textContent = 'No audible tracks with notes in that range.'; go.disabled = false; return; }
    // (IMPL-M §4) always through the master — empty or not, one path (an empty one copies: the same bytes as before)
    const frames = Math.ceil(secs * sr), mc = hasMasterFx() ? masterChain(sr) : null, lmax = mc ? latBound(project.master.fx, sr) : 0;
    const buf = await renderOffline(sr, frames, items, undefined, { master: { fxr: mc && mc.fxr, fxrT: mc && mc.fxrT, transport: { play: true, frame: 0, tick: start, fpt: f, loop: false, end }, frames, lmax, needs: (mc && mc.fxr.needs) || [] } });
    const rep = buf.master || {};
    if (rep.lat === null || rep.lat === undefined) throw new Error('the master did not report its latency — nothing was written');
    const len = Math.max(128, frames), all = [buf.getChannelData(0), buf.getChannelData(1)];
    let chs = lmax > 0 ? all.map(c => c.subarray(rep.lat, rep.lat + len)) : all; // (the path latency dropped: the song starts on frame 0)
    let kept = '';
    if (auto) { // (O2) the tail ends 0.5 s after the last frame at or above −96 dBFS (found from the render's end, R1-5), at most AUTO_TAIL s past the song
      const s0 = Math.ceil(songS * sr), e = tailLast(chs, s0, Math.pow(10, -96 / 20), Math.round(0.5 * sr), Math.round(AUTO_TAIL * sr));
      chs = chs.map(c => c.subarray(0, e));
      kept = ` (tail ${(Math.max(0, e - s0) / sr).toFixed(1)} s, auto)`;
    }
    let peak = 0;
    for (const c of chs) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > peak) peak = a; }
    const fin = rep.fin, I0 = fin && Number.isFinite(fin.i) ? fin.i : null, TP0 = fin && Number.isFinite(fin.tpMax) ? fin.tpMax : null;
    const dB = x => MUI.fmtDb(x); // (a true minus, never "−0.0", "—" for silence)
    const lufs = nm === 'lufs' && I0 !== null && TP0 !== null, tg = lufs ? +$('#bTgt').value || -14 : null;
    let k = 1, lnote = '', bound = false;
    const scaleBy = f => { for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= f; k *= f; };
    if (lufs) { // (O4) a pure scale to the target, never past −1 dBTP: never a limiter, never a clip
      const kL = Math.pow(10, (tg - I0) / 20), kT = Math.pow(10, (-1 - TP0) / 20);
      bound = kT < kL; scaleBy(Math.min(kL, kT));
    } else {
      if (nm === 'lufs') lnote = ' · not loudness-normalised (no loudness measured)';
      const target = norm ? Math.pow(10, -0.3 / 20) : peak > 0.999 ? 0.999 : peak;
      if (peak > 0 && (norm || peak > 0.999)) scaleBy(target / peak);
    }
    // (F3) a pure scale moves the true peak exactly but not the integrated loudness: the tail's blocks cross BS.1770's −70 LUFS gate
    // and the relative gate moves with them. The scaled buffer is measured (the main thread's meters) and Loudness corrects it once or
    // twice more; the note reports the measurement (without the meters: the exact-scale estimate, as before)
    let Im = I0 === null ? null : I0 + 20 * Math.log10(k);
    if (k !== 1 && I0 !== null && I0 > -Infinity) {
      const MD = lufs ? await meterDSP() : globalThis.MASTERDSP || null; // (injected for Loudness; Off / Peak use it when the page has it)
      if (MD) {
        const measure = async () => { const v = await integratedOf(MD, chs, sr); if (Number.isFinite(v)) Im = v; }; // (all under the gate: the estimate stays)
        await measure();
        for (let pass = 0; lufs && pass < 2 && Math.abs(Im - tg) > 0.01; pass++) {
          const want = Math.pow(10, (tg - Im) / 20), room = Math.pow(10, (-1 - TP0) / 20) / k; // (room: up to −1 dBTP in all)
          const f = Math.min(want, room);
          if (want > room) bound = true;
          if (Math.abs(f - 1) < 1e-4) break;
          scaleBy(f); await measure();
        }
      }
    }
    if (lufs) lnote = bound ? ` · stopped at ${dB(Im)} LUFS (true-peak ceiling −1 dBTP)` : ` · normalised to ${dB(Im)} LUFS${Math.abs(Im - tg) > 0.05 ? ` (target ${dB(tg)})` : ''}`;
    const wav = S.encodeWAV(chs, sr, bits);
    const kd = 20 * Math.log10(k); // (the true peak scales exactly: × k adds 20·log10 k)
    const audible = I0 !== null && I0 > -Infinity, lra = fin && Number.isFinite(fin.lra) && !(fin.lra === 0 && !audible) && frames >= 3 * sr ? fin.lra : null; // (nothing measured — MASTER's -Infinity, or a render under the 3 s the range needs: "LRA —", never "0.0 LU")
    const loud = audible ? ` · ${dB(Im)} LUFS integrated${TP0 !== null && TP0 > -Infinity ? ' · ' + dB(TP0 + kd) + ' dBTP' : ''} · LRA ${lra === null ? '—' : dB(lra) + ' LU'}` : '';
    // (the numbers are the file's, after scaling: the peak too)
    const done = `Done: ${(auto ? chs[0].length / sr : secs).toFixed(1)} s rendered in ${((performance.now() - t0) / 1000).toFixed(1)} s${kept} · peak ${dB(20 * Math.log10(Math.max(1e-9, peak * k)))} dBFS${peak > 0.999 && !norm && !lufs ? ' (scaled to avoid clipping)' : ''}${loud}${lnote}.`;
    note.textContent = done;
    // (the home-screen app on iPad / iPhone shares the file, which needs a fresh tap after a render: Save WAV… here; the
    // iPad app's sheet comes up by itself and Save WAV… offers it again — IMPL-A §4.1)
    download(new Blob([wav], { type: 'audio/wav' }), `${slug(project.name)}-${sr / 1000}k-${bits}${bits === 32 ? 'f' : 'bit'}.wav`, share => {
      note.textContent = done + (SHELL ? ' Closed the sheet without saving? Tap Save WAV… to share it again.' : ' Tap Save WAV… to keep the file.');
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
  const lit = heldLit(); // ((8, review #7) a pad's note held on another track: unlit)
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
// folded away (setKbHidden), a pull's drawer (kbPullBegin), the glide's timer; reduced motion: no glide
let kbGone = false, kbGlideT = 0;
const kbPull = { on: false, full: 0 };
const kbStill = () => { try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; } };
const kbDefH = () => (window.innerWidth <= 900 ? 128 : 170); // = style.css .keys
// the panel's height besides the keys (toolbar, padding; a notice floats over the canvas, out of flow: style.css .notice) —
// folded away the tray is still laid out (below the screen edge, hidden), so it measures the same
function kbChrome() {
  const d = $('#perf').offsetHeight - $('#keys').offsetHeight;
  return d > 0 ? d : 64;
}
// The canvas shell's one height budget (cv-tray budget, replacing the 60 % rule): the canvas between the trays keeps
// ≥ 240 px. kbMaxH: the most the keys may take when the keyboard tray leads (the top tray pushed to its one row).
const kbMaxH = (chrome = kbChrome()) => clamp(Math.floor(cvTray.budget({ vh: trayVh(), top: cvTray.TOP_ROW, bottom: chrome + KB_H[1],
  active: 'bottom', topMin: cvTray.TOP_ROW, bottomMin: chrome + KB_H[0] }).bottom - chrome), KB_H[0], KB_H[1]);
// The keys and the top tray as the budget allows: the chosen key height (kbSize.h within 70 px … kbMaxH; 0 = the screen's
// default) and the top tray's wanted height, the tray dragged last (shell.lead) winning and the other pushed toward its
// fold — never below one row / 70 px keys (a window too small for the rule: the canvas gets what is left)
function applyKbHeight(chrome = kbChrome()) {
  const max = kbMaxH(chrome), g = $('#kbGrip'), p = $('#perf'), keys = !kbGone || kbPull.on; // (folded away it takes no room; a pull out lays it out open)
  const want = kbSize.h ? clamp(kbSize.h, KB_H[0], max) : kbDefH();
  const B = cvTray.budget({ vh: trayVh(), top: topWant(), bottom: keys ? chrome + want : 0, active: shell.lead,
    topMin: cvTray.TOP_ROW, bottomMin: keys ? chrome + KB_H[0] : 0 });
  kbH = keys ? clamp(Math.floor(B.bottom - chrome), KB_H[0], Math.max(KB_H[0], want)) : want;
  p.style.setProperty('--kbh', kbH + 'px');
  p.classList.toggle('short', kbH < 100); // the wheels drop their labels
  if (shell.kb) shell.kb.sync(); // (its ARIA: a slider, or folded away a button — cv-tray trayGrip)
  else { g.setAttribute('aria-valuenow', String(kbH)); g.setAttribute('aria-valuemax', String(Math.max(max, kbH))); g.setAttribute('aria-valuetext', `${kbH} pixels${kbSize.h ? '' : ' (default)'}`); }
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
// (2026-10-22, the user: "the keyboard at the bottom should collapse down to just the tab") folded away (kbGone,
// synth.kbHidden): the whole tray — keys and controls — goes below the screen edge, its tab left (the canvas gets the
// height; the computer keys, MIDI and Hold play on — Panic: Esc, or the tab then Panic). The tab (a tap, Enter / Space, a
// pull: trayGrip o.fold below) and #kbHide fold it / bring it back. A change glides (.glide, cv-tray SNAP_MS; none with
// reduced motion nor at boot); a pull's release glides on from where the finger left it (kbPull: its travel while pulled)
function setKbHidden(on, save = true, glide = true) {
  const p = $('#perf'), b = $('#kbHide'), g = $('#kbGrip'), was = kbGone, pulled = p.classList.contains('pull');
  if (on) releasePtrs(); // fingers on the keys as they go: their notes end now
  kbGone = on; kbPull.on = false;
  clearTimeout(kbGlideT); kbGlideT = 0;
  const gl = glide && (on !== was || pulled) && !kbStill();
  p.classList.remove('pull');
  p.classList.toggle('glide', gl);
  p.classList.toggle('gone', on);
  p.style.transform = ''; // (a pull's: the glide goes on from it)
  if (gl) kbGlideT = setTimeout(() => { kbGlideT = 0; p.classList.remove('glide'); }, cvTray.SNAP_MS + 40); // (open: back in the grid then)
  b.setAttribute('aria-expanded', on ? 'false' : 'true');
  if (save) store.set('synth.kbHidden', on);
  applyKbHeight(); // (the top tray may take the room the keyboard leaves)
  if (!on) buildKeys(); // laid out for the width they now have
  const a = document.activeElement;
  if (on && a && a !== g && p.contains(a) && g.focus) g.focus(); // (focus on a control that hides: onto the tab)
}
// the tab's drawer (trayGrip o.fold): its travel — the tray laid out as it opens (from folded: the budget's height, the
// top tray maybe pushed once) —, out of the grid under the finger (.pull: a translateY per move, no layout)
function kbPullBegin() {
  const p = $('#perf');
  clearTimeout(kbGlideT); kbGlideT = 0; p.classList.remove('glide');
  if (kbGone) { kbPull.on = true; applyKbHeight(); }
  kbPull.full = Math.max(1, kbChrome() + kbH);
  p.classList.remove('gone'); p.classList.add('pull');
  return kbPull.full;
}
function kbPullTo(out) {
  const p = $('#perf');
  if (out == null) { p.classList.remove('pull'); p.style.transform = ''; return; } // (back above the keys' least: in the grid)
  p.classList.add('pull');
  p.style.transform = 'translateY(' + Math.round(kbPull.full - out) + 'px)';
}
function keyVis(n, on) { const k = keyEls.get(n); if (k) k.classList.toggle('down', on); PERF.lit(n, on); } // (1i: and the hardware beds)
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
// the keyboard's view controls: Hide keyboard (folds it away to its tab), the tab (a tap or Enter / Space folds it away /
// brings it back; a drag sizes the keys — below their least, or from folded, it pulls the tray like a drawer; arrows, Page
// Up / Down, Home / End when focused; Delete / Backspace resets) and the Key size slider (double-click / double-tap or
// Delete / Backspace: fitted to the screen again)
function initKbView() {
  const grip = $('#kbGrip'), kw = $('#kbw');
  $('#kbHide').onclick = () => setKbHidden(!kbGone);
  const hid = !!store.get('synth.kbHidden', false);
  setKbHidden(hid, false, false); // (shown: sized and laid out for the width; no glide at boot)
  // the height grip on the shell's grip helper (cv-tray trayGrip, shared with the top tray): drag (up = taller), arrows ±10
  // (Shift ±1), Page Up / Down ±40, Home / End, Delete / Backspace = the default; a tap / Enter / Space and o.fold: the drawer
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
    onTap: () => setKbHidden(!kbGone),
    fold: { label: 'Keyboard (folded away): show it', closed: () => kbGone, begin: kbPullBegin, pull: kbPullTo, done: (open, how) => setKbHidden(!open, how !== 'cancel') },
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
    if (k === 'tab') { // CANVAS ↔ ROLL (2026-10-23, the user: "tab should swap to canvas and back") — past the gates above (no ⌘ / Ctrl / Alt, not in text entry or a select, no dialog / sheet): bare Tab only, no menu / popover / Sources tray open
      if (e.shiftKey || cvPopOpen() || (shell.src && shell.src.isOpen())) return; // (Shift+Tab, an open menu: the browser's focus move)
      e.preventDefault(); // (a held key's repeats too: no focus jump, no second toggle)
      if (!e.repeat) openTab($('#tab-roll').hidden ? 'roll' : 'canvas'); // (cvMaster is a flag: the master canvas is what CANVAS shows again)
      return;
    }
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
      if (cvDeleteKey(e)) return; // (the canvas's selected modules, 2026-10-23)
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
  window.addEventListener('blur', () => { releaseKeys(); PADS.release(); perfLetGo(); DRUM.release(); }); // (1i: the hardware beds and controllers too; 7a: the pads, a held CLEAR; (8) the Pads modules' canvas and key holds — a hardware pad's note stays until its note-off)
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
// the OUT scope's tap, read each frame: the shown track's own analyser (its chain after the FX rack, then fader / mute and pan — what the
// track adds to the mix, as its meter), or null (the flat line) without a node (engine off, not built yet). A Master canvas returns `an` here
function scopeSource() {
  if (cvMaster) return an; // ((M, §5.2) the master canvas: the mix as exported (its OUT reads it itself, master-ui's read)
  const id = cvView ? cvView.trackId : (trk() || {}).id, N = id && nodes.get(id);
  return N ? N.sc : null;
}
function drawScope() {
  if (cvMaster) return; // ((M, lane U) the master OUT owns its scope: the shared one is not mounted there
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
  const A = scopeSource();
  if (!A) { g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke(); g.shadowBlur = 0; return; }
  if (scopeMode === 'wave') {
    A.getFloatTimeDomainData(td);
    const span = Math.min(2048, Math.round(A.context.sampleRate * 0.025));
    let t0 = 0;
    for (let i = 1; i < 4096; i++) if (td[i - 1] <= 0 && td[i] > 0) { t0 = i; break; }
    for (let i = 0; i < span; i++) {
      const x = i / (span - 1) * W, y = H / 2 - td[t0 + i] * H * 0.45;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
  } else {
    A.getFloatFrequencyData(fd);
    const ny = A.context.sampleRate / 2, n = fd.length, lo = Math.log(20), hi = Math.log(Math.min(ny, 24000));
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
    const F = outFrame(), t = AC.heardTick(F, T.as); // (curTick)
    if (T.rec) recAdv(heardPass(F)); // ((R) a pass heard ended: its held notes into its own step, before the sweep)
    posUI(t);
    roll && roll.setPlayhead(t, true, audible(trk()), heardFloor(F)); arr && arr.setPlayhead(t, true); // drawn in this frame, not the next; ((R) the roll's notes lit while heard, (review R-11) from the chase floor)
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
  if (mout) { mout.setLive(mOutLive()); mout.draw(); } // ((M) the master OUT: its own cadence (≤ 30 Hz), only while live
}

/* ============================================== canvas shell, stage 1b (docs/canvas/IMPL-1b.md §2, §4.8) */
// Three lanes build it in parallel; each edits only its own region below and the main.js functions IMPL-1b §2.3 gives it.
// The functions here are the cross-lane entry points: their names and signatures are fixed by the contract (each lane
// replaces only its own stubs' bodies). Until a lane lands, its stubs keep today's behaviour.
/* ---------------------------------------------- cv SHELL: top tray, keyboard tray, side trays, ≡ / ⚙, chips */
// The shell around the canvas (IMPL-1b §5.1, SPEC-canvas §2.1–§2.4): the top tray (one 48 px row; its grip reveals the
// arrangement toolbar, the ruler and the track rows, heights snapped to whole rows), the keyboard tray on the same grip
// helper (cv-tray trayGrip), one height budget for both (cv-tray budget: the canvas keeps ≥ 240 px, the tray dragged last
// wins and pushes the other toward its fold), the side tray (Sources: the synth drawings, tap or drag), the ≡ / ⚙ / ⋯ /
// Bars ▾ / track-list popovers and the Help sheet in #ov. Tray heights and widths persist in synth.cv.trays. (2026-10-22,
// the user) no Effects tray (its load estimates are in the FX rack's "+" menu: fxCost); every tray folds to its pull tab —
// the keyboard's too, all the way (kbGone) — and a tab is tapped (toggles) or pulled like a drawer (cv-tray pullSnap).
const shell = { top: null, kb: null, src: null, tiles: null, measure: null, menus: [], sheet: null, lead: 'bottom', leadWas: 'bottom',
  topH: 0, topLast: 0, topShown: 0, safeTop: 0, chrome: 0, srcAsk: false, drop: null, dropOn: null, chipModel: '', instT: 0, dots: [], nTr: 0 };
const oneRow = () => cvTray.topSnaps(1, cvTray.FOOT_H)[1]; // the arrangement toolbar, the ruler, one track row and ((M) the Master row: the footer)
const trayVh = () => Math.max(0, (window.innerHeight || 800) - shell.safeTop);
function trayPref() { const p = store.get(cvTray.TRAY_PREF, null); return p && typeof p === 'object' ? p : {}; }
function trayPrefSave() { store.set(cvTray.TRAY_PREF, Object.assign({}, trayPref(), { top: shell.topH, topLast: shell.topLast })); }
// the top tray's wanted height within its stops for this many tracks (its shown height comes from the budget)
function topWant() { const S = cvTray.topSnaps(project.tracks.length, cvTray.FOOT_H); return clamp(shell.topH || cvTray.TOP_ROW, cvTray.TOP_ROW, S[S.length - 1]); }
// the most the top tray may take when it leads (the keys pushed down to their least)
function topMaxH() {
  const S = cvTray.topSnaps(project.tracks.length, cvTray.FOOT_H), keys = !kbGone, chrome = shell.chrome || kbChrome(), lo = keys ? chrome + KB_H[0] : 0;
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
  if (mrow && mrow.state().live === folded) { mrow.setLive(!folded); monitors.sync(); } // ((M) the Master row shows with the rows: its meters with it
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
// a tap on the top grip (Enter / Space; 2026-10-22: no double-tap any more): folded ↔ the last height
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
  if (cvMaster) { // ((M, §5.1) the master canvas: the chip reads "Master" (the keys still play the track)
    c.style.setProperty('--tc', MASTER_TINT);
    $('#trkChip .cv-cn').textContent = MASTER_NAME;
    $('#trkChip .cv-cv').textContent = 'keys play ' + t.name;
    if (shell.chipModel !== MASTER) { shell.chipModel = MASTER; $('#trkChip .cv-cart').innerHTML = ''; }
    c.setAttribute('aria-label', `The master canvas — the keys play “${t.name}” — the track list`);
    for (const d of shell.dots) { d.classList.remove('on'); d.setAttribute('aria-pressed', 'false'); }
    return;
  }
  c.style.setProperty('--tc', t.color);
  $('#trkChip .cv-cn').textContent = t.name;
  const d = instOf(t);
  $('#trkChip .cv-cv').textContent = instN(t) > 1 ? instsTxt(t) : modelById(d.model).name + ' · ' + (voiceShown.get(vkey(t)) || trackVoice(d).label);
  if (shell.chipModel !== d.model) { shell.chipModel = d.model; $('#trkChip .cv-cart').innerHTML = cvArt.chip(d.model); }
  c.setAttribute('aria-label', `Track “${t.name}” (${modelById(d.model).name}) — the track list`);
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
    const b = h('button', 'cv-tpi' + (t.id === project.selTrack && !cvMaster ? ' on' : '')); b.type = 'button'; b.setAttribute('role', 'menuitem');
    b.style.setProperty('--tc', t.color);
    const d = instOf(t), art = h('span', 'cv-cart'); art.innerHTML = cvArt.chip(d.model); art.setAttribute('aria-hidden', 'true');
    const tx = h('span', 'cv-tpt'); tx.append(h('b', null, t.name), h('small', null, instN(t) > 1 ? instsTxt(t) : modelById(d.model).name + ' · ' + (voiceShown.get(vkey(t)) || trackVoice(d).label)));
    b.append(h('span', 'cv-sw'), art, tx);
    b.onclick = () => selectTrack(t.id);
    pop.append(b);
  }
  { // ((M, §5.1) the master canvas from here too — the collapsed tray has no footer
    const b = h('button', 'cv-tpi cv-tpm' + (cvMaster ? ' on' : '')); b.type = 'button'; b.setAttribute('role', 'menuitem');
    b.style.setProperty('--tc', MASTER_TINT);
    const tx = h('span', 'cv-tpt'); tx.append(h('b', null, MASTER_NAME), h('small', null, 'the mix: its effects and meters'));
    b.append(h('span', 'cv-sw'), tx);
    b.onclick = () => masterOpen();
    pop.append(b);
  }
  const add = h('button', 'cv-tpi add', '+ Add a track…'); add.type = 'button'; add.setAttribute('role', 'menuitem');
  add.onclick = () => cvOpenSources('track');
  pop.append(add);
}
// the track rows' instrument chip: tap → the instrument on the canvas; long-press / right-click → its menu
function instItems(t) { // every model, named with its voice mode (R6: the track's own as its patch plays)
  const d = instOf(t);
  return MODELS.map(m => ({ value: m.id, label: m.name + ' · ' + (m.id === d.model ? voiceShown.get(vkey(t)) || trackVoice(d).label : modelVoice(m).label) }));
}
function instMenu(t, x, y) {
  shell.instT = performance.now();
  const tr = () => project.tracks.find(q => q.id === t.id);
  const change = id => { const q = tr(); if (!q) return; selectTrack(q.id); if (!cvDropInstrument(id, null)) setTrackModel(trk(), id); };
  cvTray.popupMenu(x, y, [
    { label: 'Change instrument', sub: instItems(t).map(it => ({ label: it.label, checked: it.value === instOf(t).model, action: () => change(it.value) })) },
    { label: 'Show on canvas', action: () => { const q = tr(); if (q) instShow(q); } },
    { label: 'Open piano roll', action: () => { const q = tr(); if (q) { selectTrack(q.id); openTab('roll'); } } },
    { sep: true },
    { label: 'Replace with… (Sources tray)', action: () => { const q = tr(); if (q) { selectTrack(q.id); cvOpenSources('replace'); } } },
  ]);
}
function instShow(t) { selectTrack(t.id); if ($('#tab-inst').hidden) openTab('canvas'); cvReveal(t.id); }
function instTitle(name, tv) { return `${name} · ${tv} — tap: show it on the canvas · hold or right-click: change the instrument, open the roll`; }
function instChip(t) {
  const d = instOf(t), m = modelById(d.model), tv = voiceShown.get(vkey(t)) || trackVoice(d).label;
  const b = h('button', 'hinst'); b.type = 'button';
  b.title = instTitle(m.name, tv);
  b.setAttribute('aria-label', `Instrument ${m.name}: show it on the canvas (menu: change it)`);
  const art = h('span', 'hia'); art.setAttribute('aria-hidden', 'true'); art.innerHTML = cvArt.chip(d.model);
  // model · voice mode: three spans, the model name ellipsised first (style.css .hin / .his / .hiv; ≤ 900 px only the voice
  // mode: the drawing names the model), the voice mode always whole
  const lab = h('span', 'hil'), many = instN(t) > 1;
  if (many) lab.append(h('span', 'hin', instsTxt(t))); else lab.append(h('span', 'hin', m.name), h('span', 'his', ' · '), h('span', 'hiv', tv));
  lab.value = many ? '' : d.model; // (voiceSeen relabels its .hiv while it names the model)
  voiceOpt.set(vkey(t), lab);
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
  sxPartsDecor(); // ((WC, integration fixer L — B4) the module tiles greyed for the track a tap would change
  { const tr = $('#srcTray'); if (tr && tr.classList) tr.classList.toggle('cv-mside', cvMaster && mode !== 'track'); } // ((M, §5.2) no tiles on the master canvas
  if (cvMaster && mode !== 'track') { const p = $('#srcMode'); p.innerHTML = ''; p.append(MASTER_SRC); return; }
  const p = $('#srcMode'), v = shell.tiles.view(), one = v === 'serum' ? 'Serum' : 'one'; // (the intro follows the view)
  p.innerHTML = '';
  // ((8, R2-F6) the Controllers view: a tap adds a Pads module to the project — no instrument is replaced, no track made — in either mode)
  if (v === 'ctl') p.append(document.createTextNode('Tap '), h('b', null, 'Pads'), document.createTextNode(' to add a pad grid to the canvas — it shows on every track — or drag it where you want it.'));
  else if (mode === 'track') p.append('Tap ' + one + ' for ', h('b', null, 'a new track'), ', or drag it onto the track list.');
  else if (v === 'moog') { // ((9, review 2 F4) the Moog modules view: what a tap really does here — a module tile adds it to a 900 Series, the Model 15 tile loads Classic bass; on another instrument a tile makes it a 900 Series; (9b) the set tiles named: System 35 / 55 load their set, laid out)
    const tx = s => document.createTextNode(s), nm = h('b', null, '“' + trk().name + '”');
    if (ptShown()) p.append(tx('Tap a module to add it to '), nm, tx(', or drag it where you want it. '), h('b', null, 'Model 15'), tx(' loads Classic bass over the patch; '), h('b', null, 'System 35'), tx(', '), h('b', null, 'System 55'), tx(' and '), h('b', null, 'System IIIc'), tx(' bring their whole set, patched and laid out (tap to undo). Drag a tile onto the track list for a new track.'));
    else p.append(tx('Tap a module to replace the '), h('b', null, curModel().name), tx(' on '), nm, tx(' with a 900 Series holding it — '), h('b', null, 'Model 15'), tx(', '), h('b', null, 'System 35'), tx(', '), h('b', null, 'System 55'), tx(' or '), h('b', null, 'System IIIc'), tx(' for a whole set, patched — or drag one onto the canvas. Drag it onto the track list for a new track.'));
  } else if (v === RIG.VIEW) { // ((WC, integration fixer L — review WC-int P3-8) the <NAME> view: what a tap really does — on a <NAME> a module tile adds it and the <NAME> tile loads the starter; on any other instrument a tile replaces it
    const tx = s => document.createTextNode(s), nm = h('b', null, '“' + trk().name + '”'), rn = () => h('b', null, RIG.NAME);
    if (isRigDev(trk(), curOf(trk()))) p.append(tx('Tap a module to add it to '), nm, tx(', plugged in, or drag it where you want it. '), rn(), tx(' loads the starter rig (tap to undo). Drag a tile onto the track list for a new track.'));
    else p.append(tx('Tap a module to replace the '), h('b', null, curModel().name), tx(' on '), nm, tx(' with a '), rn(), tx(' holding it, or '), rn(), tx(' for a starter rig that plays — or drag one onto the canvas. Drag a tile onto the track list for a new track.'));
  } else p.append('Tap ' + one + ' to use it' + (v === 'flow' ? ' (simple panel)' : '') + ' in place of the ', h('b', null, curModel().name), ' on ',
    h('b', null, '“' + trk().name + '”'), ', or drag it onto the canvas. Drag it onto the track list for a new track.');
}
function srcOver(t) {
  if (!t || typeof t.closest !== 'function') return null;
  if (t.closest('#topTray')) return 'tracks';
  if (!$('#tab-inst').hidden && t.closest('#viewport')) return 'canvas';
  return null;
}
// the Sources tray's views (the dropdown, 2026-10-19; stage 1c's "Hardware | Simple" switch before it): Hardware and Simple
// show the classic synths, Serum the Serum tile, the Modulators and what comes for Serum. A classic synth picked or dropped
// comes in the view's layout (lay.<dev>.ui = 'flow' or none, as the module's ⋯ → Simple / Hardware layout), inside the add's
// / replace's own undo step; a tap on the current model's tile switches its layout to the tray's (both ways). The pref
// holds the view ('hw' | 'flow' | 'serum')
const TRAY_LAYOUT = 'synth.cv.trayLayout';
const srcUi = id => (!shell.tiles || isSxModel(modelById(id)) ? null : modelById(id).family === 'drums' || modelById(id).family === 'patch' || shell.tiles.layout() !== 'flow' ? 'hw' : 'flow'); // ((7a) a drum machine: Hardware always; (9) a 900 Series too)
function srcPick(id, mode) {
  if (cvMaster && mode !== 'track') { notice(MASTER_SRC, 4000); return; } // ((M, §5.2) nothing replaces an instrument from the master canvas
  const ui = srcUi(id), v = curView();
  // the tray stays open (the user's rule: only its tab, its ✕ or Escape close it); after a new track it goes back to
  // replacing the (new) selected track's instrument
  if (mode === 'track') { addTrack(modelById(id), null, { ui }); srcModeUI('replace'); return; }
  if (PT.isPatchModel(id) && ptSet()) return; // ((9, §1.4) the Model 15 tile on a 900 Series: Classic bass as a preset, never a same-model Replace)
  if (rigTile(id)) return; // ((WC, §3.5) the rig tile on a rig: its starter as a preset-style load
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
    const t = trk(), k = curOf(t), im = i.over === 'canvas' && cvView && !cvMaster ? cvView.modules.get(k) : null, ir = im ? im.rect() : null;
    if (i.over === 'canvas' && !cvMaster) { // ((M) no outline over the master canvas: a drop there is refused
      const sz = cvModuleSize(id), was = instOf(t).model, label = modelById(id).name + (id === was ? '' : ' · replaces ' + modelById(was).name);
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
    if (cvMaster) { notice(MASTER_SRC, 4000); return true; } // ((M, §5.2) refused, said
    if (PT.isPatchModel(id) && ptSet()) return true; // ((9) the Model 15 tile dropped on a 900 Series: as its tap)
    if (rigTile(id)) return true; // ((WC) the rig tile dropped on a rig: as its tap
    if (!cvDropInstrument(id, rect, { ui })) setTrackModel(curView(), id, { ui }); // (the same model: only the layout, if asked)
    return true;
  },
  cancel() { srcDragEnd(); },
};
function sideChanged(which, on) {
  noticePlace(); // ((WC pre-deploy [toast]) the toolbar moved with the tray)
  if (!on) { if (which === 'src' && shell.tiles) shell.tiles.closeView(); return; } // (no dropdown left over a closed tray)
  if (which === 'src') { if (!shell.srcAsk) srcModeUI('replace'); shell.srcAsk = false; }
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
  if (SHELL) shellHelp($('#helpParts')); // (the app: its own App sentence — IMPL-A §3.2 item 6)
  const parts = $('#helpParts'), kids = [...parts.children], body = h('div', 'cv-help');
  for (const k of kids) body.append(k);
  if (shell.sheet) shell.sheet.close();
  shell.sheet = cvTray.sheet({ title: 'Help & about', body, layer: $('#ov'), wide: true,
    onClose: () => { for (const k of kids) parts.append(k); shell.sheet = null; } });
}
function initShell() {
  shellMeasure();
  const P = trayPref();
  // ((M, §5.1) a height stored before the footer — a stop TOP_ROW + ARR_BAR + RULER + ROW_H·i — keeps its i rows: + FOOT_H)
  const foot = v => (v > cvTray.TOP_ROW && (v - cvTray.TOP_ROW - cvTray.ARR_BAR - cvTray.RULER) % cvTray.ROW_H === 0 ? v + cvTray.FOOT_H : v);
  shell.topH = P.top === 0 || P.top > 0 ? Math.max(cvTray.TOP_ROW, foot(+P.top)) : oneRow(); // (first run: one track row shown)
  shell.topLast = +P.topLast > cvTray.TOP_ROW ? foot(+P.topLast) : oneRow();
  // the top tray's grip, its pull tab: a drag follows the finger (snaps to whole rows on release; a flick folds it / opens
  // it to the last height), keys; a tap (Enter / Space) = folded ↔ the last height
  shell.top = cvTray.trayGrip($('#topGrip'), {
    edge: 'top', label: 'Track list height', step: cvTray.ROW_H,
    get: () => shell.topShown || cvTray.TOP_ROW, set: topSet, min: () => cvTray.TOP_ROW, max: () => topMaxH(),
    snaps: () => cvTray.topSnaps(project.tracks.length, cvTray.FOOT_H), onTap: topToggle, open: () => Math.max(shell.topLast || 0, oneRow()),
    start: () => { shell.leadWas = shell.lead; shell.lead = 'top'; shell.chrome = kbChrome(); },
    text: v => (v <= cvTray.TOP_ROW + 2 ? 'folded to one row' : `${Math.max(0, Math.round((v - oneRow()) / cvTray.ROW_H) + 1)} track rows`),
  });
  // the menus: ≡ (file, app, help), ⚙ (settings), the transport's ⋯ and the arrangement's Bars ▾ (narrow windows), tracks
  shell.menus = [
    cvTray.menuPop($('#appMenuBtn'), $('#appMenu')),
    cvTray.menuPop($('#gearBtn'), $('#gearPop'), { pick: false, onOpen: () => { $('#masterG').value = $('#master').value; perfUI(); } }),
    cvTray.menuPop($('#tMore'), $('#tMorePop'), { attr: 'data-open', pick: false }),
    cvTray.menuPop($('#aBars'), $('#aEdit'), { attr: 'data-open' }),
    cvTray.menuPop($('#trkChip'), $('#trkPop'), { onOpen: trkListUI }),
    // narrow windows (≤ 740 px): "⏻ ▾" shows Power and the meter (with its latency button) folded out of the row
    cvTray.menuPop($('#engMore'), $('#engPop'), { attr: 'data-open', pick: false, onClose: () => { if (shell.meter) shell.meter.close(); } }),
  ];
  shell.meter = meterUI();
  initMasterRow(); // ((M, §5.1) the Master row in the track list's footer
  // ⚙'s master level (shown where the top row's folds away, ≤ 1099 px): drives #master (its handler sets and saves)
  $('#masterG').oninput = () => { const m = $('#master'); m.value = $('#masterG').value; if (m.oninput) m.oninput(); };
  $('#helpBtn').onclick = () => helpSheet();
  const pm = $('#pinchMode');
  pm.value = store.get('synth.cv.pinch', 'canvas') === 'page' ? 'page' : 'canvas';
  pm.onchange = () => { const v = pm.value === 'page' ? 'page' : 'canvas'; if (world) world.setPinchMode(v); else store.set('synth.cv.pinch', v); };
  $('#rollhelp').onclick = () => $('#rollhelp').classList.toggle('open');
  // the side tray (2026-10-22: no rail — its pull tab on the canvas edge: a tap toggles, a pull drags it out like a drawer;
  // only the tab, its ✕ and Escape close it). The Effects tray of 1e is gone (the user): its effects are the FX rack's "+"
  // menu, their load estimates with them (fxCost); an old `fx` record in synth.cv.trays is ignored
  shell.src = cvTray.sideTray($('#srcTray'), { side: 'left', key: 'src', store, tab: $('#srcTab'), panel: $('#srcPanel'), grip: $('#srcGrip'),
    label: 'Sources', onChange: on => sideChanged('src', on) });
  $('#srcClose').onclick = () => shell.src.close();
  shell.tiles = cvTray.sourcesTray($('#srcList'), { models: MODELS, tray: $('#srcTray'), layer: $('#ov'), pick: srcPick, drag: srcDrag,
    overOf: srcOver, canvasGhost: () => !!world && !$('#tab-inst').hidden, // (a drag out of the tray leaves it open: the user's rule)
    layoutEl: $('#srcLayout'), viewBtn: $('#srcView'), viewMenu: $('#srcViewMenu'), secEl: $('#srcScroll'), noteEl: $('#srcNote'),
    view: store.get(TRAY_LAYOUT, 'hw'), onView: v => { store.set(TRAY_LAYOUT, v); srcModeUI(shell.tiles.mode()); },
    // (stage 2a) the Modulators section: a tap adds one where Tidy would, a drop where it lands (modPick / modTileDrag)
    mods: MOD_TILES, modsEl: $('#srcMods'), modsSec: $('#srcModSec'), modPick: id => modAdd(id, null), modDrag: modTileDrag,
    modCanvasGhost: () => !!world && !$('#tab-inst').hidden, toWorld: (x, y) => { const W = cvW(); return W && typeof W.toWorld === 'function' ? W.toWorld(x, y) : null; },
    // (8, §1.2) the Controllers view's tile row (Pads): a tap adds one where Tidy would, a drop where it lands (at its footprint)
    ctls: cvTray.CTL_TILES, ctlsEl: $('#srcCtls'), ctlsSec: $('#srcCtlSec'), ctlPick: id => modAdd(id, null), ctlDrag: modTileDrag,
    ctlCanvasGhost: () => !!world && !$('#tab-inst').hidden,
    // (milestone 3, §2.6) the Serum parts and note tools: a tap onto the track's Serum (or the Replace with Serum offer), a drop where it lands
    parts: true, partsEl: $('#srcParts'), partsSec: $('#srcPartSec'), notesEl: $('#srcNotes'), notesSec: $('#srcNoteSec'), partPick: (id, mode) => sxPartPick(id, mode), partDrag: sxPartDrag,
    partCanvasGhost: () => !!world && !$('#tab-inst').hidden,
    // (9, IMPL-9 §4.6) the Moog modules view's tile row: a tap / a drop adds the module to the shown 900 Series, else makes one
    moog: cvTray.MOOG_TILES, moogPick: (id, mode) => moogPick(id, mode), moogDrag, moogCanvasGhost: () => !!world && !$('#tab-inst').hidden, moogCost: id => moogCost(id),
    // (9b, IMPL-9b §4.3) the set tiles System 35 / System 55 after the Model 15 tile: a tap / a drop loads the set on the shown
    // 900 Series (laid out), else makes one (a Replace, + Track); greyed by ptTray when the patch cannot hold the set
    // (review 2 N1: the rack outline is pinned to the instrument, never under the finger — mostly off screen over the default Minimoog —, so the tile's own ghost stays with the finger over the canvas too)
    sets: cvTray.SET_TILES, setPick: (id, mode) => setPick(id, mode), setDrag, setCanvasGhost: () => false, setCost: id => setCost(id) });
  srcModeUI('replace');
  costLabels();
  // ⚙ → Measure this device (its line in the Canvas section): the Sources tiles' and the "+" menus' load labels follow this device's speed
  const gp = $('#gearPop');
  if (gp) {
    // (P, IMPL-P §2.3) "Performance: High · Medium · Low" first under Pinch on canvas, its one-line hint below (the select's
    // description); the world's preset shown (perfUI: ?perf= too), a pick stored and applied live (perfPick)
    const pf = h('label', 'field cv-perf'), ps = h('select'), ph = h('p', 'cv-ghint', PERF_HINT);
    ps.id = 'cvPerf'; ph.id = 'cvPerfHint'; ps.setAttribute('aria-describedby', ph.id);
    ps.title = 'High: the panels and cords as designed. Medium and Low, for slower tablets: panels softer up close, cords swinging more simply (Medium) or hanging still (Low). Visual only: the sound and the Oversampling setting never change';
    for (const v of cvWorld.PERFS) { const op = h('option', null, PERF_LABEL[v]); op.value = v; ps.append(op); }
    ps.value = perfPref();
    ps.onchange = () => perfPick(ps.value);
    pf.append('Performance ', ps);
    gp.append(pf, ph);
    shell.perfSel = ps;
    const f = h('div', 'field'), b = h('button', 'tt', 'Measure this device'), st = h('span', 'cv-measure');
    b.type = 'button'; b.title = 'Render a few standard voices off-line to learn this device’s speed: the load estimates (the Sources tray, the effects’ “+” menus) and the instrument limits use it';
    const fv = +store.get(DEV_FACTOR, 0);
    if (fv > 0) st.textContent = '×' + (Math.round(fv * 100) / 100);
    b.onclick = () => { cvMeasure(b, st); };
    f.append(h('span', null, 'Load estimates'), b, st);
    gp.append(f);
    shell.measure = { btn: b, st };
    // (IMPL-A, Q2) the app only — "Sound in background": on (the default), a held note or a playing song keeps sounding
    // when the app leaves the screen (its audio background mode, §5.2); off, the sound pauses until the app is back.
    // Native is told ({ t: 'bg', on }) at boot and on each change
    if (SHELL) {
      const bf = h('div', 'field'), bb = h('button', 'tt'), bt = h('p', 'cv-ghint', 'Keep playing when you switch apps (iPadOS may pause it after a while — for a MIDI app, use Split View)');
      bb.type = 'button'; bb.id = 'cvBg'; bt.id = 'cvBgHint'; bb.setAttribute('aria-describedby', bt.id);
      bb.title = 'On: a held note or a playing song keeps sounding when you switch to another app or lock the screen. Off: the sound pauses until you come back';
      const ui = () => { const on = bgOn(); bb.setAttribute('aria-pressed', on ? 'true' : 'false'); bb.textContent = on ? 'On' : 'Off'; };
      bb.onclick = () => { store.set(BG_KEY, !bgOn()); ui(); shellPost({ t: 'bg', on: bgOn() }); };
      ui();
      bf.append(h('span', null, 'Sound in background'), bb);
      gp.append(h('h3', null, 'App'), bf, bt);
      shell.bg = bb;
      // (IMPL-B §4.1) "Bluetooth MIDI — Pair a device…": native presents Apple's pairing sheet (the only way a Bluetooth MIDI
      // keyboard reaches an iPad app); the reply is not waited for
      const pf = h('div', 'field'), pb = h('button', 'tt', 'Pair a device…'), pt = h('p', 'cv-ghint', 'Pair a Bluetooth keyboard or pad controller (USB and other apps need no pairing)');
      pb.type = 'button'; pb.id = 'cvBt'; pt.id = 'cvBtHint'; pb.setAttribute('aria-describedby', pt.id);
      pb.title = 'Opens Apple’s list of nearby Bluetooth MIDI devices to pair one with this iPad. USB controllers and other music apps need no pairing';
      pb.onclick = () => shellPost({ t: 'midi-bt' });
      pf.append(h('span', null, 'Bluetooth MIDI'), pb);
      gp.append(pf, pt);
      shell.bt = pb;
    }
  }
  // the top tray animates its height from now on (not from the stylesheet's 48 px to the restored height at load)
  setTimeout(() => $('#topTray').classList.remove('still'), 80); // (a timer: a page opened in a background tab gets no frames)
  if (globalThis.__synthTest && typeof globalThis.__synthTest === 'object') { // (tests/cv-shell-sim.test.mjs, main.test menus)
    globalThis.__synthTest.shell = { shell, openTab, instItems, instMenu, cvOpenSources, srcPick, srcDrag, srcOver, topSet, topToggle,
      topWant, topMaxH, kbMaxH: c => kbMaxH(c), applyKbHeight, trkListUI, helpSheet, cvShellEscape, setKbHidden, kbGone: () => kbGone, fxCost };
  }
}
function cvShellEscape() { // Escape: closes an open ≡ / ⚙ popover, side tray or sheet → true
  if (modLayer && modLayer.close()) return true; // (stage 2a: the mod inspector / parameter list / Mod list)
  if (shell.sheet) { shell.sheet.close(); return true; }
  for (const m of shell.menus) if (m.close()) return true;
  if (shell.meter && shell.meter.close()) return true;
  if (shell.tiles && shell.tiles.closeView()) return true; // (the Sources view dropdown before its tray)
  return !!(shell.src && shell.src.close());
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
      isBackground: el => cvModule.isBackground(el), onTidy: () => cvTidy(), store, perf: perfPref() }); // ((P) built at the device's preset — ?perf= over it, the world's — never setPerf at boot)
    world.on('movestart', () => hideTip()); // (the kit's popups and tip close in the world: wk.closeTransient)
  } catch (err) { world = null; console.warn('Canvas camera unavailable — the panels stay where they are', err); }
  perfUI();
}
// (P, IMPL-P §1–§2) the performance preset — visual only: the cords' physics and the panel faces' texture density (cv-world
// setPerf → cv-face + cv-cords); nothing reaches a worklet and ⚙ Oversampling stays the person's (D1, D2). A device pref
// (synth.cv.perf: 'high' | 'medium' | 'low'; absent or anything else High — every device starts on High, no detection), never
// in a project or its History; cv-world's ?perf= over it for the session, never stored. Applied live, no reload
const PERF_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
const PERF_HINT = 'Lower settings draw panels and cords more simply, for slower tablets. Sound is unaffected.';
const perfPref = () => cvWorld.perfOf(store.get(cvWorld.PERF_PREF, 'high'));
function perfUI() { // ⚙'s select: the preset the world runs (?perf= shows), else the pref
  const s = shell.perfSel, W = cvW();
  if (s) s.value = W && cvWorld.PERFS.includes(W.perf) ? W.perf : perfPref();
}
function perfPick(v) { // the person's own pick: stored, then live
  const p = cvWorld.perfOf(v), W = cvW();
  store.set(cvWorld.PERF_PREF, p);
  if (W && typeof W.setPerf === 'function') W.setPerf(p);
  perfUI();
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
/* ---- the canvas Delete key (2026-10-23, the user: "i should be able to delete a selected module with the delete key") */
// Delete / Backspace — past the keydown handler's gates (no ⌘ / Ctrl / Alt, no repeat, focus out of text entry and selects, no
// modal / sheet) — on the CANVAS view with something selected there (pressed or focused after the arrangement's bar range: else
// that range's Delete), no Shift, no popover / menu open: every selected module goes through its own ⋯ menu's Delete / Remove
// (cvDelOf — a modulator or Pads: modDelete, a 900 Series module with its cords: PATCH.remove, a Serum part: sxRemovePart, which
// refuses by its own rule while something reads it), the whole press ONE History step (histFold). The instrument (Replace with…
// instead: one per track), an FX panel, OUT and the master canvas's modules stay: the notice says so, and what stayed beside what
// went. Never the note keys or the transport (the key is taken here)
const cvSelIds = W => (W && Array.isArray(W.selection) ? W.selection : W && W.selected ? [W.selected] : []).filter(k => typeof k === 'string');
const cvPopOpen = () => !!shell.sheet || (shell.menus || []).some(m => m && m.isOpen()) || $('#meter').classList.contains('open') || !!(modLayer && modLayer.isOpen()) || wkMenuOpen();
const andList = L => (L.length > 1 ? L.slice(0, -1).join(', ') + ' and ' + L[L.length - 1] : L.join(''));
// module `key`'s ⋯ Delete / Remove (cvMenu's and cv-patch items' calls) → () → bool (done) | null: not removable
function cvDelOf(t, key) {
  const kind = kindOfKey(t, key);
  if (kind === 'mod') return () => modDelete(key);
  if (kind === 'pm') { const q = pmOf(t, key); return () => PATCH.remove(q.mid); }
  if (kind === 'part') return () => sxRemovePart(key);
  return null;
}
// → true when the key is the canvas's (taken: nothing else hears it)
function cvDeleteKey(e) {
  const W = cvW(), ids = cvSelIds(W), vp = $('#viewport'), a = document.activeElement;
  if (!W || !cvView || $('#tab-inst').hidden || !ids.length) return false;
  if (lastArea === 'arr' && range && !cvArea && !(a && vp && (a === vp || vp.contains(a)))) return false; // (the bars' range, pressed last)
  if (!e.shiftKey && !cvPopOpen()) cvDeleteSel(ids);
  return true;
}
const CV_KEEP = [['inst', 'the instrument'], ['fx', 'the FX panel'], ['out', 'OUT']];
function cvDeleteSel(ids) {
  if (cvMaster) { notice('The master canvas’s modules can’t be deleted', 4000); return; }
  const t = trk(), jobs = [], kept = new Set();
  for (const key of ids) {
    if (!cvView.modules.has(key)) continue;
    const run = cvDelOf(t, key);
    if (run) jobs.push({ run, title: cvTitle(key).title, verb: kindOfKey(t, key) === 'part' ? 'Remove ' : 'Delete ' }); else kept.add(kindOfKey(t, key)); // (verb: the path's own step label)
  }
  const mk = jobs.length ? hist.mark(project) : null, log = [], done = [], why = [];
  noticeLog = log;
  try { for (const j of jobs) { const at = log.length; if (j.run()) done.push(j); else why.push(...log.slice(at)); } } finally { noticeLog = null; }
  const step = done.length ? histFold(mk, done.length > 1 ? 'Delete ' + done.length + ' modules' : done[0].verb + done[0].title) : null;
  updateUndoUI();
  if (done.length === 1 && !kept.size && !why.length && log.length) return; // (one module, its path's own notice: "Deleted 902 1 and 2 cords · tap to undo")
  const nouns = CV_KEEP.filter(x => kept.has(x[0])).map(x => x[1]), list = andList(nouns), out = [];
  if (done.length) out.push('Deleted ' + (done.length === 1 ? done[0].title : done.length + ' modules'));
  if (nouns.length) out.push(done.length ? list + (nouns.length > 1 ? ' stay' : ' stays') : list[0].toUpperCase() + list.slice(1) + ' can’t be deleted' + (kept.has('inst') ? ' · to change the instrument, use Replace with… in its ⋯ menu' : ''));
  out.push(...why);
  if (!out.length) return;
  const msg = out.join(' · ') + (step ? ' · tap to undo' : '');
  for (const s of log) if (s !== msg) noticeActs.delete(s); // (the paths' own taps: their steps are folded into one)
  if (step) noticeActs.set(msg, () => { noticeActs.delete(msg); notice('', 0); if (hist.u[hist.u.length - 1] === step) undo(true); });
  notice(msg, step ? 8000 : 5000);
}
// ONE History step for a press that ran several recorded edits (cvDeleteSel: each path records its own) — History mark / fold:
// the step left holds the state at mark (the first one pushed, or the no-op step on top that held it already), labelled `label`
// (the path's own when it is one module: its step may be that no-op one); the removed Serum parts' ⏻ writes (sxBack's meta
// {trackId, dev, part, f}, the delete paths' only meta — set on whichever step was on top; one Serum per track) merged onto it
// → the step | null
function histFold(mk, label) {
  const r = mk && hist.fold(mk);
  if (!r) return null;
  const st = r.step, partMeta = m => !!m && Array.isArray(m.f) && !!m.dev;
  const sx = [...(st.meta !== mk.meta && partMeta(st.meta) ? [st.meta] : []), ...r.metas.filter(partMeta)]; // (on the kept step: set in this press — a path's)
  if (sx.length === 1) st.meta = sx[0];
  else if (sx.length > 1) st.meta = { trackId: sx[0].trackId, dev: sx[0].dev, parts: sx.map(m => m.part), f: sx.flatMap(m => m.f) };
  st.label = label;
  return st;
}
/* ---------------------------------------------- cv MODULES: modules, cables, layout, camera prefs */
// The selected track's modules (cv-module createTrackView, device-driven: one module per device, its key the device id,
// IMPL-1e §4.1): every device gets an element of its own (cvBodyEl: a ClassicPanel, a SerumUI or an FXRackUI built into
// it, destroyed with its module) — (milestone 3, R6) the primary and its FX too: #inst / #fxrack are no homes any more —,
// OUT holds the scope (moved by reference from #cvParts and back). .about opens from an instrument's ⋯ → About. Positions,
// folds and z live in track.lay (one History step per move / fold; bring-to-front none); the camera lives in device prefs
// (CAM_PREF, keyed by CM.camKey(project uid, track id)), never in History. Without the canvas DOM (no #cvParts / #world: an
// index.html from before the shell) no panel is built.
const cvParts = { home: null, root: null, scope: null, about: null };
let cvView = null, cvViewKey = '', cvTestWorld = null, cvBusy = false, cvHold = false, cvCamT = 0, cvCamPend = null;
const cvSeen = new Map(); // model id → the measured {w, h} of its instrument module on this device (drop outlines)
const cvChips = new Map(); // 'trackId/dev' → an instrument module's preset chip {key: 'trackId/dev/model', el, sel, sig}
const cvEls = new Map(); // 'trackId/key' → the body element of a device besides the primary and its FX (made here, mounted by its module)
const cvBuilt = new Map(); // 'trackId/key' → the element its panel was last built into (a module mounting another one is due a build)
const cvMounted = new Map(); // module key → {el, tid}: what the current view's module bodies hold
const cvDue = new Set(); // module keys mounted without their panel (a new device, a kind change, the bodies re-homed): built after the sync
const cvW = () => cvTestWorld || world;
// (9, §4.5; review 2 F2, the lead's decision) the world's fit — the toolbar's, the 0 key, the empty-canvas double-tap — on a 900 Series frames its
// controller and its rack (not the FX panel and OUT), never below READ_K: the rack's top (the oscillator row) stays in view, no foot — the user
// scrolls down to the controller —, and the whole of it when it fits at READ_K (cvCamRestore's default camera is the same frame). Else null: every item
function cvFitHook() {
  const t = trk(), dev = t ? curOf(t) : null;
  if (!cvView || !dev || cvView.trackId !== t.id || !isPatchDev(t, dev)) return null;
  return { ids: [dev, ...[...cvView.modules.keys()].filter(k => pmOf(t, k))], kMin: cvWorld.READ_K };
}
const cvOn = () => !!cvParts.home;
// a new module's place on the dots (always: the canvas has no Snap toggle)
const cvDot = v => Math.round(v / cvWorld.DOT) * cvWorld.DOT;
function initModules() {
  const home = $('#cvParts'), root = $('#world');
  if (!home || !root) return;
  Object.assign(cvParts, { home, root, scope: $('.scope'), about: $('.about') });
  home.hidden = true;
  const tw = globalThis.__synthTest && globalThis.__synthTest.cvWorld; // (tests/canvas-sim: a scripted world)
  if (typeof tw === 'function') cvTestWorld = tw(root);
  const W = cvW();
  if (W && typeof W.on === 'function') {
    W.on('cameraend', d => cvCamQueue((d && d.cam) || W.cam));
    W.on('screen', () => monitors.sync()); // (a module went on / off screen: its live displays follow, CULL_MARGIN early)
    W.on('resize', e => cvCamResized(e)); // (the keyboard tray sized after boot, a rotation: an untouched default follows)
    if (typeof W.setFitHook === 'function') W.setFitHook(cvFitHook);
    if (typeof W.setJackNear === 'function') W.setJackNear(rigNearJack); // ((WC, fixer K; P2-3) a press near a rig's jack is the jack's
    W.on('mods', m => { if (cvView) cvView.setModsVisible(m); }); // (stage 2a: the toolbar ∿ — Always / On select / Never)
    let slept = false; // (1i §4.3) a tap on sleeping keys / a controller: the hint, once per session
    W.on('sleeptap', d => { const pd = !!d && PC.PAD_ID.test(d.id); if (slept !== true && slept !== (pd ? 'p' : 's')) { slept = slept ? true : pd ? 'p' : 's'; notice(pd ? 'Zoom in, or double-tap the module, to play it' : 'Zoom in, or double-tap the synth, to play it', 2500); } }); // ((8, §2.3) a Pads module's own words, once each)
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
const kindOfKey = (t, key) => {
  if (PC.PAD_ID.test(key)) return padMod(key) ? 'mod' : null; // ((8, §1.1) a Pads module: the project's, a modulator-kind module on every track)
  if (pmOf(t, key)) return 'pm'; // ((9, §4.1) a 900 Series' module 'iN/m<k>': a part of its instrument, no device of its own)
  const q = CMOD.partOf(key);
  if (q) return isSxDev(t, q.dev) ? 'part' : null; // ((3) a Serum part 'iN/oscB': a module of its Serum's host, no device)
  const d = t && t.dev ? t.dev[key] : null;
  if (key === 'wheel' ? CMOD.hasWheel(project) : !!d && cvModule.MOD_ORDER.includes(d.kind) && CMOD.kindOfId(key) === d.kind) return 'mod'; // (stage 2a: a modulator; 2b: any kind, its id by prefix)
  return /\/fx$/.test(key) || (d && d.kind === 'panel') ? 'fx' : d && d.kind === 'out' ? 'out' : d && d.kind === 'synth' ? 'inst' : null;
};
// the element device `key` of t renders into (its module body holds it)
function cvBodyEl(t, key) {
  const P = cvParts, kind = kindOfKey(t, key);
  if (kind === 'out') return P.scope;
  const k = t.id + '/' + key;
  let el = cvEls.get(k);
  if (!el) {
    if (kind === 'part') { el = h('div', 'sxpart'); el.setAttribute('data-part', key); } // ((3) a part's panel root goes in here)
    else {
      el = h('section', kind === 'fx' ? 'fxtab' : 'inst');
      el.setAttribute('aria-label', kind === 'fx' ? 'Effects rack' : 'Instrument panel');
    }
    cvEls.set(k, el);
  }
  return el;
}
// host.bodies.mount: the device's element into its module body; its panel built after the sync when it is not yet (cvDue).
// A press in an instrument's body makes it the current one (setCur)
function cvMountBody(key, b) {
  if (kindOfKey(trk(), key) === 'mod') { modMount(key, b); return; } // (stage 2a: a modulator's body, cv-mods-ui)
  if (kindOfKey(trk(), key) === 'pm') { pmMount(key, b); return; } // ((9) a patch module's face: cv-patch moduleBody over vals.p)
  const t = trk(), kind = kindOfKey(t, key), el = cvBodyEl(t, key);
  if (kind === 'out') b.classList.add('cv-out');
  b.append(el);
  cvMounted.set(key, { el, tid: t.id });
  if (kind === 'part') { sxViews(t, CMOD.partOf(key).dev); return; } // ((3) its panel: a view of its Serum's host, once that is built)
  if (kind === 'inst') b.addEventListener('pointerdown', () => { const x = trk(); if (cvView && cvView.trackId === x.id) setCur(x, key); }, { passive: true });
  if (kind === 'inst' && isSxDev(t, key) && cvBuilt.get(t.id + '/' + key) === el) sxViews(t, key); // ((3) a module made again for a view switch: the same host, the other views)
  if (kind !== 'out' && cvBuilt.get(t.id + '/' + key) !== el) cvDue.add(key);
  // (1h) a built panel re-homed (the same track's view rebuilt, a track switched back) without a camera move: its GL face
  // finds its new module now, not at the next zoom end (rest-time: a layout read of the decos' offsets)
  else if (kind === 'inst') { try { FACES.recheck(); } catch (err) { console.error(err); } }
}
// host.bodies.unmount: the module went (removed, its kind changed, the view rebuilt for another track): the scope goes home;
// a device's own element takes its panel with it (R6: the primary's too — a same-track change is a sync, never a rebuild)
function cvUnmountBody(key) {
  if (modUnmount(key) || pmUnmount(key)) return;
  const M = cvMounted.get(key);
  cvMounted.delete(key); cvDue.delete(key);
  if (!M) return;
  const P = cvParts, el = M.el;
  if (el === P.scope) { if (P.home) P.home.append(el); return; }
  const q = CMOD.partOf(key), t = trk();
  if (q) { sxPartGone(M.tid, key, M.el); return; } // ((3) a part module went: its view (the host stays)
  // (3) a Serum's module made again in the same sync (its view switched: VOICE ↔ the whole panel, another set of jacks) keeps
  // its element and host — the new module takes them (cvMountBody); a removed device or another track drops them
  if (M.tid === t.id && isSxDev(t, key) && (sxRecOf(t.id, key) || {}).el === el) { if (typeof el.remove === 'function') el.remove(); return; }
  cvDropBody(key, M);
}
function cvDropBody(key, M) { // a device's own element and its panel go
  const el = M.el, k = M.tid + '/' + key;
  if (cvEls.get(k) === el) cvEls.delete(k);
  if (cvBuilt.get(k) === el) cvBuilt.delete(k);
  const C = classicPanels.get(k), R = serumPanels.get(k), F = fxPanels.get(k);
  if (C && C.root === el) { C.destroy(); classicPanels.delete(k); cpMonOff(k); } // ((2b) its halo subscription goes with it)
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
  if (cvMaster) { cvRenderMaster(); return; } // ((M, §5.2) the master canvas: its own view and host — never trk()'s
  const t = trk(), key = project.uid + '/' + t.id, W = cvW();
  sxPlaceNew(t); // ((3, I1) a part shown without a place gets one by Tidy's rule — no History step)
  // (R6) the same track: a sync — the modules follow its devices (a model change swaps fx1 ↔ iN/fx there), every body is
  // its device's own element, nothing moves home, so the primary or its FX changing is no rebuild (U4's bodies survive)
  if (cvView && cvViewKey === key) { cvView.sync(t); cvRoom(false); }
  else { // a new track: its view and its camera
    cvCamFlush(); // the outgoing track's camera first
    if (cvView) { try { cvView.destroy(); } finally { cvView = null; } }
    if (W && typeof W.clear === 'function') W.clear();
    for (const k of [...cvChips.keys()]) if (!k.startsWith(t.id + '/')) cvChips.delete(k);
    cvViewKey = key;
    cvView = cvModule.createTrackView(W, t, cvHost());
    // (stage 1f: the audio cables are read-only — host.patch false —; stage 2a: the jack hook drags mod cables onto knobs)
    modDrag = cvView.cableDrag(modDragOpts);
    cvRoom(true);
    cvCamRestore(t);
    monitors.sync();
  }
  if (cvBodiesDue() && cvView) { cvView.sync(trk()); cvRoom(false); }
  rigRects.clear(); rigMark(); rigSkin(); // ((WC) the rig's modules: data-cv-rig, the skin on the world; the anchors' heights measured again
  rigCtls.clear(); rigDestC.clear(); rigBadgeC.clear();
  if (rigLaid && rigView() && !cvMaster && isRigDev(trk(), curOf(trk())) && typeof cvView.ports === 'function') cvView.cables.layout(cvView.ports()); // ((WC) the knob ends, rings and badges over the view as it now stands (its ports)
  cvModDecor();
  sxLabels(); // ((3) the part modules' titles carry their panels' label drags)
  cvPartsSig = sxPartsSig(trk()); // ((3) cvRelabel: a part set changed by an edit makes the modules again)
  sxSettleSoon(); // ((3) parts placed with Tidy's height guesses: moved clear once measured)
  sxHeavySoon(); // ((3) touch: a Serum in parts past sx1's painted elements says so once, at rest; (9) a 900 Series' modules too)
  ptTray(); // ((9) the Moog tiles greyed at the patch's PT.MAX_MODS modules — 512 since P, was 48)
}
// (1i) the keyboard bed of an instrument's Hardware layout: its box in the module's body px (null: none — the Simple layout,
// Serum, a model without hardware keys). The default camera keeps it on screen
function cvBedBox(t, dev = curOf(t)) {
  const m = modelById(instView(t, dev).model), L = isSxModel(m) || instUi(t, dev) === 'flow' ? null : hwLayoutOf(m), g = L && cvPanel.geometry(L, m), o = g && g.controls.find(c => c.bed && c.live);
  return o ? o.bed.box : null;
}
// an instrument's size — always fixed, nothing is resizable (the user's rule, 2026-10-18): a classic one in its Hardware
// layout its panel's (cv-panel sizeOf), in its Simple layout (or a model whose panel is not drawn yet) its model's
// width (cvModule.FLOW_W: everything fits; the height measured), a Serum W_SERUM
function cvInstSize(t, dev = curOf(t)) {
  if (sxParts(t, dev)) return { fixed: { w: RIGUI === false ? sxPartW('voice') : rigW('amp') } }; // ((3) VOICE: its panel's width, the height measured; (WC) the Amplifier's face)
  const m = modelById(instView(t, dev).model), L = isSxModel(m) || instUi(t, dev) === 'flow' ? null : hwLayoutOf(m);
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
      if (o.ui === 'flow' || o.ui === 'parts') e.ui = o.ui; // ((3) a Serum's parts view rides along)
      cvLay(k, e, 'end', 'room');
      if (mm) mm.setPos(e.x, e.y, false);
    }
    // the instrument pinned too (a Tidy-placed one would re-tidy from the new widths)
    if (!old[K]) { const e = { x: Math.round(m.x), y: Math.round(m.y) }; if (m.fold) e.fold = 1; if (sxParts(t, K)) e.ui = 'parts'; cvLay(K, e, 'end', 'pin'); }
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
  if (isSxDev(t, K) || isDrumDev(t, K) || isPatchDev(t, K) || (want !== 'hw' && want !== 'flow') || instUi(t, K) === want) return; // ((7a) a drum machine: Hardware only; (9) a 900 Series too)
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
    cables: { onSelect: modCableSel, onAction: modCableAct, menu: modCableMenu, onHint: modHint, ignore: modAside,
      dashedSet: () => dashedOf(trk()), // (2b: a per-note source following the last note — compileMods' derived list; (C4) one build per refresh, not per cable)
      // ((WC, IMPL-WC §4.1, §4.3) a rig canvas in cords mode: the records the cord layer draws (cordOf), the layer's list and anchors from
      // them (rigRecords: fanned jacks, the knob ends) and the claimed badges' places (its answer), the selection mirrored, a point on a
      // rope, (fixer B2) the layer above the cords for the claimed badges and the × (cv-cords top); its internal records rig-core's edges)
      cords: cordOf, onRecords: rigRecords, cordSel: id => { const C = cvCords(); if (C && rigCordsOn) C.sel(id); }, cordPoint: (id, f) => { const C = cvCords(); return C && rigCordsOn ? C.pointAt(id, f) : null; },
      top: () => { const C = rigCordsOn || drawMode(trk()) === 'cords' ? cvCords() : null; return C && typeof C.top === 'function' ? C.top() : null; },
      edges: (id, dev) => { const t = trk(); return !isRigDev(t, id) || RIGUI === false ? null : rigEdges(t, id); },
      route: (c, A, B) => rigRoute(c, A, B) }, // ((WC, integration fixer L — P3-11) a rig's Amplifier → Effects line round the Amplifier on the upright wrap
    title: cvTitle,
    menu: cvMenu,
    size: key => { if (PC.PAD_ID.test(key)) { const M = padMod(key); return M ? cvPads.moduleSize(M) : null; } const t = trk(), pm = pmOf(t, key); if (pm) return PATCH.size(t, pm.dev, key); const q = CMOD.partOf(key); return q ? { fixed: { w: RIGUI === false ? sxPartW(SE.kindOf(q.part)) : rigW(q.part) } } : CMOD.instOf(t, key) ? cvInstSize(t, key) : null; }, // ((3) a part: its panel's width; (8) a Pads module: its grid's footprint; (9) a patch module: its type's MU; (WC) a rig module: its face's (rig-ui, the RIG grid)
    // (9, IMPL-9 §4.4–§4.5) a 900 Series' rack (Tidy: patch-core rackLayout above its controller), a driver's driven modules
    // outlined with it, every relayout's ports to the cord layer (its plugs' anchors)
    rackLayout: key => PATCH.rack(trk(), key),
    tidyOpts: t => rigTidyOpts(t), // ((WC, review 2 P2-5) a rig's Tidy: its modulators' targets, the canvas's shape
    members: key => { const t = trk(), q = pmOf(t, key); return q ? PATCH.members(t, q.dev, key) : []; },
    onRelay: ports => { const C = ptShown() ? cvCords() : null; if (C && typeof C.anchors === 'function') C.anchors(ports); }, // ((WC) the patch canvas's only: a rig's anchors are its records' (rigRecords, after cables.layout)
    powerEl: key => sxPowerEl(key), // ((3) a part's own ⏻ (its panel's power toggle) in its bar's power slot
    // (stage 1f: no ⏻, no key-zone pill — host.power / host.zone not given —, read-only cables)
    badge: key => cvBadge(key),
    patch: false,
    select: key => { const t = trk(); if (CMOD.instOf(t, key)) setCur(t, key); },
    lay: cvLay,
    shown: key => { PADS.resync(); monitors.sync(); sxReshow(); if (key) PATCH.shown(key); }, // ((8) a Pads module on / off screen: its lights' subscriptions first; (9b) a patch face back on screen: its lamps from what was heard)
  };
}
// (review 2 P1-2) a part module on screen again (or unfolded, or the CANVAS tab back): a Serum view a paint skipped while it
// was hidden — mounted off screen, an edit or a load since — is painted fully once (the host's reshow; engine off too)
function sxReshow() {
  const id = project && trk() ? trk().id : null;
  for (const rec of serumPanels.values()) if (rec.trackId === id && rec.mode === 'parts' && rec.ui && typeof rec.ui.reshow === 'function') rec.ui.reshow();
}
const cvDevName = (t, key) => { const d = t.dev && t.dev[key]; return d && d.kind === 'synth' ? d.name || modelById(d.model).name : cvTitle(key).title; };
function cvTitle(key) {
  const t = trk(), kind = kindOfKey(t, key), d = t.dev && t.dev[key];
  if (kind === 'part') { const q = CMOD.partOf(key), rig = isRigDev(t, q.dev); return { title: rig ? RC.barOf(q.part, t.dev[q.dev].rig) : rigLabel(t, q.dev, q.part), sub: rig ? '' : cvDevName(t, q.dev), chip: null }; } // ((3) a part of …; (WC) the rig's own names, the ordinals of dev.rig.n — "Envelope 2"; (review 2 P3-2) no "<NAME>" under each — the Amplifier says it once — and a title the bar holds ("Sub osc"))
  if (kind === 'inst' && sxParts(t, key)) return { title: RC.MODULES.amp.label, sub: cvDevName(t, key), chip: null }; // ((WC) the Amplifier: the rig's hub (no preset strip in WC-1, §3.7)
  if (kind === 'inst') { const m = modelById(d.model); return { title: d.name || m.name, sub: t.name, chip: cvChip(t, key) }; } // ((9) a 900 Series' controller: its chip the patch's name)
  if (kind === 'pm') { const q = pmOf(t, key); return PATCH.title(t, q.dev, q.mid); } // ((9) "921B 2", a driven one's "on 921A 1")
  if (kind === 'mod' && PC.PAD_ID.test(key)) { const M = padMod(key); return { title: M ? M.name : key, sub: 'every track', chip: cvPads.chipText(M) }; } // ((8) "Pads 1", its grid "4 × 4")
  if (kind === 'mod') { const mk = modKindOfKey(t, key); return { title: mk ? CMOD.modLabelOf(key, d) : key, sub: key === 'wheel' ? 'every track' : t.name }; } // ((U7) numbered: "LFO 2", as History and the labels say)
  if (kind === 'fx') {
    const own = /\/fx$/.test(key) ? key.slice(0, -3) : null, fx = fxOfDev(t, own || key);
    if (own) { const s = t.dev[own]; return { title: isRigDev(t, own) ? RC.labelOf('fx') : 'Serum FX (own)', sub: cvCables.routeLabel(s && s.vals && s.vals.s, fx) || 'no effects' }; } // ((WC, G13) a rig's: "Effects")
    const n = fx && Array.isArray(fx.racks) ? fx.racks.reduce((a, r) => a + (r && Array.isArray(r.mods) ? r.mods.length : 0), 0) : 0, N = CG.devNum(key);
    return { title: (d && d.name) || (N > 1 ? 'FX Panel ' + N : 'FX Panel'), sub: n ? n + (n === 1 ? ' effect' : ' effects') : 'empty' };
  }
  return { title: 'OUT', sub: 'track output' }; // ((M, §5.3) the master's is its own module
}
// an instrument module's chip: a classic one's ◀ preset select ▶ (the Hardware panel has no preset plate: the chip
// loads, the ⋯ menu saves / deletes / inits) / a Serum's preset name
function cvChip(t, dev = curOf(t)) {
  const iv = instView(t, dev), m = modelById(iv.model), ck = t.id + '/' + dev, key = ck + '/' + m.id;
  let C = cvChips.get(ck);
  if (!C || C.key !== key) {
    let el, sel;
    const here = () => { const iv = instView(trk(), dev); return iv.model === m.id ? iv : null; };
    if (isSxModel(m)) { el = sel = h('span', 'cv-pname'); el.title = 'Preset (change it in the panel’s browser)'; }
    else if (m.family === 'patch') { el = sel = h('span', 'cv-pname'); el.title = 'Patch (⋯ → Patches)'; } // ((9) a preset is topology: no ◀ ▶
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
  const iv = instView(t, dev), m = modelById(iv.model), C = cvChips.get(t.id + '/' + dev);
  if (!C || C.key !== t.id + '/' + dev + '/' + m.id) return;
  if (isSxModel(m)) { const s = iv.preset || 'Init'; if (C.el.textContent !== s) C.el.textContent = s; return; }
  if (m.family === 'patch') { const s = PATCH.chip(t, dev) || 'Patch'; if (C.el.textContent !== s) C.el.textContent = s; return; } // ((9) the patch's name: the last preset loaded)
  const list = presetList(m), sig = list.length + ':' + iv.preset;
  if (sig === C.sig) return;
  C.sig = sig;
  const sel = C.sel;
  sel.innerHTML = '';
  const o0 = h('option', null, iv.preset ? iv.preset : iv.preset === null ? 'Custom' : '—'); o0.value = ''; sel.append(o0);
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
  if (cvMaster) return mMenu(b === undefined ? a : b); // ((M) the master canvas's menus
  const key = b === undefined ? a : b, V = cvView, m = V && V.modules.get(key);
  if (!m) return [];
  const t = trk(), kind = kindOfKey(t, key);
  const fold = { label: m.fold ? 'Unfold' : 'Fold', action: () => V.toggleFold(key) };
  const front = { label: 'Bring to front', action: () => V.front(key) };
  const tidyI = { label: 'Tidy the canvas', action: () => cvTidy() };
  if (kind === 'inst') {
    const iv = instView(t, key), mdl = modelById(iv.model), here = fn => () => { setCur(trk(), key); fn(); };
    const head = [{ label: 'About the ' + mdl.name + '…', action: here(cvAbout) }, { label: 'Replace with…', action: here(() => cvOpenSources('replace')) }];
    // ((9, §6) a 900 Series' controller: Patches ▸ (the starting patches, Init patch) and Tidy patch — no classic sound or layout
    // items (they would save the controller's knobs alone), no fold)
    if (isPatchDev(t, key)) return [...head, { sep: true }, ...PATCH.items(t, key, PT.CTL), { sep: true }, front, { sep: true }, tidyI];
    if (isRigDev(t, key)) { // ((WC, §8.2) the Amplifier: About, Replace with…, Init (the raw oscillator), its panel's items (Preferences…, Info…); no Remove
      const own = sxViewItems(t, key);
      return [...head, { sep: true }, { label: 'Init', action: () => rigInitDev(key) }, { label: 'Modulation list…', action: () => modList() },
        ...(own.length ? [{ sep: true }, ...own] : []), { sep: true }, fold, front, { sep: true }, tidyI];
    }
    if (isSxModel(mdl)) { // (Serum: its own browser saves; 2a: its mod rows; (WC) the Serum is the whole panel — no Show parts / Bundle / Add (§6) —, Make it a <NAME> (Q4 (a))
      return [...head, { sep: true }, { label: 'Make it a ' + RIG.NAME, action: () => rigConvert(key) }, { label: 'Modulation list…', action: () => modList() }, { sep: true }, fold, front, { sep: true }, tidyI];
    }
    // a classic synth: its real front panel (default) or today's simple panel; the sound actions of its preset plate
    const u = instUi(t, key), hw = !!hwLayoutOf(mdl);
    const lays = mdl.family === 'drums' ? [] : [ // ((7a §8) a drum machine: no layout items — Hardware only)
      { label: hw ? 'Hardware layout' : 'Hardware layout (not drawn yet)', checked: u === 'hw', action: () => cvSetLayout('hw', key) },
      { label: 'Simple layout', checked: u === 'flow', action: () => cvSetLayout('flow', key) },
      { sep: true }];
    return [...head, { sep: true }, ...lays,
      { label: 'Save sound…', action: () => presetSave(iv) }, { label: 'Delete saved sound', action: () => presetDelete(iv), disabled: !presetSaved(iv) }, { label: 'Init sound', action: () => presetInit(iv) },
      { sep: true }, fold, front, { sep: true }, tidyI];
  }
  if (kind === 'mod' && PC.PAD_ID.test(key)) { // ((8, §7.3) the body's own items — Edit pads, Grid…, Velocity…, Light, Fill from…, Clear, shape, Hardware…, Rename — then Fold · Delete
    const B = modBodies.get(key), own = B && B.kind === 'pads' ? B.menuItems() : [];
    return [...own, { sep: true }, fold, front, { sep: true }, { label: 'Delete', action: () => modDelete(key) }, { sep: true }, tidyI];
  }
  if (kind === 'mod') return [{ label: 'Delete', action: () => modDelete(key) }, { label: 'Modulation list…', action: () => modList() }, { sep: true }, fold, front, { sep: true }, tidyI];
  if (kind === 'pm') { const q = pmOf(t, key); return [...PATCH.items(t, q.dev, q.mid), { sep: true }, front, { sep: true }, tidyI]; } // ((9, §4.5) Duplicate, Driver ▸, Delete; no fold
  if (kind === 'part') { // ((3, §2.7) the panel's own module items — Init, Copy, Paste, Swap with ▸, Lock — then Remove ((WC) no Bundle: §6; the amp Envelope's Init: envFromAmp, rigEnvInit)
    const q = CMOD.partOf(key), own = sxViewItems(t, key).map(it => (q.part === 'env1' && /^Init\b/.test(it.label || '') && isRigDev(t, q.dev) ? Object.assign({}, it, { action: () => rigEnvInit(trk(), q.dev) }) : it));
    return [...own, ...(own.length ? [{ sep: true }] : []), { label: 'Remove', action: () => sxRemovePart(key) }, { sep: true }, fold, front, { sep: true }, tidyI];
  }
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
  if (what === 'pin' && CMOD.partOf(key)) return; // ((3) a part is never pinned: cvPinned)
  const t = trk(), p = cvLayPend && cvLayPend.key === key && cvLayPend.what === what ? cvLayPend : null;
  // ((3, review 1 F2) an automatic part place: a move / fold makes it the user's (the entry cv-module writes has no mark);
  // a front, pin or room write keeps it, as does a drop on the cell it left — no step, as before)
  const old = t.lay && typeof t.lay === 'object' ? t.lay[key] : null;
  if (old && old.auto) {
    const was = Object.assign({}, old);
    delete was.auto;
    if (!/^(move|group|fold)$/.test(what) || JSON.stringify(was) === JSON.stringify(entry)) entry = Object.assign({}, entry, { auto: 1 });
  }
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
  const m = curModel();
  aboutUI(m); drawAlgo();
  const title = $('#about-title').textContent || m.name, back = () => { if (cvParts.home) cvParts.home.append(a); };
  try { if (cvTray.sheet({ title, body: a, layer: $('#ov') || document.body, onClose: back })) return; } catch (err) { /* the SHELL lane's sheet not in yet */ }
  const wrap = h('div', 'cv-lite'), dlg = h('div', 'cv-lite-dlg'), x = h('button', 'cv-lite-x', '✕');
  dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-label', title);
  x.type = 'button'; x.setAttribute('aria-label', 'Close');
  const close = () => { wrap.remove(); back(); };
  x.onclick = close; wrap.onclick = e => { if (e.target === wrap) close(); };
  dlg.append(x, a); wrap.append(dlg); ($('#ov') || document.body).append(wrap);
}
/* ---------------------------------------------- cv MASTER (IMPL-M §5): the Master row (the track list's footer) and the master canvas */
// The master canvas is its own view with its own host (cvMasterHost — never cvHost: none of its callbacks reads trk()): two devices,
// the master FX rack (a panel device 'mfx', MAIN only) and the master OUT (master-ui's, OUT_W wide); Tidy = rack → OUT; its camera
// 'synth.cam.<uid>.master'. project.selTrack stays on the last track (the keyboard, MIDI and the roll play it: the chip reads
// "Master · keys play …"). cvMaster (session) is honoured by every path that would read or write trk() there (§5.2's list, §12
// "Lane A" the ones found beyond it): cvRender / renderViews sync this view and return, cvLay / cvTidy write project.master.lay (the
// same History steps), a drop or a Sources pick is refused with MASTER_SRC, the menus are the master's, no mod layer (no data-dev,
// no cable drag), no 900 Series cords, scopeSource is `an`; a track pick (row, dot, list, a reveal) leaves it
let cvMaster = false, mrow = null, mout = null, moutOff = null, mfxEl = null;
const mfxRec = { ui: null, fx: null, gen: 0, mon: null, gr: null, ftap: null };
const MASTER_SRC = 'The master takes effects — add them with the rack’s +';
const MOUT_PREF = 'synth.cv.mout'; // { target, mode }: the master OUT's loudness target and scope mode (device prefs, never in a project)
function moutPref() { const p = store.get(MOUT_PREF, null); return p && typeof p === 'object' ? p : {}; }
function moutSet(k, v) { store.set(MOUT_PREF, Object.assign({}, moutPref(), { [k]: v })); }
function mTarget() { const t = moutPref().target; return t === null ? null : MUI.TARGETS.includes(t) ? t : -14; } // (the OUT's target: the bounce's Loudness default too)
// the master canvas's record: a track-shaped view of project.master (live: lay / dev read through, so a write is seen at once)
const mLayOf = () => (project.master && project.master.lay && typeof project.master.lay === 'object' ? project.master.lay : null);
const M_WIRES = Object.freeze([Object.freeze({ id: 'mw', a: 'mfx.out', b: 'out.in' })]);
function masterRec() {
  return { id: MASTER, name: MASTER_NAME, color: MASTER_TINT, wires: M_WIRES,
    get dev() { return { mfx: { kind: 'panel', fx: masterFx() }, out: { kind: 'out' } }; }, get lay() { return mLayOf() || undefined; } };
}
function cvMasterHost() {
  return {
    root: cvParts.root, doc: document,
    devices: t => cvModule.devicesOf(t),
    bodies: { mount: mMount, unmount: mUnmount },
    title: key => (key === 'mfx' ? { title: 'Master FX', sub: (n => (n ? n + (n === 1 ? ' effect' : ' effects') : 'empty'))(masterN()) } : { title: 'Master OUT', sub: 'the mix · what a bounce writes' }),
    menu: key => mMenu(key),
    size: key => (key === 'out' ? { fixed: { w: MUI.OUT_W, h: MUI.OUT_H + cvModule.BAR_H } } : null),
    badge: () => null, patch: false,
    select: () => {}, lay: mLay,
    shown: () => monitors.sync(),
  };
}
// open / leave (the Master row's name or chevron, the track list's item; a track pick leaves: selectTrack)
function masterOpen() {
  if (!cvMaster) {
    PATCH.cancel(); PERF.release(); DRUM.release(); // (a cord drag, the beds and pads of the track shown let go — the keys still play it)
    if (modLayer) modLayer.close();
    cvMaster = true;
    if (mrow) mrow.setActive(true);
  }
  if ($('#tab-inst').hidden) openTab('canvas');
  renderViews();
  srcModeUI(shell.tiles ? shell.tiles.mode() : 'replace');
  tabTrackUI(); ptShow();
  monitors.sync();
}
function masterOff() {
  cvMaster = false;
  if (mrow) mrow.setActive(false);
  srcModeUI(shell.tiles ? shell.tiles.mode() : 'replace');
  return true;
}
function cvRenderMaster() {
  const key = project.uid + '/' + MASTER, W = cvW(), R = masterRec();
  if (cvView && cvViewKey === key) { cvView.sync(R); return; }
  if (cvMount) { cvMountEnd(false); const vp = $('#viewport'); if (vp) vp.removeAttribute('data-cv-mounting'); } // (a track's bodies still mounting: dropped)
  cvCamFlush(); // the outgoing view's camera first
  if (cvView) { try { cvView.destroy(); } finally { cvView = null; } }
  if (W && typeof W.clear === 'function') W.clear();
  cvViewKey = key;
  cvView = cvModule.createTrackView(W, R, cvMasterHost());
  modDrag = null; // (no mod cables on the master)
  cvCamRestore();
  monitors.sync();
}
// the bodies: the rack's own element (its FXRackUI — no data-dev: no mod layer, halo or cable on a master knob) and the OUT
function mMount(key, b) {
  if (key === 'out') {
    const P = moutPref();
    mout = MUI.createMasterOut(b, { doc: document, target: mTarget(), mode: MUI.MODES.includes(P.mode) ? P.mode : 'wave', read: mRead,
      onReset: () => postTo({ id: MASTER }, { t: 'mreset' }), onBypass: on => abSet(on), onMono: on => monoSet(on),
      onTarget: t => moutSet('target', t), onMode: m => moutSet('mode', m) });
    mout.setMono(mstate.mono); mout.setBypass(mstate.ab, mstate.ab ? mstate.g : undefined, mstate.lim);
    if (moutOff) moutOff();
    moutOff = monitors.sub(MASTER, 'meters', { live: () => mOutLive(), deliver: d => { if (mout) mout.update(d); } });
    return;
  }
  if (!mfxEl) { mfxEl = h('section', 'fxtab'); mfxEl.setAttribute('aria-label', 'Master effects rack'); }
  b.append(mfxEl);
  renderMasterFx();
}
function mUnmount(key) {
  if (key === 'out') { if (moutOff) { const f = moutOff; moutOff = null; f(); } if (mout) { mout.destroy(); mout = null; } return; }
  mfxDrop();
  if (mfxEl && typeof mfxEl.remove === 'function') mfxEl.remove();
}
const mOutLive = () => cvMaster && !!cvView && !!mout && !$('#tab-inst').hidden && cvView.live('out');
// the master OUT's scope data, pulled while it draws (master-ui read): `an` (wave / spectrum), O1's L / R analysers (image)
function mRead(mode, b) {
  if (!ctx || !an) return 0;
  if (mode === 'image') { if (!anL || !anR) return 0; anL.getFloatTimeDomainData(b.L); anR.getFloatTimeDomainData(b.R); }
  else if (mode === 'spectrum') an.getFloatFrequencyData(b.fd);
  else an.getFloatTimeDomainData(b.td);
  return ctx.sampleRate;
}
// (§2.2) the master rack's host: fxHost's form — racks 1 (MAIN), no Serum (state / edit / locked / extraRows absent), its tap → MASTER
function mfxHost() {
  return {
    fx: () => masterFx(),
    editFx: (fn, o) => masterEdit(fn, o),
    v2Fx: true, racks: () => 1, irs: smpHost, bpm: () => project.bpm,
    gr: () => mfxRec.gr, tap: () => mfxRec.ftap || null,
    setTap: inst => postTo({ id: MASTER }, { t: 'fxtap', id: typeof inst === 'string' ? inst : '' }),
    storage: hostStore, notify: txt => notice(txt, 3500),
    scSources: () => scSources(null), // ((SC §6.1) self null: its Ducker keys from any track; its compressor has no key input
  };
}
function renderMasterFx() {
  const box = mfxEl, rec = mfxRec, fx = masterFx();
  if (!box) return;
  if (rec.ui && rec.fx === fx) { rec.ui.refresh(); return; }
  mfxDrop();
  box.innerHTML = '';
  box.append(h('p', 'boot', 'Loading the FX rack…'));
  const gen = rec.gen;
  cvBuild(uiMods()).then(M => {
    if (gen !== rec.gen) return;
    box.innerHTML = '';
    try {
      rec.fx = fx;
      rec.ui = new M.fxui.FXRackUI(box, mfxHost(), { embedded: false, dsp: globalThis.FXDSP || null, racks: 1, v2Fx: true, cost: fxCost }); // (the "+" menu's estimates)
      rec.mon = monitors.sub(MASTER, 'mfx', { live: () => !!rec.ui && cvMaster && cvLive('mfx'), deliver: d => { rec.gr = d.gr || null; rec.ftap = d.ftap || null; } });
    } catch (err) {
      console.error(err);
      rec.ui = null;
      box.innerHTML = '';
      box.append(h('p', 'boot', 'The FX rack could not be shown (' + err.message + ').'));
    }
    monitors.sync();
  }, err => { if (gen === rec.gen) { box.innerHTML = ''; box.append(h('p', 'boot', 'The FX rack could not be loaded (' + err.message + ').')); } });
}
function mfxDrop() {
  const rec = mfxRec, u = rec.ui;
  rec.gen++; rec.ui = null; rec.fx = null; rec.gr = null; rec.ftap = null;
  if (u) { try { u.destroy(); } catch (err) { console.warn(err); } }
  if (rec.mon) { const off = rec.mon; rec.mon = null; off(); }
  monitors.sync();
}
// after a master edit: the modules' titles (its effects counted); the rack UI follows a project change (another master)
function masterRelabel() {
  if (!cvMaster || !cvView) return;
  cvView.refresh(masterRec());
  if (mfxRec.ui && mfxRec.fx !== masterFx()) renderMasterFx();
}
// the master canvas's ⋯ menus: Fold, Bring to front and Tidy on the rack, Fold on the OUT — neither can be removed or replaced
function mMenu(key) {
  const V = cvView, m = V && V.modules.get(key);
  if (!m || !cvMaster) return [];
  const fold = { label: m.fold ? 'Unfold' : 'Fold', action: () => V.toggleFold(key) };
  if (key === 'out') return [fold];
  return [fold, { label: 'Bring to front', action: () => V.front(key) }, { sep: true }, { label: 'Tidy the canvas', action: () => cvTidy() }];
}
// project.master.lay writes (the master view's host.lay): cvLay's rules — a move / fold one History step at its 'end', only when the
// layout really changes; a front / pin write no step
function mLay(key, entry, phase, what) {
  if (phase === 'start') {
    const m = cvView && cvView.modules.get(key);
    cvLayPend = { key, what, label: (what === 'fold' ? 'Fold ' : 'Move ') + (m ? m.title : key), was: JSON.stringify(mLayOf() || null) };
    return;
  }
  if (phase === 'cancel') { if (cvLayPend && cvLayPend.key === key) cvLayPend = null; return; }
  if (phase !== 'end' || !entry) return;
  const p = cvLayPend && cvLayPend.key === key && cvLayPend.what === what ? cvLayPend : null;
  if (p) {
    cvLayPend = null;
    if (JSON.stringify(Object.assign({}, mLayOf() || {}, { [key]: entry })) === p.was) return; // (nothing moved: no step, no write)
    hist.record(project, p.label); updateUndoUI();
  }
  if (!project.master || typeof project.master !== 'object') project.master = {};
  if (!mLayOf()) project.master.lay = {};
  project.master.lay[key] = entry;
  persist(); updateUndoUI();
}
function mTidy() {
  if (!cvView) return;
  const R = masterRec(), td = cvModule.tidy(R, cvView.sizes(), cvView.devices()), old = mLayOf() || {}, lay = {};
  for (const k in td) { const e = { x: td[k].x, y: td[k].y }; if (old[k] && old[k].fold) e.fold = 1; lay[k] = e; }
  if (mLayOf() && JSON.stringify(lay) === JSON.stringify(mLayOf())) { cvView.sync(R); return; }
  hist.record(project, 'Tidy'); updateUndoUI();
  if (!project.master || typeof project.master !== 'object') project.master = {};
  project.master.lay = lay;
  persist();
  cvView.sync(R);
}
// the master canvas's default camera: the rack and the OUT framed together from their top-left (never below READ_K)
function mCamRestore() {
  const W = cvW();
  if (!W || !cvView || typeof W.setCamera !== 'function') return;
  const key = CM.camKey(project.uid, MASTER), c = cvModule.camGet(store.get(cvModule.CAM_PREF, null), key);
  if (c) { cvCamDef = null; cvCamLast = { key, cam: c }; W.setCamera(c, { animate: false }); return; }
  const a = cvView.modules.get('mfx'), z = cvView.modules.get('out');
  if (!a || !z) return;
  const b = W.band();
  if ($('#tab-inst').hidden || !(b.right > b.left && b.bottom > b.top)) { cvCamDef = key; return; }
  cvCamDef = null;
  const o = W.toClient(0, 0), cam = W.cam, P = 24, r = a.rect(), q = z.rect(), bw = b.right - b.left - 2 * P, bh = b.bottom - b.top - 2 * P;
  const x0 = Math.min(r.x, q.x), y0 = Math.min(r.y, q.y), x1 = Math.max(r.x + r.w, q.x + q.w), y1 = Math.max(r.y + r.h, q.y + q.h);
  const k = Math.max(cvWorld.READ_K, Math.min(1, bw / Math.max(1, x1 - x0), bh / Math.max(1, y1 - y0)));
  const ox = o.x - cam.tx, oy = o.y - cam.ty, d = { k, tx: Math.round(b.left - ox + P - x0 * k), ty: Math.round(b.top - oy + P - y0 * k) };
  cvCamLast = { key, cam: d };
  W.setCamera(d, { animate: false });
}
// the effect hook's master form (the "+" menu's path through the rack UI is its editFx)
function mAddEffect(type) {
  let nid = null;
  masterEdit(fx => { nid = fxAddInst(fx, type); }, { seed: true });
  if (!nid) { notice('No room for another module here', 3500); return null; }
  if (mfxRec.ui) mfxRec.ui.refresh();
  notice(`Added ${fxName(type)} to the master`, 3500);
  return nid;
}
// the Master row (§5.1): built once into the footer; its meters subscribed while the rows show (topShow)
function initMasterRow() {
  const el = $('#mfoot');
  if (!el || mrow) return;
  mrow = MUI.createMasterRow(el, { doc: document, open: () => masterOpen(), onBypass: on => abSet(on), onMono: on => monoSet(on) });
  mrow.setBypass(mstate.ab, mstate.ab ? mstate.g : undefined, mstate.lim); mrow.setMono(mstate.mono); mrow.setActive(cvMaster);
  monitors.sub(MASTER, 'meters', { live: () => !!mrow && mrow.state().live, deliver: d => { if (mrow) mrow.update(d); } });
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
  if (cvMaster) { mCamRestore(); return; } // ((M) the master canvas's camera: synth.cam.<uid>.master
  const W = cvW();
  if (!W || !cvView || typeof W.setCamera !== 'function') return;
  const key = CM.camKey(project.uid, t.id), c = cvModule.camGet(store.get(cvModule.CAM_PREF, null), key);
  if (c) { cvCamDef = null; cvCamLast = { key, cam: c }; W.setCamera(c, { animate: false }); return; }
  const m = cvView.modules.get(curOf(t)), fk = fxKeyOf(t); // (R6: the current instrument and its FX module)
  if (!m) return;
  const b = W.band();
  if ($('#tab-inst').hidden || !(b.right > b.left && b.bottom > b.top)) { cvCamDef = key; return; } // (ROLL: a 0 × 0 viewport)
  cvCamDef = null;
  const o = W.toClient(0, 0), cam = W.cam, r = m.rect(), P = 24, bw = b.right - b.left - 2 * P, bh = b.bottom - b.top - 2 * P;
  if (isPatchDev(t, curOf(t))) { // ((9, §4.5) a 900 Series: its controller and its rack together, whole, never below READ_K; centred across the band —
    // taller than the band at READ_K (the iPad's landscape band under the keyboard tray, a desktop window): its TOP stays in view (the oscillator row, what one
    // patches first; review 2 F2, the lead's decision) and the controller is down the canvas — the same frame as the fit hook's (cvFitHook)
    let x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
    for (const [k, q] of cvView.modules) if (pmOf(t, k)) { const z = q.rect(); x0 = Math.min(x0, z.x); y0 = Math.min(y0, z.y); x1 = Math.max(x1, z.x + z.w); y1 = Math.max(y1, z.y + z.h); }
    const k = Math.max(cvWorld.READ_K, Math.min(1, bw / Math.max(1, x1 - x0), bh / Math.max(1, y1 - y0))), ox = o.x - cam.tx, oy = o.y - cam.ty;
    const d = { k, tx: Math.round(b.left - ox + P + Math.max(0, (bw - (x1 - x0) * k) / 2) - x0 * k), ty: Math.round(b.top - oy + P - y0 * k) };
    cvCamLast = { key, cam: d };
    W.setCamera(d, { animate: false });
    return;
  }
  // (U3) the left edge framed is the key-zone pill's (outside the instruments' left edge: Tidy stacks them at one x), so it
  // never sits under the rail; the instrument alone fits with it (its bar's ⋯ / ▾ stay inside the band)
  const x0 = r.x - Math.max(0, ...CMOD.instIds(t).map(id => { const q = cvView.modules.get(id); return q && Math.abs(q.x - r.x) < 1 ? q.zoneW || 0 : 0; }));
  const fm = fk && cvView.modules.get(fk), f = fm && fm.rect();
  // (1i, review 2 P2-1) an instrument with hardware keys also fits its height into the band (the keys are what one plays: a tall
  // face used to open with its bed under the fold); never below READ_K — below it the camera slides to the bed instead (d, below)
  const bed = cvBedBox(t), kH = bed ? bh / Math.max(1, r.h) : Infinity;
  const kAll = f ? Math.min(bw / Math.max(1, f.x + f.w - r.x), kH) : 0; // the instrument and the FX module side by side
  let k = kAll >= cvWorld.EDIT_K ? Math.min(1, kAll) : Math.max(cvWorld.READ_K, Math.min(1, bw / Math.max(1, r.x + r.w - x0), kH));
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
  if (bed) { // the instrument does not fit at READ_K: the least slide (up / left) that puts the whole bed inside the band, its top / left edge winning
    const L0 = ox + d.tx + (r.x + bed.x) * k, T0 = oy + d.ty + (r.y + cvModule.BAR_H + bed.y) * k;
    let sx = Math.min(0, b.right - P - (L0 + bed.w * k)), sy = Math.min(0, b.bottom - P - (T0 + bed.h * k));
    if (L0 + sx < b.left + P) sx = b.left + P - L0;
    if (T0 + sy < b.top + P) sy = b.top + P - T0;
    d.tx += Math.round(sx); d.ty += Math.round(sy);
  }
  cvCamLast = { key, cam: d }; // (the default is not stored until the user moves away from it)
  W.setCamera(d, { animate: false });
  if (isRigDev(t, curOf(t))) rigFrame(t, curOf(t), { def: true }); // ((WC, integration fixer L — review WC-int B3) a rig's default: the whole rig, once its faces are up (+ Track's starter, a track never shown)
}
// Serum panel ↔ its own FX module: both edit the same FX (and Serum state); an edit in one refreshes the other on the next
// frame (never the one that made it). A peer that is not showing its body is refreshed when it shows again
// (monitors.sync). Stage 1e: per Serum instrument (dev): bit 1 its panel, bit 2 its own FX module
let peerT = 0;
const peerQ = new Map(), peerStale = new Map(); // panel record → its module key
function peerRefresh(id, bit, dev) {
  if (!cvView) return;
  const t = project.tracks.find(x => x.id === id), d = dev || (t ? curOf(t) : null);
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
  // ((3) an edit that changed a Serum's parts — a preset load, a ⏻ in a panel, a MIDI program change — makes the modules again)
  cvRelT = requestAnimationFrame(() => { cvRelT = 0; if (!cvView || cvView.trackId !== trk().id) return; if (sxPartsSig(trk()) !== cvPartsSig) cvRender(); else { cvView.refresh(trk()); sxLabels(); } });
}
// a synth dropped anywhere on the canvas (stage 1f: one instrument per track again), ⋯ → Replace with… or a tap in the
// Sources tray's replace mode: replaces the instrument (v: its device view; default the current one = the primary) in
// place (SPEC §2.7), one History step, an undo notice
function cvDropInstrument(modelId, at, o = null, v0 = null) {
  if (cvMaster) { notice(MASTER_SRC, 4000); return true; } // ((M, §5.2) the master canvas holds no instrument: refused (handled — nothing replaced)
  const t = trk(), iv = v0 || curView(t), dev = dvOf(iv), m = MODELS.find(x => x.id === modelId);
  if (!m || m.id === iv.model) return false;
  const old = modelById(iv.model), id = t.id;
  const why = setTrackModel(iv, m.id, o); // (renderPanel → cvPanelDone: the FX module and the titles follow; why: its cables dropped, 2a)
  const nd = CMOD.instOf(trOf(iv), dev);
  if (!nd || nd.model !== m.id) return true; // ((P, §3.1) refused — a full track: setTrackModel said why; no Replace notice)
  // the step the replacement left on top of History (or the equal one it kept): the tap undoes it only while it is still
  // the newest — after a later step (a move, a knob, a note) the old instrument comes back as a step of its own instead,
  // never undoing that later edit (an undo / redo makes a new entry object: the safe branch too)
  const step = hist.u[hist.u.length - 1];
  // ((9b, IMPL-9b §4.6) a set tile's Replace names the set and adds its one-time notice — asked once the step is made)
  const S = o && o.set ? setOfId(o.set) : null, tail = S ? PATCH.setNote(o.set) : '';
  cvUndoNotice(`Replaced ${old.name} with ${m.name}${S ? ' (' + S.name + ')' : ''}${why ? ' · ' + why : ''}${tail ? ' — ' + tail : ''} · tap to undo`, step, () => {
    const tr = project.tracks.find(x => x.id === id), d = tr && CMOD.instOf(tr, dev);
    return d && d.model === m.id ? () => setTrackModel(instView(tr, dev), old.id) : null; // (null: already undone, or replaced again)
  });
  if (isRigModel(m)) rigFrame(t, dev); // ((WC, integration fixer L — review WC-int B3) the <NAME> tile's starter framed whole once its faces are up
  return true;
}
// a notice whose tap undoes `step` while it is the newest History step, else runs what alt() gives (null: nothing left)
function cvUndoNotice(msg, step, alt, ms = 8000) {
  noticeActs.set(msg, () => {
    noticeActs.delete(msg); notice('', 0);
    if (hist.u[hist.u.length - 1] === step) { undo(true); return; } // (the newest step: undo it — also when the path has no alternative)
    const f = alt();
    if (f) f();
  });
  notice(msg, ms);
}
function cvReveal(trackId, key = null) {
  if (project.tracks.some(t => t.id === trackId)) selectTrack(trackId);
  const roll = $('#tab-roll');
  if (roll && !roll.hidden) openTab('canvas');
  const W = cvW(), k = key || curOf(trk());
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
const RIG_TIDIED = 'Canvas tidied · tap to undo';
function cvTidy() {
  if (cvMaster) { mTidy(); return; } // ((M, §5.2) the master's lay, the same History step
  const t = trk();
  if (!cvView) return;
  const td = cvModule.tidy(t, cvView.sizes(), cvView.devices(), k => PATCH.rack(t, k), rigTidyOpts(t)), old = t.lay && typeof t.lay === 'object' ? t.lay : {}, lay = Object.assign({}, old); // ((9) a 900 Series' modules: its rack, §4.5; (WC) a rig's band, review 2 P2-5)
  const other = cvOtherFx;
  for (const k in td) {
    const e = { x: td[k].x, y: td[k].y }, ox = other(k), o = old[k] || (ox && old[ox]); // (the FX fold through a model change)
    if (o && o.fold) e.fold = 1;
    if (old[k] && (old[k].ui === 'flow' || old[k].ui === 'parts')) e.ui = old[k].ui; // (the instrument's layout choice stays: Tidy only moves modules, never a size; (3) a Serum's parts view too)
    if (old[k] && old[k].auto) e.auto = 1; // ((3) an automatic part place stays automatic: Tidy is the rule too)
    lay[k] = e;
    if (ox) delete lay[ox]; // one FX entry at most (cvLay)
  }
  // already tidy: no step (a recorded no-op would still drop the redo stack); cvModule.tidy is pure, so the step is
  // taken here, before the write. ((WC, integration fixer L — review WC-int P3-5) a rig's canvas: framed whole once laid, and its Tidy says
  // "· tap to undo" as every structural edit of a rig does)
  const rd = isRigDev(t, curOf(t)) ? curOf(t) : null;
  if (t.lay && typeof t.lay === 'object' && JSON.stringify(lay) === JSON.stringify(t.lay)) { cvView.sync(t); if (rd) rigFrame(t, rd, { all: true }); return; }
  hist.record(project, 'Tidy'); updateUndoUI();
  const step = hist.u[hist.u.length - 1];
  t.lay = lay;
  persist();
  cvView.sync(t);
  if (rd) { cvUndoNotice(RIG_TIDIED, step, () => null); rigFrame(t, rd, { all: true }); }
}

/* ---------------------------------------------- cv DEVICES (stage 1e, IMPL-1e §4.5; 1f: hooks; the effects' list and estimates) */
// Stage 1f (the user's iPad report: five hardware panels on one canvas lag): one instrument per track in the UI again. The
// engine graph, the model's editing API and per-device records stay (milestone 3); what is left here: the test hooks
// (__synthTest.cv add / power / zone: a host-level several-instrument track for the graph tests) and the effects' list and
// load estimates (the Effects tray that showed them is gone, 2026-10-22: they are the FX racks' "+" menus).
// After every edit of the track's devices: the patch (a graph shape: {t: 'graph'} + its parts), the view, the track rows
function cvAfter(t) {
  queuePatch(t);
  if (t === trk()) { bind(); renderNav(); }
  cvRender(); renderHeads(); persist(); updateUndoUI();
}
// the modules Tidy still places, pinned where they stand (a device added beside them must not re-tidy them: they would
// jump), as a copy of track.lay for the edit's step to write
// ((3) never a Serum part: its place is written before its module exists (sxPlaceNew); one without is a module a load just
// pruned (§3) that the next render drops — pinned, it would come back as the user's)
function cvPinned(t) {
  const lay = Object.assign({}, t.lay && typeof t.lay === 'object' ? t.lay : {});
  if (cvView && cvView.trackId === t.id) for (const [k, m] of cvView.modules) if (!lay[k] && !CMOD.partOf(k)) { const e = { x: Math.round(m.x), y: Math.round(m.y) }; if (m.fold) e.fold = 1; lay[k] = e; }
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
  const full = CMOD.devFull(t); // ((P, §3.1) addInst refuses at CMOD.DEV_MAX devices: said, before the step)
  if (full) { notice(full, 4000); return null; }
  const vals = loadVals(m), cap = COSTM.softCap(t, { kind: 'synth', model: m.id, vals }, { touch: touchDev, factor: devFactor() });
  if (cap.confirm && !confirm(cap.confirm)) return null;
  flush();
  hist.record(project, 'Add ' + m.name);
  const lay = cvPinned(t), ui = o && o.ui === 'flow' && isClassicModel(m) ? 'flow' : null;
  const id = CMOD.addInst(t, m.id, { vals, fx: isSxModel(m) ? newFx(m) : undefined });
  if (!id) { hist.prune(project); updateUndoUI(); return null; } // (refused after all: no step, nothing placed)
  if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) lay[id] = Object.assign({ x: cvDot(at.x), y: cvDot(at.y) }, ui ? { ui } : null);
  else if (ui) lay[id] = { x: 0, y: 0, ui };
  t.lay = lay;
  seedPend.add(t.id);
  sendPatch(t);
  if (m.id === 'tb303') seqSend(t, id);
  cvAfter(t);
  if (m.id === 'tr606') offer303(instView(t, id)); // ((7b §3.8) after its "Added" notice)
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
  ptDim(); // ((9, §4.3) a 900 Series' cords dim with its ⏻)
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
function cvBadge(key) {
  const t = trk(), d = t.dev && t.dev[key];
  // ((review 2, §2.2) an LFO's GLOBAL / PER NOTE — its MONO: a canvas LFO's record, a Serum's own LFO part's slot)
  const mode = on => ({ text: on ? 'GLOBAL' : 'PER NOTE', tone: 'mode' }), q = CMOD.partOf(key), ln = q && /^lfo(\d+)$/.exec(q.part);
  if (d && d.kind === 'lfo' && d.lfo && typeof d.lfo === 'object') return mode(!!d.lfo.mono);
  if (ln && isSxDev(t, q.dev)) { const L = (t.dev[q.dev].vals.s.lfo || [])[+ln[1] - 1]; return mode(!!(L && L.mono)); }
  if (!d || (d.kind !== 'synth' && d.kind !== 'panel')) return null;
  const m = modCount(t, key);
  return m ? m.text : capsOf(t, key);
}
// fx-ui's addMenuItems list — the rack's "+" menu: the 13 effects alphabetically, then the 3 splitters — read from
// serum-core's FXTYPES (the same list, before fx-ui loads with the first rack): the effects' names in notices
// ((2026-10-22) the Effects tray that showed them as tiles is gone; their load estimates are the "+" menu's: fxCost)
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
// an effect into a panel module (or a Serum's own FX; __synthTest cv.fx.addEffect — the Effects tray's tiles did it): the
// instance at the end of its Main rack as the rack's "+" menu adds it — an FX edit, so the knob-tweak policy holds (§11.8:
// FX rack edits are not History steps; its ⋯ removes it)
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
// an effect type's load estimate on this device (cv-cost × the measured factor): the FX racks' "+" menus (fx-ui opts.cost,
// read as a menu opens — so a measurement shows at once), '' for none
const fxCost = type => COSTM.label(COSTM.estimate(type, devFactor()));
// the Sources tiles' load labels on this device (cv-cost estimates × the measured factor; refreshed after a measurement)
function costLabels() {
  const f = devFactor();
  if (shell.tiles) for (const b of shell.tiles.tiles()) {
    const id = b.getAttribute('data-model'), txt = COSTM.label(COSTM.estimate(id, f));
    let c = [...(b.children || [])].find(x => x.className === 'cv-tcost');
    if (!c) { c = h('span', 'cv-tcost'); b.append(c); }
    if (c.textContent !== txt) c.textContent = txt;
    c.title = 'Estimated DSP load on this device: ' + txt;
  }
  if (shell.tiles && typeof shell.tiles.refreshMoog === 'function') shell.tiles.refreshMoog(); // ((9) the Moog module tiles' labels)
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

/* ---------------------------------------------- cv SERUM PARTS (milestone 3, IMPL-3 §2.1–2.7, lane D) */
// A rig in parts view (lay[iN].ui === 'parts'; (WC) it was a Serum's until Show parts went, IMPL-WC §6) is VOICE — its own module iN —
// plus one module per part ('iN/oscB' …: sx-edges partKeys, I1 / I2) and its own FX 'iN/fx'. Every part module's panel is a view of
// the device's one host (its record's SerumUI without the shell: sxViews), its ⏻ the panel's own power toggle in the bar's power slot
// (sxPowerEl), the panel's label drag on the bar's title (sxLabels), its ⋯ the panel's module items + Remove. The first layout lays the
// group out by Tidy's rule where the instrument's module stood (sxLayParts). Add / remove a part: one step whose meta {trackId, dev,
// part, on, f} writes the ⏻ back on undo / redo (sxBack); an internal cable edited on the canvas (sx-edges setEdge / cutEdge): one
// step, meta {trackId, dev, f}, the same write-back — the fields go through the host, so the panel undo has the edit as its own step.
// (WC, IMPL-WC §6) Show parts / Bundle and D-R5's "New Serums open as" are gone: the Serum is always the whole panel; this machinery is
// the rig's now (the rig's modules are these part views — lane H writes its first layout, rig-ui its faces)
let SXMOD = null, SXW = null; // the sx-ui-mod module once the panels loaded (mountPart), its PART_W (each part panel's width)
// ((WC, IMPL-WC §2.1) a rig is always its modules: no lay flag (a stored ui on one is ignored); a Serum never — the whole panel)
const sxParts = (t, dev) => isRigDev(t, dev);
// a part module's width by part kind (or 'voice'): (WC) its face's on the RIG grid (rig-ui); while the stage-3 views stand in (a
// loader without rig-ui: tests) its panel's width in the 1200 px bundled Serum (PART_W) on the dots
const sxPartW = kind => (RIGUI !== false ? rigW(kind) : SXW && SXW[kind] > 0 ? cvModule.roundW(SXW[kind]) : cvModule.PART_W_DEF[kind] || cvModule.W_MOD);
const sxPartH = kind => (RIGUI !== false ? rigHt(kind) : cvModule.PART_H_DEF[kind] || 256); // (Tidy's guess until measured)
// the canvas link rows reading Serum dev ('iN/lfo3.out': I2's `used`)
const sxUsed = (t, dev) => (Array.isArray(t.mods) ? t.mods.map(r => r && r.src).filter(x => typeof x === 'string' && x.startsWith(dev + '/')) : []);
const sxPartList = (t, dev) => { const d = t && t.dev ? t.dev[dev] : null; return d && d.vals && d.vals.s ? RC.partKeys(d.vals.s, t.lay, dev, sxUsed(t, dev), d.rig) : []; }; // ((WC) rig-core's: I1 / I2 + I1' + the amp slot
// the parts every Serum in parts view shows (cvRelabel: an edit that changes them makes the modules again)
let cvPartsSig = '';
const sxPartsSig = t => (t && t.dev ? sxIds(t).filter(d => sxParts(t, d)).map(d => d + ':' + sxPartList(t, d).join()).join(';') : '');
const sxHits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const sxAbove = part => /^(env|lfo|macros)$/.test(SE.kindOf(part) || ''); // (own ENV / LFO / MACROS stack upwards above VOICE)

/* ---- the host's views */
// the views of Serum dev's host follow its flag: bundled → the shell in the record's box (SerumUI buildShell); parts → no
// shell, VOICE in the box and each mounted part module's panel in its body (mountPart: bare, its PART_W width, shown while
// its module is live). Idempotent: a body mounting, the host built, every renderCustom (undo / redo / a load) call it
function sxViews(t, dev) {
  const rec = sxRecOf(t.id, dev), H = rec && rec.ui;
  if (!H || rec.trackId !== t.id || H.dead || !rec.views) return;
  const want = SXMOD && typeof H.dropShell === 'function' && sxParts(t, dev) ? 'parts' : 'bundled';
  if (rec.mode !== want) {
    if (want === 'parts') H.dropShell();
    else {
      for (const v of rec.views.values()) { try { v.V.destroy(); } catch (err) { console.warn(err); } }
      rec.views.clear();
      if (typeof H.buildShell === 'function' && rec.box) H.buildShell(rec.box);
    }
    rec.mode = want;
    cvRemeasure(t.id, dev);
    monitors.sync();
  }
  if (want !== 'parts') return;
  for (const [k, v] of rec.views) if (k !== dev && (cvMounted.get(k) || {}).el !== v.el) { try { v.V.destroy(); } catch (err) { console.warn(err); } rec.views.delete(k); }
  // ((WC, §8.2) a rig's modules are rig-ui's faces on the RIG grid (the Amplifier for VOICE); a part with no WC-1 face (the Arpeggiator, the
  // Clip sequencer: WC-2) and a loader without rig-ui (the stage-3 views stand in) keep stage 3's panel view
  let n = 0;
  const mount = (k, part, el) => {
    const kind = part === 'voice' ? 'amp' : SE.kindOf(part), rigF = !!RIGUI && !!RIGUI.FACE && !!RIGUI.FACE[kind];
    try {
      const V = rigF ? RIGUI.face(kind, el, { host: H, part, shown: () => cvLive(k), dev, n: RC.ordinalOf(t.dev[dev].rig, part) })
        : SXMOD.mountPart(H, part, el, { shown: () => cvLive(k), dev, opts: part === 'macros' ? { tiles: 'jack' } : undefined }); // ((§2.5) MACROS' name tiles: its jacks k1…k8)
      rec.views.set(k, { V, el, lab: null });
      n++;
    } catch (err) { console.error(err); }
  };
  if (!rec.views.has(dev) && rec.box) mount(dev, 'voice', rec.box);
  for (const [k, M] of cvMounted) { const q = CMOD.partOf(k); if (q && q.dev === dev && M.tid === t.id && !rec.views.has(k)) mount(k, q.part, M.el); }
  // ((WC, review 2 P1-1) faces just mounted — the first drop's (renderCustom's async build set the mode itself, so the branch above never
  // ran), a module added later —: their jack rows' anchors and knobs measured again, next frame (the cords' ends, the jacks pressable)
  if (n) cvRemeasure(t.id, dev);
}
// a part module went (removed, the view rebuilt, its Serum bundled): its view goes, the host stays
function sxPartGone(tid, key, el) {
  const q = CMOD.partOf(key), rec = sxRecOf(tid, q.dev), v = rec && rec.views ? rec.views.get(key) : null;
  if (v) { try { v.V.destroy(); } catch (err) { console.warn(err); } rec.views.delete(key); }
  const k = tid + '/' + key;
  if (cvEls.get(k) === el) cvEls.delete(k);
  if (el && typeof el.remove === 'function') el.remove();
}
const sxViewOf = (t, key) => { const q = CMOD.partOf(key), rec = sxRecOf(t.id, q ? q.dev : key), v = rec && rec.views ? rec.views.get(key) : null; return v ? v.V : null; };
// host.powerEl: a part's own ⏻ (View.power: a data-dest="x.on" control — the cable end, the drop target, its halo) for its bar
function sxPowerEl(key) { const V = sxViewOf(trk(), key); return V && V.power ? V.power : null; }
// the panel's own ⋯ items (a part's module menu: Init, Copy, Paste, Swap with ▸, Lock; VOICE's Preferences… / Info…)
function sxViewItems(t, key) { const V = sxViewOf(t, key); let L = []; try { L = V ? V.menuItems() : []; } catch (err) { L = []; } return Array.isArray(L) ? L : []; }
// the part modules' titles carry their panels' label drags (swap / copy onto a part of the kind, this Serum only)
function sxLabels() {
  const t = trk();
  if (!cvView || cvView.trackId !== t.id) return;
  for (const dev of sxIds(t)) {
    const rec = sxRecOf(t.id, dev);
    if (!rec || !rec.views || rec.mode !== 'parts') continue;
    for (const [k, v] of rec.views) {
      const m = k !== dev ? cvView.modules.get(k) : null, el = m && m.titleEl;
      if (!el || v.lab === el) continue;
      v.lab = el;
      try { v.V.labelDrag(el); } catch (err) { console.warn(err); }
    }
  }
}

/* ---- the rig's first layout */
// the lay of rig dev shown as its modules (a copy, the modules Tidy still places pinned where they stand): the flag on its
// entry; the first time (no part of it laid out yet) the group — the Amplifier (VOICE here), its parts, its own FX — by Tidy's rule
// (cv-module tidy: note tools → sources → filters → VOICE with its own ENV / LFO / MACROS above → own FX), its left edge where the
// instrument's module stood and VOICE on its row; the modules it now covers on the right make room (cv-module makeRoom).
// (WC) No caller here any more (Show parts was the one): lane H's drop / convert paths are
function sxLayParts(t, dev, extra) {
  const lay = cvPinned(t), V = cvView && cvView.trackId === t.id ? cvView : null, m = V ? V.modules.get(dev) : null;
  const e = Object.assign({}, lay[dev] || (m ? { x: Math.round(m.x), y: Math.round(m.y) } : { x: 0, y: 0 }));
  delete e.ui; // ((WC) a rig is always its modules: no flag
  lay[dev] = e;
  const parts = sxPartList(Object.assign({}, t, { lay }), dev);
  if (parts.some(p => lay[dev + '/' + p])) return lay; // (shown before: the stored places)
  if (extra && !parts.includes(extra)) { parts.push(extra); parts.sort((a, b) => SE.PARTS.indexOf(a) - SE.PARTS.indexOf(b)); } // (a part being added: in the group)
  const mid = t.dev[dev].model, wm = rigWm(t) || undefined, devs = [{ key: dev, kind: 'inst', model: mid, wires: wm }].concat(parts.map(p => ({ key: dev + '/' + p, kind: 'part', dev, part: p, model: mid, wires: wm })), [{ key: dev + '/fx', kind: 'fx', model: mid, own: dev }]);
  const fxM = V ? V.modules.get(dev + '/fx') : null, sz = {};
  for (const d of devs) sz[d.key] = { w: d.kind === 'fx' ? (fxM ? fxM.w : cvModule.W_FX) : sxPartW(d.kind === 'inst' ? 'voice' : SE.kindOf(d.part)) };
  if (wm) for (const d of devs) if (d.kind !== 'fx') sz[d.key].h = sxPartH(d.kind === 'inst' ? 'voice' : d.part); // ((WC, review 2 P2-5) the band sits by the faces' heights
  const td = cvModule.tidy(t, sz, devs, null, wm ? { targets: rigTargetsOf(t, dev, parts), narrow: cvNarrow(), past: rigPast(t, dev, parts) ? { [dev]: true } : {} } : undefined), x0 = Math.min(...devs.map(d => td[d.key].x)), ox = e.x - x0, oy = e.y - td[dev].y;
  const R = {}; // (the group's rects: Tidy's guessed heights)
  for (const d of devs) {
    const o = lay[d.key] || {}, n = { x: cvDot(td[d.key].x + ox), y: cvDot(td[d.key].y + oy) };
    if (d.key !== dev && o.fold) n.fold = 1;
    if (o.z != null) n.z = o.z;
    if (d.kind === 'part' && d.part !== extra) n.auto = 1; // (the rule's: automatic, sxPlaceNew; a part being added is the user's)
    lay[d.key] = d.key === dev ? Object.assign(e, n) : n;
    if (d.kind === 'part') sxFresh.add(t.id + '\n' + d.key);
    R[d.key] = { x: n.x, y: n.y, w: sz[d.key].w, h: d.kind === 'fx' ? (fxM ? fxM.rect().h : 420) : sxPartH(d.kind === 'inst' ? 'voice' : SE.kindOf(d.part)) };
  }
  if (V) { // the modules right of the group it now covers move right together (never left; a modulator never)
    const g = Object.values(R), box = { x: Math.min(...g.map(r => r.x)), y: Math.min(...g.map(r => r.y)) };
    box.w = Math.max(...g.map(r => r.x + r.w)) - box.x; box.h = Math.max(...g.map(r => r.y + r.h)) - box.y;
    const rects = { ' g': box };
    for (const [k, mm] of V.modules) if (!(k in R) && k !== dev && !k.startsWith(dev + '/') && mm.kind !== 'mod' && kindOfKey(t, k)) { const r = mm.rect(), le = lay[k]; rects[k] = le ? Object.assign({}, r, { x: le.x, y: le.y }) : r; }
    const mv = cvModule.makeRoom(rects, ' g');
    if (mv) for (const k of Object.keys(mv)) lay[k] = Object.assign({}, lay[k] || {}, { x: mv[k].x, y: mv[k].y });
  }
  sxSettleSoon();
  return lay;
}
// "Show OSC B" (a hidden destination's inspector): the part's module without powering it (a lay entry: dimmed while off, no
// sound change), one step
function sxShowPart(dev, part) {
  const t = trk(), k = dev + '/' + part;
  if (!sxParts(t, dev) || (cvView && cvView.modules.has(k))) { cvReveal(t.id, k); return false; }
  flush();
  hist.record(project, 'Show ' + rigLabel(t, dev, part));
  const lay = cvPinned(t);
  lay[k] = sxSpot(t, lay, dev, part);
  sxFresh.add(t.id + '\n' + k);
  t.lay = lay;
  persist(); cvRender(); updateUndoUI();
  cvReveal(t.id, k);
  return true;
}
// a model change of instrument dev (setTrackModel, inside its step): an old Serum-engine device's part places and its parts flag go
// (another Serum, a rig or a classic under the same id starts clean). (WC) A new Serum is always the whole panel — no D-R5 pref, no
// o.parts (§6); the rig's first layout (sxLayParts) is lane H's, from its drop paths
function sxModelLay(tr, dev) {
  if (tr.lay && typeof tr.lay === 'object') {
    let lay = null;
    for (const k of Object.keys(tr.lay)) { const q = CMOD.partOf(k); if (q && q.dev === dev) { lay = lay || Object.assign({}, tr.lay); delete lay[k]; } }
    if (tr.lay[dev] && tr.lay[dev].ui === 'parts') { lay = lay || Object.assign({}, tr.lay); lay[dev] = Object.assign({}, lay[dev]); delete lay[dev].ui; }
    if (lay) tr.lay = lay;
  }
}
// the flag goes (the part entries stay: "Make it a <rig name>" restores them); the whole panel opens at VOICE's place and what it
// covers makes room (cvRoom, the instrument's fixed width). (WC) No caller here any more (Bundle was the one): lane H's schema-16
// open of a Serum that was shown as parts (STEPS[15] dropped the flag) places it whole with this and cvRoom
function sxLayBundle(t, dev) {
  const lay = cvPinned(t), e = Object.assign({}, lay[dev] || { x: 0, y: 0 });
  delete e.ui;
  lay[dev] = e;
  return lay;
}
// a part's place by Tidy's rule beside its Serum as it stands (lay: the copy being written, the modules Tidy still placed
// pinned in it): its column — note tools · sources · filters (left to right, then VOICE), or the own ENV / LFO / MACROS stack
// above VOICE — under (the stack: above) the column's last member; a column of its own goes between its neighbours on
// VOICE's row, what stands right of it (VOICE, its stack, its own FX, panels, OUT; never a modulator) moving right to make
// room; then clear of every module there (below what it covers; the stack: above)
const SX_COL = { arp: 0, clip: 0, osc: 1, sub: 1, noise: 1, filter: 2 };
function sxSpot(t, lay, dev, part) {
  const V = cvView && cvView.trackId === t.id ? cvView : null, k = dev + '/' + part, D = cvWorld.DOT, G = cvModule.VGAP, GAP = cvModule.GAP;
  const kind = SE.kindOf(part), w = V && V.modules.has(k) ? V.modules.get(k).w : sxPartW(kind), h0 = sxPartH(kind), up = sxAbove(part);
  const okE = e => !!e && Number.isFinite(e.x) && Number.isFinite(e.y);
  const rectOf = q => { // a module's rect at its place in `lay` (a part laid out but not yet a module: its guessed size)
    const m = V ? V.modules.get(q) : null, e = lay[q], z = CMOD.partOf(q);
    if (!okE(e) && !m) return null;
    const r = m ? m.rect() : { x: e.x, y: e.y, w: z ? sxPartW(SE.kindOf(z.part)) : cvModule.W_FX, h: z ? sxPartH(SE.kindOf(z.part)) : 420 };
    return { x: okE(e) ? e.x : r.x, y: okE(e) ? e.y : r.y, w: r.w, h: r.h > cvModule.BAR_H ? r.h : z ? sxPartH(SE.kindOf(z.part)) : r.h };
  };
  const v = rectOf(dev) || { x: 0, y: 0, w: sxPartW('voice'), h: sxPartH('voice') };
  const mine = Object.keys(lay).filter(q => { const z = CMOD.partOf(q); return !!z && z.dev === dev && q !== k && okE(lay[q]); })
    .map(q => ({ q, part: CMOD.partOf(q).part, r: rectOf(q) })).filter(x => x.r);
  const colOf = p => (sxAbove(p) ? -1 : SX_COL[SE.kindOf(p)] != null ? SX_COL[SE.kindOf(p)] : 1);
  const r = { x: v.x, y: v.y, w, h: h0 };
  if (isRigDev(t, dev) && rigWm(t)) return rigSpot(t, lay, dev, part, { k, w, h0, v, mine, rectOf, colOf, V });
  if (up) { // the stack above VOICE: on top of its highest member
    const st = mine.filter(x => sxAbove(x.part));
    r.x = st.length ? Math.min(...st.map(x => x.r.x)) : v.x;
    r.y = Math.floor(((st.length ? Math.min(...st.map(x => x.r.y)) : v.y) - G - h0) / D) * D;
  } else {
    const c = colOf(part), col = mine.filter(x => colOf(x.part) === c);
    if (col.length) { r.x = Math.min(...col.map(x => x.r.x)); r.y = Math.ceil(Math.max(...col.map(x => x.r.y + x.r.h + G)) / D) * D; }
    else { // a column of its own, between its neighbours, on VOICE's row
      const left = mine.filter(x => colOf(x.part) >= 0 && colOf(x.part) < c), right = mine.filter(x => colOf(x.part) > c);
      const nextX = right.length ? Math.min(...right.map(x => x.r.x)) : v.x, prevR = left.length ? Math.max(...left.map(x => x.r.x + x.r.w)) : null;
      r.x = Math.floor((nextX - GAP - w) / D) * D;
      r.y = v.y;
      if (prevR !== null && r.x < prevR + GAP) { // no room: what stands at or right of nextX moves right by the difference
        const x1 = Math.ceil((prevR + GAP) / D) * D, d = x1 - r.x;
        r.x = x1;
        for (const q of new Set(Object.keys(lay).concat(V ? [...V.modules.keys()] : []))) {
          const m = V ? V.modules.get(q) : null;
          if (q === k || (m && m.kind === 'mod') || cvModule.modKind(q)) continue;
          const z = rectOf(q);
          if (z && z.x >= nextX) lay[q] = Object.assign({}, lay[q] || {}, { x: z.x + d, y: z.y });
        }
      }
    }
  }
  // clear of the modules there (a bundled Serum's own rect is the whole panel's: left out), its own laid parts included
  const R = [];
  for (const q of new Set(Object.keys(lay).concat(V ? [...V.modules.keys()] : []))) { if (q === k || (q === dev && !sxParts(t, dev))) continue; const z = rectOf(q); if (z) R.push(z); }
  for (let i = 0; i < 32; i++) {
    const o = R.find(q => sxHits(r, q));
    if (!o) break;
    r.y = up ? Math.floor((o.y - G - r.h) / D) * D : Math.ceil((o.y + o.h + G) / D) * D;
  }
  return { x: r.x, y: r.y };
}
// (WC, review 2 P2-5 — the user's rule) a rig module's place when it comes (a tap, a part shown with no place): Tidy's rule (cv-module
// rigLay), never moving a module that stands (only Tidy does) — a modulator in the band over the chain (its bottom VGAP + a grid row over
// the Amplifier's top), at the free spot nearest the centre of what it drives (rigTargetsOf: Envelope 1 the Amplifier), BAND_GAP from its
// neighbours; with no target yet at the band's left end (left of the rig's modules), until a Tidy finds it one; a chain module (a source, a
// Filter, the note tools) in the row at its slot after its left neighbour when the gap to the right one holds it, else under that
// neighbour (the next Tidy puts it in the row); then clear of what stands (below it; the band: further left)
function rigSpot(t, lay, dev, part, o) {
  const { k, w, h0, v, mine, rectOf, colOf, V } = o, D = cvWorld.DOT, G = cvModule.VGAP, BG = cvModule.BAND_GAP, GAP = cvModule.GAP;
  const all = [...new Set(Object.keys(lay).concat(V ? [...V.modules.keys()] : []))].filter(q => q !== k).map(rectOf).filter(Boolean);
  const hits = z => all.some(q => sxHits(z, q));
  const r = { x: v.x, y: v.y, w, h: h0 };
  if (sxAbove(part)) {
    r.y = Math.floor((v.y - G - D - h0) / D) * D;
    const pad = x0 => ({ x: x0 - BG + 1, y: r.y, w: w + 2 * BG - 2, h: h0 }); // (BAND_GAP clear on both sides)
    const tg = (rigTargetsOf(t, dev, sxPartList(t, dev).concat([part]))[k] || []).filter(q => !sxAbove((CMOD.partOf(q) || {}).part || '')).map(q => { const z = rectOf(q); return z && Object.assign({ key: q }, z); }).filter(Boolean);
    if (tg.length) {
      const t0 = tg.sort((a, b) => a.x - b.x)[0], c = part === 'env1' && t0.key === dev ? cvModule.ampEnvCentre(t0.x, t0.w, w) : t0.x + t0.w / 2, C = [Math.round((c - w / 2) / D) * D]; // ((integration fixer L, P3-3) Envelope 1 on the amp slot: its OUT beside the Amplifier, as Tidy's
      for (const q of all) C.push(Math.ceil((q.x + q.w + BG) / D) * D, Math.floor((q.x - BG - w) / D) * D);
      const ok = C.filter(x0 => !hits(pad(x0))).sort((a, b) => Math.abs(a + w / 2 - c) - Math.abs(b + w / 2 - c) || a - b);
      if (ok.length) { r.x = ok[0]; return { x: r.x, y: r.y }; }
    }
    const left = Math.min(v.x, ...mine.map(x => x.r.x));
    r.x = Math.floor((left - BG - w) / D) * D;
    for (let i = 0; i < 64 && hits(pad(r.x)); i++) r.x -= D; // (a canvas module there: further left)
    return { x: r.x, y: r.y };
  }
  const c = colOf(part), ord = x => [colOf(x.part), SE.PARTS.indexOf(x.part)], before = x => { const a = ord(x), b = [c, SE.PARTS.indexOf(part)]; return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]); };
  const row = mine.filter(x => colOf(x.part) >= 0 && Math.abs(x.r.y - v.y) < D), prev = row.filter(before).sort((a, b) => b.r.x - a.r.x)[0] || null;
  const next = row.filter(x => !before(x)).sort((a, b) => a.r.x - b.r.x)[0] || { r: v };
  r.x = prev ? Math.ceil((prev.r.x + prev.r.w + GAP) / D) * D : Math.floor((next.r.x - GAP - w) / D) * D;
  if (prev && r.x + w + GAP > next.r.x) { r.x = prev.r.x; r.y = Math.ceil((prev.r.y + prev.r.h + G + D) / D) * D; } // (no room in the row: under its left neighbour)
  for (let i = 0; i < 32; i++) { const q = all.find(z => sxHits(r, z)); if (!q) break; r.y = Math.ceil((q.y + q.h + G) / D) * D; }
  return { x: r.x, y: r.y };
}
// (review 2 P2) a part dropped at p (the tray): clear of what it would cover, its guessed size — (integration fixer L, review WC-int B2) at the
// nearest free spot up or down (a modulator dropped over the Effects panel's foot used to go up past the whole panel, off screen); a tie: the
// old way (the stack above VOICE: up, the rest down)
function sxDropClear(t, dev, part, p) {
  const k = dev + '/' + part, V = cvView && cvView.trackId === t.id ? cvView : null, D = cvWorld.DOT, G = cvModule.VGAP, up = sxAbove(part), kind = SE.kindOf(part);
  if (!V) return p;
  const R = Object.entries(V.rects()).filter(([q, z]) => q !== k && z && !(q === dev && !sxParts(t, dev))).map(([, z]) => z);
  const r = { x: p.x, y: p.y, w: V.modules.has(k) ? V.modules.get(k).w : sxPartW(kind), h: sxPartH(kind) };
  const clear = u => {
    const q = Object.assign({}, r);
    for (let i = 0; i < 32; i++) {
      const o = R.find(z => sxHits(q, z));
      if (!o) return q;
      q.y = u ? Math.floor((o.y - G - q.h) / D) * D : Math.ceil((o.y + o.h + G) / D) * D;
    }
    return null;
  };
  if (!R.some(z => sxHits(r, z))) return { x: r.x, y: r.y };
  const a = clear(up), b = clear(!up), q = !b || (a && Math.abs(a.y - r.y) <= Math.abs(b.y - r.y)) ? a || r : b;
  return { x: q.x, y: q.y };
}
// (I1) a part shown without a place (on after a preset load, a ⏻ in the bundled panel …) gets one by sxSpot, no History step
// (a view normalisation, as cvRoom's)
// The places the rule writes (here, and the first layout's group) are automatic (auto: 1, kept by song.normLay, Tidy and
// the no-step moves): a load prunes the ones whose part it left neither on nor read (sxPruneAuto), so browsing presets never
// piles modules up; a user act on the module (a move, a fold, Add, the tray, Show OSC C) makes the place the user's — never
// pruned (§3's amendment, review 1 F2: the lead's rule)
function sxPlaceNew(t) {
  if (!t || !t.dev) return false;
  let lay = null;
  for (const dev of sxIds(t)) {
    if (!sxParts(t, dev)) continue;
    const L0 = lay || t.lay || {}, list = sxPartList(t, dev);
    if (list.length && !list.some(p => L0[dev + '/' + p])) { // ((WC) a rig none of whose modules has a place yet (+ Track, a load): Tidy's group
      t.lay = lay || t.lay; lay = sxLayParts(t, dev);
      continue;
    }
    for (const p of list) {
      const k = dev + '/' + p;
      if ((lay || t.lay)[k]) continue;
      lay = lay || cvPinned(t);
      lay[k] = Object.assign(sxSpot(t, lay, dev, p), { auto: 1 });
      sxFresh.add(t.id + '\n' + k);
    }
  }
  if (!lay) return false;
  t.lay = lay;
  persist();
  return true;
}
// a load of Serum dev (a preset, a program change; a seeded panel edit — Init Preset, Hybridize, the panel's undo / redo of
// one): its automatic part places whose part is now neither on (I1) nor read (I2) go, in bundled view too (the next Show
// parts would show them), no History step (a view normalisation, as sxPlaceNew's). History's undo / redo bring their own lay
function sxPruneAuto(t, dev) {
  if (!t || !t.lay || typeof t.lay !== 'object' || !isSxDev(t, dev)) return false;
  const want = new Set(isRigDev(t, dev) ? RC.partKeys(t.dev[dev].vals.s, null, dev, sxUsed(t, dev), t.dev[dev].rig) : SE.partKeys(t.dev[dev].vals.s, null, dev, sxUsed(t, dev)));
  let lay = null;
  for (const k of Object.keys(t.lay)) {
    const q = CMOD.partOf(k), e = t.lay[k];
    if (!q || q.dev !== dev || !e || !e.auto || want.has(q.part)) continue;
    lay = lay || Object.assign({}, t.lay);
    delete lay[k];
  }
  if (!lay) return false;
  t.lay = lay;
  persist();
  return true;
}
// part places written by a rule (the first layout, a tap, I1) used Tidy's height guesses: once the panels are laid out (the next
// frame) a part that covers another module moves on below it (above: the upward stack) — no History step
const sxFresh = new Set(), sxTries = new Map(); // 'trackId\nkey'; the frames it waited for its panel
let sxSetT = 0;
function sxSettleSoon() { if (!sxSetT && sxFresh.size && typeof requestAnimationFrame === 'function') sxSetT = requestAnimationFrame(sxSettle); }
// its panel is up (a part's view mounted; a Serum-faithful modulator's slot host built — its modules load on the first): its
// height is the real one
function sxReady(t, k) {
  if (CMOD.partOf(k)) return !!sxViewOf(t, k);
  const B = modBodies.get(k);
  return !B || typeof B.host !== 'function' || !!B.host();
}
// (review 2 P2) the batch settles together once every member's panel is up (or after 120 frames), top to bottom (the stack
// above VOICE: bottom to top), each clear of what stands and of the members settled before it — never of one still to come —
// so a column keeps its order (OSC A · B · C, FILTER 1 · 2) whatever Tidy's guessed heights were (a member that covered the
// next one used to move below it)
function sxSettle() {
  sxSetT = 0;
  const t = trk();
  if (!cvView || cvView.trackId !== t.id || !t.lay) { sxFresh.clear(); sxTries.clear(); return; }
  const R = cvView.rects(), D = cvWorld.DOT, G = cvModule.VGAP, keyOf = fk => fk.slice(fk.indexOf('\n') + 1);
  const mine = [...sxFresh].filter(fk => fk.slice(0, fk.indexOf('\n')) === t.id);
  let wait = false;
  for (const fk of mine) { const k = keyOf(fk); if (R[k] && !sxReady(t, k) && (sxTries.get(fk) || 0) < 120) { sxTries.set(fk, (sxTries.get(fk) || 0) + 1); wait = true; } } // (not built yet: a frame later)
  for (const fk of [...sxFresh]) if (!mine.includes(fk)) { sxFresh.delete(fk); sxTries.delete(fk); } // (another track's)
  if (wait) { sxSettleSoon(); return; }
  for (const fk of mine) { sxFresh.delete(fk); sxTries.delete(fk); }
  const upOf = k => { const q = CMOD.partOf(k); return !!q && sxAbove(q.part); };
  const keys = [...new Set(mine.map(keyOf))].filter(k => R[k] && t.lay[k]), todo = new Set(keys);
  const order = keys.filter(k => !upOf(k)).sort((a, b) => R[a].y - R[b].y || R[a].x - R[b].x).concat(keys.filter(upOf).sort((a, b) => R[b].y - R[a].y || R[a].x - R[b].x));
  let moved = false;
  for (const k of order) {
    todo.delete(k);
    const up = upOf(k), r = Object.assign({}, R[k]);
    for (let n = 0; n < 32; n++) {
      const o = Object.keys(R).find(z => z !== k && !todo.has(z) && sxHits(r, R[z]));
      if (!o) break;
      r.y = up ? Math.floor((R[o].y - G - r.h) / D) * D : Math.ceil((R[o].y + R[o].h + G) / D) * D;
    }
    if (r.y !== R[k].y) { t.lay = Object.assign({}, t.lay, { [k]: Object.assign({}, t.lay[k], { y: r.y }) }); R[k] = r; moved = true; }
  }
  if (moved) { persist(); cvView.sync(t); }
}

/* ---- the S0 notice (IMPL-3 §9.9) */
// touch devices only. The iPad session (bench.json "ui-m3") passed sx1 — one whole-panel Serum, 1866 painted elements — and failed
// a Serum fully opened in parts with its modulators (3176; (WC) the parts are the rig's now): once per session, at rest after Add
// part / a tray drop / a load (cvRender), a track with a rig in parts whose painted elements pass that says so. No History step; nothing while the
// camera moves, a mounting runs, or over another timed notice ("Added … · tap to undo" keeps its tap); counted once per module set
const SX_HEAVY = 1866, SX_HEAVY_MS = 600, SX_HEAVY_TXT = `This many ${RIG.NAME} modules may stutter when zooming on this device.`; // ((WC) the rig's text: no Bundle to put it back together)
let sxHeavyT = 0, sxHeavySig = '', sxHeavyDone = false;
// (9, IMPL-9 §4.7) a 900 Series' modules the same way, its own words, once. (9b review 2 F6) in the unit of what is PAINTED: the S0
// rule's boxed elements without the GL faces' hidden SVGs (sxPainted skipFaces — a texture is free to paint, and those SVGs were
// ≈ 2/3 of a System 55's 4 710, so the old line 4 802 sat one module above it: a cliff of face-SVG weight, never of paint cost; a
// face on the SVG path — ?nogl's tier, a base pending — counts its SVG, and that path IS the heavier one). Measured in headless
// Chrome 155 (1366 × 1024 touch, 2×, `scratchpad/9b/fr2b/m1-count.mjs`, `m3-rack.mjs`): the real System 55's live layer 1 575
// elements (the 960 alone ≈ 181 + its SVG; the 38 GL faces 69 MB), + a 921B 1 679, + a 902 1 653, + a second 960 2 176; a full
// 48-module rack (the System 55 + the Sequencer Complement's kind: 2 × 960, 961, 2 × 962, 994, 2 × 911, 2 × 902, 995) 2 236 with
// every face a texture (3 746 while its 11 added modules are off screen, faces unmounted on their SVGs), the System 55 on ?nogl
// 4 748. The line is 1.3 × the System 55's 1 575 = 2 047.5: quiet at the System 55 and a few modules, the notice from a second 960
// on; the consolidated iPad pass re-decides (the user's iPad ran stage 9's m30 P+ at 4 423 in the old unit: "ui-m9")
const PT_HEAVY = 2048, PT_HEAVY_TXT = 'This many modules may stutter when zooming on this device.';
let ptHeavyDone = false;
const heavyOf = t => (sxIds(t).some(d => sxParts(t, d)) ? (sxHeavyDone ? null : 'sx') : patchDevs(t).length && !ptHeavyDone ? 'pt' : null);
// ui-bench-m3's rule: an element with a layout box (a folded module's body, a hidden page have none: skipped whole). skipFaces
// ((9b, review 2 F6) the 900 Series' unit): not the SVG of a face that is a GL texture (module data-cv-face="gl", its `.hw-decor > svg`
// visibility: hidden — cv-face setMode): the picture is a texture, free to paint, yet ≈ 2/3 of a System 55's boxed elements. A face
// on the SVG path (data-cv-face "svg" — the base pending — or "dom": ?nogl, an overlap, the 1g tier's bitmap) counts its SVG
const sxPainted = (el, skipFaces) => {
  if (!el.getClientRects().length) return 0;
  if (skipFaces && el.style && el.style.visibility === 'hidden' && el.parentNode && el.parentNode.classList && el.parentNode.classList.contains('hw-decor')) return 0;
  let n = 1;
  for (const c of el.children) n += sxPainted(c, skipFaces);
  return n;
};
function sxHeavyCount(skipFaces) { let n = 0; if (cvView) for (const m of cvView.modules.values()) if (m.el) n += sxPainted(m.el, skipFaces === true && m.el.getAttribute('data-cv-face') === 'gl'); return n; }
const sxHeavySigOf = t => t.id + ':' + (cvView ? [...cvView.modules.keys()].join() : '');
function sxHeavySoon() {
  const t = trk();
  if (sxHeavyT || !touchDev || !cvView || cvView.trackId !== t.id || sxHeavySigOf(t) === sxHeavySig || !heavyOf(t)) return;
  sxHeavyT = setTimeout(sxHeavyRun, SX_HEAVY_MS);
}
function sxHeavyRun() {
  sxHeavyT = 0;
  const t = trk(), W = cvW(), k = heavyOf(t);
  if (!k || !touchDev || !cvOn() || !cvView || cvView.trackId !== t.id) return;
  if ((W && W.busy) || cvMount || cvHold || noticeT) { sxHeavyT = setTimeout(sxHeavyRun, SX_HEAVY_MS); return; } // (not at rest: again)
  sxHeavySig = sxHeavySigOf(t);
  let n = 0;
  try { n = sxHeavyCount(k === 'pt'); } catch (err) { console.warn(err); }
  if (n <= (k === 'pt' ? PT_HEAVY : SX_HEAVY)) return;
  if (k === 'pt') { ptHeavyDone = true; notice(PT_HEAVY_TXT, 9000); return; }
  sxHeavyDone = true;
  notice(SX_HEAVY_TXT, 9000);
}

/* ---- adding and removing parts (§2.4, §2.6) */
// ((WC) the tiles' kinds and their drag labels: rig-core MODULES' names; a kind's refusal when it has no free slot: rig-core WORDS.full —
// "This <NAME> already has 3 oscillators" (Q3: one instrument per track))
const SX_KIND = Object.fromEntries(Object.keys(RC.MODULES).map(k => [k, RC.MODULES[k].label]));
const sxFullWhy = kind => RC.WORDS.full(kind);
// the rows reading an own ENV / LFO slot (the Serum's matrix: src or aux, rows with a destination — sx-edges slotsUsed's rule;
// the canvas link rows from it) or the macros
function sxReads(t, dev, part) {
  const s = t.dev[dev].vals.s, M = Array.isArray(s.matrix) ? s.matrix : [];
  const mine = part === 'macros' ? x => /^macro[1-8]$/.test(x || '') : x => x === part || x === part + 'y';
  return M.filter(r => r && r.dst && (mine(r.src) || mine(r.aux))).length + (Array.isArray(t.mods) ? t.mods.filter(r => r && r.src === dev + '/' + part + '.out').length : 0);
}
// a part of `kind` (osc / sub / noise / filter / env / lfo / macros / arp / clip; part0 a given slot) onto rig dev — (WC) rigAdd: the
// first free slot (sx-edges firstFree; an Envelope the amp slot's rule), powered on with its kept settings, auto-plugged (rig-core
// AUTOPLUG), laid at `at` (a drop) or by sxSpot (a tap); one History step "Add Oscillator 2" (o.step false: the caller's), meta {trackId,
// dev, part, on, f}; full: the count said, no step. → the part | null
function sxAddPart(dev, kind, at, part0, o) { return rigAdd(dev, kind, at, part0, o); } // ((WC) the rig's rules: rigAdd (its auto-plug, the amp slot, the ordinals)
// ⋯ → Remove — (WC) rigRemove: ⏻ off and its lay entry gone, one step (meta as an add's); an own Envelope / LFO / Macros something
// reads stays ("LFO 3 modulates 2 knobs": its ⋯ → Remove All Destinations first)
function sxRemovePart(key) { return rigRemove(key); } // ((WC) the rig's rules: rigRemove (the amp Envelope's cord first, a Filter's sources re-plugged)
// field writes [[path, before, after] …] (sx-edges' f) onto Serum dev's state through its host when one is up (the panel's
// own undo step, its repaint, the patch), else as a host edit would (sxEdit)
function sxApply(t, dev, f, label) {
  const rec = sxRecOf(t.id, dev), fn = s => { for (const x of f) sxFieldSet(s, x[0], x[2]); };
  if (rec && rec.ui && rec.trackId === t.id && !rec.ui.dead) rec.ui.edit(fn, { label });
  else { sxEdit(instView(t, dev), fn); peerRefresh(t.id, 2, dev); }
}
// a field of a Serum state as sx-edges reads it: ['p', id] its base value; a route its value, else sx-ui-mix's default (OSC A
// Filter, the rest Main); anything else the value at its path
function sxField(s, path) {
  if (path[0] === 'p') return core.destBase(s, null, path[1]);
  let o = s;
  for (const k of path) { if (o == null || typeof o !== 'object') { o = undefined; break; } o = o[k]; }
  if (path[path.length - 1] === 'route') return typeof o === 'number' && Number.isFinite(o) ? clamp(Math.round(o), 0, 3) : path[0] === 'osc' && path[1] === 0 ? 0 : 1;
  return o;
}
function sxFieldSet(s, path, v) {
  if (path[0] === 'p') { s.p[path[1]] = v; return; }
  let o = s;
  for (let i = 0; i < path.length - 1; i++) { if (o[path[i]] == null || typeof o[path[i]] !== 'object') o[path[i]] = {}; o = o[path[i]]; }
  o[path[path.length - 1]] = v;
}
const sxSame = (a, b) => a === b || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9) || (!!a && !!b && typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b)); // ((WC) a leaf rig-core diff wrote whole (an array whose length changed)
// undo / redo of a step carrying Serum field writes (meta.f: a canvas cable edit, a part added / removed): History restores
// the layout; the fields — the Serum's, kept by keepDevs as knob tweaks are — are written back here: undo the before-values
// while every field still holds its after-value, redo the after-values while every one holds its before-value; else they
// stay as they are and a notice says so (a panel edit since: the Serum's own). Read after hist.undo / hist.redo
// A step whose fields were already put back inside the Serum (its panel undo / redo) is a no-op to History: it is still the
// step its ↶ / ↷ names and takes (History never skips a meta step: song.js), alone, and says so (review 1 F3)
let sxBack = null; // { mv: the step's meta, redo, label, noop: the step changed nothing History holds }
const sxBackOf = (e, redo) => (e && e.meta && Array.isArray(e.meta.f) && e.meta.dev ? { mv: e.meta, redo, label: e.label, noop: !!hist.noop } : null);
function sxBackApply(p, { mv, redo, label, noop }) {
  const t = p.tracks.find(x => x.id === mv.trackId), d = t && t.dev ? t.dev[mv.dev] : null, s = d && d.kind === 'synth' && isSxRec(d) && d.vals ? d.vals.s : null;
  if (!s) return;
  const to = redo ? 2 : 1, from = redo ? 1 : 2;
  if (mv.f.every(x => sxSame(sxField(s, x[0]), x[to]))) { // (already so)
    if (noop) notice(`${label || 'That step'} was already ${redo ? 'redone' : 'undone'} in ${cvDevName(t, mv.dev)}`, 4000);
    return;
  }
  if (!mv.f.every(x => sxSame(sxField(s, x[0]), x[from]))) { notice(`${cvDevName(t, mv.dev)} changed since: ${mv.part ? rigLabel(t, mv.dev, mv.part) + '’s settings' : Array.isArray(mv.parts) ? 'the power of ' + andList(mv.parts.map(p => rigLabel(t, mv.dev, p))) : 'its connections'} left as it is`, 5000); return; } // ((2026-10-23) parts: a Delete-key press's parts, histFold; (WC) the rig's names
  for (const x of mv.f) sxFieldSet(s, x[0], x[to]);
  sxDirty.add(t.id + '/' + mv.dev);
}

// (9, IMPL-9 §1.5) undo / redo of a patch step that wrote knobs (a preset, Init patch, the Model 15 tile on a 900 Series):
// History restores the topology, keepDevs the current knobs — the step's meta {pt, trackId, dev, f} puts its before- (undo) or
// after-values (redo) back while every field still holds the other side (patch-core ptBack: sxBack's rule), else a notice
let ptBack = null; // { mv: the step's meta, redo } — read after hist.undo / hist.redo
const ptBackOf = (e, redo) => (e && e.meta && e.meta.pt === 1 && Array.isArray(e.meta.f) ? { mv: e.meta, redo } : null);
function ptBackApply(p, { mv, redo }) {
  const t = p.tracks.find(x => x.id === mv.trackId);
  if (!t || !isPatchDev(t, mv.dev)) return;
  const d = t.dev[mv.dev], r = PT.ptBack(d.vals, { f: mv.f }, redo);
  if (!r.ok) { notice(`${cvDevName(t, mv.dev)} changed since: its knobs left as they are`, 5000); return; }
  if (!r.already) d.vals = r.vals;
}

/* ---- the cable drag resolver (§2.5) */
// a mod-out onto a knob is modConnect's (modDragOpts.onMod); a Serum's internal ends (cv-module intPort: a part's or VOICE's
// jack in parts view) connect through sx-edges setEdge — one History step each (sxCable) —; anything else is refused with its
// reason ("Serum sources play through their VOICE")
const sxJackDev = j => { const m = /^([a-z][a-z0-9]*)[./]/.exec(String(j || '')); return m ? m[1] : null; };
function sxEnds(a, b) { // canvas jacks → { dev, A, B: sx-edges ENDs (B null: not this rig's) } | { why }
  const t = trk(), dev = sxJackDev(a);
  if (!dev || !sxParts(t, dev)) return { why: RC.WORDS.notPatchable }; // (sxParts: a rig, always its modules)
  const A = rigSrcEnd(dev, a), B = sxJackDev(b) === dev ? SE.endOf(dev, b) : null;
  return A ? { dev, A, B } : { why: RC.WORDS.notPatchable };
}
const sxEndLabel = (e, t = trk(), dev = curOf(t)) => rigEndLabel(t, dev, e); // ((WC, G13) "Oscillator 1 · OUT", "Amplifier · IN"
// ((WC) a cable drag's ends on a rig: rig-core can / plug (lines mode: cv-cables' line drags; cords mode: its cord drag, an Envelope's
// OUT onto the Amplifier's LEVEL too) — one History step each (rigEdit)
function sxCan(a, b) {
  const e = sxEnds(a, b), t = trk();
  if (!e.A) return { ok: false, why: e.why };
  if (!e.B) return { ok: false, why: RC.WORDS.other };
  const r = RC.can(t.dev[e.dev].vals.s, fxOfDev(t, e.dev), e.A, e.B, { used: sxUsed(t, e.dev), rig: t.dev[e.dev].rig }); // ((pre-deploy [amp-held]) rig: the names)
  return r.ok ? { ok: true, why: '' } : { ok: false, why: r.why };
}
function sxConnect(a, b) {
  const e = sxEnds(a, b), t = trk();
  if (!e.A || !e.B) { notice(e.why || RC.WORDS.other, 4000); return false; }
  const r = RC.plug(t.dev[e.dev].vals.s, fxOfDev(t, e.dev), e.A, e.B, rigOpts(t, e.dev));
  return rigEdit(t, e.dev, 'Plug ' + sxEndLabel(e.A, t, e.dev) + ' → ' + sxEndLabel(e.B, t, e.dev), r);
}
// a tap on an internal cable's actions (cv-cables onAction): Disconnect (a fork's branch: the balance all to the other
// filter), BALANCE (the source's routing popover in its panel), a warp / FM / pitch cable (set in the oscillator's menu)
function sxCableAct(c, a) {
  const t = trk(), dev = c.dev;
  if (!isRigDev(t, dev) || !c.edge) return;
  if (a === 'disconnect') { // ((WC) rig-core pull: a fork's branch, a cord, the amp cord (the gate back), a note cord
    const r = RC.pull(t.dev[dev].vals.s, fxOfDev(t, dev), c.id, rigOpts(t, dev));
    rigEdit(t, dev, 'Pull ' + sxEndLabel(c.edge.a, t, dev) + (c.edge.b ? ' → ' + sxEndLabel(c.edge.b, t, dev) : ''), r);
    return;
  }
  const part = String(c.edge.a || '').split('.')[0], key = dev + '/' + part;
  if (a === 'balance') { if (!sxRouteOpen(t, key)) notice('Open ' + rigLabel(t, dev, part) + '’s ⚙ to set the balance', 4000); return; }
  if (a === 'tap') { cvReveal(t.id, dev + '/' + String(c.edge.b || c.edge.a || '').split('.')[0]); notice(RC.WORDS.ro, 4000); } // (the oscillator that reads it)
}
// (review 2 P1-6) a stub into a filter that is off with no module: "FILTER 1 is off · tap to turn it on" (Add FILTER 1: its
// module, its ⏻, the cable to it — one step); the offer is for this track's Serum
function sxOffOffer(c) {
  const t = trk(), tid = t.id, dev = c.dev, part = c.off, msg = rigLabel(t, dev, part) + ' is off · tap to turn it on';
  noticeActs.set(msg, () => { noticeActs.delete(msg); notice('', 0); if (trk().id === tid && isRigDev(trk(), dev)) sxAddPart(dev, 'filter', null, part); });
  notice(msg, 8000);
}
// the routing popover of a source part (its panel's route button: OSC / SUB / NOISE)
function sxRouteOpen(t, key) {
  const V = sxViewOf(t, key), P = V && V.panel ? V.panel.panel || V.panel : null, b = P && P.route && P.route.btn;
  if (!b || typeof b.click !== 'function') return false;
  b.click();
  return true;
}

/* ---- a Serum's own sources on the canvas (§2.5) */
// a mod-out of a Serum's parts view: 'iN/lfo3.out' / 'iN/env2.out' (its module's jack), 'iN.env1' (VOICE's), 'iN/macros.k2'
// (MACROS' inline tile) → { dev, native: its Serum source, link: the canvas link row's src (null: its macros never leave it) }
function sxOwnSrc(src) {
  let m = /^([a-z][a-z0-9]*)\/(lfo(?:10|[1-9])|env[1-4])\.out$/.exec(src || '');
  if (m) return { dev: m[1], native: m[2], link: src };
  if ((m = /^([a-z][a-z0-9]*)\.env1$/.exec(src || ''))) return { dev: m[1], native: 'env1', link: m[1] + '/env1.out' };
  if ((m = /^([a-z][a-z0-9]*)\/macros\.k([1-8])$/.exec(src || ''))) return { dev: m[1], native: 'macro' + m[2], link: null };
  return null;
}
const SX_OWN_MACRO = RC.WORDS.ownMacro; // ((WC, G13) "A <NAME>'s macros modulate that <NAME> · use a Macro module"
// an own source onto a knob of the same Serum: a native matrix row through its host (addModUI: the panel's own undo — D11); (WC, review 2
// P2-1) a rig's: a cord edit, one History step (rigOwnConnect)
function sxOwnConnect(t, own, pid) {
  if (isRigDev(t, own.dev)) return rigOwnConnect(t, own, pid);
  const rec = sxRecOf(t.id, own.dev);
  let res = null;
  if (rec && rec.ui && rec.trackId === t.id && typeof rec.ui.addModUI === 'function') res = rec.ui.addModUI(own.native, pid);
  else sxEdit(instView(t, own.dev), s => { const k = core.addMod(s, fxOfDev(t, own.dev), own.native, pid, { limit: prefs.limitDrop }); res = k >= 0 ? { slot: k } : null; });
  if (!res) { notice(modRefusal('full', { dev: cvDevName(t, own.dev), used: 64, max: 64 }), 4000); return null; }
  cvModAfter(t);
  cvModSync();
  return 'o:' + own.dev + ':' + res.slot;
}
// (WC, review 2 P2-1) a rig's own Envelope / LFO / Macro row onto its own knob (its FX panel's too) is a cord: plugged, re-aimed (the badge
// drag) and pulled as ONE History step each through rigEdit — meta f = the row's fields (sxBack writes them back; the panel's undo has the
// edit too), "· tap to undo" —, as every other cord edit (§3.5's undo policy); the bundled Serum keeps its panel's undo (D11)
const rigSrcName = (t, dev, native) => (/^macro[1-8]$/.test(native || '') ? 'Macro ' + native.slice(5) : rigLabel(t, dev, native));
function rigRowEdit(t, dev, label, fn, o) {
  const s = t.dev[dev].vals.s, T = sclone(s);
  if (fn(T) === false) return false;
  const f = RC.diff(s, T);
  if (!rigEdit(t, dev, label, { f, why: f.length ? '' : RC.WORDS.same, notes: [] }, o)) return false;
  cvModAfter(t); cvModSync();
  return true;
}
function rigOwnConnect(t, own, pid) {
  let k = -1;
  const ok = rigRowEdit(t, own.dev, 'Modulate ' + modLabel(own.dev + ':' + pid, t) + ' with ' + rigSrcName(t, own.dev, own.native),
    T => { k = core.addMod(T, fxOfDev(t, own.dev), own.native, pid, { limit: prefs.limitDrop }); return k >= 0; });
  if (k < 0) { notice(modRefusal('full', { dev: cvDevName(t, own.dev), used: 64, max: 64 }), 4000); return null; }
  return ok ? 'o:' + own.dev + ':' + k : null;
}
// a rig's own row c (a cv-cables record: own, dev, slot, a the module's jack): its words "LFO 1", its module's
const rigRowSrc = (t, c) => { const q = sxOwnSrc(c.a); return q ? rigSrcName(t, c.dev, q.native) : modLabel(c.a, t); };

/* ---- the Sources tray's part tiles and note tools (§2.6; WC §3.5, §7) */
// a module tile's tap or drop (the tray's rig view, §3.5, §7): onto the track's rig it adds (its first free slot, auto-plugged: rigAdd);
// on any other instrument — a classic, a drum machine, a 900 Series, a Serum — it REPLACES it with a rig holding the Amplifier and that
// module (+ its FX panel and OUT: rigReplace), one step, "Replaced … · tap to undo"; (integration fixer L — review WC-int B4) in the tray's
// "+ Add a track…" mode (mode 'track', as a model tile's) a NEW track with a <NAME> that starts from it (rigNewTrack), the tray back to replacing
function sxPartPick(kind, mode) {
  if (mode === 'track') { rigNewTrack(kind); srcModeUI('replace'); return; }
  sxPartDrop(kind, null);
}
// a new track holding a <NAME> that starts from module `kind` — the blank (rigBlank: every source off), that module (its ⏻, its auto-plug, its
// ordinal), the Amplifier, its FX panel and OUT by Tidy's rule (rigFirst) — in addTrack's one step; its canvas frames it (cvCamRestore)
function rigNewTrack(kind) {
  const m = modelById(RIG.ID);
  if (!m || !RC.MODULES[kind]) return null;
  return addTrack(m, { s: RC.rigBlank() }, { module: kind });
}
function sxPartDrop(kind, at) {
  if (cvMaster) { notice(MASTER_SRC, 4000); return null; } // ((M) refused on the master canvas
  const t = trk(), dev = curOf(t);
  return isRigDev(t, dev) ? sxAddPart(dev, kind, at) : rigReplace(kind, at);
}
// a tile dragged out: its true-size outline under the pointer over the canvas, the drop where it lands; (integration fixer L — review WC-int
// B4) over the track list a new track with it (rigNewTrack), as every other tile
const sxPartDrag = {
  move(id, i) {
    $('#topTray').classList.toggle('cv-dropt', i.over === 'tracks');
    if (!world) return;
    if (i.over === 'canvas') shell.drop = world.ghost({ x: i.x, y: i.y, w: sxPartW(id), h: sxPartH(id), label: '+ ' + (SX_KIND[id] || id) + (isRigDev(trk(), curOf(trk())) ? '' : ' · a ' + RIG.NAME) });
    else { world.ghost(null); shell.drop = null; }
    world.dragPointer(!i.left || i.over === 'tracks' ? null : { x: i.x, y: i.y, pointerType: i.pointerType }); // (no edge pan over the track list)
  },
  begin(id, i) { if (world) world.setDragging(true); sxPartDrag.move(id, i); },
  drop(id, i) {
    const r = shell.drop;
    srcDragEnd();
    if (i.over === 'tracks') { rigNewTrack(id); return true; }
    if (i.over !== 'canvas') return false;
    sxPartDrop(id, r || (i.at ? { x: i.at.x - sxPartW(id) / 2, y: i.at.y - sxPartH(id) / 2 } : null));
    return true;
  },
  cancel() { srcDragEnd(); },
};
// every render: a module tile greys out with its reason when the track's rig has no room for one more (Q3; the tray's texts, cv-tray
// rigFull: "This <NAME> already has 3 oscillators" …); on any other instrument every tile is live (a tile replaces it); (integration fixer
// L — review WC-int B4) in the "+ Add a track…" mode the track a tap changes is a new one: every tile live (srcModeUI decorates again)
function sxPartsDecor() {
  const T = shell.tiles;
  if (!T || typeof T.setPartPlaced !== 'function') return;
  const t = trk(), dev = curOf(t), rig = isRigDev(t, dev) && !(typeof T.mode === 'function' && T.mode() === 'track'), full = k => (typeof cvTray.rigFull === 'function' ? cvTray.rigFull(k) : null) || sxFullWhy(k);
  const O = rig ? { held: null, shown: sxPartList(t, dev), used: sxUsed(t, dev) } : null; // (the held slots only change what a drop picks, never whether one is free to say)
  for (const k of ['osc', 'sub', 'noise', 'filter', 'env', 'lfo', 'macros', 'arp', 'clip']) {
    let why = null;
    if (rig) { const Q = rigSlot(t, dev, k, null, O); why = !Q.part || (Q.shown && Q.on && !Q.gate) ? full(k) : null; }
    T.setPartPlaced(k, why);
  }
}

/* ---------------------------------------------- cv WAVECRAFT (stage WC, IMPL-WC §3.5, §4, §8.2; lane H): the rig's host */
// A rig (model RIG.ID, rig-core) is always its modules — the Amplifier (its device key iN, VOICE's place), one module per part (rig-
// core partKeys: I1 / I2 / I1' / the amp slot), its FX panel iN/fx and OUT —, each a face of rig-ui on the RIG grid over the device's
// one SerumHost (sxViews). Its connections are cv-cables records (its internal ones rig-core edges()); drawMode(t) says how a canvas
// draws them: 'cords' — its own connections on the cord layer (cordOf: §4.1's table; a cord onto a socket-less knob goes into the
// BACK of the target module, the user's 2026-10-25 word), the rest lines — or 'lines' (RIG.WIRES, the pref synth.rig.wires, ?wires=,
// the hook: the regret path §4.7). Every structural edit — a drop, an add, a plug, a pull, a re-patch, a slot move, Init, a
// conversion — is ONE History step whose meta {trackId, dev, f} writes rig-core's field writes back on undo / redo (sxBack); knobs
// stay the panel's undo (the Serum knob policy).
let RIGUI = null; // rig-ui's rigHost once the panels loaded (false: a loader without rig-ui — the stage-3 views stand in, tests)
let rigMenuLast = null; // (the jack menu's last items: the hook's)
const RIG_KIT_WORDS = Object.freeze({ build: RC.WORDS.build, s1Tip: RC.WORDS.s1Tip, s1Warp: 'Legacy mode: WARP 2’s mode has no legacy equivalent for WARP 1' }); // (sxHost words: the kit's Info line, the S1 tooltip, a warp swap's refusal)
const RIG_WIRES = 'synth.rig.wires', RIG_SKIN = 'synth.rig.skin';
let rigWiresOv = null; // (the hook's wires(mode): this session)
const wiresOk = v => v === 'cords' || v === 'lines';
function rigWires() {
  if (wiresOk(rigWiresOv)) return rigWiresOv;
  const q = /[?&]wires=(cords|lines)(?:&|$)/.exec((globalThis.location && location.search) || '');
  if (q) return q[1];
  const p = store.get(RIG_WIRES, null);
  return wiresOk(p) ? p : RIG.WIRES;
}
// how track t's canvas draws its connections: 'cords' on a rig's canvas (unless the pref / URL / hook say 'lines'), else 'lines'
const drawMode = t => (!cvMaster && !!t && isRigDev(t, curOf(t)) ? rigWires() : 'lines');
const rigWm = t => (RIGUI === false ? null : drawMode(t)); // (cv-module entries' wires: none while the stage-3 views stand in)
const rigKind = part => (part == null || part === 'voice' || part === 'amp' ? 'amp' : RC.MODULES[part] ? part : SE.kindOf(part)); // (a part 'oscB' or a kind 'osc')
const sclone = x => (typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x)));
// a rig module's width / Tidy height: rig-ui's sizeOf once the panels loaded; before, rig-ui's faceW (64 · cols + 32, §3.8 — restated
// here for the first frames, pinned equal by canvas-WC-sim) and cv-module's height guesses
function rigW(part) {
  const k = rigKind(part), M = RC.MODULES[k];
  if (RIGUI && RIGUI.FACE && RIGUI.FACE[k]) return RIGUI.sizeOf(k, part).w;
  return M ? 64 * M.cols + 32 : cvModule.W_MOD;
}
function rigHt(part) { const k = rigKind(part); return RIGUI && RIGUI.FACE && RIGUI.FACE[k] ? RIGUI.sizeOf(k, part).h + cvModule.BAR_H : cvModule.PART_H_DEF[k] || 256; }
// the rig skin on the world (one attribute: rig-ui applySkin; before the panels load the same rule over rig-core SKINS)
function rigSkin() {
  const W = cvW(), el = W && W.el, id = store.get(RIG_SKIN, RC.SKIN_DEFAULT);
  if (!el || typeof el.setAttribute !== 'function') return;
  if (RIGUI) { RIGUI.applySkin(el, id); return; }
  const v = RC.SKINS.some(s => s.id === id) ? id : RC.SKIN_DEFAULT;
  if (el.getAttribute('data-cv-skin') !== v) el.setAttribute('data-cv-skin', v);
}
// every rig module — the Amplifier and its parts; not its FX panel, nor OUT (§13) — carries data-cv-rig (the skin's chrome, the screws)
function rigMark() {
  if (!cvView) return;
  const t = trk();
  for (const [k, m] of cvView.modules) {
    if (!m.el || typeof m.el.setAttribute !== 'function') continue;
    const q = CMOD.partOf(k), on = !cvMaster && (q ? isRigDev(t, q.dev) : isRigDev(t, k));
    if (on !== m.el.hasAttribute('data-cv-rig')) { if (on) m.el.setAttribute('data-cv-rig', ''); else m.el.removeAttribute('data-cv-rig'); }
  }
}
// the slots canvas-modulator injections hold in rig dev (cv-graph injectMods' inj: { kind, k }) — envFromAmp / a new Envelope never take one
function rigHeld(t, dev) { try { return CG.modRowsFor(t, dev).length ? CG.injectMods(t.dev[dev], CG.modRowsFor(t, dev), modsExt(t), t).inj || [] : []; } catch (err) { console.warn(err); return []; } }
// rig-core's editor options for rig dev of t (lane K's o): the held slots, the parts laid on the canvas, the link rows reading it, its record
const rigOpts = (t, dev) => ({ held: rigHeld(t, dev), shown: sxPartList(t, dev), used: sxUsed(t, dev), rig: t.dev[dev].rig, dev });
const rigOf = (t, dev) => RC.normRig(t.dev[dev].rig);
const rigLabel = (t, dev, part) => RC.labelOf(part, t.dev[dev] ? t.dev[dev].rig : null);
// the rig's cords as they stand on its canvas: rig-core edges() whose both ends are modules (a record from a part with no module —
// an off source rig-core lists dim — has nothing to plug into: never drawn, never in a jack's menu, never fanned)
// (the amp-slot cord is a connection, not a modulation row: rig-core's kind 'mod' would give it cv-cables' amount badge and the ∿ modes —
// here it is an 'audio'-kind record, its int 'level' kept); (review 2 P2-2) rig-core's tag ("dry": a source passing dry through a Filter
// whose input switch is off) is the record's label — what cv-cables draws (above the IN plug of a cord, above a line)
function rigEdges(t, dev) {
  const d = t.dev[dev], on = new Set(sxPartList(t, dev)).add('voice'), part = e => String(e || '').split('.')[0];
  const gc = drawMode(t) === 'lines' ? (typeof d.color === 'string' && d.color) || t.color : null; // ((fixer B2, review 2 P2-4) lines mode: the group colour (§4.7), not grey
  return RC.edges(d.vals.s, fxOfDev(t, dev), dev, d.rig, sxUsed(t, dev)).filter(r => on.has(part(r.edge.a)) && (!r.edge.b || on.has(part(r.edge.b))))
    .map(r => { // (the amp-slot cord an 'audio' record; review 2 P2-2 the tag as its label; fixer B2 P2-4 lines mode's group colour)
      const lv = r.int === 'level' && r.kind === 'mod', lb = !!r.tag && !r.label;
      return lv || lb || gc ? Object.assign({}, r, lv ? { kind: 'audio' } : null, lb ? { label: r.tag } : null, gc ? { color: gc } : null) : r;
    });
}
// (review 2 P2-5, the user's rule) Tidy's band: what each of rig dev's modulators drives, as module keys — rig-core targetsOf over the modules
// standing (`parts`; Envelope 1 the Amplifier, a row the module holding its knob, 'voice' the Amplifier, 'fx' its FX panel) and the canvas
// link rows from its modules' jacks (onto another device: that module)
function rigTargetsOf(t, dev, parts) {
  const P = parts || sxPartList(t, dev), T = RC.targetsOf(t.dev[dev].vals.s, P), out = {}, key = p => (p === 'voice' ? dev : dev + '/' + p);
  for (const p of Object.keys(T)) out[dev + '/' + p] = T[p].map(key);
  for (const row of Array.isArray(t.mods) ? t.mods : []) {
    const q = row ? sxOwnSrc(row.src) : null, D = row ? modSplit(row.dst) : null;
    if (!q || q.dev !== dev || !D || D.dev === dev || !P.includes(q.native)) continue;
    const L = out[dev + '/' + q.native] || (out[dev + '/' + q.native] = []);
    if (!L.includes(D.dev)) L.push(D.dev);
  }
  return out;
}
// a portrait canvas (the band taller than wide — the iPad upright): a rig's Tidy wraps its chain after the Amplifier
const cvNarrow = () => { const W = cvW(); let b = null; try { b = W && typeof W.band === 'function' ? W.band() : null; } catch (err) { b = null; } return !!b && b.bottom - b.top > b.right - b.left; };
// cv-module tidy()'s opts for track t: its rigs' modulator targets, the canvas's shape, (the user's stacked plugs) the rigs past (rigPast)
// (ignored on every other canvas)
function rigTidyOpts(t) {
  const targets = {}, past = {};
  for (const dev of sxIds(t)) if (isRigDev(t, dev)) { Object.assign(targets, rigTargetsOf(t, dev)); if (rigPast(t, dev)) past[dev] = true; }
  return { targets, narrow: cvNarrow(), past };
}
// ((the user, 2026-10-26: stacked plugs) Tidy's air before rig dev's Amplifier: a source straight to it (IN / DIRECT) while a filter stands —
// its cord rises into the Amplifier's one socket from under the filters (S3's Sub past Filter 2's foot)
function rigPast(t, dev, parts) {
  const P = parts || sxPartList(t, dev);
  if (!P.some(p => SE.FILTERS.includes(p))) return false;
  return rigEdges(t, dev).some(r => /^voice\.(main|direct)$/.test(String(r.edge.b)) && SE.SRC_PARTS.includes(String(r.edge.a).split('.')[0]));
}
// a jack end's words: "Oscillator 1 · OUT", "Amplifier · LEVEL" (the jack rows' labels, rig-core MODULES)
function rigEndLabel(t, dev, end) {
  const i = String(end || '').indexOf('.'), part = i > 0 ? end.slice(0, i) : String(end || ''), port = i > 0 ? end.slice(i + 1) : '';
  const M = RC.MODULES[rigKind(part)], J = M ? (M.jacks.in || []).concat(M.jacks.out || []).find(j => j.id === port) : null;
  return rigLabel(t, dev, part) + (port ? ' · ' + (J ? J.label : port === 'env1' ? 'Envelope 1 OUT' : port.toUpperCase()) : '');
}
// a rig-core result's structure in t (inside the caller's step): lay renames (simultaneous; the ordinal follows the module), link rows
// re-sourced, canvas rows re-targeted (null: dropped)
function rigStruct(t, dev, r) {
  const d = t.dev[dev];
  if (Array.isArray(r.lay) && r.lay.length) {
    const L0 = t.lay && typeof t.lay === 'object' ? t.lay : {}, L = Object.assign({}, L0), rig = RC.normRig(d.rig), n = Object.assign({}, rig.n);
    for (const [a] of r.lay) { delete L[dev + '/' + a]; delete n[a]; }
    for (const [a, b] of r.lay) { const e = L0[dev + '/' + a]; if (e) L[dev + '/' + b] = Object.assign({}, e); n[b] = RC.ordinalOf(rig, a); }
    t.lay = L; d.rig = Object.assign({}, rig, { n });
  }
  if (Array.isArray(t.mods) && Array.isArray(r.links) && r.links.length) {
    const M = new Map(r.links.map(([a, b]) => [dev + '/' + a, dev + '/' + b]));
    for (const row of t.mods) if (row && M.has(row.src)) row.src = M.get(row.src);
  }
  if (Array.isArray(t.mods) && Array.isArray(r.ids) && r.ids.length) {
    const M = new Map(r.ids.map(([a, b]) => [dev + ':' + a, b ? dev + ':' + b : null]));
    t.mods = t.mods.filter(row => !(row && M.has(row.dst) && M.get(row.dst) === null));
    for (const row of t.mods) if (row && M.has(row.dst)) row.dst = M.get(row.dst);
  }
}
const rigPrune = (t, dev) => { // (dev.rig's GC after a structural edit; written only when it drops something — an edit that changed nothing stays a no-op)
  const d = t.dev[dev];
  if (!d || !isRigDev(t, dev) || !d.rig) return;
  const r = RC.pruneRig(d.rig, d.vals.s, t.lay, dev);
  if (JSON.stringify(r) !== JSON.stringify(RC.normRig(d.rig))) d.rig = r;
};
// a rig's structural edit's History step `label` → the step (its meta the caller's): never folded onto an equal top — after a no-op
// step (an edit that changed nothing) History.record would return false and the edit would take that step's label and lend it its
// meta (review 1 P3-2); record's return says a step is ours
const rigStep = label => (hist.record(project, label, true) ? hist.u[hist.u.length - 1] : null);
// ONE History step `label` for rig-core's result r on rig dev of t: its field writes through the Serum host (the panel's own undo has
// them too), meta {trackId, dev, f} (sxBack: undo / redo write them back), its structure (rigStruct); a refusal says why, no step.
// A slot move with equal fields is a move without writes (r.lay: the modules swap places and names). o.quiet: no notice (rig-ui's
// menus say their own); o.notice: the text, else r's notes, else the label — "· tap to undo"
function rigEdit(t, dev, label, r, o = {}) {
  if (!t || !isRigDev(t, dev)) return false;
  if (!r || r.why || !Array.isArray(r.f) || !(r.f.length || (Array.isArray(r.lay) && r.lay.length))) { if (!o.quiet) notice((r && r.why) || RC.WORDS.bad, 4000); return false; }
  flush();
  const step = rigStep(label);
  if (step && r.f.length) step.meta = { trackId: t.id, dev, f: sclone(r.f) };
  rigStruct(t, dev, r);
  if (r.f.length) sxApply(t, dev, r.f, label);
  rigPrune(t, dev);
  persist(); cvRender(); updateUndoUI();
  if (!o.quiet) cvUndoNotice((o.notice || (Array.isArray(r.notes) && r.notes.length ? r.notes.join(' · ') : label)) + ' · tap to undo', step, () => null);
  return true;
}
// a cord's colour (rig-ui's Colour ▸: dev.rig.cc by the source end, one step "Cord colour"; cosmetics only — W3); a pick that changes
// nothing (the colour it has) records nothing (review 1 P3-2: a no-op step)
function rigColour(t, dev, src, c) {
  if (!t || !isRigDev(t, dev) || !Number.isInteger(c) || c < 0 || c > 7) return false;
  const d = t.dev[dev], rig = RC.normRig(d.rig), nx = RC.normRig(Object.assign({}, rig, { cc: Object.assign({}, rig.cc, { [src]: c }) }));
  if (JSON.stringify(nx) === JSON.stringify(rig)) return false;
  flush();
  hist.record(project, 'Cord colour');
  d.rig = nx;
  persist(); cvRender(); updateUndoUI();
  return true;
}
// what adding a module of `kind` (part0: a given slot) to rig dev writes — rig-core's rules, nothing written: the slot (firstFree; an
// Envelope §3.4: the amp slot while it is the gate with no module — plugged into LEVEL at Serum's envelope defaults —, else the first
// slot 2–4 nothing reads, shows or holds: Envelope 1 standing as the gate (read) stays as it is, review 1), its ⏻ on, its auto-plug
// (AUTOPLUG: the first target whose module stands) → { part, f, label, ord, shown, why }
// the slot alone (cheap: the tiles' decor at every render) → { part, shown: a module stands there, on: its ⏻ (or none), why }
function rigSlot(t, dev, kind, part0, O) {
  const s = t.dev[dev].vals.s, shown = new Set(O.shown);
  let part = part0 || null, held = false;
  if (!part) {
    if (kind === 'macros' || kind === 'arp' || kind === 'clip') part = kind;
    else if (kind === 'env') {
      if (RC.isGate(s) && !shown.has('env1')) part = 'env1';
      else {
        const U = SE.slotsUsed(s, O.used, true), H = new Set((O.held || []).map(x => (x && typeof x === 'object' ? x.kind + ((x.k | 0) + 1) : String(x))));
        for (const p of ['env2', 'env3', 'env4']) { if (U.has(p) || shown.has(p)) continue; if (H.has(p)) { held = true; continue; } part = p; break; }
      }
    } else part = SE.firstFree(s, kind, kind === 'lfo' ? [...shown] : null);
  }
  if (!part) return { part: null, why: held ? RC.WORDS.envHeld : RC.WORDS.full(kind) };
  const pw = SE.powerOf(part);
  return { part, shown: shown.has(part), on: !pw || core.destBase(s, null, pw) >= 0.5, gate: kind === 'env' && part === 'env1' && RC.isGate(s), why: '' };
}
function rigPick(t, dev, kind, part0) {
  const d = t.dev[dev], s = d.vals.s, fx = fxOfDev(t, dev), O = rigOpts(t, dev), shown = new Set(O.shown), Q = rigSlot(t, dev, kind, part0, O), part = Q.part;
  if (!part) return { why: Q.why };
  const T = sclone(s), pw = SE.powerOf(part), f = [];
  let on = null;
  if (pw && !(core.destBase(T, null, pw) >= 0.5)) { const b = core.destBase(T, null, pw); f.push([['p', pw], b, 1]); T.p[pw] = 1; on = [b, 1]; }
  const after = new Set(shown).add(part), O2 = Object.assign({}, O, { shown: [...after] });
  if (kind === 'env') {
    if (part === 'env1' && RC.isGate(T)) { const r = RC.plug(T, fx, 'env1.out', 'voice.level', O2); if (r.f.length) { RC.apply(T, r.f); f.push(...r.f); } }
  } else {
    for (const tgt of RC.AUTOPLUG[kind] || []) {
      let end = tgt;
      if (tgt === 'filter.in') { const k = ['filter', 'filter2'].find(p => p !== part && after.has(p)); if (!k) continue; end = k + '.in'; }
      if (tgt === 'voice.level') continue;
      const r = RC.plug(T, fx, part + '.out', end, O2);
      if (r.f.length) { RC.apply(T, r.f); f.push(...r.f); break; }
      if (r.why === RC.WORDS.same) break;
    }
  }
  const rig = RC.normRig(d.rig), ord = kind === 'env' && !shown.has(part) ? RC.nextOrdinal(rig, 'env', [...shown]) : null;
  const label = RC.labelOf(part, ord ? Object.assign({}, rig, { n: Object.assign({}, rig.n, { [part]: ord }) }) : rig);
  return { part, f, label, ord, on, shown: shown.has(part), why: '' };
}
const rigSetOrd = (t, dev, part, ord) => { if (!ord) return; const d = t.dev[dev], rig = RC.normRig(d.rig); rig.n = Object.assign({}, rig.n, { [part]: ord }); d.rig = rig; };
// a module tile onto rig dev (its tap: the Tidy slot; its drop: where it lands): one step "Add <label>" with its ⏻ and its auto-plug's
// writes (meta {trackId, dev, part, f}: sxBack), "Added <label> · tap to undo"; full → the count, no step; already a module → shown
function rigAdd(dev, kind, at, part0, o) {
  const t = trk();
  if (!isRigDev(t, dev)) return null;
  const P = rigPick(t, dev, kind, part0);
  if (!P.part) { notice(P.why, 4000); return null; }
  const part = P.part, k = dev + '/' + part, atOk = !!at && Number.isFinite(at.x) && Number.isFinite(at.y);
  if (P.shown && !P.f.length && !atOk) { notice(RC.WORDS.onCanvas(P.label), 3500); cvReveal(t.id, k); return null; }
  flush();
  const own = !o || o.step !== false;
  const step = own ? rigStep('Add ' + P.label) : hist.u[hist.u.length - 1];
  const lay = cvPinned(t);
  let moved = false; // (a drop the clear moved off where it landed)
  if (atOk) { const p0 = { x: cvDot(at.x), y: cvDot(at.y) }, p = sxDropClear(t, dev, part, p0); moved = p.x !== p0.x || p.y !== p0.y; lay[k] = Object.assign({}, lay[k] || {}, p); sxFresh.add(t.id + '\n' + k); }
  else if (!lay[k]) { lay[k] = sxSpot(t, lay, dev, part); sxFresh.add(t.id + '\n' + k); }
  if ((lay[k].fold && !atOk) || lay[k].auto) { lay[k] = Object.assign({}, lay[k]); if (!atOk) delete lay[k].fold; delete lay[k].auto; } // (added: the user's place)
  t.lay = lay;
  rigSetOrd(t, dev, part, P.ord);
  if (P.f.length) {
    if (step && own) step.meta = Object.assign({ trackId: t.id, dev, part }, P.on ? { on: P.on } : null, { f: sclone(P.f) });
    sxApply(t, dev, P.f, 'Add ' + P.label);
  }
  persist(); cvRender(); updateUndoUI();
  if (own) cvUndoNotice(RC.WORDS.added(P.label), step, () => null);
  if (!atOk || moved) rigReveal(t, dev, k); // ((integration fixer L — review WC-int B2) a tap's slot (the band's left end under an open tray, under a neighbour below the
  // screen) or a moved drop: the camera brings it in at the zoom it has once its face is up — a drop where it landed is where the user put it
  return part;
}
// ⋯ → Remove on a rig's module (one step; meta as an add's): an Envelope / LFO / Macros something reads stays (said); the amp
// Envelope's cord pulled first (envFromAmp: the gate back) and its module goes; a Filter: every cord into it pulled first (rig-core
// pull: a fork's branch → the balance all to the other Filter, a sole cord → None), then the sole ones — a source's, the other Filter's
// (review 1 P2-1: it would sound on through the off Filter with no cord) — plugged where its OUT went (no source silenced; into the
// other Filter: there), each applied in order, and its ⏻ off (review 1 P2-2: plug alone forked a chained source and kept the Filter);
// any other part ⏻ off; its lay entry gone
function rigRemove(key) {
  const t = trk(), q = CMOD.partOf(key);
  if (!q || !isRigDev(t, q.dev)) return false;
  const dev = q.dev, part = q.part, d = t.dev[dev], s = d.vals.s, fx = fxOfDev(t, dev), O = rigOpts(t, dev), name = rigLabel(t, dev, part);
  const pw = SE.powerOf(part), U = SE.slotsUsed(s, O.used, true);
  if (!pw && U.has(part)) { notice(RC.WORDS.inUse(name, Math.max(1, sxReads(t, dev, part))), 5000); return false; }
  const T = sclone(s);
  let mv = null;
  if (part === 'env1' && !RC.isGate(s)) { // (the amp Envelope: its cord pulled — the keys gate the level again)
    const r = RC.envFromAmp(T, O);
    if (r.why) { notice(r.why, 4500); return false; }
    RC.apply(T, r.f); mv = r;
  }
  if (part === 'filter' || part === 'filter2') { // (what fed it follows its OUT: nothing silenced, nothing heard without a cord)
    const L = RC.edges(T, fx, dev, d.rig, O.used), out = L.find(e => e.edge.a === part + '.out' && e.edge.b), to = out ? out.edge.b : 'voice.main';
    for (const e of L.filter(x => x.edge.b === part + '.in' && /^(osc[ABC]|sub|noise|filter2?)\.out$/.test(x.edge.a))) {
      const rec = RC.edges(T, fx, dev, d.rig, O.used).find(x => x.id === e.id);
      if (!rec) continue;
      const r = RC.pull(T, fx, rec.id, O);
      if (r.f.length) RC.apply(T, r.f);
      if (rec.fork) continue; // (its other branch stays: the other Filter has it all)
      const q = RC.plug(T, fx, rec.edge.a, to, O);
      if (q.f.length) RC.apply(T, q.f);
    }
  }
  if (pw && core.destBase(T, null, pw) >= 0.5) T.p[pw] = 0;
  const f = RC.diff(s, T);
  flush();
  const step = rigStep('Remove ' + name);
  if (mv) rigStruct(t, dev, mv);
  const gone = mv && mv.lay && mv.lay[0] ? mv.lay[0][1] : part, lay = cvPinned(t);
  delete lay[dev + '/' + gone];
  t.lay = lay;
  if (f.length) { if (step) step.meta = { trackId: t.id, dev, part, f: sclone(f) }; sxApply(t, dev, f, 'Remove ' + name); }
  rigPrune(t, dev);
  persist(); cvRender(); updateUndoUI();
  return true;
}
// a whole state onto rig dev (⋯ → Init: rigInit; the rig tile on a rig: the starter) — one step with sxBack meta, "tap to undo"; its
// modules follow the state (the places of parts it no longer has go in the step)
function rigLoad(dev, T, label) {
  const t = trk();
  if (!isRigDev(t, dev)) return false;
  const d = t.dev[dev], s = d.vals.s, f = RC.diff(s, T);
  if (!f.length) { notice(label + ': already so', 3000); return false; }
  flush();
  const step = rigStep(label);
  if (step) step.meta = { trackId: t.id, dev, f: sclone(f) };
  const keep = new Set(RC.partKeys(T, null, dev, sxUsed(t, dev), d.rig)), lay = Object.assign({}, t.lay && typeof t.lay === 'object' ? t.lay : {});
  for (const k of Object.keys(lay)) { const q = CMOD.partOf(k); if (q && q.dev === dev && !keep.has(q.part)) delete lay[k]; }
  t.lay = lay;
  sxApply(t, dev, f, label);
  rigPrune(t, dev);
  persist(); cvRender(); updateUndoUI();
  cvUndoNotice(label + ' · tap to undo', step, () => null);
  return true;
}
const rigInitDev = dev => rigLoad(dev, RC.applyPrefs(RC.rigInit(), prefs, true), 'Init ' + RIG.NAME); // (true: MPE stays the Serum's, §13)
const rigStarterDev = dev => rigLoad(dev, RC.rigStarter(prefs).s, RIG.NAME + ' starter');
// the rig tile (srcPick / srcDrag) on a rig track: its starter, a preset-style load (never a same-model Replace: IMPL-9 §1.4) → handled
function rigTile(id) {
  if (id !== RIG.ID || cvMaster) return false;
  const t = trk(), dev = curOf(t);
  if (!isRigDev(t, dev)) return false;
  rigStarterDev(dev);
  return true;
}
// a module tile on any other instrument (§3.5): Replace it with a rig holding the Amplifier + that module (+ its FX panel and OUT) —
// one step 'Replace <old>' (setTrackModel o.module), "Replaced <old> with <NAME> · <module> · tap to undo"
let rigFirstPart = null; // (setTrackModel's module drop: the part it added, its label)
function rigReplace(kind, at) {
  if (cvMaster) { notice(MASTER_SRC, 4000); return null; }
  const t = trk(), iv = curView(t), dev = dvOf(iv), old = modelById(iv.model), tid = t.id;
  rigFirstPart = null;
  const why = setTrackModel(iv, RIG.ID, { module: kind, at });
  const nd = CMOD.instOf(trOf(iv), dev);
  if (!nd || nd.model !== RIG.ID) return null;
  const step = hist.u[hist.u.length - 1], P = rigFirstPart || { part: null, label: RC.MODULES[kind] ? RC.MODULES[kind].label : kind };
  cvUndoNotice(RC.WORDS.replaced(old.name, P.label).replace(/ · tap to undo$/, '') + (why ? ' · ' + why : '') + ' · tap to undo', step, () => {
    const tr = project.tracks.find(x => x.id === tid), d = tr && CMOD.instOf(tr, dev);
    return d && d.model === RIG.ID ? () => setTrackModel(instView(tr, dev), old.id) : null;
  });
  rigFrame(trk(), dev, { lead: P.part ? dev + '/' + P.part : null }); // (B3: the module just added whole in the first view)
  return P.part;
}
// (review 2 P2-6; integration fixer L — review WC-int B2 / B3 / P3-5) the camera follows a rig being made or grown, once its faces have mounted
// (a fit before them framed their bars: a face's height arrives with it). rigFrame frames the whole rig — the chain, the modulator band, the
// Amplifier and its FX panel; OUT stays where the replaced instrument's stood (often far right: framing it gave ≈ 30 %) — never below READ_K
// (B3's check: below it a press on a module pans instead of turning its knob; a rig too big for the band there shows what matters first —
// rigFirstKeys, the fit's focus in priority order: on a side it does not fit, the longest head of it that does, centred, slid back only so
// far that no blank band opens where the rig goes on — cv-world fitCam's floor; o.lead: the module just added); o.all: every module on the
// canvas (Tidy: its row holds OUT; an overview, as
// the toolbar's Fit) — into the band it fits (cv-world fit: the visible rect less an open tray, the toolbar and the minimap), animated (o.def:
// the track's default camera — a jump, not stored, as cvCamRestore's); rigReveal brings one new module into the band at the zoom it has
// (modShow, the modulators' rule). One request at a time (the newest wins), looked at once a frame until the faces are up (RIG_WAIT frames
// at most); another track, the master canvas, a hidden canvas, a press / wheel / pinch on the canvas meanwhile or a finger / button still
// down on it when the faces are up (its gesture owns the camera: a slow device's late fit jumped under the finger — a track switch builds its
// canvas after the press that follows it) drops it
const RIG_WAIT = 60, RIG_HELD_MS = 8000;
let rigCamQ = null, rigCamOn = null;
const rigDown = new Map(); // pointerId → when it went down on the canvas (lifted anywhere: gone; RIG_HELD_MS at most, a lost lift)
const rigFrame = (t, dev, o) => rigCam(Object.assign({ tid: t.id, dev }, o));
const rigReveal = (t, dev, key) => rigCam({ tid: t.id, dev, key });
function rigCamDrop(e) {
  if (rigCamQ && rigCamQ.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rigCamQ.raf);
  rigCamQ = null;
  if (e && e.type === 'pointerdown') rigDown.set(e.pointerId, Date.now());
}
const rigLift = e => { if (e) rigDown.delete(e.pointerId); };
const rigPressed = () => { const t = Date.now(); for (const [id, t0] of rigDown) if (t - t0 > RIG_HELD_MS) rigDown.delete(id); return rigDown.size > 0; };
function rigCam(q) {
  rigCamDrop();
  const W = cvW(), vp = W && (W.viewport || W.el);
  if (vp && vp !== rigCamOn && typeof vp.addEventListener === 'function') {
    for (const ty of ['pointerdown', 'wheel', 'gesturestart']) vp.addEventListener(ty, rigCamDrop, { capture: true, passive: true });
    if (!rigCamOn && typeof window !== 'undefined' && typeof window.addEventListener === 'function') for (const ty of ['pointerup', 'pointercancel']) window.addEventListener(ty, rigLift, { capture: true, passive: true });
    rigCamOn = vp;
  }
  rigCamQ = Object.assign(q, { n: 0, raf: 0 });
  rigCamNext(q);
}
function rigCamNext(q) {
  q.raf = requestAnimationFrame(() => {
    q.raf = 0;
    if (rigCamQ !== q) return;
    const t = trk(), W = cvW(), V = rigView();
    if (cvMaster || !V || !W || t.id !== q.tid || !isRigDev(t, q.dev) || $('#tab-inst').hidden) { rigCamQ = null; return; }
    if (!rigFacesUp(t, q.dev) && ++q.n < RIG_WAIT) { rigCamNext(q); return; }
    rigCamQ = null;
    if (rigPressed()) return;
    if (q.key) { modShow(q.key); return; }
    if (typeof W.fit !== 'function') return;
    const ids = q.all ? null : [...V.modules.keys()].filter(k => k === q.dev || k.startsWith(q.dev + '/'));
    if (ids && !ids.length) return;
    W.fit(Object.assign({ animate: !q.def }, ids ? { ids, kMin: cvWorld.READ_K, focus: rigFirstKeys(V, q.dev, q.lead) } : { all: true }));
    if (q.def && W.cam) { clearTimeout(cvCamT); cvCamT = 0; cvCamPend = null; cvCamLast = { key: CM.camKey(project.uid, t.id), cam: { tx: W.cam.tx, ty: W.cam.ty, k: W.cam.k } }; } // (still the untouched default)
  });
}
// (integration fixer L — review WC-int B3, after its checks) what a first view at READ_K holds first when the rig does not fit, in PRIORITY
// order (cv-world fitCam drops from the end what a side cannot hold — a keyboard-up band keeps the chain row, not Envelope 1 over it): the
// module just added (lead), else the chain's start (the left-most module on the Amplifier's row: no modulator, not its FX panel); the
// Amplifier; its Envelope 1 (the gate's) — the knobs one plays first
function rigFirstKeys(V, dev, lead) {
  const a = V.modules.get(dev), A = a ? a.rect() : null;
  if (!A) return null;
  let s = lead && V.modules.has(lead) ? lead : null, sx = Infinity;
  if (!s) for (const [k, m] of V.modules) {
    const q = CMOD.partOf(k);
    if (!q || q.dev !== dev || /^(env\d|lfo\d+|macros)$/.test(q.part)) continue;
    const r = m.rect();
    if (r && r.y < A.y + A.h && r.y + r.h > A.y && r.x < sx) { sx = r.x; s = k; }
  }
  return [s, dev, dev + '/env1'].filter(k => k && V.modules.has(k));
}
// a rig's faces are up: no switch mounting bodies, no panel due, each of its modules holding its face (the host's views: the Amplifier's, each part's)
function rigFacesUp(t, dev) {
  const V = rigView(), rec = sxRecOf(t.id, dev);
  if (!V || cvMount || cvDue.size || !rec || !rec.views) return false;
  for (const k of V.modules.keys()) if ((k === dev || (CMOD.partOf(k) || {}).dev === dev) && !rec.views.has(k)) return false;
  return true;
}
// (integration fixer L — review WC-int P3-11) the line layer's route (cv-cables o.route) for a rig's Amplifier → Effects line: round the
// Amplifier when its FX panel stands under it (Tidy's upright wrap: cv-cables wrapPath, which answers null for any other lay — the plain
// line), its run down 2 × RIG_AMP_AIR beside the Amplifier — beyond Envelope 1's cord, which hangs RIG_AMP_AIR beside it into LEVEL (P3-3):
// the two cross once, by its OUT, and never run together; every other line the plain one
function rigRoute(c, A, B) {
  const V = rigView(), d = c && typeof c.a === 'string' && c.a.endsWith('.out') ? c.a.slice(0, -4) : '';
  if (!d || !V || cvMaster || c.b !== d + '/fx.in' || !isRigDev(trk(), d) || !B) return null;
  const s = rigRectOf(d), f = rigRectOf(d + '/fx'); // (the heights read once a render: a drag's every frame asks — no layout read per frame)
  if (!s || !f || !(B.x < s.x + s.w)) return null; // (the FX panel right of the Amplifier, one row: the plain line, no walk)
  const O = [];
  for (const k of V.modules.keys()) if (k !== d && k !== d + '/fx') { const r = rigRectOf(k); if (r) O.push(r); }
  return cvCables.wrapPath(A, B, s, f, O, 2 * cvModule.RIG_AMP_AIR);
}
// inside setTrackModel's step: the module of the first drop on the fresh blank (its ⏻, its auto-plug, its ordinal), the group laid
// out by Tidy's rule where the old instrument stood (sxLayParts: [module] [Amplifier] [FX] [OUT])
function rigFirst(tr, dev, kind) {
  const d = tr.dev[dev], P = rigPick(tr, dev, kind, null);
  if (!P.part) return null;
  if (P.f.length) RC.apply(d.vals.s, P.f);
  rigSetOrd(tr, dev, P.part, P.ord);
  rigFirstPart = { part: P.part, label: P.label };
  tr.lay = sxLayParts(tr, dev, P.part);
  if (!RIG.HUB_OPEN && tr.lay[dev]) tr.lay[dev] = Object.assign({}, tr.lay[dev], { fold: 1 }); // (RIG.HUB_OPEN false: the Amplifier arrives folded to its bar)
  return P.part;
}
// ⋯ → Make it a <NAME> on a Serum (Q4 (a)): the same state (rig-core adopt: only the AMP ENV switches, each said), its FX, preset
// name, rows and parts' old places (keepLay: sxModelLay's purge skipped; none → Tidy's group) — one step, "Now a <NAME> · same sound"
function rigConvert(dev) {
  const t = trk(), iv = instView(t, dev);
  if (!iv || !isSerumModel(modelById(iv.model)) || !iv.vals || !iv.vals.s) return false;
  const A = RC.adopt(iv.vals.s), tid = t.id;
  setTrackModel(iv, RIG.ID, { keepLay: true, vals: { s: A.s }, preset: iv.preset });
  const nd = CMOD.instOf(t, dev);
  if (!nd || nd.model !== RIG.ID) return false;
  const step = hist.u[hist.u.length - 1];
  cvUndoNotice(A.notes.length ? RC.WORDS.nowAChanged.replace(/ · tap to undo$/, '') + ' · ' + A.notes.join(' · ') + ' · tap to undo' : RC.WORDS.nowA, step, () => {
    const tr = project.tracks.find(x => x.id === tid), d = tr && CMOD.instOf(tr, dev);
    return d && d.model === RIG.ID ? () => setTrackModel(instView(tr, dev), 'serum') : null;
  });
  rigFrame(t, dev); // ((integration fixer L, B3) the rig framed once its faces are up — not the Serum's camera
  return true;
}
/* ---- the rig's connections: which records are cords, the cord layer's list and anchors (cords mode, §4.1–§4.5) */
const rigSrcEnd = (dev, a) => { // a source jack's end: 'oscA.out', 'lfo3.out', 'macros.k2', 'env1.out' (VOICE's alias 'iN.env1')
  const e = SE.endOf(dev, a);
  if (e) return e === 'voice.env1' ? 'env1.out' : e;
  const s = String(a || '');
  return s.startsWith(dev + '/') ? s.slice(dev.length + 1) : s === dev + '.env1' ? 'env1.out' : null;
};
// a record the cord layer draws on this canvas (§4.1's table): the rig's internal edges (the amp-slot cord too), its own Envelope / LFO /
// Macro rows (onto its knobs, its FX panel's included), link rows from its modules' jacks — never Amplifier → FX, FX → OUT, a canvas
// modulator's row, a preset row, a Pads note line, a stub
function cordOf(c) {
  const t = trk();
  if (!c || cvMaster || drawMode(t) !== 'cords') return false;
  if (c.int) return typeof c.dev === 'string' && isRigDev(t, c.dev);
  if (c.kind !== 'mod' || c.preset) return false;
  if (c.own) return typeof c.dev === 'string' && isRigDev(t, c.dev);
  const m = typeof c.a === 'string' ? /^([a-z][a-z0-9]*)([./])/.exec(c.a) : null;
  return !!m && isRigDev(t, m[1]) && (m[2] === '/' || c.a === m[1] + '.env1');
}
const isKnobEnd = c => c.kind === 'mod' && typeof c.b === 'string' && c.b.indexOf(':') > 0;
// a cord's look (§4.5): its colour (rig-core's rule, a user's dev.rig.cc pick for the rig's own cords), its alpha (1 · the rig's own rows
// 0.85 · off / bypassed / warp 0.45 · the 24+ fade 0.3), its ends' plugs (a knob end: the BACK end, s 2)
function toCord(c, t) {
  const dev = c.int ? c.dev : (/^([a-z][a-z0-9]*)/.exec(String(c.a || '')) || [])[1], d = dev && t.dev ? t.dev[dev] : null, knob = isKnobEnd(c);
  const col = c.int ? (Number.isInteger(c.c) ? c.c : 4) : RC.cordColor(rigSrcEnd(dev, c.a) || '', knob ? null : d && d.rig);
  const o = c.fade ? RC.LOOK.o.fade : c.dim || c.byp ? RC.LOOK.o.off : c.int ? (typeof c.o === 'number' ? c.o : 1) : RC.LOOK.o.row;
  return { id: c.id, a: c.a, b: c.b, c: col, s: knob ? 2 : 0, o };
}
// the modules' measured heights and their controls (fixer B2: what a badge must not cover) — cleared at every render: a drag reads no layout
const rigRects = new Map(); // (module key → its measured height)
const rigCtls = new Map(); // (module key → [x, y, w, h, …]: its controls' rects, module px)
const rigView = () => (cvView && project && cvView.trackId === trk().id ? cvView : null); // (a view being made for another track is not yet cvView)
function rigRectOf(key) {
  const V = rigView(), m = V && V.modules.get(key);
  if (!m) return null;
  let h = rigRects.get(key);
  if (!(h > 0)) { h = m.rect().h; rigRects.set(key, h); }
  return { x: m.x, y: m.y, w: m.w, h: m.fold ? cvModule.BAR_H : h };
}
// ((WC, fixer B2) a module's controls — knobs, buttons, the screens, the menus, the jacks, its bar (the module's own handle) — as rects in
// module px, read once a render (a face's layout does not move inside its module)
const RIG_CTL = '[data-dest], button, canvas, input, select, [role="button"], [role="slider"], [role="switch"], [role="combobox"], [data-cv-jack], .cv-bar';
function rigCtl(key) {
  let L = rigCtls.get(key);
  if (L) return L;
  const V = rigView(), m = V && V.modules.get(key);
  L = [];
  if (m && m.el && typeof m.el.querySelectorAll === 'function') {
    let R = null;
    try { R = m.el.getBoundingClientRect(); } catch (err) { R = null; }
    const s = R && R.width > 0 && m.w > 0 ? R.width / m.w : 0;
    if (s > 0) for (const e of m.el.querySelectorAll(RIG_CTL)) {
      let r = null;
      try { r = e.getBoundingClientRect(); } catch (err) { r = null; }
      if (r && r.width > 0 && r.height > 0) L.push((r.left - R.left) / s, (r.top - R.top) / s, r.width / s, r.height / s);
    }
  }
  rigCtls.set(key, L);
  return L;
}
// the cord layer's list and anchors from cv-cables' claimed records and the ports (§4.3), and the claimed badges' places (fixer B2):
//  · (the user, 2026-10-26: "all cables should overlap at the outlet", "overlap everywhere") several cords at one jack STACK on its socket
//    like stackable patch cables — every end the jack itself, its centre, the cables diverging from there (fixer K's fan along the row
//    retired); the stack's top is the last of them in the records' order (cv-cables' claimed records: a cord plugged in this session,
//    again too, comes last), drawn last (cv-cords draws in the list's order) — a press on a stacked input grabs it (tops: rigNearest), its
//    "Which cord?" lists it first (rigStack); a forked source's BAL right of its jack;
//  · a knob end (the user, 2026-10-26: "directly to the back of the knob that it is attached to") is 'knob:<id>' on the knob's rim (its
//    own disc: cv-module kx / ky / kr) where the rope AT REST arrives radially (rigAim, on the layer's own shape: fixer K, P2-1) — it
//    goes in behind the knob there (cv-cords s 2; the anchor carries the disc, so the layer cuts the rope at the rim: P2-2) —; several
//    cords onto one knob spread ≥ RIG_SEP apart round it (rigSpread) and ring it in their colours, each segment facing its cord; a
//    hidden / folded knob's end: the bar corner, as before;
//  · a claimed mod row's badge on its rope at rest just outside the rim, off every control and every badge placed before it (rigBadge)
const RIG_SEP = 40 * Math.PI / 180;
// ((fixer K, review P2-1) the drawn rope AT REST between A and B — the layer's shape(): the settled Studio rope with motion (a rig's cords
// open there: cv-cords rest), the parabola still / SVG — what badges sit on and knob ends are aimed along; cached by its ends and the
// layer's quality, cleared at every render)
const RIG_PTS = 2 + 8 * 4; // (High's drawn points: the most a rope has)
const rigShapeC = new Map();
function rigShape(C, A, B) {
  const q = C ? String(C.perf || '') + String(C.mode || '') : '';
  const key = q + '|' + Math.round(A.x * 16) + ',' + Math.round(A.y * 16) + ',' + Math.round(B.x * 16) + ',' + Math.round(B.y * 16);
  let s = rigShapeC.get(key);
  if (s) return s;
  const P = new Float64Array(2 * RIG_PTS);
  let m = C && typeof C.shape === 'function' ? C.shape(A, B, P) | 0 : 0;
  if (!(m >= 2)) m = cvCordsMod.restPath(A.x, A.y, B.x, B.y, P, cvCordsMod.CORD_Q.high); // (a layer without shape(): High's)
  if (rigShapeC.size > 4000) rigShapeC.clear();
  s = { P, m };
  rigShapeC.set(key, s);
  return s;
}
// a drawn rope's last heading (its last segment of any length) → [dx, dy]
function rigEndDir(P, m) {
  let k = m - 1;
  while (k > 1 && P[2 * k] === P[2 * k - 2] && P[2 * k + 1] === P[2 * k - 1]) k--;
  return [P[2 * k] - P[2 * k - 2], P[2 * k + 1] - P[2 * k - 1]];
}
// a drawn rope lies on disc O (x, y, r) before its end (by more than half a px): it would poke into the knob
function rigInside(P, m, O) {
  const rr = (O.r - 0.5) * (O.r - 0.5);
  for (let i = 0; i < m - 1; i++) { const x = P[2 * i] - O.x, y = P[2 * i + 1] - O.y; if (x * x + y * y < rr) return true; }
  return false;
}
// the rim angle on knob disc O (x, y, r) where the rope at rest from S arrives radially (its last heading points at the centre): three
// steps from the angle toward S — the last one whose rope stays off the knob's face, else toward S (a modulator straight above: its
// rope's slack fold would wrap the knob — the layer cuts it at the rim instead); C the cord layer (its shape), cached by S and O
const rigAimC = new Map();
function rigAim(S, O, C) { // ((the ends to 1 px: a drag's frames reuse an aim within 0.5 px of the source — < 0.2° at a cord's length)
  const key = [S.x, S.y, O.x, O.y, O.r].map(v => Math.round(v)).join(',') + (C ? String(C.perf || '') + String(C.mode || '') : '');
  const hit = rigAimC.get(key);
  if (hit != null) return hit;
  const th0 = Math.atan2(S.y - O.y, S.x - O.x);
  let th = th0, ok = null;
  for (let i = 0; i < 4; i++) {
    const ex = O.x + O.r * Math.cos(th), ey = O.y + O.r * Math.sin(th);
    if (Math.hypot(ex - S.x, ey - S.y) < 1) break;
    const s = rigShape(C, S, { x: ex, y: ey });
    if (!rigInside(s.P, s.m, O)) ok = th;
    if (i === 3) break;
    const [dx, dy] = rigEndDir(s.P, s.m);
    th = Math.atan2(-dy, -dx);
  }
  const r = ok != null ? ok : th0;
  if (rigAimC.size > 4000) rigAimC.clear();
  rigAimC.set(key, r);
  return r;
}
// the cords onto one knob ≥ RIG_SEP apart round it (fewer than a circle's worth: 2π / n): sorted, cut at the widest gap, then clusters
// merged where they crowd, each centred on its cords' own angles (the label-placement rule) — in place on g[].th
function rigSpread(g) {
  const n = g.length, TAU = 2 * Math.PI;
  if (n < 2) return;
  const sep = Math.min(RIG_SEP, TAU / n);
  g.sort((a, b) => a.th - b.th || (a.c.id < b.c.id ? -1 : 1));
  let gi = n - 1, gw = -1;
  for (let i = 0; i < n; i++) { const w = (i === n - 1 ? g[0].th + TAU : g[i + 1].th) - g[i].th; if (w > gw) { gw = w; gi = i; } }
  const st = (gi + 1) % n, run = [];
  for (let j = 0; j < n; j++) { const q = (st + j) % n; run.push({ x: g[q], w: g[q].th + (q < st ? TAU : 0) }); }
  let cl = run.map(r => ({ L: [r], c: r.w }));
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 1; i < cl.length; i++) {
      const a = cl[i - 1], b = cl[i];
      if (b.c - (b.L.length - 1) / 2 * sep - (a.c + (a.L.length - 1) / 2 * sep) < sep - 1e-9) {
        const L = a.L.concat(b.L);
        cl.splice(i - 1, 2, { L, c: L.reduce((s, r) => s + r.w, 0) / L.length });
        merged = true;
        break;
      }
    }
  }
  for (const k of cl) k.L.forEach((r, j) => { r.x.th = k.c + (j - (k.L.length - 1) / 2) * sep; });
}
// a claimed mod row's badge: its width on the glass (its amount, its tags: cv-cables' text), its visible RIG_BADGE_VH and its RIG_BADGE_H
// hit, at zoom k in world px — walked back along the rope at rest (the layer's shape, cut at the knob's rim: what is drawn) from its end at
// E toward the source S, the first place (on the rope, else beside it: the visible badge's half extent off it — fixer K, P2-1) whose hit
// box covers no control and no badge placed before it; none: just outside the rim
const RIG_BADGE_H = 44, RIG_BADGE_VH = 18;
const rigBadgeW = c => 14 + 6.6 * String(c.badge || cvCables.amtText(c.amt, c.bi)).length + (c.dashed ? 66 : 0) + (c.preset ? 46 : 0);
// the obstacles a relayout's badges avoid: every module's rect, its controls in world px (made when a badge first overlaps it), the
// badges placed so far — built once a relayout
function rigObs(placed) {
  const V = rigView(), M = [];
  if (V) for (const key of V.modules.keys()) { const r = rigRectOf(key); if (r) M.push({ key, x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h, c: null }); }
  return { M, placed };
}
// a badge's place by record id, kept while its cord's ends, the zoom and its width stay and its box stays clear (a module drag places again
// the badges of the cords it moves and those it slides under, not every badge) — cleared at every render, with the controls
const rigBadgeC = new Map();
function rigFree(O, x0, y0, x1, y1) {
  for (const b of O.placed) if (x0 < b[2] && x1 > b[0] && y0 < b[3] && y1 > b[1]) return false;
  for (const m of O.M) {
    if (x0 >= m.x1 || x1 <= m.x0 || y0 >= m.y1 || y1 <= m.y0) continue;
    if (!m.c) { const C = rigCtl(m.key); m.c = new Float64Array(C.length); for (let i = 0; i < C.length; i += 4) { m.c[i] = m.x0 + C[i]; m.c[i + 1] = m.y0 + C[i + 1]; m.c[i + 2] = m.c[i] + C[i + 2]; m.c[i + 3] = m.c[i + 1] + C[i + 3]; } }
    const c = m.c;
    for (let i = 0; i < c.length; i += 4) if (x0 < c[i + 2] && x1 > c[i] && y0 < c[i + 3] && y1 > c[i + 1]) return false;
  }
  return true;
}
function rigBadge(c, S, E, k, O, C, K) {
  const bw = rigBadgeW(c) / k, bh = RIG_BADGE_H / k, vh = RIG_BADGE_VH / k, air = 2 / k;
  if (!(Math.hypot(E.x - S.x, E.y - S.y) >= 1)) return null;
  const sh = rigShape(C, S, E), P = sh.P.slice(0, 2 * sh.m);
  const m = K ? cvCordsMod.clip(P, sh.m, K.x, K.y, K.r) + 1 : sh.m; // (the rope as drawn: cut at the knob's rim)
  const cum = new Float64Array(m);
  for (let i = 1; i < m; i++) cum[i] = cum[i - 1] + Math.hypot(P[2 * i] - P[2 * i - 2], P[2 * i + 1] - P[2 * i - 1]);
  const Lt = cum[m - 1], end = { x: P[2 * m - 2], y: P[2 * m - 1] };
  if (!(Lt > 0)) return null;
  const at = d => { // the point at arc length d from S, and the unit tangent there
    let i = 1;
    while (i < m - 1 && cum[i] < d) i++;
    const l = cum[i] - cum[i - 1], u = l > 0 ? Math.max(0, Math.min(1, (d - cum[i - 1]) / l)) : 0, tx = P[2 * i] - P[2 * i - 2], ty = P[2 * i + 1] - P[2 * i - 1], tl = Math.hypot(tx, ty) || 1;
    return { x: P[2 * i - 2] + tx * u, y: P[2 * i - 1] + ty * u, tx: tx / tl, ty: ty / tl };
  };
  const hw = bw / 2 + air, hh = bh / 2 + air, N = Math.max(16, Math.min(160, Math.ceil(Lt * k / 8)));
  let pick = null, near = null;
  for (let i = N - 1; i >= 1 && !pick; i--) {
    const q = at(Lt * i / N), nx = -q.ty, ny = q.tx;
    const off = (Math.abs(nx) * bw + Math.abs(ny) * vh) / 2 + air; // ((fixer K, P2-1) beside the rope: the visible badge touches it
    if (!near && Math.hypot(q.x - end.x, q.y - end.y) > Math.hypot(bw, bh) / 2) near = q;
    for (const o of [0, off, -off]) { const cx = q.x + nx * o, cy = q.y + ny * o; if (rigFree(O, cx - hw, cy - hh, cx + hw, cy + hh)) { pick = { x: cx, y: cy }; break; } }
  }
  const q = pick || near || at(Lt * (N - 1) / N);
  O.placed.push([q.x - bw / 2, q.y - bh / 2, q.x + bw / 2, q.y + bh / 2]);
  return { x: q.x, y: q.y };
}
function rigLayer(L, P, k) {
  const t = trk(), C = cvCords(), A = new Map(P || []), cords = [], rings = [], knobs = new Map(), badges = new Map(), forks = new Map(), tops = new Map(), ends = new Map();
  const at = key => (P && typeof P.get === 'function' ? P.get(key) : P ? P[key] : null), kk = k > 0 && isFinite(k) ? k : 1;
  const recs = L.map(c => Object.assign(toCord(c, t), { rec: c }));
  const n = new Map(); // ((the user, 2026-10-26) a stacked input's top: its last cord in the records' order — what a press there grabs
  for (const c of recs) if (!isKnobEnd(c.rec)) { n.set(c.b, (n.get(c.b) || 0) + 1); tops.set(c.b, c.id); }
  for (const [j, m] of n) if (m < 2) tops.delete(j);
  for (const c of recs) { // (a forked source's BAL: right of its jack)
    if (!c.rec.fork || forks.has(c.rec.a)) continue;
    const p = at(c.rec.a);
    if (p) forks.set(c.rec.a, { x: p.x + 14 + 6, y: p.y });
  }
  for (const c of recs) {
    if (!isKnobEnd(c.rec)) continue;
    const K = at(c.rec.b), S = A.get(c.a) || at(c.rec.a), key = 'knob:' + c.id;
    c.b = key;
    if (!K || !S) continue;
    if (K.hid || !(K.r > 0)) { A.set(key, { x: K.x, y: K.y }); continue; } // (a knob no view shows / a folded module: its bar's corner)
    const O = Number.isFinite(K.kr) && K.kr > 0 ? { x: K.kx, y: K.ky, r: K.kr } : { x: K.x, y: K.y, r: K.r };
    if (!knobs.has(c.rec.b)) knobs.set(c.rec.b, []);
    knobs.get(c.rec.b).push({ c, S, O, th: rigAim(S, O, C) });
  }
  for (const [b, g] of knobs) {
    rigSpread(g);
    for (const x of g) A.set(x.c.b, { x: x.O.x + x.O.r * Math.cos(x.th), y: x.O.y + x.O.r * Math.sin(x.th), kx: x.O.x, ky: x.O.y, kr: x.O.r }); // ((fixer K, P2-2) the disc: the layer cuts the rope at its rim
    const i = b.indexOf(':');
    rings.push({ dev: b.slice(0, i), pid: b.slice(i + 1), segs: g.map(x => ({ c: x.c.c, th: x.th })) });
  }
  let O = null;
  const placed = [], seen = new Set();
  for (const c of recs) { // (the badges, in the records' order: each clear of those before it)
    if (!isKnobEnd(c.rec) || c.rec.kind !== 'mod') continue;
    const K = at(c.rec.b), E = A.get(c.b), S = A.get(c.a) || at(c.rec.a);
    if (!K || K.hid || !(K.r > 0) || !E || !S) continue;
    const disc = Number.isFinite(E.kr) ? { x: E.kx, y: E.ky, r: E.kr } : null;
    const w = rigBadgeW(c.rec), key = [S.x, S.y, E.x, E.y].map(v => Math.round(v * 2)).join(',') + '|' + kk + '|' + w, hit = rigBadgeC.get(c.id);
    const hw = w / kk / 2 + 2 / kk, hh = RIG_BADGE_H / kk / 2 + 2 / kk;
    let q = hit && hit.key === key ? hit.q : null;
    if (q && !rigFree(O || (O = rigObs(placed)), q.x - hw, q.y - hh, q.x + hw, q.y + hh)) q = null; // (still clear: a module moved under it — placed again)
    if (q) placed.push([q.x - w / kk / 2, q.y - RIG_BADGE_H / kk / 2, q.x + w / kk / 2, q.y + RIG_BADGE_H / kk / 2]);
    else { q = rigBadge(c.rec, S, E, kk, O || (O = rigObs(placed)), C, disc); if (q) rigBadgeC.set(c.id, { key, q }); }
    seen.add(c.id);
    if (q) badges.set(c.id, q);
  }
  for (const id of rigBadgeC.keys()) if (!seen.has(id)) rigBadgeC.delete(id);
  for (const c of recs) {
    cords.push({ id: c.id, a: c.a, b: c.b, c: c.c, s: c.s, o: c.o, rest: true }); // ((fixer K, P2-1) a rig's cord opens at rest: where its badge is aimed
    const a = A.get(c.a), b = A.get(c.b);
    if (a && b) ends.set(c.id, { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } });
  }
  return { cords, anchors: A, rings, badges, forks, tops, ends, P };
}
// ((WC, integration fixer K; review B5 / P2-3) what a press on rig jack el at p (world px, zoom k) is on (cv-cables' jackAt): the nearest
// of its module's jack centres within max(22 screen px, half the 64 px column) → { el, rec } — rec: a stacked input's top cord (the user,
// 2026-10-26: its plugs on the one socket, the newest on top: what a drag grabs), else null (the jack's default) —, else null (the press
// keeps el)
const RIG_HALF = 32; // (half the RIG grid's column: rig-ui GRID.col 64)
function rigNearest(V, p, k, mod) { // (mod null: every rig jack — data-cv-awake, rig-ui's jack rows)
  const R = rigLast, P = R && R.P ? R.P : V.ports(), get = key => (P && typeof P.get === 'function' ? P.get(key) : P ? P[key] : null);
  let best = null, bd = Math.max(22 / (k > 0 ? k : 1), RIG_HALF);
  for (const J of V.jacks()) {
    if (!J.el || (mod != null ? J.mod !== mod : typeof J.el.getAttribute !== 'function' || J.el.getAttribute('data-cv-awake') == null)) continue;
    const c = get(J.id);
    if (c && isFinite(c.x)) { const d = Math.hypot(c.x - p.x, c.y - p.y); if (d <= bd) { bd = d; best = { el: J.el, rec: J.dir === 'in' && R && R.tops ? R.tops.get(J.id) || null : null }; } }
  }
  return best;
}
function rigJackAt(el, p, k) {
  const V = rigView(), id = el && typeof el.getAttribute === 'function' ? el.getAttribute('data-cv-jack') : null;
  if (!V || !id || !p || !isFinite(p.x) || !isFinite(p.y)) return null;
  const i = id.lastIndexOf('.');
  return i > 0 ? rigNearest(V, p, k, id.slice(0, i)) : null;
}
// ((WC, fixer K; review P2-3 and its skeptics) a press on no jack (cv-world setJackNear): the empty canvas, a rig module's sleeping face
// (all of it: its controls sleep), an awake face where no control is (RIG_CTL: a knob, a switch, a button, a screen, the bar keep theirs)
// → the nearest rig jack within max(22 screen px, half the column) — past a face's edge too, which clips the jacks' own circles; another
// module's body keeps its press. Both drawing modes (lines: the same faces)
function rigNearJack(p, k, t, o) {
  const V = rigView(), tr = trk();
  if (!V || cvMaster || !tr || !isRigDev(tr, curOf(tr)) || !p || !o || !isFinite(p.x) || !isFinite(p.y)) return null; // (no rig on the canvas: nothing to do)
  if (!o.empty) {
    if (!o.mod || !V.jacks().some(J => J.mod === o.mod && J.el && typeof J.el.getAttribute === 'function' && J.el.getAttribute('data-cv-awake') != null)) return null;
    if (!o.sleep) { let c = null; try { c = t && typeof t.closest === 'function' ? t.closest(RIG_CTL) : null; } catch (err) { c = null; } if (c) return null; }
  }
  const q = rigNearest(V, p, k, null);
  return q ? q.el : null;
}
// a rig jack's element and its module by jack key ('i1/filter.in', 'i1.main') — a lookup in its module, no walk (a drag's frames read no DOM)
function rigJackEl(V, key) {
  const i = String(key).lastIndexOf('.'), m = i > 0 && V ? V.modules.get(key.slice(0, i)) : null;
  if (!m || typeof m.jack !== 'function') return null;
  let el = null;
  try { el = m.jack(key.slice(i + 1)) || null; } catch (err) { el = null; }
  return el ? { el, m } : null;
}
// the knobs a cord goes into wear a ring in its colour (data-rig-cord: the rig chrome's CSS), so the end reads; several cords: a segmented
// ring, each segment facing its cord (--rig-ring, a conic gradient on the knob's disc; its place in the control measured once); set
// where the knob is shown, cleared where it no longer is
const RIG_RING = ['#d8432f', '#e6b83a', '#3f80d8', '#41a75c', '#e9e5da', '#e27c2f', '#9060c9', '#8a8c90']; // (cv-cords PALETTE; its black lifted, style.css's)
const rigDisc = new WeakMap(); // (a knob control → its disc's centre / size in it, CSS px)
function rigRingCss(segs) { // the segments' conic gradient (CSS: 0deg up, clockwise), a 4° gap between colours
  const L = segs.map(x => ({ c: RIG_RING[x.c] || RIG_RING[4], f: ((Math.round((x.th * 180 / Math.PI + 90) / 5) * 5) % 360 + 360) % 360 })).sort((a, b) => a.f - b.f), n = L.length;
  const B = L.map((x, i) => (x.f + (i === n - 1 ? L[0].f + 360 : L[i + 1].f)) / 2), from = B[n - 1] - 360, out = [];
  L.forEach((x, i) => { const s0 = (i ? B[i - 1] : B[n - 1] - 360) - from, s1 = B[i] - from; out.push('transparent ' + s0 + 'deg ' + (s0 + 2) + 'deg', x.c + ' ' + (s0 + 2) + 'deg ' + (s1 - 2) + 'deg', 'transparent ' + (s1 - 2) + 'deg ' + s1 + 'deg'); });
  return 'conic-gradient(from ' + from + 'deg, ' + out.join(', ') + ')';
}
function rigDiscOf(el) {
  let d = rigDisc.get(el);
  if (d) return d;
  const S = wkDiscBox(el); // (the kit's one measure: cv-module's knob ends — the cord's rim, its badge — and cv-cables' aim read the same disc)
  if (!S) return null;
  const R = el.getBoundingClientRect(), s = R.width > 0 && el.offsetWidth > 0 ? R.width / el.offsetWidth : 1;
  d = { x: (S.left + S.width / 2 - R.left) / s, y: (S.top + S.height / 2 - R.top) / s, d: S.width / s };
  rigDisc.set(el, d);
  return d;
}
let rigRingOn = []; // ([knob element, its colour, its segments' gradient | ''] as last set)
function rigRings(R) {
  const V = rigView(), want = [];
  if (V) for (const x of R) { const el = rigDestOf(V, x.dev, x.pid); if (el) want.push([el, String(x.segs[0].c), x.segs.length > 1 ? rigRingCss(x.segs) : '']); }
  if (want.length === rigRingOn.length && want.every((w, i) => w[0] === rigRingOn[i][0] && w[1] === rigRingOn[i][1] && w[2] === rigRingOn[i][2] && w[0].isConnected !== false)) return; // (the same knobs, the same rings)
  for (const [e] of rigRingOn) { e.removeAttribute('data-rig-cord'); e.removeAttribute('data-rig-ring'); }
  for (const [el, c, css] of want) {
    el.setAttribute('data-rig-cord', c);
    const d = css ? rigDiscOf(el) : null;
    if (d && el.style && typeof el.style.setProperty === 'function') {
      el.setAttribute('data-rig-ring', '');
      el.style.setProperty('--rig-ring', css); el.style.setProperty('--rig-rx', d.x + 'px'); el.style.setProperty('--rig-ry', d.y + 'px'); el.style.setProperty('--rig-rd', d.d + 'px');
    }
  }
  rigRingOn = want;
}
// a knob's element by 'dev:pid' (looked up once a render: a module drag walks no DOM)
const rigDestC = new Map();
function rigDestOf(V, dev, pid) {
  const key = dev + ':' + pid;
  let el = rigDestC.get(key);
  if (el && el.isConnected !== false) return el;
  el = null;
  for (const [k, m] of V.modules) { if ((k === dev || k.startsWith(dev + '/')) && (el = rigDestEl(m.el, pid))) break; }
  if (el) rigDestC.set(key, el); else rigDestC.delete(key);
  return el;
}
function rigDestEl(root, pid) { // the first [data-dest="pid"] element under root that has a box (a hidden page's twin skipped)
  const st = [root];
  while (st.length) {
    const n = st.pop();
    for (const c of n.children || []) {
      if (!c || typeof c.getAttribute !== 'function') continue;
      if (c.getAttribute('data-dest') === pid && c.getAttribute('data-twin') == null && (typeof c.getClientRects !== 'function' || c.getClientRects().length)) return c;
      st.push(c);
    }
  }
  return null;
}
// ((WC, fixer B2; review 2 P2-4: the regret path) lines mode: a rig's internal lines run under the faces to jacks inside them — each jack
// a line arrives at or leaves wears a ring in the line's colour (the group colour), one more ring for each further line (a Σ input's
// count), so which jack a line uses reads where the line itself is hidden
let rigLineOn = []; // ([element, its rings] as last set)
function rigLineRings(on) {
  const V = rigView(), t = trk(), J = new Map(), want = [];
  if (on && V) for (const c of V.cables.list()) {
    if (!c || !c.int || c.stub || typeof c.a !== 'string' || typeof c.b !== 'string' || !isRigDev(t, c.dev)) continue;
    for (const j of [c.a, c.b]) { if (!J.has(j)) J.set(j, []); J.get(j).push(c.color || t.color || '#8d8b86'); }
  }
  if (J.size) for (const x of V.jacks()) {
    const L = J.get(x.id);
    if (!L || !x.el || typeof x.el.setAttribute !== 'function') continue;
    want.push([x.el, L.length, L.slice(0, 3).map((c, i) => '0 0 0 ' + (2 + 4 * i) + 'px #0c0d0f, 0 0 0 ' + (4 + 4 * i) + 'px ' + c).reverse().join(', ')]);
  }
  if (want.length === rigLineOn.length && want.every((w, i) => w[0] === rigLineOn[i][0] && w[2] === rigLineOn[i][2] && w[0].isConnected !== false)) return; // (the same jacks, the same rings)
  for (const [e] of rigLineOn) { e.removeAttribute('data-rig-line'); if (e.style && typeof e.style.removeProperty === 'function') e.style.removeProperty('--rig-lines'); }
  for (const [e, n, sh] of want) { e.setAttribute('data-rig-line', String(n)); if (e.style && typeof e.style.setProperty === 'function') e.style.setProperty('--rig-lines', sh); }
  rigLineOn = want;
}
// cv-cables onRecords → the cord layer (cords mode on this canvas) and the claimed badges' places (its answer); leaving it (lines, another
// track's canvas) clears the rig's cords — lines mode rings the jacks its lines use
let rigCordsOn = false, rigLast = null, rigLaid = false; // (rigLaid: records came — cvRender lays the view's again once it is the track's)
function rigRecords(L, P, k) {
  rigLaid = true;
  const C = cvCords(), t = trk(), cm = drawMode(t) === 'cords';
  rigLineRings(!cm && !cvMaster && isRigDev(t, curOf(t)));
  if (!C || !cm) { if (rigCordsOn) { rigCordsOn = false; rigLast = null; if (C && !ptShown()) C.set([]); rigRings([]); } return null; }
  rigCordsOn = true;
  const R = rigLayer(Array.isArray(L) ? L : [], P, k > 0 ? k : (cvW() && cvW().k) || 1);
  rigLast = R;
  C.set(R.cords);
  C.anchors(R.anchors);
  rigRings(R.rings);
  return { badges: R.badges, forks: R.forks, ends: R.ends }; // ((fixer K) ends: a claimed cord's tag above its own plug (P3-6)
}
// ((the user, 2026-10-26: stacked plugs, the newest on top) the rig's records in the stack's order — the cord layer's (the records': a cord
// plugged in this session, again too, last) where it shows them, else edges()' — so a jack's "Which cord?" lists its top first
function rigStack(E) {
  const R = rigCordsOn ? rigLast : null;
  if (!R || !R.cords.length) return E;
  const o = new Map(R.cords.map((c, i) => [c.id, i])), n = R.cords.length;
  return E.map((r, i) => [r, o.has(r.id) ? o.get(r.id) : n + i]).sort((a, b) => a[1] - b[1]).map(x => x[0]);
}
// a live rope's look from a rig jack (cv-cables cordLook): the source's colour, a plug in the finger
function rigLook(jk) {
  const t = trk(), m = /^([a-z][a-z0-9]*)[./]/.exec(String(jk || '')), dev = m ? m[1] : null;
  if (!dev || !isRigDev(t, dev)) return { c: 4, s: 0, o: 1 };
  return { c: RC.cordColor(rigSrcEnd(dev, jk) || '', t.dev[dev].rig), s: 0, o: 1 };
}
// a re-patch of a cord's input plug (cv-cables' grab dropped on another input): rig-core repatch, one step
function rigRepatch(id, a, b) {
  const t = trk(), m = /^x:([a-z][a-z0-9]*):/.exec(String(id || '')), dev = m ? m[1] : null;
  if (!dev || !isRigDev(t, dev)) return false;
  const B = SE.endOf(dev, b), d = t.dev[dev];
  if (!B) { notice(RC.WORDS.other, 4000); return false; }
  const r = RC.repatch(d.vals.s, fxOfDev(t, dev), id, 'b', B, rigOpts(t, dev)), rec = rigEdges(t, dev).find(x => x.id === id);
  return rigEdit(t, dev, 'Re-patch ' + (rec ? rigEndLabel(t, dev, rec.edge.a) : 'cord') + ' → ' + rigEndLabel(t, dev, B), r);
}
// a cord pulled away from any jack (cv-cables onPull): a rig cord → rig-core pull (the amp cord: envFromAmp, its own words); a mod row →
// its Disconnect — "Cord pulled · tap to undo"
function rigPull(id) {
  const t = trk(), m = /^x:([a-z][a-z0-9]*):/.exec(String(id || ''));
  if (m && isRigDev(t, m[1])) {
    const dev = m[1], d = t.dev[dev], rec = rigEdges(t, dev).find(x => x.id === id);
    const r = RC.pull(d.vals.s, fxOfDev(t, dev), id, rigOpts(t, dev));
    return rigEdit(t, dev, 'Pull ' + (rec ? rigEndLabel(t, dev, rec.edge.a) + ' → ' + rigEndLabel(t, dev, rec.edge.b) : 'cord'), r, { notice: r.notes && r.notes.length ? r.notes.join(' · ') : RC.WORDS.cordPulled.replace(/ · tap to undo$/, '') });
  }
  const c = cvView && cvView.cables.list().find(x => x.id === id);
  if (!c || c.kind !== 'mod') return false;
  if (c.own && isRigDev(t, c.dev)) { modCableAct(id, 'disconnect'); return true; } // (a rig's own row: rigRowEdit says "Cord pulled · tap to undo" itself — once, review WC-int P3-18)
  const n0 = hist.u.length;
  modCableAct(id, 'disconnect');
  if (hist.u.length > n0) { const step = hist.u[hist.u.length - 1]; cvUndoNotice(RC.WORDS.cordPulled, step, () => null); } else notice(RC.WORDS.cordPulled.replace(/ · tap to undo$/, ''), 3000);
  return true;
}
// a modulation cord's knob end moved to another knob (its badge dragged, cv-cables onRepatchMod): a canvas row one step "Re-patch …"; the
// rig's own row (its matrix) re-aimed in the panel (its own undo) on the same instrument
function rigRepatchMod(id, dst) {
  const t = trk(), c = cvView && cvView.cables.list().find(x => x.id === id), D = modSplit(dst);
  if (!c || c.kind !== 'mod' || !D) return false;
  if (c.own || c.preset) {
    if (D.dev !== c.dev) { notice('This row stays on its ' + RIG.NAME + ' · drag from the module’s jack for another instrument', 4000); return false; }
    const d = t.dev[c.dev], r = CMOD.destOk(d, D.pid);
    if (!r.ok) { notice(modRefusal('nomod'), 4000); return false; }
    if (c.own && isRigDev(t, c.dev)) return rigRowEdit(t, c.dev, 'Re-patch ' + rigRowSrc(t, c) + ' → ' + modLabel(dst, t), T => { if (!T.matrix[c.slot]) return false; T.matrix[c.slot].dst = D.pid; }); // ((review 2 P2-1) one step
    const rec = sxRecOf(t.id, c.dev), fn = s => { if (s.matrix[c.slot]) s.matrix[c.slot].dst = D.pid; };
    if (rec && rec.ui && rec.trackId === t.id && !rec.ui.dead) rec.ui.edit(fn, { label: 'Move Modulation' }); else sxEdit(instView(t, c.dev), fn);
    cvModAfter(t); cvModSync();
    return true;
  }
  const row = (t.mods || []).find(x => x && x.id === id);
  if (!row) return false;
  const ok = modCan(row.src, dst);
  if (!ok.ok) { notice(ok.why, 4000); return false; }
  hist.record(project, 'Re-patch ' + modLabel(row.src) + ' → ' + modLabel(dst));
  row.dst = dst;
  cvModAfter(t); cvModSync();
  return true;
}
// rig-ui's host (the jack row's tap menu) and the faces' builder, made once the panels loaded (uiMods: rig-ui with sx-ui-mod)
function rigUiOf(M) {
  if (RIGUI !== null) return RIGUI;
  if (!M || !M.rig || typeof M.rig.rigHost !== 'function') { RIGUI = false; return RIGUI; }
  const cur = () => { if (cvMaster) return null; const t = trk(), dev = curOf(t); if (!isRigDev(t, dev)) return null; const d = t.dev[dev]; return { t, dev, s: d.vals.s, fx: fxOfDev(t, dev), rig: d.rig }; };
  const opt = () => { const C = cur(); return C ? rigOpts(C.t, C.dev) : {}; };
  RIGUI = M.rig.rigHost({
    doc: document, world: () => cvW(), cur, view: () => cvView,
    rec: (t, dev) => rigStack(rigEdges(t, dev)).map(r => Object.assign({}, r, { a: r.edge.a, b: r.edge.b })), // ((the user, 2026-10-26) a stack's top first in its "Which cord?"
    edit: (t, dev, label, r) => rigEdit(t, dev, label, r, { quiet: true }),
    colour: (t, dev, src, c) => rigColour(t, dev, src, c),
    notice: (text, ms, onTap) => {
      if (onTap) { const step = hist.u[hist.u.length - 1]; noticeActs.set(text, () => { noticeActs.delete(text); notice('', 0); if (step && hist.u[hist.u.length - 1] === step) onTap(); }); }
      notice(text, ms);
    },
    undo: () => undo(),
    menu: (x, y, items, opts) => { rigMenuLast = items; return wkContextMenu(x, y, items, opts); }, // (the kit's menu; its items kept for the hook)
    title: (t, dev, part) => rigLabel(t, dev, part),
    can: (s, fx, a, b) => { const C = cur(); return RC.can(s, fx, a, b, C ? { used: sxUsed(C.t, C.dev), rig: C.t.dev[C.dev].rig } : null); }, // (the link rows: Envelope 1 read as the gate; the names)
    plug: (s, fx, a, b) => RC.plug(s, fx, a, b, opt()),
    pull: (s, fx, id) => RC.pull(s, fx, id, opt()),
    repatch: (s, fx, id, end, b) => RC.repatch(s, fx, id, end, b, opt()),
  });
  rigSkin();
  return RIGUI;
}
// sx-host's ENV moves with ENV 1 a party on a rig (its Swap with ▸, its label drag): through rig-core (envToAmp — Envelope k takes the level
// over —; with ENV 1 a real envelope: refused, "pull it first"), so the re-law, the lay rename and the gate rules always hold (§3.4) →
// handled
function rigEnvSwap(t, dev, a, b) {
  if (!isRigDev(t, dev) || !(a === 'env1' || b === 'env1') || a === b || !/^env[1-4]$/.test(a) || !/^env[1-4]$/.test(b)) return false;
  const k = a === 'env1' ? b : a, d = t.dev[dev], s = d.vals.s;
  if (!RC.isGate(s)) { notice(RC.WORDS.ampHeld(RC.ordinalOf(d.rig, 'env1')), 4000); return true; } // ((pre-deploy [amp-held]) the amp slot's module by its name)
  const r = RC.envToAmp(s, k, rigOpts(t, dev));
  rigEdit(t, dev, 'Plug ' + rigLabel(t, dev, k) + ' → ' + RC.MODULES.amp.label + ' · LEVEL', r);
  return true;
}
// ⋯ → Init on the amp Envelope = envFromAmp (§3.4; review 1 P3-1): the gate on LEVEL again, the module stays — unplugged, at the first
// free slot, its name and values kept (Init never deletes a module) — one step; no free slot: refused, said. Envelope 1 standing as
// the gate (read): nothing to init — said, no step (the kit's Init would make it a real envelope)
function rigEnvInit(t, dev) {
  if (!isRigDev(t, dev)) return false;
  const d = t.dev[dev], s = d.vals.s;
  if (RC.isGate(s)) { notice(RC.WORDS.gate, 4000); return false; }
  return rigEdit(t, dev, 'Init ' + rigLabel(t, dev, 'env1'), RC.envFromAmp(s, rigOpts(t, dev)));
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
// Stage 2b (IMPL-2b §6.3, lane D): every modulator kind (LFO, ENV, Macro, CC, Chaos, Note beside the 2a four), cables to
// classic and panel knobs (cv-model addMod; compiled by cv-graph compileMods into the {t: 'mods'} payload postMods sends),
// the editing bodies (one History step per gesture end: modEditState), macro knobs and CCs as {t: 'mval'} (modVal), the
// classic panels' halos from the engine's eff snapshot (cpHalos / cpSnap), the press-and-hold mod menu (classicHost.modMenu)
const MOD_TILES = cvTray.MOD_TILES; // (2b: every kind; multi-instance tiles never grey out)
const modKindOfKey = (t, key) => (key === 'wheel' ? 'wheel' : PC.PAD_ID.test(key) ? (padMod(key) ? 'pads' : null) : t && t.dev && t.dev[key] && CMOD.kindOfId(key) === t.dev[key].kind ? t.dev[key].kind : null); // ((8) 'pd<n>': a Pads module)
const modKeyOf = kind => (kind === 'wheel' ? 'wheel' : CMOD.MOD_DEV[kind] || null); // (a singleton's id; a multi kind's comes from addModDev)
const MOD_EDIT = new Set(['lfo', 'env', 'macro', 'cc', 'chaos', 'note']); // (2b: the bodies over a device's state)
const modSrcList = t => CMOD.sourcesOf(t, project).concat(CMOD.linkSources(t)); // (every source a cable may start from: the wheel, the modules, the Serums' own LFOs / ENVs)
const modDestDevs = t => (t && t.dev ? Object.keys(t.dev).filter(k => t.dev[k] && (t.dev[k].kind === 'synth' || t.dev[k].kind === 'panel')) : []); // (the devices with knobs)
const modSplit = dst => { const i = typeof dst === 'string' ? dst.indexOf(':') : -1; return i > 0 ? { dev: dst.slice(0, i), pid: dst.slice(i + 1) } : null; };
// (isSxDev, sxIds: R2's helpers, at the top)
let modLayer = null, modHostO = null, modDrag = null, modPend = null, modSelHost = false, modMenuId = null;
const modBodies = new Map(); // module key → its cv-mods-ui body (+ kind)
// the view's devices: the track's (its modulators among them) and the project's wheel once placed
function cvDevices(t) {
  const L = cvModule.devicesOf(t);
  if (CMOD.hasWheel(project)) L.push({ key: 'wheel', kind: 'mod', mod: 'wheel', model: null, dev: null });
  // ((8, §1.1, §5.4, §9; review #4) the project's Pads modules, on every track: their jacks — each mod pad's inline 'p<i>', the
  // 'notes' jack the note cables leave from — and their colour from the entry)
  for (const M of padMods()) L.push({ key: M.id, kind: 'mod', mod: 'pads', model: null, dev: null, jacks: cvPads.moduleJacks(M), color: cvPads.PADS_COLOR });
  // (milestone 3, §2.1) each Serum in parts view: its part modules (sx-edges partKeys: I1 the parts that are on, I2 the own
  // ENV / LFO slots something reads, MACROS when a macro row exists, ARP / CLIP when on, any laid-out part); (WC, §8.2) a rig, always:
  // rig-core's partKeys (+ I1', the amp slot), its own names, the canvas's drawing mode on its entries (wires: cv-module's jack rows)
  for (const dev of sxIds(t)) if (sxParts(t, dev)) {
    const wm = rigWm(t) || undefined, e = L.find(x => x.key === dev);
    if (e) Object.assign(e, { ui: 'parts' }, wm ? { wires: wm } : null);
    for (const part of sxPartList(t, dev)) L.push(Object.assign({ key: dev + '/' + part, kind: 'part', dev, part, model: t.dev[dev].model, title: rigLabel(t, dev, part) }, wm ? { wires: wm } : null));
  }
  // (9, IMPL-9 §4.1) a 900 Series: its controller — the instrument's own module — carries the console's face jacks and no fold;
  // then its modules, one 'pm' module each (cv-patch devices: compact bar, no fold, the type's fixed size, its face's jacks)
  for (const dev of patchDevs(t)) {
    const e = L.find(x => x.key === dev);
    if (e) Object.assign(e, { jacks: ptCtlJacks(t, dev), nofold: true });
    L.push(...PATCH.devices(t, dev));
  }
  return L;
}
/* ---- the 900 Series' modules (stage 9, IMPL-9 §4, §6; cv-patch's host) */
// PATCH (cv-patch patchHost; its interface in IMPL-9 §12 "Lane U9"): the shown track's 900 Series — its modules' faces (the knob
// policy: ptKnob, no step), the plug drag, Connect to… and the cord menu, add / delete / duplicate / driver / Patches… / Tidy
// (ptEdit: one History step each — the record, the knobs and the places written, the graph posted). The cord layer is the
// world's (cv-cords, lane C9: world.cords()); without it cv-patch draws nothing and every edit works the same
const ptT = t => (t && project ? project.tracks.find(x => x.id === t.id) || null : null); // (a face mounted before an undo holds the old track object)
const cvCords = () => { const W = cvW(); try { return W && typeof W.cords === 'function' ? W.cords() || null : null; } catch (err) { console.error(err); return null; } };
// the shown track's cords (none: []) and the faces from its record, the cord layer's buffer while a 900 Series is shown (§4.3)
function ptShow() {
  PATCH.sync();
  const C = cvCords(), t = trk(), pt = !cvMaster && isPatchDev(t, curOf(t)), rig = drawMode(t) === 'cords';
  if (C && !pt && !rig) { if (rigCordsOn) { rigCordsOn = false; rigLast = null; rigRings([]); } try { C.set([]); } catch (err) { console.error(err); } } // ((WC) a canvas with neither: no cords — what PATCH.sync's set([]) did before its dep answered a patch canvas only
  if (C && typeof C.alloc === 'function') { try { C.alloc(pt || rig); } catch (err) { console.error(err); } } // ((WC, §4.1) a rig canvas in cords mode: the buffer too
  ptDim();
}
// (§4.3) the cords of the shown 900 Series are drawn at 0.45 alpha while it is off: its track muted or soloed out, or its own ⏻ (cv-cords dim).
// Called where the host learns it: mix() (mute / solo), cvPower (⏻), ptShow (a track switch, an undo, a Replace, boot)
function ptDim() {
  const C = cvCords(), t = trk(), dev = t ? curOf(t) : null, off = !!dev && isPatchDev(t, dev) && !ptHeard(t, dev);
  if (off) PATCH.lamps(t, dev, null); // ((9b, IMPL-9b §1.6) and its lamps go dark: the posts are dropped until it is heard again)
  if (!C || typeof C.dim !== 'function') return;
  try { C.dim(off); } catch (err) { console.error(err); }
}
// an 'iN/m<k>' module key of track t → { dev, mid } (a module of its 900 Series' record), else null
function pmOf(t, key) {
  const i = typeof key === 'string' ? key.indexOf('/') : -1, dev = i > 0 ? key.slice(0, i) : null;
  const mid = dev && isPatchDev(t, dev) ? cvPatch.midOf(dev, key) : null;
  return mid && mid !== PT.CTL && patchOf(t, dev).mods[mid] ? { dev, mid } : null;
}
// the controller's face jacks (the console's patch jacks, cv-panel geometry + the bar: cv-patch faceJacks) — per layout object
const ptCtlJ = new WeakMap();
function ptCtlJacks(t, dev) {
  const m = modelById(t.dev[dev].model), L = hwLayoutOf(m);
  if (!L) return [];
  if (!ptCtlJ.has(L)) ptCtlJ.set(L, cvPatch.faceJacks(L, m, PT.title(patchOf(t, dev), PT.CTL)));
  return ptCtlJ.get(L);
}
let ptUp = false; // (the world is built: PATCH.attach — cvW is read only from then on)
const PATCH = cvPatch.patchHost({
  doc: document, world: () => (ptUp ? cvW() : null), kit: classicHost.kit,
  cur: () => { if (cvMaster) return null; const t = trk(), dev = curOf(t); return isPatchDev(t, dev) ? { t, dev } : null; }, // ((M) the master canvas shows no patch
  rec: (t, dev) => { const x = ptT(t); return x ? patchOf(x, dev) : null; },
  vals: (t, dev) => { const x = ptT(t); return x && isPatchDev(x, dev) ? x.dev[dev].vals : null; },
  edit: (t, dev, label, r) => ptEdit(ptT(t), dev, label, r),
  knob: (t, dev, mid, id, v, ph) => ptKnob(ptT(t), dev, mid, id, v, ph),
  view: () => cvView, cords: () => (ptShown() ? cvCords() : null), // ((WC, skeptic P2-2) the layer is the patch canvas's only here: on a rig canvas it holds the rig's cords
  // (a "tap to undo" undoes its own step only while it is still the newest: a later edit is never undone by an old notice)
  notice: (text, ms, onTap) => {
    if (onTap) { const step = hist.u[hist.u.length - 1]; noticeActs.set(text, () => { noticeActs.delete(text); notice('', 0); if (step && hist.u[hist.u.length - 1] === step) onTap(); }); }
    notice(text, ms);
  },
  undo: () => undo(true),
  show: key => modShow(key), // ((9c fix, review 2 F2) a module tapped in / duplicated: off the band, the camera brings it in — the modulators' rule)
  // (9b, IMPL-9b §1.5, §1.6) a face's momentary event to the node (ptEv); the lamps' heard clock (the drums')
  ev: (t, dev, mid, id) => ptEv(ptT(t), dev, mid, id),
  heard: ts => (ctx && ctx !== holdCtx ? outFrame(ts) : NaN), rate: () => (ctx ? ctx.sampleRate : 48000),
  playing: () => !!T.playing, // ((9b, review 2 N2) a set's "starts when you press ▶" is not said while the song plays)
});
// cv-patch's edit (§1.5, U9's interface): ONE History step labelled `label` — r.back's knobs as the step's ptBack meta —, then
// the record, the knobs (r.vals) and the places (r.lay: null deletes a key) written; the knobs it wrote posted first (the graph's
// new modules snap to them, §3.3), the graph when its content changed; the canvas follows
function ptEdit(t, dev, label, r) {
  if (!t || !isPatchDev(t, dev) || !r || !r.rec || typeof r.rec !== 'object') return false;
  flush();
  hist.record(project, label);
  const step = hist.u[hist.u.length - 1], d = t.dev[dev];
  const sq = Array.isArray(r.seq) ? r.seq.filter(m => PT.isMid(m)) : []; // ((9b, review 2 F1) the sequencers the step binds: their clocks started after the graph, on its undo / redo too; (P, skeptic #1) any module number the core takes, m1…m999999)
  const bk = r.back && Array.isArray(r.back.f) && r.back.f.length;
  if (step && (bk || sq.length)) step.meta = { pt: 1, trackId: t.id, dev, f: bk ? clone(r.back.f) : [], seq: sq };
  d.patch = r.rec;
  if (r.vals) d.vals = r.vals;
  if (r.lay && typeof r.lay === 'object') {
    const lay = Object.assign({}, t.lay && typeof t.lay === 'object' ? t.lay : {});
    for (const k of Object.keys(r.lay)) { if (r.lay[k] == null) delete lay[k]; else lay[k] = r.lay[k]; }
    t.lay = lay;
  }
  if (r.vals) sendPatch(t);
  patchSend(t, dev);
  if (sq.length) ptStart(t, dev, sq);
  cvRender(); persist(); updateUndoUI();
  return true;
}
// (9b, review 2 F1) a preset / set step's sequencers: the machine reads a 960's CLOCK AT START only when it is built or reset, so a
// loaded patch gets its OSC ON / OSC OFF as an event (after the graph that holds the module); posted after the step and after its
// undo / redo (applyRestore: the knobs back, the graph re-posted)
function ptStart(t, dev, mids) { for (const [mid, id] of PATCH.starts(t, dev, mids)) ptEv(t, dev, mid, id); }
// a module face's knob (the knob policy, §1.5: no step; keepDevs keeps it through undo / redo): the value written at once (the
// face reads it back), the {t: 'patch'} (pv) at most every PT_KNOB_MS while dragging (postMods' MODS_MIN_MS), at once at its lift.
// (9b, IMPL-9b §1.4) a routing switch (a bus row's: PT.isBusKnob) is also a graph change: its payload posted at once (a flip
// is discrete; patchSend's key: an unchanged graph is not posted again) — still no step
const PT_KNOB_MS = 66;
function ptKnob(t, dev, mid, id, v, ph) {
  if (!t || !isPatchDev(t, dev)) return;
  const d = t.dev[dev], rec = patchOf(t, dev), nv = PT.setKnob(d.vals, rec, mid, id, v);
  if (nv !== d.vals) d.vals = nv;
  if (PT.isBusKnob(rec, mid, id)) patchSend(t, dev);
  const N = nodes.get(t.id), now = performance.now();
  persist();
  if (!N) return;
  if (N.ptKT) { clearTimeout(N.ptKT); N.ptKT = 0; }
  if (ph === 'end' || !(now - (N.ptKAt || 0) < PT_KNOB_MS)) { N.ptKAt = now; queuePatch(t); return; }
  N.ptKT = setTimeout(() => { N.ptKT = 0; N.ptKAt = performance.now(); const x = ptT(t); if (x && nodes.get(x.id) === N) queuePatch(x); }, Math.max(1, PT_KNOB_MS - (now - N.ptKAt)));
}
const pmBodies = new Map(); // 'iN/m<k>' → its mounted face (cv-patch moduleBody)
function pmMount(key, b) {
  pmUnmount(key);
  const t = trk(), q = pmOf(t, key);
  if (!q) return;
  const ty = patchOf(t, q.dev).mods[q.mid].t, T = PT.FAMILIES[patchOf(t, q.dev).f].types[ty];
  const B = cvPatch.moduleBody({ host: PATCH, t, dev: q.dev, mid: q.mid, type: ty, doc: document });
  b.append(B.el);
  pmBodies.set(key, B);
  if (T && Array.isArray(T.lamps) && T.lamps.length) ptLampMon(t, q.dev, key, true); // ((9b) a face with live lamps: its instrument's monitor)
}
function pmUnmount(key) { const B = pmBodies.get(key); if (!B) return false; pmBodies.delete(key); ptLampMon(null, null, key, false); B.destroy(); return true; }
// (9b, IMPL-9b §1.5) a face's momentary event (SET / SHIFT / OSC ON … — cv-patch host.ev → deps.ev): the node's {t: 'seq', i, s: {pe:
// [n, k]}} — n the module's number, k the event's index in its type's `ev` — handed to the machine at once (applied at the
// module's next chunk); live only: no value, no History step, not in the song or a bounce; nothing without a node → posted?
function ptEv(t, dev, mid, id) {
  const rec = t && nodes.get(t.id) && isPatchDev(t, dev) ? patchOf(t, dev) : null, m = rec && mid !== PT.CTL ? rec.mods[mid] : null;
  const T = m ? PT.FAMILIES[rec.f].types[m.t] : null, k = T && Array.isArray(T.ev) ? T.ev.findIndex(e => e.id === id) : -1;
  if (k < 0 || !PT.isMid(mid)) return false; // ((P, skeptic #1) the core's grammar: an m10000 posts too)
  postTo(t, { t: 'seq', s: { pe: [+mid.slice(1), k] } }, dev);
  return true;
}
// (9b, IMPL-9b §1.6, §4.5, §6) the patch lamps' monitor (beside drumMonitor): one subscription per (track, 900 Series) while a
// mounted face of it declares lamps (pmMount / pmUnmount keep its keys), live while that track is shown and one of those faces
// is (cvLive: the CANVAS view, on screen — the monitor's on-screen rule); its posts (smon {i, pt: {F, l: [n, bits, …]}}: patch-dsp
// lamps at the Track's frame) go to cv-patch's frame queue (PATCH.lamps: shown at their heard time) only while the patch is heard
// — muted, soloed out or ⏻ off its lamps go dark (ptDim → PATCH.lamps(t, dev, null)), as on a Replace or a deleted track. No hold
// while the camera moves (U9b measured the lamps during a pinch at 4× CPU: 59–60 fps with or without)
const ptMons = new Map(); // 'trackId/dev' → { keys: its mounted lamp faces' keys, off }
const ptLampKey = new Map(); // a mounted lamp face's key → its 'trackId/dev'
const ptHeard = (t, dev) => !!t && audible(t) && CG.powered(t).includes(dev);
function ptLampMon(t, dev, key, on) {
  if (!on) {
    const k = ptLampKey.get(key), E = k ? ptMons.get(k) : null;
    ptLampKey.delete(key);
    if (E && E.keys.delete(key) && !E.keys.size) { ptMons.delete(k); E.off(); }
    return;
  }
  const tid = t.id, k = tid + '/' + dev;
  let E = ptMons.get(k);
  ptLampKey.set(key, k);
  if (E) { E.keys.add(key); monitors.sync(); return; }
  E = { keys: new Set([key]), off: null };
  ptMons.set(k, E);
  E.off = monitors.sub(tid, dev, { role: 'inst', live: () => project.selTrack === tid && [...E.keys].some(x => cvLive(x)),
    deliver: d => { const x = d && d.pt ? project.tracks.find(y => y.id === tid) : null; if (x && isPatchDev(x, dev) && ptHeard(x, dev)) PATCH.lamps(x, dev, d.pt); } });
}
// the Sources view "Moog modules" (§1.4, §4.6): a module tile tapped on a 900 Series track adds it (the next free slot of its
// row), dropped on the canvas where it lands; on any other track (or + Track) a 900 Series with the controller and that module
// (Q5: "Replaced … · tap to undo"). The Model 15 tile (the m900 model tile, srcPick / srcDrag) on a 900 Series: Classic bass
// loaded as a preset — the missing Model 15 modules added, one step, its knobs back on undo (ptBack) — never a same-model Replace
const ptModel = () => MODELS.find(m => PT.isPatchModel(m.id)) || null;
function ptShown() { if (cvMaster) return null; const t = trk(), dev = curOf(t); return isPatchDev(t, dev) ? { t, dev } : null; } // ((M) none shown on the master canvas
// (9b, IMPL-9b §1.2) id: a FAMILY.sets key — 'm15' the Model 15 tile (Classic bass over the patch, its free slots: stage 9's
// step), 's35' / 's55' a set tile (its starter over the full set, the rack laid out: cv-patch setLoad's tidy, one step)
function ptSet(id = 'm15') { // (a set tile on its own instrument) → true when it was one
  const P = ptShown(), fam = P ? PT.FAMILIES[patchOf(P.t, P.dev).f] : null;
  if (!fam) return false;
  PATCH.setLoad(id);
  return true;
}
// (9b, IMPL-9b §1.2, §4.3) the set tiles System 35 / System 55 (cv-tray SET_TILES; the Model 15's is the m900 model tile): a set by
// id (moog-core SETS: name, set, starter), null for none
const setOfId = id => (typeof id === 'string' && MG.SETS && Object.prototype.hasOwnProperty.call(MG.SETS, id) ? MG.SETS[id] : null);
// a tap (mode: the tray's): on a shown 900 Series its starter over the full set (ptSet); else a Replace with a 900 Series
// holding the set (its notice names it, with the set's one-time notice), or — + Track — a new track with one
function setPick(id, mode) {
  const S = setOfId(id), m = ptModel();
  if (!S || !m) return;
  if (mode !== 'track' && ptSet(id)) return;
  if (mode !== 'track') { cvDropInstrument(m.id, null, { set: id }); return; }
  setTrack(id);
  srcModeUI('replace');
}
function setTrack(id) { // (+ Track, a drop on the track list: a new 900 Series track with the set; the set's one-time notice)
  const S = setOfId(id), m = ptModel();
  if (!S || !m) return;
  addTrack(m, null, { set: id });
  const tail = PATCH.setNote(id);
  if (tail) notice(`New track with ${S.name} — ${tail}`, 8000);
}
// the set's rack outline (world px) relative to the controller's top-left — Tidy's rows (rackLayout) and the console itself
const setBoxes = new Map();
function setBox(id) {
  if (setBoxes.has(id)) return setBoxes.get(id);
  const r = MG.makeSet(id, {}), m = ptModel(), L = r ? PT.rackLayout(r.rec, r.rec.f) : {}, c = m ? cvModuleSize(m.id) : { w: 864, h: 352 };
  let x0 = 0, y0 = 0, x1 = c.w, y1 = c.h;
  for (const mid of Object.keys(L)) { const s = ptTileSz(r.rec.mods[mid].t); x0 = Math.min(x0, L[mid].x); y0 = Math.min(y0, L[mid].y); x1 = Math.max(x1, L[mid].x + s.w); y1 = Math.max(y1, L[mid].y + s.h); }
  const b = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  setBoxes.set(id, b);
  return b;
}
// a set tile dragged out (cv-tray o.setDrag, info.set): over the canvas the set's whole rack outline pinned where it lands — the
// controller on the instrument's module (a Replace in place, or the shown 900 Series' own controller: the set laid out from
// it) —, over the track list a new track; the drop does what the tap does
const setDrag = {
  move(id, i) {
    const tracks = i.over === 'tracks', W = cvW(), S = setOfId(id);
    $('#topTray').classList.toggle('cv-dropt', tracks);
    if (!W || !S) return;
    const t = trk(), k = curOf(t), im = i.over === 'canvas' && cvView ? cvView.modules.get(k) : null, ir = im ? im.rect() : null;
    if (i.over === 'canvas') {
      const b = setBox(id), c = ir ? W.toClient(ir.x + b.x, ir.y + b.y) : null, label = '+ ' + S.name + (ptShown() ? '' : ' · replaces ' + modelById(instOf(t).model).name);
      shell.drop = c ? W.ghost({ x: c.x, y: c.y, w: b.w, h: b.h, dx: 0, dy: 0, snap: false, label }) : W.ghost({ x: i.x, y: i.y, w: b.w, h: b.h, label });
    } else { W.ghost(null); shell.drop = null; }
    W.dragPointer(tracks || ir || !i.left ? null : { x: i.x, y: i.y, pointerType: i.pointerType });
  },
  begin(id, i) { const W = cvW(); if (W) W.setDragging(true); setDrag.move(id, i); },
  drop(id, i) {
    srcDragEnd();
    if (i.over === 'tracks') { setTrack(id); return true; }
    if (i.over !== 'canvas') return false;
    setPick(id, 'replace');
    return true;
  },
  cancel() { srcDragEnd(); },
};
function moogPick(type, mode) {
  if (mode !== 'track' && ptShown()) { PATCH.add(type); return; }
  const m = ptModel();
  if (!m) return;
  if (mode === 'track') { addTrack(m, null, { pm: type }); srcModeUI('replace'); return; }
  cvDropInstrument(m.id, null, { pm: type });
}
const ptTileSz = type => { const T = MG.TYPES[type]; return T ? { w: T.w, h: T.h } : { w: cvModule.W_PM, h: cvModule.H_PM }; };
const moogDrag = { // a Moog module tile dragged out: its true-size outline under the pointer over the canvas (a module of the shown 900 Series), the track list (a new 900 Series)
  move(id, i) {
    const tracks = i.over === 'tracks', W = cvW();
    $('#topTray').classList.toggle('cv-dropt', tracks);
    if (!W) return;
    const sz = ptTileSz(id);
    if (i.over === 'canvas') shell.drop = W.ghost({ x: i.x, y: i.y, w: sz.w, h: sz.h, label: '+ ' + ((MG.TYPES[id] || {}).short || id) + (ptShown() ? '' : ' · a 900 Series') });
    else { W.ghost(null); shell.drop = null; }
    W.dragPointer(tracks || !i.left ? null : { x: i.x, y: i.y, pointerType: i.pointerType });
  },
  begin(id, i) { const W = cvW(); if (W) W.setDragging(true); moogDrag.move(id, i); },
  drop(id, i) {
    const r = shell.drop, sz = ptTileSz(id);
    srcDragEnd();
    if (i.over === 'tracks') { const m = ptModel(); if (m) addTrack(m, null, { pm: id }); return true; }
    if (i.over !== 'canvas') return false;
    if (ptShown()) PATCH.add(id, r || (i.at ? { x: i.at.x - sz.w / 2, y: i.at.y - sz.h / 2 } : null));
    else { const m = ptModel(); if (m) cvDropInstrument(m.id, null, { pm: id }); }
    return true;
  },
  cancel() { srcDragEnd(); },
};
// the tiles greyed at the patch's module limit (setMoogPlaced, at each render); (9b) a set tile when the shown patch cannot take
// the modules its set would add (setFull: "This set needs N more modules than the patch can hold"; elsewhere a Replace: never)
function ptTray() {
  if (!shell.tiles || typeof shell.tiles.setMoogPlaced !== 'function') return;
  const P = ptShown(), r = P ? patchOf(P.t, P.dev) : null, n = r ? Object.keys(r.mods).length : 0;
  shell.tiles.setMoogPlaced(n >= PT.MAX_MODS ? `A patch holds at most ${PT.MAX_MODS} modules` : null);
  if (typeof shell.tiles.setSetPlaced === 'function') for (const S of cvTray.SET_TILES) shell.tiles.setSetPlaced(S.id, r ? cvTray.setFull(n, PT.setNeeds(r, S.id), PT.MAX_MODS) : null);
}
// a module tile's load label on this device (cv-cost's per-type figure; a sectioned module: every section)
// (9b, review 2 N3) a set tile's load label on this device: cv-cost over the set's own record and knobs (makeSet: what a tap makes),
// as the Model 15 tile's (the tile's estimate of its starter) — refreshed with the others (costLabels → refreshMoog)
function setCost(id) { const r = MG.makeSet(id, {}), m = ptModel(); return r && m ? COSTM.label(COSTM.estimate({ kind: 'synth', model: m.id, patch: r.rec, vals: r.vals }, devFactor())) : ''; }
function moogCost(type) { const c = COSTM.COST.patch ? COSTM.COST.patch[type] : null, x = Array.isArray(c) ? c.reduce((a, b) => a + (+b || 0), 0) : +c || 0; return x > 0 ? COSTM.label(x * devFactor()) : ''; }
/* ---- the bodies and their live values */
const modValue = (kind, t = trk()) => (kind === 'velo' ? lastVel(t) : kind === 'note' ? lastNote(t) : perfValue(kind, t));
const modCCLast = new Map(); // '<track id>/<cc module>' → the last controller value received (the meter after a remount)
function modMount(key, b) {
  const t = trk(), tid = t.id, kind = modKindOfKey(t, key), o = { doc: document, get: () => modValue(kind) };
  modUnmount(key);
  if (kind === 'pads') { // ((8, §1.1, §7) a Pads module's body: a view of the host — its grid on the cv-keys bed, its footer, Edit mode, the inspector)
    const B = cvPads.padsBody({ host: PADS, id: key, doc: document, track: () => trk().id }); // (its buttons: cv-pads tapOn — pressOrTap's rule, plus the keyboard's click)
    B.kind = 'pads';
    b.append(B.el);
    modBodies.set(key, B);
    return;
  }
  if (kind === 'wheel') Object.assign(o, { label: 'Mod Wheel', set: v => { ctl('wheel', v, 0); if (setModUI) setModUI(v, false); }, onJump: modJump });
  else if (MOD_EDIT.has(kind)) { // (2b) the editing bodies: the device's state, one step per gesture end, the live hooks
    Object.assign(o, { get: () => { const x = project.tracks.find(y => y.id === tid); return x && x.dev && x.dev[key] ? x.dev[key] : {}; }, edit: f => { modLiveEnd(); modEditState(key, f); }, bpm: () => project.bpm });
    if (kind === 'macro') o.set = (k, v) => modVal(trk(), key, 'k' + (k + 1), v); // (a knob's move: the table value, no step)
    // (milestone 3, §2.3) a slot host (Serum's own panel): a gesture's moves (o.live: the step opened at the first, the record
    // written, the payload reposted under N.modsHold), its rollback (o.cancel), the module's rows (its ⋯ Bypass / Remove All
    // Destinations), its view state for the session (editor zoom, grid, tool), the app's storage and notices
    if (MOD_SLOT.has(kind)) Object.assign(o, { live: f => modLive(key, f), cancel: () => modCancel(), rows: modRowsOps(key), view: modViewOf(tid, key), storage: hostStore, notify: txt => notice(txt, 3500), devKey: key });
    if (kind === 'cc') o.learn = on => modLearn(key, on);
  }
  const B = cvModsUI.bodyFor(kind, o);
  if (!B) return;
  B.kind = kind;
  b.append(B.el);
  modBodies.set(key, B);
  if (kind === 'wheel') B.setOthers(modOthers());
  else if (kind === 'note') B.update(lastNote(t));
  else if (kind === 'cc') { const v = modCCLast.get(tid + '/' + key); if (v !== undefined) B.update(v); }
  else if (kind === 'macro') B.update(Array.isArray(t.dev[key].v) ? t.dev[key].v.slice() : null); // (its live values are its own knobs: the host's table)
  if (MC_KINDS.has(kind)) mcMonitor(tid); // ((2b meters) an LFO / ENV / chaos body: the track's ModCore sources follow)
}
function modUnmount(key) { const B = modBodies.get(key); if (!B) return false; if (modLearnKey && modLearnKey.key === key) modLearn(key, false); if (modG && modG.key === key) modCancel(); modBodies.delete(key); B.destroy(); mcMonSync(); return true; }
// (milestone 3, §2.3) the slot hosts' gestures: the first live change opens the History step (modPre: its snapshot is the
// project before the drag) and keeps the record as it was; every move writes the record (setModState, the fields since the
// start) and reposts the payload under N.modsHold (postMods' 66 ms throttle: the sound follows the drag as in a Serum); the
// end is o.edit (modEditState names the step; the hold released), a rollback o.cancel (the record back, the step gone)
const MOD_SLOT = new Set(['lfo', 'env', 'macro', 'chaos']);
let modG = null; // { tid, key, rec0: the device record before the gesture }
function modLive(key, fields) {
  const t = trk(), d = t.dev && t.dev[key];
  if (!d || !modKindOfKey(t, key)) return;
  if (!modG || modG.key !== key || modG.tid !== t.id) { modPre(); modG = { tid: t.id, key, rec0: JSON.parse(JSON.stringify(d)) }; }
  if (!CMOD.setModState(t, key, fields).ok) return;
  const N = nodes.get(t.id);
  if (N) N.modsHold = true;
  queuePatch(t); persist();
}
function modLiveEnd() { const G = modG; modG = null; const N = G && nodes.get(G.tid); if (N) N.modsHold = false; return G; }
function modCancel() {
  const G = modLiveEnd(), t = G && project.tracks.find(x => x.id === G.tid), d = t && t.dev ? t.dev[G.key] : null;
  if (d && typeof d === 'object') { for (const k of Object.keys(d)) delete d[k]; Object.assign(d, G.rec0); } // (in place: the bodies read it)
  modUnstep();
  if (t) { queuePatch(t); persist(); }
}
// the module's own rows (track.mods rows from its jacks: '<key>.out', a macro's '<key>.k<n>') for its panel's ⋯
const modRowsFrom = key => { const t = trk(); return (Array.isArray(t.mods) ? t.mods : []).filter(r => r && typeof r.src === 'string' && (r.src === key + '.out' || r.src.startsWith(key + '.k'))); };
function modRowsOps(key) {
  const all = (label, fn) => { const t = trk(), L = modRowsFrom(key); if (!L.length) return; hist.record(project, label); for (const r of L) fn(t, r); cvModAfter(t); cvModSync(); };
  return {
    count: () => modRowsFrom(key).length,
    bypassed: () => { const L = modRowsFrom(key); return L.length > 0 && L.every(r => !!r.byp); },
    bypass: on => all(on ? 'Mod bypass' : 'Mod bypass off', (t, r) => CMOD.setMod(t, r.id, { byp: on ? 1 : 0 })),
    remove: () => all('Disconnect all', (t, r) => CMOD.removeMod(t, r.id)),
  };
}
const modViews = new Map(); // 'trackId/key' → a slot host's view state (zoom, grid, tool) for the session — never saved
const modViewOf = (tid, key) => { const k = tid + '/' + key; let v = modViews.get(k); if (!v) modViews.set(k, v = {}); return v; };
// (fixer C, lane D's open item) the LFO / ENV / chaos bodies' live values: the node's {t: 'smon'} carries mc (Float32Array(16):
// ModCore's evaluated sources — lfo 0…9, ENV 10…13, chaos 14, 15 — fixer A) and the payload pay.slots maps a module id to
// { kind, i } (fixer B); each mounted body reads its entry at the monitor rate. One subscription per track while such a
// body is mounted (the primary instrument's part: its message carries mc), live while one of them is on screen; either
// field absent (until A and B merge): nothing moves
const MC_KINDS = new Set(['lfo', 'env', 'chaos']);
const mcMons = new Map(); // track id → off
const mcAny = () => { for (const B of modBodies.values()) if (MC_KINDS.has(B.kind)) return true; return false; };
// (milestone 3, §2.9) track-level: the 'mods' monitor id alone (role 'none': no part — lane E's engine posts {t: 'smon', mc,
// mcx} on it), never the primary's snapshot
function mcMonitor(tid) {
  if (mcMons.has(tid)) { monitors.sync(); return; }
  if (!project.tracks.some(x => x.id === tid)) return;
  mcMons.set(tid, monitors.sub(tid, null, { role: 'none', mods: true,
    live: () => { if (project.selTrack !== tid || !mcAny()) return false; for (const [k, B] of modBodies) if (MC_KINDS.has(B.kind) && (!cvView || cvView.live(k))) return true; return false; },
    deliver: d => { if (d.mc) mcSnap(tid, d.mc, d.mcx); } }));
}
function mcMonSync() { for (const [tid, off] of mcMons) if (tid !== project.selTrack || !mcAny()) { off(); mcMons.delete(tid); } }
// (milestone 3, §2.9) with lane E's mcx { ph: Float32Array(20), env: Float32Array(8) }: an LFO's phase and Path Y (mc[l] its
// X: { v, ph, y, out } — the phase dot, the PATH playhead), an ENV's stage and stage time ({ v, stage, t } — its playhead),
// as Serum's own panels read them (the slot host's snapshot)
function mcSnap(tid, mc, mcx) {
  if (project.selTrack !== tid || !modBodies.size) return;
  const t = project.tracks.find(x => x.id === tid), pay = t ? modsPay(t) : null, S = pay && !pay.off && pay.slots;
  if (!S) return;
  const ph = mcx && mcx.ph, ev = mcx && mcx.env;
  for (const [k, B] of modBodies) {
    const e = MC_KINDS.has(B.kind) ? S[k] : null;
    if (!e || !(e.i >= 0) || e.i >= mc.length || (cvView && !cvView.live(k))) continue;
    let v = mc[e.i];
    if (ph && B.kind === 'lfo' && e.i < 10 && ph.length >= 20) v = { v, ph: ph[e.i], y: ph[10 + e.i], out: v };
    else if (ev && B.kind === 'env' && e.i >= 10 && e.i < 14 && ev.length >= 8) v = { v, stage: ev[e.i - 10], t: ev[e.i - 6] };
    try { B.update(v); } catch (err) { console.warn(err); }
  }
}
// (review 2 P2) a canvas ENV cabled to a Serum knob is injected into a free ENV slot of that Serum (cv-graph injectMods: no
// ModCore slot, mcSnap never feeds it): [{ key, dev, k }] per payload; the Serum's own snapshot of slot k drives its body
const injEnvMemo = new WeakMap(); // the track's payload → the list
function sxInjEnv(t) {
  const pay = t ? modsPay(t) : null; // (off when every row is native or injected: nothing for ModCore — the list may still hold one)
  if (!pay) return [];
  let L = injEnvMemo.get(pay);
  if (L) return L;
  L = [];
  for (const dev of sxIds(t)) {
    const rows = CG.modRowsFor(t, dev);
    if (!rows.length) continue;
    for (const x of CG.injectMods(t.dev[dev], rows, pay.off ? [] : pay.ext || [], t).inj) {
      const key = String(x.src || '').split('.')[0];
      if (x.kind === 'env' && t.dev[key] && !L.some(y => y.key === key && y.dev === dev)) L.push({ key, dev, k: x.k });
    }
  }
  injEnvMemo.set(pay, L);
  return L;
}
const sxInjLive = (tid, dev) => project.selTrack === tid && modBodies.size > 0 && sxInjEnv(project.tracks.find(x => x.id === tid)).some(q => q.dev === dev && modBodies.has(q.key) && (!cvView || cvView.live(q.key)));
function sxInjSnap(tid, dev, s) {
  if (project.selTrack !== tid || !modBodies.size || !s || !s.envStage) return;
  const t = project.tracks.find(x => x.id === tid);
  for (const q of sxInjEnv(t)) {
    const B = q.dev === dev ? modBodies.get(q.key) : null;
    if (!B || B.kind !== 'env' || (cvView && !cvView.live(q.key))) continue;
    try { B.update({ v: s.env ? s.env[q.k] : 0, stage: s.envStage[q.k], t: s.envT ? s.envT[q.k] : 0 }); } catch (err) { console.warn(err); }
  }
}
// a value was sent (ctl: the wheel, aftertouch, bend; inputNote: a velocity, (2b) a note): the modules of that kind redraw
// (a dragged wheel ignores it)
function cvModLive(kind) { if (modBodies.size) for (const B of modBodies.values()) if (B.kind === kind) B.update(modValue(kind)); }
// (frame(), playing) the selected track's lanes on the modules on screen (U13: a folded or off-screen one waits)
const MOD_LANED = new Set(['wheel', 'at', 'bend']);
function cvModPlay() {
  if (!modBodies.size) return;
  const t = trk();
  for (const [k, B] of modBodies) if (MOD_LANED.has(B.kind) && (!cvView || cvView.live(k))) B.update(modLane(B.kind, t));
}
/* ---- (2b) the state edits, the value table, CC learn */
// a body's edit at a gesture's end: one History step (the 2a modPre / modStep glue), the state through cv-model
// setModState (bounded, in place); modStep's cvModAfter reposts the payload (the module's state is in its key)
function modEditState(key, fields) {
  const t = trk(), kind = modKindOfKey(t, key);
  if (!kind || kind === 'wheel') return false;
  modPre();
  if (!CMOD.setModState(t, key, fields).ok) { modUnpre(); return false; }
  modStep('Edit ' + CMOD.modLabelOf(key, t.dev[key]));
  return true;
}
// a value of the ModCore table: a macro knob moved (port 'k1'…'k8'), a CC received (port 'out') → {t: 'mval', k, v} to the
// track's node when the compile gave that source a table entry (buildMods' vals, by id); nothing otherwise (no patch)
function modVal(t, key, port, v) {
  const pay = t && t.dev ? modsPay(t) : null; // ((C4) the last build: a macro knob's every move asks)
  if (!pay || pay.off) return false;
  const e = pay.vals.find(x => x && x.id === key + '.' + port);
  if (!e) return false;
  postTo(t, { t: 'mval', k: e.k, v: Math.max(0, Math.min(1, +v || 0)) });
  return true;
}
let modLearnKey = null; // { tid, key }: the CC module armed for the next controller (one at a time)
function modLearn(key, on) {
  if (modLearnKey && (!on || modLearnKey.key !== key)) { const old = modBodies.get(modLearnKey.key); if (old && old.setLearn) old.setLearn(false); modLearnKey = null; }
  if (!on) return;
  const B = modBodies.get(key);
  modLearnKey = { tid: trk().id, key };
  if (B && B.setLearn) B.setLearn(true);
  notice('CC learn: move a controller — tap Learn again to cancel', 5000);
}
// midi.js host.modCC: a controller (v 0…1) to the CC modules of the channel's targets whose number and channel match (ch 0:
// omni) → the table value and the body's meter; an armed learn takes its number first (one step "Learn CC"). The module's
// stored `v` is not written per controller (its state is in the payload's key: a repost per message); the meter is
// the host's (modCCLast), the table the engine's
function modCC(ch, cc, v) {
  const L = modLearnKey;
  if (L) {
    const t = project.tracks.find(x => x.id === L.tid), d = t && t.dev ? t.dev[L.key] : null;
    modLearn(L.key, false);
    if (d && d.kind === 'cc') {
      hist.record(project, 'Learn CC');
      CMOD.setModState(t, L.key, { cc });
      const B = modBodies.get(L.key);
      if (B && B.sync) B.sync();
      cvModAfter(t);
      notice('CC ' + cc + ' learned', 3000);
    }
  }
  let hit = 0;
  for (const t of targets(ch)) {
    if (!t.dev) continue;
    for (const id of Object.keys(t.dev)) {
      const d = t.dev[id];
      if (!d || d.kind !== 'cc' || CMOD.kindOfId(id) !== 'cc' || d.cc !== cc || (d.ch && d.ch !== ch)) continue;
      modVal(t, id, 'out', v);
      modCCLast.set(t.id + '/' + id, v);
      if (t === trk()) { const B = modBodies.get(id); if (B) B.update(v); }
      hit++;
    }
  }
  return hit;
}
// (U13) perfValue's lane value without its scan of t.cc per body per frame: per track and kind the points sorted by tick
// (equal ticks: the later in t.cc wins, as there), made again when t.cc changes (another array, another length) or after
// MOD_LANE_MS (an edit in place), a binary search per frame; before the lane's first point the last value sent
const MOD_LANE_MS = 500, modLanes = new Map(); // track id + kind → { cc, n, at, L: [[tick, v, i]] }
function modLane(kind, t) {
  if (!T.playing || !t || !Array.isArray(t.cc) || (kind !== 'wheel' && kind !== 'at' && kind !== 'bend')) return perfValue(kind, t);
  const key = t.id + '\n' + kind, now = performance.now();
  let c = modLanes.get(key);
  if (!c || c.cc !== t.cc || c.n !== t.cc.length || now - c.at > MOD_LANE_MS) {
    const L = [];
    t.cc.forEach((x, i) => { if (x && x.k === kind && x.v !== undefined) L.push([x.t, x.v, i]); });
    L.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
    modLanes.set(key, c = { cc: t.cc, n: t.cc.length, at: now, L });
  }
  const tick = curTick(), L = c.L;
  let lo = 0, hi = L.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (L[m][0] <= tick) lo = m + 1; else hi = m; }
  if (lo) return L[lo - 1][1];
  const P = perfLive.get(t.id);
  return P && P[kind] !== undefined ? P[kind] : 0;
}
// the wheel's "+N on other tracks": its cables there; a tap lists those tracks at the chip (U14), a pick shows its wheel
const modOthers = () => { const id = trk().id; return CMOD.wheelRows(project).byTrack.filter(x => x.trackId !== id).reduce((n, x) => n + x.rows.length, 0); };
function modJumpItems() {
  const id = trk().id;
  return CMOD.wheelRows(project).byTrack.filter(x => x.trackId !== id).map(x => {
    const tr = project.tracks.find(y => y.id === x.trackId), n = x.rows.length;
    return { label: (tr ? tr.name : x.trackId) + ' · ' + n + ' cable' + (n === 1 ? '' : 's'), action: () => cvReveal(x.trackId, 'wheel') };
  });
}
function modJump(el) { const L = modJumpItems(); if (!L.length) return; const p = modAt(el); cvTray.popupMenu(p.x, p.y, L); }
// every render: the tray's tiles greyed where their singleton stands, the wheel's count
function cvModDecor() {
  const T = shell.tiles, t = trk();
  if (T && typeof T.setPlaced === 'function') {
    T.setPlaced('wheel', CMOD.hasWheel(project) ? 'already in this project' : null);
    for (const k of ['velo', 'at', 'bend', 'note']) T.setPlaced(k, t.dev && t.dev[CMOD.MOD_DEV[k]] ? 'already on this track' : null); // (multi kinds ignore it)
    T.setPlaced('pads', padMods().length >= PC.MAX_MODS ? PADS_FULL : null); // ((8, §1.2) the Controllers tile greys at the project's PC.MAX_MODS-th — 64 since P, was 8 —, never before)
  }
  const W = modBodies.get('wheel');
  if (W) W.setOthers(modOthers());
  sxPartsDecor(); // ((3) the Serum parts tiles: greyed with the count when the Serum has no room)
}
/* ---- adding (the Sources tray's Modulators) and deleting (⋯) */
// a tap: Tidy's column left of the instruments, at the module's MOD_ORDER slot (below the modulators before it in that order,
// as Tidy stacks them) when nothing stands there, else below the column (U9); a drop: where it lands (on the dots).
// (milestone 3, §2.2) the column grows leftwards: each kind at cv-module modX(kind) with its width modW(kind) (an LFO 416 px at
// x −512: its right edge at −MOD_GAP), the heights the modules' measured ones (a Serum-faithful body's height is its content)
const modH = (kind, key) => { const m = key && cvView ? cvView.modules.get(key) : null, h = m ? m.rect().h : 0; return h > cvModule.BAR_H ? h : modHt(kind); };
// (review 2 P1-4) a new module's height by kind: a Serum-faithful body (LFO / ENV / Macro / Chaos) is as tall as its panel —
// a module of the kind on the canvas measured, else the last one measured, else Chrome's at 1200 px (MOD_H_SX; cv-module
// MOD_H holds Tidy's guesses: LFO 256 for 451, which let a drop just above an OB-Xa cover its face)
const MOD_H_SX = { lfo: 451, env: 371, macro: 250, chaos: 135 }, modHSeen = new Map();
function modHt(kind) {
  if (!cvModule.SX_MODS.has(kind)) return cvModule.MOD_H[kind] || cvModule.MOD_H.at;
  let h = 0;
  if (cvView) for (const [k, m] of cvView.modules) if (m.kind === 'mod' && CMOD.kindOfId(k) === kind) { const r = m.rect(); if (r.h > cvModule.BAR_H) h = Math.max(h, r.h); }
  if (h) modHSeen.set(kind, h);
  return h || modHSeen.get(kind) || MOD_H_SX[kind];
}
function modSpot(t, kind, F) { // ((8) F: a Pads module's footprint { w, h } — its kind has no modW / modHt (review #18); after every modulator, then the other Pads modules)
  const D = cvWorld.DOT, up = v => Math.ceil(v / D) * D, G = cvModule.VGAP, w = F ? F.w : cvModule.modW(kind), here = cvView && cvView.trackId === t.id;
  const x = F ? -up(F.w + cvModule.MOD_GAP) : cvModule.modX(kind), h = F ? F.h : modHt(kind);
  const R = here ? Object.values(cvView.rects()).filter(r => r && r.x < x + w && r.x + r.w > x) : [];
  let y = 0;
  const ORD = cvModule.MOD_ORDER, ko = ORD.includes(kind) ? ORD.indexOf(kind) : ORD.length;
  if (kind !== 'wheel' && CMOD.hasWheel(project)) y = up(y + modH('wheel', here ? 'wheel' : null) + G);
  for (const m of CMOD.modDevs(t)) { if (ORD.indexOf(m.kind) > ko) break; y = up(y + modH(m.kind, here ? m.id : null) + G); } // (2b: a multi kind lands after its siblings)
  if (kind === 'pads') for (const M of padMods()) if (t.lay && t.lay[M.id]) y = up(y + PC.footprint(M.rows, M.cols, M.size).h + G); // ((8) the Pads modules placed here before it)
  if (!R.some(r => r.y < y + h && r.y + r.h > y)) return { x, y };
  y = 0;
  for (const r of R) y = Math.max(y, r.y + r.h + G);
  return { x, y: up(y) };
}
// (§2.2) a modulator dropped over an instrument moves on left past it (its right edge MOD_GAP from the instrument's left):
// no modulator covers an instrument (a hardware face never leaves GL)
// (review 2 P1-4) by the kind's measured height; then clear of every other module too: below what it would cover (the
// column stays one column — a drop onto the instrument never lands on another modulator). sxSettle checks again once its
// panel is up.
function modClear(t, kind, p, F) { // ((8) F: a Pads module's footprint)
  const w = F ? F.w : cvModule.modW(kind), h = F ? F.h : modHt(kind), D = cvWorld.DOT, G = cvModule.VGAP;
  if (!cvView || cvView.trackId !== t.id) return p;
  const R = cvView.rects(), inst = new Set(CMOD.instIds(t)), I = [...inst].map(k => R[k]).filter(Boolean), A = Object.values(R).filter(Boolean);
  const r = { x: p.x, y: p.y, w, h };
  for (let i = 0; i < 16; i++) { const o = I.find(q => sxHits(r, q)); if (!o) break; r.x = Math.floor((o.x - cvModule.MOD_GAP - w) / D) * D; }
  for (let i = 0; i < 64; i++) { const o = A.find(q => sxHits(r, q)); if (!o) break; r.y = Math.ceil((o.y + o.h + G) / D) * D; }
  return { x: r.x, y: r.y };
}
// (U9) a tapped-in module off screen: the camera brings it in at the zoom it has (the trays stay as they are)
function modShow(key) {
  const W = cvW(), m = cvView && cvView.modules.get(key);
  if (!W || !m || typeof W.band !== 'function' || typeof W.focusItem !== 'function') return false;
  const r = m.rect(), b = W.band(), a = W.toClient(r.x, r.y), z = W.toClient(r.x + r.w, r.y + r.h);
  if (a.x >= b.left && a.y >= b.top && z.x <= b.right && z.y <= b.bottom) return false;
  W.focusItem(key, { k: W.k, edit: false });
  return true;
}
// (8, §1.2, §1.4) a Pads module from the Controllers view: one step "Add Pads 1" — the module (project.pads, following the track
// it is added on, §3.5: a drum machine's pad order, else a chromatic run from C3) and its place on this track (a tap: the
// modulator column's next free spot; a drop: where it lands — both at its footprint, review #18); on every other track
// Tidy-placed until moved there
const PADS_FULL = PC.MAX_MODS + ' Pads modules in this project';
const padsNewF = () => { const o = cvPads.defaultsOf(trk(), drumOf); return PC.footprint(o.rows, o.cols, 1); }; // (a new module's fixed size: M pads)
function padsAdd(at) {
  const t = trk(), tap = !(at && Number.isFinite(at.x) && Number.isFinite(at.y));
  if (padMods().length >= PC.MAX_MODS) { notice(PADS_FULL, 3500); return null; }
  hist.record(project, 'Add Pads');
  const lay = cvPinned(t), r = CMOD.addPads(project, cvPads.defaultsOf(t, drumOf)), M = r.ok ? padMod(r.id) : null;
  if (!M) { hist.prune(project); notice(r.why || PADS_FULL, 3500); updateUndoUI(); return null; }
  const step = hist.u[hist.u.length - 1], id = M.id, F = PC.footprint(M.rows, M.cols, M.size);
  step.label = 'Add ' + M.name;
  lay[id] = tap ? modSpot(t, 'pads', F) : modClear(t, 'pads', { x: cvDot(at.x), y: cvDot(at.y) }, F);
  t.lay = lay;
  cvAfter(t);
  PADS.resync();
  if (tap) modShow(id);
  cvUndoNotice(`Added ${M.name} · tap to undo`, step, () => (padMod(id) ? () => modDelete(id, true) : null));
  return id;
}
function modAdd(kind, at) {
  if (cvMaster) { notice(MASTER_SRC, 4000); return null; } // ((M, §5.2) no modulation on the master canvas
  if (kind === 'pads') return padsAdd(at);
  const t = trk(), multi = CMOD.MOD_MULTI.includes(kind), key0 = modKeyOf(kind), name = CMOD.MOD_LABEL[kind];
  if (!name || !t.dev || (!multi && !key0)) return null;
  if (!multi && (kind === 'wheel' ? CMOD.hasWheel(project) : key0 in t.dev)) { notice(name + (kind === 'wheel' ? ' is already in this project' : ' is already on this track'), 3500); return null; }
  const full = kind === 'wheel' ? '' : CMOD.devFull(t); // ((P, §3.1) a track holds CMOD.DEV_MAX devices: said before the step — addModDev's null is no "already there"; the wheel is the project's)
  if (full) { notice(full, 3500); return null; }
  hist.record(project, kind === 'wheel' ? 'Place Mod Wheel' : 'Add ' + name);
  const lay = cvPinned(t), spot = tap => (tap ? modSpot(t, kind) : modClear(t, kind, { x: cvDot(at.x), y: cvDot(at.y) })); // (the spot before the device is there: its siblings; (3) a drop never covers an instrument)
  const tap = !(at && Number.isFinite(at.x) && Number.isFinite(at.y)), at2 = spot(tap);
  let key = key0;
  if (kind === 'wheel') CMOD.placeWheel(project); else key = CMOD.addModDev(t, kind); // (2b: a multi kind's id from cv-model — l<n>, e<n>, m<n>, c<n>, h<n>)
  if (!key) { hist.prune(project); updateUndoUI(); return null; }
  const label = kind === 'wheel' ? name : CMOD.modLabelOf(key, t.dev[key]);
  if (multi) hist.u[hist.u.length - 1].label = 'Add ' + label; // ("Add LFO 2")
  lay[key] = at2;
  t.lay = lay;
  sxFresh.add(t.id + '\n' + key); // ((3) its height measured once its panel is up: clear of the column (sxSettle); a drop too, review 2 P1-4)
  cvAfter(t);
  if (tap) modShow(key);
  const step = hist.u[hist.u.length - 1], tid = t.id;
  cvUndoNotice(`Added ${label} · tap to undo`, step, () => {
    const tr = project.tracks.find(x => x.id === tid);
    return tr && (kind === 'wheel' ? CMOD.hasWheel(project) : tr.dev && key in tr.dev) ? () => { if (trk() !== tr) selectTrack(tid); modDelete(key, true); } : null;
  });
  return key;
}
// ((8) a Controllers tile — Pads — the same way at its footprint: the new module's grid on the track it would follow)
const tileW = id => (id === 'pads' ? padsNewF().w : cvModule.modW(id)), tileH = id => (id === 'pads' ? padsNewF().h : modHt(id));
const modTileDrag = { // a Modulators tile dragged out: its true-size outline under the pointer over the canvas
  move(id, i) {
    if (!world) return;
    if (i.over === 'canvas') shell.drop = world.ghost({ x: i.x, y: i.y, w: modTileDrag.w || tileW(id), h: modTileDrag.h || tileH(id), label: '+ ' + (id === 'pads' ? 'Pads' : CMOD.MOD_LABEL[id] || id) }); // ((3) its kind's width; its measured height, read once per drag, review 2 P1-4)
    else { world.ghost(null); shell.drop = null; }
    world.dragPointer(!i.left ? null : { x: i.x, y: i.y, pointerType: i.pointerType });
  },
  begin(id, i) { modTileDrag.w = tileW(id); modTileDrag.h = tileH(id); if (world) world.setDragging(true); modTileDrag.move(id, i); },
  drop(id, i) {
    const r = shell.drop, w = modTileDrag.w || tileW(id), h = modTileDrag.h || tileH(id);
    modTileDrag.w = modTileDrag.h = 0;
    srcDragEnd();
    if (i.over !== 'canvas') return false;
    modAdd(id, r || (i.at ? { x: i.at.x - w / 2, y: i.at.y - h / 2 } : null));
    return true;
  },
  cancel() { modTileDrag.w = modTileDrag.h = 0; srcDragEnd(); },
};
// ⋯ → Delete: a modulator and its cables, one step (the wheel: from every track, asked first when it has cables)
// (8, §1.4, D9) a Pads module: asked first when it has mod rows on any track; its hardware lights dark (§8.4), its held notes
// ended, then one step "Delete Pads 1" — the module, every row of its pads and its place on every track (cv-model removePads)
function padsDelete(id, quiet) {
  const M = padMod(id);
  if (!M) return false;
  const B = CMOD.padRows(project, id).byTrack, n = B.reduce((a, x) => a + x.rows.length, 0);
  if (n && !quiet && !confirm(`Remove ${M.name} and its ${n} modulation cable${n === 1 ? '' : 's'} on ${B.length} track${B.length === 1 ? '' : 's'}?`)) return false;
  PADS.hwDark(id); PADS.endModule(id);
  hist.record(project, 'Delete ' + M.name);
  const t = trk(), step = hist.u[hist.u.length - 1];
  for (const x of CMOD.removePads(project, id).byTrack) { const tr = trackById(x.trackId); if (tr && tr !== t) queuePatch(tr); }
  cvModAfter(t);
  cvModSync();
  PADS.resync();
  if (!quiet) cvUndoNotice(`Deleted ${M.name} · tap to undo`, step, () => null); // (§10.3: a destructive edit's "tap to undo")
  return true;
}
function modDelete(key, quiet) {
  if (PC.PAD_ID.test(key)) return padsDelete(key, quiet);
  const t = trk(), kind = modKindOfKey(t, key);
  if (key === 'wheel') {
    if (!CMOD.hasWheel(project)) return false;
    const B = CMOD.wheelRows(project).byTrack, n = B.reduce((a, x) => a + x.rows.length, 0);
    if (n && !quiet && !confirm(`Remove the Mod Wheel and its ${n} cable${n === 1 ? '' : 's'} on ${B.length} track${B.length === 1 ? '' : 's'}?`)) return false;
    hist.record(project, 'Delete Mod Wheel');
    for (const x of CMOD.removeWheel(project).byTrack) { const tr = project.tracks.find(y => y.id === x.trackId); if (tr && tr !== t) queuePatch(tr); }
  } else {
    if (!cvModule.MOD_ORDER.includes(kind)) return false;
    if (modLearnKey && modLearnKey.key === key) modLearn(key, false);
    hist.record(project, 'Delete ' + CMOD.modLabelOf(key, t.dev[key])); // ("Delete LFO 2", "Delete Velocity")
    CMOD.removeModDev(t, key);
  }
  cvModAfter(t);
  cvModSync();
  return true;
}
/* ---- names, checks, the drag onto a knob */
const modLabelIn = (t, id) => modLabel(id, t); // (a label on another track's ids: the Serum panels' hooks)
function modLabel(id, t0) { // canvas-form ids: a source ('wheel', 've.out', 'l2.out', 'm1.k3', 'i1/lfo2.out'), a knob ('i1:f.cutoff', 'i2:cf', 'fx1:fx.rev.mix'), a device ('i1')
  const t = t0 || trk();
  if (typeof id !== 'string' || !id) return '';
  if (CMOD.MOD_SRC[id]) return CMOD.MOD_LABEL[CMOD.MOD_SRC[id]];
  if (CMOD.isPadSrc(id)) return CMOD.padSrcLabel(project, id) || id; // ((8, §5.1) "Pads 1 · Kick": the Connect to… menu's label, any slot)
  const q = modSrcOf(id);
  if (q && (q.port || q.link)) { const S = modSrcList(t).find(x => x.id === id); return S ? S.label : q.link ? cvDevName(t, q.dev) + ' ' + q.link.toUpperCase() : CMOD.modLabelOf(q.dev, t.dev && t.dev[q.dev]); }
  const D = modSplit(id);
  if (!D) return t.dev && t.dev[id] ? cvDevName(t, id) : '';
  const d = t.dev ? t.dev[D.dev] : null;
  if (isSxDev(t, D.dev)) { try { return core.destLabel(D.pid, d.vals.s, d.fx) || D.pid; } catch (err) { return D.pid; } }
  if (d && d.kind === 'panel') { const x = modDescsOf(d).find(k => k.id === D.pid), m = /^fx\.([^.]+)\./.exec(D.pid); return x ? (m ? modInstLabel(d, m[1]) + ' ' : '') + x.label : D.pid; } // ("Reverb Mix")
  const c = d && d.kind === 'synth' ? (modelById(d.model).controls || []).find(x => x.id === D.pid) : null;
  return c ? c.label : D.pid;
}
const modInstLabel = (d, inst) => { try { return core.instLabel(d.fx, inst) || inst; } catch (err) { return inst; } }; // (a panel's effect instance: "Reverb", "Delay 2")
// can src modulate knob dst ('<dev>:<param>') of this track → {ok, why} (the refusal texts of §2.13)
function modCan(src, dst) {
  const t = trk(), D = modSplit(dst), d = D && t.dev ? t.dev[D.dev] : null, own = sxOwnSrc(src);
  if (own) { // ((3, §2.5) a Serum's own LFO / ENV / macro: a native row on its own knobs, a link row elsewhere — never its macros)
    if (!d || !isSxDev(t, own.dev)) return { ok: false, why: modRefusal('nomod') };
    if (D.dev === own.dev) { const r = CMOD.destOk(d, D.pid); return r.ok ? { ok: true, why: '' } : { ok: false, why: modRefusal('nomod') }; }
    if (!own.link) return { ok: false, why: SX_OWN_MACRO };
    src = own.link;
  }
  const no = (code, x) => ({ ok: false, why: modRefusal(code, Object.assign({ src: modLabel(src), dst: modLabel(dst) }, x)) });
  if (!d) return no('nomod');
  const r = CMOD.destOk(d, D.pid); // (2b: classic sm / apply / proc and panel knobs open; chunk → stage 5; a switched-off oscillator's level says so)
  if (!r.ok) return r.stage ? no('stage', { stage: r.stage }) : /oscillator/.test(r.why || '') ? { ok: false, why: r.why } : no('nomod');
  if (isSxDev(t, D.dev)) { const b = CG.modBudget(t, D.dev, project); if (b.left.length || b.preset + b.canvas >= b.max) return no('full', { dev: cvDevName(t, D.dev), used: b.preset + b.canvas, max: b.max }); }
  return { ok: true, why: '' };
}
// the knobs a drag lights up: every modulatable one of the track's instruments and panels (memoised per drag)
function modMarks() {
  const t = trk(), memo = new Map();
  return (dev, id) => { const k = dev + ':' + id; if (!memo.has(k)) memo.set(k, !!(t.dev && t.dev[dev]) && CMOD.destOk(t.dev[dev], id).ok); return memo.get(k); };
}
// (2b) a row the compile cannot evaluate (ModCore LFO / ENV / chaos slots, ext slots or synthetic rows full): the reason;
// '' when it compiled
function modLeftWhy(t, dev, id) {
  const b = CG.modBudget(t, dev, project);
  if (!b.left.includes(id)) return '';
  const code = (b.why && b.why[id]) || 'full', s = b.slots || {};
  return modRefusal(code, { dev: cvDevName(t, dev), used: b.preset + b.canvas, max: b.max, slots: s });
}
// a drag released on a knob: one step "Modulate <knob> with <source>", the new cable selected; a row the ModCore budgets
// refuse goes again (no step, the reason told)
function modConnect(src, dst) {
  const t = trk(), D = modSplit(dst), ok = modCan(src, dst), own = sxOwnSrc(src);
  if (!ok.ok) { notice(ok.why, 4000); return null; }
  if (own && D && D.dev === own.dev) return sxOwnConnect(t, own, D.pid); // ((3) its own knob: Serum's matrix row (the panel's undo)
  if (own) src = own.link; // ((3) elsewhere: a link row from its part's jack (2b))
  hist.record(project, 'Modulate ' + modLabel(dst) + ' with ' + modLabel(src));
  const e = hist.u[hist.u.length - 1];
  const r = CMOD.addMod(t, src, dst, { project, name: cvDevName(t, D.dev), limit: prefs.limitDrop }); // (the Serum's "Limit mod depth on drop")
  if (!r.ok) { hist.prune(project); notice(r.why || modRefusal(r.code), 4000); updateUndoUI(); return null; }
  const left = modLeftWhy(t, D.dev, r.row.id);
  if (left) { CMOD.removeMod(t, r.row.id); if (hist.u[hist.u.length - 1] === e) hist._drop(hist.u.pop()); notice(left, 5000); updateUndoUI(); return null; }
  modPend = null;
  cvModAfter(t);
  modSelect(r.row.id);
  cvModSync();
  return r.row.id;
}
// (2b) "Connect to…" from a knob (the classic mod menu, a drop on a module's bar with one source): the sources at the anchor
function modSrcPick(dst, el) {
  const t = trk(), L = modSrcList(t), p = modAt(el);
  if (!L.length) { notice('Add a modulator first (Sources ▸ Modulators)', 4000); return false; }
  cvTray.popupMenu(p.x, p.y, L.filter(s => !s.hidden).map(s => ({ label: s.label + (s.kind === 'link' && s.used ? ' (in use)' : ''), action: () => modConnect(s.id, dst) }))); // ((8) a mod pad outside its grid: not offered)
  return true;
}
const modAt = el => { const r = el && typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null; return r ? { x: r.left, y: r.bottom + 6 } : { x: undefined, y: undefined }; };
// the parameter list of the Serum a cable is aimed at (a drop on its bar, a tap on the jack); elsewhere the reason
function modDests(src, dev, el) {
  const t = trk(), d = dev && t.dev ? t.dev[dev] : null;
  if (!d || !modDescs(dev).length) { notice(d ? modRefusal('nomod') : 'Drag a modulation cable onto a knob', 4000); return false; }
  const p = modAt(el);
  return modLayer ? modLayer.openDestList(src, dev, p.x, p.y) : false;
}
// a jack tap: one device with knobs → its list; several → a pick of the device first
function modJackTap(src, el) {
  const t = trk(), L = modDestDevs(t);
  if (!L.length) { notice('Modulation cables end on an instrument’s or a panel’s knobs', 4000); return false; }
  if (L.length === 1) return modDests(src, L[0], el);
  const p = modAt(el);
  cvTray.popupMenu(p.x, p.y, L.map(id => ({ label: cvDevName(t, id), action: () => modDests(src, id, el) })));
  return true;
}
const modDragOpts = {
  canMod: (src, dst) => modCan(src, dst),
  markDests: () => modMarks(),
  onMod: (src, dst) => { modConnect(src, dst); },
  onRefuse: (src, dst, why) => notice(why || modRefusal('nomod'), 4000),
  // (milestone 3, §2.5) the audio side of the same drag: a Serum's internal ends in parts view (a part's / VOICE's jack:
  // intPort) edited through sx-edges (sxCan / sxConnect: one History step each); every other jack refuses with its reason
  port: j => (cvView ? cvView.intPort(j) || cvView.port(j) : null),
  canConnect: (a, b) => sxCan(a, b),
  onConnect: (a, b) => { sxConnect(a, b); },
  onBarDrop: (src, key) => { const m = cvView && cvView.modules.get(key); modDests(src, String(key).split('/')[0], m ? m.bar : null); },
  onJackTap: (src, el) => { modJackTap(src, el); },
  cordPress: (e, el) => PATCH.press(e, el), // ((9, §4.4) a patch cord's jack: cv-patch's plug drag (cv-cables hands it every cord jack's press)
  // ((WC, §4.4; the lead's decision after lane C) a rig's cord jacks (cords mode: cv-patch declines them) are cv-cables' cord drag: the
  // live rope and a grabbed plug on the cord layer, a re-patch / pull / a knob end moved by its badge (rig-core, one step each), the
  // jack's tap menu rig-ui's, a tap on a cord's body (the layer's hit; the patch canvas's cords never answer)
  live: x => { const C = cvCords(); if (C && rigCordsOn) C.live(x); },
  grab: () => (rigCordsOn ? cvCords() : null),
  cordLook: jk => rigLook(jk),
  onPull: id => { rigPull(id); },
  onRepatch: (id, a, b) => { rigRepatch(id, a, b); },
  onRepatchMod: (id, dst) => { rigRepatchMod(id, dst); },
  jackMenu: (j, el, x, y) => (RIGUI ? RIGUI.jackMenu(j, el, x, y) : null),
  cordHit: (p, r, ok) => { const C = rigCordsOn ? cvCords() : null; return C && typeof C.hit === 'function' ? C.hit(p, r, ok) : null; },
  jackAt: (el, p, k) => (rigCordsOn ? rigJackAt(el, p, k) : null), // ((fixer K, B5 / P2-3) the nearest jack or fanned plug: its own cord
};
function modSelect(id) { if (!cvView) return; modSelHost = true; try { cvView.cables.select(id); } finally { modSelHost = false; } }
// (review 2 P1-5) fn once the tap that called it is over: after its click (a mouse's comes in the same task, a touch's
// compatibility click a little later), else after 600 ms. Inside the tap the world still holds its gesture and takes a
// click (cv-world onClickCap): a synthetic click on a panel button there never arrives, and the tap's own click would
// close what it opened.
function afterTap(fn) {
  let done = false, tm = 0;
  const go = () => { if (done) return; done = true; clearTimeout(tm); fn(); };
  const onC = () => { window.removeEventListener('click', onC, true); if (!done) setTimeout(go, 0); };
  window.addEventListener('click', onC, true);
  tm = setTimeout(() => { window.removeEventListener('click', onC, true); go(); }, 600);
}
/* ---- the mod cables' badges (cv-cables host.cables) */
// a tap on a badge (selected or not): the inspector at it — after the event, so a long-press / right-click (its menu) does not
function modCableSel(id, by) {
  if (modSelHost || !id || !modLayer) return;
  modMenuId = null;
  const c0 = cvView && cvView.cables.list().find(x => x.id === id);
  if (c0 && c0.int && c0.stub) { // ((3, §2.5) a stub "→ Filter (off)": a tap opens the source's routing popover — after the tap (review 2 P1-5)
    (by ? afterTap : f => Promise.resolve().then(f))(() => {
      const c = cvView && cvView.cables.list().find(x => x.id === id);
      if (!c || !c.stub || modMenuId === id) return;
      const ok = sxRouteOpen(trk(), c.dev + '/' + String(c.edge && c.edge.a || '').split('.')[0]);
      if (c.off) sxOffOffer(c); // ((P1-6) into an off filter: the routing, and the offer to turn it on)
      else if (!ok) notice(SE.STUB_LABEL + ': its routing is in the panel’s route button', 3500);
    });
    return;
  }
  Promise.resolve().then(() => {
    const c = cvView && cvView.cables.list().find(x => x.id === id);
    if (modMenuId === id || !c || c.kind !== 'mod') return;
    const p = modAt(cvView.cables.badge(id));
    modLayer.openInspector(c.preset || c.own ? { preset: c.dev, slot: c.slot } : id, p.x, p.y); // ((3) a Serum's own row: its matrix slot
  });
}
function modCableMenu(id) {
  modMenuId = id;
  const c = cvView && cvView.cables.list().find(x => x.id === id);
  if (c && c.int && (c.fork || c.stub)) return [{ label: c.stub ? 'Routing…' : 'Balance…', action: () => sxCableAct(c, 'balance') }] // ((3) a forked internal cable, a stub: the source's routing popover
    .concat(c.off ? [{ label: 'Turn ' + rigLabel(trk(), c.dev, c.off) + ' on', action: () => sxAddPart(c.dev, 'filter', null, c.off) }] : []); // ((P1-6) a stub into an off filter)
  if (!c || c.kind !== 'mod') return [];
  return [{ label: 'Edit…', action: () => { const p = modAt(cvView && cvView.cables.badge(id)); if (modLayer) modLayer.openInspector(c.preset || c.own ? { preset: c.dev, slot: c.slot } : id, p.x, p.y); } },
    { label: 'Bypass', checked: !!c.byp, action: () => modBypass(id) }]; // (U15, SPEC §2.9; the amount stays the inspector's)
}
// (U15) the menu's Bypass: a canvas row one step "Mod bypass"; a preset row the Serum's own edit (sxEdit, as the inspector's)
function modBypass(id) {
  const t = trk(), c = cvView && cvView.cables.list().find(x => x.id === id);
  if (!c || c.kind !== 'mod') return;
  if (c.preset || c.own) modEdit({ preset: c.dev, slot: c.slot }, { byp: c.byp ? 0 : 1 });
  else { hist.record(project, 'Mod bypass'); CMOD.setMod(t, id, { byp: c.byp ? 0 : 1 }); }
  cvModAfter(t);
  cvModSync();
}
// (U10) the 24+ hint once a session (every track switch makes a new view, whose cables would say it again)
let modHinted = false;
function modHint(txt) { if (modHinted) return; modHinted = true; notice(txt, 6000); }
// (U5) what is not "elsewhere" for a selected mod cable: the overlays (#ov: the inspector, the Mod list)
const modAside = el => { const ov = $('#ov'); return !!ov && !!el && typeof ov.contains === 'function' && ov.contains(el); };
function modCableAct(id, a) { // Disconnect (the menu, the Delete key): a canvas row one step; a preset row the Serum's edit
  const t = trk(), c = cvView && cvView.cables.list().find(x => x.id === id);
  if (c && c.int) { sxCableAct(c, a); return; } // ((3) a Serum's internal cable: sx-edges, one step; BALANCE, a warp source's tap)
  if (a === 'tap' && c && c.kind === 'note') { padsNoteTap(c); return; } // ((8, §9) a Pads module's note cable: its pads listed)
  if (a !== 'disconnect' || !c || c.kind !== 'mod') return;
  if (c.own && isRigDev(t, c.dev)) { rigRowEdit(t, c.dev, 'Pull ' + rigRowSrc(t, c) + ' → ' + modLabel(c.b, t), T => { if (!T.matrix[c.slot]) return false; T.matrix[c.slot] = core.normRow(null); }, { notice: RC.WORDS.cordPulled.replace(/ · tap to undo$/, '') }); return; } // ((WC, review 2 P2-1) a rig's own row: one step
  if (c.preset || c.own) modRemove({ preset: c.dev, slot: c.slot }); // ((3) a Serum's own row too: its matrix
  else { hist.record(project, 'Disconnect'); CMOD.removeMod(t, id); }
  cvModAfter(t);
  cvModSync();
}
// (8, §9) a note cable's tap: the pads of the module that play this instrument, a pick opens that pad's inspector (Edit mode)
function padsNoteTap(c) {
  const M = padMod(c.mod), B = modBodies.get(c.mod), L = M && Array.isArray(c.pads) ? c.pads.filter(i => PC.visible(M, i)) : [];
  if (!L.length || !B || B.kind !== 'pads') return;
  const p = modAt(cvView && cvView.cables.badge(c.id));
  cvTray.popupMenu(p.x, p.y, L.map(i => ({ label: 'Pad ' + PC.padNo(M, i) + ' · ' + (PC.padLabel(M.pads[i], project) || 'empty'), action: () => B.inspect(i) })));
}
/* ---- the mod layer's host */
// (a no-op step on top, which record keeps, is this state too: it becomes the gesture's step.) A refusal (modUnpre) or a
// gesture that changed nothing (modStep) leaves no step behind (History.prune)
function modPre() { // a canvas row is about to change: the gesture's step (once; its label at modStep)
  if (modPend && modPend.e && hist.u[hist.u.length - 1] === modPend.e) return;
  hist.record(project, 'Modulation');
  modPend = { e: hist.u[hist.u.length - 1] || null };
}
function modUnpre() { const P = modPend; if (P && P.e && hist.u[hist.u.length - 1] === P.e && hist.prune(project)) modPend = null; updateUndoUI(); }
// Save with preset / Keep on canvas: the move on its step (undo / redo move that row alone)
function modMeta(t, dev, slot, row) { if (modPend && modPend.e) modPend.e.meta = { trackId: t.id, dev, slot, row: JSON.parse(JSON.stringify(row)) }; }
function modStep(label) {
  const P = modPend, t = trk();
  modPend = null;
  if (P && P.e && hist.u[hist.u.length - 1] === P.e) { P.e.label = label; hist.prune(project); }
  cvModAfter(t);
  sxRefresh(); // (a preset row's edit: the Serum's matrix page)
}
// (U12) the layer's gesture ended where it began (a two-finger rollback, a drag back): the step its first edit opened goes
function modUnstep() {
  const P = modPend;
  modPend = null;
  if (P && P.e && hist.u[hist.u.length - 1] === P.e) { hist._drop(hist.u.pop()); updateUndoUI(); }
}
// after every row edit: the patch, the Serum's halos, the view (cables, the "mods n/64" badge), the track rows
function cvModAfter(t) { queuePatch(t); modHalos(t); cvRender(); renderHeads(); persist(); updateUndoUI(); }
function modHalos(t) {
  for (const d of sxIds(t)) {
    const r = sxRecOf(t.id, d);
    if (r && r.ui && r.trackId === t.id && typeof r.ui.paintMods === 'function') { try { r.ui.paintMods(true); } catch (err) { console.warn(err); } }
  }
  fxHalos(t); // ((U5, halos fix) the FX racks: a Serum's own FX module, a shared panel)
  cpHalos(t); // (2b: the classic panels' rings and range bars)
}
/* ---- (2b halos fix) the FX racks' halos: the canvas rows on a rack's knobs (fx-ui paintMods: Serum's arc rule) and their live
   dots (setLive). The racks: 'iN/fx' a Serum's own FX (rows through sxExtra: the Serum source each compiles to), 'fxN' a shared
   panel (rows straight from track.mods, like a classic panel's); the live value of a knob: a Serum's snapshot eff at its
   FX-context index, a panel's base + the ModCore offsets its monitor message carries (mo, engine.js postMon). */
const fxKeysOf = t => [...sxIds(t).map(d => d + '/fx'), ...Object.keys(t.dev || {}).filter(k => t.dev[k] && t.dev[k].kind === 'panel')];
const rowPol = kind => (/^(bend|chaos)$/.test(kind) ? 'bi' : 'uni');
function fxRowsOf(t, key) { // → rowsOf(destId) for fx-ui paintMods, or null (a rack that takes no canvas rows)
  const own = /\/fx$/.test(key) ? key.slice(0, -3) : null, memo = new Map();
  let by = null;
  if (own ? !isSxDev(t, own) : !t.dev || !t.dev[key] || t.dev[key].kind !== 'panel') return null;
  return id => {
    if (!memo.has(id)) {
      if (own) memo.set(id, sxExtra(t, own, id));
      else { by = by || cpRows(t, key); memo.set(id, (by[id] || []).map(r => Object.assign({}, r, { pol: rowPol(r.kind) }))); }
    }
    return memo.get(id);
  };
}
function fxHalos(t, only) {
  for (const key of fxKeysOf(t)) {
    if (only && key !== only) continue;
    const rec = fxRecOf(t.id, key), rowsOf = rec && rec.ui && rec.trackId === t.id && typeof rec.ui.paintMods === 'function' ? fxRowsOf(t, key) : null;
    if (rowsOf) { try { rec.ui.paintMods(rowsOf); } catch (err) { console.warn(err); } }
  }
}
// the knob id → its FX-context index in a panel's ModCore offsets (mo): the payload's fx rows of that chain (cached per payload)
const fxMoIdx = new Map(); // '<track id>/<panel>' → { key, ix: { destId: fx index } }
function fxMoIndex(t, key) {
  const pay = modsPay(t), k = t.id + '/' + key;
  if (pay.off) return null;
  let c = fxMoIdx.get(k);
  if (!c || c.key !== pay.key) {
    const ix = {};
    for (const r of pay.rows) {
      if (!r.dst || r.dst.kind !== 'fx' || r.dst.chain !== key) continue;
      const row = (t.mods || []).find(x => x.id === r.id), D = row && modSplit(row.dst);
      if (D) ix[D.pid] = r.dst.fx;
    }
    fxMoIdx.set(k, c = { key: pay.key, ix });
  }
  return c.ix;
}
// a rack's monitor message → its knobs' live dots: a Serum's own FX from the snapshot's eff (NSV + the FX-context index), a
// panel from base + mo (the ModCore's offsets, clamped 0…1); a panel message without mo (no ModCore rows): the dots off
function fxLive(tid, key, rec, d) {
  const t = project.tracks.find(x => x.id === tid), u = rec && rec.ui;
  if (!t || !u || typeof u.setLive !== 'function') return;
  let f = null;
  if (/\/fx$/.test(key)) {
    const eff = d && d.s && d.s.eff, fx = eff ? fxOfDev(t, key.slice(0, -3)) : null;
    if (eff && fx) f = id => { let q = null; try { q = core.fxDest(id, fx); } catch (err) { q = null; } const i = q && Number.isFinite(q.flat) ? core.NSV + 8 + q.flat : -1; return i >= 0 && i < eff.length ? eff[i] : null; };
  } else if (d && d.mo) {
    const ix = fxMoIndex(t, key), mo = d.mo;
    if (ix) f = (id, base) => { const i = ix[id]; return i !== undefined && i < mo.length ? clamp(base + mo[i], 0, 1) : null; };
  }
  try { u.setLive(f); } catch (err) { console.warn(err); }
}
/* ---- (2b) classic halos: the rows on each control and the engine's eff snapshot (IMPL-2b §2.4, §6.2) */
// the rows on a classic instrument's controls as classic-panel setMods reads them ({ ctlId: [{ id, src, kind, amt, bi, byp,
// out, label }] }; kind: the source module's, a linked Serum LFO / ENV as lfo / env)
function cpRows(t, dev) {
  const by = {};
  for (const r of CG.modRowsFor(t, dev)) {
    const D = modSplit(r.dst), q = modSrcOf(r.src);
    if (!D) continue;
    const kind = q && q.link ? (/^lfo/.test(q.link) ? 'lfo' : 'env') : cvCables.srcKind(r.src) || CMOD.MOD_SRC[r.src] || 'wheel';
    (by[D.pid] || (by[D.pid] = [])).push({ id: r.id, src: r.src, kind, amt: r.amt, bi: r.bi, byp: r.byp, out: r.out, label: modLabel(r.src) });
  }
  return by;
}
const cpMons = new Map(), cpLive = new Map(), cpXf = new Map(), cpVer = new Map(); // '<track id>/<dev>' → off | { ctlId: knob units } | '…/<ctl>/<tgt>' → { sig, xf } | the instrument's values' version (valChanged)
// the mounted classic panels of t (one: `only`): their halos from the rows, a monitor subscription while cabled (dropped
// when the rows go, or with the panel: cvDropBody)
function cpHalos(t, only) {
  for (const dev of CMOD.instIds(t)) {
    if (isSxDev(t, dev) || (only && dev !== only)) continue;
    const k = t.id + '/' + dev, P = classicPanels.get(k), rows = cpRows(t, dev), any = Object.keys(rows).length > 0;
    if (P && !P.dead) { try { P.setMods(rows, any ? cpLive.get(k) || null : null); } catch (err) { console.warn(err); } }
    if (any && P && !P.dead && !cpMons.has(k)) cpMonitor(t.id, dev);
    else if (!any && cpMons.has(k)) cpMonOff(k);
  }
}
function cpMonOff(k) { const off = cpMons.get(k); if (off) off(); cpMons.delete(k); cpLive.delete(k); }
function cpMonitor(tid, dev) {
  const k = tid + '/' + dev;
  cpMons.set(k, monitors.sub(tid, dev, { role: 'inst',
    live: () => { const P = classicPanels.get(k); return !!P && !P.dead && project.selTrack === tid && cvLive(dev); }, // (on-screen modules only)
    deliver: d => { if (d.s && d.s.eff) cpSnap(tid, dev, d.s.eff); } }));
}
// the Inst's eff snapshot (engine units, one per payload row of that Inst in payload order — lane A2's modEff) → knob
// units through the inverse transfer (cv-mods xferInv of the row's target; the sweep cached per instrument values —
// (C4) keyed by the values' version and the payload, never a JSON per tick; the payload the last build's, no compile here).
// (U3) an eff outside the transfer's range (a span-setter row whose field the engine reports in other units) gives no
// live value: the dot hides rather than pinning at an end
function cpSnap(tid, dev, eff) {
  const t = project.tracks.find(x => x.id === tid), k = tid + '/' + dev, P = classicPanels.get(k);
  if (!t || !P || P.dead || !t.dev || !t.dev[dev]) return;
  const pay = modsPay(t);
  if (pay.off) return;
  const d = t.dev[dev], m = modelById(d.model), out = {}, sig = pay.key + '/' + (cpVer.get(k) || 0) + '/' + d.model;
  let j = 0;
  for (const r of pay.rows) {
    if (!r.dst || r.dst.inst !== dev || (r.dst.kind !== 'cls' && r.dst.kind !== 'set')) continue;
    const row = (t.mods || []).find(x => x.id === r.id), D = row && modSplit(row.dst), c = D && (m.controls || []).find(x => x.id === D.pid);
    if (c && j < eff.length) {
      const ck = k + '/' + D.pid + '/' + (r.tgt | 0);
      let X = cpXf.get(ck);
      if (!X || X.sig !== sig) { const T = modTargetsOf(m, D.pid)[r.tgt | 0]; X = { sig, xf: T ? modXferOf(m, d.vals, D.pid, T) : null }; cpXf.set(ck, X); }
      if (X.xf && xferHas(X.xf, eff[j])) {
        const x = modXferInv(X.xf, eff[j]), lo = c.t === 'k' ? c.min : 0, hi = c.t === 'k' ? c.max : c.t === 's' ? c.opts.length - 1 : 1;
        out[D.pid] = c.t === 'k' ? lo + (hi - lo) * x : Math.round(lo + (hi - lo) * x);
      }
    }
    j++;
  }
  cpLive.set(k, out);
  try { P.setLive(out); } catch (err) { console.warn(err); }
}
// is engine value s within transfer xf's range (a table's span, or the line a + b·x over x 0…1), a hair of slack?
function xferHas(xf, s) {
  if (!(s === s) || s === Infinity || s === -Infinity) return false;
  let lo, hi;
  if (xf.tab) { lo = Infinity; hi = -Infinity; for (let i = 0; i < xf.tab.length; i++) { const v = xf.tab[i]; if (v < lo) lo = v; if (v > hi) hi = v; } }
  else { lo = Math.min(xf.a, xf.a + xf.b); hi = Math.max(xf.a, xf.a + xf.b); }
  const eps = 1e-6 + 1e-3 * (hi - lo);
  return s >= lo - eps && s <= hi + eps;
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
  if (!key || !isSxDev(t, key.preset)) return null;
  let out = null;
  sxEdit(instView(t, key.preset), s => { const M = s.matrix.slice(); M[key.slot] = out = core.normRow(Object.assign({}, M[key.slot], f)); s.matrix = M; });
  modHalos(t);
  return out;
}
function modRemove(key) {
  const t = trk();
  if (typeof key === 'string') { modPre(); const r = CMOD.removeMod(t, key); queuePatch(t); return r; }
  if (!key || !isSxDev(t, key.preset)) return null;
  sxEdit(instView(t, key.preset), s => { const M = s.matrix.slice(); M[key.slot] = core.normRow(null); s.matrix = M; });
  return { ok: true };
}
// Save with preset / Keep on canvas: the row moves between track.mods and the Serum's matrix (applied through sxEdit: its
// panel and the patch follow); the compile is the same (cv-model keeps the slot)
function modToPreset(id) {
  const t = trk(), r0 = (t.mods || []).find(x => x.id === id), D = r0 && modSplit(r0.dst);
  if (!D || !isSxDev(t, D.dev)) return { ok: false, why: 'No such cable' };
  modPre();
  const iv = instView(t, D.dev), r = CMOD.toPreset(t, id, iv.vals.s);
  if (!r.ok) { modUnpre(); return r; }
  sxEdit(iv, s => { s.matrix = r.matrix; });
  modMeta(t, D.dev, r.slot, r.matrix[r.slot]);
  return r;
}
function modFromPreset(dev, slot) {
  const t = trk();
  if (!isSxDev(t, dev)) return { ok: false, why: 'No such instrument' };
  modPre();
  const iv = instView(t, dev), row = iv.vals.s.matrix[slot], r = CMOD.fromPreset(t, dev, slot, { project });
  if (!r.ok) { modUnpre(); return r; }
  sxEdit(iv, s => { s.matrix = r.matrix; });
  modMeta(t, dev, slot, row);
  return r;
}
// a Serum's destinations as its matrix menu groups them (serum-core destMenu: the sections, one group per FX instance)
// (2b) a classic synth's by the model's sections (chunk knobs greyed "stage 5"; struct / none nomod); a panel's by effect
// instance (nomod rows greyed)
function modDescs(dev) {
  const t = trk(), d = dev && t.dev ? t.dev[dev] : null, out = [];
  if (!d) return out;
  if (isSxDev(t, dev)) { for (const g of core.destMenu(d.vals.s, d.fx, { matrix: true })) for (const it of g.items) out.push({ id: it.id, label: it.label, group: g.group, nomod: CMOD.plainSwitch(it.id) }); return out; } // ((canvas 2b) the filter's routing switches are plain switches: greyed)
  if (d.kind === 'synth') {
    const m = modelById(d.model), by = new Map(modDescsOf(d).map(x => [x.id, x])), seen = new Set();
    const put = (group, x) => { const r = CMOD.destOk(d, x.id); seen.add(x.id); out.push(Object.assign({ id: x.id, label: x.label, group, nomod: !r.ok && !r.stage }, r.stage ? { stage: r.stage } : null, !r.ok && !r.stage && r.why ? { why: r.why } : null)); };
    for (const sec of m.sections || []) for (const c of sec.c || []) { const x = by.get(c.id); if (x && !seen.has(c.id)) put(sec.title || 'Panel', x); }
    for (const x of by.values()) if (!seen.has(x.id)) put('Other', x);
    return out;
  }
  if (d.kind === 'panel') for (const x of modDescsOf(d)) { const mm = /^fx\.([^.]+)\./.exec(x.id); out.push({ id: x.id, label: x.label, group: mm ? modInstLabel(d, mm[1]) : 'Effects', nomod: !!x.nomod }); }
  return out;
}
// (milestone 3) a Serum's matrix rows the layer lists: its performance rows (2a: Mod Wheel, Velocity, Aftertouch, Bend) —
// in parts view every row with a source and a destination (the Mod list replaces MATRIX; own LFO / ENV / macro rows own: true)
function modPresetRows(t, dev) {
  const d = t.dev && t.dev[dev];
  if (!d) return [];
  if (!sxParts(t, dev)) return CMOD.presetRows(d);
  const M = Array.isArray(d.vals.s.matrix) ? d.vals.s.matrix : [], out = [];
  M.forEach((r, slot) => { if (r && r.src && typeof r.dst === 'string' && r.dst) out.push(Object.assign({ slot, own: !CMOD.SRC_MOD[r.src] }, r, CMOD.SRC_MOD[r.src] ? { from: CMOD.SRC_MOD[r.src] } : null)); });
  return out;
}
// (§2.4) a destination of Serum dev that no mounted view shows (its part has no module, a closed popover, a folded fold-out):
// { tag: 'OSC B · LEVEL · hidden', show: { label: 'Show OSC B', action } } — the part shown (a lay entry, dimmed while off:
// no sound change, one step) or its module revealed; null when the knob is on screen or the Serum is bundled
function modHidden(dev, pid) {
  const t = trk();
  if (!cvView || cvView.trackId !== t.id || !sxParts(t, dev) || /^fx\./.test(pid)) return null;
  const q = cvView.destPort(dev, pid);
  if (!q || !q.hid) return null;
  const part = typeof core.moduleOf === 'function' ? core.moduleOf(pid) : null, k = part && SE.PARTS.includes(part) ? dev + '/' + part : null;
  const tag = q.tag || cvCables.hiddenTag(pid), lab = k ? rigLabel(t, dev, part) : RC.MODULES.amp.label;
  if (k && !cvView.modules.has(k)) return { tag, show: { label: 'Show ' + lab, action: () => sxShowPart(dev, part) } };
  return { tag, show: { label: 'Show ' + lab, action: () => cvReveal(t.id, k || dev) } };
}
function modSources(dev) { // the Serum's own sources (the aux menu)
  const t = trk(), d = isSxDev(t, dev) ? t.dev[dev] : null, out = [];
  if (d) for (const g of core.srcMenu(d.vals.s)) for (const it of g.items) out.push({ id: it.id, label: it.label, group: g.group });
  return out;
}
function initModLayer() {
  if (modLayer) return;
  try {
    if (document.head && !document.getElementById('cvModStyle')) { const st = h('style'); st.id = 'cvModStyle'; st.textContent = MOD_STYLE; document.head.append(st); } // (the layer's styles, once)
    modLayer = createModLayer(modHostO = {
      doc: document, layer: $('#ov') || document.body,
      descs: modDescs, sources: modSources, cancel: modUnstep,
      rowsOf: dev => { const t = trk(); return dev ? CG.modRowsFor(t, dev) : Array.isArray(t.mods) ? t.mods.slice() : []; },
      presetRows: dev => modPresetRows(trk(), dev), // ((3) parts view: every s.matrix row — the Mod list replaces MATRIX)
      nativeLabel: (dev, src) => { const x = modSources(dev).find(q => q.id === src); return x ? x.label : ''; }, // ((3) a Serum source's name)
      hidden: (dev, pid) => modHidden(dev, pid), // ((3, §2.4) a knob no mounted view shows: its tag, Show …
      budget: dev => { const t = trk(), d = t.dev && t.dev[dev]; return Object.assign(modBudgetOf(t, dev), { kind: isSxDev(t, dev) ? 'serum' : d && d.kind === 'panel' ? 'panel' : 'classic' }); }, // (2b: the ModCore slots, the device kind; (U9) cables, not payload rows)
      edit: modEdit, remove: modRemove, toPreset: modToPreset, fromPreset: modFromPreset,
      connect: (src, dst) => { // (the parameter list: no step here — the layer names it)
        const ok = modCan(src, dst), own = sxOwnSrc(src), D0 = modSplit(dst);
        if (!ok.ok) return { ok: false, why: ok.why };
        if (own && D0 && D0.dev === own.dev) { const id = sxOwnConnect(trk(), own, D0.pid); return id ? { ok: true, row: { id } } : { ok: false, why: modRefusal('full', { dev: cvDevName(trk(), own.dev), used: 64, max: 64 }) }; } // ((3) a native row: the Serum's own undo
        if (own) src = own.link;
        modPre();
        const t = trk(), D = modSplit(dst), r = CMOD.addMod(t, src, dst, { project, name: cvDevName(t, D.dev), limit: prefs.limitDrop });
        if (!r.ok) { modUnpre(); return r; }
        const left = modLeftWhy(t, D.dev, r.row.id); // (2b: a row the ModCore budgets refuse goes again)
        if (left) { CMOD.removeMod(t, r.row.id); modUnpre(); return { ok: false, why: left }; }
        queuePatch(t);
        return r;
      },
      select: modSelect, notice: txt => notice(txt, 4000), labelOf: modLabel, step: modStep, confirm: q => confirm(q),
    });
  } catch (err) { modLayer = null; console.warn('The modulation inspector is unavailable', err); }
}
// ⋯ → Modulation list…: every mod row of the track by Serum (canvas and preset), the budgets
function modList() { const t = trk(); if (modLayer) modLayer.openList(t.name, modDestDevs(t).map(id => ({ id, label: cvDevName(t, id) }))); }
// undo / redo / a load (applyRestore), a preset load (sxLoad): the open inspector and Mod list re-read, (2b) the editing
// bodies re-read their state; no gesture open
function cvModSync() {
  modPend = null;
  if (modLayer) modLayer.sync();
  for (const B of modBodies.values()) if (typeof B.sync === 'function') { try { B.sync(); } catch (err) { console.warn(err); } }
}
// (a preset load: canvas rows it leaves without a slot are said — "Serum's mod rows are full (64/64): 1 modulation cable not
// compiled"; (2b) a classic / panel row the ModCore budgets left out the same way)
function cvModReload(t) {
  for (const dev of modDestDevs(t)) {
    if (!CG.modRowsFor(t, dev).length) continue;
    const k = t.id + '/' + dev, was = modLeftN.get(k) || 0, b = CG.modBudget(t, dev, project), n = b.left.length;
    modLeftN.set(k, n);
    if (n > was) notice(modRefusal((b.why && b.why[b.left[0]]) || 'full', { dev: cvDevName(t, dev), used: b.preset + b.canvas, max: b.max, slots: b.slots }) + `: ${n} modulation cable${n > 1 ? 's' : ''} not compiled`, 6000);
  }
  if (t === trk()) cvRender();
  cvModSync();
}
// a Serum page switch (its ui edits): the knob ends of its module measured again (next frame: the page is built)
let modMeasT = 0;
const modMeasQ = new Set();
function cvRemeasure(id, dev) {
  modMeasQ.add(id + '\n' + dev);
  if (!modMeasT) modMeasT = requestAnimationFrame(() => {
    modMeasT = 0;
    for (const q of modMeasQ) { const [tid, d] = q.split('\n'); if (cvView && cvView.trackId === tid) { cvView.remeasure(d); for (const k of cvView.partsOf(d)) cvView.remeasure(k); } } // ((3) its part modules too)
    modMeasQ.clear();
  });
}
// (stage 2a UI fixes, tests/canvas-2a-sim: its own hook beside __synthTest.cv.mod)
if (globalThis.__synthTest && typeof globalThis.__synthTest === 'object') {
  globalThis.__synthTest.modUI = { spot: modSpot, show: modShow, hint: modHint, lane: modLane, jumpItems: modJumpItems, jump: modJump, bypass: modBypass, unstep: modUnstep, aside: modAside,
    editState: modEditState, val: modVal, learn: modLearn, cc: modCC, halos: cpHalos, snap: cpSnap, rows: cpRows, mons: cpMons, live: cpLive, srcPick: modSrcPick, left: modLeftWhy, jackTap: modJackTap, srcList: modSrcList, destDevs: modDestDevs, // (2b)
    pay: modsPay, built: () => modsBuilt, mcMons, mcSnap, matrixRows: sxMatrixRows, fxPrune, modHalos, fxHalos, fxLive, fxRows: fxRowsOf }; // (2b fixer C; halos fix)
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
  if (cvMaster || !cvOn() || !cvView || !cvViewKey || $('#tab-inst').hidden || typeof requestAnimationFrame !== 'function') return false;
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
    view: () => cvView, parts: cvParts, world: () => cvW(), sxRec, fxRec, monitors, hist, undo, redo, render: cvRender, // (R6: the per-device records, no singletons)
    renderViews, tidy: cvTidy, drop: cvDropInstrument, reveal: cvReveal, size: cvModuleSize, live: cvLive, camFlush: cvCamFlush,
    chipSync: cvChipSync, heads: renderHeads, duplicateTrack, openTab, about: cvAbout, menu: cvMenu, peer: () => ({ peerT, peerQ, peerStale }),
    setLayout: cvSetLayout, instUi, hw: () => { const P = curPanel(); return P ? P.hw : null; }, presetStep, presetInit, panel: curPanel, classicFile,
    // (stage 1e)
    // (stage 1e; 1f: add / power / zone are hooks only — no UI reaches them — for the host and engine-protocol tests)
    add: cvAddInstrument, power: cvPower, zone: cvZone,
    badge: cvBadge, cur: () => curOf(trk()), setCur: key => setCur(trk(), key), view1e: k => instView(trk(), k),
    fx: { items: FX_ITEMS, cost: fxCost, addEffect: (key, type) => (cvMaster ? mAddEffect(type) : cvAddEffect(trk(), key, type)) }, // ((2026-10-22) no Effects tray: no tiles, pick, drag; (M) the master canvas: its rack)
    classicPanels, serumPanels, fxPanels, bodyEl: key => cvBodyEl(trk(), key), measure: cvMeasure, costLabels, devFactor, setTrackModel, renderPanels,
    touch: (t0 => v => { touchDev = v == null ? t0 : !!v; })(touchDev), // (the soft caps' touch rule; null: back to this device's)
    wheelToWt, chordCheck, mount: () => (cvMount ? { jobs: cvMount.jobs.map(j => j.key) } : null), // (a switch's mounting: the bodies still to build)
    perf: PERF, // (1i: tests/canvas-1i-sim)
    // (7a: tests/canvas-7a-sim) the drum machines' host and the page's drum section
    drum: DRUM, drumSend, drumToRoll, drumLoad, drumOf, drumPayload, drumNeeds, drMons, srcUi, layFlow, setProjectBpm, panic, importMidiFile, projectFile,
    // (8: tests/canvas-8-sim) the Pads host and a module's mounted body
    pads: PADS, padsBody: id => { const B = modBodies.get(id); return B && B.kind === 'pads' ? B : null; }, padLit, loadProject: (j, o) => loadProject(j, o), applyRestore,
    // (9: tests/canvas-9-sim) the 900 Series' host, its cord layer (the world's), the page's patch section
    patch: PATCH, cords: () => cvCords(), patchOf, patchPayload, patchSend, isPatchDev, pmBodies, moogPick, moogDrag, ptSet, ptKnob, srcPick, srcDrag, ptHeavy: () => ({ PT_HEAVY, done: ptHeavyDone }),
    // (9b: tests/canvas-9b-sim) the set tiles, the events, the lamps' monitors ('trackId/dev' → its mounted lamp faces' keys)
    setPick, setDrag, setBox, ptEv, ptLamps: () => new Map([...ptMons].map(([k, E]) => [k, [...E.keys]])),
    bounceSet: sr => bounceSet(sr), mix: () => mix(),

    // (stage 2a, tests/canvas-2a-sim)
    mod: { add: modAdd, drag: modTileDrag, del: modDelete, opts: modDragOpts, connect: modConnect, can: modCan, marks: modMarks, layer: () => modLayer, host: () => modHostO,
      bodies: modBodies, sel: modCableSel, act: modCableAct, cmenu: modCableMenu, list: modList, label: modLabel, descs: modDescs, decor: cvModDecor, cableDrag: () => modDrag },
  };
  // (stage M: tests/canvas-M-sim) the master: its record and graph, the canvas, the rack's host, the listening controls, the bounce's helpers
  globalThis.__synthTest.master = {
    rec: () => mnode, graph: () => ({ an, mono, level: master, split: mSplit, anL, anR }), on: () => cvMaster, open: masterOpen,
    off: () => { if (cvMaster) { masterOff(); renderViews(); tabTrackUI(); ptShow(); } }, fx: masterFx, edit: masterEdit, host: mfxHost, ui: mfxRec,
    state: () => Object.assign({}, mstate), ab: abSet, mono: monoSet, row: () => mrow, out: () => mout, chain: masterChain, n: masterN,
    latBound, addEffect: mAddEffect, menu: mMenu, view: masterRec, read: mRead, normMode, playRate,
  };
  // (SC: tests/canvas-SC-sim) the sidechain's host (IMPL-SC §9.1): a track's wanted edges (the project's) and those with a node, a
  // sync, every track's, the loop test, keyed (ptPower's), any (mAlign's), the node's edges [[source id, kg gain]]; and its parts
  globalThis.__synthTest.sc = {
    want: t => [...scWant(t)], srcs: t => [...scSrcs(t)], sync: t => scSync(t), all: () => scAll(), cycle: (t, id) => scCycle(t, id),
    keyed: t => scKeyed(t), any: () => scAny(), edges: t => { const N = t && nodes.get(t.id); return N ? [...N.scIn].map(([id, e]) => [id, e.kg.gain.value]) : []; },
    graph: () => scGraph(), keySet: () => [...scKeySet()], sources: self => scSources(self), freshId: () => scFreshId(), mAlign: F => mAlign(F),
  };
  // (stage WC, IMPL-WC §8.2, §11.1: tests/canvas-WC-sim, ui-bench-wc) the rig's host — add / remove / plug / pull / repatch / can / edges
  // (rig-core's ends: 'oscA.out', 'voice.main'), the first drop (drop: a tile's tap / drop, replace), Make it a <NAME> (convert), Init,
  // the amp slot (amp: plug an Envelope into LEVEL; gate: is ENV 1 the gate), the drawing mode (wires(mode?): read / set this session's),
  // the faces' host (ui), the cords' layer view (layer: the last list / anchors / rings), the widths (rig-ui's), the S0 line (HEAVY)
  const rigT = dev => { const t = trk(), d = dev || curOf(t); return isRigDev(t, d) ? { t, d, dv: t.dev[d] } : null; };
  globalThis.__synthTest.cv.rig = {
    add: (dev, kind, part, at) => rigAdd(dev || curOf(trk()), kind, at || null, part || null),
    remove: key => rigRemove(key),
    plug: (dev, a, b) => { const R = rigT(dev); return R ? rigEdit(R.t, R.d, 'Plug ' + rigEndLabel(R.t, R.d, a) + ' → ' + rigEndLabel(R.t, R.d, b), RC.plug(R.dv.vals.s, fxOfDev(R.t, R.d), a, b, rigOpts(R.t, R.d))) : false; },
    pull: (dev, id) => { const R = rigT(dev); return R ? rigEdit(R.t, R.d, 'Pull', RC.pull(R.dv.vals.s, fxOfDev(R.t, R.d), id, rigOpts(R.t, R.d))) : false; },
    repatch: (dev, id, end, b) => { const R = rigT(dev); return R ? rigEdit(R.t, R.d, 'Re-patch', RC.repatch(R.dv.vals.s, fxOfDev(R.t, R.d), id, end, b, rigOpts(R.t, R.d))) : false; },
    can: (dev, a, b) => { const R = rigT(dev); return R ? RC.can(R.dv.vals.s, fxOfDev(R.t, R.d), a, b, { used: sxUsed(R.t, R.d), rig: R.dv.rig }) : { ok: false, why: 'No rig' }; },
    edges: dev => { const R = rigT(dev); return R ? rigEdges(R.t, R.d) : []; },
    drop: (kind, at) => sxPartDrop(kind, at || null), replace: (kind, at) => rigReplace(kind, at || null), convert: dev => rigConvert(dev || curOf(trk())),
    init: dev => rigInitDev(dev || curOf(trk())), starter: dev => rigStarterDev(dev || curOf(trk())), tile: id => rigTile(id || RIG.ID),
    amp: (dev, k) => { const R = rigT(dev); return R ? rigEdit(R.t, R.d, 'Plug Envelope', RC.plug(R.dv.vals.s, fxOfDev(R.t, R.d), 'env' + k + '.out', 'voice.level', rigOpts(R.t, R.d))) : false; },
    gate: dev => { const R = rigT(dev); return R ? RC.isGate(R.dv.vals.s) : null; },
    wires: mode => { if (mode !== undefined) { rigWiresOv = wiresOk(mode) ? mode : null; cvRender(); ptShow(); } return drawMode(trk()); },
    mode: () => drawMode(trk()), cordOf, toCord: c => toCord(c, trk()), layer: () => rigLast, cordsOn: () => rigCordsOn, ui: () => RIGUI, setUi: v => { RIGUI = v; },
    width: part => rigW(part), height: part => rigHt(part), opts: dev => { const R = rigT(dev); return R ? rigOpts(R.t, R.d) : null; }, envSwap: (dev, a, b) => rigEnvSwap(trk(), dev || curOf(trk()), a, b), envInit: dev => rigEnvInit(trk(), dev || curOf(trk())),
    aim: rigAim, spread: rigSpread, jackAt: rigJackAt, ringCss: rigRingCss, menuLast: () => rigMenuLast, HEAVY: SX_HEAVY,
  };
  globalThis.__synthTest.cv.cordsOf = () => cvCords(); // (the world's cord layer: list / anchors / stats / hit through it)
  // (milestone 3, lane D: tests/canvas-3-sim, ui-bench ?m3=1&real=1) the parts hook on cv.parts — cvParts' own fields (home,
  // root, scope, about) stay as they are
  Object.assign(cvParts, {
    add: sxAddPart, remove: sxRemovePart, showPart: sxShowPart, rec: dev => sxRecOf(trk().id, dev), list: dev => sxPartList(trk(), dev),
    isParts: dev => sxParts(trk(), dev), connect: sxConnect, can: sxCan, act: sxCableAct, pick: sxPartPick, drop: sxPartDrop, drag: sxPartDrag,
    own: sxOwnSrc, hidden: modHidden, settle: sxSettle, spot: sxSpot, decor: sxPartsDecor,
    module: () => SXMOD, widths: () => SXW, setModule: m => { SXMOD = m || null; SXW = m ? m.PART_W || null : null; }, live: modLive, cancel: modCancel, rowsOps: modRowsOps,
    views: modViews, modSpot, modClear, mcSnap, injEnv: sxInjEnv, presetRows: dev => modPresetRows(trk(), dev),
    painted: sxHeavyCount, heavyReset: () => { sxHeavyDone = false; ptHeavyDone = false; sxHeavySig = ''; }, HEAVY: SX_HEAVY, HEAVY_MS: SX_HEAVY_MS, // (the S0 notice, §9.9)
  });
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
  ptUp = true; PATCH.attach(); // ((9) the cord jacks' keys / right-click and their sleep below READ_K, on the world now it exists
  renderAll();
  ptShow(); // ((9) a 900 Series shown at boot: its cords
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
    if (document.hidden) { releaseKeys(); PADS.release(); PADS.hwDark(); perfLetGo(); DRUM.release(); if (store.mode !== 'ls' || saveT) saveNow(); } else wake(); // ((7a) the pads, a held CLEAR; (8) the Pads modules' canvas holds, the hardware lights dark — §8.4)
    monitors.sync();
  });
  // (IMPL-A, Q2) the app with Sound in background off: the context suspended while the page is hidden — the wake() above
  // resumes it when the page is back
  if (SHELL) document.addEventListener('visibilitychange', () => { const c = ctx || pendCtx; if (bgHeld() && c && c.state === 'running') quiet(c.suspend()); });
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
  const tp = $('#tPanic');
  if (tp) tp.onclick = panic; // ((P, the user's decision) the top bar's Panic: always there — a folded keyboard hides the bar's; Esc as ever)
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
  // (IMPL-A §3.2 item 4) the app: the page is up — the Sound in background setting, then ready (native's queued calls, an
  // open from Files or a resume, wait for it; the restart flag goes back to false)
  if (SHELL) { shellBootMs = performance.now(); shellPost({ t: 'bg', on: bgOn() }); shellPost({ t: 'ready' }); }
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
    buildMods, compileMods: CG.compileMods, // (stage 2b, lane B: the {t: 'mods'} payload)
    modVal, modCC, modBudget: (t, dev) => CG.modBudget(t, dev, project), postMods, modsFor, // (stage 2b, lane D)
    scopeMode: m => { if (m) scopeMode = m; return scopeMode; }, scopeSource, // (the OUT scope: its Scope / Spectrum buttons are not wired in the sim's DOM stub)
  };
  // (milestone 3, R0: tests/accessors.test.mjs) the services the accessor retirement touches that no other hook reaches
  globalThis.__synthTest.acc = {
    presetSave, presetDelete, presetCur, presetInit, sxCurrent, sxRename, programChange, wheelToWt, syncPhases, setPhases, projectFile,
    importMidiFile, trkListUI, instItems, zoneOf, zoneWarm, msRecs, sxRecOf, fxRecOf, instView, curView, loadVals, trackVoice, rateText,
    sxKeys, sxDirty, presetKeys, voiceShown, seqHw, dxHw, hwDx, classicPanels, rackKey, rackKeys,
    uiLoad: p => { const was = uiLoad; uiLoad = p; return was; }, // (the panel modules never finish loading in node: a test hands them in)
    loadProject, normDevs, sxRec, fxKeyOf, curModel,
  };
}
boot();
