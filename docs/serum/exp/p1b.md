
### 2.5 FX state schema — `defaultFx()` (every track, any model: `track.fx`)

```js
{
  v: 1,
  order: ['hyper', 'dist', 'flg', 'phs', 'cho', 'dly', 'cmp', 'rev', 'eq', 'fil'],   // processing order, top → bottom
  byp:   { hyper: 0, dist: 0, flg: 0, phs: 0, cho: 0, dly: 0, cmp: 0, rev: 0, eq: 0, fil: 0 },
  p:     { /* every FX-segment DEST id except 'g.master' (idx 120–204) → n; enables are 'fx.<m>.on' */ },
  dist:  { mode: 0, filt: 0, xa: [[0, 0, 0], [1, 1, 0]], xb: [[0, 0, 0], [1, 1, 0]] },
  flg:   { bpm: 0 },
  phs:   { bpm: 0 },
  cho:   { bpm: 0, mono: 0 },
  dly:   { bpm: 1, link: 0, mode: 0 },
  cmp:   { mb: 0 },
  rev:   { type: 1 },
  eq:    { typeL: 0, typeH: 0 },
  fil:   { type: 0 },
  hyper: { retrig: 0 },
  phase: [0, 0, 0, 0],
  lock:  0,
  ui:    { lvl: { hyper: 0, dim: 0, dist: 0, flg: 0, phs: 0, cho: 0, dly: 0, cmp: 0, rev: 0, fil: 0 }, sel: '' }
}
```

| Path | Type / range | Default | Meaning (inventory) |
|---|---|---|---|
| `order` | permutation of the 10 module ids | default order | rack order (inv A20.1) |
| `byp[m]` | 0/1 | 0 | temporary bypass = module power button (UI/preset state, not a DEST; inv A20.1) |
| `p['fx.<m>.on']` | 0/1 (bool law) | 0 | module enable (VST param, DEST; inv A20.1). `hyper` enable covers Hyper and Dimension. |
| `p[...]` other | [0,1] | DEST def | all FX knobs (§3.13 rows 120–204) |
| `dist.mode` | 0–15 | 0 Tube | inv A20.4.2 |
| `dist.filt` | 0–2 | 0 Off | OFF / PRE / POST filter switch |
| `dist.xa`, `dist.xb` | points (§2.3, no bus links) | linear | X-Shaper curves A/B (x = |input| 0…1 sym, or (input+1)/2 asym; y likewise) |
| `flg.bpm`, `phs.bpm`, `cho.bpm` | 0/1 | 0 | rate sync to `MODFX_LADDER` |
| `cho.mono` | 0/1 | 0 | chorus "mono" flag: L/R LFOs in phase (inv A20.3 chunk flag) |
| `dly.bpm` / `dly.link` / `dly.mode` | 0/1, 0/1, 0–2 | 1 / 0 / 0 | inv A20.4.6 |
| `cmp.mb` | 0/1 | 0 | MULTIBAND |
| `rev.type` | 0 Plate / 1 Hall | 1 | inv A20.4.8 |
| `eq.typeL` / `eq.typeH` | 0–2 | 0 / 0 | band types (§3.11) |
| `fil.type` | 0–95 | 0 MG Low 6 | FX filter type (inv A20.4.10) |
| `hyper.retrig` | 0/1 | 0 | Hyper RETRIG |
| `phase` | 4 numbers ∈ [0,1) | 0 | saved LFO phases of Hyper, Flanger, Phaser, Chorus (inv A20.1 phase memory) |
| `lock` | 0/1 | 0 | Lock FX Rack: `applyPreset` keeps the current FX state (inv A2.2) |
| `ui.lvl[k]` | 0/1 | 0 | knob shows MIX (0) or LEVEL (1) (inv A20.2 label toggle) — UI only |
| `ui.sel` | module id or `''` | `''` | rack scroll target — UI only |

`normalizeFx(fx)` fills missing keys, repairs `order` (drops unknown/duplicate ids, appends missing ones in default order), clamps values, snaps bool/int/enum laws, validates curves. Idempotent.

