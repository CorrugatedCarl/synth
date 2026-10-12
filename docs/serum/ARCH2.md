# Serum Phase 2 (Serum 2 additions) — lead architecture decisions

Feature authority: `docs/serum/serum-inventory.md` **Part B** (B1–B27) + Part C open questions. Phase 1 contract: `docs/serum/SPEC-serum.md` v2 + `RULINGS.md`. The Phase 1 code that now exists in the repo (serum-core.js, serum-dsp.js, fx-dsp.js, wt.js, wtstore.js, wtedit.js, wk.js, graph.js, fx-ui.js, serum-ui.js, wtwork.js, engine.js, models.js, main.js) is the baseline — Phase 2 extends it; read it, don't re-invent it.

## Scope
Everything in Part B that can exist in a browser:
- 3 main oscillators; oscillator types Wavetable / Multisample / Sample / Granular / Spectral with all their controls; per-osc routing (filter balance, Main/Direct/None, Bus 1/2 sends); pitch modes (Semitones/Harmonics/Ratio/Step); 2 warp slots per oscillator with every S2 warp (incl. true FM thru-zero/exp/linear, PD, distortion warps, filter warps, AM/RM sources), Smooth interpolation, phase-memory menu; per-osc unison panel.
- Sub/Noise deltas (Triangle, coarse, phase; White/Pink/Brown/Geiger, stereo, filter).
- Two filters with routing, all S2 filter types incl. the "New" category; Mixer page.
- FX: Main rack + Bus 1 + Bus 2 racks with sends/returns, every changed module behaviour and every new module (incl. Bode/frequency shifter, Convolve, Utility, Splitter or whatever Part B lists), new reverb types with per-type controls, new distortion modes.
- Modulation: S2 envelope count and Start/End levels, S2 LFO count and modes (FREE/RETRIG/ENVELOPE, HOST anchor), VELO/NOTE curves, S2 macro count, every new matrix source/destination, voice-steal priority (5 options), voice control.
- Arpeggiator and Clip sequencer (complete), Keyboard panel (transpose, key/scale, swing, osc mapping with key/velocity ranges, FOLD/WARP), MPE (bend range 1–96 etc.), tuning (.scl/.kbm/.tun files; MTS-ESP is impossible in a browser — document), Quality Draft/High/Ultra + S1 compatibility mode, preset-browser additions (Hybridize, ratings, preview).
- Wavetable editor deltas.

## Non-negotiables
1. **Backward compatibility**: every Phase-1 Serum state, preset, project and user table must load and sound identical (S1 compatibility mode / versioned state with migration). The 12 classic models and the FX rack on non-Serum tracks must stay sample-identical when unused features are off.
2. **Original content only**: no Xfer samples, wavetables, IRs, presets or text. Factory multisamples/samples/granular sources/IRs are generated procedurally or rendered from this project's own synth engines (e.g. render the Juno/Minimoog/DX7 models offline into multisamples) — document the generator.
3. **Browser constraints**: no deps, no build; worklet code is classic IIFE scripts with no imports (Phase-1 §0.2 rules apply); heavy analysis (sample decoding, pitch/loop detection, spectral analysis/STFT, IR preparation) runs on the main thread or in `wtwork.js`-style module workers, never on the audio thread; large buffers are transferred, cached per AudioContext, and included in `processorOptions` for offline bounces.
4. **Performance**: must stay usable on an iPad Pro (Safari) — define CPU and memory budgets per feature, cheap bypass when features are unused, automatic quality reduction hooks.
5. **File ownership for parallel work**: split new worklet DSP into new classic scripts (e.g. a sample/granular/spectral oscillator script, an arp/clip-sequencer script) loaded in a defined order before serum-dsp.js, so engineers don't collide in one file; each existing file keeps a single owner during the build.
6. Keep the site code style; everything node-testable as in Phase 1.
