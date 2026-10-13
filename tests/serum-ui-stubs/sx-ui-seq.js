// Test stub of sx-ui-seq.js (U4) for tests/serum-ui.test.mjs: the pure helpers are the real module's (re-exported
// through the `?real` specifier, never redirected), the pages are small stand-ins built on the kit, so serum-ui's
// page shell is tested without U4's pages (their own tests: tests/sx-ui-seq.test.mjs). Local exports shadow the star
// re-export (same names as the real ones). made = every page built.
export * from '../../sx-ui-seq.js?real';
export const __stub = true;
export const made = [];

function page(self, root, kit, title, module, power, ids) {
  self.kit = kit;
  const P = kit.panel(title, module, power);
  for (const id of ids) P.body.appendChild(kit.knob(id, { label: id.slice(id.indexOf('.') + 1).toUpperCase(), size: 'sm' }).el);
  self.el = P.el;
  self.body = P.body;
  if (root) root.appendChild(self.el);
  made.push(self);
}
export class ArpPage {
  constructor(root, kit) { page(this, root, kit, 'ARP', 'arp', 'arp.on', ['arp.rate', 'arp.gate']); }
  destroy() { this.dead = true; this.el.remove(); }
}
export class ClipPage {
  constructor(root, kit) { page(this, root, kit, 'CLIP', 'clip', 'clip.on', ['clip.trans']); }
  destroy() { this.dead = true; this.el.remove(); }
}
export class KeyboardPanel {
  constructor(root, kit) {
    page(this, root, kit, 'KEYBOARD', null, null, []);
    this.el.classList.add('sx-kbd');
    this.n = 0;
    kit.custom(() => { this.n++; });
  }
  destroy() { this.dead = true; this.el.remove(); }
}
export class OscMapEditor {
  constructor(root, kit) { this.kit = kit; this.el = kit.doc.createElement('div'); if (root) root.appendChild(this.el); }
  refresh() {}
  destroy() { this.el.remove(); }
}
export class PianoRoll {
  constructor(root, o) { this.o = o; this.el = (o && o.doc ? o.doc : root.ownerDocument).createElement('div'); if (root) root.appendChild(this.el); }
  refresh() { return false; }
  view() { return null; }
  command() { return false; }
  destroy() { this.el.remove(); }
}
