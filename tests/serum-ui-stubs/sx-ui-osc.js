// Test stub of sx-ui-osc.js (U2) for tests/serum-ui.test.mjs: the pure helpers and type views are the real module's
// (re-exported through the `?real` specifier, which tests/serum-ui-stubs/hooks-ui.mjs never redirects), the panels
// and the shared oscillator data are small stand-ins, so serum-ui's page shell is tested without U2's panels
// (their own tests: tests/sx-ui-osc.test.mjs). Local exports shadow the star re-export (same names as the real ones).
//   OscPanel(root, kit, o) / SubPanel / NoisePanel / FilterPanel(root, kit, k): kit.panel shells (module, power) with
//   one kit.knob per destination of the module (MODULE_FIELDS[m].p, minus the power id) and the drop-layer markers
//   (data-oscdisp on the oscillator display, data-noisepanel on NOISE); made = every panel built
//   oscData(kit): { tinfo, forget, lfoToWavetable, lfoToNoise, renderOscWarp, lfoShape, canRenderWarp } recording
//   calls = [[name, …args]]
import * as core from '../../serum-core.js?v=10';

export * from '../../sx-ui-osc.js?real';
export const __stub = true;
export const made = [];
export const calls = [];

const OSC_M = ['oscA', 'oscB', 'oscC'], OSC_P = ['a', 'b', 'c'], OSC_L = ['A', 'B', 'C'];
const FIELDS = m => ((core.MODULE_FIELDS[m] || { p: [] }).p).filter(id => core.DEST_INDEX[id] !== undefined && !(core.MATRIX_ONLY || []).includes(id));

function shell(kit, root, title, module, power) {
  const P = kit.panel(title, module, power, '', { collapse: true });   // as the real panels (C1)
  for (const id of FIELDS(module)) if (id !== power) P.body.appendChild(kit.knob(id, { label: id.slice(id.indexOf('.') + 1).toUpperCase(), size: 'sm' }).el);
  if (root) root.appendChild(P.el);
  return P;
}

export class OscPanel {
  constructor(root, kit, o) {
    this.kit = kit;
    this.o = o | 0;
    const P = shell(kit, null, 'OSC ' + OSC_L[this.o], OSC_M[this.o], OSC_P[this.o] + '.on');
    const cv = kit.canvas('', () => 'osc' + this.o, () => {});
    cv.el.setAttribute('data-oscdisp', String(this.o));
    P.body.insertBefore(cv.el, P.body.firstChild);
    const ed = kit.doc.createElement('button');
    ed.className = 'sx-hbtn';
    ed.setAttribute('aria-label', 'Open wavetable editor (OSC ' + OSC_L[this.o] + ')');
    ed.addEventListener('click', () => kit.openWtEditor(this.o));
    P.head.appendChild(ed);
    this.el = P.el;
    this.views = {};
    if (root) root.appendChild(this.el);
    made.push(this);
  }
  view() { return null; }
  destroy() { this.dead = true; }
}
export class SubPanel {
  constructor(root, kit) { this.kit = kit; this.el = shell(kit, root, 'SUB', 'sub', 's.on').el; made.push(this); }
}
export class NoisePanel {
  constructor(root, kit) {
    this.kit = kit;
    this.el = shell(kit, root, 'NOISE', 'noise', 'n.on').el;
    this.el.setAttribute('data-noisepanel', '1');
    made.push(this);
  }
}
export class FilterPanel {
  constructor(root, kit, k) {
    this.kit = kit;
    this.k = k ? 1 : 0;
    this.el = shell(kit, root, 'FILTER ' + (this.k + 1), this.k ? 'filter2' : 'filter', this.k ? 'f2.on' : 'f.on').el;
    made.push(this);
  }
}

const DATA = new WeakMap();
export function oscData(kit) {
  if (DATA.has(kit)) return DATA.get(kit);
  const D = {
    tinfo: o => { calls.push(['tinfo', o]); return { F: 256, R: 4, interp: 1 }; },
    forget: () => { calls.push(['forget']); },
    // as the real one: the new table and the switch to a wavetable oscillator in one edit, after the (asynchronous)
    // save; kit.host.wt.saveNew rejecting = a failed save (nothing changes)
    lfoToWavetable: (l, o) => {
      calls.push(['lfoToWavetable', l, o]);
      const W = kit.host.wt;
      return Promise.resolve(W && W.saveNew ? W.saveNew({ name: 'LFO ' + (l + 1), frames: [], morph: 0 }, 'LFO ' + (l + 1)) : 'user:new')
        .then(id => kit.edit(s => { s.osc[o].wt = id || 'user:new'; s.osc[o].type = 'wt'; }, 'LFO to wavetable'));
    },
    lfoToNoise: l => { calls.push(['lfoToNoise', l]); kit.edit(s => { s.noise.src = 'nzuser:new'; }, 'LFO to noise'); return Promise.resolve(); },
    renderOscWarp: o => { calls.push(['renderOscWarp', o]); kit.notify('Render OSC Warp needs the DSP'); return Promise.resolve(); },
    lfoShape: o => { calls.push(['lfoShape', o]); return [[0, 0.5, 0], [0.5, 1, 0], [1, 0.5, 0]]; },
    canRenderWarp: o => { calls.push(['canRenderWarp', o]); return true; },
  };
  DATA.set(kit, D);
  return D;
}
