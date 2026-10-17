// assets.js — the main-thread asset manager (owner S1; SPEC-serum2 §9, §10, §11.12, §11.15, §14.2; split out of
// main.js in M1b, B19). Browser ES module, node-importable: nothing touches the DOM, workers, storage, `navigator` or
// `performance` at module top level, and every environment dependency can be injected (the tests run it on stubs).
// It is the only module that talks to smpwork / smprender / smpstore; it keeps the Phase-1 wavetable manager of
// main.js (`tables`, SPEC-serum §7.5, §11.8) and its panel host (`wtHost`, §8.8) and generalises them to every asset
// kind of §9.1 (samples, multisamples, spectral analyses, wavetables played as samples, shaped impulse responses).
//
//   const tables = createAssetManager({ ctxOf, post, worker, stores, tracks, edit, defaultState, refresh, … });
//
// Options (all optional; defaults = the browser behaviour):
//   ctxOf()                           the live AudioContext or null (main.js `ctx`)
//   post(msg, transfer, trackId, node) → boolean
//                                     posts to a port of the live context: the node of track `trackId`, else `node` (a
//                                     node not yet registered, e.g. inside makeNode), else any node of the context;
//                                     false when there is none (portPoster(nodes) builds it from main.js's node map)
//   worker(kind) → Worker | null      'wt' (wtwork.js, module), 'smp' (smpwork.js, module), 'render' (smprender.js,
//                                     classic); null = no workers (wavetable / sample entries are then built on the
//                                     main thread; factory renders are impossible); a throw marks module workers
//                                     unusable for the session (Phase 1)
//   stores {wt, smp}                  () → Promise<store>: the wtstore / smpstore instances (default: IndexedDB, else the
//                                     in-memory store)
//   wt(), smp(), gen()                → Promise<module>: wt.js / smp.js / smpgen.js (default: dynamic imports)
//   tracks()                          the project's tracks: objects with `id`, `name`, `vals.s` (Serum state, when the
//                                     track is a Serum track) and `fx` (its FX state); every track, so that Convolve
//                                     IRs of classic-model racks are found too
//   edit(track, fn, {label})          a Serum-state edit of a track: fn(s) (main.js sxEdit; a user table deleted, a sample
//                                     relinked)
//   editFx(track, fn, {label})        an FX-state edit of a track: fn(fx) (a relinked Convolve IR; without it Convolve
//                                     instances keep the missing id)
//   defaultState()                    a default Serum state (serum-core defaultSerum; the replacement sources)
//   refresh()                         the user rows changed or the sample modules loaded (main.js sxRefresh)
//   now(), timers {set, clear}        clock (ms) and timers (default performance.now, setTimeout / clearTimeout)
//   touch                             device class of §14.2 (pointer: coarse or touch seen): the budgets below
//   keepBytes                         unreferenced entries kept posted (default KEEP_BYTES_V2 by `touch`, §9.5)
//   budget                            worklet asset budget (default WORKLET_BUDGET by `touch`; the project meter)
//   lruBytes, cacheBytes              main-thread record LRU / IndexedDB cache budgets (defaults LRU_BYTES / CACHE_BYTES)
//   notify(text)                      user notices (import errors, storage, memory, generation)
//   progress(p | null)                factory generation progress {id, name, done, total} (null: finished); the host
//                                     shows "Generating factory sounds… n %" with a cancel button → host.smp.cancel()
//   persist() → Promise<boolean>      navigator.storage.persist (requested once, at the first user-asset import)
//   decode(bytes) → Promise<{rate, ch, L, R}>   non-WAV/AIFF audio (default OfflineAudioContext(2, 1, 48000))
//   inflate(bytes) → Promise<Uint8Array>        ZIP deflate (default DecompressionStream('deflate-raw'); none: skipped)
//   zoneOf(osc) → zone sample id | null         the recent voice's zone sample of a Multisample oscillator (from the
//                                     panel snapshot; host.smp.saveFrom)
//
// The manager keeps the Phase-1 `tables` surface (fields `needs`, `sent`, `pend`, `rows`, `user`, `gcT`, … and methods
// `entry`, `entries`, `build`, `source`, `gc`, `gcSoon`, `trim`, `update`, `list`, `embed`, `restore`, `drop`) with
//   ensure(needs, {trackId, node, s, fx, convMax}?) → Promise   resolves once every id is posted or has failed (never
//                                     rejects); `s` / `fx` (the states the needs were compiled from) are REQUIRED for
//                                     `~opsKey` / non-default `~shapeKey` ids of anything that is not a track (tracks
//                                     are also found through tracks()); `convMax` (s, FXP.convMax: the §14.3 Q3 cap)
//                                     rebuilds the posted shaped IRs at that length when it changes. The
//                                     preset-preview node passes trackId 'preview', its node and the preset's states:
//                                     ensure(needs, {trackId: 'preview', node, s: preset.v.s, fx: preset.fx}); it is
//                                     released like a track (§9.6: no assets in its processorOptions)
//   ready(needs) → boolean            false while an id of `needs` is being built to replace a posted variant of the
//                                     same asset (a trim / fade / Convolve shaping edit): post such a patch when
//                                     ensure(needs) resolves (re-check ready() with the newest patch then; a newer patch
//                                     of the track replaces a waiting one), so the old variant keeps playing until the
//                                     new one is there — any other patch is posted at once, as in Phase 1
//   entries(ids, rate?, {s, fx, convMax}?) → Promise<entry[]>   fresh entries for processorOptions (wavetables as
//                                     Phase 1 plus every §9 kind, multisamples with their zone samples, IRs prepared for
//                                     `rate` — compile bounce patches with sr: rate — full length unless convMax);
//                                     waits for (or triggers) factory generation, also of held ids (§9.6, sign-off 9);
//                                     non-track states (render-last of a preset, …) pass {s, fx} as for ensure()
//   release(trackId)                  (= Phase-1 drop(trackId))
// and adds wtMod() / WT, smpMods(), wtStore(), smpStore(), listSmp() (reads the stored user sample / multisample / IR
// rows into smpRows and refreshes the menus; done when the modules load and after every store change), meter(),
// fits(bytes), work(op, req, transfer) (smpwork), render(req) (the render farm), record(id, {force}?) (asset records,
// generated on demand), embedSmps(ids) / restoreSmps(smps) (§9.8), saveRecord(rec, {name, folder, odf, quiet}) (render
// last → folder 'Renders', resample, "Switch to Single Sample"; the menus refresh), relink(from, to), cancelGen(),
// retry(id), host.wt (Phase-1 wtHost) and host.smp (§11.15).
//
// Posting (§9.5): every id is built off the main thread and posted once per AudioContext — `{t: 'wt', …}` for the
// Phase-1 kinds, `{t: 'smp', …entry}` for §9 entries (a multisample posts its zone samples first, then its zones) —
// with its buffers transferred; entries are always freshly built. Unreferenced ids are freed (`wtdel` / `smpdel`)
// after 10 s, at once beyond keepBytes (oldest first). Variants (`~opsKey`, `~shapeKey`: the same asset with other
// entry-changing ops or Convolve shaping) are built one at a time per asset (§8.4: one build in flight, a newer target
// replaces the queued one, intermediate targets of a drag are never built); a superseded variant is freed once a
// replacement has been posted, in a task after the ensure() that replaced it resolves (so after the patch posted then),
// unless another track needs it; without a posted replacement it keeps playing until the 10 s GC.
// Factory generation that was cancelled (host.smp.cancel) or failed is not restarted by ensure() / panel reads until
// host.smp.retry(id), a selection adding the id to a track, or the id leaving every track (bounces still generate).
// A selection the §14.2 budget refused is not rebuilt until the meter has room for its size.
//
// IMPL details fixed here (normative for this project):
// - user asset ids: samples `smp:<16-hex hash>` and IRs `ir:<16-hex hash>` (smp.assetHash of the canonical PCM — §9.3
//   step 8 deduplication by id), multisamples `msmp:<uuid>`; factory zone samples `fmsmp:<Name>#<root>.<vel>`.
// - Convolve shape keys (fx-core compileFx): FNV-1a over Math.round(n·256) of size, tone, minph, att, dec, damp (fx-core
//   `fnv`, 4 bytes per value) → `<ir>@<rate>~<8 hex>`; the shape is built from the quantised n (size 0.1·100^n,
//   tone 2n − 1, minph n ≥ 0.5, att / dec / damp n), so an entry is a pure function of its id.
// - multisample zone entries get ℓmax + 1 levels, ℓmax = ceil(log2(2^(maxUp/12)·rate/44100)), maxUp = the largest
//   hi − root of the zones using that sample + 12 (§9.4.3); a sample a track also plays directly (Sample / Granular
//   oscillator, a bounce) gets the full levels (that entry then serves the zones too).
// - spectrogram data = Uint8ClampedArray(w·h), one byte per cell at [y·w + x] (x = time column, y = 0 the highest
//   frequency row), 0 ↔ ≤ −96 dB … 255 ↔ 0 dB re full scale — the panel applies its own palette.
// - host.smp.import(files, {kind, osc, replace}): `replace` = the id of a missing asset to relink (§9.9): a multisample
//   is stored under that id; a sample / IR keeps its content address and every sound using the missing id (edit /
//   editFx) and every user multisample zone is switched to it (relink). kind 'multi' without an SFZ: a multisample of
//   the dropped samples (one zone per root, key ranges split at the midpoints, the samples' loops). SFZ frame positions
//   (loop points, offset, end) are scaled from the file's own rate (smp.fileRate) to the stored record's; `end` plays
//   a copy of the sample cut there. Files the readers cannot decode keep their WAV smpl / AIFF INST root and loop
//   (scaled to the decoded rate). Deleting a user asset (§9.9) keeps the ids in the sounds that use it (they play
//   silence / bypass and the panel shows the "Missing sample" badge from host.smp.record(id) === null; a user
//   multisample's record lists deleted zone samples in `missing`); users(id) names the tracks, also those playing it
//   through a user multisample.
// - host.smp ids: record / pcm / overview / spectrogram / odf accept what a panel holds — sample, multisample and IR
//   ids, their variants (`~opsKey`, `spec:…`, `…@rate~shapeKey`) and wavetable ids played as samples (`factory:` /
//   `user:` → `wtsmp:`; their records carry the frame-boundary `marks`, they have no odf, §9.4.8); srcId(id) maps them.
//   overview(<ir>@<rate>~<shapeKey>, n) draws the shaped IR (smpwork op 'irview'; the Convolve display, §13), the
//   plain IR id its unshaped data.
//   host.smp.usage() = meter() (the GLOBAL page's asset meter, serum-ui), host.smp.cancel() stops a generation,
//   host.smp.retry(id) restarts a cancelled / failed one. list(): `ch` of factory IRs from FACTORY_IRS, of factory
//   samples from their generated record once known.
// - §14.2 budget: an entry whose posting would take the project's referenced entries over the device's worklet budget
//   is not posted (notice "Not enough memory for this sample on this device", once per id until it fits); idle
//   entries are freed first so that referenced + idle stay within the budget. Imports are refused before storing
//   (estimate 8 bytes per frame and channel at ≤ 48 kHz).
// - Spectral entries carry the analysed record's `root` (SxSpec) and are cached in smpstore `spec:<play id>[~r]@SPEC_VER`
//   (`.GEN_VER` appended for factory samples; not for user tables, which are editable) when still needed once built
//   (not the intermediate variants of a drag; a superseded `~opsKey` variant's entry is dropped); a source longer than
//   the 20 s cap shows a notice once per session. Cache trims never evict what the project uses now; factory records
//   served from the main-thread LRU mark their cache entry used.
// - farmPatch(model, preset, bpm) builds the render-farm patches (exported for the tests).
import { MODELS, patchFor } from './models.js?v=8';

const VERSION = '8';

/** Phase-1 budget of unreferenced wavetable entries kept posted in the worklet (§7.5). */
export const KEEP_BYTES = 32 * 1048576;
/** §9.5 / §14.2 v2 values of KEEP_BYTES (desktop / touch devices): the manager's default by `touch`. */
export const KEEP_BYTES_V2 = Object.freeze({ desktop: 64 * 1048576, touch: 32 * 1048576 });
/** §14.2 worklet asset budget (all tracks) — the project asset meter's limit. */
export const WORKLET_BUDGET = Object.freeze({ desktop: 192 * 1048576, touch: 128 * 1048576 });
/** §9.4.3 headroom (semitones) of multisample zone levels above the zone's own transposition: TIMBRE's 12 on desktops;
 * on touch devices (IMPL, §14.2 128 MB worklet budget) the default bend range, 2 — a zone entry then holds 2 levels
 * instead of 3 (≈ 1.5× instead of 1.75× the raw zone; 14–25 % less per factory multisample) and a higher reach (TIMBRE,
 * wide bends, coarse) reads its highest level (soft: more aliasing at the top only) */
export const ZONE_HEADROOM = Object.freeze({ desktop: 12, touch: 2 });
/** §9.7 / §14.2 main-thread record LRU budget. */
export const LRU_BYTES = Object.freeze({ desktop: 256 * 1048576, touch: 128 * 1048576 });
/** §9.2 / §14.2 IndexedDB cache budget (`cacheTrim`). */
export const CACHE_BYTES = Object.freeze({ desktop: 512 * 1048576, touch: 256 * 1048576 });
/** Worker scripts by kind (relative to the page, as Phase 1's wtwork.js). */
export const WORKERS = Object.freeze({
  wt: Object.freeze({ url: 'wtwork.js?v=' + VERSION, type: 'module' }),
  smp: Object.freeze({ url: 'smpwork.js?v=' + VERSION, type: 'module' }),
  render: Object.freeze({ url: 'smprender.js?v=' + VERSION, type: 'classic' }),
});
/** Notices (user-visible texts). */
export const TEXT = Object.freeze({
  unsupported: 'Unsupported audio file',
  memory: 'Not enough memory for this sample on this device',
  persist: 'This browser may delete imported samples after a while without visits — export the project to keep them',
  generating: 'Generating factory sounds…',
  genFailed: 'Factory sound could not be generated',
  truncated: 'Long file shortened',
  specCap: 'Spectral analysis covers the first 20 s',
  missing: 'Missing sample',
  noWorkers: 'Factory sounds need Web Workers, which this browser does not provide',
});

/** A user wavetable / user noise id (Phase 1). */
export const isUserId = id => typeof id === 'string' && /^(user|nzuser):/.test(id);
/** A user sample / multisample / impulse-response id (§9.1). */
export const isUserAsset = id => typeof id === 'string' && /^(smp|msmp|ir):[\w.-]{1,80}$/.test(id);
/** The transferable buffers of a wavetable / noise entry (a buffer may back several views). */
export const levelBufs = e => [...new Set(e.kind === 'noise' ? e.levels.flatMap(l => (l.R ? [l.L.buffer, l.R.buffer] : [l.L.buffer])) : e.levels.map(l => l.data.buffer))];
/** Every ArrayBuffer behind the typed arrays of an entry (§4.5 kinds and the Phase-1 ones). */
export function entryBufs(e, out = new Set(), depth = 0) {
  if (e == null || typeof e !== 'object' || depth > 6) return out;
  if (ArrayBuffer.isView(e)) { out.add(e.buffer); return out; }
  if (e instanceof ArrayBuffer) { out.add(e); return out; }
  for (const k of Object.keys(e)) entryBufs(e[k], out, depth + 1);
  return out;
}
const bufBytes = bufs => { let n = 0; for (const b of bufs) n += b.byteLength; return n; };
/**
 * The user tables / noises a Serum state references (v2, = serum-core tableNeeds restricted to user ids): every
 * oscillator's table (OSC A, B, C), a user table played as a sample (`osc[i].smp`, §9.4.8), the spectral filter's
 * table (`osc[i].spec.filt.wt`), the noise source; each id once.
 */
export function userIdsOf(s) {
  const out = [];
  const add = id => { if (isUserId(id) && !out.includes(id)) out.push(id); };
  if (!s || typeof s !== 'object') return out;
  for (const O of Array.isArray(s.osc) ? s.osc : []) {
    if (!O || typeof O !== 'object') continue;
    add(O.wt);
    add(O.smp);
    if (O.spec && O.spec.filt && typeof O.spec.filt === 'object') add(O.spec.filt.wt);
  }
  if (s.noise && typeof s.noise === 'object') add(s.noise.src);
  return out;
}

/**
 * The user sample / multisample / IR ids a track's Serum state and FX state reference (§9.8: what project and preset
 * files embed; zone samples of the multisamples are added by embedSmps).
 */
export function userAssetIds(s, fx) {
  const out = [];
  const add = id => { if (isUserAsset(id) && !out.includes(id)) out.push(id); };
  if (s && Array.isArray(s.osc)) for (const O of s.osc) if (O && typeof O === 'object') { add(O.smp); add(O.multi); }
  for (const ir of convIrs(fx)) add(ir);
  return out;
}
// Convolve instances of an FX state (every rack and splitter branch) → their objects
function convInstances(fx) {
  const out = [];
  if (!fx || typeof fx !== 'object' || !Array.isArray(fx.racks)) return out;
  const visit = I => {
    if (!I || typeof I !== 'object') return;
    if (I.type === 'conv') out.push(I);
    if (Array.isArray(I.br)) for (const b of I.br) if (Array.isArray(b)) b.forEach(visit);
  };
  for (const R of fx.racks) if (R && Array.isArray(R.mods)) R.mods.forEach(visit);
  return out;
}
const convIrs = fx => convInstances(fx).map(I => (I.sub && typeof I.sub.ir === 'string' ? I.sub.ir : '')).filter(Boolean);

// ---- §9.1 entry ids
/**
 * Kind of an asset id (§9.1): 'wt' for everything the Phase-1 wavetable path builds (factory/user tables, sub tables,
 * noises), 'smp' | 'multi' | 'ir' | 'wtsmp' | 'spec' for the §9 kinds (factory zone samples `fmsmp:<Name>#…` are
 * 'smp').
 */
export function idKind(id) {
  if (typeof id !== 'string' || !id) return '';
  if (/^(fsmp|smp):/.test(id)) return 'smp';
  if (/^fmsmp:[^#]*#/.test(id)) return 'smp';
  if (/^(fmsmp|msmp):/.test(id)) return 'multi';
  if (/^(fir|ir):/.test(id)) return 'ir';
  if (id.startsWith('wtsmp:')) return 'wtsmp';
  if (id.startsWith('spec:')) return 'spec';
  return 'wt';
}
// FNV-1a as fx-core `fnv` (4 bytes of an int, little end first) and serum-core `fnvStr`
const FNV0 = 0x811c9dc5;
function fnvInt(h, v) {
  v |= 0;
  h = Math.imul(h ^ (v & 255), 16777619);
  h = Math.imul(h ^ ((v >>> 8) & 255), 16777619);
  h = Math.imul(h ^ ((v >>> 16) & 255), 16777619);
  return Math.imul(h ^ (v >>> 24), 16777619);
}
const fnvStr = s => { let h = FNV0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };
const hex = h => (h >>> 0).toString(16).padStart(8, '0');
const finN = v => typeof v === 'number' && Number.isFinite(v);
/** §9.1 opsKey of `smpo.ops` (= serum-core opsKey): 8-hex FNV-1a of the canonical JSON of non-default trim / fade, '' if none. */
export function opsKeyOf(ops) {
  const o = ops && typeof ops === 'object' ? ops : {}, c = {};
  if (Array.isArray(o.trim) && o.trim.length === 2) c.trim = [o.trim[0], o.trim[1]];
  if (finN(o.fade) && o.fade > 0) c.fade = o.fade;
  return Object.keys(c).length ? hex(fnvStr(JSON.stringify(c))) : '';
}
const CONV_PIDS = ['size', 'tone', 'minph', 'att', 'dec', 'damp'];
const CONV_DEF = Object.freeze({ size: 0.5, tone: 0.5, minph: 0, att: 0, dec: 1, damp: 0 });
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Convolve shape key of an instance's normalised parameters (= fx-core compileFx's `~shapeKey`). */
export function convKeyOf(P) {
  const p = P && typeof P === 'object' ? P : {};
  let h = FNV0;
  for (const k of CONV_PIDS) h = fnvInt(h, Math.round((finN(p[k]) ? clamp01(p[k]) : CONV_DEF[k]) * 256));
  return hex(h);
}
/** The §8.4 shaping values (smp.irShape units) of an instance's normalised parameters, quantised as the key. */
export function convShapeOf(P) {
  const p = P && typeof P === 'object' ? P : {}, q = k => Math.round((finN(p[k]) ? clamp01(p[k]) : CONV_DEF[k]) * 256) / 256;
  return { size: 0.1 * Math.pow(100, q('size')), tone: 2 * q('tone') - 1, minph: q('minph') >= 0.5 ? 1 : 0, att: q('att'), dec: q('dec'), damp: q('damp') };
}
/** Parses `<ir id>@<rate>~<key>` → {ir, rate, key} or null. */
export function parseIrId(id) {
  const m = /^((?:fir|ir):.+)@(\d+)~([0-9a-f]{8})$/.exec(String(id));
  return m ? { ir: m[1], rate: +m[2], key: m[3] } : null;
}
// `<base>~<opsKey>` → {base, key}; spec ids → {play, rev}
const splitOps = id => { const m = /^(.*?)~([0-9a-f]{8})$/.exec(id); return m ? { base: m[1], key: m[2] } : { base: id, key: '' }; };
function parseSpec(id) {
  let play = id.slice(5), rev = false;
  if (play.endsWith('~r')) { play = play.slice(0, -2); rev = true; }
  return { play, rev };
}
// the base (asset without variant) of an entry id, for superseded-variant detection
function variantBase(id) {
  const k = idKind(id);
  if (k === 'ir') { const p = parseIrId(id); return p ? 'ir|' + p.ir + '@' + p.rate : ''; }
  if (k === 'spec') { const p = parseSpec(id), s = splitOps(p.play); return 'spec|' + s.base + (p.rev ? '~r' : ''); }
  if (k === 'smp' || k === 'wtsmp') return 'smp|' + splitOps(id).base;
  return '';
}
/**
 * The record id behind an id a panel passes (host.smp): a wavetable played as a sample (`factory:` / `user:`, §9.4.8)
 * → `wtsmp:<table id>`; a variant (`~opsKey`), a spectral id or a shaped IR → its source; other wavetable-path ids
 * (noises, sub tables) and anything else → ''.
 */
export function srcId(id) {
  if (typeof id !== 'string' || !id) return '';
  let x = id;
  if (x.startsWith('spec:')) x = parseSpec(x).play;
  const ir = parseIrId(x);
  if (ir) return ir.ir;
  x = splitOps(x).base;
  if (/^(factory|user):./.test(x)) return 'wtsmp:' + x;
  const k = idKind(x);
  return k === 'smp' || k === 'multi' || k === 'ir' || (k === 'wtsmp' && /^wtsmp:(factory|user):./.test(x)) ? x : '';
}

// the factory catalogue id behind an entry id (variants, spectral ids, shaped IRs, zone samples `fmsmp:<Name>#…`), or ''
function factoryOf(id) {
  const x = srcId(id);
  if (/^(fsmp|fir):/.test(x)) return x;
  const m = /^(fmsmp:[^#]+)(#.*)?$/.exec(x);
  return m ? m[1] : '';
}

// the cached spectral analyses of a sample id (keys `spec:<id>[~…]@<SPEC_VER>`)
const dropSpecCache = (st, id) => (typeof st.cacheDrop === 'function' ? Promise.all([st.cacheDrop('spec:' + id + '@'), st.cacheDrop('spec:' + id + '~')]) : Promise.resolve());
// whether entry id x is `base` or one of its variants: `base~<opsKey>`, `base@<rate>~<shapeKey>`, `spec:base[~…]`
function isDerived(x, base) {
  return x === base || x.startsWith(base + '~') || x.startsWith(base + '@') || x === 'spec:' + base || x.startsWith('spec:' + base + '~');
}

/**
 * The render-farm patch of a model preset (§10.1): patchFor(model, vals, null, {sr: 48000, bpm, drift: 0, hiss: 0}) —
 * classic models with their controls' defaults under the preset values, Serum presets (the migrated Phase-1 factory
 * presets, s1 = 1) with their own state; every farm patch uses the default rack (`fx` null → defaultFx(), §10.1: a
 * preset's own FX state is not rendered) → {patch, wtIds} (wtIds = the wavetable-path ids the patch needs: tables,
 * noises, sub tables, sent as `wts`).
 */
export function farmPatch(model, preset, bpm) {
  const m = MODELS.find(x => x.id === model), p = m && m.presets.find(x => x.name === preset);
  if (!m || !p) throw new Error('render farm: unknown preset ' + model + ' / ' + preset);
  let vals;
  if (m.custom) vals = JSON.parse(JSON.stringify(p.v));
  else { vals = {}; for (const c of m.controls) vals[c.id] = c.def; Object.assign(vals, JSON.parse(JSON.stringify(p.v))); }
  const patch = patchFor(m, vals, null, { sr: 48000, bpm: bpm > 0 ? bpm : 120, drift: 0, hiss: 0 });
  return { patch, wtIds: (patch.needs || []).filter(id => idKind(id) === 'wt') };
}

/**
 * post() for createAssetManager from main.js's node map (track id → {node}), with the Phase-1 port choice: the track's
 * node, else the given node, else any node of the context.
 */
export function portPoster(nodes) {
  return (msg, transfer, trackId, node) => {
    const N = (trackId != null && nodes.get(trackId)) || null;
    let n = N ? N.node : node || null;
    if (!n) for (const x of nodes.values()) { n = x.node; break; }
    if (!n) return false;
    n.port.postMessage(msg, transfer || []);
    return true;
  };
}

// default browser adapters (never called at module load)
async function decodeDefault(bytes) {
  const C = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (typeof C !== 'function') throw new Error('no audio decoder');
  const ac = new C(2, 1, 48000), copy = bytes.slice(0);
  const buf = await new Promise((res, rej) => { const p = ac.decodeAudioData(copy, res, rej); if (p && typeof p.then === 'function') p.then(res, rej); });
  const ch = Math.min(2, buf.numberOfChannels);
  return { rate: buf.sampleRate, ch, L: buf.getChannelData(0).slice(), R: ch === 2 ? buf.getChannelData(1).slice() : null };
}
async function inflateDefault(bytes) {
  const DS = globalThis.DecompressionStream;
  if (typeof DS !== 'function') throw new Error('no DecompressionStream');
  const s = new Blob([bytes]).stream().pipeThrough(new DS('deflate-raw'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
const hasInflate = () => typeof globalThis.DecompressionStream === 'function';
function persistDefault() {
  const s = globalThis.navigator && globalThis.navigator.storage;
  return s && typeof s.persist === 'function' ? s.persist() : Promise.resolve(false);
}
async function fileBytes(f) {
  if (!f) return null;
  if (typeof f.arrayBuffer === 'function') return new Uint8Array(await f.arrayBuffer());
  const d = f.data != null ? f.data : f.bytes;
  if (d instanceof ArrayBuffer) return new Uint8Array(d);
  if (ArrayBuffer.isView(d)) return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
  return null;
}
const fileName = f => String((f && (f.webkitRelativePath || f.name)) || '');
const baseName = p => String(p).replace(/^.*[\\/]/, '');
const stripExt = p => baseName(p).replace(/\.[A-Za-z0-9]{1,5}$/, '');
const recBytes = r => (r ? bufBytes(entryBufs({ L: r.L, R: r.R, odf: r.odf })) : 0);
const errText = err => String((err && err.message) || err);

export function createAssetManager(o = {}) {
  const ctxOf = typeof o.ctxOf === 'function' ? o.ctxOf : () => null;
  const post = typeof o.post === 'function' ? o.post : () => false;
  const tracks = typeof o.tracks === 'function' ? o.tracks : () => [];
  const refresh = typeof o.refresh === 'function' ? o.refresh : () => {};
  const notify = typeof o.notify === 'function' ? o.notify : () => {};
  const progress = typeof o.progress === 'function' ? o.progress : () => {};
  const now = typeof o.now === 'function' ? o.now : () => performance.now();
  const timers = o.timers || {};
  const setT = typeof timers.set === 'function' ? timers.set : (f, ms) => setTimeout(f, ms);
  const clearT = typeof timers.clear === 'function' ? timers.clear : t => clearTimeout(t);
  const dev = o.touch ? 'touch' : 'desktop';
  const keepBytes = o.keepBytes > 0 ? +o.keepBytes : KEEP_BYTES_V2[dev];
  const budget = o.budget > 0 ? +o.budget : WORKLET_BUDGET[dev];
  const lruMax = o.lruBytes > 0 ? +o.lruBytes : LRU_BYTES[dev];
  const cacheMax = o.cacheBytes > 0 ? +o.cacheBytes : CACHE_BYTES[dev];
  const mkWorker = typeof o.worker === 'function' ? o.worker
    : kind => (typeof Worker === 'function' ? new Worker(WORKERS[kind].url, { type: WORKERS[kind].type }) : null);
  const stores = o.stores || {};
  const loadWt = typeof o.wt === 'function' ? o.wt : () => import('./wt.js?v=' + VERSION);
  const loadSmp = typeof o.smp === 'function' ? o.smp : () => import('./smp.js?v=' + VERSION);
  const loadGen = typeof o.gen === 'function' ? o.gen : () => import('./smpgen.js?v=' + VERSION);
  const decode = typeof o.decode === 'function' ? o.decode : decodeDefault;
  const inflate = typeof o.inflate === 'function' ? o.inflate : hasInflate() ? inflateDefault : null;
  const persist = typeof o.persist === 'function' ? o.persist : persistDefault;

  // ---- lazily loaded modules and stores (Phase 1: main.js wtMod / wtStore)
  let wtLoad = null, wtStoreLoad = null, smpStoreLoad = null, smpLoad = null, WT = null, SMP = null, GEN = null;
  function wtMod() {
    if (!wtLoad) {
      wtLoad = Promise.resolve().then(loadWt).then(m => { WT = m; return m; });
      wtLoad.catch(() => { wtLoad = null; });
    }
    return wtLoad;
  }
  // smp.js + smpgen.js (catalogues, pure helpers); the menus refresh once they are here, and the stored user rows
  // (samples, multisamples, IRs: listSmp) are read then, so host.smp.list shows what earlier sessions stored
  function smpMods() {
    if (!smpLoad) {
      smpLoad = Promise.all([Promise.resolve().then(loadSmp), Promise.resolve().then(loadGen), wtMod()]).then(([s, g]) => {
        const first = !SMP;
        SMP = s; GEN = g;
        if (first) {
          try { refresh(); } catch (err) { console.warn(err); }
          M.listSmp().catch(() => {});
        }
        return { smp: s, gen: g };
      });
      smpLoad.catch(() => { smpLoad = null; });
    }
    return smpLoad;
  }
  // user wavetables and noises (IndexedDB; an in-memory store when it is unavailable, e.g. private windows)
  function wtStore() {
    if (!wtStoreLoad) {
      wtStoreLoad = typeof stores.wt === 'function' ? Promise.resolve().then(stores.wt)
        : import('./wtstore.js?v=' + VERSION).then(m => m.openStore().catch(() => m.memoryStore()));
    }
    return wtStoreLoad;
  }
  // user samples, multisamples and IRs + the generated-content cache (§9.2)
  function smpStore() {
    if (!smpStoreLoad) {
      smpStoreLoad = typeof stores.smp === 'function' ? Promise.resolve().then(stores.smp)
        : import('./smpstore.js?v=' + VERSION).then(m => m.openStore().catch(() => m.memoryStore()));
    }
    return smpStoreLoad;
  }

  // ---- smpwork requests (§9.4.1): the module worker when it works, else the same handler on the main thread.
  // work(op, req, transfer) → Promise<reply> ({q, ok, …}; never rejects). Buffers listed in `transfer` move to the
  // worker; if the worker dies, the requests it held answer {ok: false} (their buffers are gone) and later requests run
  // here.
  const sw = { w: null, bad: false, q: new Map(), n: 0, mod: null };
  const workHere = req => {
    if (!sw.mod) { sw.mod = import('./smpwork.js?v=' + VERSION); sw.mod.catch(() => { sw.mod = null; }); }
    return sw.mod.then(m => m.handle(req)).then(r => r.msg, err => ({ q: req.q, ok: false, err: errText(err), code: '' }));
  };
  const smpFail = () => {
    sw.bad = true;
    if (sw.w) { try { sw.w.terminate(); } catch { /* gone */ } }
    sw.w = null;
    for (const [q, res] of sw.q) res({ q, ok: false, err: 'smpwork failed', code: 'EWORKER' });
    sw.q.clear();
  };
  function work(op, req, transfer) {
    const msg = Object.assign({}, req, { op, q: ++sw.n });
    if (!sw.bad) {
      try {
        if (!sw.w) {
          const w = mkWorker('smp');
          if (w) {
            w.onmessage = e => { const d = e.data || {}, res = sw.q.get(d.q); if (!res) return; sw.q.delete(d.q); res(d); };
            w.onerror = e => { if (e && e.preventDefault) e.preventDefault(); smpFail(); };
            sw.w = w;
          }
        }
        if (sw.w) return new Promise(res => { sw.q.set(msg.q, res); sw.w.postMessage(msg, transfer || []); });
      } catch (err) { smpFail(); }
    }
    return workHere(msg);
  }
  // a smpwork request that throws on failure → its reply
  const must = (op, req, transfer) => work(op, req, transfer).then(r => {
    if (!r || !r.ok) { const e = new Error((r && r.err) || op + ' failed'); e.code = (r && r.code) || ''; throw e; }
    return r;
  });
  // ---- render-farm requests (§10.1): one classic worker, created on first use; no main-thread fallback (a render
  // would block the page). render(req) → Promise<{q, ok, L, R} | {q, ok: false, err}>.
  const rf = { w: null, q: new Map(), n: 0 };
  function render(req) {
    const msg = Object.assign({}, req, { q: ++rf.n });
    try {
      if (!rf.w) {
        const w = mkWorker('render');
        if (!w) return Promise.resolve({ q: msg.q, ok: false, err: 'workers unavailable' });
        w.onmessage = e => { const d = e.data || {}, res = rf.q.get(d.q); if (!res) return; rf.q.delete(d.q); res(d); };
        w.onerror = e => {
          if (e && e.preventDefault) e.preventDefault();
          for (const [q, res] of rf.q) res({ q, ok: false, err: 'render farm failed' });
          rf.q.clear();
          try { w.terminate(); } catch { /* gone */ }
          if (rf.w === w) rf.w = null;
        };
        rf.w = w;
      }
      return new Promise(res => { rf.q.set(msg.q, res); rf.w.postMessage(msg); });
    } catch (err) {
      return Promise.resolve({ q: msg.q, ok: false, err: errText(err) });
    }
  }

  // ---- variant resolution: `~opsKey` → ops, `~shapeKey` → Convolve shape (from the states that use them)
  const opsOf = new Map(), shapeOf = new Map();
  function learnState(s) {
    if (!s || !Array.isArray(s.osc)) return;
    for (const O of s.osc) {
      if (!O || typeof O.smp !== 'string' || !O.smp) continue;
      const ops = O.smpo && O.smpo.ops, k = opsKeyOf(ops);
      if (!k) continue;
      const base = /^(factory|user):/.test(O.smp) ? 'wtsmp:' + O.smp : O.smp;
      opsOf.set(base + '~' + k, { trim: Array.isArray(ops.trim) ? ops.trim.slice(0, 2) : null, fade: finN(ops.fade) ? ops.fade : 0 });
    }
  }
  function learnFx(fx) {
    for (const I of convInstances(fx)) {
      const ir = I.sub && typeof I.sub.ir === 'string' ? I.sub.ir : '';
      if (ir) shapeOf.set(ir + '~' + convKeyOf(I.p), convShapeOf(I.p));
    }
  }
  function learn(at) {
    if (!at) return;
    if (at.s) learnState(at.s);
    if (at.fx) learnFx(at.fx);
  }
  const learnTracks = () => { for (const t of tracks()) { if (t && t.vals && t.vals.s) learnState(t.vals.s); if (t && t.fx) learnFx(t.fx); } };
  function opsFor(base, key) {
    if (!key) return null;
    const k = base + '~' + key;
    if (!opsOf.has(k)) learnTracks();
    const x = opsOf.get(k);
    if (!x) throw new Error('unknown sample ops ' + k + ' (the state using it must reach ensure(needs, {s}) / entries(ids, rate, {s}))');
    return x;
  }
  function shapeFor(ir, key) {
    const k = ir + '~' + key;
    if (!shapeOf.has(k)) learnTracks();
    if (shapeOf.has(k)) return shapeOf.get(k);
    if (key === convKeyOf(null)) return convShapeOf(null);
    throw new Error('unknown Convolve shape ' + k + ' (the FX state using it must reach ensure(needs, {fx}) / entries(ids, rate, {fx}))');
  }

  // ---- asset records (§9.2, §9.7): user records from smpstore, factory ones generated on demand and cached
  const recs = new Map(); // id → {rec, bytes, t}  (main-thread LRU)
  const genP = new Map(); // factory generation in flight: id → Promise<record>
  const gens = new Set(); // cancellation tokens {id, cancelled} of the generations in flight
  // factory ids whose generation was cancelled or failed this session: not generated again for live use (ensure, panel
  // reads) until host.smp.retry(id), a selection that adds the id to a track's needs, or the id leaving every track's
  // needs; a bounce (entries) still generates them. id → 'cancel' | 'fail'
  const held = new Map();
  const facCh = new Map(); // factory sample id → channels of its generated record (host.smp.list)
  const touched = new Map(); // factory id → time its cache entry was last marked used
  const missing = new Set();
  let lruTot = 0, cacheTrimT = 0;
  const lruGet = id => { const x = recs.get(id); if (!x) return null; x.t = now(); recs.delete(id); recs.set(id, x); return x.rec; };
  function lruPut(id, rec) {
    const old = recs.get(id);
    if (old) { lruTot -= old.bytes; recs.delete(id); }
    const bytes = recBytes(rec);
    recs.set(id, { rec, bytes, t: now() });
    lruTot += bytes;
    if (lruTot <= lruMax) return;
    const used = M.used(), deps = new Set();
    for (const u of used) for (const d of M.deps.get(u) || []) deps.add(d);
    for (const pass of [0, 1]) { // unreferenced first, then oldest
      for (const [k, x] of recs) {
        if (lruTot <= lruMax) return;
        if (k === id || (pass === 0 && (used.has(k) || deps.has(k)))) continue;
        recs.delete(k); lruTot -= x.bytes;
      }
    }
  }
  const lruDrop = id => { const x = recs.get(id); if (x) { recs.delete(id); lruTot -= x.bytes; } };
  async function cacheGet(key) { try { return await (await smpStore()).cacheGet(key); } catch (err) { return null; } }
  async function cachePut(key, rec) {
    try {
      const st = await smpStore();
      await st.cachePut(key, rec);
      if (!cacheTrimT) cacheTrimT = setT(() => { cacheTrimT = 0; st.cacheTrim(cacheMax, keepKeys()).catch(() => {}); }, 5000);
    } catch (err) { console.warn('asset cache: ' + key + ' not stored', err); }
  }
  const genKey = id => 'gen:' + id + '@' + GEN.GEN_VER;
  // spectral cache key (§9.2 `spec:<play>[~r]@SPEC_VER`; IMPL: factory content adds `.GEN_VER`, it changes with it)
  const specKey = (play, rev) => 'spec:' + play + (rev ? '~r' : '') + '@' + SMP.SPEC_VER + (/^(fsmp|fmsmp):/.test(splitOps(play).base) ? '.' + GEN.GEN_VER : '');
  // cache entries the project uses now (never evicted by cacheTrim): generated factory records and spectral analyses
  function keepKeys() {
    const out = new Set();
    if (!GEN || !SMP) return out;
    for (const id of M.used()) {
      if (GEN.parseZoneId(id) || GEN.factoryKind(id)) out.add(genKey(id));
      const f = factoryOf(id);
      if (f) out.add(genKey(f));
      if (idKind(id) === 'spec') { const p = parseSpec(id); out.add(specKey(p.play, p.rev)); }
    }
    return out;
  }
  /**
   * The record of an asset id (user: smpstore; factory: cache or generated; wavetables as samples) or null. opts.force:
   * generate a factory id even when it is held (cancelled / failed this session) — bounces.
   */
  async function record(id, opts) {
    const hit = lruGet(id);
    if (hit) { if (GEN && (GEN.parseZoneId(id) || GEN.factoryKind(id))) touch(id); return hit; }
    await smpMods();
    let rec = null;
    if (/^(smp|msmp|ir):/.test(id)) {
      rec = await (await smpStore()).get(id).catch(() => null);
      if (rec) missing.delete(id); else missing.add(id);
    } else if (id.startsWith('wtsmp:')) {
      const t = await tableOf(id.slice(6));
      rec = t ? SMP.wtAsSample(t.frames) : null;
    } else if (GEN.parseZoneId(id)) {
      rec = await cacheGet(genKey(id));
      if (!rec) { await generateFactory(GEN.parseZoneId(id).multi, opts); rec = lruGet(id) || await cacheGet(genKey(id)); }
    } else if (GEN.factoryKind(id)) {
      rec = await cacheGet(genKey(id));
      if (!rec) rec = await generateFactory(id, opts);
    }
    if (rec) {
      lruPut(id, rec);
      if (rec.kind === 'smp' && /^fsmp:/.test(id)) facCh.set(id, rec.ch === 2 && rec.R != null ? 2 : 1);
    }
    return rec;
  }
  // a factory record served from the main-thread LRU: its IndexedDB cache entry is marked used (at most once a minute),
  // so cacheTrim's LRU order sees that it is in use
  function touch(id) {
    const t = now(), t0 = touched.get(id);
    if (t0 != null && t - t0 < 60000) return;
    touched.set(id, t);
    smpStore().then(st => (typeof st.cacheTouch === 'function' ? st.cacheTouch(genKey(id)) : null)).catch(() => {});
  }
  async function tableOf(id) { // a factory or user wavetable (Table with frames)
    if (isUserId(id)) { const x = await M.source(id); return x && x.frames ? x : null; }
    const W = await wtMod();
    return W.factoryTable(id);
  }

  // ---- factory generation (§9.7, §10, sign-off item 9): procedural assets in smpwork, render-farm assets in
  // smprender; one generation per id at a time, progress notices, cancellable (host.smp.cancel)
  function generateFactory(id, opts) {
    if (genP.has(id)) return genP.get(id);
    if (held.has(id) && !(opts && opts.force)) { // cancelled / failed this session: not restarted by live use
      const why = held.get(id), e = new Error(why === 'cancel' ? 'cancelled' : 'generation failed earlier');
      e.code = why === 'cancel' ? 'ECANCEL' : 'EHELD'; e.reported = true;
      return Promise.reject(e);
    }
    const tok = { id, cancelled: false };
    gens.add(tok);
    const p = (async () => {
      await smpMods();
      const kind = GEN.factoryKind(id), x = GEN.byId(id);
      if (!kind) return null;
      const check = () => { if (tok.cancelled) { const e = new Error('cancelled'); e.code = 'ECANCEL'; throw e; } };
      if (kind === 'ir' || (kind === 'sample' && x.src === 'proc')) {
        progress({ id, name: x.name, done: 0, total: 1 });
        const r = await must('gen', { id });
        check();
        if (!r.rec) return null;
        await cachePut(genKey(id), r.rec);
        progress({ id, name: x.name, done: 1, total: 1 });
        return r.rec;
      }
      const plan = GEN.renderPlan(id);
      if (!plan) return null;
      const total = plan.notes.length, renders = [];
      progress({ id, name: x.name, done: 0, total });
      const patches = new Map();
      for (let i = 0; i < total; i++) {
        check();
        const nt = plan.notes[i], pk = nt.model + '/' + nt.preset;
        if (!patches.has(pk)) patches.set(pk, farmPatch(nt.model, nt.preset, plan.bpm || 120));
        const { patch, wtIds } = patches.get(pk);
        const wts = (await Promise.all(wtIds.map(w => M.entry(w).catch(() => null)))).filter(Boolean);
        const r = await render({ id: nt.rid, patch, wts, smps: null, events: nt.events, frames: nt.frames, os: 2 });
        check();
        if (!r || !r.ok) { const e = new Error((r && r.err) || 'render failed'); e.code = 'ERENDER'; throw e; }
        const item = { L: r.L, R: r.R };
        if (plan.kind === 'multi' && plan.loop === 'sustain') {
          const g = Math.round(plan.gate * 48000), lp = await work('loop', { L: r.L, R: r.R, rate: 48000, from: Math.round(0.45 * g), to: Math.min(r.L.length, Math.round(0.95 * g)), f0: 0 });
          if (lp && lp.ok) item.loop = { ls: lp.ls, le: lp.le };
        }
        renders.push(item);
        progress({ id, name: x.name, done: i + 1, total });
      }
      check();
      // (M4) the post-processing of the renders (trim, gain, loop bake, fades, peaks: 0.1–0.2 s for a large instrument on
      // an M-class laptop, one block) runs in smpwork; the renders' buffers move there
      const tr = new Set();
      for (const it of renders) { if (it.L && it.L.buffer) tr.add(it.L.buffer); if (it.R && it.R.buffer) tr.add(it.R.buffer); }
      const fr = await must('farm', { plan, renders }, [...tr]);
      check();
      if (plan.kind === 'multi') {
        const res = fitBudget(fr.res);
        for (const z of res.samples) { await cachePut(genKey(z.id), z.rec); lruPut(z.id, z.rec); }
        await cachePut(genKey(id), res.rec);
        return res.rec;
      }
      const rec = fr.rec;
      await cachePut(genKey(id), rec);
      return rec;
    })();
    genP.set(id, p);
    const done = () => { genP.delete(id); gens.delete(tok); if (!genP.size) progress(null); };
    p.then(rec => { done(); held.delete(id); return rec; }, err => {
      done();
      held.set(id, err && err.code === 'ECANCEL' ? 'cancel' : 'fail');
      if (err && err.code !== 'ECANCEL') {
        try { err.reported = true; } catch { /* frozen */ }
        console.warn('factory asset ' + id + ' not generated', err);
        notify(/workers unavailable/.test(errText(err)) ? TEXT.noWorkers : TEXT.genFailed + ': ' + ((GEN && GEN.byId(id) && GEN.byId(id).name) || id));
      }
    });
    return p;
  }
  // §10.1 budget guard: an instrument over 16 MB stores its stereo zones as mono (mid) until it fits
  function fitBudget(res) {
    let bytes = GEN.multiBytes(res);
    for (const z of res.samples) {
      if (bytes <= GEN.MULTI_BUDGET.instrument) break;
      const r = z.rec;
      if (r.ch !== 2) continue;
      const L = r.L, R = r.R, m = new Float32Array(L.length);
      for (let i = 0; i < m.length; i++) m[i] = 0.5 * (L[i] + R[i]);
      z.rec = Object.assign({}, r, { ch: 1, L: m, R: null });
      bytes -= 4 * L.length;
    }
    return res;
  }
  function cancelGen() {
    for (const t of gens) { t.cancelled = true; held.set(t.id, 'cancel'); }
    progress(null);
  }
  // host.smp.retry: a held factory id (cancelled / failed) is generated again for the tracks that need it
  function retry(id) {
    const f = factoryOf(id) || id;
    held.delete(f);
    for (const [tid, list] of M.needs) if (list.some(x => factoryOf(x) === f)) M.ensure(list, { trackId: tid });
  }

  // ---- §9 entries: building (smpwork) for one needed id → [entries] (multisamples: zone samples, then the zones)
  const deps = new Map();     // multi id → its zone-sample ids (they live and die with it)
  const capOf = new WeakMap(); // playback entry → the level cap it was built with (8 = full; zone entries fewer, §9.4.3)
  function recForWork(rec) { // a copy whose buffers may be transferred (the LRU keeps its own)
    const c = Object.assign({}, rec);
    for (const k of ['L', 'R', 'odf']) {
      const v = rec[k];
      if (v == null) continue;
      c[k] = v instanceof ArrayBuffer ? v.slice(0) : ArrayBuffer.isView(v) ? v.slice() : v;
    }
    return c;
  }
  const recBufs = r => [...entryBufs({ L: r.L, R: r.R, odf: r.odf })];
  const capped = new Set();   // samples whose 20 s spectral cap was announced (once per session, §9.4.6)
  function capNotice(base) { if (!capped.has(base)) { capped.add(base); notify(TEXT.specCap); } }
  // opts: skip (ids not to build: zone samples already posted or built at full level elsewhere), convMax (s; the Q3 cap
  // the IR is shaped for), rate (Hz: build IRs for this rate under their ids, entries()), keep() (whether a spectral
  // analysis is still wanted when it is done: only then is it cached), force (generate held factory ids: bounces)
  async function assetEntries(id, opts) {
    await smpMods();
    const kind = idKind(id), o2 = opts || {}, skip = o2.skip, rq = o2.force ? { force: true } : null;
    if (kind === 'smp') {
      const { base, key } = splitOps(id), ops = opsFor(base, key), rec = await record(base, rq);
      if (!rec) throw new Error('missing ' + base);
      const r = recForWork(rec), e = (await must('entry', { id, rec: r, ops, maxLevels: SMP.LIMITS.levels }, recBufs(r))).entry;
      capOf.set(e, SMP.LIMITS.levels);
      return [e];
    }
    if (kind === 'wtsmp') {
      const { base, key } = splitOps(id), ops = opsFor(base, key), t = await tableOf(base.slice(6));
      if (!t) throw new Error('missing table ' + base);
      const frames = SMP.wtAsSample(t.frames).L;
      const es = (await must('wtsmp', { id: base, playId: id, frames, ops, want: ['play'] }, [frames.buffer])).entries;
      for (const e of es) capOf.set(e, SMP.LIMITS.levels);
      return es;
    }
    if (kind === 'spec') {
      const { play, rev } = parseSpec(id), { base, key } = splitOps(play), ops = Object.assign({ trim: null, fade: 0 }, opsFor(base, key) || {}, { rev: rev ? 1 : 0 });
      const ck = specKey(play, rev), cacheable = !base.startsWith('wtsmp:user:'); // user tables are editable
      const hit = cacheable ? await cacheGet(ck) : null;
      if (hit && hit.mag && Number.isFinite(hit.root)) {
        if (hit.capped) capNotice(base);
        return [Object.assign({}, hit, { id, v: 1, kind: 'spec', ch: 1 })];
      }
      let e;
      if (base.startsWith('wtsmp:')) {
        const t = await tableOf(base.slice(6));
        if (!t) throw new Error('missing table ' + base);
        const frames = SMP.wtAsSample(t.frames).L;
        e = (await must('wtsmp', { id: base, playId: play, frames, ops, want: ['spec'] }, [frames.buffer])).entries[0];
      } else {
        const rec = await record(base, rq);
        if (!rec) throw new Error('missing ' + base);
        const r = recForWork(rec);
        e = (await must('spec', { id, rec: r, ops }, recBufs(r))).entry;
      }
      if (e.id !== id) e.id = id;
      if (e.capped) capNotice(base);
      const keep = { rate: e.rate, len: e.len, N: e.N, hop: e.hop, frames: e.frames, mag: e.mag, ph: e.ph, trans: e.trans, peak: e.peak, bytes: e.bytes, root: e.root, capped: e.capped ? 1 : 0 };
      // cached only while it is still wanted (an intermediate variant of a trim / fade drag is not; §9.7 / §14.2 budget)
      if (cacheable && (typeof o2.keep !== 'function' || o2.keep())) await cachePut(ck, keep); // deep-copied by the store before the entry's buffers are transferred
      return [e];
    }
    if (kind === 'multi') {
      const rec = await record(id, rq);
      if (!rec || !Array.isArray(rec.zones)) throw new Error('missing ' + id);
      const zs = [...new Set(rec.zones.map(z => z.smp).filter(Boolean))], rates = {}, out = [];
      deps.set(id, zs);
      for (const z of zs) {
        const maxUp = Math.max(0, ...rec.zones.filter(q => q.smp === z).map(q => q.hi - q.root)) + ZONE_HEADROOM[dev];
        const zr = await record(z, rq);
        if (!zr) { console.warn('multisample ' + id + ': zone sample ' + z + ' missing'); continue; }
        rates[z] = zr.rate;
        if (skip && skip.has(z)) continue;
        // §9.4.3: zone entries get levels only up to their largest upward transposition + ZONE_HEADROOM (this entry
        // only: a sample played directly gets a full entry of its own)
        const pr = Math.min(48000, zr.rate > 0 ? zr.rate : 48000), cap = Math.max(1, Math.min(8, Math.ceil(Math.log2(Math.pow(2, maxUp / 12) * pr / 44100)) + 1));
        const r = recForWork(zr), e = (await must('entry', { id: z, rec: r, ops: null, maxLevels: cap }, recBufs(r))).entry;
        capOf.set(e, cap);
        out.push(e);
      }
      out.push((await must('multi', { id, rec: { kind: 'multi', zones: rec.zones }, rates })).entry);
      return out;
    }
    if (kind === 'ir') {
      const p = parseIrId(id);
      if (!p) throw new Error('bad IR id ' + id);
      const shape = shapeFor(p.ir, p.key), rec = await record(p.ir, rq);
      if (!rec) throw new Error('missing ' + p.ir);
      const r = recForWork(rec);
      const cm = o2.convMax > 0 ? o2.convMax : M.convMax, rate = o2.rate > 0 ? +o2.rate : p.rate;
      return [(await must('irshape', { id, rec: r, rate, shape, convMax: cm }, recBufs(r))).entry];
    }
    throw new Error('not an asset id ' + id);
  }

  // Wavetables and assets in the worklet (§7.5, §9.5, §11.8): each id is posted once per AudioContext (entries built
  // off the main thread when module workers work, else here), re-posted after edits ({t:'wtf'} per frame or a whole
  // entry), and freed ({t:'wtdel'} / {t:'smpdel'}) after 10 s without any track needing it — at once, oldest first,
  // while the entries nobody needs hold more than keepBytes.
  const M = {
    ctx: null, sent: new Set(), pend: new Map(), unref: new Map(), needs: new Map(), user: new Map(), rows: [], smpRows: [], gcT: 0,
    bytes: new Map(), worker: null, wbad: false, wq: new Map(), wn: 0, saveT: new Map(), deps, convMax: 10, stale: new Set(),
    refused: new Map(), // id → bytes of an entry the §14.2 budget refused (not rebuilt while it would not fit)
    cap: new Map(),     // posted playback id → the level cap it was built with (a zone entry is rebuilt in full when played directly)
    flight: new Map(),  // variant base → the id being built (one build in flight per base, §8.4)
    queue: new Map(),   // variant base → [{id, trackId, node, res}] waiting for that build (newer targets replace older)
    get WT() { return WT; }, get SMP() { return SMP; }, get GEN() { return GEN; },
    wtMod, smpMods, wtStore, smpStore, work, render, record, cancelGen, retry, learn,
    ensure(needs, at) {
      const trackId = at && at.trackId != null ? at.trackId : null, node = (at && at.node) || null;
      const list = Array.isArray(needs) ? needs : [];
      learn(at);
      const prev = trackId != null ? this.needs.get(trackId) || [] : [];
      if (trackId != null) this.needs.set(trackId, list);
      // held factory ids (cancelled / failed): a selection that adds one to this track retries it; one no track needs
      // any more is forgotten
      if (held.size) {
        for (const id of list) if (!prev.includes(id)) { const f = factoryOf(id); if (f && held.has(f) && !prev.some(x => factoryOf(x) === f)) held.delete(f); }
        const live = new Set();
        for (const l of this.needs.values()) for (const id of l) { const f = factoryOf(id); if (f) live.add(f); }
        for (const f of [...held.keys()]) if (!live.has(f)) held.delete(f);
      }
      const ctx = ctxOf();
      if (!ctx) return Promise.resolve();
      if (this.ctx !== ctx) {
        this.ctx = ctx; this.sent.clear(); this.pend.clear(); this.unref.clear(); this.bytes.clear(); this.refused.clear(); this.cap.clear(); this.stale.clear();
        for (const q of this.queue.values()) for (const x of q) x.res();
        this.queue.clear();
        for (const [f, why] of [...held]) if (why === 'fail') held.delete(f);
      }
      // §14.3 Q3: a new Convolve length cap rebuilds the shaped IRs at that length (same ids: freed, then posted again;
      // builds under way at the old cap are rebuilt once they are posted, pushAsset)
      const cm = at && at.convMax > 0 ? Math.min(10, +at.convMax) : 0, again = [];
      if (cm && cm !== this.convMax) {
        this.convMax = cm;
        const used = this.used();
        for (const x of [...this.sent]) if (idKind(x) === 'ir') { this.free(x); if (used.has(x) && !list.includes(x)) again.push(x); }
      }
      // superseded variants (`~opsKey`, `~shapeKey`): freed once a replacement of the same base has been posted and the
      // patch that needs it has followed (dropSuperseded, a task after this call resolves — post the patch then)
      const bases = new Set(list.map(variantBase).filter(Boolean));
      for (const id of prev) if (!list.includes(id) && bases.has(variantBase(id))) this.stale.add(id);
      for (const id of list) this.stale.delete(id);
      const waits = [];
      for (const id of list.concat(again)) {
        if (this.sent.has(id) && !(idKind(id) === 'smp' && (this.cap.get(id) || 8) < 8 && list.includes(id))) continue;
        if (this.pend.has(id)) { waits.push(this.pend.get(id)); continue; }
        if (this.refused.has(id) && this.meter().bytes + this.refused.get(id) > budget) continue; // still does not fit
        const f = factoryOf(id);
        if (f && held.has(f)) continue; // cancelled / failed: not restarted by a patch post
        const p = this.start(id, list.includes(id) ? trackId : null, list.includes(id) ? node : null);
        this.pend.set(id, p);
        waits.push(p);
      }
      this.gcSoon();
      const all = Promise.all(waits).then(() => {}, () => {});
      if (this.stale.size) all.then(() => setT(() => this.dropSuperseded(), 0));
      return all;
    },
    // whether a patch with these needs can be posted now without a gap: false while one of its ids is still being built
    // and replaces a posted variant of the same asset (the old one keeps playing until the new one is posted)
    ready(needs) {
      const list = Array.isArray(needs) ? needs : [], posted = new Set();
      for (const x of this.sent) { const b = variantBase(x); if (b) posted.add(b); }
      return !list.some(id => !this.sent.has(id) && this.pend.has(id) && posted.has(variantBase(id)));
    },
    // starts a build, or queues it behind the build of the same variant base in flight; a queued target no track needs
    // any more (a newer one replaced it) is dropped without being built
    start(id, trackId, node) {
      const base = variantBase(id);
      if (base && this.flight.has(base) && this.flight.get(base) !== id) {
        const used = this.used(), q = this.queue.get(base) || [], keep = [];
        for (const x of q) { if (used.has(x.id)) keep.push(x); else { this.pend.delete(x.id); x.res(); } }
        let res;
        const p = new Promise(r => { res = r; });
        keep.push({ id, trackId, node, res });
        this.queue.set(base, keep);
        return p;
      }
      return this.run(id, trackId, node);
    },
    run(id, trackId, node) {
      const base = variantBase(id);
      if (base) this.flight.set(base, id);
      return this.push(id, trackId, node).then(() => {
        if (!base) return;
        if (this.flight.get(base) === id) this.flight.delete(base);
        const q = this.queue.get(base);
        if (!q || this.flight.has(base)) return;
        const used = this.used();
        while (q.length) {
          const x = q.shift();
          if (!used.has(x.id)) { if (this.pend.get(x.id)) this.pend.delete(x.id); x.res(); continue; }
          if (!q.length) this.queue.delete(base);
          this.run(x.id, x.trackId, x.node).then(x.res, x.res);
          return;
        }
        this.queue.delete(base);
      });
    },
    // frees the superseded variants whose replacement has been posted (§9.5); one without a posted replacement keeps
    // playing (it goes with the 10 s GC); a superseded spectral variant's cache entry goes too (§14.2 cache budget)
    dropSuperseded() {
      const ctx = ctxOf();
      if (!ctx || this.ctx !== ctx) return;
      const used = this.used(), live = new Set();
      for (const x of used) if (this.sent.has(x)) { const b = variantBase(x); if (b) live.add(b); }
      for (const id of [...this.stale]) {
        if (used.has(id)) { this.stale.delete(id); continue; }
        if (this.pend.has(id)) continue; // being built: pushAsset discards it
        if (this.sent.has(id)) { if (!live.has(variantBase(id))) continue; this.free(id); } // (else already freed: trim, GC)
        this.stale.delete(id);
        if (idKind(id) === 'spec' && SMP) {
          const p = parseSpec(id);
          if (splitOps(p.play).key) smpStore().then(st => (typeof st.cacheDrop === 'function' ? st.cacheDrop(specKey(p.play, p.rev)) : 0)).catch(() => {});
        }
      }
    },
    push(id, trackId, node) { // build and post the whole entry (or entries) to the current context
      if (idKind(id) !== 'wt') return this.pushAsset(id, trackId, node);
      const c = ctxOf();
      return this.entry(id).then(e => {
        if (this.pend.get(id)) this.pend.delete(id);
        const ctx = ctxOf();
        if (!e || !ctx || c !== ctx || this.ctx !== ctx) return;
        const bufs = levelBufs(e), bytes = bufBytes(bufs); // (transferred: counted before posting)
        if (!post(Object.assign({ t: 'wt' }, e), bufs, trackId, node)) return;
        this.bytes.set(id, bytes);
        this.sent.add(id);
        this.trim(id);
      }, err => { this.pend.delete(id); console.warn('wavetable ' + id + ' could not be built', err); });
    },
    // zone samples a multisample build skips: posted ones, and those a track plays directly (built in full on their own)
    zoneSkip() {
      const s = new Set(this.sent);
      for (const l of this.needs.values()) for (const x of l) if (idKind(x) === 'smp') s.add(x);
      return s;
    },
    pushAsset(id, trackId, node) {
      const c = ctxOf(), cm = this.convMax;
      return assetEntries(id, { skip: this.zoneSkip(), convMax: cm, keep: () => this.used().has(id) && !this.stale.has(id) }).then(list => {
        if (this.pend.get(id)) this.pend.delete(id);
        const ctx = ctxOf();
        if (!ctx || c !== ctx || this.ctx !== ctx) return;
        if (this.stale.has(id) && !this.used().has(id)) { this.stale.delete(id); return; } // superseded while being built
        const fresh = list.filter(e => e.id === id || !this.sent.has(e.id));
        let add = 0;
        for (const e of fresh) add += bufBytes(entryBufs(e)) - (this.sent.has(e.id) ? this.bytes.get(e.id) || 0 : 0);
        // §14.2: the project's referenced entries stay within the device's worklet budget — a selection beyond it is
        // refused (notice once per id; the oscillator / Convolve stays silent / bypassed; not rebuilt until the meter
        // has room for it); idle entries make room first
        if (add > 0 && this.meter().bytes + add > budget) {
          if (!this.refused.has(id)) notify(TEXT.memory);
          this.refused.set(id, add);
          return;
        }
        this.refused.delete(id);
        this.trim(id, budget - this.meter().bytes - add);
        for (const e of fresh) {
          const bufs = [...entryBufs(e)], bytes = bufBytes(bufs);
          if (!post(Object.assign({ t: 'smp' }, e), bufs, trackId, node)) return;
          this.bytes.set(e.id, bytes);
          this.sent.add(e.id);
          if (capOf.has(e)) this.cap.set(e.id, capOf.get(e));
        }
        this.trim(id);
        // §14.3 Q3: the cap changed while this IR was being built → rebuilt at the new cap
        if (idKind(id) === 'ir' && cm !== this.convMax && this.used().has(id) && !this.pend.has(id)) {
          this.free(id);
          const p = this.push(id, trackId, node);
          this.pend.set(id, p);
          return p;
        }
      }, err => {
        this.pend.delete(id);
        if (!(err && (err.code === 'ECANCEL' || err.reported))) console.warn('asset ' + id + ' could not be built', err);
      });
    },
    async entry(id) {
      if (!isUserId(id)) return this.build({ id });
      const src = await this.source(id);
      if (!src) return null;
      return src.frames ? this.build({ id, table: { frames: src.frames, morph: src.morph | 0 } }) : this.build({ id, rec: src });
    },
    // fresh entries of every id (processorOptions of an offline render at `rate`, §9.6): wavetables, and §9 entries incl.
    // the zone samples of multisamples (a sample also played directly: in full) and the IRs, built for `rate` (an id
    // naming another rate — a patch not compiled at the render's rate — gets its IR prepared for `rate` under that id,
    // with a warning); factory generation is awaited, also for ids held after a cancel or failure (sign-off item 9)
    async entries(ids, rate, at) {
      learn(at);
      const list = Array.isArray(ids) ? ids : [], out = [], have = new Set(), R = rate > 0 ? +rate : 0;
      const skip = new Set(list.filter(id => idKind(id) === 'smp'));
      for (const id of list) {
        if (idKind(id) === 'wt') {
          const e = await this.entry(id).catch(() => null);
          if (e && !have.has(e.id)) { have.add(e.id); out.push(e); }
          continue;
        }
        if (have.has(id)) continue;
        const ir = idKind(id) === 'ir' ? parseIrId(id) : null;
        if (ir && R && ir.rate !== R) console.warn('asset ' + id + ': IR id for ' + ir.rate + ' Hz in a ' + R + ' Hz render (compile the patch with sr: ' + R + '); prepared for ' + R + ' Hz');
        const sk = new Set(have); for (const x of skip) if (x !== id) sk.add(x);
        const es = await assetEntries(id, { skip: sk, convMax: at && at.convMax > 0 ? Math.min(10, +at.convMax) : 10, rate: R, force: true })
          .catch(err => { if (!(err && (err.code === 'ECANCEL' || err.reported))) console.warn('asset ' + id + ' not available for the render', err); return []; });
        for (const e of es) if (!have.has(e.id)) { have.add(e.id); out.push(e); }
      }
      return out;
    },
    build(req) {
      if (!this.wbad) {
        try {
          if (!this.worker) {
            const w = mkWorker('wt');
            if (w) {
              w.onmessage = e => { const d = e.data, q = this.wq.get(d.q); if (!q) return; this.wq.delete(d.q); if (d.err) q.rej(new Error(d.err)); else q.res(d.entry); };
              w.onerror = e => { if (e && e.preventDefault) e.preventDefault(); this.workerFail(); };
              this.worker = w;
            }
          }
          if (this.worker) return new Promise((res, rej) => { const q = ++this.wn; this.wq.set(q, { res, rej, req }); this.worker.postMessage(Object.assign({ q }, req)); });
        } catch (err) { this.workerFail(); }
      }
      return this.buildHere(req);
    },
    workerFail() { // no module workers (or the script failed): build on the main thread from now on
      this.wbad = true;
      if (this.worker) { try { this.worker.terminate(); } catch { /* gone */ } }
      this.worker = null;
      for (const q of this.wq.values()) this.buildHere(q.req).then(q.res, q.rej);
      this.wq.clear();
    },
    async buildHere({ id, table, rec }) {
      const W = await wtMod();
      if (table) return W.makeEntry(id, table);
      if (rec) return W.noiseEntry(Object.assign({}, rec, { id }));
      if (id.startsWith('noise:')) return W.makeNoise(id);
      const t = W.factoryTable(id);
      return t ? W.makeEntry(id, t) : null;
    },
    async source(id) { // user table (Table) or user noise (record), cached
      if (this.user.has(id)) return this.user.get(id);
      const x = await (await wtStore()).get(id);
      if (x) this.user.set(id, x);
      return x;
    },
    gcSoon() { if (!this.gcT) this.gcT = setT(() => { this.gcT = 0; this.gc(); }, 2500); },
    release(trackId) { if (this.needs.delete(trackId)) this.gcSoon(); }, // a track left Serum, was deleted, a preview ended
    drop(trackId) { this.release(trackId); },
    used() { // every id some track (or preview) needs, with the zone samples of the multisamples among them
      const used = new Set();
      for (const list of this.needs.values()) for (const id of list) { used.add(id); for (const d of deps.get(id) || []) used.add(d); }
      return used;
    },
    free(id) {
      post({ t: idKind(id) === 'wt' ? 'wtdel' : 'smpdel', id }, [], null, null);
      this.sent.delete(id); this.unref.delete(id); this.bytes.delete(id); this.cap.delete(id);
    },
    gc() {
      const ctx = ctxOf();
      if (!ctx || this.ctx !== ctx) return;
      const used = this.used(), t = now();
      let wait = false;
      for (const id of [...this.sent]) {
        if (used.has(id)) { this.unref.delete(id); continue; }
        const t0 = this.unref.get(id);
        if (t0 == null) { this.unref.set(id, t); wait = true; } else if (t - t0 >= 10000) this.free(id);
        else wait = true;
      }
      if (wait) this.gcSoon();
    },
    // over the budget: free the entries unreferenced longest (posting order breaks ties); keep = just posted; limit =
    // bytes the idle entries may hold (default keepBytes; superseded variants are left to dropSuperseded then, so the
    // old variant still plays until the patch that replaced it has been posted)
    trim(keep, limit) {
      const ctx = ctxOf();
      if (!ctx || this.ctx !== ctx) return;
      const used = this.used(), idle = [], t = now(), kept = new Set([keep].concat(deps.get(keep) || []));
      const max = limit === undefined ? keepBytes : Math.max(0, Math.min(keepBytes, limit));
      let tot = 0;
      for (const id of this.sent) if (!used.has(id) && !kept.has(id) && !(limit === undefined && this.stale.has(id))) { idle.push(id); tot += this.bytes.get(id) || 0; }
      if (tot <= max) return;
      const since = id => { const t0 = this.unref.get(id); return t0 == null ? t : t0; };
      idle.sort((a, b) => since(a) - since(b));
      for (const id of idle) {
        if (tot <= max) break;
        tot -= this.bytes.get(id) || 0;
        this.free(id);
      }
    },
    // live edits from the WT editor: the changed frames ({t:'wtf'}), else the whole table; stored after 0.5 s of quiet
    update(id, table, opts) {
      this.user.set(id, table);
      for (const k of [...recs.keys()]) if (k === 'wtsmp:' + id || k.startsWith('wtsmp:' + id + '~')) lruDrop(k);
      clearT(this.saveT.get(id));
      this.saveT.set(id, setT(() => {
        this.saveT.delete(id);
        this.refreshTable(id);
        wtStore().then(st => st.put(table, { id, name: table.name })).then(() => this.list(), err => console.warn('wavetable not stored', err));
      }, 500));
      const ctx = ctxOf();
      if (!ctx || this.ctx !== ctx) return;
      const frames = opts && Array.isArray(opts.frames) ? opts.frames : null, R = table.frames.length;
      if (frames && frames.length && this.sent.has(id) && !this.pend.has(id) && WT && !(table.morph >= 2 && R > 1 && R < 256)) {
        for (const f of frames) {
          if (!(f >= 0 && f < R)) continue;
          const levels = WT.buildMipFrame(table.frames[f]);
          if (!post({ t: 'wtf', id, frame: f, levels }, levels.map(l => l.data.buffer), null, null)) return;
        }
      } else if (this.sent.has(id) || this.pend.has(id) || [...this.needs.values()].some(n => n.includes(id))) {
        const prev = this.pend.get(id) || Promise.resolve();
        this.pend.set(id, prev.then(() => this.push(id, null, null))); // in order after a build already under way
      }
    },
    // a user table edited while it plays as a sample (§9.4.8): its posted sample / spectral entries are rebuilt (after
    // the editor's 0.5 s of quiet)
    refreshTable(id) {
      const ctx = ctxOf();
      if (!ctx || this.ctx !== ctx) return;
      const used = this.used(), w = 'wtsmp:' + id;
      for (const x of [...this.sent]) {
        if (!isDerived(x, w)) continue;
        this.free(x);
        if (used.has(x) && !this.pend.has(x)) { const p = this.push(x, null, null); this.pend.set(x, p); }
      }
    },
    async list() { // user wavetable rows for the menus
      try { this.rows = await (await wtStore()).list(); } catch (err) { this.rows = []; }
      refresh();
      return this.rows;
    },
    async listSmp() { // user sample / multisample / IR rows for the menus
      try { this.smpRows = await (await smpStore()).list(); } catch (err) { this.smpRows = []; }
      refresh();
      return this.smpRows;
    },
    // project / preset files (§7.10): { id: encodeEmbedded(record) } for the user tables they reference
    async embed(ids) {
      const W = await wtMod(), out = {};
      for (const id of ids) {
        const x = await this.source(id).catch(() => null);
        if (!x) continue;
        let rec = x;
        if (x.frames) { // Table → record (Float32 frames, little-endian like wtstore)
          const data = new Float32Array(x.frames.length * W.FRAME);
          x.frames.forEach((f, i) => data.set(f.subarray ? f.subarray(0, W.FRAME) : f, i * W.FRAME));
          rec = { id, kind: 'wt', name: x.name || 'Wavetable', frames: x.frames.length, morph: x.morph | 0, data: data.buffer };
        }
        out[id] = W.encodeEmbedded(Object.assign({}, rec, { id }));
      }
      return out;
    },
    async restore(wts) {
      if (!wts || typeof wts !== 'object') return;
      const W = await wtMod(), st = await wtStore();
      for (const id of Object.keys(wts)) {
        if (!/^(user|nzuser):[\w.-]{1,80}$/.test(id) || !wts[id] || typeof wts[id] !== 'object') continue;
        try {
          if (await st.get(id)) continue; // already here (an identical id)
          const rec = W.decodeEmbedded(wts[id]);
          await st.put(Object.assign(rec, { id }), { id, name: typeof rec.name === 'string' ? rec.name : undefined });
        } catch (err) { console.warn('embedded wavetable ' + id + ' skipped', err); }
      }
      await this.list();
    },
    // §9.8: { id: encodeAsset(record) } for the user samples / multisamples (with their zone samples) / IRs referenced
    async embedSmps(ids) {
      await smpMods();
      const st = await smpStore(), out = {}, todo = (Array.isArray(ids) ? ids : []).filter(isUserAsset);
      for (let i = 0; i < todo.length; i++) {
        const id = todo[i];
        if (out[id]) continue;
        const rec = await st.get(id).catch(() => null);
        if (!rec) continue;
        out[id] = SMP.encodeAsset(rec);
        if (rec.kind === 'multi') for (const z of rec.zones || []) if (isUserAsset(z.smp) && !todo.includes(z.smp)) todo.push(z.smp);
      }
      return out;
    },
    // §9.8 import: decode → smpstore.put (identical ids skipped); then the menus refresh
    async restoreSmps(smps) {
      if (!smps || typeof smps !== 'object') return 0;
      await smpMods();
      const st = await smpStore();
      let n = 0;
      for (const id of Object.keys(smps)) {
        if (!isUserAsset(id) || !smps[id] || typeof smps[id] !== 'object') continue;
        try {
          if (await st.get(id)) continue;
          const rec = SMP.decodeAsset(smps[id]);
          if ((rec.kind === 'multi') !== id.startsWith('msmp:') || (rec.kind === 'ir') !== id.startsWith('ir:')) continue;
          if (rec.kind !== 'multi') rec.hash = SMP.assetHash(rec.L, rec.R);
          await st.put(Object.assign(rec, { id }), { id, name: rec.name || undefined });
          missing.delete(id);
          n++;
        } catch (err) {
          if (err && err.quota) { notify(err.message); break; }
          console.warn('embedded asset ' + id + ' skipped', err);
        }
      }
      if (n) firstImport(); // user assets now live in this browser's storage (§9.3 step 9)
      await this.listSmp();
      return n;
    },
    // stores a sample / IR record as a user asset (renders, resample, "Switch to Single Sample", imports) → id. Ids are
    // content addresses (§9.3 step 8): an identical record already stored keeps its id (no PCM is read to know it) and
    // a record is never stored under another content's id. opts: name, folder ('Renders'), odf (samples: compute the
    // onset function before the record is stored, imports), quiet (no menu refresh: the caller lists once at the end)
    async saveRecord(rec, opts) {
      await smpMods();
      const o2 = opts || {}, st = await smpStore(), kind = rec.kind === 'ir' ? 'ir' : 'smp';
      const L = SMP.toF32(rec.L), R = rec.ch === 2 && rec.R != null ? SMP.toF32(rec.R) : null, hash = SMP.assetHash(L, R);
      const id = (kind === 'ir' ? 'ir:' : 'smp:') + hash;
      const has = typeof st.has === 'function' ? await st.has(id) : !!(await st.get(id));
      if (has) {
        if (typeof st.ensureRow === 'function') await st.ensureRow(id).catch(() => false); // a row another tab lost
        missing.delete(id);
        if (!o2.quiet) await this.listSmp();
        return id;
      }
      const out = Object.assign({}, rec, { kind, L, R, ch: R ? 2 : 1, hash });
      if (o2.folder) out.folder = o2.folder;
      if (kind === 'smp' && o2.odf && !out.odf) {
        const r = await work('odf', { L, R, rate: rec.rate });
        if (r && r.ok) out.odf = r.odf;
      }
      await st.put(out, { id, name: o2.name || rec.name || undefined });
      missing.delete(id);
      lruDrop(id);
      firstImport(); // a user asset now lives in this browser's storage (§9.3 step 9)
      if (!o2.quiet) await this.listSmp();
      return id;
    },
    // §9.9 relink: every sound of the project that referenced `from` (Serum oscillators: edit(); Convolve instances:
    // editFx()) and every user multisample whose zones did now uses `to` (the content-addressed id of the new file)
    async relink(from, to) {
      if (!from || !to || from === to) return;
      for (const t of tracks()) {
        if (!t) continue;
        const s = t.vals && t.vals.s;
        if (s && Array.isArray(s.osc) && s.osc.some(O => O && (O.smp === from || O.multi === from)) && typeof o.edit === 'function') {
          o.edit(t, x => { for (const O of x.osc) if (O) { if (O.smp === from) O.smp = to; if (O.multi === from) O.multi = to; } }, { label: 'Relink sample' });
        }
        if (convIrs(t.fx).includes(from) && typeof o.editFx === 'function') {
          o.editFx(t, fx => { for (const I of convInstances(fx)) if (I.sub && I.sub.ir === from) I.sub.ir = to; }, { label: 'Relink impulse response' });
        }
      }
      if (idKind(from) !== 'smp') return;
      const st = await smpStore();
      for (const r of this.smpRows.filter(r => r.kind === 'multi' && Array.isArray(r.smps) && r.smps.includes(from))) {
        const m = await st.get(r.id).catch(() => null);
        if (!m || !Array.isArray(m.zones)) continue;
        for (const z of m.zones) if (z.smp === from) z.smp = to;
        await st.put(m, { id: r.id });
        this.relinked(r.id);
      }
      await this.listSmp();
    },
    // §14.2 project asset meter: the posted entries the project's tracks reference, against the device's worklet budget
    meter() {
      const used = this.used();
      let bytes = 0;
      for (const id of this.sent) if (used.has(id)) bytes += this.bytes.get(id) || 0;
      return { bytes, budget };
    },
    fits(bytes) { return this.meter().bytes + (bytes > 0 ? bytes : 0) <= budget; },
    host: null,
  };

  // host.wt of the Serum panel and its WT editor (§8.8)
  const wtHost = {
    list: () => (WT ? WT.FACTORY_TABLES.map(t => ({ id: t.id, name: t.name, cat: t.cat, user: false })) : [])
      .concat(M.rows.filter(r => r.kind === 'wt').map(r => ({ id: r.id, name: r.name, cat: 'User', user: true }))),
    get: id => { // factory / user tables (Table); user noises: the stored record (L, R, rate, loop: the panel's overview)
      if (!isUserId(id)) return wtMod().then(W => W.factoryTable(id));
      const noise = /^nzuser:/.test(id);
      return M.source(id).then(x => (x && (noise ? x.L : x.frames) ? x : null));
    },
    saveNew: async (table, name) => {
      const st = await wtStore(), nm = String(name || table.name || 'Wavetable').slice(0, 64);
      const t = Object.assign({}, table, { name: nm, factory: 0 });
      const id = await st.put(t, { name: nm });
      t.id = id; M.user.set(id, t);
      if (ctxOf()) M.ensure([id]);
      M.list();
      return id;
    },
    update: (id, table, opts) => M.update(id, table, opts),
    rename: async (id, name) => {
      const st = await wtStore(), nm = String(name || '').slice(0, 64);
      await st.rename(id, nm);
      const x = M.user.get(id);
      if (x) M.user.set(id, Object.assign({}, x, { name: nm }));
      await M.list();
    },
    noises: () => (WT ? WT.NOISES.map(n => ({ id: n.id, name: n.name, cat: n.cat, user: false, oneshot: n.oneshot })) : [])
      .concat(M.rows.filter(r => r.kind === 'noise').map(r => ({ id: r.id, name: r.name, cat: 'User', user: true, oneshot: r.oneshot ? 1 : 0 }))),
    saveNoise: async (entry, name) => {
      const st = await wtStore(), nm = String(name || entry.name || 'Noise').slice(0, 64);
      const id = await st.put(entry, { name: nm });
      M.user.delete(id);
      if (ctxOf()) M.ensure([id]);
      M.list();
      return id;
    },
    // the tracks of this project whose Serum state uses a user table / noise (the panel names them before a delete)
    users: id => tracks().filter(t => t.vals && t.vals.s && userIdsOf(t.vals.s).includes(id)).map(t => t.name),
    // deletes a user table / noise from this browser's store; every sound of the project that used it switches to the
    // default source (Phase-1 §8.8: a missing table would play silence) — OSC A/B/C tables to the default table, a
    // table played as a sample (§9.4.8) to the default sample source, a spectral filter made from it keeps its curve
    // (the table reference goes), the noise to the default noise — and the worklet copy goes once no track needs it
    del: async id => {
      if (!isUserId(id)) return false;
      clearT(M.saveT.get(id)); M.saveT.delete(id); // a pending editor save must not bring it back
      await (await wtStore()).del(id);
      M.user.delete(id);
      const d = typeof o.defaultState === 'function' ? o.defaultState() : null;
      for (const t of d && typeof o.edit === 'function' ? tracks() : []) {
        if (!t.vals || !t.vals.s || !userIdsOf(t.vals.s).includes(id)) continue;
        o.edit(t, s => {
          const dO = k => (d.osc && (d.osc[k] || d.osc[0])) || {};
          (Array.isArray(s.osc) ? s.osc : []).forEach((O, k) => {
            if (!O) return;
            if (O.wt === id) O.wt = dO(k).wt || 'factory:Default';
            if (O.smp === id) O.smp = typeof dO(k).smp === 'string' ? dO(k).smp : '';
            const F = O.spec && O.spec.filt;
            if (F && F.wt === id) { F.wt = ''; if (F.kind === 'wt') F.kind = 'curve'; }
          });
          if (s.noise && s.noise.src === id) { s.noise.src = d.noise.src; s.noise.oneshot = d.noise.oneshot; }
        }, { label: 'Delete wavetable' });
      }
      M.gcSoon();
      await M.list();
      return true;
    },
  };

  // ---- §9.3 import
  let persisted = false;
  function firstImport() {
    if (persisted) return;
    persisted = true;
    Promise.resolve().then(persist).then(ok => { if (!ok) notify(TEXT.persist); }, () => notify(TEXT.persist));
  }
  // decoded file → canonical {rate, ch, len, L, R, root, loop} (§9.3 steps 2–5)
  async function decodeAudio(name, bytes, type, capSec) {
    let d = null;
    try {
      if (type === 'wav') {
        const w = WT.readWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        const info = SMP.rootFromWav(bytes);
        d = { rate: w.sr, L: w.ch[0], R: w.ch.length > 1 ? w.ch[1] : null, root: info.root, loop: w.loop || info.loop };
      } else if (type === 'aiff') {
        const a = SMP.readAiff(bytes);
        d = { rate: a.rate, L: a.L, R: a.R, root: a.root, loop: a.loop };
      }
    } catch (err) { d = null; } // an encoding the readers do not know (ADPCM WAV, µ-law AIFC, …): the browser's decoder
    if (!d) {
      const a = await decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      // §9.3 steps 4–5 whatever the decoder: the file's root and loop from its header chunks, the loop scaled from the
      // file's rate to the decoded one
      let info = { root: null, loop: null }, fr = null;
      if (type === 'wav') { info = SMP.rootFromWav(bytes); fr = SMP.fileRate(bytes); }
      else if (type === 'aiff') { try { const x = SMP.aiffInfo(bytes); info = { root: x.root, loop: x.loop }; fr = x.rate; } catch { /* header unreadable */ } }
      const L0 = SMP.toF32(a.L), n = L0.length;
      let loop = null;
      if (info.loop && fr > 0 && a.rate > 0) {
        const k = a.rate / fr, s0 = Math.round(info.loop.start * k), e0 = Math.min(n, Math.round(info.loop.end * k));
        if (s0 >= 0 && e0 > s0) loop = { start: s0, end: e0 };
      }
      d = { rate: a.rate, L: L0, R: a.R ? SMP.toF32(a.R) : null, root: info.root, loop };
    }
    if (!d.L || !d.L.length || !(d.rate > 0)) throw new Error('no audio');
    let L = d.L, R = d.R, rate = d.rate, loop = d.loop;
    if (rate > SMP.LIMITS.maxRate) { // §9.3 step 3: > 96 kHz → 96 kHz
      const k = SMP.LIMITS.maxRate / rate, r = (await must('resample', { L, R, rate, to: SMP.LIMITS.maxRate }));
      L = r.L; R = r.R || null;
      if (loop) loop = { start: Math.round(loop.start * k), end: Math.min(L.length, Math.round(loop.end * k)) };
      rate = SMP.LIMITS.maxRate;
    }
    const cap = Math.round(capSec * rate);
    if (L.length > cap) {
      L = L.slice(0, cap); if (R) R = R.slice(0, cap);
      notify(TEXT.truncated + ': ' + baseName(name));
      if (loop && loop.end > cap) loop = loop.start < cap - 1 ? { start: loop.start, end: cap } : null;
    }
    const nr = SMP.rootFromName(name);
    return { rate, ch: R ? 2 : 1, len: L.length, L, R, root: nr != null ? nr : d.root != null ? d.root : 60, loop };
  }
  // one audio file → stored record id (kind 'smp' or 'ir'), odf computed for samples
  async function importAudio(name, bytes, type, kind, opts) {
    const capSec = kind === 'ir' ? SMP.LIMITS.irSec : opts && opts.zone ? SMP.LIMITS.zoneSec : SMP.LIMITS.sampleSec;
    const a = await decodeAudio(name, bytes, type, capSec);
    // the playback (or partitioned IR) entry this asset will need in the worklet: ≈ 8 bytes per frame and channel at ≤ 48 kHz
    const est = 8 * a.ch * Math.round(a.len * Math.min(1, SMP.LIMITS.playRate / a.rate));
    // (zone samples of an SFZ add up: `acc` = {bytes} of the multisample so far — its whole set must fit)
    const acc = opts && opts.acc, need = est + (acc ? acc.bytes : 0);
    if (!M.fits(need)) { if (!(acc && acc.refused)) notify(TEXT.memory); if (acc) acc.refused = true; const e = new Error(TEXT.memory); e.code = 'EMEM'; throw e; }
    if (acc) acc.bytes = need;
    const rec = { kind, name: stripExt(name).slice(0, 64), rate: a.rate, ch: a.ch, len: a.len, L: a.L, R: a.R, src: { file: baseName(name).slice(0, 256), type, bytes: bytes.byteLength } };
    if (kind === 'smp') { rec.root = opts && Number.isFinite(opts.root) ? opts.root : a.root; rec.loop = a.loop; rec.folder = ''; }
    // one write: the onset function (samples, not zone samples) is computed before the record is stored
    const id = await M.saveRecord(rec, { name: rec.name, odf: kind === 'smp' && !(opts && opts.zone), quiet: true });
    lruDrop(id);
    return id;
  }
  // SFZ text + the files it may reference → multisample id
  async function importSfz(name, text, files, opts) {
    const { regions, warnings } = SMP.parseSfz(text);
    for (const w of warnings) notify(w);
    if (!regions.length) { notify('No playable regions in ' + baseName(name)); return null; }
    const byPath = new Map(), byBase = new Map();
    for (const f of files) {
      const p = f.name.replace(/\\/g, '/').toLowerCase();
      byPath.set(p, f);
      const b = baseName(p);
      if (!byBase.has(b)) byBase.set(b, f);
    }
    const dir = name.replace(/\\/g, '/').toLowerCase().replace(/[^/]*$/, '');
    const find = path => {
      const p = path.toLowerCase().replace(/^\.\//, '');
      if (byPath.has(dir + p)) return byPath.get(dir + p);
      if (byPath.has(p)) return byPath.get(p);
      for (const [k, f] of byPath) if (k.endsWith('/' + p)) return f;
      return byBase.get(baseName(p)) || null;
    };
    const ids = new Map(), cuts = new Map(), zones = [], st = await smpStore(), acc = { bytes: 0, refused: false };
    let lost = 0;
    for (const r of regions) {
      const f = find(r.sample);
      if (!f) { lost++; continue; }
      let entry = ids.get(f);
      if (!entry) {
        const bytes = await f.data();
        const type = SMP.sniff(bytes);
        if (type !== 'wav' && type !== 'aiff' && type !== 'flac' && type !== 'ogg' && type !== 'mp3' && type !== 'm4a') { lost++; continue; }
        try {
          const id = await importAudio(f.name, bytes, type, 'smp', { zone: true, root: r.root, acc });
          const rec = await st.get(id), fr = SMP.fileRate(bytes);
          // SFZ frame positions refer to the file's own rate (a > 96 kHz file or a decoded format is stored at another)
          entry = { id, len: rec.len, loop: rec.loop, k: fr ? rec.rate / fr : 1 };
          ids.set(f, entry);
        } catch (err) { if (err && err.quota) throw err; if (err && err.code === 'EMEM') return null; lost++; continue; }
      }
      const fr = v => (v == null ? null : Math.round(v * entry.k));
      // `end` (the last frame to play): the zone plays a copy of the sample cut there (content-addressed, so shared)
      let use = entry;
      const end = fr(r.end);
      if (end != null && end >= 1 && end < entry.len) {
        const key = entry.id + '|' + end;
        use = cuts.get(key);
        if (!use) {
          const src = await st.get(entry.id), loop = src.loop && src.loop.end <= end ? src.loop : null;
          const L = SMP.toF32(src.L).slice(0, end), R = src.ch === 2 && src.R ? SMP.toF32(src.R).slice(0, end) : null;
          const id = await M.saveRecord({ kind: 'smp', name: src.name, rate: src.rate, ch: R ? 2 : 1, len: end, L, R, root: src.root, loop, folder: '' }, { name: src.name, quiet: true });
          use = { id, len: end, loop, k: entry.k };
          cuts.set(key, use);
        }
      }
      let mode = r.mode || (use.loop ? 'loop' : 'oneshot');
      let ls = r.ls != null ? fr(r.ls) : use.loop ? use.loop.start : 0, le = r.le != null ? fr(r.le) : use.loop ? use.loop.end : use.len;
      le = Math.min(le, use.len); ls = Math.min(ls, le);
      if (mode !== 'oneshot' && !(le > ls)) mode = 'oneshot';
      zones.push({ lo: r.lo, hi: r.hi, vlo: r.vlo, vhi: r.vhi, root: r.root, tune: r.tune, gain: r.gain, pan: r.pan, smp: use.id, mode, ls, le, off: Math.min(fr(r.off), use.len), env: r.env, rr: r.rr, vt: r.vt });
      if (zones.length >= SMP.LIMITS.zones) break;
    }
    if (lost) notify(lost + ' SFZ region' + (lost > 1 ? 's' : '') + ' without a sample');
    if (!zones.length) return null;
    return saveMulti({ kind: 'multi', name: stripExt(name).slice(0, 64), zones, src: { sfz: String(text).slice(0, SMP.LIMITS.sfzBytes) } }, opts);
  }
  async function saveMulti(rec, opts) {
    const st = await smpStore();
    const id = await st.put(rec, opts && opts.replace && /^msmp:/.test(opts.replace) ? { id: opts.replace, name: rec.name } : { name: rec.name });
    missing.delete(id); lruDrop(id);
    return id;
  }
  // audio files dropped on a Multisample oscillator without an SFZ (IMPL): one zone per sample at its root (file name,
  // smpl, …; 60), key ranges split at the midpoints between the roots as §10.1, all velocities, the sample's own loop
  // (mode 'loop') or one-shot, vt 1
  async function multiFromSamples(ids, name, opts) {
    const st = await smpStore(), recs = [];
    for (const id of ids) { const r = await st.get(id); if (r && r.kind === 'smp') recs.push({ id, root: Math.round(r.root), len: r.len, loop: r.loop }); }
    if (!recs.length) return null;
    recs.sort((a, b) => a.root - b.root || (a.id < b.id ? -1 : 1));
    const u = recs.filter((r, i) => i === 0 || r.root !== recs[i - 1].root).slice(0, SMP.LIMITS.zones); // one sample per root
    const zones = u.map((r, j) => ({
      lo: j === 0 ? 0 : Math.max(0, r.root - Math.floor((r.root - u[j - 1].root) / 2)),
      hi: j === u.length - 1 ? 127 : Math.min(127, r.root + Math.ceil((u[j + 1].root - r.root) / 2) - 1),
      vlo: 0, vhi: 127, root: r.root, tune: 0, gain: 0, pan: 0, smp: r.id, mode: r.loop ? 'loop' : 'oneshot',
      ls: r.loop ? r.loop.start : 0, le: r.loop ? r.loop.end : r.len, off: 0, env: null, rr: [1, 1], vt: 1,
    }));
    return saveMulti({ kind: 'multi', name: String(name || 'Multisample').slice(0, 64), zones, src: null }, opts);
  }
  // FileList / File[] / [{name, data}] → id of the first imported asset of `kind` (§9.3); null + notice on failure
  async function importFiles(files, opts) {
    await smpMods();
    const list = Array.from(files || []), kind = opts && opts.kind === 'ir' ? 'ir' : opts && opts.kind === 'multi' ? 'multi' : 'smp';
    if (!list.length) return null;
    firstImport();
    // every input as {name, data()} (ZIPs expanded)
    const items = [];
    for (const f of list) {
      const bytes = await fileBytes(f).catch(() => null);
      if (!bytes) continue;
      const type = SMP.sniff(bytes.subarray(0, 65536)), name = fileName(f);
      if (type === 'zip') {
        let ents;
        try { ents = SMP.zipEntries(bytes, inflate); } catch (err) { notify(TEXT.unsupported + ': ' + baseName(name)); continue; }
        if (ents.skipped.length) notify(ents.skipped.length + ' file' + (ents.skipped.length > 1 ? 's' : '') + ' in ' + baseName(name) + ' could not be read');
        for (const e of ents) items.push({ name: e.name, data: e.data });
      } else items.push({ name, data: () => Promise.resolve(bytes), type });
    }
    let first = null;
    const sfz = [];
    for (const it of items) if (/\.sfz$/i.test(it.name)) sfz.push(it);
    try {
      if (sfz.length) {
        for (const s of sfz) {
          const text = new TextDecoder().decode(await s.data());
          const id = await importSfz(s.name, text, items, opts);
          if (id && !first) first = id;
        }
      } else {
        const got = [];
        for (const it of items) {
          const bytes = await it.data(), type = it.type || SMP.sniff(bytes.subarray(0, 65536));
          if (type === 'sfz') { const id = await importSfz(it.name, new TextDecoder().decode(bytes), items, opts); if (id && !first) first = id; continue; }
          if (!['wav', 'aiff', 'flac', 'ogg', 'mp3', 'm4a'].includes(type)) { notify(TEXT.unsupported + ': ' + baseName(it.name)); continue; }
          try {
            const id = await importAudio(it.name, bytes, type, kind === 'ir' ? 'ir' : 'smp', {});
            got.push(id);
            if (!first) first = id;
          } catch (err) {
            if (err && err.quota) throw err; // "Storage full — remove unused samples" (below), the import stops
            if (!(err && err.code === 'EMEM')) notify(TEXT.unsupported + ': ' + baseName(it.name));
          }
        }
        // a Multisample oscillator gets a multisample of the dropped samples
        if (kind === 'multi' && got.length && !/^msmp:/.test(first)) first = await multiFromSamples(got, stripExt(fileName(list[0])), opts);
      }
    } catch (err) { notify((err && err.quota ? err.message : TEXT.unsupported) + ''); }
    await M.listSmp();
    // §9.9 relink of a missing asset (`replace`): a multisample keeps its id (uuid), a sample / IR takes the new file's
    // content address and every sound that used the missing id is switched to it (ids always name their content)
    const rep = opts && isUserAsset(opts.replace) ? opts.replace : null;
    if (first && rep) {
      if (first === rep) M.relinked(first);
      else if (idKind(first) === idKind(rep)) await M.relink(rep, first);
    }
    return first;
  }
  // a relinked id: its entries are rebuilt for every track that needs them
  M.relinked = id => {
    lruDrop(id);
    smpStore().then(st => dropSpecCache(st, id)).catch(() => {});
    const derived = [...M.sent].filter(x => isDerived(x, id));
    for (const x of derived) M.free(x);
    for (const [tid, list] of M.needs) if (list.some(x => isDerived(x, id))) M.ensure(list, { trackId: tid });
  };

  // ---- host.smp of the Serum panel (§11.15)
  const smpHost = {
    list: kind => {
      if (!SMP) smpMods().catch(() => {});
      const user = M.smpRows;
      if (kind === 'sample') {
        const fac = GEN ? GEN.FACTORY_SAMPLES.map(s => ({ id: s.id, name: s.name, cat: s.cat, folder: '', user: false, seconds: s.seconds, ch: facCh.get(s.id) || (s.stereo ? 2 : 1), gran: s.granFirst })) : [];
        const mine = user.filter(r => r.kind === 'smp').map(r => ({ id: r.id, name: r.name, cat: r.folder === 'Renders' ? 'Renders' : 'User', folder: r.folder || '', user: true, seconds: r.seconds, ch: r.ch, missing: missing.has(r.id) }));
        const wts = (WT ? WT.FACTORY_TABLES.map(t => ({ id: t.id, name: t.name, cat: 'Wavetables/' + t.cat, folder: '', user: false, seconds: t.frames * 2048 / 48000, ch: 1 })) : [])
          .concat(M.rows.filter(r => r.kind === 'wt').map(r => ({ id: r.id, name: r.name, cat: 'Wavetables/User', folder: '', user: true, seconds: 0, ch: 1 })));
        return fac.concat(mine, wts);
      }
      if (kind === 'multi') {
        const fac = GEN ? GEN.FACTORY_MULTI.map(m => { const mdl = MODELS.find(x => x.id === m.model); return { id: m.id, name: m.name, cat: mdl ? mdl.name : m.model, folder: '', user: false, seconds: m.gate, ch: m.ch === 'st' ? 2 : 1 }; }) : [];
        return fac.concat(user.filter(r => r.kind === 'multi').map(r => ({ id: r.id, name: r.name, cat: 'User', folder: '', user: true, seconds: 0, ch: 1, zones: r.zones })));
      }
      if (kind === 'ir') {
        const fac = GEN ? GEN.FACTORY_IRS.map(x => ({ id: x.id, name: x.name, cat: x.folder, folder: x.folder, user: false, seconds: 0, ch: x.ch === 1 ? 1 : 2 })) : [];
        return fac.concat(user.filter(r => r.kind === 'ir').map(r => ({ id: r.id, name: r.name, cat: 'User', folder: '', user: true, seconds: r.seconds, ch: r.ch })));
      }
      return [];
    },
    import: (files, opts) => importFiles(files, opts || {}).catch(err => { notify(TEXT.unsupported); console.warn(err); return null; }),
    overview: async (id, n) => {
      const cols = Math.max(0, n | 0);
      try {
        await smpMods();
        const base = srcId(id), rec = base ? await record(base) : null;
        if (!rec || rec.kind === 'multi') return new Float32Array(2 * cols);
        // a shaped-IR id (`<ir>@<rate>~<shapeKey>`, the Convolve display): the shaped IR, built in smpwork
        const ir = rec.kind === 'ir' ? parseIrId(id) : null;
        if (ir) {
          let shape = null;
          try { shape = shapeFor(ir.ir, ir.key); } catch { /* unknown shape: the plain IR */ }
          if (shape) {
            const r = recForWork(rec), x = await work('irview', { id, rec: r, rate: ir.rate, shape, convMax: M.convMax, n: cols }, recBufs(r));
            if (x && x.ok) return x.ov;
          }
        }
        return SMP.overview(SMP.toF32(rec.L), rec.R != null && rec.ch === 2 ? SMP.toF32(rec.R) : null, cols);
      } catch (err) { return new Float32Array(2 * cols); }
    },
    spectrogram: async (id, w, h) => {
      const W = Math.max(0, w | 0), H = Math.max(0, h | 0), none = { w: W, h: H, data: new Uint8ClampedArray(W * H) };
      try {
        await smpMods();
        const base = srcId(id), rec = base ? await record(base) : null;
        if (!rec || rec.kind === 'multi') return none;
        const r = await work('spectrogram', { L: SMP.toF32(rec.L), R: rec.R != null && rec.ch === 2 ? SMP.toF32(rec.R) : null, rate: rec.rate, w: W, h: H });
        return r && r.ok ? { w: r.w, h: r.h, data: r.data } : none;
      } catch (err) { return none; }
    },
    odf: async id => {
      try {
        await smpMods();
        const base = srcId(id), rec = base && !base.startsWith('wtsmp:') ? await record(base) : null; // tables: no odf (§9.4.8)
        if (!rec || rec.kind !== 'smp') return new Float32Array(0);
        if (rec.odf) return SMP.toF32(rec.odf);
        const r = await work('odf', { L: SMP.toF32(rec.L), R: rec.R != null && rec.ch === 2 ? SMP.toF32(rec.R) : null, rate: rec.rate });
        if (!r || !r.ok) return new Float32Array(0);
        rec.odf = r.odf.slice();
        if (isUserAsset(base)) { const st = await smpStore(), got = await st.get(base); if (got) { got.odf = r.odf.slice(); await st.put(got, { id: base }).catch(() => {}); } }
        return r.odf;
      } catch (err) { return new Float32Array(0); }
    },
    record: async id => {
      const base = srcId(id);
      if (!base) return null;
      const r = await record(base).catch(() => null);
      if (!r) return null;
      const out = Object.assign({}, r);
      delete out.L; delete out.R; delete out.odf;
      if (Array.isArray(out.zones)) out.zones = out.zones.map(z => Object.assign({}, z));
      if (Array.isArray(out.marks)) out.marks = out.marks.slice();
      // a user multisample whose zone samples were deleted (§9.9): `missing` lists them (the panel's badge)
      if (/^msmp:/.test(base) && Array.isArray(out.zones)) {
        const st = await smpStore(), zs = [...new Set(out.zones.map(z => z.smp).filter(isUserAsset))], gone = [];
        for (const z of zs) if (!(await (typeof st.has === 'function' ? st.has(z) : st.get(z).then(Boolean)).catch(() => false))) gone.push(z);
        out.missing = gone;
      }
      return out;
    },
    pcm: async id => {
      const base = srcId(id);
      if (!base) return null;
      const r = await record(base).catch(() => null);
      if (!r || r.kind === 'multi') return null;
      await smpMods();
      return { rate: r.rate, ch: r.ch === 2 && r.R != null ? 2 : 1, L: SMP.toF32(r.L), R: r.ch === 2 && r.R != null ? SMP.toF32(r.R) : null };
    },
    // §14.2 project asset meter (GLOBAL page): {bytes, budget}
    usage: () => M.meter(),
    rename: async (id, name) => {
      if (!isUserAsset(id)) return;
      await (await smpStore()).rename(id, String(name || '').slice(0, 64));
      lruDrop(id);
      await M.listSmp();
    },
    // §9.9: deletes a user asset; the sounds that use it keep the id (silent / bypassed, "Missing sample" badge)
    del: async id => {
      if (!isUserAsset(id)) return false;
      const st = await smpStore();
      if (!(await st.get(id).catch(() => null))) return false;
      await st.del(id);
      await dropSpecCache(st, id).catch(() => 0);
      lruDrop(id);
      missing.add(id);
      const derived = [...M.sent].filter(x => isDerived(x, id));
      for (const x of derived) M.free(x);
      M.gcSoon();
      await M.listSmp();
      return true;
    },
    // the tracks whose sounds use a user asset: oscillators (sample, multisample — also through a user multisample whose
    // zones play this sample), Convolve IRs of any rack
    users: id => {
      const multis = M.smpRows.filter(r => r.kind === 'multi' && Array.isArray(r.smps) && r.smps.includes(id)).map(r => r.id);
      const uses = O => O && (O.smp === id || O.multi === id || (O.multi && multis.includes(O.multi)));
      return tracks().filter(t => t && ((t.vals && t.vals.s && Array.isArray(t.vals.s.osc) && t.vals.s.osc.some(uses)) || convIrs(t.fx).includes(id))).map(t => t.name);
    },
    // "Switch to Single Sample": the recent voice's zone sample as a user sample of its own
    saveFrom: async (osc, kind) => {
      const z = typeof o.zoneOf === 'function' ? o.zoneOf(osc) : null;
      if (!z) return null;
      if (/^smp:/.test(z)) return z;
      const rec = await record(z).catch(() => null);
      if (!rec || rec.kind === 'multi') return null;
      return M.saveRecord(Object.assign({}, rec, { factory: 0 }), { name: rec.name || 'Zone' });
    },
    cancel: () => cancelGen(),
    // a factory sound whose generation was cancelled or failed: generate it again (IMPL; the panel's retry action)
    retry: id => retry(id),
  };
  M.host = { wt: wtHost, smp: smpHost };
  return M;
}
