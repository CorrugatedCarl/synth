// panels/index.js — model id → hardware front-panel layout of the twelve classic synths (docs/canvas/IMPL-panels.md §3).
// Owner: ENGINE lane (this index never needs an AUTHOR edit: every model's file is already imported). Each
// panels/<model>.js is one AUTHOR lane's data file: a default export that is a layout object (§3) or null (not drawn
// yet → that model offers only the Simple layout). Plain ES module, nothing but data: node imports it (tests).
// Not imported by the site yet: the ENGINE lane wires it (through cv-panel.js) together with the precache crawl's
// directory-relative imports (tools/precache.mjs, IMPL-panels §2.3), so the tree stays green until then.
import modular from './modular.js?v=9';
import minimoog from './minimoog.js?v=9';
import arp2600 from './arp2600.js?v=9';
import solina from './solina.js?v=9';
import cs80 from './cs80.js?v=9';
import prophet5 from './prophet5.js?v=9';
import ms20 from './ms20.js?v=9';
import tb303 from './tb303.js?v=9';
import obxa from './obxa.js?v=9';
import jupiter8 from './jupiter8.js?v=9';
import juno60 from './juno60.js?v=9';
import dx7 from './dx7.js?v=9';

/** model id → layout (null: not drawn yet), in models.js MODELS order. Every classic model has a physical counterpart;
 * Serum (custom) and the FX panels have none and are not listed. */
export const LAYOUTS = Object.freeze({ modular, minimoog, arp2600, solina, cs80, prophet5, ms20, tb303, obxa, jupiter8, juno60, dx7 });
/** The classic models with a hardware layout slot, in MODELS order. */
export const HW_IDS = Object.freeze(Object.keys(LAYOUTS));
/** The layout of `id`, or null (not drawn yet, Serum, unknown). @param {string} id @returns {object|null} */
export function layoutOf(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(LAYOUTS, id) ? LAYOUTS[id] || null : null;
}
