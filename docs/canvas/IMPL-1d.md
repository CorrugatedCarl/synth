# Stage 1d: the track engine (IMPL-1d)

What stage 1d built, the protocol it added, the gates as measured and the decisions taken. The spec is [SPEC-canvas.md](SPEC-canvas.md) §6.1–6.4, 6.8, 6.9, 6.11, §9.2, §10 1d, §11.2; [ROADMAP.md](ROADMAP.md) wins where they differ. Sound is unchanged: every golden test and the new golden-graph test are bit for bit.

## 1. Structure (`engine.js`)

```
Track  extends Facade extends AudioWorkletProcessor   (registered as 'synth-engine')
 ├─ events     process(), span splitting, songMsg / transportMsg / songEvents / releaseSong, extNote / extEvents (MIDI OUT ring)
 ├─ dispatch   msg(): global stores, bye, smon / mon, fxph, panic, song, transport; controller state → every Inst; the rest → i0
 ├─ i0         Inst: everything the voices and DSP scripts read by name (init / setOS / setPatch / setSerum / sx* / notes /
 │             runLFO / renderDac / the 303 seq* / fades / osFade / decim / renderSpan(n) / renderSerum(n) / transportHook)
 ├─ c0         Chain: the track's FXRack (i0.rack === c0.rack; a classic Inst feeds it, a Serum Inst holds it as its own FX)
 └─ out        panicFade → outStage (DC block, limiter, clip) on Lb / Rb = i0's buffers (in-place aliasing, §6.3)
```

- **Verbatim move**: the Inst's methods are the single-class processor's bodies unchanged. The lifted lines: classic `rack.process` (now in `Track.renderSpan`, `setNote` stays in the Inst), `panicFade` / `outStage` (Track), the idle check reads `this.T.pnN`; `renderSerum` gained a `Date.now()` pair around its own FX's `process` (the FX module's CPU); `nowF`, `songHas`, `songBeat` forward to the Track (`tp` is shared by reference, `bpm` and `tickAt` read it); `panic` is split (`Track.panic` keeps today's statement order, `Inst.panicSx` / `isQuiet` / `panicClear`).
- **One class everywhere**: live tracks, preview, offline, render farm, bench page and the golden harness all construct a Track holding an Inst; only Inst objects reach `AVoice` / `FVoice` / `Divide` / `SerumVoice` / `SerumDSP` / `SxMod` / `SxSeq` (tested).
- **Idle skip (§6.4)**: `Inst.renderSpan(n)` returns 0 when it skips (today's condition: quiet > 2 s, no tails / warm-up, its FX idle; `quietF` per Inst, Serum's `SD.idle` keeps clocks); the Track then zero-fills and skips `panicFade` and `outStage`. With one Inst feeding one Chain this is exactly the old rule (the Chain's idleness is part of the Inst's).
- **Warm-up** is `Track.warmUp` (the same rounds, through the Track's process / Chain / output stage and `i0`), then `Track.restore` → `Inst.restore`.
- **Facade (§6.2)**: on the first Track of a scope, every own field and method of Inst 0 that the Track does not have becomes an accessor on `Facade.prototype` (get / set to `i0`; a method read returns i0's own override if one was set through the facade, else the prototype method bound to i0; `rack` = c0's, setting both). So every existing test, `cpu-gate`, `bench-scenarios`, `bench.html` and the golden harness run unchanged — including overrides such as integration's `p.sxNote = …` (reaches SxSeq's calls) and the harness's `p.noteOn` / `p.outStage` wrappers (Track methods). The Track's own code never goes through the facade.
- Limits / multi-Inst paths (zones, salts, graph, copy-first sums, `pk`) are stage 1e; the Track already keeps `insts` / `chains` arrays (length 1).

## 2. Protocol

| Message | Dir | 1d |
|---|---|---|
| `{t: 'mon', ids}` | → | the parts whose snapshots are wanted: `'i0'` (Serum snapshot, `sx.mon`, mix peaks), `'c0'` (rack `gr` / `fxph` / `ftap`); `[]` stops. `smon` (legacy) = every part. Posted `smon` messages keep their shape, with `null` for parts not subscribed |
| `stats` gains `per: [{id: 'i0', load, voices, os}, {id: 'c0', load}]` | ← | a Chain's own processing time (Date.now around its `process`; for a Serum inside `renderSerum`), the Inst the rest of the track's load; `load`, `voices`, `os` unchanged |

Engine part ids are positional in 1d (`i0`, `c0`); stage 1e's `{t: 'graph'}` names them. `smon / step / fxph / fxover` do not yet carry `i` / `c` (1e).

**main.js**: `monitors` subscriptions name their parts (Serum panel `['i0', 'c0']` — its FX page shows the meters; FX panel `['c0']`); `sync` posts `{t: 'mon', ids}` (sorted) instead of `smon`; `monitors.on` holds the joined ids; `monitors.fx(id)` replaces the two "monitoring on" checks for FX phases. `stats.per` → `cvCpu`: smoothed (EMA 0.25 per 0.25 s report ≈ 1 s), `i0` → the instrument module, `c0` → the FX module (`fxKey(model)`: a Serum's own FX), shown with `Module.setCpu(load)` (`cv-module.js`: "2.3%", "42%", "<0.1%", empty = none; tooltip). Power off clears them. `canonical-stream` skips `mon` as it skips `smon` (UI by design; its comment already named §6.8 `mon`).

## 3. Gates (M4 Max, node v24.21.0, 2026-10-18)

**Sound**: golden-classic 8/8, golden-fx 3/3, golden-presets 8/8, golden-random 1/1 (vs ref-p1, unchanged); **golden-graph** (new): the split engine vs `tests/ref-1c/engine.js` (engine.js at 1ea3c5b, SHA-pinned), bit for bit on every 32-bit word *and* every posted message (stats timing removed): 72 classic renders (12 models × presets + default, TB-303 synced), 86 Serum factory presets with their assets (factory samples, spectral, multisamples from the render farm, IRs; 84+ audible), 13 FX chains × (classic shared panel, Serum own FX), and 17 cases: note → 3 s silence → note on five models and behind a reverb tail (classic, Serum), OS 4 → 2 → 8 mid-note, Serum quality change mid-note, model switches mid-note (Juno → Serum → Prophet with the chain kept; DX7 Vintage DAC → Serum), panic, bye, TB-303 free-running, Serum arp, monitors (`smon` vs `mon`: same audio, same snapshots); plus the output-stage calls and DC state of the idle case identical.

**V8** (A/B in one process, separate scopes, 9 interleaved 1 s pairs, median per-pair ratio, ≤ 5 attempts above 1.02; 6 processes, alternating scope order; median ratio split / legacy):

| row | legacy | split | ratio | bench.json node |
|---|---|---|---|---|
| d | 0.4206 | 0.4073 | 0.971 | 0.40 |
| e | 0.0877 | 0.0873 | 0.996 | 0.083 |
| f | 0.1704 | 0.1698 | 0.999 | 0.164 |
| f' | 0.1302 | 0.1303 | 1.001 | 0.124 |
| g | 0.0968 | 0.0966 | 0.999 | 0.094 |
| g' | 0.1758 | 0.1755 | 1.003 | 0.171 |
| g" | 0.4518 | 0.4497 | 1.002 | 0.435 |
| h | 0.0478 | 0.0476 | 0.996 | 0.046 |
| h' | 0.0871 | 0.0871 | 1.003 | 0.085 |
| i (row itself) | 0.1470 | 0.1473 | 1.003 | — |
| c1–c6 (classic, OS 4) | 0.0443 / 0.0530 / 0.0121 / 0.0289 / 0.0290 / 0.0668 | 0.0438 / 0.0536 / 0.0122 / 0.0290 / 0.0289 / 0.0662 | 0.994 / 1.009 / 1.007 / 1.000 / 1.005 / 0.994 | — |
| q1 / q2 (preset switch, slowest quantum) | 0.208 / 0.610 | 0.187 / 0.605 | 0.90 / 0.99 | 0.4 / 0.76 |

A/A noise floor (legacy vs legacy) ±0.5 %; single processes vary ±2–5 % on a few rows (JIT luck), hence the 6-process medians. The legacy engine itself measures 1–5 % above the recorded `node` rows today (machine state), so the A/B ratio is the gate. FX rows j–m do not touch engine.js. Idle path (no notes, past 2 s): legacy 0.00012 → split 0.00014 (classic), 0.00027 → 0.00031 (Serum) — ≈ 0.1 µs per quantum, inside the §9.2 quiet budget 0.0005 (engine-track) and row p (0.00046 ≤ 1.5 × 0.002).

**JavaScriptCore** (macOS shell, both engines in separate `$262` realms, the rows exported from node, 7 interleaved 1 s pairs, 3 processes, median): d 0.993, e 1.016, f 0.985, f' 0.991, g 1.001, g' 1.001, g" 0.999, h 1.015, h' 1.000, i 1.001, c1–c6 1.008 / 1.000 / 1.012 / 0.998 / 1.006 / 0.998 — all ≤ 3 % (e / h / c3 repeat at 0.99–1.00 in shorter runs). Worst quantum (ms, split): d 1.16, e 0.33, f 0.60, f' 0.46, g 0.31, g' 0.55, g" 1.28, h 0.16, h' 0.34 — every row under its `worstMs` + 10 %.

**Allocation**: the bench GC check (rows d, g") and every `noAlloc` test pass; `v8-guard` imported first by both new tests.

**iPad**: not measured here. `tests/bench.html` loads and renders through the Track (bench.test's page wiring and bench-page pass); the user re-runs canvas.domlavin.com/tests/bench.html (five passes) and the rows go to `bench.json` for the §9.2 gate (median ≤ baseline × 1.05 or inside its spread).

The split met every gate, so the §6.11 mixin fallback was not needed.

## 4. Tests

- New: `tests/golden-graph.test.mjs` (6 tests, ≈ 2 min; GOLDEN_FULL=1 adds 44.1 kHz × 1 and Serum OS 1 / 4), `tests/engine-track.test.mjs` (8: structure, facade incl. overrides, hosts, stats per Inst / Chain with a test clock, `mon` ids, idle skip per Inst / Track, the §9.2 quiet budget, warm-up restore), `tests/ref-1c/` (frozen engine + MANIFEST.json).
- Changed: `canvas-sim` (the monitor test reads `mon` ids and checks the Serum module's parts; a module-CPU test), `cv-module` (setCpu), `canonical-stream` (`mon` skipped like `smon`).

## 5. Decisions the user / reviewers may revisit

1. **Generic facade** (every Inst 0 field / method, installed from the first Track) instead of the spec's ten named fields: the existing tests reach ~40 processor fields and override methods; one rule covers them all.
2. **Positional part ids** `i0` / `c0` until 1e's graph message names devices; main maps them to the module keys.
3. **Per-part CPU** from `Date.now()` (the worklet's only clock): unbiased but in whole ms, so main smooths over ≈ 1 s; small loads read "<0.1%". A Serum's own FX is timed inside `renderSerum` (two clock reads per span); its instrument figure excludes it. `pk` (per-part peak) waits for cable glow (1e).
4. The legacy reference for golden-graph is a frozen copy of the pre-split engine (like ref-p1), so 1e can render `{t: 'graph'}` against it for canonical shapes.
