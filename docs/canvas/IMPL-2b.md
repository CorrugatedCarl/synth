# Stage 2b: modulation everywhere (IMPL-2b) — contract

What stage 2b builds, the lane split and the rules. Design: [SPEC-canvas.md](SPEC-canvas.md) §2.10 (modulator modules), §7.1–7.11
(universal modulation: model, addressing, sources, destinations, the source × destination table, ModCore, the Serum / classic / FX
adapters, performance controls, the mod layer and halos), §9.2 (audio budgets), §10 2b; [ROADMAP.md](ROADMAP.md) wins where they
differ. What exists: [IMPL-2a.md](IMPL-2a.md) (rows in `track.mods`, injection into free Serum slots, the mod layer, the four
performance modules, the project Mod Wheel) and the maps in the lead's scratchpad (`maps/engine-map-2b.md`, `maps/host-map-2b.md`,
cited below as EM §n / HM §n). **This is an engine stage**: `engine.js`, `sx-mod.js`, `serum-dsp.js`, `serum-core.js` change; the
goldens guard every path that carries no modulation. Sections 1–6 are the contract, §7 the lanes, §8 the gates, §9 the builders' notes.

**Invariants of the stage**
- **N1 Neutral**: a project with no `track.mods` rows and no modulator module compiles, posts and renders the same bytes as today
  (every golden shard, `canonical-stream`, the cp2 / ct2 fixtures, `bench` rows bit-for-bit). No `{t:'mods'}` message → no ModCore
  object, no adapter work, no `mod-core.js` code on the audio path.
- **N2 Ext cross-check**: a GLOBAL LFO in a track LFO module cabled through an `ext` source to a Serum knob renders bit-identically
  to the same LFO defined inside that Serum as a MONO LFO with an ordinary row (same code, same clock, 4-base-frame chunks).
- **N3 Classic oracle**: a GLOBAL LFO on a classic `sm` knob matches an oracle that sets the slot target per span through
  `smTargets` within 1e-9; a noise-level cable from 0 produces noise; a fade-out during modulation keeps the modulated level
  (SPEC §7.8 cross-checks).
- **N4 Budgets** (SPEC §9.2): ModCore with 10 GLOBAL LFOs + the pseudo-voice + 16 cables ≤ 0.002 load per track on the M4 Max;
  classic tier-1 offsets with one cutoff cable ≤ 8 % on an 8-voice classic row; `apply` / `proc` setters ≤ 1 µs per cabled control
  per span per active voice; no allocation on the audio thread in render paths; the existing V8 / JSC rows within their gates.
- **N5 Determinism**: two Tracks given the same frames and the same `{t:'mods'}` produce identical ModCore source values (LFO
  phases are functions of the frame clock and the transport, never of wall time).

## 1. Vocabulary and data

### 1.1 Modulator modules (devices in `track.dev`, `kind` → id prefix)

| kind | id | per track | state on the device (plain data, `song.normDev` keeps it) | jacks |
|---|---|---|---|---|
| `lfo` | `l<n>` | any (≤ 10 evaluated: §2.3) | `{ kind, lfo: <serum-core normLfo shape> }` — `lfo.mono: 1` = **GLOBAL** (the badge; one wave for everything, evaluated by ModCore as a processor LFO), `0` = **PER NOTE** (restarts per note; `lfo.mode` retrig / env / free as Serum's) | `out` |
| `env` | `e<n>` | any (≤ 3 evaluated) | `{ kind, env: <serum-core ENV shape (a, h, d, s, r, curves…)> }` — per note | `out` |
| `macro` | `m<n>` | any (≤ 1 evaluated as 8 macro sources; a second module's knobs are **CC-like values** through ModCore's value table, §2.3) | `{ kind, v: [8 × 0…1], names: [8 strings ≤ 16] }` | `k1`…`k8` |
| `cc` | `c<n>` | any | `{ kind, cc: 0…127, ch: 0 (omni) \| 1…16, v: 0…1 (last) }` | `out` |
| `chaos` | `h<n>` | ≤ 2 evaluated | `{ kind, chaos: <serum-core chaos shape (rate, smooth…)> }` | `out` |
| `note` | `nt` | one | `{ kind }` — key tracking (per note, constant) | `out` |
| (2a) `velo` `ve`, `at` `at`, `bend` `bd`, project `wheel` | | | unchanged | `out` |

Ids: `<prefix><n>` with `n` = max existing of that prefix + 1 (ids of removed modules may be reused: their rows are dropped with
them). Source ids in rows: `'<devId>.out'` and, for a macro, `'<devId>.k<1–8>'`. `song.normMods`' `MSRC` already admits both; its
`MAUX` stays (a canvas aux is not in 2b); `cv-migrate.splitTracks.rowsTo` admits any port (HM §3). `cv-graph.MOD_KINDS` gains
`chaos`; `cv-module.MOD_ORDER` gains the kinds in Tidy order `wheel, ve, at, bd, nt, lfo…, env…, macro…, cc…, chaos…`.

### 1.2 Destinations (`<devId>:<paramId>`) — what opens

| destination | class (cv-mods `classOf`) | mechanism | stage |
|---|---|---|---|
| Serum knob, a Serum's own FX knob | — | as 2a for native sources; **`ext` rows** for ModCore globals; **slot injection** for per-note sources (§3.3) | 2b |
| shared-panel knob (`fx<n>:fx.<inst>.<pid>`) | — | ModCore row → the Chain's `setMods` vector (§4) | 2b |
| classic `sm` | 129 | ModCore row → slot offset on the Inst (§5.1) | 2b |
| classic `apply` / `proc` | 70 / 37 | ModCore row → the Inst's span setter (§5.2) | 2b |
| classic `chunk` | 180 | refused "…from stage 5" (`destOk` → `{ ok: false, stage: '5' }`) | 5 |
| classic `struct` / `none` | 7 / 2 | `nomod` (as today) | never |

`cv-mods.destOk(dev, id)` opens `sm` / `apply` / `proc` and panel knobs; `cv-mods.descs(dev)` returns classic descriptors with `law`
/ `lo` / `hi` / `def` / `fmt` from `models.js` and `cls`; `rackDescs` for a panel reads its `fx` (1c panels hold `fx`). The spec's
proc 38 / chunk 179 is corrected to the checked-in table's 37 / 180 (the CS-80 ring-mod speed is `chunk`); ROADMAP's "237" stays
(129 + 70 + 37 = 236; the ROADMAP row is updated to 236).

### 1.3 Rows

Unchanged shape (IMPL-2a §1; every `normRow` field). New: `dashed` is **derived**, never stored: a per-note source (`ve`, `nt`, PER
NOTE `lfo`, `env`, a linked POLY Serum LFO / ENV) on a non-Serum destination, or on a Serum destination when the injection fell back
to `ext` (§3.3), draws dashed ("follows the most recent note"). `aux` stays a Serum-native source id (or `''`).

### 1.4 Project format

`SCHEMA = 6`, `STEPS[5]` additive (new device kinds and their state; nothing renamed). `song.normDev` keeps the state fields above
through `plain` with these bounds: an `lfo` / `env` / `chaos` object normalised by serum-core's own normalisers (`normLfo` etc. —
export them if not yet), `v` arrays clamped 0…1, `cc` 0…127, `ch` 0…16, names ≤ 16 chars. `toV1` names the modules
(`MOD_LABEL` grows: LFO, ENV, Macro, CC, Chaos, Note). `History` snapshots carry everything (per-track JSON).

## 2. ModCore (`mod-core.js`, new classic worklet script loaded before `engine.js` — lane A1)

### 2.1 Shape

```
globalThis.ModCore = { create(T, base) → MC, NEXT: 16 }
MC.setRows(m)                 // m = the {t:'mods'} payload (§2.2); replaces everything; allocation allowed here (between quanta)
MC.noteOn(n, v01, held, ch) / MC.noteOff(n, held)   // from Track.noteOn/noteOff for every note that reaches a powered Inst:
                              // legato when other keys are held; noteOff when the last held note is released (SPEC §7.6)
MC.ctl(k, v)                  // macro / CC values: k = the value-table index (§2.3), v 0…1 — no recompile
MC.transport(playing)         // re-seeding, as SxMod.transport
MC.span(F, n, nCh)            // once per Track span BEFORE any Inst renders: evaluates every source for nCh chunks and the rows;
                              // fills MC.ext (Float64Array(16·32): ext k, chunk c at [k·32 + c]), MC.cls[instId] (Float64Array(S_N),
                              // the span-end offset per slot, in slot units), MC.setv[instId] ([{ field, v }] effective values of
                              // cabled apply/proc fields, span-stepped), MC.fxv[chainId] (Float64Array(NFX) per cabled chain)
MC.stats() → { lfos, envs, rows, ext, us (last span µs) }
```

Implementation per SPEC §7.6 and the spike (§9.0): a `SerumDSP.attach`-ed Serum state on a **shim** (`voices = []`, `OS = 1`,
`CH = 4`, `fs = base`, `wheel` / `at` / `bendRaw` read from the Track's new fields (§2.4), `tp` / `songBeat()` / `bpm` forwarded,
`seedSalt` from the track id) driven by a **synthetic Serum CP** compiled by the host (§3.1): its processor LFOs (`mono: 1`,
≤ 10), ENV 2–4, chaos 1–2, macros 1–8 are the track's modules; `SxMod.begin(shim, sx, nCh)` fills `g[src·32 + c]`. The
**pseudo-voice** is one `SxMod.ModV` on a shim voice (the `TV` shape of tests/sx-mod.test.mjs; no amp output; the CP synced with
`SxMod.sync` + `syncCT` before its first note-on): `noteOn` (serum-dsp's note-on prologue: `sx.alt`, `r/r2` seeding; legato when
other keys are held) / `noteOff` (when the last held key lifts) from the Track's notes; **ModCore drives its chunk loop itself**
(`follow / sources / matrix / advance` per chunk, whatever the lifetime rule says) so it evaluates PER NOTE LFOs and ENVs while
gated and the global rows always; `recentMod` supplies velocity / note / random for "most recent note" rows. **Unreferenced
sources are not evaluated by SxMod** (spike §9.0 Q3): the compile gives every used source a **keep-alive row** to a scratch
V-scope destination, and **parks unused LFO slots FREE + MONO** (−25 % cost). **Rows** that target classic slots, span setters and
chains are **synthetic rows of the same CP** (`src → own scratch V-scope destination vi`, with the cable's curve / slew / aux /
bipolar), evaluated by the pseudo-voice's `matrix()` (the full SPEC-serum2 §5.2 formula incl. CT curve tables) and read back from
`V.mod.off[vi]` at chunk 0 (span start) and chunk nCh−1 (span end) — no second evaluator; `matrix()` may run at those two chunks
only when every target is span-rate. Nothing allocates in `span` (`noAlloc` test); `setRows` builds everything (≈ 0.4 MB per
track at attach: the `sx` state, the CT store, the pseudo-voice).

### 2.2 Protocol (`Track.msg`, EM §6)

- `{t:'mods', i?: trackId, cp, ct, rows, xfer, ext, vals, keep}`:
  - `cp` / `ct`: the synthetic Serum CP and its CT (as a `{t:'patch'}` + `{t:'ct'}` pair carries them for a Serum; `ct` may be
    `null` when unchanged by key);
  - `rows`: `[{ id, src: <ModCore source index>, dst: { kind: 'cls' | 'set' | 'fx', inst?: instId, chain?: chainId, slot?: S_*,
    field?: 'lfo.rate', fx?: flat index }, amt, bi, curve, crv?: ctKey, aux, inv, rise, fall, byp, out, perNote: bool }]`;
  - `xfer`: per classic row the transfer from knob space to slot units (§5.3): `{ a, b }` (linear) or a 129-point table;
  - `ext`: `[{ k: 1…16, src: <ModCore source index> }]` — which ModCore sources feed which ext slot (shared by every Serum of the track);
  - `vals`: the value table's initial values (macros, CCs);
  - `keep`: `[sourceIndex]` keep-alive list.
  No message → `T.mc = null`. An empty payload (`rows` and `ext` empty, no modules) → `T.mc = null` too (N1: a project whose modules
  were all deleted posts `{t:'mods', off: true}`).
- `{t:'mval', k, v}`: one value of the table (a macro knob turned, a CC received) — applied at the next span, smoothed as Serum
  smooths macros (SPEC §7.3: per span, interpolated per chunk).
- `processorOptions.mods` for offline bounces (the same payload), handled after `po.graph` / `patches`.

### 2.3 Capacity and the value table

10 LFO slots (GLOBAL, PER NOTE and linked together), 4 ENV slots (ENV 2–4, then ENV 1 — its sustain law is n², Start / End 0; the lifetime uses `envsIdle()`), 2 chaos, 8 macros per track for non-Serum targets
and `ext`. Beyond that a module still exists but its cables are **not compiled** ("ModCore slots full: 10/10 LFOs" in the
inspector / Mod list / badge, like 2a's "not compiled: matrix full"). The **value table** (`MC.ctl(k, v)`) holds 32 entries: 8
macros (k 0–7, the first macro module's knobs) and 24 "value sources" (k 8–31: CC modules and any further macro module's knobs),
each a ModCore source read as a smoothed global like a macro.

### 2.4 Track integration (`engine.js`, lane A1 owns `Track`, `Chain`, the Serum ext hand-off)

- `Track` gains `wheel`, `at`, `bendRaw` fields written wherever the broadcast and the song cc lanes write them into Insts (EM §6;
  the Facade keeps exposing i0's).
- `Track.noteOn` / `noteOff` call `MC.noteOn / noteOff` after the zone fan-out when `this.mc` and at least one powered Inst took the
  note; `transportHook` → `MC.transport`.
- In `spanG` (and the legacy shape's `renderSpan`), **before any Inst renders**: `if (this.mc) this.mc.span(F, n, nCh)`; then per
  Inst: a Serum Inst gets the ext chunk values copied into its `sx.g` ext rows before `SD.begin` (`SD.extIn(inst, MC.ext, nCh)`,
  §3.2); a classic Inst gets `MC.cls[id]` / `MC.setv[id]` applied by its adapter (§5, lane A2's `Inst.modSpan(off, setv)` called
  by the Track right before `I.renderSpan(n)`); each cabled `Chain` gets `r.setMods(MC.fxv[c.id], c.key)` in `chainSpan` before
  `r.process` (EM §1, :3502). A Serum's own FX (its `renderSerum` path) sums the Serum's `fxMods` vector and ModCore's per-row
  contribution for rows targeting that FX **only when such rows exist** (else the call stays `rack.setMods(SD.fxMods(this), key)`
  byte-for-byte).
- Dying Insts, powered-off Insts: no adapter work (`MC.cls` for them unused).
- `postMon` adds, for a classic Inst with cables, a small snapshot `s: { eff: Float32Array(n) }` of its modulated slot and setter
  values in knob units (the inverse transfer, §5.3) so halos can show the live value (SPEC §7.11); none without cables.

## 3. Compile and the Serum adapter (lane B owns `cv-graph.js`, `cv-mods.js`, `cv-model.js`, `song.js`, `cv-migrate.js`, `main.js`'s
`buildMods` / `modVals` / `buildInstPatch` / `buildChain`; lane A1 owns `serum-core.js` SOURCES / compile changes and `sx-mod.js` /
`serum-dsp.js`)

### 3.1 `compileMods(t, project) → payload | null` (`cv-graph.js`, pure)

1. **Sources** of the track: the modules (§1.1) in id order; assign ModCore slots: LFOs → processor LFO slots 1…10 (GLOBAL as
   `mono: 1`; PER NOTE as `mono: 0` evaluated by the pseudo-voice), ENVs → ENV 2…4, chaos → 1…2, the first macro module → macros
   1…8, further macro knobs and CCs → value-table entries 8…31; `ve` / `nt` → the pseudo-voice's velo / note; `wheel` / `at` / `bd`
   → the shim's wheel / at / bend. **Linked Serum modulators** (§7.7.5): a row whose `src` is `'<serumDev>/lfo<k>.out'` or
   `'<serumDev>/env<k>.out'` copies that LFO's / ENV's state from the Serum's `vals.s` into a free ModCore slot (dedup per source).
   Over capacity → the row is `left` with reason `'slots'`.
2. **The synthetic Serum state**: `normalizeSerum` of a default state with the slots above filled (voice section off: no oscillators,
   `voices: 1`), compiled with `compileSerum(sy, { bpm, smooth, fx: null, qr, ultra })` + `buildSerumT` → `cp`, `ct`. Keep-alive rows:
   one row per evaluated source to a scratch destination (`g.master` with `amt: 0`? — the spike says whether SxMod evaluates
   unreferenced LFOs; if it does, no keep-alive rows).
3. **Rows by destination**:
   - Serum knob / own-FX knob, ModCore global source → an **ext row**: allocate an ext slot `k` for that source (≤ 16 per track;
     over → `left` `'ext'`), the row becomes `{ src: 'ext<k>', dst, … }` injected by `injectMods` into that Serum's free matrix slot
     (2a's placement, hints, budget);
   - Serum knob, PER NOTE source (`lfo` mono 0, `env`, linked POLY) → **slot injection** (§3.3): a free LFO / ENV slot in a copy of
     that Serum's `vals.s` receives the module's state and the row uses the native source (`lfo<k>` / `env<k>`); no free slot → the
     ext fallback (dashed, inspector says "Serum 1 has no free LFO slot: follows the most recent note");
   - Serum knob, native performance source → as 2a (`nativeRow`);
   - shared panel, classic `sm` / `apply` / `proc` → a ModCore row (`dst.kind` `'fx'` / `'cls'` / `'set'`), per-note sources through
     the pseudo-voice (`perNote: true`, dashed).
4. `xfer` per classic row (§5.3), `vals`, `ext`, `keep`. Returns `null` when the track has no modules and no rows (N1).

`injectMods(dev, rows, ext)` keeps its identity rule. `modBudget(t, dev)` adds `slots: { lfo: n/10, env: n/3, ext: n/16 }` and the
`left` reasons. `main.js` posts `{t:'mods'}` from `queuePatch` whenever `compileMods` output's key changes (a content key, so knob
turns on instruments never repost it); macro knob turns and CC input post `{t:'mval'}` directly.

### 3.2 Ext sources (`serum-core.js`, `sx-mod.js`, `serum-dsp.js` — lane A1)

- **`serum-core.SOURCES` stays at 62** (no fixture churn: `cpKey`, `srcUsed`, `srcBi` and every compiled fixture are untouched).
  `compileSerum(s, ctx)` gains `ctx.ext: true`: `compileCore` then accepts row sources `ext1…ext16` as indices `S_EXT0 + k − 1`
  (`S_EXT0 = 62`, a new name — `engine.js` `S_EXT` is the classic ext-input slot), sets `use |= 32768` (the next free bit after
  `s1`) and does not mark `srcUsed` for them; without `ctx.ext` (every path today) an `extK` id is rejected as any unknown id.
  `normRow` / `song.normMods` keep rejecting `extK` in stored rows: ext ids exist only in the **injected copy** of the matrix (§3.3).
- DSP constants grow to 78: `sx-mod.js` `NSRC` (the `g`, `srcUsed`, `srcBi`, `monoSrc`, `ModV.src` sizes and the `si < NSRC`
  test in `sync`), `sx-base.js` `NSRC` + `ext1…ext16` appended to `SRC_IDS2` (unipolar), `serum-dsp.js` `NSRC2`; an `extOn` flag on
  the ModState from `CP.use & 32768`; the two copy loops `if (m.extOn !== 0) for (k = 62; k < 78; k++) s[k] = g[k·32 + gc]` in
  `ModV.sources` and `ModV.noteOn` (spike §9.0 Q5: with NSRC 78 every existing CP renders bit-identically; an ext row works in the
  mono and FX contexts with no other change). Two tests pin the constants (`sx-mod.test.mjs:63`, `sx-base.test.mjs:136`) — update.
- The hand-off (`SD.extIn(inst, ext, nCh)` or inline in the Track): once per span per powered Serum Inst whose CP has
  `use & 32768`: `inst.sx.g.set(MC.ext, 62·32)` (4 KB) and `inst.sx.mod.monoSrc[62 + k] = ext[k·32 + nCh − 1]`, before its
  `SD.begin` (the chunk grids line up: Inst nCh = n/4 = ModCore's; Track spans are multiples of 4). Serum's own matrix page shows an
  injected ext row's source as "Ext k (canvas)" (a label hook; the Serum's own source menus never offer ext).
- N2 is the gate: the same LFO as a track module through `ext` and as the Serum's own MONO LFO row → identical renders.

### 3.3 Per-note injection into Serum slots

`injectMods` (lane B) extends 2a: for a PER NOTE row, a free `s.lfo[k]` (`k` ≤ 10) or `s.env[k]` (k 2–4) of a copy of the Serum's
`vals.s` receives the module's state (`normLfo` / the ENV shape, `mono: 0`) and the row's `src` becomes `lfo<k>` / `env<k>`; the slot
hint map keeps the slot stable while free. The Serum's own UI shows the injected LFO on that slot's page with a "canvas: LFO 2
(module)" tag (read-only there; `sxHost.extraRows` already tags canvas rows). Loading a preset that uses the slot bumps the row to
another free slot or to the ext fallback at the next compile (notice as 2a's "not compiled").

## 4. The FX adapter (lane A1 engine side; lane B compile side)

ModCore rows with `dst.kind 'fx'` are evaluated into a per-chain FX-context vector (`fx-core.fxLayout` indices; `NFX = 8 + NP` of
that chain's current `{t:'chain'}` layout, key-checked) delivered with `FXRack.setMods(vec, key)` before `process` (EM §5: clamped
±2, linear ramp across the span, 16-sample re-evaluation). A Serum's own FX targeted by a ModCore source: the Track sums ModCore's
contribution into a copy of `SD.fxMods(inst)` only for that Inst and only while such rows exist.

## 5. The classic adapter (`engine.js` `Inst` — lane A2; `cv-mods.js` transfer maths — lane A2)

### 5.1 Tier 1: slot offsets (`sm`, SPEC §7.8 mechanism, EM §1 lines)

`Inst.modSpan(off, setv)` (called by the Track right before `renderSpan`; `off` = `MC.cls[id]`, span-end offsets in slot units, or
null): the Inst keeps `moEnd` (this span's end offsets) and `moPrev` (last span's), `moSlots` (the cabled slot indices, from
`setRows`), `moU` (Float64Array(S_N) saved values). Then, inside `renderSpan` after `smStep(n)` (:2452):
1. for each cabled slot `i`: `moU[i] = b[i]; a[i] += moPrev[i]; b[i] += moEnd[i]; d[i] = b[i] − a[i]`; `smMv = true`;
2. voices render reading the modulated `SA` / `SD` / `SB` (so `needNoise` :577 and the sync start :568 see them);
3. after chorus / ensemble (:2486): `b[i] = moU[i]` **by copy**, so `smStep`'s exact-settle test and `smTargets`' range-switch test
   see today's numbers; `moPrev = moEnd` (swap, no allocation);
4. `fadeOut` (:1880): right after `this.smA.set(this.smB)` add `moEnd` to the cabled slots (one guarded line) so de-click tails keep
   the modulated timbre.
`smTargets`' `o.on ? o.lev : 0` stays: the level of a switched-off oscillator is `nomod` for 2b ("Switch the oscillator on to
modulate its level" — `cv-mods.destOk` checks the live patch for `osc[k].on`). With no cables nothing of this runs (`moSlots`
empty → `modSpan` returns at once; the voice code is untouched: `v8-guard` clean).

### 5.2 Span setters (`apply`, `proc`)

`setv` = `[{ field, v }]` effective values (knob law applied by the host's transfer, §5.3) for cabled `apply` / `proc` fields. The
Inst keeps a **base** of each cabled field read from `this.p` at `setPatch` (`moBase[field]`), writes `this.p.<field> = v` for `proc`
fields read per span / chunk by the Inst or its voices (`lfo.rate`, `lfo.wave`, `glide`, `bendRange` → `bend = bendRaw·v`,
`unisonDetune` → `v.det` re-target of sounding notes as `setPatch` does :1684, `bw` → `recalc()`, `reg.*` / `attack` / `release` /
`tone`, `dac`, …: the full `FIELD_CLASS` proc list), and for `apply` fields (`aenv.*`, `fenv.*`, `envOv`, `vcf.*` character,
`hpf.*`, `dual.*`, `tb.*`, `fenvIL.*`) writes `this.p.<field> = v` and calls, for **active voices only**, the narrowest existing
setter: `Env.set` / `setDecay` for envelope fields, `cfgLP` / `setRes` / the SVF / SK setters for filter character, nothing for
fields read per chunk straight from `p` (`tb.accent` …). A setter runs only when the value **quantised to 1/512 of the knob's range**
changed (so a slow LFO costs a handful of calls per second; N4's ≤ 1 µs is per call per voice amortised). When a row is removed
(the next `setRows`) the base is written back. `setPatch` refreshes `moBase` from the new patch.

### 5.3 Transfer tables (`cv-mods.js`, pure — lane A2)

`xferOf(model, vals, ctlId) → { a, b } | { tab: Float64Array(129) }`: the knob's modulation space 0…1 (a unipolar offset `x` of the
row formula, in knob units of `[min, max]`) mapped to slot units by sweeping `models.js` `map()` over the cabled knob with the other
knobs at their current values (129 points); when the sweep is linear within 1e-9 two coefficients are kept, else the table (the
engine interpolates). Exact for the many knobs whose law is linear; bounded error documented for the others (test). The inverse
(`slot → knob units`) feeds the classic `eff` snapshot (§2.4). `xfer` is recomputed when the cabled knob's neighbours change
(`compileMods` key includes the instrument's `vals` hash for cabled instruments only).

## 6. UI (lane C owns `cv-mods-ui.js`, `cv-module.js`, `cv-cables.js`, `cv-tray.js`, `classic-panel.js`, `cv-panel.js` halos,
`style.css`, `index.html`; lane D owns `main.js`, `cv-modlayer.js`, page sims)

### 6.1 Modules (lane C)

- `cv-mods-ui.bodyFor(kind, o)` gains: **`lfoBody`** (the badge GLOBAL / PER NOTE toggling `lfo.mono`; Serum's LFO parameters: mode
  retrig / env / free, rate with BPM sync and the same divisions as Serum (`serum-core` tables), shape: Serum's shape presets and a
  point editor — reuse `serum-ui`'s pure LFO drawing / shape helpers where they are exported; the large LFO editor stays milestone 3's
  extraction); **`envBody`** (A / H / D / S / R sliders with curve, an ADSR display); **`macroBody`** (8 `wk.knob`s with editable
  names, each a jack `k1…k8` on the right edge at the knob's row); **`ccBody`** (CC number box, channel, "Learn" (the host arms MIDI
  learn), a value meter); **`chaosBody`** (rate, smoothing, a scope of the value); **`noteBody`** (a keyboard meter of the last
  note). Bodies edit state through `o.edit(fields)` (one History step per gesture end, the 2a `modPre` / `modStep` glue) and show
  live values through `update(v)`. `MOD_H` per kind; `W_MOD` 240 (a macro module 240 wide, 8 rows of 28 px).
- `cv-module`: `devicesOf` lists every `kind` in `MOD_KINDS` (no hard-coded list); jacks per kind (`k1…k8` for a macro, at the knob
  rows: `port()` pure from `w` / row index); colours per kind (`MOD_COLOR`); Tidy order as §1.1.
- `cv-cables`: `modSrcKey` resolves `'<id>.<port>'`; `MOD_KEY` by kind prefix not fixed ids; `dashed(row)` from the host (§1.3); a
  cable from a macro's `k3` leaves at that jack.
- Sources tray: tiles LFO, ENV, Macro, CC, Chaos, Note in the Serum view's Modulators section (original glyphs); multi-instance tiles
  never grey out; the "notes" placeholder text updates ("Note tools: later").

### 6.2 Classic knobs: halos and the mod menu (lane C, `classic-panel.js` + `cv-panel.js`)

- Every classic control already carries `data-dest` (HM §7); the `seq:` / `dx:` widgets get it too where their class allows.
- **Halos**: a `haloArcs`-style ring per modulated knob (an absolutely positioned SVG arc in the knob's wrap, Serum's colours by
  source kind, the `wk-live` dot) drawn from the rows (`host.rowsOf(dev)` → ranges in knob units through the descriptor's law) and the
  live value from the classic `eff` snapshot (§2.4) at the monitor rate; sliders get a range bar; toggles / selectors a badge. Painted
  only for mounted, on-screen modules (the world's `onScreen`).
- **Press-and-hold mod menu** on classic knobs (SPEC §2 "classic knobs gain the same menu"): a 500 ms long-press (touch) / right-click
  (mouse) opens a `wk` menu with the knob's canvas rows (Bypass / Disconnect per row, "Connect to…" → the source list), Reset Control,
  Enter Value…, Lock (as today's classic knob menu items if any). The 1g / 1h `data-tip` hit-test is unaffected.

### 6.3 Mod layer and host (lane D, `cv-modlayer.js` + `main.js`)

- Inspector: a **Curve: Custom…** entry opening the Serum custom-curve editor for `crv` (serum-ui's `openCurve` through a host hook
  on a scratch row; the result stored on the row); "Save with preset" stays native-sources-only; the header shows the ModCore slot
  budgets ("LFO 3/10 · ENV 1/3 · ext 2/16") on non-Serum rows; `left` reasons `'slots'` / `'ext'` / `'full'` / `'nomod'`.
- Parameter list: classic descriptors grouped by the model's sections (`models.js` `sections`), panels by effect instance; `chunk`
  knobs listed greyed "stage 5".
- `main.js`: `modAdd(kind, at)` generic (ids §1.1, initial state from serum-core defaults, `lay` at the drop / `modSpot`);
  `modDelete` for any kind; `cvDevices` lists every mod kind; `buildMods(t)` → `compileMods` → `{t:'mods'}` posted from
  `queuePatch`'s path for the track (content-keyed) and in `processorOptions` for bounces; `{t:'mval'}` from macro bodies and the MIDI
  router (`midi.js` CC → the track's CC modules: `H.modCC(ch, cc, v)`; CC learn arms the next CC for a module); `modMarks` lights
  classic and panel knobs; `modDests` opens the list for any device; `setTrackModel` keeps rows whose destination survives (same
  param id on the new model) and drops the rest with the notice; the classic `eff` snapshot subscription for mounted classic panels
  with cables (`monitors.sub`); `cvBadge` shows "mods n/64" on Serums and "mods n" on classic / panels with the ModCore budgets; the
  2a accessors / primary-only paths **stay** (IMPL-2a §8.1: milestone 3).
- Page sims (`tests/canvas-2b-sim.test.mjs`): an LFO tile drop adds `l1` with Serum's default LFO state; its badge toggles mono; a
  drag from `l1.out` to a Serum knob posts a patch whose matrix holds an `ext1` row and a `{t:'mods'}` with `ext: [{k:1, src}]`; the
  same drag to a Juno cutoff posts a `{t:'mods'}` row of kind `cls` with `xfer`; to a panel knob a `fx` row; a PER NOTE LFO to a
  Serum knob injects into `s.lfo[k]`; a macro knob turn posts `{t:'mval'}` and no patch; deleting the module drops its rows and
  posts `{t:'mods', off: true}` when nothing is left; undo / redo; the Mod list and inspector budgets; refusals (chunk → stage 5,
  nomod); the classic halo DOM appears and follows a snapshot.

## 7. Lanes, ownership, order

| lane | owns | must not touch |
|---|---|---|
| A1 engine core | `mod-core.js` (new), `engine.js` **Track / Chain / Facade / protocol / postMon** regions, `sx-mod.js`, `serum-dsp.js`, `serum-core.js` (SOURCES, NSRC-sized compile products, menus), `tests/modcore.test.mjs` (new), `tests/golden-*` additions (ext cross-check), `tests/bench-scenarios.mjs` + `bench.json` rows `mc` (ModCore) and `me` (ext), `tests/dsp-scope.mjs`, `tests/golden-harness.mjs` DSP lists, `main.js` `DSP_FILES` + `wk.js` `DSP_GLOBALS` + `smprender.js` / `cv-cost.js` DSP lists (the file list only) | `engine.js` `Inst` methods (A2), cv-*.js (B/C/D) |
| A2 classic adapter | `engine.js` **`Inst`** (`modSpan`, `moBase` …, `fadeOut` line, `setPatch` base refresh, the classic `eff` snapshot values), `cv-mods.js` `xferOf` / inverse (pure), `tests/classic-mod.test.mjs` (new: N3 oracle, noise-from-zero, fade-out, setters quantisation), bench rows `mk` (8-voice classic + cutoff cable) and `ms` (setters) | everything else |
| B compile / data | `cv-graph.js` (`compileMods`, `injectMods` ext + per-note + linking, budgets, keys), `cv-mods.js` (everything but `xferOf`), `cv-model.js` (add / remove / setModState for every kind, row validation for every source, defaults for classic / panel drops), `song.js`, `cv-migrate.js`, `main.js` `buildMods` / `modVals` / `buildInstPatch` / `buildChain` only, `tests/cv-graph`, `cv-mods`, `cv-migrate`, `cv-model` tests, fixtures | engine files, UI files |
| C modules + classic knobs | `cv-mods-ui.js`, `cv-module.js`, `cv-cables.js`, `cv-tray.js`, `classic-panel.js`, `cv-panel.js` (halo attach only), `style.css`, `index.html`, their tests | `main.js`, `cv-modlayer.js`, engine, compile |
| D integration | `main.js` (all but B's four functions and A1's list), `cv-modlayer.js`, `midi.js` (CC routing), `tests/canvas-2b-sim.test.mjs`, `tests/main`, `midi` tests; starts when A1, A2, B, C have reported (phase 2) | — |

Base: canvas `3042fcb` (+ this contract's commit). Every builder: `git reset --hard <base>` first (harness worktrees start from
`main`), `?v=9` on every import, `import './v8-guard.mjs'` first in new test files, no fake-DOM nodes in `assert.*`, one test file at
a time with `node --max-old-space-size=2048 --test tests/<file>.test.mjs`, dense comments in the existing voice, commit on the
worktree branch, report with the commit hash and the gates measured. Interfaces between lanes are **exactly** the signatures in
§2.1, §2.2, §2.4 (`Inst.modSpan(off, setv)`, `SD.extIn`), §3.1 (`compileMods` payload), §5.3 (`xferOf`), §6; each lane stubs the
other side in its tests. Order: A1, A2, B, C in parallel; the integrator merges A1 → A2 → B → C, runs the fixture check (a page sim
compiling one track with an LFO on a Serum knob, a Juno cutoff and a panel knob against the real engine in the golden harness), then
D; then the review round (engine reviewer with the golden harness and the oracles; compile / data reviewer; UI reviewer in headless
Chrome; memory / perf reviewer with the bench rows), fixers failing-first, the sweep, docs, deploy, the V8 / JSC gates, the user's
iPad bench.

## 8. Gates

- N1: every golden shard, `canonical-stream`, cp2 / ct2 fixtures, `bench.test` rows unchanged; `integration` / `app` / `pwa` lists
  updated for `mod-core.js`; `v8-guard` clean on `AVoice.render` / `FVoice.render`.
- N2: `tests/modcore.test.mjs` ext cross-check bit-identical (a GLOBAL track LFO via ext vs the Serum's own MONO LFO row).
- N3: `tests/classic-mod.test.mjs` oracle ≤ 1e-9, noise-from-zero, fade-out keeps the modulated level, setter quantisation.
- N4 (revised by the spike, §9.0 Q4 — the user is told in ROADMAP): bench rows `mc0` (ModCore, begin only: 10 GLOBAL LFOs, no
  note: ≤ 0.002 per track as SPEC §9.2), `mc` (10 GLOBAL LFOs + a gated pseudo-voice with 3 ENVs + 16 rows: ≤ **0.004** per track on
  the M4 Max with the levers applied — unused slots parked, rows read at span ends, the pseudo-voice ticked every second chunk when
  it feeds non-Serum targets only; the spike measured 0.0066 without them), `mt` (the typical track: 2 GLOBAL + 1 PER NOTE LFO + 1
  ENV + 4 rows ≤ 0.0025), `mk` (8-voice Juno + cutoff cable ≤ 8 % over the row without), `ms` (setters ≤ 1 µs per call per voice),
  `me` (ext hand-off overhead on a Serum row ≤ 1 %); V8 gate on every existing row; the JSC gate (macOS jsc shell) within 3 %; the
  user's iPad bench after deploy.
- N5: two Tracks, same frames + same payload → identical `MC.ext` and row outputs across 10 s with a transport seek.
- Page sims (§6.3) green; the §7.5 table has one test per cell marked 2b (`tests/cv-mods.test.mjs`).
- Sweep: every test file one at a time; lint, pwa; precache rebuilt.

## 9. Notes (the builders fill in; §9.0 the spike)

### 9.0 The ModCore spike (2026-10-19; scripts in the lead's scratchpad `modcore/`: lib.mjs, spike1–4.mjs, xcheck.mjs)

- **Q1** A voice-less `SerumDSP.attach(shim)` + `SD.begin(shim, 128)` runs on a shim `{base, OS 1, fs, CH 4, voices [], held [], p:
  {serum: CP}, ct, bpm, wheel, at, bendRaw, songBeat(), seedSalt, vcN 0, pat null, patSeen false, mpe null, seqMacro null}`; fields
  read: CH, bpm, songBeat, base, fs, sx, p, ct, wheel, at, bendRaw, seedSalt, OS, vcN, seqMacro, mpe, voices. Four MONO LFOs (FREE Hz,
  FREE BPM-anchored, RETRIG MONO with smooth, FREE S&H) vs the same LFOs inside a real `engine.js` Serum Inst: **0 differing chunk
  values over 1500 spans** incl. the RETRIG restarts at note-ons (N2 holds by construction).
- **Q2** One `ModV` on a shim voice (the `TV` of tests/sx-mod.test.mjs:383–425; the CP synced with `SxMod.sync` + `syncCT` first):
  ENV 1–4, legato (NOTE updates, VELO kept, nothing restarts), RETRIG / ENVELOPE / FREE per-voice LFOs all correct; rows to scratch
  V-scope destinations evaluate the full row formula and read back from `mv.off[vi]`; `recentMod` latches velo / note / rand at
  every non-hidden note-on and stays after the voice ends (until `transport`). Cross-check with a real MONO + LEGATO Serum voice:
  bit-identical in every gated span; the pseudo-voice keeps ENV releases after the real voice stopped (intended).
- **Q3** Unreferenced LFOs are **not** evaluated (`offSkip` / `offLfoX` / `monoLfo` write only when `srcUsed` or `sx.mon`; chaos only
  when a row reads it) → keep-alive rows (≈ 0.05 µs/row/span). `SD.transport(shim, true)` reseeds S&H / chaos, resets anchors and
  `recent`; two plays from beat 0 are identical (N5).
- **Q4** Cost per 128-frame span (V8, M4 Max): 10 GLOBAL LFOs + gated pseudo-voice + 3 ENVs + 16 rows 17.7 µs (0.0066); begin only
  6.5 µs (0.0024); the typical track (2 GLOBAL + 1 PER NOTE + 1 ENV + 4 rows) 9.1 µs (0.0034) → 7.0 with unused slots parked FREE +
  MONO → 5.8 with rows at span ends → 3.9 with the pseudo-voice ticked every second chunk; begin only 1.1 µs. The gated pseudo-voice
  costs ≈ 6 µs/span by itself (advance ≈ 3.4, sources ≈ 2.8, matrix ≈ 1.8, follow ≈ 0.9). Hence N4's revised rows.
- **Q5** NSRC 62 → 78 in sx-base / sx-mod / serum-dsp renders every existing CP bit-identically; an ext row (`mSrc = 62 + k`,
  `use |= 32768`) works in the mono and FX contexts unchanged and in the voice context with two copy lines; appending to
  `serum-core.SOURCES` would change `cpKey` / `srcUsed` of every CP (fixture churn) → the compile-ctx route of §3.2.
- **Q6** No `{t:'mods'}` → nothing runs (the harness lists are explicit); 200 spans of begin + pseudo-voice under throwing
  constructors: **no allocation**; attach ≈ 0.4 MB per track.
