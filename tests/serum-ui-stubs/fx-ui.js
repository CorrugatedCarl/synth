// Test stub of fx-ui.js for tests/serum-ui.test.mjs (records the rack and the adapter it receives).
export const __stub = true;
export const made = [];
export class FXRackUI {
  constructor(root, host, opts) {
    this.host = host;
    this.opts = opts;
    this.knobs = new Map();
    this.el = root.ownerDocument.createElement('div');
    this.el.className = 'fxr-root';
    root.appendChild(this.el);
    this.n = 0;
    made.push(this);
  }
  refresh() { this.n++; }
  ctlExtras(id) { return typeof this.extras === 'function' ? this.extras(id) : []; }
  scrollTo() {}
  destroy() { this.dead = true; this.el.remove(); }
}
