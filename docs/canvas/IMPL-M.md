# Stage M: the Master canvas (IMPL-M) — contract

ROADMAP row 13. **Scope (the user's agreement, 2026-10-22, relayed by the lead — settled, not re-asked)**: a **Master** row in the
track list opens a **master canvas**: the same Serum-style FX rack every track has, on the combined mix (mastering: EQ, compression,
saturation, …), and the master OUT with the final combined waveform, spectrum and meters; **effects and analysis only** (no instruments
on the master); **bounces go through it, bit-exact with playback**; **an empty master rack leaves every existing sound bit-identical**;
a **LUFS loudness meter with true peak**; a **mono / phase-correlation check**; a **one-tap master bypass** for A/B; **send buses**
(a shared reverb) a possible later step, **not in this stage**. Standing: the performance presets are visual only (cords, face
textures) and nothing here adds a preset lever; no artificial caps; native pinch only; never move layout for browser chrome; no
per-stage iPad session (one real-device pass after the features); canvas only.

Map: [map-master.md](map-master.md) (facts with file:line at 16a01e7), cited "map §n". **Code references are to `canvas` at 16a01e7**;
the builders' base is stage P's squashed commit **41e23f7** (line numbers move; names don't). Tags as before: **[R]** a fact, **[R?]** unconfirmed
(the lane pins it), **[C]** a choice made here (a builder may refine a [C] with a reason in §12, never an [R]). **Skeptic-reviewed
2026-10-22 (§13)**: its fixes are in the text. **The lead's decisions (2026-10-22)**: P-1 **(b)** — quantum-aligned anchors while the master holds
an effect; §7.3's canonical-stream **partition by processor name** (the `synth-engine` part equal to main's fixture, `synth-master` its
own fixture, any other name fails); the Master row's place settled by ROADMAP 13's "pinned" (the lead's proposal the user agreed to) =
§5.1's footer; Q4 settled as **Volume** (its option (b) breaks the user's "every existing sound bit-identical"); Q1–Q3 + the extras
asked. **The user's answers (2026-10-22 — settled)**: Q1 **"Same as playback"** is the Bounce dialog's default; Q2 **A/B is
listening only** (the bounce always includes the master effects); Q3 **level-matched A/B**; extras: **all four taken** — O1 the stereo
image scope (goniometer), O2 Auto tail, O3 LRA, O4 Loudness normalise (§9, now in scope).

**Invariants**
- **M1 Empty = today.** With an empty master rack (no instance, or every instance off: the FXRack is `calm`, fx-dsp.js:2751,
  3132–3151 [R]) the master processor's output **is its input, bit for bit** (a copy, no arithmetic: float32 in → float32 out; the A/B
  on an empty rack too, §3); every frozen golden (golden-classic / -fx / -presets / -random / -graph, golden-drums / -606 / -909 / -sdsv,
  golden-moog, golden-moog-b, the ref-9-core pin, ref-P) is untouched; **a Bounce WAV of an existing project at the same dialog
  settings is byte-identical** to the base build's (the dither seed is fixed and exact silence is never dithered, song.js:946–953 [R] —
  one sample that differs shifts every later dither value: only an exact copy passes).
- **M2 Export = playback.** The bounce runs **the same processor class** on the offline sum, fed the same compiled rack (compiled
  without the safeguard's quality step both ways, §2.1) and the same transport anchoring. **Bit for bit** when the rack sees the same
  call partition relative to the song: identical track outputs, a silent history (exact zeros ≥ 0.25 s before the start: the re-seed
  rule, fx-dsp.js:69–77 [R]) and a start on a quantum boundary. The offline song starts at frame 0; a live one at its anchor frame,
  today any 4-frame point (main.js:1525; engine.js:4484, 4638 [R]); the rack's glides run per call, its control blocks (16) restart
  at each call and the Flanger / Phaser / Chorus LFOs step per block (fx-dsp.js:2768–2829, 716–718, 760–761, 814–816 [R]) — so an
  unaligned live start differs from the file below a bound G2 measures (P-1 proposes aligned anchors). Not in an export, by design and
  said in the dialog: the listening controls (§3: the Volume slider, Mono, the A/B bypass — Q2) and the metronome (as today). Not the
  same, as today: the tracks themselves when the dialog's rate / oversampling differ from playback's (map §3 (a)–(f); **Q1**).
- **M3 Tracks untouched.** Every Track node, its options and its messages are as today (with P-1 (b): the transport `frame` of a
  project whose master holds an effect moves to a quantum boundary, nothing else); the master is a separate processor
  (`'synth-master'`), registered **before** `'synth-engine'` (six harnesses take the last registration as the Track: golden-harness.mjs:86,
  dsp-scope.mjs:99, main-sim.mjs:104, integration.test.mjs:40 / 706, engine-track.test.mjs:2758 [R]; smprender.js and cv-cost.js:344
  capture `synth-engine` by name [R]).
- **M4 The meters measure the mix, never steer the exported path.** Subscribing or not changes no sample. The one listening-path use is
  Q3's A/B match: a gain frozen at the tap, on the bypassed signal, never in a file (were Q2 answered (b), the frozen gain would travel
  as a number in the bounce's options, never re-measured offline).
- **M5 No preset lever.** Nothing here reads the performance preset; the master OUT's drawing is budgeted to be cheap at every preset
  (§6), not throttled by one.

---------------------------------------------------------------------------------------------------------------------------------

## 0. What exists (map §1–§7; the lines most likely to change: map appendix)

| piece | where [R] | M |
|---|---|---|
| The sum: one `synth-engine` node per track → `GainNode` (fader) → `StereoPanner` → **`master` GainNode (`settings.master`, default 0.8, per device)** → `destination` + an unread 8192 analyser `an`; the metronome → `metroBus` → `destination` (outside the mix); the preset preview → `master` | main.js:990–993, 1051–1054, 2979–2985 | the master processor goes between the sum and the level (§1) |
| `settings.master` is a **device** preference (localStorage `synth.settings`), labelled "Master" in the top bar and "Master level" in ⚙ | main.js:109; index.html:107, 136 | renamed **Volume** — a listening level, outside exports as it is today (§3, Q4) |
| Per-track output stage only (DC block, −1 dBFS limiter, ±1 clip); nothing after the sum; dither only in `encodeWAV` | engine.js:4852–4867, 1213–1243; song.js:946–953 | unchanged; the master adds nothing when empty (M1) |
| The FX rack: FX v2 state; `FXRack` on Float64 blocks ≤ 128; an empty / calm rack returns at once leaving L/R untouched; rack bypass with a 5 ms crossfade, units frozen when fully bypassed; per-rack 32 MB cap → `fxover`. **`rack.latency` is not the rack's delay**: `lat()` = the longest Limit-mode look-ahead on MAIN (incl. its splitters' branches), read by nobody — a Distortion delays its whole output 15 samples and units in series add | fx-core.js:663–669; fx-dsp.js:2094, 2749–2754, 2751, 2872–2890, 2662–2679, 1984, 49–50, 465, 1023; engine.js:2335 | reused as is; `pathLat()` added (§1.2) |
| Host rack plumbing keyed by track: `nodes`, `syncNodes` (drops non-track ids), `monitors`, `fxHost.T()`, `fxOfDev`, `fxEditDev` (not in History), `tables.ensure({trackId})`, `postAll`, `whenReady`, `statsText`, `queueAll`, `applyRestore` | main.js:1139–1149, 2382–2423, 3143–3170, 2460–2469, 1094, 1176, 934, 1240–1253, 778, 1455–1484 | a master record beside `nodes`, not in it (§2) |
| History: undo / redo never revert knob tweaks — `applyRestore(p, true)` copies every device's current `vals` / `fx` into the restored tracks (`keepDevs`); FX rack edits, adding an effect included, are not History steps | main.js:1444–1456, 1465, 2452–2455, 5934–5936 | the master rack the same way (§2.3) |
| Assets: the manager's `states()` = the tracks' Serum / panel / drum states (users, relink, learn); `portPoster` posts to the track's node, else the given node; a store message lands in the scope's shared store and `ALL` announces it to every processor's racks | main.js:2306–2318; assets.js:365–372, 566, 1328–1336, 1769–1772; engine.js:1674–1675, 3944–3950, 4068–4072 | MASTER takes the store messages and joins `ALL`; the master rack joins `states()` (§1.2, §2.2) |
| Bounce: `bounceSet` → `renderOffline(sr, frames, items)`: per item node → gain → pan → `bus` (gain 1, created before the items) → `destination`; then peak scan, ×k to 0.999 or Normalise to −0.3 dBFS, `encodeWAV`; dialog defaults 48 kHz / 24-bit / OS 8× / tail 2 s; `renderOffline` also serves resample and render-last (one Serum through its own FX) | main.js:4278–4338, 2790–2816, 2840, 2903; index.html:300–307 | the bounce alone gets the master after `bus` (§4) |
| Track list: `#heads` / `#lanes` row-aligned (56 px) inside the scroller `.arrwrap`, `topSnaps(n)`; the chip's list `trkListUI` and the dots; `trk()` = selected track; `selectTrack(id)` returns early for the selected id; the keyboard / MIDI / roll follow `trk()` | main.js:3721–3779, 4900–4930, 1924–1926, 319, 1734; style.css:201–204; cv-tray.js:26, 56–62; arrange.js:338 | the Master row is a **footer** outside the scroller (§5.1) |
| A track's canvas: `cvRender` → `createTrackView(W, trk(), cvHost())` (≈ 20 callers), devices = `devicesOf(t)` + the project Mod Wheel / Pads; OUT = one `{kind:'out'}` device whose body is the shared `.scope` node; `scopeSource()` ("A Master canvas returns `an` here"); `cvLay` / `cvTidy` / `cvDropInstrument` / the cvHost callbacks write or read `trk()` | main.js:5334–5361, 5440–5466, 5588–5622, 5763, 5806, 6680–6697, 5257–5314, 4753–4798; cv-module.js:270–282, 943–958 | the master canvas: its own view and host (§5.2) |
| Project data: `deserialize` whitelists project keys (precedents `perf`, `pads`); History snapshots carry project keys in `m`; `toV1` drops new keys with a `lost` line; `upgrade` stamps every save with SCHEMA (13 after stage P) | song.js:666–725, 429–434; cv-migrate.js:102, 148–157, 233–235 | `project.master`, schema 14 (§2.3) |
| Tests that see the sum: none sum tracks except main-sim's offline renderer — gain / pan paths only, **`paths()` passes through any other node as a wire**, the mix one Float32 rounding of a Float64 sum, `process([], …)` for every worklet; ≥ 15 assertions read `sim.lastOffline.nodes[0]` as the first track; canonical-stream records every worklet node + message (main's fixture, "the canvas build must reproduce it exactly"; `smon` / `mon` / `fxph` left out by design); canvas-sim finds the master analyser as `pan.outs.find(gain).outs.find(an)`; the DSP list is pinned by count / content in app.test, canvas-3-sim, wk.test, sx-base.test, bench.test | tests/main-sim.mjs:160–171, 248–267, 330–345; accessors.test.mjs:141–155, 458; canvas-7a-sim:350, 577–582; canvas-7b-sim:311, 439, 658–666; canvas-7c-sim:336–597; graph-host.test.mjs:262, 538; canonical-stream.test.mjs:1–26, 88–95; canvas-sim.test.mjs:604–650 (611); app.test.mjs:165; canvas-3-sim.test.mjs:103–108; wk.test.mjs:2234–2240; sx-base.test.mjs:426–430; bench.test.mjs:117–118 | main-sim learns inputs (§4, §7); the two pins change by design (§7.3) |
| Analysis prior art: none for LUFS / K-weighting / true peak / correlation; in-worklet `peak2` summaries posted every ≥ 33 ms (`smon`); analysers give per-rAF snapshots (not gap-free) and **down-mix to mono** [R: the Web Audio spec's AnalyserNode "time-domain down-mixing" (½(L+R) for stereo, whatever the node's own channel settings); WebKit's conformance R?] | map §6; engine.js:3411–3428, 4796–4850 | the meters run in the master processor and post summaries (§1.3) |

---------------------------------------------------------------------------------------------------------------------------------

## 1. The master processor (lane D)

### 1.1 Graph [C]
Live: `pan(each track) → MASTER('synth-master', 1 stereo input, 1 stereo output) → mono stage → level ('master' GainNode, the
Volume) → destination`; `an` (8192) moves to **MASTER's output** (the scope shows what is exported, pre-Volume); a second analyser pair
for the OUT's L/R is **not** added (the correlation is computed in the processor). Node options: `numberOfInputs: 1, numberOfOutputs: 1,
outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers'` (`inputs[0]` is `[L, R]`
whenever a connection is active — a mono source is up-mixed by Web Audio — and `[]` when none). The preview node joins the sum as
today [C: a preset audition is heard through the master effects and counts in the meters; the integrated value resets at ▶]. The
metronome stays outside. MASTER is created **once, in `powerOn`, before any track node** (on WebKit the context is held suspended
there: main.js:983–989 [R]; no iOS warm-up stall, HANDOVER.md:144–145 [R]; main.test.mjs:504 asserts every processor is built while
held [R]), and **always exists** while the engine is on. Always-on is decided by the scope, not only by the re-wire risk: the meters
(LUFS, true peak, correlation of the mix) are wanted with an empty rack, so the processor exists anyway, and an empty rack is the calm
FXRack's O(1) return; lazy insertion would also re-wire live (a one-quantum gap or a doubled sum if the browser applies a
`disconnect` / `connect` pair in different quanta [R?]). Cost: one processor call + the meters every quantum (G4, with the floor
projection).

Offline (bounce only, **always**, empty or not — one path; M1 by the copy): `bus → MASTER(offline) → destination`, MASTER created
**after every track node** (its constructor's `set()` finds the stores node 0 brought, engine.js:3557–3561 [R]; `sim.lastOffline.nodes[0]`
stays the first track). Resample and render-last stay pre-master (map §1.7).

### 1.2 Inside MASTER (engine.js, a class beside `Track`, registered before it) [C]
Per quantum (n = `outputs[0][0].length`): read `inputs[0]` (`[]` → silence, never a throw: main-sim passes `[]`); empty / calm rack →
**copy** in → out (M1) and still feed the meters; else Float64 L/R ← input, `rack.process(L, R, n)` (MAIN only, no buses: the master has
no sends), out ← float32(L/R). Its rack is a `Chain` (engine.js:3459–3470). **One split at most**: a pending transport start is applied
at its frame by the Track's rule (the first 4-frame boundary ≥ frame − 0.5, engine.js:4484, 4638 [R]) — two rack calls around it,
`rack.transport()` between them; nothing else splits (with P-1 (b) the anchor is a quantum boundary and nothing splits).

Messages (the Track's names and shapes where they mean the same):
- `{t:'chain', fxr, fxrT}` → `rack.set` (compiled by `CG.chainPatch` with `qr: null`, live and offline — §2.1);
- `{t:'transport', …}` → the Track's pend / apply rule (golden-harness.mjs:196–201 [R]): a start (seek, or from a stop) → `rack.transport()`
  and, from a stop, the meters' integrated / max-hold reset — both at the anchor frame; a stop → `rack.reset(true)` when `fxr.silence`
  (engine.js:4429–4438 [R]); a re-anchor without seek and a loop wrap re-seed nothing (engine.js:4473–4478, 4495–4504 [R]);
- `{t:'panic'}` → `rack.reset(false)` (tails cleared at once, as a Track's racks);
- `{t:'mon', ids}` — the Track's shape, what `monitors.sync` posts — with ids ⊆ `['meters', 'mfx']`: 'meters' → `{t:'mmon', …}` every
  ≥ 33 ms of audio (§1.3); 'mfx' → `{t:'smon', c: 'mfx', gr, ftap, fxph}` for the rack's displays, as a Track's panel (engine.js:4839–4843);
- `{t:'fxtap', id}`, `{t:'fxph'}` → the rack's tap / phases, answered `{t:'fxph', v, c: 'mfx'}` (engine.js:3984, 4037–4042 [R]: the Delay
  display and the LFO dots need them);
- `{t:'bypass', on, g}` (§3: MASTER's own A/B), `{t:'mreset'}`;
- the store messages `wt` / `wtf` / `wtdel` / `smp` / `smpdel` exactly as a Track handles them (engine.js:3944–3950: the shared store,
  `assetsChanged()`) — the asset manager posts the master's IRs to MASTER (§2.2);
- out: `{t:'ready'}` (live, after its warm-up), `{t:'stats', load, per: [{id: 'mfx', load}]}` every 0.25 s (the rack module's CPU slot),
  `{t:'fxover', ids}`, `{t:'mmon'}`, `{t:'smon'}`, `{t:'fxph'}`; offline `{t:'mlat'}` / `{t:'mfinal'}` (§1.4).

MASTER joins `ALL` with an `assets()` (its rack's `assets()` + `fxover`, as engine.js:4068–4072). No ModCore (no modulation of master
knobs in this stage — the FX units' own LFOs run), no notes (RETRIG and key tracking idle on the master, §11). `MASTERDSP` is read in
the constructor, never at load (engine.js reads every DSP global at use, engine.js:1660–1662 [R]): engine.js still loads in every scope
without master-dsp.js (smprender, cv-cost's Measure, the frozen-golden harnesses), and a MASTER without it passes audio and posts no
`mmon`.

Warm-up [C]: the meters are new code running from the first quantum; cold code on JavaScriptCore is the stall pattern WebKit keeps as
latency (HANDOVER.md:144–145 [R]). MASTER's constructor runs its `Meters` (and Q3's input meter) over ≈ 0.25 s of synthetic noise and
resets them before posting `ready` — while main.js holds the context. The rack's classes are warmed by the first Track's warm-up
(engine.js:3550 [R]); **[R?] the lane measures** a first non-empty `chain` on MASTER on jsc and, if it stalls, MASTER calls
`rack.warmUp()` once at construction.

Latency: `rack.latency` is not the rack's delay (§0). Lane D adds **`FXRack.pathLat()`** to fx-dsp.js (additive; the frozen goldens
prove no sound change): the sum along MAIN of each running unit's output delay — a Limit-mode compressor's look-ahead `La`
(fx-dsp.js:1023 [R]), a Distortion's 15 samples (:465), a splitter its aligned longest branch (:1874–1894) — each unit type × its
latency-relevant modes proven by an impulse test. MASTER reports it in `stats` and `mmon.lat`. **Live is not compensated** (the
playhead and the metronome run ahead by it: ≤ 10 ms per Limit-mode compressor, 15 samples per Distortion, in series); **the bounce
is** (§4).

### 1.3 The meters (new file `master-dsp.js`, global `MASTERDSP`, pure, testable in node; MASTER owns one `Meters`) [C]
- **Loudness, ITU-R BS.1770-4 / EBU R128**: K-weighting = the two **published 48 kHz biquads** carried to the context rate through their
  analog prototype — invert the bilinear transform of each (prewarped at its own corner, K₄₈ = tan(π f₀ / 48000): ≈ 1681.97 Hz for the
  shelf, ≈ 38.135 Hz for the high-pass) into an s-domain biquad, re-discretise at fs with K = tan(π f₀ / fs). The 48 kHz round trip
  reproduces the published coefficients by construction (≤ 1e-6, the check) — our own derivation, no fitted constants, no third-party
  code. Not a cookbook shelf from (f₀, +3.99984 dB, Q 0.7072): the published shelf's middle numerator term is not the cookbook's √A form
  [R?: the lane shows the miss]; and the high-pass keeps the published numerator [1, −2, 1] unnormalised (+0.043 dB in its passband at
  48 kHz, part of the −0.691 calibration: a normalised high-pass reads ≈ 0.04 LU low). The 44.1 / 88.2 / 96 / 192 kHz responses within
  0.05 dB of the 48 kHz one from 20 Hz to 16 kHz (measured, recorded). Channel weights 1 / 1, `L = −0.691 + 10·log10(Σ mean squares)`;
  **momentary** (400 ms) and **short-term** (3 s) from a ring of 100 ms sub-block energies (0.1·fs is whole at every offered rate);
  **integrated** (400 ms blocks = 4 sub-blocks, 100 ms hop, absolute gate −70 LUFS, relative gate −10 LU) from a **preallocated
  histogram** (0.01 LU bins from −70 to +10 LUFS, each bin its block count and its blocks' exact energy sum — no allocation, any length; a
  block above +10 LUFS (nothing limits the sum, map §1.3) goes in the top bin with its exact energy; the gate's error is confined to the
  blocks in the threshold's bin); computed when a summary is posted, never per block. Filter states flushed to 0 below 1e-30 once a
  quantum (denormals on silence). **LRA** is not in this stage (optional O3).
- **True peak** (BS.1770-4 Annex 2's method, our own filter): 4× at ≤ 48 kHz, 2× at ≤ 96 kHz, 1× above; an **L-th-band Kaiser-windowed
  sinc of our own** (4 × 16 + 1 taps at 4×, 2 × 16 + 1 at 2×: the phase-0 branch is a pure delay, so the true peak is never below the
  sample peak); per channel, **max-hold** dBTP until reset. Accepted by synthesised tones ≤ 0.4·fs (fs/4 at 0° and 45° phase; 1 / 5 / 10 /
  15 kHz; 0.4·fs) at 44.1 / 48 / 96 kHz within **+0.2 / −0.4 dB** of their analytic peak (EBU Tech 3341's true-peak tolerance); the
  under-read above 0.4·fs is measured and recorded (an interpolator flat to 20 kHz at 44.1 kHz × 4 would need ≈ 150 taps). The summary
  also carries the sample peak (gap-free, per channel) for the meters' bars.
- **Correlation**: `E[LR] / √(E[L²]·E[R²])` with one-pole averages, τ 300 ms, on the unweighted signal; NaN (shown "—") while either
  side's mean square is below 1e-20 (silence, one side silent); posted as one number −1…+1.
- Summary `{t:'mmon', m, s, i, tp:[l,r], tpMax, pk:[l,r], corr, lat}` (dB / LUFS as numbers, `-Infinity` for silence). Reset rules:
  integrated and max-hold reset at a transport start from a stop (at its anchor frame), on `mreset` (the OUT's reset tap), and on an
  engine restart (power cycle, sample-rate change); a pause or a seek while playing does not.
- Cost [C, gated §6]: per channel-sample 2 biquads (≈ 10 flops) + 64 MACs (4 phases × 16 taps) + 3 accumulators — the true peak is
  ≈ ¾ of it. The meters run every quantum the engine runs (so the integrated value is right when the OUT is opened mid-song). If G4's
  floor projection fails, the true-peak stage runs only while 'meters' is subscribed and its hold reads "since shown" (a cost rule of
  this processor, not a preset lever: M5).

### 1.4 Offline summary
The offline MASTER posts `{t:'mlat', lat}` from its constructor (its `pathLat()` after the options' `set`) and `{t:'mfinal', i, tpMax,
pk}` after its last quantum, measured over output frames [lat, lat + frames) only (`frames` in its options). The host awaits both
(≤ 1 s after `startRendering` resolves): without `mlat` the bounce fails with a note (never a silent offset); without `mfinal` the
note omits the numbers. The bounce note shows **"… · −13.8 LUFS integrated · −0.9 dBTP"**, corrected for the bounce's own scaling (`×k`
adds `20·log10 k` to both — exact for the true peak, for I up to blocks crossing −70 LUFS; dither ignored).

---------------------------------------------------------------------------------------------------------------------------------

## 2. Host model (lane A)

### 2.1 The master record [C]
`mnode = { node, ready, load, lat, mon, fxph }` beside `nodes` (never in it: `syncNodes` would drop it, `statsText` would count it as a
track, `postAll` would reach it with `'os'` — map §1.1, §7.3). Lifecycle joins: `powerOn` (built before `syncNodes()`), `powerOff`
(`mnode = null`, `tables.release('master')`), `whenReady` (waits for MASTER too), `applyRestore` / `loadProject` / `freshProject`
(re-send the master chain when it changed; a load re-seeds: `seedPend.add('master')`), the sample-rate change (rebuilt with the
context). **`postAll(m)` (main.js:1176) also posts `m` to MASTER when `m.t` is `'transport'` or `'panic'`** — one rule, so no site
(play, stop, reanchor, seek, the panic re-send: main.js:1520, 1538, 1557, 1848–1850 [R]) can miss it; `'os'` never reaches it. The
master chain compiles with `CG.chainPatch(project.master.fx, { sr, bpm, prefs, seed: seedPend.has('master'), qr: null })` — never
`liveOpts`' quality step `qrOf(qrStep)` (main.js:493–494 [R]), so live and offline compile the same rack (M2); every path that
recompiles every rack (`queueAll`: tempo, drift, prefs) recompiles it. `statsText` adds MASTER's load to the engine total (the 85 %
safeguard's sum includes it; its levers stay the tracks' OS / quality, main.js:1250–1252, 1301–1333 [R] — a heavy master is the user's
call, as a heavy track rack is — but its notice names the master when MASTER's load is the largest single share).

### 2.2 The master rack's host
`fxHost` gets a master form: `T()` → the master record, `fx()` → `project.master.fx` (created on the first edit), `editFx` → mutate,
re-compile, `postChain` to MASTER, `persist()` (**not in History**, the same knob policy as a track's rack, main.js:2452–2455 [R]; no
`fxPrune`: the master has no mod rows); `racks: 1` (MAIN); `state` / `edit` / `locked` / `extraRows` absent (no Serum); `setTap` → MASTER;
the "+" menu with the CPU estimates (`fxCost`) as on a track. The master rack gets **no `data-dev`** (renderFxTab sets it for the mod
layer, main.js:3279 [R]): no long-press mod menu, halo or cable on a master knob. **Monitors route `'master'`**: `wanted` / `sync` /
`deliver` / `fx` look ids up in `project.tracks` and `nodes`, and `postTo` drops an id without a node (main.js:2390–2420, 1166–1170 [R]) —
each gets a master branch: 'meters' while the Master row or the OUT is live, 'mfx' while the rack module is live; `gr` / `ftap` / `fxph`
reach the rack's displays exactly as a track's. **Assets**: `states()` (main.js:2311–2313) gains `{ track: { id: 'master', name:
'Master' }, dev: 'mfx', s: null, fx: project.master.fx }` while it exists — `users()` names "Master", a relink reaches its Convolve
IRs, the learn / gc see them (assets.js:566, 1328–1336, 1769–1772 [R]) — and `editFx` routes 'master' to the master form;
`tables.ensure(needs, { trackId: 'master', node: MASTER, fx, convMax })` (the preview's `'preview'` is the precedent, main.js:2987 [R]).
The `fxover` notice says "(the master)".

### 2.3 Data [C]
`project.master = { fx: <FX v2 state>, lay: {…} }` (the master canvas's module positions, `normLay` rules); **absent = empty** (no
key written until the first edit). `song.deserialize` whitelists `master` (`normMaster`: `fx` an object copied plainly — its v2
validation is the host's, as for a track's rack —, `lay` normalised). **SCHEMA 14** (13 → 14 an identity step; an older build opens a 14
file read-only instead of dropping the master, the stage-P pattern). `upgrade` stamps every save with SCHEMA (cv-migrate.js:148–157 [R]):
an untouched project writes **no `master` key**, but its file says 14 and a 13 build opens it read-only (P's precedent). `toV1` ("Save as
classic project") drops it with a `lost` line ("the master effects (n)") when it holds an instance.
**History**: `project.master` rides in the snapshot's `m` (song.js:429–434 [R]) and `applyRestore` replaces the project wholesale — so,
as `keepDevs` does for every device (main.js:1444–1456, 1465 [R]), `applyRestore(p, true)` within the same project **keeps the current
master rack** (`p.master.fx = project.master.fx`, creating or dropping `p.master` to match) and restores only `lay` with the step (a
module move / Tidy on the master canvas is a History step, as on a track). An undo of Open / New brings that project's own master. Tests:
undo / redo of a track edit with a non-empty master posts no master chain and leaves `project.master.fx` byte-identical; an undo whose
snapshot predates the first master edit keeps the rack; an undo of a master module move restores `lay` only.

---------------------------------------------------------------------------------------------------------------------------------

## 3. Listening controls (not in exports — M2)

| control | where | what |
|---|---|---|
| **Volume** (today's "Master" level, renamed — Q4) | top bar + ⚙ (as today) | the level GainNode after MASTER; per device; not in exports (as today) |
| **Mono** | Master row + master OUT | the mono stage: a GainNode whose `channelCountMode` goes `'explicit'` / `channelCount 1` (Web Audio's speaker down-mix ½(L+R), up-mixed to both ears by the destination) and back to `'max'` (gain 1: ×1 is exact, M1); not saved (resets on reload, so nobody forgets it on); lit while on |
| **A/B bypass** | Master row + master OUT (one tap) | `{t:'bypass', on, g}` → **MASTER's own crossfade** (5 ms, the rack's ramp length) between the rack's output and the input delayed by `pathLat()` (time-aligned A/B), the rack running throughout (a fully bypassed FXRack freezes its units, fx-dsp.js:2872–2879 [R], so B would resume a stale tail) — never the rack's `racks[0].byp`, which is saved FX state compiled into `fxr` (fx-core.js:973–976 → fx-dsp.js:2325 [R]) that the next knob's `chain` would reset; not saved; lit while on. **Q2**: whether the bounce honours it. **Q3**: loudness-matched |

Q3 on [C]: MASTER keeps a second short-term meter (K-weighting + energy, no true peak) on its **input**; at the A/B tap the gain
`S_out − S_in` (clamped ±24 dB; 0 dB while either is below −70 LUFS) is frozen and applied to the bypassed signal inside the same 5 ms
crossfade; the gain is shown on the button ("A/B −3.2 dB"). An empty rack measures the same samples twice: 0 dB exactly, so M1 holds
with A/B on.

The meters measure MASTER's output (post-rack, pre-Mono, pre-Volume) — what is exported. While bypassed they measure the bypassed
signal (what you hear); with Q3's match on, the matched level.

---------------------------------------------------------------------------------------------------------------------------------

## 4. The bounce (lane A)

`renderOffline(sr, frames, items, at, { master })` — only `bounce()` passes `master: { fxr, fxrT, bypass, frames, lmax }` (`fxr`
compiled as §2.1 at the bounce rate): `bus → MASTER(offline) → destination`, MASTER created **after** the item loop (§1.1); `frames +
lmax` rendered, `lmax` a host-side upper bound of the path latency from the master FX state (every compressor at its 10 ms cap + 15
samples per Distortion, splitter branches summed — an over-estimate costs nothing); then the first `lat` frames (MASTER's `mlat`)
dropped and the length cut to `frames`; today's peak scan / ×k / Normalise / `encodeWAV` unchanged. An empty master: `lmax = lat = 0`,
the same render length, **the same file bytes as the base build** (M1; reviewer 2 compares real Chrome bounces). The master rack's
`needs` join the `ids` union (map §7.2; its states through `states()`, §2.2). The dialog's note gains one line: "Through the master
effects (n) — Volume, Mono and A/B are listening controls and not in the file" (Q2: the bounce always includes the master effects,
`bypass` is never passed — the option is dropped from the offline options). **Q1 (a)**: the Sample rate and Oversampling selects gain a
first option **"Same as playback"** (the context's rate — `settings.sr` or the device's — and `settings.os`, both resolved when the
dialog opens and named in the option, e.g. "Same as playback (48 kHz)", "Same as playback (4×)"), selected by default; the other options
as today; the choice is per device as today. A bounce at the same explicit rate / OS as the base build's is byte-identical (M1); G0's
hashes are taken at explicit settings. The tail options gain Auto (O2); Normalise becomes a select (O4).

main-sim (lane A): `paths(n)` **stops at a worklet with inputs** (today it passes through any non-gain / non-pan node as a wire,
main-sim.mjs:160–171 [R] — kept, it would count the tracks twice once MASTER outputs them); such a node is processed after its sources
in the quantum (creation order is not topological: MASTER is created first live) with input `Float32(Σ Float64 path contributions)` —
the same single rounding today's destination sum makes (main-sim.mjs:253–262 [R]) — so an empty master leaves `sim.lastOffline.L / R`
byte-identical (canvas-7a/7b/7c-sim and main.test read it).

---------------------------------------------------------------------------------------------------------------------------------

## 5. UI (lanes U and A)

### 5.1 The Master row [C]
A **footer of the track list**, always visible below the tracks at every open stop of the top tray — ROADMAP row 13's "**pinned** in the
track list" (the request's own word; the former Q1 settled). A sibling **after `#arrwrap`**, outside its scroller (the rows scroll inside
`.arrwrap` with `#heads` / `#lanes` row-aligned, style.css:201–204 [R]: a footer inside `#heads` would scroll away or break that
alignment), its controls under the heads column; not a row of `#lanes` (the arrangement gets no master lane in this stage): "Master" · a
stereo peak meter (from `mmon.pk`, gap-free) · short-term LUFS as a number · **A/B** · **Mono** · a chevron that opens the master canvas.
Tapping the row's name opens the master canvas; tapping any track row (or dot) returns to that track — the selected one too (§5.2).
`topSnaps(n, foot = 0)` adds `foot` to every stop but the collapsed one (the default keeps cv-tray.test.mjs:24–27); at the collapsed stop
(48) there is no footer: the master canvas is reached from the track chip's list (`trkListUI`, main.js:4915–4930), which gets a "Master"
item, and the chip reads "Master" while the master canvas shows. No ✕, no ⧉, no M / S / arm, no instrument chip. Narrow widths
(≤ 640 px): the LUFS number folds first.

### 5.2 The master canvas [C]
A canvas world like a track's with exactly two devices: the **master FX rack** (a panel device `mfx`, the rack UI as a classic's panel,
MAIN only) and the **master OUT** (§5.3); Tidy = rack → OUT. Camera key `synth.cam.<uid>.master` (track ids are `trk_N`: no clash).
`project.selTrack` **stays on the last track** (the keyboard, MIDI and the roll keep playing it; the canvas title reads "Master · keys play
<track>"). The Sources tray on the master canvas shows one line, "The master takes effects — add them with the rack's +", and no tiles; a
drop of an instrument or module onto the master canvas is refused with that line. The project Mod Wheel / Pads modules are **not** on the
master canvas (no modulation there). The tray's pull tabs, the keyboard and the toolbar behave as on a track.

**The rule**: the master canvas is its **own view with its own host** (`createTrackView(W, masterRec, cvMasterHost())`, `masterRec =
{ id: 'master', dev: { mfx: {kind: 'panel', fx}, out: {kind: 'out'} }, lay }`), never `cvHost()`: no callback of it reads `trk()`. A
session flag `cvMaster` is honoured by every path below (each found at 16a01e7; lane A lists any other in §12 with its verdict):
- `cvRender()` (main.js:5334–5361, ≈ 20 callers — track edits, `applyRestore` → `renderAll`, panel builds) syncs the master view and
  returns while `cvMaster` (it would rebuild the keyboard track's view);
- `cvLay` writes `trk().lay` (main.js:5588–5622) and `cvTidy` lays out `trk()` (:5806) → the master's `lay`, the same History steps;
- `cvDropInstrument` / `cvOpenSources('replace')` / the Sources taps replace `trk()`'s instrument (:5763, :5164) → refused (above);
- `cvHost`'s `size` / `select` / `rackLayout` / `members` / `dashedSet` / `badge` / `cvTitle` / `cvMenu` (:5440–5466, 5474, 5538, 5910)
  → the master host's own (`cvMenu`: Fold only; the rack and the OUT cannot be removed);
- the mod layer: `renderFxTab`'s `data-dev` (:3279) and the canvas mod-cable drag (`cvView.cableDrag`, :5348) → none on the master;
- `scopeSource()` (:4753–4756) → `an` while `cvMaster`; `drawScope`'s live test reads the master view's OUT;
- leaving: `selectTrack(id)` returns early for the selected id (:1926) — the row / dot / list tap clears `cvMaster` first, then selects
  (else tapping the keyboard's track leaves the master canvas up); `cvReveal` (a notice's "show") leaves the master canvas;
- `trkChipUI` / `trkListUI` / the dots (:4895–4930) → the "Master" item and chip (§5.1);
- the test hook `fx.addEffect` (:7935, `cvAddEffect(trk(), …)`) → the master form when `cvMaster`.
Everything that iterates `project.tracks` stays as is.

### 5.3 The master OUT (new module `master-ui.js`, lane U) [C]
One module, wider than a track's OUT (≈ 420 × 300 world px): the existing scope (wave / spectrum, `drawScope` reading `an` — MASTER's
output) at a track OUT's scope size (W_OUT 280, cv-module.js:66 — `drawScope`'s `shadowBlur` pass grows with its width, main.js:4769; if
G5 still fails, the master's scope draws without `shadowBlur`, a flag of `drawScope`), the meters beside / below it: **LUFS** — M / S / I
as numbers with a short-term bar and a target tick (default −14 LUFS, a menu: −9 / −14 / −16 / −23 / off), **true peak** L / R bars with
the max-hold number (red ≥ −1 dBTP, a tap resets I and the hold: `mreset`), the **correlation** bar −1…+1 (red below 0; "—" for NaN), and
the **A/B** and **Mono** buttons (the same state as the row's). Drawing: one 2D canvas for the meters, redrawn only when a new `mmon`
arrived (≤ 30 Hz), numbers as DOM text updated ≤ 10 Hz, no `shadowBlur`; drawn only while `live` (on screen, unfolded) as the track OUT
is. `master-ui.js` exports `createMasterOut(el, { onReset, onBypass, onMono, target })` → `{ update(summary), setBypass(on), setMono(on),
draw(), destroy() }` and `createMasterRow(el, { open, onBypass, onMono })` → `{ update(summary), setBypass, setMono, setActive(on) }` —
no globals, no `main.js` imports, unit-testable with the fake DOM; main.js imports it statically with `?v=9` (precache reachability,
CLAUDE.md). A track OUT's subtitle "master output" (main.js:5488) becomes "track output".

---------------------------------------------------------------------------------------------------------------------------------

## 6. Budgets and gates

| gate | what | target |
|---|---|---|
| G0 base records (the lead, before the builders) | from the **base tree only** (`git archive <base>` into the scratchpad, a `REC=<dir>` switch as canonical-stream.test.mjs:14–15): the main-sim bounces of project-p1 + a drums + a 900 Series project → `tests/ref-M/bounce-*.sha`; never re-recorded from M's code | recorded |
| G1 empty master (M1) | node: MASTER with an empty / all-off rack: output ≡ input bit for bit, 30 s of random float32 stereo + silence + `inputs = []`, with and without `mon`, across `transport` / `chain` / tempo / `bypass` (incl. Q3's match) / `panic` messages; every golden; the G0 bounces equal through the new main-sim (§4's rounding); `sim.lastOffline.nodes[0]` still the first track in every sim test | exact |
| G2 export = playback (M2) | node: MASTER fed one recorded input block stream live (messages at main.js's anchors, ≥ 0.25 s of exact zeros before the start) and offline (options) with a rack of a synced Delay, a Chorus, a Flanger, a Limit compressor, a Reverb, a Distortion: (a) a start on a quantum boundary → exact; (b) starts at F mod 128 ∈ {4, 60, 124} → the largest difference measured and recorded, gated at the precedent's −80 dB (integration.test.mjs:438, 1132 [R]); (c) the same rack compiled under a safeguard quality step live → still exact (qr null); (d) `pathLat()` per unit type: an impulse's peak at `pathLat` frames | (a), (c), (d) exact; (b) ≤ −80 dB, recorded |
| G3 meters | EBU Tech 3341 cases we synthesise from their published descriptions (1 kHz / −23 dBFS stereo → −23.0 LUFS M / S / I; −33 dBFS; the gating cases built from tone bursts at −36 / −23 / −72 dBFS; the true-peak tones of §1.3) at 44.1 / 48 / 96 kHz; correlation +1 / −1 / NaN / ≈ 0 for L=R, L=−R, R silent, independent noise; the 48 kHz K-weighting coefficients ≤ 1e-6 from the published ones; no allocation per quantum; no worklet globals in master-dsp.js (the fx-dsp.test.mjs:200 check) | ±0.1 LU (M / S / I); TP +0.2 / −0.4 dB (Tech 3342 is LRA: only with O3) |
| G4 audio cost (bench.json new rows `master-empty`, `master-meters`, `master-rack5` node / jsc; their targets in bench.json) | per quantum at 48 kHz; plus MASTER's first 32 quanta after construction on jsc (the warm-up) | empty + meters ≤ 2 % of a quantum on the M4 Mac (node) and its jsc row × 7 (the Low floor, ROADMAP 14) ≤ 10 %; the 5-unit rack ≈ a track panel with the same units (± 10 %); no first-quantum spike over 1 quantum |
| G5 UI cost (reviewer 2, headless Chrome, 1× / 4× / 6×) | the master canvas open, playing, OUT live: frame time vs a track canvas with its OUT live; the Master row's meter with the list open | no worse than a track OUT + 0.5 ms at 6×; no layout thrash (meters write no layout-reading DOM) |
| G6 the real graph | headless Chrome: the bounce WAV of three demo projects byte-identical to the base build's with an empty master; with a non-empty master the file differs, an impulse project's first sample sits on frame 0 (the latency trim), and its integrated LUFS (offline) equals the live meter's after a full play-through within 0.1 LU | exact / 0.1 LU |
| G7 host model (lane A, sim) | §2.3's History cases; the master rack in `states()` (users / relink); an IR on the master rack reaches MASTER and survives a gc; a master knob turn while A/B is lit keeps it bypassed; Panic reaches MASTER; every `cvMaster` path of §5.2 writes no track (each track's JSON byte-identical after master-canvas moves, Tidy, drops, menus) | exact |

---------------------------------------------------------------------------------------------------------------------------------

## 7. Lanes, schedule, interfaces

Leaner shape: this contract → skeptic review → the user's questions (§10) → **G0 by the lead** → builders in worktrees **reset to the
base** (P's squashed commit) with exclusive files → two reviewers → failing-test-first fixers → one sweep → one squashed commit "M" →
deploy. **New frozen refs at acceptance**: `tests/ref-M/` (MASTER's output for a fixed input + rack set; the meters' readings for the G3
signals; G0's bounce hashes from before).

| lane | phase | owns (exclusive) | tests | model |
|---|---|---|---|---|
| **D** DSP | 1 | `master-dsp.js` (new), `engine.js` (the `Master` processor class and its registration before `synth-engine` only), `fx-dsp.js` (`FXRack.pathLat()` only, additive), the DSP lists that load master-dsp.js where MASTER runs and are not main.js — `wk.js` `DSP_GLOBALS` (3186–3189, + `'master-dsp.js': 'MASTERDSP'`, last), `tests/dsp-scope.mjs` `DSP_TABLE` (last), `tests/bench.html` (before engine.js) — and their pins (`tests/wk.test.mjs:2234–2240`, `tests/sx-base.test.mjs:426–430`; `tests/bench.test.mjs:117–118` follows); **not** smprender.js / cv-cost.js / golden-harness.mjs (they never build MASTER; engine.js reads `MASTERDSP` at use); `tests/master-dsp.test.mjs`, `tests/master-proc.test.mjs`, bench rows (bench-scenarios.mjs) and their targets (`tests/bench.json`); **O3 LRA** | G1 (node part), G2, G3 (+ Tech 3342 LRA cases), G4 | standard |
| **U** UI module | 1 | `master-ui.js` (new), `style.css` (the master row / OUT rules; A appends the footer's placement after U lands — sequential, not shared), `tests/master-ui.test.mjs`; **O1**'s drawing (the image mode) and the LRA readout | the module's API with the fake DOM; draws nothing while not live; redraw only on new data | cheaper |
| **A** host | 2 (after D / U's interfaces; stubs allowed earlier — main-sim's inputs need only the processor's contract) | `main.js` (graph, `mnode`, lifecycle, `postAll`'s forwarding, `fxHost` master form, monitors, assets `states()`, keepMaster, bounce + `renderOffline`'s option, the listening controls, the Master row and canvas wiring with every §5.2 path, `scopeSource`, the Volume rename, `DSP_FILES += 'master-dsp.js'` last; Q1 (a)'s "Same as playback"; **O1**'s splitter + analysers, **O2** Auto tail, **O4** Normalise select), `index.html`, `song.js`, `cv-migrate.js` (14), `cv-module.js` (only if the master view needs a device kind), `cv-tray.js` (`topSnaps(n, foot)` + footer), `tests/main-sim.mjs` (§4: worklet inputs, `paths()` stops at them, topological processing, the single rounding; `MASTERDSP: null` among its null DSP globals), `tests/canvas-M-sim.test.mjs` (new: G1 sim part, G7), the pins of §7.3, `tests/main.test.mjs`, `tests/app.test.mjs:165` (17 → 18 modules), `tests/canvas-3-sim.test.mjs:103–108` (16 → 17), `tests/cv-tray.test.mjs` (a `foot` case) | G1 (sim part), G7, §7.3 | standard |
| reviewers × 2 | 3 | (1) **real engine**: M1 / M2 / M3 / M4, G1–G4, G7, schema 14, History, IR stores, latency, a 100-track project; (2) **headless Chrome**: G5, G6, the Master row and canvas at 1440 × 900 / 1366 × 1024 / 1024 × 1366 / narrow widths and the collapsed tray, Mono / A/B by ear-proxy (the destination's recorded signal), the bounce note, a power cycle and a sample-rate change, no console error | — | standard |
| fixers | after | the finding's files, failing test first | | cheaper |

### 7.3 Pins that change by design (the lead's decision; the skeptic's form below — left for the lead to confirm)
- **canonical-stream** — not a filter that keeps `synth-engine` nodes and drops the rest (a future worklet of any other name would vanish
  from the record unseen, and the node indices `i` would shift under MASTER without a rule). Instead the record is **partitioned by
  processor name**: the `synth-engine` part (its nodes re-indexed among themselves in creation order, their messages) equals main's
  fixture **exactly**, as today; the `synth-master` part (its nodes, options' hashes and every message to it) equals a new fixture
  `tests/fixtures/stream-master.json` (recorded at acceptance); **any other processor name fails**. Structural asserts that do not wait for
  a fixture: one live MASTER per live context, created before that context's first track node; one offline MASTER per bounce context,
  created after its track nodes, none in a resample / render-last context; and MASTER's `transport` / `panic` subsequence equals the one the
  tracks of its context received (same anchors, same order). The header's "left out by design" line names `synth-master` as compared
  separately, not left out.
- **canvas-sim** "OUT scope (fix-scope)": `masterAn` is found through `pan → MASTER('synth-master') → an` (today's
  `pan.outs.find(gain)` would return undefined and throw); the same assertions otherwise, plus: every track's `pan` feeds only MASTER and
  its own two analysers; MASTER feeds `an` and the mono GainNode → the level GainNode (`gain.value = settings.master`) → destination.

Interfaces: `registerProcessor('synth-master', Master)` before `registerProcessor('synth-engine', Track)`; MASTER's node options §1.1;
its processorOptions `{ offline, fxr, fxrT, transport, bypass, frames }` (offline; live: none — the chain arrives as a message); messages
§1.2; `MASTERDSP.Meters(sr)` → `.push(L, R, n)`, `.summary()`, `.reset()`; `MASTERDSP.kWeight(sr)` → coefficients;
`MASTERDSP.TruePeak(sr)`; `FXRack.pathLat()`; `master-ui.js` §5.3. Rules: `?v=9` on every import; new test files `import
'./v8-guard.mjs'` first; never fake-DOM nodes in `assert.*`; one test file at a time with `--max-old-space-size=2048`; no lane commits
`sw.js` (the lead runs `node tools/precache.mjs --write`).

---------------------------------------------------------------------------------------------------------------------------------

## 8. Docs to update (the lead, at the end)
ROADMAP row 13 (done) + "Next"; HANDOVER (the master processor, the listening controls, schema 14, the pins changed by design, the
`cvMaster` rule); SPEC-canvas (the master canvas; OUT "exactly one per track" + one master OUT).

## 9. The extras (the user took all four, 2026-10-22 — in scope) [C]
- **O1 Stereo image scope (goniometer)** [U draws, A wires]: a `ChannelSplitter` off MASTER's output → two 2048 analysers (L, R), read
  only while the OUT is live and the scope is in "image" mode (a third mode beside wave / spectrum: tap to cycle); drawn as a rotated
  M/S dot cloud (≤ 2048 points, alpha, no `shadowBlur`) with the correlation bar under it. Analysers only: no audio change (M1), no
  worklet message. Budget: inside G5.
- **O2 Auto tail** [A]: the dialog's Release tail gains **Auto** (until the master output stays below −96 dBFS for 0.5 s, ≤ 30 s past
  the song's end); the offline context renders the song + 30 s (+ the latency bound), the host trims at the first sample after which
  every |x| < 10^(−96/20) for 0.5 s (+ 0.5 s kept), before the scaling / dither; the note says the tail it kept. The default stays
  **2 s** (an existing project's bounce at the same settings is unchanged, M1).
- **O3 LRA** [D]: EBU Tech 3342 — short-term loudness (3 s) sampled every 100 ms into a second preallocated histogram (0.01 LU bins),
  absolute gate −70 LUFS, relative gate −20 LU below the gated mean, LRA = the 95th − the 10th percentile; in `mmon` and `mfinal`; reset
  with the integrated value; shown beside M / S / I and in the bounce note.
- **O4 Loudness normalise** [A]: the dialog's "Normalise peak to −0.3 dBFS" checkbox becomes **Normalise: Off / Peak −0.3 dBFS /
  Loudness** (the OUT's target, default −14 LUFS; a select beside it); Loudness scales by `k = min(10^((target − I)/20),
  10^((−1 − TPmax)/20))` from `mfinal` (exact: a pure scale shifts I by 20·log10 k and TP by k); when the ceiling binds the note says
  "stopped at −15.2 LUFS (true-peak ceiling −1 dBTP)" — never a limiter, never a clip. Default **Off** (unchanged files, M1). A project
  stores nothing new for it (the dialog's choices stay per device, as today).

## 10. Questions for the user (answered 2026-10-22: Q1 (a), Q2 listening only, Q3 level-matched, extras all four)
- **Q1** "What you hear = what you export": the master effects render exactly, but the Bounce dialog renders the tracks at its own
  defaults (48 kHz, oversampling 8×) while playback runs at the device's rate and ⚙ Oversampling (4× by default), so a default bounce
  is a hair cleaner than what you heard, not identical. (a) the dialog starts at **"Same as playback"** (the live rate and oversampling;
  48 kHz × 8 etc. still choosable; a bounce at the same settings is unchanged) — recommended; (b) keep 48 kHz × 8 as today.
- **Q2** The A/B bypass and exports: the bounce always includes the master effects; A/B is for listening (recommended) / the bounce
  follows the A/B switch.
- **Q3** A/B loudness-matched (bypassed = level-matched to the processed sound, so louder doesn't win; recommended) / plain.
- **Q4** Today's "Master" level: rename it **Volume** — your listening level, not in exports, as today (recommended) / make it a real
  master fader in exports (every existing bounce changes by its setting, default −1.9 dB — against "every existing sound bit-identical").
- Extras (multi-select): O1–O4.
- (Settled, not asked: the Master row's place — ROADMAP 13's "pinned in the track list" = the footer of §5.1. Restore the old question
  only if "pinned" was not the user's word.)

## 11. Known limits (recorded)
- Live latency of a look-ahead master is not compensated (the path's: ≤ 10 ms per Limit-mode compressor, 15 samples per Distortion; the
  bounce is): the playhead and metronome run ahead by it, and MIDI recorded against it lands that much late (the Latency setting can
  absorb it).
- A live play is bit-exact with its bounce only from a silent history (exact zeros ≥ 0.25 s; a track's tail is not exact zeros for up to
  2 s after its last note, engine.js:4650–4654) and, without P-1 (b), a quantum-aligned start; otherwise below G2 (b)'s recorded bound.
- With "silence effect tails when transport stops" (the default) ■ cuts the master's tail live; the bounce keeps its tail seconds (as
  for track racks today).
- No modulation of master knobs, no notes on the master (RETRIG / key tracking idle), no sends, no master lane / automation (later).
- The real Web Audio sum's order is the browser's (unchanged; not observable in node).

## 12. Notes (the builders fill in)
### Lane D
### Lane U
### Lane A
### Reviews and fixes
### Acceptance

## 13. Review log

### The skeptic review (2026-10-22, against the draft)

Every claim about existing code was read at 16a01e7 (`canvas`, read only); no test or script was run. Severity as IMPL-P §13: **P1** a
contract contradiction or an impossible / circular gate, **P2** a gap a builder would trip on, **P3** a correction. **Settled and not
reopened**: the scope paragraph (the user's agreement), the visual-only presets, no artificial caps (the master rack inherits the FX
rack's existing bounds, MAX_INST 48 and 32 MB, fx-core.js:554, fx-dsp.js:1984, which P left), canvas only.

**The lead's questions, answered.** (1) **M1** holds by construction (a calm FXRack leaves L/R untouched, ×1 GainNodes are exact, the
browser's input sum is the same set of connections) — but its sim gate needed a rounding rule and a base-tree recording (#4), and the
bounce's file needed the latency rule right (#1). (2) **M2** as drafted was false: "the master's quanta are never split" both misplaces
the transport re-seed by up to 124 frames and cannot make a live start at an arbitrary anchor see the bounce's partition (#2); the
compiled racks also differed under the safeguard (#8). (3) **Always-on** is forced by the scope (the meters exist with an empty rack),
fine (#21). (4) **The pins**: canvas-sim's is a legitimate topology change; canonical-stream's name filter was a weakening — replaced by
a partition that is stricter than today's test (#15, left for the lead). (5) **The meters**: the true-peak spec was impossible at its
tap count (#13), the K-weighting derivation would miss its own check (#14), Tech 3342 is LRA (#16). (6) **The host**: undo would have
reverted the master rack (#3); assets, monitors, Panic and the A/B had no path (#5, #6, #7, #9). (7) **The UI**: ten `trk()` paths named
(#10). (8) **The lanes**: D needed fx-dsp.js, A five more pins, the DSP lists fewer files (#12, #24).

| # | point | evidence (file:line) | fix |
|---|---|---|---|
| 1 · P1 | **The latency rule is wrong.** `rack.latency` is `lat()` = the **longest** Limit-mode look-ahead on MAIN — not the rack's delay: a Distortion delays its whole output 15 samples (dry path delayed to match) and units in series **add** (two Limits = 2 × La). "≤ 10 ms: the Limit look-ahead" and "renders `latency` frames more and drops the first `latency`" leave a Distortion / chained-limiter master's file late, against G6; the host also has no way to know `lat` before sizing the OfflineAudioContext | fx-dsp.js:2662–2679 (lat), 49–50, 465 (DIST_LAT), 1023 (La), 1874–1894 (splitter alignment); main.js:2792 (length fixed at construction) | **fixed in §0, §1.2, §1.4, §4, §6 G2 (d) / G6, §7 D, §11**: `FXRack.pathLat()` (lane D, additive in fx-dsp.js; per-unit impulse tests); the bounce renders `frames + lmax` (a host-side bound) and trims MASTER's reported `mlat`; a missing report fails the bounce |
| 2 · P1 | **M2 "bit for bit … quanta never split" cannot hold as written.** The live song starts at a 4-frame point after `round((t + 0.06 + baseLatency)·sr)`, not on a quantum boundary; the rack glides per call, restarts its 16-sample blocks at each call and steps Flanger / Phaser / Chorus LFOs per block, so the partition relative to the song differs from the bounce's; and an unsplit quantum applies `rack.transport()` up to 124 frames off the tracks' re-seed. G2 as drafted either fails or passes only on an aligned anchor | main.js:1525, 1549; engine.js:4484, 4638; fx-dsp.js:2768–2829, 716–718, 760–761, 814–816, 69–77; integration.test.mjs:438, 1132 (the precedent: −80 dB) | **fixed in M2, §1.2, §6 G2, §11**: MASTER applies a start at its frame (one split, the Track's rule); M2 exact for a silent history and an aligned start, G2 (b) measures and gates the unaligned case at −80 dB → **P-1** |
| 3 · P1 | **Undo would revert (or delete) the master rack.** Master edits are not History steps, `project.master` rides in `m`, and `applyRestore` replaces the project wholesale; tracks survive this only through `keepDevs`. As drafted, any undo of a track edit restores the snapshot's master — or none, when the snapshot predates the first master edit | song.js:429–434; main.js:1444–1456, 1465, 2452–2455, 5934–5936 | **fixed in §0, §2.3, §6 G7**: keepMaster in `applyRestore(p, true)` (same uid: the current rack kept, `lay` restored with its step); three tests |
| 4 · P2 | **The sim gate (G1) as drafted.** main-sim's `paths()` passes through any worklet as a wire, the offline mix is one Float32 rounding of a Float64 sum, and `renderOffline` builds `bus` before its items — a MASTER created there becomes `sim.lastOffline.nodes[0]`, which ≥ 15 assertions read as the first track; and "frozen at the base" needs a base-tree recording, else the hash is circular | tests/main-sim.mjs:160–171, 253–262; main.js:2800–2801; accessors.test.mjs:141–155, 458; canvas-7a-sim:350, 577–582; canvas-7b-sim:311, 439, 658–666; canvas-7c-sim:336–597; graph-host.test.mjs:262, 538; canonical-stream.test.mjs:14–15 (the REC precedent) | **fixed in §1.1, §4, §6 G0 / G1, §7**: offline MASTER created last; `paths()` stops at an input-bearing worklet, topological processing, the single rounding; G0 recorded by the lead from the base tree |
| 5 · P2 | **Assets have no path to the master rack.** `states()` lists only tracks' states (users / relink / learn miss a master IR); `portPoster` posts the master's IR to MASTER, which as drafted has no store handler (the id is then marked sent and lost); MASTER is not in `ALL`, so no `assets()` announcement reaches its Convolve | main.js:2306–2318; assets.js:365–372, 566, 1328–1336, 1769–1772; engine.js:1674–1675, 3944–3950, 4068–4072 | **fixed in §0, §1.2, §2.2, §6 G7**: MASTER handles the five store messages and joins `ALL`; `states()` gains the master; `editFx` routes it |
| 6 · P2 | **Monitors and the rack displays.** `monitors.wanted / sync / deliver / fx` look ids up in `project.tracks` / `nodes` and `postTo` drops an id without a node — 'master' posts nothing; the drafted `{t:'mon', on}` is a second shape beside the Track's `{t:'mon', ids}`; `fxtap` / `fxph` (Delay display, LFO dots) were missing from MASTER's messages | main.js:1166–1176, 2382–2420, 3155–3159; engine.js:3984, 4037–4042, 4839–4843 | **fixed in §1.2, §2.2**: one shape `{t:'mon', ids ⊆ ['meters','mfx']}`; `fxtap` / `fxph` answered; monitors and `postTo` get a master branch |
| 7 · P2 | **The A/B through the rack's own bypass** would be reset by the next knob (`racks[0].byp` is saved state compiled into `fxr` and copied at every `set`), would freeze the units (B resumes a stale tail), cannot carry Q3's gain (fx-dsp.js is not D's file in the draft) — and Q3 contradicts M4 as written | fx-core.js:973–976; fx-dsp.js:2325, 2872–2879 | **fixed in M4, §1.2, §3, §6 G7**: MASTER's own 5 ms crossfade against the input delayed by `pathLat`, the rack running; M4's one listening-path exception; Q2 (b) would carry the frozen gain as a number |
| 8 · P2 | **Live and offline compile different racks under the safeguard**: `liveOpts` passes `qrOf(qrStep)` live and `null` offline (the Convolve tail cap among them) — "fed the same compiled rack" is false after any quality step | main.js:493–494, 816, 1330–1333; fx-core.js:941–942 | **fixed in M2, §2.1, §6 G2 (c)**: the master compiles with `qr: null` both ways |
| 9 · P2 | **Panic and the transport fan-out**: the drafted list had no `panic`; transport is posted from five sites through `postAll`; the stop path's `silence` reset and the no-reseed rules for re-anchors / wraps were unsaid | main.js:1176, 1520, 1538, 1557, 1848–1850; engine.js:4429–4438, 4473–4478, 4495–4504 | **fixed in §1.2, §2.1, §7.3**: `postAll` forwards `transport` / `panic` to MASTER (one rule); the Track's start / stop / silence rules; canonical-stream asserts the subsequence |
| 10 · P2 | **`trk()` paths on the master canvas**, left to lane A's §12 in the draft: `cvRender` rebuilds `trk()`'s view from ≈ 20 callers; `cvLay` / `cvTidy` write `trk().lay`; the Sources drop replaces `trk()`'s instrument; the cvHost callbacks; the 2b mod layer via `data-dev` and the cable drag; `selectTrack`'s early return for the selected id strands the master canvas; the chip / list / dots cannot reach it; the `addEffect` hook | main.js:5334–5361, 5588–5622, 5806, 5763, 5164, 5440–5466, 3279, 5348, 1924–1926, 4895–4930, 7935 | **fixed in §0, §5.1, §5.2, §6 G7**: own view + own host, a `cvMaster` flag honoured by each named path; a sim test that no track's JSON changes |
| 11 · P2 | **The meters' cold start**: "no warm-up of its own" — but the meters run from the first quantum, and cold JavaScriptCore code there is the stall WebKit keeps as latency | HANDOVER.md:144–145; main.js:983–989; engine.js:3550 | **fixed in §1.2, §6 G4**: MASTER warms its meters in its constructor while the context is held; a first-quanta row on jsc |
| 12 · P2 | **The DSP lists**: engine.js reads globals at use, so master-dsp.js is needed only where MASTER runs (main.js / wk.loadDSP / precache, dsp-scope → main-sim and bench, bench.html) — smprender.js, cv-cost.js and golden-harness.mjs need nothing; the draft missed pins app.test.mjs:165 (17 modules), canvas-3-sim.test.mjs:103–108 ([16, 16, true] and main-sim's null globals), and wk.test / sx-base.test / bench.test assert the lists' content | engine.js:1660–1662; main.js:845–848, 2292; wk.js:3180–3210; tests/app.test.mjs:165–168; canvas-3-sim.test.mjs:103–108; wk.test.mjs:2234–2240; sx-base.test.mjs:426–430; bench.test.mjs:117–118 | **fixed in §1.2, §7 D / A**: `MASTERDSP` read in the constructor; the minimal list set, each appended last; the pins assigned |
| 13 · P2 | **The true-peak filter as specified**: "≥ 48 taps, flat within 0.1 dB to 20 kHz" at 44.1 / 48 kHz × 4 means a 20 → 24.1 kHz transition at 4·fs (≈ 150 taps, ×3 the cost) or a failing check; an even-length design has no pure-delay phase (a true peak below the sample peak is possible) | BS.1770-4 Annex 2 (4×, 12 taps per phase); EBU Tech 3341 TP tolerance +0.2 / −0.4 dB | **fixed in §1.3, §6 G3**: an L-th-band design (4 × 16 + 1 / 2 × 16 + 1), phase 0 a pure delay, accepted to 0.4·fs within Tech 3341's tolerance; above, measured |
| 14 · P2 | **K-weighting "from the analog prototype (f₀, G, Q)"** would miss its own ≤ 1e-6 check: the published shelf's middle numerator term is not the cookbook √A form [R?], and the published high-pass numerator is [1, −2, 1] unnormalised (+0.043 dB at 48 kHz, inside the −0.691) — a normalised high-pass reads ≈ 0.04 LU low | BS.1770-4 Annex 1 (the 48 kHz coefficients) | **fixed in §1.3**: invert the bilinear transform of the published biquads and re-discretise at fs (exact at 48 kHz by construction); the numerator kept |
| 15 · P2 | **The canonical-stream pin**: "keeps `synth-engine` nodes only" is a weakening (any future non-engine worklet would vanish unseen; the indices shift under a MASTER created first with no rule); MASTER's own stream "recorded at acceptance" pins whatever was built | tests/canonical-stream.test.mjs:1–26, 88–108 | **fixed in §7.3** (partition by name: engine part = main's fixture exactly, master part = its fixture, any other name fails; structural and subsequence asserts that need no fixture) — **left for the lead** to confirm the form |
| 16 · P3 | "Tech 3342-style ±0.1 LU" — Tech 3342 is the LRA spec (not in this stage); tolerances unnamed | §6 G3 (draft) | **fixed in §6 G3**: Tech 3341's ±0.1 LU and +0.2 / −0.4 dB; 3342 only with O3 |
| 17 · P3 | "An untouched project saves byte-identically" — `upgrade` stamps every save with SCHEMA, so the file says 14 and a 13 build opens it read-only | cv-migrate.js:148–157 | **fixed in §2.3** |
| 18 · P3 | Node and option details: the drafted `lat` option cannot be known by the host; `channelCountMode` unspecified (a mono source, `[]` shapes) | §7 interfaces (draft) | **fixed in §1.1, §7**: `'explicit'` / 2 / `'speakers'`; `lat` reported by MASTER |
| 19 · P3 | The analyser down-mix [R?] is the Web Audio spec's own rule (AnalyserNode time-domain down-mixing); only WebKit's conformance is unconfirmed | W3C Web Audio API, AnalyserNode | **fixed in §0** |
| 20 · P3 | The footer's DOM place: inside `#heads` it scrolls away or breaks heads / lanes alignment; the collapsed stop shows no footer; the old Q1 is answered by ROADMAP 13's "pinned in the track list" | style.css:201–204; docs/canvas/ROADMAP.md:34; cv-tray.test.mjs:24–27 | **fixed in §5.1, §10**: after `#arrwrap`, `topSnaps(n, foot = 0)`, a Master item in the chip's list; Q1 replaced — **left for the lead** if "pinned" was not the user's word |
| 21 · fine | **Always-on**: decided by the scope (the meters exist with an empty rack), not only by the re-wire risk; WebKit builds it while held (main.test.mjs:504 still holds); the cost is gated with a floor projection | main.js:983–997; tests/main.test.mjs:500–512; ROADMAP.md:35 (Low ≈ 7 ×) | **fixed in §1.1, §6 G4** (the reasoning and the floor row) |
| 22 · P3 | A heavy master trips the 85 % safeguard, whose notices blame and lower the tracks (persisting ⚙ Oversampling) — consistent with a heavy track rack, but the notice should name the master | main.js:1250–1252, 1301–1333 | **fixed in §2.1** |
| 23 · P3 | A track OUT's subtitle "master output" is wrong once a master exists | main.js:5488 | **fixed in §5.3**: "track output" |
| 24 · P3 | Ownership: `master-ui.js` must be reachable for the precache (a static import); `style.css` was shared by U and A; `tests/bench.json` targets had no owner | CLAUDE.md (release hygiene); §7 (draft) | **fixed in §5.3, §7** |
| 25 · P3 | G4's "(node, M4)" reads as the invariant M4; no jsc / floor / first-quantum row | §6 (draft) | **fixed in §6 G4** |
| 26 · P3 | Known limits missing: the path latency's sum, MIDI recorded late against it, ■ cutting the master tail live (silence pref) while the bounce keeps it, the 2 s of non-zero track tails that defeat "a silent history", no notes for RETRIG / key tracking | engine.js:4429–4438, 4650–4654 | **fixed in §11** |
| 27 · P3 | Meter details: the histogram's overflow above +10 LUFS (the sum is unbounded), denormals on silence, correlation with one side silent, resets at the anchor frame not at the message | map §1.3 | **fixed in §1.3** |
| 28 · P3 | The bounce summary: measured over the trimmed window only; the ×k correction is exact for the true peak, for I up to blocks crossing −70 LUFS | §1.4 (draft) | **fixed in §1.4** |
| 29 · P3 | Q4's option (b) contradicts the user's "every existing sound bit-identical"; with P-1 (b), M3's "messages as today" holds only for projects without master effects | §10, M3 | **fixed in §10, M3** |
| 30 · P3 | The preview through the master (an audition heard through master effects and counted by the meters) was unsaid | main.js:2979–2985 | **fixed in §1.1** [C] |
| 31 · fine | Checked and fine: registering before `synth-engine` keeps all six last-registration harnesses on the Track, the two by-name captures unaffected; `tables.ensure` with a non-track key (the preview's `'preview'`); `whenReady` / hold ordering; M1's arithmetic (calm rack O(1), ×1 GainNodes, the same connection set summed); the canvas-sim lookup must change (it would throw, not merely differ); MASTER's camera key cannot collide (`trk_N` ids) | engine.js:4870; main.js:934–938, 2987; fx-dsp.js:2751; tests/canvas-sim.test.mjs:611 | — |
| P-1 · proposal | **Quantum-aligned anchors when the master holds an effect** (#2). (a) As fixed now: exact only when a start happens to land on a quantum boundary; otherwise ≤ −80 dB, measured (G2 (b)); the tracks' own racks have the same partition dependence today. (b) `anchor()` / `play()` / `reanchor()` round the anchor frame **up to a multiple of 128** while `project.master` holds an instance (≤ 2.7 ms later start; the metronome and playhead follow the anchor): every start is then on the bounce's partition — exact for the master **and** for every track rack, from a silent history (given Q1's same rate / oversampling); an empty-master project's stream is untouched (canonical-stream unchanged), a master project's transport `frame` moves (M3's caveat). The review recommends **(b)**: the user asked for "bit-exact with playback" and (b) is ≈ 10 lines in main.js plus a sim test; (a) is the fallback if the lead prefers no transport change in this stage | main.js:1500, 1525, 1549; engine.js:4484, 4638 | **for the lead** |

**Counts**: 3 P1 · 12 P2 · 14 P3 · 2 fine · 1 proposal. Every P1–P3 is fixed in the text above. **Left for the lead**: P-1 (aligned
anchors, recommended (b)); the canonical-stream pin's partition form (§7.3, #15); whether to ask the new Q1 (bounce defaults vs
playback) and whether "pinned" settles the old Q1 (#20). **Decided** (header): P-1 (b); the partition form; Q1 asked; "pinned" settles it.
