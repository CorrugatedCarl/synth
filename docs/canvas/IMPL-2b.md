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

### 9.1 Lane A1 — engine core (ModCore, protocol, Track integration, ext sources; 2026-10-19)

**Files**: `mod-core.js` (new, `globalThis.ModCore`, loaded after `fx-dsp.js` and before `engine.js` in every list:
main.js `DSP_FILES`, wk.js `DSP_GLOBALS`, smprender.js / cv-cost.js `DSP`, tests/dsp-scope.mjs `DSP_TABLE`, golden-harness
`DSP_V2`, tests/bench.html), `engine.js` (Track / Chain / protocol / postMon only), `sx-base.js`, `sx-mod.js`, `serum-dsp.js`,
`serum-core.js`, `tests/modcore.test.mjs` (new, 11 tests), `tests/bench-scenarios.mjs` + `tests/bench.json` (rows `mc0`, `mc`,
`mt`, `me`), the list expectations (app / main / wk / cv-cost / integration / sx-base / sx-mod tests), sw.js precache.

**The payload as built** (`{t:'mods'}`, exact field names; `MC.setRows(m)`):
- `cp`, `ct` — the synthetic Serum CP and its CT (`ct`: a `{key, parts}` parts object, a full CT, or `null` → defaults);
  `bpm` — the tempo the CP's BPM LFOs run at while the transport is stopped (default 120; while playing `songBeat()` rules).
- `rows[]` — `{ id, src, vi, dst, xfer?, perNote? }`: `src` = the **CP source index** the row reads (5 = lfo1 … as
  serum-core `SIDX`; value sources 62–77); `vi` = the row's scratch V-scope destination (= the CP row's `mDst`; when
  absent ModCore claims the j-th unclaimed CP row with that `src`, in CP order — so keep-alive rows should follow the real
  rows); `dst` = `{kind:'cls', inst, slot}` | `{kind:'set', inst, field}` | `{kind:'fx', chain, fx, key?}` (`chain` is a
  panel id or a Serum's own FX `'<inst>/fx'`, `fx` the flat FX-context index, `key` the layout key the row was compiled
  against — a stale key leaves the rack unmodulated, `FXRack.setMods`); `xfer` on the row, else `m.xfer[id]` / `m.xfer[j]`.
- **Transfer** (lane A2's `cv-mods.xferOf` shape, lane B's `xfer[i]` by row index or `row.xfer`): `{a, b, x0}` (T(x) = a +
  b·x) or `{tab: 129 values over the knob's mod space 0…1, x0}`, `x0` = the knob's position in mod space. ModCore reads
  each row's `x = V.mod.off[vi]` (the synthetic row already applied amt / curve / crv / slew / aux / bi; several rows may
  share a `vi` — one cable, several targets: read once, applied per row) and **groups the rows of one knob on one target**
  (inst + slot, or inst + field, with the same transfer — the group key includes x0 / a / b / three table samples): Σ per
  group, the group's offset `T(clamp01(x0 + Σ)) − T(x0)`; a `cls` slot sums its groups' offsets (`cls0` with Σ at chunk
  0, `cls1` at chunk nCh − 1), a `set` field gets the **effective value** `T_first(x0) + Σ group offsets` (one knob → exactly
  `T(clamp01(x0 + Σ))`), an `fx` row adds x itself (the rack clamps ±2). Without `xfer`: T(x) = x, x0 = 0. Lane B's extra
  row fields (`amt, bi, curve, crv, aux, inv, rise, fall, byp, out, perNote, slot, tgt`) are carried, not read — except that
  `MC.instRows[inst]` (for A2's `modRows`) **overrides `slot` with the classic slot index** (`dst.slot`; B's `slot` is the
  synthetic matrix slot) and attaches the row's `xfer`.
- `ext[]` — `{k: 1…16, src, id?}`; `vals[]` — `[{k, src, v, id}]` (lane B) or plain values by index; `keep[]` — accepted,
  informational (the CP already holds the keep-alive rows; `n`, `left`, `dashed`, `i`, `key` ignored; **the host must give every source an ext slot reads a row with nonzero `amt`** — `rowActive` drops
  `amt: 0` rows at compile, and SxMod skips unreferenced LFOs: spike Q3, test "keep-alive").
- `{t:'mods', i, off: true, key}`, an empty payload (no rows, no ext) or a rejected one (no `cp`, a CP the DSP refuses) → `T.mc =
  null` (every Serum's ext rows cleared with `SD.extOff`, its own-FX sum dropped, every cabled panel's rack `setMods(null)`
  once, every classic Inst `modRows(null)`); a malformed payload after a good one also drops the ModCore (documented
  choice: "ignored" = no throw, nothing half-applied). `{t:'mval', k, v}` → `MC.ctl`. `processorOptions.mods` after the parts.

**Outputs per span** (`MC.span(F, n, nCh)` from `Track.modPre(n)`, before any Inst renders): `MC.ext` Float64Array(16·32);
`MC.cls0[inst]` / `MC.cls1[inst]` Float64Array(S_N = 29, the Track passes engine.js's constant); `MC.setv[inst]` `[{field,
v}]`; `MC.fxv[chain]` Float64Array(MAXFX 1160) + `MC.fxHi[chain]` + `MC.fxKey[chain]`; `MC.has[inst]`; `MC.instRows[inst]`
(the payload's classic rows for that Inst, `{…row, slot | field, xfer}` in payload order — handed to `Inst.modRows` by
`Track.handRows` after every `setRows` and `modRows(null)` on off). Call sites: `I.modSpan(cls0, cls1, setv)` right before
`I.renderSpan(n)` for a powered classic Inst with `MC.has[id]` (guarded by `typeof` until A2's Inst lands); `SD.extIn(I,
MC.ext, nCh)` for a powered Serum whose CP has `use & 32768` (`inst.sx.g.set(ext, 62·32)`; begin's step (4) copies the
last chunk into `monoSrc` exactly as it does the G sources — the mono context one span behind, `fxMods` this span: the
timing of a processor LFO, which is what makes N2 bit-identical for G-scope rows too); the Serum's own FX: the Track sets
`I.sx.mcFx / mcHi` and `SerumDSP.fxMods` returns `sx.fxSum = SxMod's vector + mcFx` only then (else SxMod's vector itself,
byte for byte — lane B targets a Serum's own FX through ext / injection only, so this path is unused but harmless); panels: `Track.chainMods(c, r)` → `r.setMods(MC.fxv[c.id], MC.fxKey[c.id])` before `r.process` (`Chain.mcOn`
remembers to send `setMods(null)` once when the rows go). `postMon`: a classic Inst with `I.moN > 0` posts `s: { eff:
I.modEff() }` (A2's). Dying / powered-off Insts: nothing.

**Value table** (`MC.ctl(k, v)` from `{t:'mval', k, v}` — the contract's name stands; 32 entries, **24 carried**): k 0–7 =
the macros, written into the shim's `seqMacro` lane (SxMod's clip-lane path: `macroTargets` → the same per-chunk `kM`
smoothing a Serum macro knob gets, no recompile and no CP write; `NaN` = the CP's own `macro1…8` base until the first
value — `vals` seeds it); k 8–23 = the value sources, carried as **ModCore's own ext inputs** (CP sources 62–77: the synthetic CP is
compiled with `{ext: true}` and its rows name `ext<j+1>` for value entry 8 + j; ModCore glides them per chunk with the same
`kM` into its `g` rows 62–77, which the pseudo-voice copies like any ext row); k 24–31 are stored only — no CP source
carries them (every spare source slot of the 78 is either global, written by `ModV.sources`, or bipolar). **Lane B: cap the
value sources at 16 (k 8–23)**; a 25th needs a second mechanism.

**Levers** (measured with `scratchpad/a1/levers.mjs` on the shipped code, µs per 128-frame span of ModCore alone, M4 Max, node 24):
- unused LFO slots parked FREE + MONO by the host (the synthetic state's default here and in the bench rows);
- rows read at the span ends only: `matrix()` at chunks 0 and nCh − 1 (every ModCore target is span-rate; `MC.ext` is
  copied from `g` per chunk, not through rows);
- `MC.half` (default on): the pseudo-voice ticks every second chunk (`setDt(2·dtC)`) while no ext slot carries a
  per-note source (`MC.extPerN === 0`; an ENV / PER NOTE LFO / velo … on an ext slot needs per-chunk values → every chunk);
  spans with an odd chunk count tick every chunk. Row `mc`: 5.72 → **4.32 µs** (0.00215 → 0.00162); `mt`: 3.72 → **2.19**;
- `MC.pvOn`: a payload with no rows and no per-note ext source never ticks the pseudo-voice (begin alone): row `mc0`
  **2.8 µs** (0.00105) for 10 GLOBAL LFOs into 10 ext slots.
- Bench rows (tests/bench.json targets; `measure()` row − base, median of 5): **mc0 0.0012** (≤ 0.002), **mc 0.0019**
  (≤ 0.004), **mt 0.0008** (≤ 0.0025), **me ≈ 0.000** (the ext hand-off on row d's 8-voice Serum is below the row's
  run-to-run jitter of ± 0.004; ≤ 1 % of 0.4 = 0.004). The node gate (≤ 1.5 × target, 3 attempts) lives in
  tests/modcore.test.mjs; `node --test tests/bench.test.mjs` still passes (every row builds, bench.json targets match).

**Ext sources**: `sx-base` / `sx-mod` / `serum-dsp` NSRC 78 (`ext1…ext16` appended to `SRC_IDS2`, unipolar); `ModState.extOn`
from `CP.use & 32768`; the copy loops in `ModV.sources` and `ModV.noteOn`, and begin's step (4) for `monoSrc`; `serum-core`
`SOURCES` stays 62 (`S_EXT0 = 62`, `N_EXT`, `EXT_IDS`, `extIndex(id)`, `extLabel(id)` → "Ext k (canvas)" exported);
`compileSerum(s, {ext: true})` maps `ext<k>` to `S_EXT0 + k − 1`, sets `use |= 32768`, marks no `srcUsed` (the array stays
62); without `ctx.ext` an ext id is dropped as any unknown source (cp2 / ct2 fixtures, cpKey unchanged — serum-core tests
green). Note for lane B: the ext ids must be injected into the **normalised** copy after `normalizeSerum` (`normRow`
rejects them; `compileSerum` normalises only when `serumShapeOk` fails). New serum-dsp exports: `sync(proc)` (CP / CT
sync without a span — ModCore's shim after a payload, so a note-on before its first span sees the CP), `extIn`, `extOff`.

**Deviations / notes**: `Inst.modSpan(cls0, cls1, setv)` three-arg form (per the lead's brief; A2 accepts both);
`MC.instRows` + `Track.handRows` added for A2's `modRows`; the pseudo-voice is driven as the spike's `PseudoVoice` (the
serum-dsp note-on prologue: `sx.alt` flip, `rng` / `r` / `r2` seeding, `ModV.noteOn(n, v, legato, null, 0, null, other)`);
legato = other keys held (`Track.nHeld`, kept from `holdV` transitions, previews excluded) **and** the pseudo-voice active;
release when the last key lifts (`held === 0`); `Track.panic` releases it; the Track's `wheel / at / bendRaw` are own
fields (the Facade therefore no longer forwards those three names to Inst 0 — no test wrote them through the processor;
values are always equal to every Inst's). The shim's `seedSalt` is `fnv1a32(trackId)` (0 without an id): two Tracks with
the same id and payload are identical (N5). `stats()` → `{lfos, envs, rows, ext, us, half}` (`us` through
`performance.now` where it exists, else `Date.now`). `postMon` for classic `eff` is wired to A2's `modEff()` — unverified
here (no Inst adapter on this branch). An Inst a later `{t:'graph'}` adds gets its rows only with the next `{t:'mods'}`
(the host reposts on graph changes; `handRows` runs on every payload).
### 9.1 Lane A2 — the classic adapter (2026-10-19; `engine.js` Inst, `cv-mods.js` transfer maths, `tests/classic-mod.test.mjs`, bench rows `mk` / `ms`)

**Inst interface** (engine.js, the `/* ---- canvas modulation` block after `smStep`; the Track — lane A1 — calls these):
- `I.modRows(rows)` from `{t:'mods'}` (and `null` when the Inst's rows go): `rows = [{ slot: S_* } | { field, lo?, hi?, xfer? }]`,
  one entry per cable of this Inst in payload order (the same `dst.slot` / `dst.field` strings as §2.2, so a payload row can
  be passed as it is with its `xfer` attached). `slot` must be `< S_BEND` (26); duplicates share the slot. A field row is
  the FIELD_CLASS path (`'lfo.rate'`, `'fenv.a'`, `'reg.bass'`, `'tb.accent'` …); its quantisation grid is `[lo, hi]`, or the
  range of `xfer` (`{a, b}` → a…a+b, `{tab}` → min…max), or none (every change applies). Fields that are not numbers in the
  live patch (`prio`, `legato`, `glideLegato`, a `tb.*` / `fenvIL.*` / `dual.*` field on a model without that section) are
  ignored — never written. Allocation happens here (between quanta). Fields that go are written back to their bases and
  every voice gets the base coefficients again.
- `I.modSpan(cls0, cls1, setv)` right before `I.renderSpan(n)`: `cls0` / `cls1` = `Float64Array(S_N)` span-start / span-end
  offsets **in slot units** (ModCore's rows read at chunk 0 and chunk nCh−1 with the transfer applied: `T(clamp(x0 + Σ)) −
  T(x0)`); `cls0 = null` keeps the previous span's end as the start (the first span after `modRows` then ramps from 0);
  `cls1 = null` = no offsets this span; NaN → 0. `setv = [{ field, v }] | null`, `v` the effective field value in field
  units (`T(clamp(x0 + Σ))`, not an offset). The two-argument form `modSpan(off, setv)` (contract §5.1) is accepted
  (`off` = span-end offsets). With no rows it returns at once; `golden-classic` / `golden-random` / `golden-graph` are
  unchanged (the only additions on the neutral path are `if (this.moN !== 0)` tests in `renderSpan` and `fadeOut`).
- `I.modEff()` → `Float32Array(rows.length)` **in engine units**, one entry per row of `modRows` in order: a slot row its
  smoothed value plus this span's end offset, a field row its effective value (the base while none was applied); `null`
  without rows; allocation-free (the array is `modRows`'). Decision for §2.4: the host converts to knob units with
  `cv-mods.knobOf(model, vals, ctlId, eff[k], target)` (it has the vals and the sweep; the payload stays forward-only).
  `postMon`'s `s: { eff }` is lane A1's: `{ t:'smon', i, s: { eff: I.modEff() } }` for a classic Inst with rows.
- Internals: `moSlots` (Int32Array, the distinct cabled slots), `moPrev` / `moEnd` (swapped after every span — after the
  swap `moPrev` holds the latest offsets, which `fadeOut` adds to `smA` after its `smA.set(smB)`), `moU` (saved `smB`),
  `moApply` after `smStep` / `moRestore` after chorus–ensemble (§5.1 steps 1–4 as written), the field records `moF` /
  `moMap` with setter kinds 1–11 (see `moRec`), the per-voice generation `moVG` (a voice that went active since the last
  change gets the cabled coefficients at the next span, before it renders), `moRefresh` from `setPatch` (bases from the
  new patch, every voice re-applied at the next span). The shared `DEFAULT_PATCH` is copied before a field is written.

**Span setters as built** (§5.2): `this.p.<field> = v` for every cabled field. Voice setters, active voices only, when the
value quantised to 1/512 of the grid changed: `fenv.a/s/r` → `Env.set` (+ the 303 accent decay as `apply`), `fenv.d` →
`setDecay`, `aenv.a/s/r` → `Env.set`, `aenv.d` → `setDecay`, `envOv` → both, `vcf.comp/fbSat/poles/mode/morph/sat/clip` →
`moChar` (= `cfgLP` without `setRes`: the smoothed slot owns the resonance; `poles < 3` is the 2-pole tap so a value between
options still resolves), `hpf.clip` → the SKHigh clip. Inst setters (any change): `unisonDetune` → `v.det` + re-target as
`setPatch`, `bendRange` → `bend = bendRaw·range`, `bw` → `recalc()`, `fx.chorus/ensemble/hiss` → chorus mode / hiss /
ensemble on. Patch-only (read by the processor or the voices from `p`): `lfo.rate/wave`, `glide*`, `dac`, `reg.*`,
`attack/release/tone`, `tb.accent/chg/dis/latch`, `fenvIL.il/al`, `bpm`, `osCap`.

**Transfer tables** (cv-mods.js, pure): `SLOT` mirrors engine.js `S_*` (pinned by a test); `targetsOf(model, ctlId)` →
`[{ kind:'slot', slot, field } | { kind:'field', field }]` from the class sweep over the default panel and every factory
preset (so a knob inert at the current values — the Minimoog Noise with its mixer switch off — keeps its target;
`xferOf` then reports `b: 0`); **one row per target**: a knob may move several (Minimoog / MS-20 master tune → three TU
slots, CS-80 Brilliance → VO and DO, Prophet-5 Filter revision → the DRV slot and `vcf.comp` / `vcf.fbSat`, TB-303
Resonance → VR and `tb.chg` / `tb.dis`, Juno Env A → `fenv.a` and `aenv.a`); `slotOf` = the first. `xferOf(model, vals,
ctlId, target?)` → `{ a, b, x0 }` | `{ tab: Float64Array(129), x0 }`, `x0` = the knob's position in modulation space
(added to the contract's shape so ModCore can clamp `x0 + Σ`); selectors sweep their options rounded, toggles 0 / 1 (stepped
tables: exact at the points, the step inside one 1/128 cell — ModCore's interpolation yields in-between values in that cell
only). Linear within 1e-9 for the `lg(ex())` cutoffs, resonances, levels, PWs, tunes, env amounts …; tables for every
T(lo, hi) time, the exponential LFO rates, glide, the 303 accent slews and the selectors. **Error bound** of the engine's
linear interpolation between table points for an exponential law `lo·(hi/lo)^x`: `(ln(hi/lo))² / (8·128²)` of the value —
0.063 % for the widest time law (0.004…35 s); the test holds every table to 0.1 % of its range at the mid-points (worst
measured 6.3e-4; the glide law's "off below 0.05" jump sits in cell 0 and is exempt). `xferInv(xf, s)` / `knobOf(model,
vals, ctlId, s, target?)` invert (a table by its first crossing, outside it the nearer end; an inert linear transfer returns
the knob's own position).

**Measured** (Apple M4 Max, node v24): N3 oracle max |A − B| = 0 over 2 s (bit-identical: the oracle's `t + off` is the
adapter's `b + off`); noise-from-zero and the fade-out tail bit-identical to the knob at the modulated value; a 0.1 s
swing on a 3 s envelope-time field over 2 s: 32–48 `Env.set` calls per voice over 750 spans; `mk` +3.4 % (measure(), 5 ×
1 s; 1.057–1.068 with interleaved pairs in classic-mod) of the 8-voice Juno-60 row without (gate 8 %); `ms` 0.025–0.05 µs
per `Env.set` call per voice (gate 1 µs); no allocation per span (`noAlloc` over 60 quanta with slots and fields cabled).
Deviations from the contract: `modSpan` takes the start offsets too (`cls0`; the two-argument form still works);
`modRows` is the Inst's row setter (the contract names it only as "from setRows"); `xfer` carries `x0`; `targetsOf`
yields several targets per knob (the contract's single `slot?` / `field?` per row holds per target: lane B emits one row
per target). `tests/bench-scenarios.mjs` gained an optional `prep(p)` hook for voice rows (the cable on the live
processor).
### 9.1 Lane B — compile / data (2026-10-19; `cv-graph.js`, `cv-mods.js`, `cv-model.js`, `song.js`, `cv-migrate.js`, `main.js` buildMods / modVals / buildInstPatch / buildChain, `models.js` patchFor's `ext` flag, `serum-core.js` normaliser exports; tests cv-graph 22, cv-mods 13, cv-migrate 37, cv-model 5 (new), fixtures `tests/fixtures/mods-2b.mjs`)

**Data (§1.1 / §1.4, as lane C's bodies read them).** Device records `{ kind, …state }` bounded by `song.normModDev` (song.js imports
serum-core's `normLfo` / `normLfoMod` / `normEnvMod` / `normChaosMod` — its one import): lfo `{ lfo: normLfo's object (mono 1 =
GLOBAL), rate, rise, delay, smooth, phase }` (the slot knobs as device-level fields in normalised p units: `l<k>.rate` etc.);
env `{ env: { bpm, legInv, stealRe }, att, hold, dec, sus, rel, crv: [attack, decay, release curves], start, end }`; chaos
`{ chaos: { mono, sh }, rate, bpm, smooth }` (smooth: the module's own, no Serum param — stored, not compiled); macro `{ v: [8 ×
0…1], names: [8 strings ≤ 16] }`; cc `{ cc: 0…127 (default 1), ch: 0…16, v: 0…1 }`; note / velo / at / bend `{ kind }`; an
optional `name` (≤ 32) on any. Ids `l<n> e<n> m<n> c<n> h<n>` (`cv-mods.MOD_PREFIX`), the singletons `ve at bd nt`;
`addModDev` numbers past the highest of the prefix (a removed number comes round: its rows went with it); an LFO is born
GLOBAL (`normModDev({ kind: 'lfo', lfo: { mono: 1 } })`), an ENV with Serum's ENV 2 defaults, a chaos global at Serum's rate.
`setModState(t, id, fields)` merges device-level keys and the slot objects (a whole one replaces; a partial one merges over
the old), normalises, writes back into the same object. `SCHEMA = 6`, `STEPS[5]` additive; `MSRC` / `MAUX` unchanged (any
port, the linked `'<serum>/lfo<k>.out'` / `'/env<k>.out'` already fit MSRC); `splitTracks.rowsTo` keeps rows from any port
of a modulator and from the instrument's own LFO / ENV (renamed with it), drops rows from another instrument's; `toV1`
names modules in Tidy order through `modLabelOf` ("its LFO 1, Macro 1, Chaos 2 modules"). `cv-mods.sourcesOf` lists every
module (`{ id, label, scope, kind, dev, port, perNote }`; a macro: 8 entries `m1.k1…k8` labelled by their names);
`linkSources(t)` the Serums' LFO 1–10 / ENV 1–4 (`used` when the Serum's own rows read one); `perNoteOf`, `srcOf`,
`srcDev`, `kindOfId`, `modLabelOf`, `modDevs` (Tidy order), `MOD_LABEL` (+ Note / LFO / ENV / Macro / CC / Chaos),
`MOD_SRC['nt.out'] = 'note'` (a Note module on a Serum knob is a native row). `destOk` opens classic sm / apply / proc and
panel knobs, chunk → `{ ok: false, stage: '5' }`, struct / none / unknown nomod, a switched-off oscillator's level "Switch
the oscillator on to modulate its level" (`classicTarget` sweeps the live patch two-point; with the mixer switch off the
class evidence over the bases says `osc.lev`); `descs` carry `ctr` (a centred −x…x classic knob, Serum's flag, an FX row's).
`cv-model.addMod`: Serum destinations as 2a (serum-core addMod's drop rules with a native stand-in source, the 64-row
budget — rows left for 'slots' / 'ext' never fill it); classic / panel: `bi` = the descriptor's `ctr`, amount 0.25, a bool
knob ±1 by its live value, no limit; `setMod` validates non-native rows by proxy (a wheel → cutoff row through normRow).
`setModel` / the model accessor / `removeInst` drop the rows whose knob the new model has not (`destOk` on the new
model: "… removed: the new model has no such knobs"); `removeInst` drops rows linked from the instrument's LFOs / ENVs.

**The payload (§3.1).** `compileMods(t, project, opts) → { t: 'mods', i, key, cp, ct, rows, xfer, ext, vals, keep, left,
dashed, n } | null`, memoised per track by a signature (rows, module states, bpm, the cabled classic instruments' vals,
each cabled Serum's free-slot picture, the linked slots' states), `key` = FNV-1a of the payload sans cp / ct + `cpKey` +
the CT key: a knob turn on an uncabled instrument or on a Serum never changes it; a cabled classic knob does (its transfer,
A2's `x0`). The three-row track of the fixture (a GLOBAL LFO `l1` → Serum cutoff, Juno cutoff, the panel reverb's mix):
```
{ t: 'mods', i: 'trk_b1', key: '…',
  cp: <synthetic CP: lfo1 = l1 (mono 1, RETRIG), lfo2…10 parked FREE + MONO, a.on 0, poly 1, two matrix rows lfo1 → a.level (vi 0) / a.pan (vi 1)>,
  ct: <its serumT { key, parts }>,
  rows: [{ id: 'r2', src: 5, dst: { kind: 'cls', inst: 'i2', slot: 0 }, amt: 0.25, bi: 1, curve: 0.3, crv: null, aux: 0, inv: 0, rise: 0, fall: 0, byp: 0, out: 1, perNote: false, vi: 0, slot: 0, tgt: 0 },
         { id: 'r3', src: 5, dst: { kind: 'fx', chain: 'fx1', fx: 21, key: '<fxLayout key>' }, amt: -0.2, bi: 0, …, rise: 0.1, fall: 0.1, perNote: false, vi: 1, slot: 1, tgt: 0 }],
  xfer: [{ a, b, x0 } (A2's xferOf for the Juno cutoff), null],
  ext: [{ k: 1, src: 5, id: 'l1.out' }], vals: [], keep: [], left: [], dashed: [],
  n: { lfo: 1, env: 0, chaos: 0, macro: 0, vals: 0, ext: 1, rows: 2 } }
```
- `src` / `aux` are the synthetic CP's source indices (`serum-core.SRC_INDEX`): lfo1…8 = 5–12, lfo9…10 = 35–36, env1…3
  = 2–4, env4 = 34, chaos 17–18, macro1…4 = 24–27, macro5…8 = 47–50, velo 13, note 14, wheel 1, at 15, bend 28; a value source `ext<j>`
  = `S_EXT0 + j − 1` = 62 + j − 1 (the index A1's `ctx.ext` compile gives `ext<j>`). `vi` = `serum-core.vi(scratch id)`
  (voice-vector index: the readback slot `V.mod.off[vi]`); `slot` the synthetic matrix slot (`'crv<slot>'` CT part,
  slew / mOut state per slot); `tgt` the target index of a knob that moves several things (A2's `targetsOf`: one payload
  row per target on the SAME synthetic row — same `vi`, each with its own `xfer`); `dst.slot` = engine.js S_* (cv-mods
  `SM_SLOT`), `dst.field` the FIELD_CLASS path ('fenv.a', 'lfo.rate'), `dst.fx` the chain's fx-core flat index + the
  layout `key` (checked against the `{t:'chain'}` in force).
- **Slots** in module id order (Tidy), to the sources that need ModCore evaluation only: non-Serum rows' sources and the
  Serum rows' sources that go through ext (globals; per-note sources with no free Serum slot). LFO modules and linked
  Serum LFOs → lfo1…10 (`mono` as the module / the Serum's slot); ENV modules and linked ENVs → env2, env3, env4, then
  env1 (its sustain written as √sus: the n² law; Start / End none); chaos → chaos1…2; the first macro module with a cabled
  knob → macros 1–8 (value table k = knob − 1); further macro knobs and CC modules → value sources k 8…23 as the synthetic
  CP's `ext1…16` (ModCore writes the smoothed table value into the shim's `g[(62 + j − 1)·32 + c]` before `SxMod.begin`;
  `compileSerum` of the synthetic state gets `ctx.ext: true` only when one is used). Over capacity → `left` `'slots'`
  (10 LFO, 4 ENV, 2 chaos, 16 value sources), `'ext'` (16 ext per track, allocated in the order the Serums need them),
  `'full'` (`SYN_MAX = 48` synthetic rows: 64 − 10 − 4 − 2 so the keep-alives always fit after them). `n` counts the slots
  in use (macro: knobs), `modBudget(t, dev, project).slots` = `{ lfo: [n, 10], env: [n, 4], chaos: [n, 2], macro: [n, 8],
  vals: [n, 16], ext: [n, 16] }`, its `left` ids with `why`.
- **Scratch destinations** (`cv-graph.SCRATCH`, 61 ids; `KEEP_ID` = the last, 'f2.level'): V-scope rows of silent modules
  only — the a / b / c oscillators' pan, fine, crs, det, blend, wt, warp, uniw, uniwarp, uniwt, level, oct, semi, the sub's
  level / pan / oct / crs, the noise's level / pan / pitch / fine, the filters' cutoff / res / drive / var / pan / mix /
  level — scope 'V' (never 'V*M': no mono-context evaluation), `vi ≥ 0`, none in `NOTE_ON_DESTS`, no `*.on` / `*.w2` /
  `*.fbal` / `*.bus<n>` (the compile's `isT` tests), no LFO / ENV / chaos / porta / voice-control / macro row. With the
  voice section off (`a.on` 0 — b / c / sub / noise / filters are off by default; `voicing.poly` 1) an offset on any of
  them changes nothing the pseudo-voice computes (it has no oscillator, no filter, no amp output). Synthetic rows take
  `SCRATCH[0…]` in row order; every keep-alive row targets `KEEP_ID` (nobody reads it).
- **Keep-alive rows**: `amt: 1` from each evaluated LFO / ENV / chaos source no synthetic row reads (an ext-only
  source) to `KEEP_ID` (serum-core's `rowActive` needs a non-zero amount; the spike's "amt 0" would not count); `keep`
  lists their source indices. Macros / value sources / the performance sources need none (begin smooths macros always;
  the ext slots and the shim's fields are ModCore's own).
- **Serum rows** (`injectMods(dev, rows, ext, track)`): native sources as 2a (`wheel velo at bend note`); the Serum's own
  LFO / ENV cabled to its own knob → the native id (`lfo3`, `env2`); a GLOBAL ModCore source → `{ src: 'ext<k>' }` from
  the ext list (`nativeRow(r, 'ext<k>')` normalises by proxy); a PER NOTE source (a PER NOTE LFO, an ENV, a linked POLY
  LFO / ENV of another Serum) → slot injection: a free `s.lfo[k]` (k any of the 10: the default state, default knobs,
  no row reads it) / `s.env[k]` (k 2–4: default knobs and flags, no row reads it) of a copy (`lfo` / `env` arrays and
  `p` copied; the other slots by identity) receives the module (`normLfo(state.lfo)` + `l<k>.*`, or `env` + `e<k>.*` +
  the curves), one slot per source per Serum, the hint map `lastInj` (per vals) keeps the slot while free; no free slot →
  the ext fallback with `dashed` (the inspector's "no free LFO slot: follows the most recent note" is the UI's text).
  `placed` entries carry `src` (the Serum source each reads: the 2a fixture / tests updated), plus `why`, `dashed`, `inj`,
  `used`. `instPatch(d, opts, rows, ext, track)` passes `opts.ext: true` to patchFor only when an ext row was placed
  (`models.js` → `compileSerum` ctx.ext; every other compile is the bytes it was: the 2a fixture and every factory preset
  compile identically with or without the new arguments). `chainPatch` unchanged.
- **main.js**: `buildMods(tr)` → `compileMods(tr, project, { smooth: prefs.smooth, qr: null, ultra: 0 })` (the memo is
  cv-graph's), or `{ t: 'mods', i, off: true, key: 'off' }` when null or nothing is left to evaluate (no rows / ext / vals:
  a 2a-only track, a track whose modules went) — the poster compares `key` per track and posts `off` once after a posted
  payload; on `__synthTest.api` as `buildMods` / `compileMods`. `modVals` / `buildInstPatch` inject with the track's ext
  list; a merged vals with ext rows carries a non-enumerable `ext` mark that `buildPatch` turns into `ext: true` (one
  token in buildPatch's options — the only edit outside the four functions; the smpgen test extracts `modVals` /
  `buildPatch` by source, so `modVals` returns before any 2b reference when the Serum has no rows).

**Deviations / notes for the other lanes.**
- The contract's `env: n/3` reads 4 here (§2.3's four ENV slots; env1 last).
- A chaos module always evaluates in ModCore (a `mono: 0` chaos is per-note there and dashed; it is never injected into
  a Serum's chaos slot). A Serum's own FX knob from a ModCore source goes through ext / injection like any Serum knob
  (the Serum's matrix carries FX-context rows): no `fx` ModCore rows ever target a Serum — §4's "sum into fxMods" path
  stays unused by this compile.
- The value table is 24 wide in practice (8 macros + 16 value sources reachable as the synthetic CP's ext1…16); entries
  24–31 of §2.3 would have no source in the CP and are left 'slots'.
- `vals[i].src` for macros 0–7 is the macro source index (A1: `MC.ctl(k < 8)` sets the synthetic CP's macro base as a
  `{t:'macro'}` would); for k ≥ 8 it is 62 + (k − 8) (A1 writes the smoothed value into the shim's g row).
- A1: the synthetic CP arrives with `use` bits of a voiceless default (no needs); rows with `src ≥ 62` compile only with
  `ctx.ext` (today they are idle in the CP — the payload carries them regardless).
- A2's `targetsOf` / `xferOf(model, vals, ctl, target)` are called by name from `CM` (cv-mods' namespace import); absent
  (this branch) `classicTarget`'s single target and the identity `{ a: 0, b: 1, x0: 0 }` stand in; tests stub both
  through `compileMods` opts (`xferOf`, `targetsOf`).
- D: `canvas-2a-sim` has 5 failures that are the stage flip (classic and panel knobs now connect — 'refusals' and 'H9'
  assert the 2b refusal; the three in between cascade from the first test's now-successful cable); `modCan` / `modDests` /
  `modMarks` / `sxExtra` (its `MOD_SRC[r.src]` label) / `modDescs` are Serum-only there. `modLeftN` / `cvBadge` read
  `modBudget(...).left` as before; `why[id]` gives the reason text key.
- C: an edit `{ lfo: whole }` replaces the slot object; `{ rate }` alone is a device-level key; `setModState` never
  changes `kind`.
