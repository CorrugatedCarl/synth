// Test stub of wtedit.js for tests/serum-ui.test.mjs.
export const __stub = true;
export const made = [];
export class WTEditor {
  constructor(root, o) { this.root = root; this.o = o; made.push(this); }
  open() { this.isOpen = true; }
  close() { if (this.isOpen) { this.isOpen = false; if (this.o.onClose) this.o.onClose(); } }
}
