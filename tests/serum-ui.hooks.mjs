// Module hook for tests/serum-ui.test.mjs (E5): the sibling UI modules serum-ui.js imports (graph.js, fx-ui.js,
// wtedit.js, wt.js) resolve to the small stubs in tests/serum-ui-stubs/, so the unit tests exercise serum-ui alone
// (§10.1). Used in-thread through module.registerHooks (node ≥ 22.15 / 23.5) via `redirect`, or off-thread through
// module.register (node ≥ 20.6) via the async `resolve` export.
const ROOT = new URL('../', import.meta.url).href;
const STUBS = new URL('./serum-ui-stubs/', import.meta.url).href;
const NAMES = new Set(['graph.js', 'fx-ui.js', 'wtedit.js', 'wt.js']);

export function redirect(spec, parentURL) {
  if (!parentURL || !/^(\.\.?\/|file:)/.test(spec)) return null;
  const url = new URL(spec, parentURL).href.split(/[?#]/)[0];
  if (!url.startsWith(ROOT)) return null;
  const name = url.slice(ROOT.length);
  return NAMES.has(name) ? { url: STUBS + name, format: 'module', shortCircuit: true } : null;
}
export async function resolve(spec, ctx, next) { return redirect(spec, ctx.parentURL) || next(spec, ctx); }
