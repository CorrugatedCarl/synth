// Shared loader of the classic DSP scripts for every DSP test (owner D5; SPEC-serum2 §0.3, §15).
//
// dspScope(opts) evaluates the §0.3 list (scripts 1–11, table order) into one node:vm context and returns the scope.
// Options (all optional):
//   files      subset of DSP_FILES to load; always evaluated in table order (default: the whole list)
//   overrides  { [file]: null | false | string | (src, file) => string }
//                null     the script is not evaluated; its global is set to null (as a load failure / M1a stub)
//                false    the script is not evaluated and its global stays undefined (a rejected addModule)
//                string   replacement source evaluated instead of the file
//                function transform of the file's source (e.g. a throwing copy for the failure-isolation tests)
//   missing    what a listed file that does not exist yet becomes: 'null' (default: its global is null, the engine's
//              stub rule of M1a step 4), 'skip' (global undefined) or 'throw'
//   engine     true: evaluate engine.js last and capture the registered processor class as `Proc`
//   bare       true: no AudioWorklet globals (sampleRate, currentFrame, AudioWorkletProcessor, registerProcessor), for the
//              environment-neutrality tests; incompatible with `engine`
//   fast       true: vm.constants.DONT_CONTEXTIFY (an ordinary global object with its own intrinsics, no interceptor) when
//              node has it — DSP loops then run at worklet speed (CPU tests); default: a contextified sandbox
//   sampleRate AudioWorklet `sampleRate` (default 48000)
//   console    console object for the scope (default: a recorder; its messages are `logs`)
//   seed       render id for Math.random (default 'dsp-scope'): Math.random of the scope is mulberry32(fnv1a32(id)) from
//              wt.js (§0.4), installed before any script runs; `seed(id)` reseeds it (call before each render)
// Returns { ctx (the context / global object), logs ([{level, text}] of the default console), loaded (files evaluated, in
// order), missing (listed files absent from the repository), global(name), run(code, filename), reload(file), seed(id),
// Proc (engine only) }.
//
// noAlloc(scope, fn, names = ALLOC_NAMES) runs fn() with the scope's allocating constructors (typed arrays, Array,
// ArrayBuffer, Map, Set, Object) replaced by throwing stubs and restores them afterwards (§15 "allocation-free checks by
// replacing typed-array constructors in the vm context"); returns fn's result. Scripts look these constructors up as
// globals at call time, so any `new Float64Array(…)` etc. inside fn throws 'allocation: <name>'.
import vm from 'node:vm';
import { readFileSync, existsSync } from 'node:fs';
import { mulberry32, fnv1a32 } from '../wt.js?v=6';

export const ROOT = new URL('../', import.meta.url);
// §0.3 table: [file, global] in injection order (engine.js is loaded last, separately)
export const DSP_TABLE = Object.freeze([
  ['sx-base.js', 'SxBase'], ['sx-filt2.js', 'SxFilt2'], ['sx-warp.js', 'SxWarp'], ['sx-mod.js', 'SxMod'],
  ['sx-sample.js', 'SxSample'], ['sx-gran.js', 'SxGran'], ['sx-spec.js', 'SxSpec'], ['sx-seq.js', 'SxSeq'],
  ['serum-dsp.js', 'SerumDSP'], ['fx-mods2.js', 'FXMods2'], ['fx-dsp.js', 'FXDSP'],
].map(e => Object.freeze(e)));
export const DSP_FILES = Object.freeze(DSP_TABLE.map(e => e[0]));
export const DSP_GLOBALS = Object.freeze(Object.fromEntries(DSP_TABLE));

const SOURCES = new Map();
/** Source text of a repository file (cached per process); null when the file does not exist. */
export function source(file) {
  if (!SOURCES.has(file)) {
    const u = new URL(file, ROOT);
    SOURCES.set(file, existsSync(u) ? readFileSync(u, 'utf8') : null);
  }
  return SOURCES.get(file);
}

export const ALLOC_NAMES = Object.freeze(['Float64Array', 'Float32Array', 'Uint8Array', 'Uint16Array', 'Uint32Array',
  'Int8Array', 'Int16Array', 'Int32Array', 'Array', 'ArrayBuffer', 'Map', 'Set', 'Object']);
/** fn() with the allocating constructors of the scope (a dspScope result or a vm context) replaced by throwing stubs. */
export function noAlloc(scope, fn, names = ALLOC_NAMES) {
  const ctx = scope && scope.ctx ? scope.ctx : scope;
  // A contextified sandbox does not own the built-ins (reading them from outside gives undefined): the stub is set as an
  // own property and deleted afterwards; writing the saved `undefined` back would hide the built-in for good.
  const own = Object.prototype.hasOwnProperty, saved = {};
  for (const k of names) {
    saved[k] = own.call(ctx, k) ? { v: ctx[k] } : null;
    ctx[k] = function () { throw new Error('allocation: ' + k); };
  }
  try { return fn(); } finally {
    for (const k of names) { if (saved[k]) ctx[k] = saved[k].v; else delete ctx[k]; }
  }
}

/** A console that records every message as {level, text}. */
export function recorder() {
  const msgs = [];
  const rec = level => (...a) => msgs.push({ level, text: a.map(String).join(' ') });
  return { log: rec('log'), info: rec('info'), debug: rec('debug'), warn: rec('warn'), error: rec('error'), msgs };
}

export function dspScope(opts = {}) {
  const { files = DSP_FILES, overrides = {}, missing = 'null', engine = false, bare = false, fast = false,
    sampleRate = 48000, seed = 'dsp-scope' } = opts;
  if (bare && engine) throw new Error('dspScope: engine needs the AudioWorklet globals (bare: false)');
  for (const f of files) if (!DSP_FILES.includes(f)) throw new Error('dspScope: ' + f + ' is not in the §0.3 list');
  for (const f of Object.keys(overrides)) if (!DSP_FILES.includes(f)) throw new Error('dspScope: override for unknown file ' + f);
  const rec = opts.console ? null : recorder();
  const cons = opts.console || rec;
  const ctx = fast && vm.constants && vm.constants.DONT_CONTEXTIFY !== undefined
    ? vm.createContext(vm.constants.DONT_CONTEXTIFY) : vm.createContext({});
  ctx.console = cons;
  // Math.random := mulberry32(fnv1a32(id)) of the outer realm, reached through a closure (no extra global in the scope)
  let rnd = mulberry32(fnv1a32(String(seed)));
  vm.runInContext('(function (r) { Math.random = function random() { return r(); }; })', ctx, { filename: 'dsp-scope-random.js' })(() => rnd());
  let Proc = null;
  if (!bare) {
    ctx.sampleRate = sampleRate;
    ctx.currentFrame = 0;
    vm.runInContext('(function (reg) { globalThis.AudioWorkletProcessor = class AudioWorkletProcessor {'
      + ' constructor() { this.port = { postMessage() {}, onmessage: null }; } };'
      + ' globalThis.registerProcessor = function registerProcessor(name, cls) { reg(name, cls); }; })',
    ctx, { filename: 'dsp-scope-worklet.js' })((name, cls) => { Proc = cls; });
  }
  const run = (code, filename) => vm.runInContext(code, ctx, { filename });
  const setGlobal = (name, v) => { run('(function (v) { globalThis.' + name + ' = v; })', 'dsp-scope-stub.js')(v); };
  const loaded = [], absent = [];
  const load = (file) => {
    const name = DSP_GLOBALS[file];
    let code = source(file);
    const o = Object.prototype.hasOwnProperty.call(overrides, file) ? overrides[file] : undefined;
    if (o === null) { setGlobal(name, null); return; }
    if (o === false) return;
    if (typeof o === 'string') code = o;
    else if (code === null) {
      absent.push(file);
      if (missing === 'throw') throw new Error('dspScope: ' + file + ' does not exist');
      if (missing === 'null') setGlobal(name, null);
      return;
    } else if (typeof o === 'function') code = o(code, file);
    run(code, file);
    loaded.push(file);
  };
  for (const f of DSP_FILES) if (files.includes(f)) load(f);
  if (engine) {
    run(source('engine.js'), 'engine.js');
    if (!Proc) throw new Error('dspScope: engine.js registered no processor');
  }
  return {
    ctx, logs: rec ? rec.msgs : null, loaded, missing: absent,
    get Proc() { return Proc; },
    global: name => run('globalThis.' + name, 'dsp-scope-get.js'),
    run,
    reload: file => { if (!DSP_FILES.includes(file)) throw new Error('dspScope: ' + file + ' is not in the §0.3 list'); load(file); },
    seed: id => { rnd = mulberry32(fnv1a32(String(id))); },
  };
}
