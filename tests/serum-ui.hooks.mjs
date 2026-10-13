// Module hook for tests/serum-ui.test.mjs (E5) and the sub-panel tests: the sibling UI modules serum-ui.js imports
// (graph.js, fx-ui.js, wtedit.js, wt.js) resolve to the small stubs in tests/serum-ui-stubs/, so a unit test exercises
// its own module alone (§10.1). Used in-thread through module.registerHooks (node ≥ 22.15 / 23.5) via `redirect`, or
// off-thread through module.register (node ≥ 20.6) via the async `resolve` export.
// redirectUI additionally maps the sub-panel modules serum-ui hosts (sx-ui-osc.js, sx-ui-seq.js, sx-ui-mix.js; SPEC-serum2
// §11.14) to their stubs — serum-ui's own test only (tests/serum-ui-stubs/hooks-ui.mjs is its off-thread form). The
// stubs re-export the real sub-panel modules through the `?real` specifier, which is never redirected.
const ROOT = new URL('../', import.meta.url).href;
const STUBS = new URL('./serum-ui-stubs/', import.meta.url).href;
const NAMES = new Set(['graph.js', 'fx-ui.js', 'wtedit.js', 'wt.js']);
const UI_NAMES = new Set(['sx-ui-osc.js', 'sx-ui-seq.js', 'sx-ui-mix.js']);

function target(spec, parentURL, names) {
  if (!parentURL || !/^(\.\.?\/|file:)/.test(spec) || /[?&]real\b/.test(spec)) return null;
  const url = new URL(spec, parentURL).href.split(/[?#]/)[0];
  if (!url.startsWith(ROOT)) return null;
  const name = url.slice(ROOT.length);
  return names.some(N => N.has(name)) ? { url: STUBS + name, format: 'module', shortCircuit: true } : null;
}
export function redirect(spec, parentURL) { return target(spec, parentURL, [NAMES]); }
export function redirectUI(spec, parentURL) { return target(spec, parentURL, [NAMES, UI_NAMES]); }
export async function resolve(spec, ctx, next) { return redirect(spec, ctx.parentURL) || next(spec, ctx); }
export async function resolveUI(spec, ctx, next) { return redirectUI(spec, ctx.parentURL) || next(spec, ctx); }
