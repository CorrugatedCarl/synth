# Stage 9c: the 1960s Moog extras (IMPL-9c) — contract

ROADMAP row 9's next step ("the 1960s extras (901 family, 904C, 905, 912, 984, 991, CP3) as 9c"; IMPL-9b §0 "Out (stage 9c)"; the
user's order after the Master canvas, 2026-10-22). **Scope (the lead's choice, 2026-10-23)**: the **ten module types** the 1960s systems
have and stages 9 / 9b don't — **901** (the combined VCO), **901A** (oscillator driver), **901B** (oscillator), **901C** (oscillator
control), **904C** (filter coupler), **905** (spring reverberation), **912** (envelope follower), **984** (four-channel matrix mixer), **991**
(filter and attenuator), **CP3** (the console mixer of the 901 systems) — and, if the user says yes (§10 Q1), a **third set tile** with
them patched. It designs to every settled decision of stages 9 / 9b / P / M (not re-asked): the `m900` "900 Series" instrument, mono
(LOW / LAST), physics cords (only the plug ends take touches), the "Moog modules" Sources view, original art only (our own drawings in the
house style, **no photograph fetched or viewed**, no logo, no maker words, no manual prose), no artificial caps (stage P), presets visual
only (no audio lever: every type's cost is paid on every device), canvas only.

Inputs: the map [map-9c.md](map-9c.md) (facts with file:line at cf85ae3, cited "map §n"); **RM** [research-moog-modules.md](research-moog-modules.md)
(§1.3 levels, §2.2 sets, §4 the 1960s modules RM:156–198, §8 conflicts / gaps RM:325–335). **The research for these modules is thin and is
not re-opened** (map §5.1: the text sources are exhausted; scans / preprints are images or paywalled) — where RM is silent this contract
chooses, says [C], and the module's plate says **OURS** where the whole module is a stand-in (the CP2 / CP4A / CP35 precedent, I9b:49).
**Code references are to `canvas` at cf85ae3**. Tags as before: **[R]** RM / an engine fact (file:line), **[R?]** secondary (the lane
pins it), **[C]** a choice made here (a builder may refine a [C] with a reason in §12, never an [R]).

**The user's answers (2026-10-23 — settled)**: Q1 **yes, the System IIIc set tile** with its starting sound; Q2 the ten tiles under a new
**"1960s"** heading; Q3 the 904C **self-contained**. The lead's decisions on the skeptic's open items: §13 ("The lead's decisions").

**Invariants**
- **D1 Old sound bit-identical**: every frozen golden — golden-classic / -fx / -presets / -random / -graph, canonical-stream,
  golden-drums / -606 / -909 / -sdsv, **golden-moog (ref-9)**, **golden-moog-b (ref-9b)**, the ref-9-core / ref-P record pins, ref-M — is
  untouched. In `moog-dsp.js` the 26 existing classes, the shared helpers (`Osc`, `ex2`, `tanp`, `tr`, `rail`, `knee`, `psin`, `base`,
  `drift`, `insAcc`) and the existing `SPEC` / `ORDER` / `T` rows are **not edited — 9c appends** (I9b:34–36); `LINK`
  (moog-dsp.js:271) gains a `'901b'` key, the 921B's untouched. A 9c class may *instantiate* `Osc` / `M904A` / `M904B` and call the
  helpers, never change them. `patch-dsp.js`, `engine.js`, `cv-patch.js`, `main.js`, **`patch-core.js`**: **not edited** unless a lane
  proves it must (map §2.9: a plain type needs none; the CP3's rows fit the bus grammar as it is, §1.7; the set tiles are generic:
  cv-patch `setLoad`, main.js:7457–7476). **Integer-like ids** (901, 905, 912, 984, 991) enumerate first in `Object.keys(PatchMoog.T)`
  (engine.js:1555): the warm-up's module order and its parts move (JIT material, audible nowhere — G4 re-pins the list and checks the
  parts); `Object.values(fam.types).find` (patch-core.js:480) stays order-free (one linked type per driver type) [R, read].
- **D2 New sound frozen**: `tests/ref-9c/` (verbatim patch-dsp / moog-dsp / engine + MANIFEST, the ref-9b mechanism) rendered by a new
  `tests/golden-moog-c.test.mjs`, frozen at acceptance (`GOLDEN_FREEZE_9C=1`); from then ref-9 guards the Model 15, ref-9b the 9b cases,
  ref-9c the 9c ones. Its case list is **literal from the start** (`C_TYPES` = the ten, `C_PRESETS` = the three; never `ORDER` minus the
  older lists: that derived form is what D3 has to pin in golden-moog-b today). **At the freeze the lead hash-pins the 9c records**
  (`makeSet('s3c')`, the three presets: pk with and without vals, pvOf, rec, vals) beside D3's — 9b's same promise
  (patch-core.test.mjs:966) was never kept.
- **D3 Pins first** (map §2a, §5.4–5.5; skeptic #4): before any type is added, lane K's first commit (on the base) (a) pins every test
  that **derives a frozen comparison from the live table** to its literal 9b list: `golden-moog-b`'s `B_TYPES` (tests/golden-moog-b.test.mjs:36,
  read at :61, :269); patch-core.test's `bigRec` (:997 → the 22 literal types; its ref-P differentials :1079–1164), **:1167's
  `PT.presetNames('moog')` → the thirteen names** (else the three 9c presets meet ref-P's `loadPreset` — its sibling moog-core knows 9b's
  thirteen — and fail as 'No such patch'), :952's "every type" → the 9b `ORDER` literal; and (b) hash-pins the **9b records**
  (`makeSet('s35' / 's55')`, `loadSet` of both, the seven 9b presets: pk **with and without vals** — *Routed*'s bus rows —, pvOf, rec,
  vals) computed from the base tree before its first edit (patch-core.test.mjs:965–975's form, the K9b-a method I9b:918–923). Note: the
  ref-P differentials (:1166–1167, ref-P's moog-core = today's PRESETS / SETS but the id grammar: `diff tests/ref-P/moog-core.js
  moog-core.js`) **already** freeze the 9b sets and presets against a frozen copy — map §5.5's "not pinned" is half true; (b) is the
  second guard, (a)'s literal :1167 keeps the first one alive. Pins that fail **loudly** and move to the new truth (each by its file's
  owner, §4): patch-core.test :165–166 (the fuzz invariants: "drv only 921B → 921A, ≤ 3" → a linked type → its `link.to`, ≤ its `max`),
  engine-track.test :2279–2280 (`MG.ORDER_ALL.length + 1` → + the linked types' count, 2: each is warmed twice, engine.js:1581 — else
  `big` is empty and `big.length >= 100` fails), :2211 (`PRESETS.length` 13 → 16), and map §2a's count / order pins.
- **D4 One instrument, one output** (unchanged): a 1960s rack is the same `m900` device; its sound leaves through the controller's MAIN OUT.
- **D5 Honest sources**: a [C] number is labelled [C] here and in RM §10's as-modelled rows; a stand-in module's plate says OURS.

---------------------------------------------------------------------------------------------------------------------------------

## 1. The modules (tables: lane K → moog-core.js `TYPES`; DSP: lane V → moog-dsp.js; faces: lane X → panels/m900c.js)

Widths in MU (1 MU = 128 × 512 px face, sizes per MC:80–83). Jacks `in` / `out`; `sig` a = audio, c = CV, s = S-trigger. Params
`id def lo…hi`. Levels in volts on the ±rails of the engine (`rail` +12 / −6, MD:1405).

### 1.0 The tables — the one source K, V and X build from in parallel (skeptic #6)
Jack order = the payload port = `PatchMoog.JACKS` = the faces' `port`s (moog-core.test:393–430 / moog-dsp.test:347 cross-check), so
it is fixed **here**, not in K's commit. `K(id, lo…hi, def)` a knob, `S(id, [opts], def)` a switch (def = the index); jacks `id dir sig
'LABEL' {sec, norm, ac}` (`ac` = moog-dsp's AC flag: the module does the coupling). Group **`s60`** for all ten (`GROUPS.s60 =
'1960s'`, appended: §10 Q2). Names ≤ 40 / tiles ≤ 24 [C]; `cost` = G2's target until V measures.

| type · name / tile | MU | params, in order | jacks, in order · sections · link |
|---|---|---|---|
| **901** · 901 Oscillator / 901 Oscillator | 3 | `fv` Fixed Voltage −5…6 (0) · `rg` Range [Lo 32′ 16′ 8′ 4′ 2′] 3 · `fq` Fine −6…6 (0; ±1 oct = the 921B's dial, DIAL) · `pw` Pulse Width 10…90 (50) · `v1 v2 v3 v4` Sine / Sawtooth / Triangle / Pulse Level 0…10 (10) — 8 | `f1 f2 f3` in v cv CONTROL INPUT k · `sin saw tri pls` out v au · `vsin vsaw vtri vpls` out v au VARIABLE … OUT — 11, one section |
| **901A** · 901A Oscillator Controller / 901A Controller | 1 | `fv` −5…6 (0) · `fq` −6…6 (0) · `pw` 10…90 (50) — 3 (no range: §1.1) | `f1 f2 f3` in v cv — 3 · SPEC `xout: 2` (r, the width offset) |
| **901B** · 901B Oscillator / 901B Oscillator | 1 | `rg` Range [Lo 32′ 16′ 8′ 4′ 2′] 3 · `vn` Frequency −6…6 (0) · `v1…v4` 0…10 (10) — 6 | `sin saw tri pls vsin vsaw vtri vpls` out v au — 8 · SPEC `xin: 2` · MC `link: { to: '901a', max: 3 }` · `LINK['901b'] = { from: '901a', def: [1, 0] }` |
| **901C** · 901C Output Stage / 901C Output stage | 1 | `am` Amplitude 0…10 (10) | `in` in v au INPUT · `p` out v cv OUTPUT + · `n` out v cv OUTPUT − — 3 |
| **904C** · 904C Filter Coupler / 904C Coupler | 2 | `md` Mode [Band Reject, Off, Band Pass] 2 · `fc` Center Frequency −6…6 (0) · `bw` Bandwidth 0…3 (1) | `in` in v au SIGNAL INPUT · `c1 c2` in v cv CENTER FREQUENCY CONTROL k · `b1` in v cv BANDWIDTH CONTROL · `out` out v au SIGNAL OUTPUT — 5 |
| **905** · 905 Reverberation / 905 Reverb | 2 | `mx` Mix 0…10 (5) | `in` in v au · `out` out v au — 2 |
| **912** · 912 Envelope Follower / 912 Follower | 1 | `rs` Response [Short Medium Long] 1 · `th` Threshold 0…10 (5) | `in` in v au SIGNAL INPUT {ac} · `co` out v cv CONTROL OUTPUT — sec 0 · `ci` in v cv COMPARATOR INPUT {sec 1, norm `co`} · `st` out **s** tr TRIGGER OUTPUT {sec 1} — 4; secs `['follow', 'comp']` |
| **984** · 984 Four-Channel Mixer / 984 Matrix mixer | 4 | `l11 l12 l13 l14 l21 … l44` (input i → bus o) 0…10 (10 on `l11 l22 l33 l44`, else 0) · `m1…m4` Master k 0…10 (8) · `bs` Bass 0…10 (5) · `tb` Treble 0…10 (5) — 22 | `i1…i4` in v au {ac} · `o1…o4` out v au — 8, one section |
| **991** · 991 Filter and Attenuator / 991 Filter | 1 | `lp` Low Pass 0…10 (10) · `hp` High Pass 0…10 (0) · `at` Attenuator 0…10 (10) | `in` in v au · `out` out v au — 2 |
| **CP3** · CP3 Mixer and Routing / CP3 Mixer | 4 · console | the CP3A's 14, ids / order / defaults (MC:246–249) | the CP3A's 12, secs `['mix', 'route', 'mult']` (MC:250–252) · bus: `[c.kp1, c.kw, c.ka, .xr]` under `r1…r4` → **`901a\|901\|921a\|921#=.f3`** (§1.7) |

moog-dsp.test's pins follow (V): `ac` list + `912.in 984.i1 … i4`; S jacks + `912.st`; SECS + 9c's; `LINK` + `'901b'`; moog-core.test's
(K): params > 16 → `['960', '984']`, bus types + `cp3`, groups + `s60`.

### 1.1 901 family (RM:156–160, :48–49, :65–68, :248, :262–263, :325) — faithful from facts
- **901** (3 MU [R]) — a 901A + 901B on one panel, **self-contained** like the 921 (no link). f = C4 · 2^(ΣV + `fv` + oct(`rg`) +
  `fq` / 6 + 2·dv) [R the controls, RM:156; C the law, the 921's]: `fv` −5 … +6 [R]; `rg` 32′ … 2′ = −2 … +2 oct about 8′ (8′ at 0 V =
  C4, stage 9's), **Lo = 32′ − 4 oct** (1.02 Hz at 0 V: 32 mHz … 65 Hz over `fv`, RM's bench 35 mHz … 70 Hz within 10 % — the 921B's LO
  rule) [C on R]; `fq` ±1 oct [R? emu]; `pw` 10 … 90 % [C — RM has one unit's 47.8 … 91.5 %], **no width jack** [R: three control
  inputs only]; f ≤ 0.45 · fs. Jacks `f1 f2 f3` summed, 1 V/oct [R] — named as the 921's so one bus row reaches either (§1.7). Fixed
  outputs at **the bench set** (saw 1.73, triangle 2.25, sine 1.41, pulse 2.4 V p-p; the pulse ±1.2 V at every width, as the 921's
  rectangle) [R T-OSC2, RM:263] — **not** the 921B's (MD:56): new constants; **variable outputs = the fixed output × v / 10** (at 10 the
  fixed level: RM's "0 … 0.5 V" sits beside the spec's 0.5 V *RMS* fixed level, RM:48 — the draft's "0 … 0.5 V p-p" would make them 3–5 ×
  quieter than the fixed jacks) [R the span, C linear]. Waveshapes band-limited like the 921's (`Osc` instantiated, never edited); the
  sine a diode-shaped triangle [C: a soft knee, THD ≈ 2 % — RM gives no number]. Drift: the stage-9 `drift` walk with **2 · dv** in the
  exponent (no helper edit) [C — RM: "strong temperature drift"]; tracking ideal [C — the measured ≈ 2-octave tracking not modelled].
- **901A** (1 MU [R]) — driver, **no audio outputs** (link only, as the 921A). **The law across the link differs from 921A → 921B**
  [R? RM:65–68 (ZB-EVO), :248]: the 901A converts — **link 0 = r = 2^(ΣV + `fv` + `fq` / 6)** (`ex2` once a driver-sample; dimensionless,
  1 at 0 V: the "current" its 901Bs' ramps are linear in — not Hz: each 901B's own footage switch multiplies it, as a timing capacitor
  would), **link 1 = (`pw` − 50) / 100** (the 921A's width offset). **No range switch** [C: RM:157 names a "range" with no positions;
  the 901B's Lo + 5 is the range that sets pitch — two footage switches in series would double every octave offset; §11]. Its
  **`link: { to: '901a', max: 3 }`** [R MS-901A; RM:325 "3 per driver in the UI"] — **not 12**: makeSet, `addModule` and a set's `ensure`
  hang a new 901B on **the first driver with room** (moog-core.js:510, patch-core.js:344 `freeDriver`), so at 12 the IIIc's nine 901Bs
  would all sit on 901A 1 (RM:99: nine on three drivers); 12 (the JD manual quote) is a known limit (§11). The evaluator takes the second
  link pair as it is (patch-dsp.js:102–105: `nLO` per driver type).
- **901B** (1 MU [R]) — oscillator, driven (`LINK['901b'] = { from: '901a', def: [1, 0] }`: undriven, link 0 reads the constant 1 —
  a non-zero def is a constant feed, patch-dsp.js:260 (0 would be the zero buffer: f = 0) — and the width 50 %; no evaluator edit).
  **f = max(0, f_nom(`rg`) · (r + k − 1)) · 2^(2·dv)**, f_nom = C4 · 2^oct(`rg`) (the 901's footages), **k = 2^(`vn` · (4/3) / 6)** (× 0.397
  … × 2.52 at ±6: "± 1 oct + a major third" [R? emu]) — the vernier **a fixed number of Hz**, (k − 1) · f_nom [R? RM:65–68]: two 901Bs
  on one driver beat at one rate across the keyboard (the 901's character); undriven = k · f_nom [C]. **A 901B tuned below its driver
  stalls** where r < 1 − k (low keys, k < 1): f clamps at 0 — a relaxation core does not run backwards; the phase holds, its outputs a
  held level (§11) [C]. f ≤ 0.45 · fs; the width from link 1 (no knob of its own [R]); outputs as the 901's (4 fixed + 4 variable [R],
  the bench levels). Drift **per oscillator** (2 · dv as the 901's: the 901Bs of one driver wander apart; the 901A none) [C].
- **901C** (1 MU [C — RM:159: one sentence, 15 made]) — oscillator control: p = in · `am` / 10, n = −p, railed ("two CV outputs 180°
  apart" [R]; the rest [C]). Plate: OURS (the layout).

### 1.2 904C — filter coupler (RM:181, :239, :268) [C: self-contained — §10 Q3]
2 MU [C]. A low-pass and a high-pass **inside the module**, four one-pole stages each — the 904A's at k 0 and the 904B's (the frozen
`M904A` / `M904B` may be instantiated, never edited; at k 0 the 904A's ladder is four one-poles through `tr`, so the 904B's form for both
in new code is the cheaper one: ≈ 0.0016 a filter, I9b §12 V9c) [C]. **Centre** f0 = 2^(`fc` + 8 + c1 + c2) Hz (the 904A's middle range,
moog-dsp's 2^(FIXED + 6 + 2·RANGE): 4 Hz … 16.4 kHz over the knob) [C — RM gives no range]; both corners move with it, 1 V/oct [R].
**Bandwidth** B = `bw` + b1 oct, clamped 0 … 6 [C]: +1 V widens by an octave, one corner up, the other down ("inverted for one filter"
[R RM:239]); `bw` 0 … 3 [R? emu]; the jack count (`c1 c2`, `b1`) [C: RM "CV jacks for centre and bandwidth"]. Corners by their −3 dB
points (a 4-pole −3 dB = 0.435 × its per-stage corner, RM:242). **Band Pass** = HP → LP in series [R PAT], the HP's −3 dB at f0 · 2^(−B/2),
the LP's at f0 · 2^(B/2), × a make-up to 0 dB at the peak (≤ +6 dB, at B 0) [C]. **Band Reject** = the two in parallel, summed [R PAT],
the LP's −3 dB at f0 · 2^(−B/2), the HP's at f0 · 2^(B/2) — **a notch only near one spacing** (skeptic #9): symmetric 4-pole pairs are
complex conjugates at f0, so the sum is 2·|H|·cos(4·atan x), x = f0 / the LP's per-stage corner — a null at x = tan(π/8) (corners f0 ×
2.414 and f0 / 2.414), ≈ −20 dB at B 0, only ≈ −8 / −4 / −11 dB at B 0.5 / 1 / 3. V measures the depth over `bw` and, if the sum reads
as no reject, takes **in − BP** (an exact null at f0 at every B: the symmetric BP is real at f0) [C], says which in §12 (RM's
"parallel" then a known limit). **Off** = the input straight through [C — RM:181's third position uncouples the pair; a self-contained
module has nothing else to pass]. Plate says the pair is inside (OURS).

### 1.3 905 — spring reverberation (RM:185, :257) [C — every number]
2 MU [C]. Jacks `in`, `out`; param `mx` wet / dry 0…10 (def 5) [R: a single control]. **out = −rail((1 − m) · x + m · w)**, m = `mx` /
10 — the output phase-inverted [R MS-905], read as the whole output, dry included [R?]; the crossfade linear [C]; at `mx` 0 out ≡ −x
(G5). The wet level: a 100 ms 1 kHz burst's wet energy = its dry energy ± 1 dB [C]. **The tank** [C — every number, RM:257]: the Spring
IR's structure and numbers (smpgen.js:466–486, SR 48 000 :70 — reused, not the code): three recirculating echo lines at 25 / 31 / 37 ms
(RT60 2.5 s, alternating polarity) summed, then **one shared chain of ≈ 120 first-order allpasses** (a = 0.6: the IR's smear), a damping
one-pole; the tank's input through `rail` (the house rails — `knee` is rail's helper, 0 inside −5 … +11 V, moog-dsp.js:76–80, not a clip
of its own). **The wet path runs at the base rate inside the class** [C, skeptic #2]: a short decimator (≥ 60 dB stopband above 0.4 ×
the base rate; V's filter) feeds the tank once every OS samples, the wet output is interpolated back to the OS rate, and both filters'
delays come off the echo lines (the wet timing exact); per sample, so a loop step's n = 1 gives the same bits (the decimation phase =
the sample's index in its chunk: CH = 4 · OS); the dry path at the OS rate. Why: **an allpass's dispersion is per sample** — a = 0.6
delays 0.27 / 0.47 / 2.0 samples a stage at 4 / 12 / 20 kHz at 48 kHz (the IR's 120 stages: 0.7 / 1.2 / 5 ms, its smear), but at 192 kHz
the audio band sits near DC where every stage is ≈ 0.25 sample (1.3 µs): the ≈ 40 stages ≤ 0.008 buys at OS 4 smear nothing audible, and
matching the IR there takes stretched stages (z^−OS each: 120 × 192 000 stage-samples ≈ 0.02) — at the base rate 120 × 48 000 × ≈ 0.9
ns ≈ 0.005, + the lines and filters ≈ 0.007 [mine: the 914's 1.45 ns a 2nd-order section-sample, I9b §12 V9c]. The I9 decision that
dropped a base-rate *907A* (I9:1042–1043: ≈ 1.5 ms latency, no loop membership) does not bind a path whose own delay is ≥ 25 ms.
**Budget ≤ 0.008 node at OS 4, and at OS 8** (the tank does not scale with OS). **Memory**: the lines at the base rate ≈ 1 800 doubles
each (≈ 45 kB a 905, × OS at the OS rate: 340 kB at OS 8), allocated in the constructor (graph(): within §3.8's graph() rule), sized from
fs / OS — an OS change keeps them. **Subnormals**: the chain's and filters' states in `flush()`, the echo lines flushed on write (one
compare a write — never a scan of the lines every 32nd chunk). **Idle**: nothing to add — a patched MAIN OUT is always live (I9 §3.6;
patch-dsp.js:747: `live()` reads the sink, not the signal), so a tail rings out; but a 905 left frozen by a pull (not live: no `ctl`, no
`run`) would replay its old tail when re-patched — its `ctl(cc)` clears the tank when cc ≠ the last cc + 1 [C]; `reset()` clears it
(panic, Play from a stop). **Not** the FX rack's reverbs (private to the FX script; golden-fx). No maker word on face or tile:
"Gibbs" (the tank's maker, RM:185) is not in cv-panel's `MAKERS` (cv-panel.js:73) — panel-check would not catch it.

### 1.4 912 — envelope follower (RM:195, :55, :329, :274)
1 MU [C]. Jacks: `in` (signal, AC 10 Hz as the 921B's AC input, MD:457 [C]); `co` control out; `ci` comparator in, **normalled to
`co`** (a second section, the CP35 cross-section `norm`, MC:265; the normal reads `co`, so its `om` bit is set and section 0 is live
whenever section 1 is); `st` S-trigger out (0 / 1) [R; the comparator's own jack R? — RM:195 says only "normalled"]. Params: `rs`
short / medium / long — release 0.01 / 0.03 / 0.1 s, attack ¼ of it [R? emu; C the attack]. **Law** [R the table, the map's fit]:
**`co = max(0, 5 + 0.5 · log2((Vpp + 1e-9) / 1 V))`**, capped at 6.5 V (8 V p-p; RM "takes up to 4 V p-p") — the table's seven points
within 0.2 V (31 mV → 2.49 … 4 V → 6.0) [R], calibrated at 250 Hz, 500 mV p-p → 4.5 V [R]; continued below 31 mV down to 0 V at 2^−10 V
≈ 1 mV p-p, silence → 0 V [C] (the draft's "floored at 0 V below 31 mV" would step 2.49 V → 0). **Vpp measured peak to peak**: a
positive and a negative peak detector on the AC-coupled input (attack / release as `rs`), Vpp = pos − neg [C] — a full-wave detector
reads 2 · max|x|, p-p only for a symmetric wave (a 10 % pulse reads ≈ 1.8 × its p-p: +0.42 V). Ripple is the circuit's: on Short a
50 Hz input ripples by ≈ 1 V (the release ≈ the period) [C, not smoothed]. **Comparator** [R the three pairs, C the knob]: `th` 0 / 5 /
10 → on / off **0.32 / 0.12 V, 2.88 / 0.2 V, 5.7 / 0.3 V**, piecewise linear between (`th` 2.5: 1.60 / 0.16 V); `st` closes when `ci`
rises above *on*, opens when it falls below *off*. **log2**: an approximation of its own (≤ 1e-4 oct ≡ 0.05 mV of `co`, tested as
`ex2`'s claim, RM:379), or the log every 4th OS sample interpolated (the follower is smooth: ≥ 2.5 ms attack) — V's choice by cost (G2).

### 1.5 984 — four-channel matrix mixer (RM:196, :275)
4 MU [C]. One section [map §3d]: inputs `i1…i4` (AC 10 Hz [R AC-coupled; C the corner]), outputs `o1…o4`; params `l11…l44` (input i →
bus o, 0…10), `m1…m4` bus masters 0…10, `bs`, `tb` 0…10 flat at 5 [R], **global** (one pair for the four buses [C — RM doesn't say]):
first-order low / high shelves ±12 dB at 100 Hz / 5 kHz [C], each read bus its own two states. **o_j = rail(tone(1.25 · (m_j / 10) · Σ_i
(l_ij / 10) · AC(i_i)))** — 1.25 through a channel at 10 / 10, tone flat [R]; linear tapers, not inverted [C — RM states the 902's and the
905's inversions, not the 984's]; the defaults (§1.0: the diagonal at 10, masters 8) make a fresh 984 four unity channels [C]. Unread buses
cost nothing (the CP3A's `om` mask, MD:1402). Audio only [R]. **Patched into itself** (any `o` → any `i`) the one section is a one-member
loop step, run per sample (+ ≈ 0.0015, COST.loop: measured, G2); its rails bound the runaway.

### 1.6 991 — filter and attenuator (RM:184, :335 "no controls / ranges found") — **stand-in, OURS**
1 MU [C]. `in` → LP → HP → × `at` / 10 → `out`, one section: `lp` 20 · 1000^(v / 10) Hz (10: 20 kHz, open), `hp` 10 · 1000^(v / 10) Hz
(0: 10 Hz), one-pole TPT each — the 923's / CP2's sections' maths (moog-dsp's `M923` / `MCP2`; laws MC:138–144, 270–277), new code.

### 1.7 CP3 — console mixer (RM:198, :221, :41)
4 MU console [C, as the CP3A]. The CP3A's behaviour [R as built, MC:246–253, MD:1393–1415] — 4 inputs, + / − outputs, master gain,
3 multiples, the asymmetric +12 / −6 clip — in **a class of its own** (`MCP3`, written out: moog-dsp's megamorphic rule, MD:20), with its
**4 routing switches feeding the drivers**: rows `{ sw: ['r' + k], a: [c.kp1, c.kw, c.ka, .xr][k − 1], b: '901a|901|921a|921#=.f3' }` —
CP3 k → the k-th of the 901As by number, then the 901, then the 921As, then the 921s [C] (the IIIc's four CP3s → its three 901As and
its 901). BUS_RE (patch-core.js:567) takes **one port for every listed type** (`L[k − 1] + '.' + port`, :594–596), so the 901 / 901A
name their control inputs `f1 f2 f3` as the 921 / 921A do — the draft's `c1 c2 c3` + `.f3` resolves to 'No such jack' (skeptic #5); with
that the grammar holds and **patch-core.js is not edited**. The click filter: not modelled [as 9b, I9b:266]. **The CP3A is not changed**
(ref-9b): its "more headroom" stays unmodelled. Plate: the CP3's own layout (ours).

### 1.8 Tray, Tidy, cost
A new tray heading **"1960s"** in the Moog modules view (§10 Q2) holding the ten tiles in the order above (`ORDER` += them at its end,
group `s60`: moog-core.test:274's group-by-group rule); **Tidy rows** [C]: `ROWS[0]` += 901 · 901A · 901B · 901C · **912**, `ROWS[1]` +=
904C · 905 · 984 · 991, `CONSOLE` += CP3 — in px the IIIc's rows sum 2 272 and 2 752 ≤ `rackWide` 2 816; the draft's (912 and 984 both on
the modifiers' row) sums 2 880 and wraps the 993 to a third line (patch-core.js:776) (skeptic #17). A stage-9 / 9b rack's Tidy is
unchanged (rackLayout places present types only). A `MOOG_GLYPH` each (cv-tray.js:504; cv-tray.test:1214 checks its knobs / jacks
against the type), drawn after X's faces land; a `COST.patch` entry each (cv-cost.js:120–129) — lane V's, who measures (§4).

---------------------------------------------------------------------------------------------------------------------------------

## 2. A set tile and presets (lane K; §10 Q1)
If Q1 is yes: **set `s3c`** — tile name **"System IIIc"** [C, the set-tile naming of "System 35 / 55"; ROADMAP 15's trademark note
applies before any sale] — the 1960s cabinet complement per RM:113–136 as far as the table now holds: 901 ×1, 901A ×3, 901B ×9, 902 ×3,
903A, 904A, 904B, 904C, 905, 911 ×3, 911A, 912, 914, 984, 992, 993, 994, CP3 ×4 and a CP8A standing for the CP9 (power: drawn, not
emulated) [C] — **36 modules + the controller** (RM:140: the IIIc's "36"; the CP1's controller outputs are our controller's) — not the
draft's "≈ 45" (skeptic #17). `S3C` in its numbering order (Tidy's rows, then the console): 901 · 901A ×3 · 901B ×9 · 903A · 994 · 912 ·
904A · 904B · 904C · 905 · 914 · 911 ×3 · 911A · 902 ×3 · 984 · 992 · 993 · CP3 ×4 · CP8A — makeSet (moog-core.js:510, first driver with
room, `max` 3) hangs 901B 1–3 / 4–6 / 7–9 on 901A 1 / 2 / 3 [R RM:99], the CP3s route to 901A 1–3 and the 901 (§1.7). Starting sound
**"Drift choir"** [C], **keyboard-played** like the Model 15's and System 35's (a set tile never starts a drone by itself): KBD PITCH →
901A 1 `f1`; 901B 1 / 2 / 3 (8′; `vn` so the outer two sit ≈ ±2 Hz off: beats ≈ 2 and 4 Hz at every key, the 901's character) → the 984
(`i1 i2 i3` → bus 1) → 904C (Band Pass, `bw` ≈ 1.5) → 902 1 (911 1 from S-TRIG 1) → 905 (`mx` 4) → MAIN OUT. Plus **two presets** [C] that
show the new types in a Model 15 / System 35 rack: **"Follower wah"** — the 912 follows a signal **with dynamics** (the 902's output
after the keyboard's 911: a bare saw holds the follower still), its control out → 904A `c1` (the cutoff rides the note's level), its
S-trigger → a second 911 (a sweep each time the level crosses TH) — and **"Spring pluck"** (a short 911 pluck through the 905 at `mx` 7).
**Levels**: each preset peaks −12 … −3 dBFS at 48 k × 4 over the evaluator (moog-dsp.test.mjs:1530–1545's form, its `LINE` note) and,
through the whole Track at 48 k × 4 and 44.1 k × 2, never reaches the limiter and sounds (engine-track.test.mjs:2203–2211, its count 13 →
16) — the draft cited the latter for the window. Set-tile ids: `SET_TILES` (cv-tray.js:488), `SET_ART` (cv-art.js:493–496), `SET_NOTES`
(cv-patch.js:79; none needed: keyed); `SETS.s3c` + `S3C` (MC:345–355); patch-core.test's ref-P differential keeps its literal
`['m15', 's35', 's55']` (:1166) and the 9c set is pinned at the freeze (D2).

## 3. Budgets and gates

| gate | what | target |
|---|---|---|
| G1 D1 | every frozen golden + ref-9-core / ref-P (with D3's literal lists) / the new 9b record hashes (D3) | bit-identical |
| G2 per-type cost (node, OS 4, 48 kHz; the type minus its null twin through the evaluator, I9b §12 V9c's method; map §4) | 901 ≤ 0.0018 one output read, ≤ 0.0032 all eight (the 921: 0.0016 masked / 0.0029 all); 901A ≤ 0.0012 (now one `ex2` a sample on top of the 921A's 0.0005 — the draft's 0.0006 left no room for it); 901B ≤ 0.0016 (no `ex2`); **the group 901A + 3 × 901B ≤ 921A + 3 × 921B in one harness** (the link law's saving, [mine]); 901C ≤ 0.0005; 904C ≤ 0.008 (≈ 0.004 in the four-one-pole form); **905 ≤ 0.008 at OS 4 and OS 8** (§1.3); 912 ≤ 0.002; 984 ≤ 0.005 (4 buses read), ≤ 0.007 in a one-member loop; 991 ≤ 0.001; CP3 ≤ 0.0007; JSC within × 1.5 of each | as listed |
| G2b the family's size (skeptic #11) | the existing rows m9p / m9x / m9d / m9q / m9s with the 36-type family vs the 26 (moog-dsp.js A/B: ref-9b's vs the new, every other script current): V8 within 2 % (cpu-gate), JSC within 5 % of the 9b record (bench.json `"m9b"`) — 9b's sixteen types cost stage 9's rows 5–8 % on JSC (I9b:1132–1134) | as stated |
| G3 the set (if Q1) | bench row **`m9c`** = a IIIc classic patch (`makeSet('s3c')` re-patched: all ten oscillators → the 984 → 904C → 902 ×3 (911 ×3) → 905 → MAIN OUT, ≈ 30 live; the s3c starter alone is ≈ 0.03 — the draft gated that, ≈ 2 × its estimate, and left the heavy case open): estimate ≈ 0.045 from G2's figures + the 0.0055 base → **≤ 0.06 node** (1.3 ×, the I9 spike (a) rule), jsc / ipad from m9s's ratios (≈ 0.8 ×); ≈ 5 % of the iPad Pro at its factor; Medium / Low pay the same — presets are visual | ≤ 0.06 |
| G4 warm-up (skeptic #3) | (a) the warm payload list re-pinned (count + sha256, engine-track.test.mjs:2290–2291: the table changed — a pin to the new truth, as stage P's) and :2279–2280's `+ 1` → `+ 2` (D3); every part's graph a still holds every class, and **warmPatchOn's part** (engine.js:3867: the first part with a driven module) still holds the 921B — asserted (the 9c keys reorder the parts: 901 sorts first, 901A last); (b) **the existing gate stands, unedited**: the scope's warm-up ≤ 1.25 × ref-9's (:2796–2825) — the draft's "≤ 1.25 × ref-9b's" moves the absolute bar to ≈ 1.25 × 1.13 ≈ 1.41 × stage 9's (V8 ≈ 776 → ≈ 1 095 ms on the audio thread at the first Track; I9b:762–763, :1134) — a loosened gate (CLAUDE.md); plus a new 9c test ≤ 1.10 × ref-9b's (the stage's own growth); **V measures it first** (its ten classes as stubs of the right shape) and, past either, stops and reports — moving the cap is the user's (§10's extra); (c) the IIIc tile on a new Track: graph() median ≤ 0.5 / max ≤ 1 ms, first quanta ≤ ¼ of the deadline (:2786's gates) | V8 + JSC |
| G5 levels and laws | the 901 bench set ± 1 %, the footages' 0 V frequencies, Lo's span, the drift RMS 2 × the 921's; **the link law**: a 901B at f_nom · (r + k − 1) over three keys × three `vn` (the beat rate constant ± 0.1 Hz over 3 octaves), undriven k · f_nom, the stall (f = 0, held outputs), r = 2^ΣV ± 1.5e-4 cent; the 912's seven points within 0.2 V (sine, 250 Hz), a 10 % pulse within 0.2 V of a sine of the same p-p, 0 V in silence, the three hysteresis pairs at `th` 0 / 5 / 10; the 984's 1.25 ± 0.5 % at 10 / 10, AC −3 dB at 10 Hz, ±12 dB shelves, flat ± 0.1 dB at 5; the 905 at `mx` 0 ≡ −in (bit for bit), echoes at 25 / 31 / 37 ms ± 0.5 ms, RT60 2.5 s ± 10 %, the group-delay spread 4 → 20 kHz ≥ 3 ms (the IR's ≈ 4.3), no NaN / subnormal over a 60 s tail; the 904C's BP peak at f0 ± 2 % with its −3 dB edges ± 0.1 oct (B ≥ 1), its BR depth over `bw` recorded (≥ 12 dB at every B for the form chosen, §1.2), Off ≡ in; the 991's corners ± 2 %; the CP3 = the CP3A's maths, its rows → 901A k / the 901 | as stated |
| G6 UI | the 1960s heading and tiles, faces through panel-check, DOM ≤ the 9b limits (1 MU ≤ 90 painted, console ≤ 90, the 984 ≤ 130 [C]), face MB per preset (stage P), **the 36-module IIIc** at 4× / 6× CPU no worse than the System 55 (ui-m9b-mac / ui-P-mac), its Tidy in two cabinet rows + the console row | as stated |

## 4. Lanes (leaner shape; builders in worktrees reset to the base; exclusive files)

| lane | phase | owns | model |
|---|---|---|---|
| **K** tables + pins | 1 (its first commit = D3, on the base; then the tables per §1.0; the glyphs last, after X's faces) | `moog-core.js` (TYPES, ORDER, ROWS / CONSOLE, GROUPS `s60`, link, bus rows, SETS `s3c` / `S3C`, PRESETS); `cv-tray.js` (glyphs, `SET_TILES` + `'s3c'`), `cv-art.js` (`SET_ART.s3c` + its drawing), `cv-patch.js` (`SET_NOTES` only, if any); tests: `moog-core.test`, `patch-core.test` (D3 + :165–166 + the 9c rows + the old-build test through ref-P, §11), `golden-moog-b.test` (D3 only), `cv-tray.test`, `cv-art.test`, `cv-patch.test` (:497 the Patches… count), `canvas-9-sim.test` (:99–100) — **not** `patch-core.js` (§1.7: the grammar holds) | cheaper |
| **V** DSP + engine-side tests | 1 (golden-moog-c's cases after K's tables merge: its `rig()` builds through moog-core) | `moog-dsp.js` (SPEC rows, ORDER, LINK, ten classes, the `ins` lists, `T`, `K`), `tests/moog-dsp.test.mjs` (incl. its pins: ORDER, SECS, LINK, the `ac` / S lists, `LINE` for the three presets), `tests/golden-moog-c.test.mjs` + `tests/ref-9c/` (frozen at acceptance), `tests/engine-track.test.mjs` (G4; :2211's count, the headroom loop), **`cv-cost.js` + `tests/cv-cost.test.mjs`** (it measures), `tests/bench-scenarios.mjs` + `tests/bench.json` (+ `bench.html`'s list), RM §10's 9c rows | standard |
| **X** faces | 1 | `panels/m900c.js` (new), `panels/index.js` (the merge), `tests/cv-panel.test.mjs`, `tests/cv-face.test.mjs` (sizes, `FACES_9` every type) | cheaper |
| reviewers × 2 | 2 | (1) real engine: D1–D3, G2 / G2b, G4, G5, the link law, the 905's tail / idle / flush / frozen replay, the 912 law, records and presets; (2) headless Chrome: G6, the set at 1× / 4× / 6×, the tiles, cords onto the new jacks, no console error | standard |
| fixers | after | the finding's files, failing test first | cheaper |

**Exclusive means each pin is edited by its file's owner** (skeptic #13): the draft gave K "every count / order pin of map §2a", which
sits in V's (moog-dsp.test, engine-track.test) and X's (cv-panel.test, cv-face.test) files, and left canvas-9-sim.test, cv-patch.test,
cv-art.test and RM §10 unowned. **Known windows on the holding branch**: K's alone fails moog-dsp.test's cross-check (:347) and
moog-core.test's faces (:430) until V and X merge; V's alone fails nothing of K's (moog-core unchanged there) but golden-moog-c waits;
pwa.test until the lead's precache. **No golden window**: D3 lands first.

Rules (every lane): `?v=9` on every import; new test files `import './v8-guard.mjs'` first; never fake-DOM nodes in `assert.*`; one test
file at a time with `--max-old-space-size=2048`; no lane commits `sw.js` (the lead runs `node tools/precache.mjs --write`); D1's goldens
after any moog-dsp.js / moog-core.js commit; iterate `ORDER`, never `Object.keys(TYPES)` (MC:11 — five of the ten ids are integer-like).
The lead: the 9c record pins at the freeze (D2), the precache, the docs (RM §2.2 / §8 notes, ROADMAP row 9, HANDOVER).

## 10. Questions for the user (answered 2026-10-23: Q1 yes — System IIIc; Q2 a "1960s" heading; Q3 self-contained; the extra only if G4 is crossed)
- **Q1** A third set tile, **System IIIc** — the 1960s cabinet (36 modules: ten oscillators on three controllers, the coupled filters,
  the spring reverb, the matrix mixer, …) patched as a keyboard-played starting sound (three slowly beating oscillators through the
  band-pass and the spring) — (recommended) / single module tiles only.
- **Q2** Where the ten new tiles go in the Moog modules view: under a new **"1960s"** heading (recommended) / mixed into the existing
  groups by function.
- **Q3** The 904C filter coupler: **self-contained** — its own low-pass + high-pass inside, works on its own (recommended) / it couples a
  904A and a 904B you already have in the rack (closer to the original, but needs both and hidden wiring between them).
- *(Extra, asked only if lane V's first measure crosses the cap, G4 (b))* The app's start-up warm-up (on the first track, before sound)
  grows with every module type. *Recommended:* keep today's cap — the new modules' first use may then stutter once, as they warm on first
  play. *Alternative:* allow ≈ 1.35 × stage 9's (≈ 1 s on the Mac) so everything is warm from the start.

## 11. Known limits (recorded)
- The 991, the 901C and the 905 are largely our own (D5); the 904C's ranges are [C] (its centre on the 904A's middle range); the
  984's tone controls [C].
- The 901's measured ≈ 2-octave tracking error is not modelled (ideal tracking + double drift).
- The CP3A's "more headroom" stays unmodelled (ref-9b).
- A 901A drives at most **3** 901Bs (RM:325's "in the UI"); the manual's 12 is not offered — at 12 the "first driver with room" rule
  would pile a set's oscillators on one driver. The 901A has no range switch of its own (its 901Bs' footages set the range).
- **A 901B tuned below its driver stalls on low keys** (its vernier is a fixed number of Hz: below the driver's frequency it stops, its
  outputs holding a level) — the circuit's behaviour; told to the user with §10's answers ("things you will notice", 9b's form).
- The 904C's Band Reject is a true notch only near one bandwidth if built as RM's parallel sum (§1.2); V's choice is recorded.
- The 905's wet path runs at the base rate inside the module (its echoes ≥ 25 ms make the internal rate inaudible); its dry path at the
  OS rate.
- A 9c project opened by an older (9b) build keeps every module and cord but its 901Bs lose their driver (an unknown type's link is
  unknown: patch-core.js:142–147) — re-linked by hand after the update (an old-build test through ref-P says exactly this).

## 12. Notes (the builders fill in)
### Lane K
### Lane V
### Lane X
### Reviews and fixes
### Acceptance

## 13. Review log

### The skeptic review (2026-10-23, against the draft)

Every claim about code was read at cf85ae3 (`canvas`, clean); RM, map-9c, I9 / I9b, the tests the draft names and the ones that derive
from the live table (`grep MG.ORDER tests/*.mjs`); hand arithmetic only (the 905's allpass group delays, the 904C's conjugate pair, the
IIIc's Tidy widths, the warm-up ratios) — no test or script run. Severity as I9b §13: **P1** a contract contradiction, an impossible or
loosened gate; **P2** a gap a builder would trip on; **P3** a correction. Every fix below is applied above unless it says "left for the
lead". The draft's three [C] axes hold up: the 901A / 901B split maps onto the evaluator's link with **no** patch-dsp / engine edit (a
second link pair is per driver type, patch-dsp.js:102–105; a non-zero link def is a constant feed, :260), the 912's two sections with a
cross-section normal are the CP35's form, and the CP3's rows fit the bus grammar once the jack ids agree — patch-core.js stays untouched.

| # | point | evidence (file:line) | fix |
|---|---|---|---|
| 1 · P1 | **`max: 12` mis-wires the IIIc** and overstates its tag: makeSet, `addModule` and a set's `ensure` hang each new 901B on the first driver with room, so the IIIc's nine 901Bs all land on 901A 1 and drivers 2 / 3 drive nothing (RM:99: "9 osc. on 3 drivers"); RM's conflict row settles "3 per driver in the UI", not [R] 12 | moog-core.js:510; patch-core.js:344 (`freeDriver`), :476–483; RM:99, :157, :325 | **fixed in §1.0, §1.1, §2, §11**: `link: { to: '901a', max: 3 }` [R MS-901A]; S3C binds 3 / 3 / 3; 12 a known limit. *Left for the lead*: 12 + a starter that binds all nine 901Bs to their drivers is possible, but that preset would add twelve oscillators when loaded from Patches… |
| 2 · P1 | **The 905's gate defeats its own spec**: "the character of our Spring IR" at "≤ 0.008 at the OS rate". A first-order allpass delays per *sample*: at 48 kHz (the IR's rate) a = 0.6 gives 0.27 / 0.47 / 2.0 samples a stage at 4 / 12 / 20 kHz (120 stages: the IR's 0.7 / 1.2 / 5 ms smear); at 192 kHz the audio band sits where every stage is ≈ 0.25 sample (1.3 µs) — the ≈ 40 stages 0.008 buys there smear nothing audible; matching the IR at OS 4 takes stretched stages (≈ 0.02) | smpgen.js:466–486, :70 (SR 48 000); τ(ω) = (1 − a²) / (1 + 2a cos ω + a²); the 914's 1.45 ns a section-sample (I9b §12 V9c); I9:1042–1043 | **fixed in §1.3, G2, G5**: the IR's structure (three echo lines summed → one shared ≈ 120-stage chain) with **the wet path at the base rate inside the class** (decimate → tank → interpolate, the filters' delays taken off the ≥ 25 ms lines; per sample, so loop-safe and n-independent) ≈ 0.007 at OS 4 *and* 8; a dispersion target in G5. *Left for the lead*: this is a base-rate path inside one module — the I9 decision dropped a base-rate *907A* for its latency and loop membership, neither of which binds a ≥ 25 ms path; if vetoed, the budget must rise to ≈ 0.02 (stretched stages) or the spring loses its smear — say which |
| 3 · P1 | **G4 "≤ 1.25 × ref-9b's" loosens the warm-up gate**: the existing test caps the scope's warm-up at 1.25 × stage 9's; 9b measured × 1.11–1.15, so restating it moves the bar to ≈ 1.41 × (V8 ≈ 776 → ≈ 1 095 ms on the audio thread at the first Track) — CLAUDE.md: never loosen a gate | tests/engine-track.test.mjs:2796–2825; I9b:762–763, :1134; CLAUDE.md "Tests" | **fixed in G4, §10's extra**: the existing gate stays unedited; + a 9c test ≤ 1.10 × ref-9b's; V measures first with stub classes and stops past either. *Left for the lead*: if crossed, the cap is the user's (the conditional extra in §10) |
| 4 · P2 | **D3's pin list is incomplete**: patch-core.test :1167 runs the live `PT.presetNames` against ref-P, whose sibling moog-core knows 9b's thirteen — the three 9c presets fail as 'No such patch'; :952 compares "every type" with the live ORDER; the fuzz invariants (:165–166) hard-code "drv only 921B → 921A, ≤ 3"; engine-track :2279–2280's `ORDER_ALL.length + 1` assumes one linked type (two → `big` empty, `big.length >= 100` fails); :2211 pins 13 presets. And map §5.5's "9b records not pinned" is half true: :1166–1167 vs ref-P already freeze the 9b sets and presets (ref-P's moog-core = today's PRESETS / SETS but the id grammar) | tests/patch-core.test.mjs:165–166, :952, :997, :1166–1167; tests/ref-P/patch-core.js:44; `diff tests/ref-P/moog-core.js moog-core.js`; tests/engine-track.test.mjs:2211, :2279–2280; engine.js:1581 | **fixed in D3, §4**: the literal lists (:997, :952, :1167) in K's first commit; the loud pins moved to the new truth by each file's owner; D3 (b) kept as the second guard, with pk **with vals** (*Routed*'s rows) and `loadSet` |
| 5 · P2 | **The CP3's row `901a#=.f3` cannot resolve**: §1.1 named the 901A's inputs `c1 c2 c3`; BUS_RE takes one port for every listed type, so "to 921As when no 901A" also needs one id across 901A and 921A | patch-core.js:567, :594–596; moog-core.js:104 (`FCI` f1…f3), :253 | **fixed in §1.0, §1.1, §1.7**: the 901 / 901A take `f1 f2 f3`; rows `901a\|901\|921a\|921#=.f3` (the IIIc's CP3 4 → its 901); no patch-core edit |
| 6 · P2 | **§1 was not precise enough for K ∥ V ∥ X**: jack order (= the payload port), param ids / defaults / ranges, sections, the link's `xout` / `def`, `fc` "−? … +?", the 984 / 905 / 991 / 901C defaults, the vernier's knob law — each a cross-check failure (moog-core.test:393–430, moog-dsp.test:347) when three lanes guess | §1.1–§1.7 (as written) | **fixed in §1.0**: one table — ids in order, defaults, ranges, sections, link — that all three build from |
| 7 · P2 | **The link law as written cannot run undriven, nor below its driver**: "a linear frequency (Hz)" ignores each 901B's own footage switch (it multiplies, as a timing capacitor); a `def` of 0 is the zero buffer → an undriven 901B at 0 Hz, not "its nominal + vernier"; a fixed-Hz vernier below the driver gives f < 0 | patch-dsp.js:260 (`v !== 0 ?` constant `: []`); RM:65–68, :248 | **fixed in §1.0, §1.1, G5, §11**: link 0 = r = 2^(ΣV + fv + fq / 6) (dimensionless), `def: [1, 0]`; f = max(0, f_nom · (r + k − 1)); the stall said and tested |
| 8 · P2 | **The 912's law steps and mis-measures**: "floored at 0 V below 31 mV" jumps 2.49 V → 0 (the log law reaches 0 V at ≈ 1 mV); log2(0) unguarded; a full-wave detector reads 2 · max\|x\| — p-p only for symmetric waves (+0.42 V on a 10 % pulse); "one continuous law through the three pairs" names no knob positions — untestable | RM:55, :195; map §1 (the fit) | **fixed in §1.4, G5**: max(0, …) with Vpp + 1e-9, cap 6.5 V; two one-sided peak detectors; `th` 0 / 5 / 10 → the three pairs, piecewise linear |
| 9 · P2 | **The 904C**: its centre range "−? … +?"; "Off = straight through [R]" is [C]; and **the parallel sum is a notch only near one spacing** — symmetric 4-pole LP / HP are conjugate at f0, the sum 2\|H\| cos(4 atan x): ≈ −20 dB at B 0, ≈ −8 / −4 / −11 dB at B 0.5 / 1 / 3 | RM:181, :239, :242 (0.435), :268 | **fixed in §1.2, G5, §11**: f0 = 2^(fc + 8 + ΣC); corners by −3 dB points; BP make-up; BR measured, **in − BP** if the sum reads as no reject (V's choice in §12); tags. *Left for the lead*: confirm V's BR choice (RM's [R] "parallel" vs a working notch) |
| 10 · P2 | **G2's 901A ≤ 0.0006** leaves no room for the `ex2` a sample the 901A now does (the 921A alone is 0.0005); the saving is in the group, which no gate measured | cv-cost.js:120 (921A 0.0005); I9b §12 V9c; G2 (as written) | **fixed in G2**: 901A ≤ 0.0012, 901B ≤ 0.0016, the group 901A + 3 × 901B ≤ 921A + 3 × 921B; the 901 masked and all-outputs |
| 11 · P2 | **No gate on the old rows' regression from the family's size**: 9b's sixteen types cost stage 9's rows 5–8 % on JSC ("the family's, not this lane's") | I9b:1132–1134 | **fixed: G2b** (V8 ± 2 % cpu-gate, JSC ± 5 %, moog-dsp A/B) |
| 12 · P2 | **G3 gated the light case**: the s3c starter (≈ 8 live, ≈ 0.03) at ≤ 0.06 is ≈ 2 × its estimate, while a whole-set patch (≈ 0.045) had no row | G3 (as written); map §4 | **fixed in G3**: `m9c` = a IIIc classic patch, ≤ 0.06 (1.3 ×) |
| 13 · P2 | **Lanes not exclusive**: K owned "every pin of map §2a", which sits in V's (moog-dsp.test, engine-track.test) and X's (cv-panel / cv-face tests) files; canvas-9-sim.test, cv-patch.test, cv-art.test and RM §10 unowned; cv-cost.js with K but its numbers V's; K's glyphs need X's faces; golden-moog-c's cases need K's tables | §4 (as written); map §2a; tests/canvas-9-sim.test.mjs:99–100, tests/cv-patch.test.mjs:497 | **fixed in §4**: each pin by its file's owner; cv-cost to V; the orderings and the known windows said |
| 14 · P2 | **The 905's idle claim misreads I9 §3.6** ("its tail keeps the patch live"): `live()` reads the sink, never the signal — a patched MAIN OUT is always live. The real tail issue: a 905 frozen by a pull replays its old tail when re-patched; and a 32-chunk `flush()` scanning seconds of delay line costs more than the stages | patch-dsp.js:747; I9:453–460; moog-dsp.js header (flush) | **fixed in §1.3**: nothing to add for idle; `ctl(cc)` clears the tank on a cc gap; flush-on-write for the lines; memory sized at the base rate |
| 15 · P3 | `knee` "instantiated" as the input clip: it is rail's helper (returns 0 inside −5 … +11) | moog-dsp.js:76–80 | **fixed in §1.3**: the tank's input through `rail` |
| 16 · P3 | Variable outputs "× level / 10, 0 … 0.5 V p-p at 10" contradict the bench-set fixed levels (1.41 … 2.4 V p-p); RM's 0.5 V is the spec's RMS fixed level | RM:48, :156 | **fixed in §1.1**: = the fixed output × v / 10 |
| 17 · P3 | **The set is 35 (+ a CP8A for the CP9) = 36 modules**, not "≈ 45"; and the draft's Tidy rows overflow: the modifiers' row sums 2 880 px > `rackWide` 2 816, wrapping the 993 to a third line | RM:113–140; moog-core.js:485; patch-core.js:776 | **fixed in §1.8, §2, G6, Q1**: S3C listed; the 912 on `ROWS[0]` (2 272 / 2 752 px) |
| 18 · P3 | "Drift choir" named no keyboard or VCA — a drone that starts by itself when a set tile lands (the Model 15 / System 35 starters are keyed); "Follower wah"'s 912 had nothing dynamic to follow (a bare saw holds it still) | §2 (as written); moog-core.js:354–355 | **fixed in §2** |
| 19 · P3 | The level-gate cite: −12 … −3 dBFS is moog-dsp.test's evaluator check at 48 k × 4; engine-track's is "never reaches the limiter, sounds" at both rates | tests/moog-dsp.test.mjs:1530–1545; tests/engine-track.test.mjs:2203–2211 | **fixed in §2** |
| 20 · P3 | Tags: the link law [R] → [R?] (RM:68 rests on ZB-EVO); "Off = straight through" [R] → [C]; the 905's "wet and dry both" [R?]; the 904C's jack count [C]; the 912's comparator jack [R?] | RM:65–68, :181, :185, :195 | **fixed** where each sits |
| 21 · P3 | "Gibbs" (the tank's maker, RM:185) is not in cv-panel's `MAKERS`: panel-check would let it onto the 905's face | cv-panel.js:73 | **fixed in §1.3** (X told) |
| 22 · P3 | An older (9b) build drops a 901B's `drv` (an unknown type's link is unknown) — the first linked type since stage 9, so 9b's "kept whole" no longer holds for drivers | patch-core.js:142–147 (ref-P's the same) | **fixed in §11**; K's old-build test through ref-P asserts it |
| 23 · P3 | Integer-like ids reorder `Object.keys(PatchMoog.T)`: the warm graphs' order and parts move (901 first, 901A last); warmPatchOn takes the first part with a driven module — it must still hold the 921B (Classic bass's first quanta); `Object.values(fam.types).find` is order-free | engine.js:1555, :1581, :1639–1658, :3859–3867; patch-core.js:480 | **fixed in D1, G4 (a)** |
| 24 · P3 | The 901A's "range" (RM:157, no positions) as a second footage switch doubles every octave offset with the 901B's | RM:157–158 | **fixed in §1.0, §1.1**: no range on the 901A [C] |
| 25 · P3 | Drift ×2 named no place (driver vs oscillator) | §1.1 (as written); moog-dsp.js:295 | **fixed**: per oscillator (901, 901B), 2 · dv, no helper edit |
| 26 · P3 | golden-moog-c's lists must be literal from the start (B_TYPES's derived form is what D3 pins today); 9b's promise to hash-pin its records at the freeze (patch-core.test.mjs:966) was never kept | tests/golden-moog-b.test.mjs:36; tests/patch-core.test.mjs:965–975 | **fixed in D2**: `C_TYPES` / `C_PRESETS`; the lead pins the 9c records at the freeze |
| 27 · P3 | The 984: no defaults, polarity, self-loop cost or rails | §1.5 (as written) | **fixed in §1.0, §1.5, G2** |
| 28 · P3 | The CP3 "as the CP3A" invites `T.cp3 = MCP3A` (two types on one class, `base` keyed by type) | moog-dsp.js:20, :278–286 (`base` keyed by type) | **fixed in §1.7**: `MCP3` written out |
| 29 · fine | Checked and fine: no 9c edit to patch-dsp / engine / patch-core / main / cv-patch is needed (a second link pair, constant link defs, the bus grammar with matching ids, the generic `setLoad` / `setPick`: cv-patch.js:607, main.js:7457–7476); `M904A` / `M904B` / `Osc` instantiable as they are; the 912's normal crosses sections as the CP35's (its `ins` holds 2 slots: the zero-buffer rule, I9b §3.3); the 984 as one section (MC:19) with 4 outputs and 22 params (≤ 30 / ≤ 48); no other golden sees the patch family (golden-graph.test.mjs:23–25); ref-P's moog-core carries today's presets and sets; makeSet's shedding and the warm-up's "linked type in its driver's part" are generic (moog-core.js:515–521, engine.js:1654) | as cited | — |

**The lead's decisions (2026-10-23)**: #1 **3 per driver** (RM:99 "9 osc. on 3 drivers", MS-901A; a hardware fan-out, not an artificial
cap — more 901As add more); #2 **approved** — the 905's wet path at the base rate inside the class (a ≥ 25 ms path: neither of I9's
907A reasons binds it); #3 as fixed (the existing gate unedited, + ≤ 1.10 × ref-9b; past either, §10's extra goes to the user); #9 V
measures the parallel sum and takes **in − BP** if it doesn't read as a reject (a working notch over RM's literal "parallel", recorded
[C] in §11); "System IIIc" follows the 9b precedent (ROADMAP 15 before any sale).
**Left for the lead** (collected): #1 (12 instead of 3 needs a set-aware starter), #2 (the 905's base-rate wet path vs I9's 907A
decision — veto means ≈ 0.02 or no smear), #3 (the warm-up cap, the user's if crossed — §10's extra), #9 (confirm V's Band Reject form);
also the set's name "System IIIc" is a maker's product name like "System 35 / 55" (ROADMAP 15's note — the 9b precedent stands).
