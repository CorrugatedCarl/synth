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

## Engine

* 64-bit floating-point DSP at 1×/2×/4×/8× the device rate (up to 1.5 MHz internal at 192 kHz × 8),
  decimated with cascaded Kaiser half-band FIRs (~100 dB stopband).
* Zero-delay-feedback filters with per-sample nonlinear (tanh) linearisation; diode ladder and Sallen-Key
  solved implicitly as coupled capacitor networks.
* PolyBLEP / PolyBLAMP oscillators, free-running phase, component tolerances, thermal drift (Ornstein–Uhlenbeck).
* Measured aliasing on a C7 sawtooth: −41 dBc (1×), −53 dBc (2×), −76 dBc (4×), −96 dBc (8×).

No build step — static files only (`index.html`, `style.css`, `main.js`, `models.js`, `engine.js`).
To run locally serve the folder over HTTP (AudioWorklet needs a secure/localhost origin).
