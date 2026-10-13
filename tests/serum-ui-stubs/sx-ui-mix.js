// Test stub of sx-ui-mix.js (U3; SPEC-serum2 §11.14: MixerPage(root, host), channelStrips(s, fx),
// routeMenuItems(s, ch)) for tests/serum-ui.test.mjs. serum-ui loads the MIX page module on demand (dynamic import), so
// the page works before U3's module exists; the export-parity test compares these names with the real module once it
// is there. made = every page built (a kit panel with the mixer's master-section destinations).
export const __stub = true;
export const made = [];
export class MixerPage {
  constructor(root, kit) {
    this.kit = kit;
    const P = kit.panel('MIXER', null, null);
    for (const id of ['a.level', 'g.direct', 'g.bus1v', 'g.bus2v']) P.body.appendChild(kit.knob(id, { label: id, size: 'sm' }).el);
    this.el = P.el;
    if (root) root.appendChild(this.el);
    made.push(this);
  }
  destroy() { this.dead = true; this.el.remove(); }
}
export function channelStrips() { return []; }
export function routeMenuItems() { return []; }
