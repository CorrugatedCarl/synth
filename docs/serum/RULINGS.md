# Lead rulings after M2 (binding addendum to SPEC-serum.md v2)

Where a module owner implemented a documented deviation, that implementation is now normative unless overruled here.

## serum-core (E1)
- §3.2 display rules (a)–(e) as implemented: ACCEPTED (precision/unit/sign from the printed value; pan "C"; delay-offset detent windows on printed hundredths; reverb "inf" from n ≥ 0.999).
- §10.2.8 erratum: `midiValue('a.semi', 64)` = 12/24 (cc 67 → 13/24). The §8.1 formula stands.
- §4.1: `veloPorta`, `notePorta` (0/1) are part of CP. serum-dsp MUST honour them (§6.1 VELO re-capture on legato notes; §3.12 NOTE uses the gliding pitch when notePorta) — integrator verifies and wires if missing.
- §8.1 extra exports (`compileFxT`, `MODULE_FIELDS`, `REV_LABELS`, `CMP_RATIO_DETENTS` as knob positions, `FX_MODULES`, `SUB_SHAPES`, `MODFX_LADDER`, `eqGainDb`, `MEMSET_DEFAULT_A/B`, `groupItems` etc.) ACCEPTED. Bus pruning: prune only buses that lost their links; `copyLfo`/`vibratoAssign` prune; standalone `pruneBuses(s)` sweeps all.
- Unison Random mode rows = 0 in `uniTables`; DSP draws per note: ACCEPTED.
- Compiled-version minor numbers are fractional `ver` (e.g. 2.1): ACCEPTED for E1/E3/E4 alike.

## wt.js / wtedit / wtstore (E2)
1. §10.3.5 reads: "level ℓ is flat ±0.1 dB up to 0.40·rate/2^ℓ; components folding below 0.40·rate/2^ℓ are ≤ −80 dB; 0.40–0.50·rate/2^ℓ is the transition band". ACCEPTED.
2. Send to Noise / LFO→Noise sets `oneshot = 0` and `keytrack = 1`: ACCEPTED; serum-ui's `lfoToNoise` must match.
3. Aliasing gap: resolve in the §7.4 LEVEL RULE (E3's implementation: level 0 only with headroom; next level reaches the audible limit), not by longer tables. Target: ≤ −70 dBc everywhere the spec tests, ≤ −74 dBc typical.
4. Optional `loopWhole` on noise records: ACCEPTED; serum-ui WAV drop passes it when known.
5. Held split size takes precedence over the 2048-multiple rule for every audio import: ACCEPTED.

## serum-dsp (E3)
- §6.16: `reset()` keeps `sx.mon`; `transport(proc, true)` additionally clears portamento start pitch, Mem phases, most-recent voice and the mono source vector: ACCEPTED.
- §6.12 Env-mode anchored LFO wrap behaviour as implemented: ACCEPTED. §5.3 NOTE updates on legato notes: ACCEPTED.
- §7.4 level-0 headroom and narrower 1x blend band: ACCEPTED as normative.
- §10.4.7 / §6.7 / §3.3 wording conflicts: the current implementation is normative.

## fx-dsp (E4)
- Delay lines at half rate above 96 kHz (4 MB budget): ACCEPTED.
- Synced delay values longer than the 2 s line: clamp to the longest value that fits, and the UI shows the effective (clamped) time. ACCEPTED as the rule.
- Decisions 1–3, compressor crossover CPU, transport re-seed of short lines, stricter `idle()`, 10 ms distortion enable: ACCEPTED.

## serum-ui (E5) / wk, graph, fx-ui (E6)
- Host additions ACCEPTED (integrator implements): `wt.rename`, `editorOpen`/`ui.editorOsc`, `prefsChanged`, `seed` edit option, `view3d` in `withPrefs`, optional `host.tip(destId)` for FX knobs (serum-ui's rack adapter MUST pass `tip`), shared chain-file format `{type:'synth.fxchains', v:1, chains:[{name, fx}]}`.
- §9.9: while the wavetable editor is open the mod wheel scrubs WT POS — integrator wires it.
- §8.6 Sine preset = 9 points at x = k/8 with fitted curvatures, error ≤ 0.01: ACCEPTED.
- wk.knob must redraw when the bipolar flag changes (integrator/E6 fix if still missing).

## Test command
`node --test 'tests/*.test.mjs'` (node 24 rejects a bare directory).
