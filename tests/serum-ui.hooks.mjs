// Module hook for the panel unit tests (sx-host.test, sx-helpers.test, rig-ui.test, the sub-panel tests …; E5): the sibling UI
// modules sx-host.js imports (graph.js, fx-ui.js, wtedit.js, wt.js) resolve to the small stubs in tests/serum-ui-stubs/, so a unit
// test exercises its own module alone (§10.1). Used in-thread through module.registerHooks (node ≥ 22.15 / 23.5) via `redirect`, or
// off-thread through module.register (node ≥ 20.6) via the async `resolve` export. A `?real` specifier is never redirected.
const ROOT = new URL('../', import.meta.url).href;
const STUBS = new URL('./serum-ui-stubs/', import.meta.url).href;
const NAMES = new Set(['graph.js', 'fx-ui.js', 'wtedit.js', 'wt.js']);

function target(spec, parentURL, names) {
  if (!parentURL || !/^(\.\.?\/|file:)/.test(spec) || /[?&]real\b/.test(spec)) return null;
  const url = new URL(spec, parentURL).href.split(/[?#]/)[0];
  if (!url.startsWith(ROOT)) return null;
  const name = url.slice(ROOT.length);
  return names.some(N => N.has(name)) ? { url: STUBS + name, format: 'module', shortCircuit: true } : null;
}
export function redirect(spec, parentURL) { return target(spec, parentURL, [NAMES]); }
export async function resolve(spec, ctx, next) { return redirect(spec, ctx.parentURL) || next(spec, ctx); }
