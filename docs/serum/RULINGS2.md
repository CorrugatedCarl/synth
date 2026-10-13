# Lead rulings after Phase-2 M2 (binding addendum to SPEC-serum2.md)

Where an owner implemented and documented an IMPL choice or deviation in their file header, it is ratified unless overruled below.

## Bug fixes ordered
1. **Transport note-drop (Phase-1 engine defect, all models):** song notes exactly at the play/seek tick are dropped when the transport frame is not a multiple of 4, and loop-start notes are sometimes dropped on wrap through float rounding. FIX in engine.js (role I). The golden suite must stay bit-identical for every render whose events are unaffected; add the specific start/seek/loop-wrap cases as new expected-different golden cases with a test proving the notes now play. Document in tests/ref-p1/MANIFEST notes (do not edit the frozen files).
2. **MIDI held-channel patch (I2 → I):** apply `scratchpad/s2-I2/main-held-ch.patch` (held map keeps the note-on channel) + its main.test case; if the scratchpad copy is missing, re-implement from the description in I2's report.

## Ratified
- D1: Phase-1 filter types 0–95 keep their exact tuning; the FDN bank (type 82) may exceed the §14.2 2 MB/voice cap (≤ 4.3 MiB/voice at 384 kHz internal). §14.2 is amended accordingly; at 48 kHz base / 2x it is ~1 MiB.
- D2: Hz HOST on FREE LFOs re-anchors at play / seek / loop wrap and integrates the rate in between.
- D3: PD (Self) as implemented (raw-read feedback sample, self shift after the P stage, per-grain feedback in Granular); the §11.7 API additions (`nu`, `pdI`/`y1`, `mc`, `pdBlock`, `renderWarp2 opts.hz`, `renderSweep`, SxFilt2 `need`/`pool`) are accepted; Acid and Wsp recipe changes (header ⚑ items) accepted; **MG Dirty uses unity-normalised feedback gain** (no level jump vs other ladders); Diffusor "MB" means MiB, the §6.13.1 formula follows the implementation, 40 Hz floor above 192 kHz internal accepted, STAGES glide accepted; **distortion warps get a DC blocker**.
- D4: lazy SxWarp reads, PD (Self) as above, Granular per-stream output warps with stream-phase Flip, BPM LENGTH ladder as implemented.
- D5: peak phase-locking for moved spectra, ±2-bin Phase Lock, Scan Reverse starting at the region end.
- D6: RETRIG-off playhead keeps the clip-rate term (§7.5.2 prose); U4 and I compute the playhead the same way. Engine obligations: `proc.procs = PROCS`; `extEvents` calls `sxSeq.input(on, n, vel, 0, F, 1)`.
- F1: **FX state v2 everywhere.** In one coordinated change (integration step), `normalizeFx(v1, refs)` returns v2 with S1-variant instances (bit-exact with Phase 1); main.js `fxOf()`, presets, chains and the default preset handle v2; `v2Fx` is set by I. Engine calls `rack.assets()` on every processor after `storeAsset`/`dropAsset` for 'smp'/'smpdel'.
- S1: spec notes accepted (§10.2 Pad Chord loop 2–3.9 s; listed IRs mono; drum/break/arp loops render dry; render-farm event splitting at 4-frame granularity; loop-aware level decimation; 0.1 s baked loop crossfades; `odf[0] = 0`).
- U3: U1 adds U3's extra items to serum-ui's control menus (then "Limiter Latency Comp" leaves the module menu and RETRIG moves per spec); FX Filter "& FFT" views are deferred (no spectrum tap) — documented deviation.
- U5: the two touch/input deviations are accepted as written.
- I: preview node reuse (8 s) accepted; "Resample to" importing user samples for sample-type oscillators accepted; the two localStorage bookkeeping keys accepted.
- I2: `targets()` routing on MPE channels as implemented and documented.
- C1/U1: `seqN`/`setDestBase`/`destBase` and `virtGet`/`virtSet` must handle `arp.rate` in HZ mode (fix in integration).

## Performance
- CPU timing gates that are flaky under parallel test load must be made robust (calibrated pairs, retries) — not loosened. Remaining D1 per-chunk caching work happens in the M4 performance pass, keeping Phase-1 bit-exactness.
