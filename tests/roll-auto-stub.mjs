// The roll's automation host (IMPL-AUTO §5.2) as lane L builds against it — the §5.2 methods over an in-memory track.auto
// ({ [key]: { pts } }), every call logged; main.js (lane H1) provides the same names and shapes. Shared by
// tests/roll-auto.test.mjs (node, the fake DOM) and tests/ui-layout-roll-auto.mjs (Chrome for Testing). Not a test file.
//   autoLanes(t) → [{ key, short, long, inert }]   the track's automated keys (inert: no such control now)
//   autoPts(t, key) → [[tick, v], …]               sorted, one per tick ([] for none)
//   autoEdit(t, key, label, fn)                    fn(a mutable copy) → the new points; one History step ([] removes the key)
//   autoLabel(t, key) → { short, long }            autoFmt(t, key, v) → string     autoRange(t, key) → { lo, hi }
//   autoOkList(t) → [{ key, short, long, group }]  every automatable control, in the module order
//   autoLane(t) → key | 'vel'                      setAutoLane(t, key | 'vel')     (the chosen lane, per track, per session)
//   menu(items, x, y)                              the wk context menu's items ({ label, action, checked, disabled, sub, sep }),
//                                                  x / y client px (main.js: cvTray.popupMenu(x, y, items))
const db = v => (v <= 0 ? '−∞ dB' : (v => (v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + ' dB')(20 * Math.log10(v)));
// the controls of the stub's track (a classic's knob in panel units, an effect's n, the mixer)
export const KEYS = {
  'i1:cf': { short: 'Cutoff', long: 'Minimoog · Cutoff', group: 'Minimoog', lo: 0, hi: 10, fmt: v => v.toFixed(1) },
  'i1:em': { short: 'Emphasis', long: 'Minimoog · Emphasis', group: 'Minimoog', lo: 0, hi: 10, fmt: v => v.toFixed(1) },
  'fx1:fx.r1.size': { short: 'Size', long: 'Reverb 1 · Size', group: 'Reverb 1', lo: 0, hi: 1, fmt: v => Math.round(v * 100) + ' %' },
  'mix:vol': { short: 'Volume', long: 'Volume', group: 'Mixer', lo: 0, hi: 1.25, fmt: db },
  'mix:pan': { short: 'Pan', long: 'Pan', group: 'Mixer', lo: -1, hi: 1, fmt: v => (Math.abs(v) < 0.005 ? 'C' : (v < 0 ? 'L ' : 'R ') + Math.round(Math.abs(v) * 100)) },
};
export function autoHost(o = {}) {
  const log = [], menus = [], lanes = new Map(), K = o.keys || KEYS;
  const P = (t, key) => (t && t.auto && t.auto[key] && Array.isArray(t.auto[key].pts) ? t.auto[key].pts : []);
  const H = {
    log, menus, lanes,
    autoLanes: t => Object.keys((t && t.auto) || {}).map(key => (K[key] ? { key, short: K[key].short, long: K[key].long, inert: false } : { key, short: key, long: key, inert: true })),
    autoPts: (t, key) => P(t, key),
    autoEdit: (t, key, label, fn) => {
      const out = fn(P(t, key).map(p => p.slice()));
      log.push({ op: 'edit', t: t.id, key, label, pts: JSON.parse(JSON.stringify(out)) });
      if (!Array.isArray(out) || !out.length) { if (t.auto) { delete t.auto[key]; if (!Object.keys(t.auto).length) delete t.auto; } return; }
      (t.auto || (t.auto = {}))[key] = { pts: out.map(p => [p[0], p[1]]) };
    },
    autoLabel: (t, key) => (K[key] ? { short: K[key].short, long: K[key].long } : { short: key, long: key }),
    autoFmt: (t, key, v) => (K[key] ? K[key].fmt(v) : String(v)),
    autoRange: (t, key) => (K[key] ? { lo: K[key].lo, hi: K[key].hi } : null),
    autoOkList: () => Object.entries(K).map(([key, e]) => ({ key, short: e.short, long: e.long, group: e.group })),
    autoLane: t => lanes.get(t.id) || 'vel',
    setAutoLane: (t, key) => { log.push({ op: 'lane', t: t.id, key }); lanes.set(t.id, key); },
    menu: (items, x, y) => { menus.push({ items, x, y }); if (o.menu) o.menu(items, x, y); },
  };
  return H;
}
// a menu's items as plain data (labels, flags, subs) — never the item objects themselves into assert
export const menuData = items => items.map(it => (it.sep ? '—' : { label: it.label, checked: it.checked, disabled: !!it.disabled, sub: it.sub ? menuData(it.sub) : undefined }));
