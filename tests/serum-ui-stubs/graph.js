// Test stub of graph.js for tests/serum-ui.test.mjs and the sub-panel tests (records the editors built).
export const __stub = true;
export const made = [];
export class CurveEditor {
  constructor(box, o) {
    this.o = o;
    this.root = box.ownerDocument.createElement('div');
    this.root.className = 'gx-root';
    box.appendChild(this.root);
    this.n = 0;
    this.tool = 'point';
    made.push(this);
  }
  refresh() { this.n++; }
  setTool(t) { this.tool = t; }
  destroy() { this.dead = true; this.root.remove(); }
}
export class EnvEditor extends CurveEditor {}
export class PathEditor extends CurveEditor {}
// the LFO Editor overlay: an editor in a div.gx-overlay appended to container; { el, editor, setTool, refresh, close, destroy }
export function lfoEditorLarge(container, o) {
  const el = container.ownerDocument.createElement('div');
  el.className = 'gx-overlay';
  container.appendChild(el);
  const editor = o.path ? new PathEditor(el, o) : new CurveEditor(el, Object.assign({}, o, { kind: o.kind || 'lfo' }));
  editor.large = true;
  let closed = false;
  const fin = run => { if (closed) return; closed = true; editor.destroy(); el.remove(); if (run && o.onClose) o.onClose(); };
  return { el, editor, setTool: t => { if (o.tool && o.tool.set) o.tool.set(t); }, refresh: () => editor.refresh(), close: () => fin(true), destroy: () => fin(false) };
}
export const pts = { SHAPES: [{ name: 'Triangle', pts: [[0, 0, 0], [0.5, 1, 0], [1, 0, 0]] }] };
