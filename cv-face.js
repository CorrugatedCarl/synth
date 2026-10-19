// cv-face.js — STUB — lane F replaces this file (docs/canvas/IMPL-1h.md §3). The §3.1 surface cv-world (lane G) calls:
// attach / detach, quads(rectOf, cam) → Quad[], onChange(fn) → off, stats(). The real registry (register(deco, …) → Face:
// base textures, windows, the budget, the overlap rule) is lane F's; here it throws so a merge that kept this stub shows.
let attached = null;
const subs = new Set();

/** The world attaches once the GL layer exists ({ gl, world }); again after a context restore (every texture dead). */
export function attach(o) { attached = o || null; }
/** On destroy, a context loss, the 2D fallback. */
export function detach() { attached = null; }
/** The quads to draw this frame, in order (no DOM read). The stub has none. */
export function quads(rectOf, cam) { return []; }
/** fn runs when the quad list would differ (a texture landed, a mode / window changed). Returns the remover. */
export function onChange(fn) { if (typeof fn !== 'function') return () => {}; subs.add(fn); return () => subs.delete(fn); }
export function stats() { return { faces: 0, gl: 0, dom: 0, bytes: 0, base: 0, windows: 0, paints: 0, paintMs: 0, paintMax: 0 }; }
export function register() { throw new Error('cv-face: lane F'); }
/** (tests) whether the world attached, and what it gave. */
export function attachment() { return attached; }
