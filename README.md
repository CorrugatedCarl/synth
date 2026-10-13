# SYNTH — circuit-level analog synthesizer emulations

Live at **https://synth.domlavin.com**

Twelve landmark synthesizers (1965–1983) playable in the browser, generated in real time by a custom
AudioWorklet DSP engine — no samples:

| Year | Instrument | Core models |
|------|-----------|-------------|
| 1965 | Moog Modular (System 55) | 921 VCOs, 904A transistor ladder, 904B HPF, 911 envelopes |
| 1970 | Minimoog Model D | 3 VCOs, mixer overdrive + external-input feedback, ladder filter, low-note priority |
| 1971 | ARP 2600 | 3 VCOs, ring mod, S&H, 4072 four-pole filter, ADSR + AR |
| 1974 | Solina String Ensemble | MK50240 divide-down (real divisors, phase-locked octaves), 3-phase BBD ensemble |
| 1977 | Yamaha CS-80 | dual channels, 12 dB resonant HPF + LPF per channel, IL/AL envelope, touch |
| 1978 | Sequential Prophet-5 | CEM3340 VCOs, sync, Poly-Mod, CEM3320 / SSM2040 filter |
| 1978 | Korg MS-20 | Korg 35 Sallen-Key HPF + LPF with diode-clipped resonance |
| 1981 | Roland TB-303 | coupled 4-node diode ladder, accent sweep circuit, slide |
| 1981 | Oberheim OB-Xa | state-variable 2-pole / 4-pole filter, sync, 8-voice unison |
| 1981 | Roland Jupiter-8 | cross-mod, sync, IR3109 12/24 dB OTA cascade, HPF |
| 1982 | Roland Juno-60 | DCO + sub, IR3109, MN3009 BBD chorus I / II / I+II with hiss |
| 1983 | Yamaha DX7 | 6-operator PM, all 32 algorithms, 4-rate/4-level EGs, 12-bit floating DAC emulation |
| 2014 | Serum-style wavetable synth | 3 oscillators (wavetable, multisample, sample, granular, spectral; 2 warp slots each incl. FM / PD / AM / RM, 16-voice unison), sub, colour noise, 2 filters (108 types), mixer with direct out and 2 FX buses, 4 envelopes, 10 LFOs, 64-slot drag-and-drop matrix with curves and slew, arpeggiator and clip player, MPE, microtuning (.scl / .kbm / .tun), wavetable editor; every wavetable, sample, impulse response and preset original (factory samples generated on the device) |

## Engine

* 64-bit floating-point DSP at 1×/2×/4×/8× the device rate (capped at 384 kHz internal),
  decimated with cascaded Kaiser half-band FIRs (~100 dB stopband).
* Zero-delay-feedback filters with per-sample nonlinear (tanh) linearisation; diode ladder and Sallen-Key
  solved implicitly as coupled capacitor networks.
* PolyBLEP / PolyBLAMP oscillators, free-running phase, component tolerances, thermal drift (Ornstein–Uhlenbeck).
* Measured aliasing on a C7 sawtooth: −41 dBc (1×), −53 dBc (2×), −76 dBc (4×), −96 dBc (8×).

## Studio

* Unlimited tracks, each its own synth instance (any of the 13 models + preset), with volume, pan, mute, solo, arm and a MIDI input channel (Omni or 1–16) — play several synths at once from a multi-channel controller.
* Every track has an effects rack (FX tab) of 13 module types — Hyper/Dimension, distortion, flanger, phaser, chorus, delay, compressor, reverb (Plate, Hall, Vintage, Nitrous, Basin), EQ, filter, frequency shifter, convolution, utility — plus band / mid-side splitters, any order and several of a type; Serum tracks add two bus racks. Factory effect chains and racks, user chain library, saved with the project.
* Sample-accurate song playback scheduled inside the audio engine; seamless loops; tempo / time signature; metronome with count-in.
* MIDI / keyboard recording (overdub or replace, optional input quantize), including pitch bend, mod wheel, sustain and aftertouch.
* Piano roll: draw / select / erase, snap grids incl. triplets & dotted, velocity lane, quantize (grid, strength, swing, starts/ends), transpose, velocity tools, legato, humanize, stretch, reverse, fix overlaps, split, cut/copy/paste/duplicate, undo/redo.
* Arrangement: bar-range copy / paste / duplicate / clear / delete / insert, loop from selection.
* Save/open projects (.json), Standard MIDI File import/export, offline WAV bounce (16/24-bit PCM or 32-bit float, up to 8× oversampling).

* Projects autosave in the browser (IndexedDB, with the older localStorage data kept as a fallback); imported samples and
  wavetables live in the browser's storage and are embedded in saved project and preset files.

No build step — static files only: the page (`index.html`, `style.css`, `main.js`, `song.js`, `roll.js`, `arrange.js`),
ES modules (`models.js`, `serum-core.js` and its siblings, the panels), and the AudioWorklet scripts (`sx-*.js`,
`serum-dsp.js`, `fx-mods2.js`, `fx-dsp.js`, then `engine.js`). To run locally serve the folder over HTTP (AudioWorklet
needs a secure/localhost origin). Tests: `node --test 'tests/*.test.mjs'` (node ≥ 20); CPU bench in a browser:
`tests/bench.html`.
