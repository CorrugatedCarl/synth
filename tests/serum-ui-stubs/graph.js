// Test stub of graph.js for tests/serum-ui.test.mjs (records the editors serum-ui builds).
export const __stub = true;
export const made = [];
export class CurveEditor {
  constructor(box, o) {
    this.o = o;
    this.root = box.ownerDocument.createElement('div');
    this.root.className = 'gx-root';
    box.appendChild(this.root);
    this.n = 0;
    made.push(this);
  }
  refresh() { this.n++; }
  destroy() { this.dead = true; this.root.remove(); }
}
export class EnvEditor extends CurveEditor {}
export const pts = { SHAPES: [{ name: 'Triangle', pts: [[0, 0, 0], [0.5, 1, 0], [1, 0, 0]] }] };
