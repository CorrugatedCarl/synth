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
of its own). **The wet path runs at a nominal 44.1 / 48 kHz inside the class** (the base rate at a 44.1 / 48 kHz context; any other rate R = OS · 2^⌊log2(base / 44.1k)⌋ — fix V, review 1 F1) [C, skeptic #2]: a short decimator (≥ 60 dB stopband above 0.4 ×
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
- The 905's wet path runs at a nominal 44.1 / 48 kHz inside the module (fix V; the 44.1 kHz family its own 71 × 0.5014 chain) (its echoes ≥ 25 ms make the internal rate inaudible); its dry path at the
  OS rate.
- A 9c project opened by an older (9b) build keeps every module and cord but its 901Bs lose their driver (an unknown type's link is
  unknown: patch-core.js:142–147) — re-linked by hand after the update (an old-build test through ref-P says exactly this).

## 12. Notes (the builders fill in)
### Lane K

**K9c-a (83ae3a6, on the base 5c7e65a, before any table edit)** — D3. `golden-moog-b.test`'s `B_TYPES` = the sixteen literal; patch-core.test's
`ORDER_9B` / `PRESETS_9B` literals at :952 (every type), `bigRec` (:997) and the ref-P preset differential (:1167). **New hash-pin test**
`FROZEN_9B` (patch-core.test, beside the Model 15's): `makeSet('s35' / 's55')`, `loadSet` fresh and over a Model 15 / a System 35
(+ sha256 of the whole result: `added`, `bound`, `back`), the seven 9b presets on their set and on a fresh record — pk without and with
vals (`pkv`: Routed's rows, the CP2's always-on two), pvOf, rec, vals — computed from the base tree (a copy in the scratchpad, again from the
worktree: identical); green on the base and unchanged after the tables (the 9b records did not move). golden-moog-b / golden-moog /
patch-core / moog-core green at the commit.

**K9c-b (f8aabaf) tables · K9c-c (7402f36) tray / art / cost / pins** — everything of §1.0 as written, built from the table in one pass. Refinements
and choices ([C]):
- **The CP3: 10 params, 12 jacks, four multiples** — §1.0's "the CP3A's 14" and §1.7's "3 multiples" are miscounts (the CP3A has x1…x4, ms,
  r1…r4, ra = 10 params; its jacks m1…m4, mo, mn, x4, xr, a1…a4 = 12, four multiples). `T_CP3` copies the CP3A's `params` / `jacks` / `secs`
  (`Object.assign` per entry, so the laws are the CP3A's by construction) — lane X's face already places that (the coordinator's note); V's
  `SPEC.cp3` the CP3A's 10 / 12. Its bus rows as §1.0: `.xr` / `c.kp1 c.kw c.ka` under `r1…r4` → `901a|901|921a|921#=.f3`.
- **ROWS: the 1960s types are inserted, not appended** — Tidy places a row's types in the row's order, then by number, so an appended 901 sits after
  the 903A / 994 while §2's numbering list (and S3C) puts the 901 family first. ROWS[0] = `921 921a 921b 923 901 901a 901b 901c 903a 995 994 960 962 912`,
  ROWS[1] = `904a 904b 904c 991 905 907a 914 911 911a 902 984 992 993`, CONSOLE = `cp2 cp3a cp3 cp4a cp35 961 clk cp8a`: the nine-type / 9b rows
  without the new ids are exactly the 9b rows (a Model 15 / System 35 / 55 Tidy unchanged: pinned), and the IIIc's numbering order = its Tidy order
  (pinned: every set's row types ascend). Widths 2 272 / 2 752 / 2 016 (≤ 2 816). A 991 is in no set.
- **ORDER** (35): the ten last, in §1.0's order; `GROUPS.s60 = '1960s'`. **Labels** (the table gave none for most jacks): fixed outputs `SINE OUT …`,
  variable `VARIABLE SINE OUT …`; `CONTROL INPUT k` (901 / 901A); 901C `INPUT` / `OUTPUT +` / `OUTPUT −`; 904C `CENTER FREQUENCY CONTROL k` /
  `BANDWIDTH CONTROL`; 905 / 991 `SIGNAL INPUT` / `SIGNAL OUTPUT`; 912 `SIGNAL INPUT` / `CONTROL OUTPUT` / `COMPARATOR INPUT` / `TRIGGER OUTPUT`; 984
  `INPUT k` / `OUTPUT k`, knobs `Input i → Bus o`, `Master o`. No maker word anywhere (tested for "gibbs").
- **LAW** gains display laws (V's the same): `f904c(fc) = 2^(fc + 8)` Hz, `th912on` / `th912off` (piecewise linear through 0.32 / 2.88 / 5.7 and 0.12 / 0.2 /
  0.3 V at TH 0 / 5 / 10), `lp991` / `hp991` (20 · 1000^(v / 10), 10 · 1000^(v / 10)). The 984's `bs` / `tb` show the plain 0…10 (the shelf law is V's).
- **Costs**: `TYPE.cost` = G2's target with all outputs read (901 0.0032 …); `COST.patch` (cv-cost.js) = **PROVISIONAL — lane V's measures replace them at
  the merge**: 901 0.0018 (one output), 901A 0.0012, 901B 0.0016, 901C 0.0005, 904C 0.008, 905 0.008, 912 `[0.0016, 0.0004]` (follow / comp, [C]), 984 0.005,
  991 0.001, CP3 `[0.0005, 0.0001, 0]` (as the CP3A). cv-cost.test unchanged and green (a key per type, sections = secs).
- **The set**: S3C = 901 · 901A × 3 · 901B × 9 · 903A · 994 · 912 · 904A · 904B · 904C · 905 · 914 · 911 × 3 · 911A · 902 × 3 · 984 · 992 · 993 · CP3 × 4 · CP8A (36).
  makeSet hangs the 901Bs 3 / 3 / 3 on the 901As (link max 3; pinned also over a Model 15: `loadSet` adds 31, 43 in all). Tile "System IIIc" (`SET_TILES`,
  `SET_ART.s3c`: a wide wood cabinet under a narrow tower — 16 + 15 faces, a 5-panel console strip, three cords; original drawing in the house helpers, no
  text). `SET_NOTES`: none (Drift choir is keyboard-played: no ▶ notice). **The view's note now names the IIIc** ("Model 15, System 35, System 55 and System
  IIIc bring a whole set …": cv-tray.js, cv-tray.test, canvas-sim.test) — **main.js:5318–5319's intro paragraph still says "System 35 and System 55"** (main.js is
  not K's: lead's call; canvas-9-sim.test:634 / :638 pin it).
- **Presets** (16): *Drift choir* (the starter) as §2: KBD PITCH → 901A `f1`; 901B 1 / 2 / 3 on it (8′), `vn` −0.0498 / 0 / +0.0494 = ∓2 Hz (vn = 4.5 · log2(1 + Δ / 261.63): tested to 0.01 Hz,
  the beats 2 and 4 Hz); 984 `l21 l31` = 10 (inputs 1–3 → bus 1); 904C BAND PASS `fc` 1.5 (724 Hz), `bw` 1.5; 902 ← 911 (`t1` 6, `t2` 7, `es` 9, `t3` 7: Vowel's shape) from S-TRIG 1; 905
  `mx` 4; `ov` 9. *Follower wah* (921A + 2 × 921B, the 902 opened by the 911 from S-TRIG 1; **the 912 reads the 902's upper output `o1`** while `o2` feeds the 904A; `co` → 904A
  `c1`, `st` → the second 911 → 995 `a1` 4 → `c2`; `rs` Long, `th` 5, 904A `fc` −4.5 `re` 5; 13 cords) and *Spring pluck* (921A + 2 × 921B → 904A (cutoff on a second 911) → 902 ← a 911 pluck
  (`es` 0) → 905 `mx` 7; 11 cords). Neither fits any set: their home is a Model 15 + a 912 / a 905 (tests carry those two ad-hoc sets; loadPreset adds the missing 912 / 905 to a rack).
  **Levels are first numbers**: no 9c circuit existed in this lane — set from a proxy render on the base evaluator (901A/B → 921A/B, 984 → CP3A at unity, 904C BP → 904B + 904A
  at the −3 dB corners, a held CV for the 912, the 905 dropped = the dry peak): Drift choir ≈ −7 dBFS (−19 … −5 over the corner uncertainty) at `ov` 9, Follower wah ≈ −11.5 at `ov` 10 (the
  real co ≈ 6 V opens the filter further: expect ≈ −9), Spring pluck dry ≈ −9 at `ov` 10. **The real headroom gates (moog-core.test's, moog-dsp.test's, engine-track's) retune them at
  the merge** — the lead / a fixer, failing test first.
- **Tests (K's)**: moog-core.test (every §1.0 id / default / range / jack order / section, the link, the bus rows, the group / ORDER / ROWS / CONSOLE / tiles / shorts / names, the
  sets incl. S3C's widths and "numbered in Tidy's order", the laws, the presets' shape and the three 9c ones, `PANELS` += `m900c.js` (the coordinator's note: the faces cross-check now sees X's
  file), LINE for the three presets); patch-core.test (the fuzz's drv invariant for a linked type — `link.to` / `max` —, presetNames, the presets on their sets, the IIIc's sets / Tidy / needs,
  the CP3's rows by ordinal + a delete + a 5th / 6th CP3, **a 9c record through ref-P: every module and cord kept, the nine 901Bs' drivers dropped, a hand re-link restores the record** (§11));
  cv-tray / cv-art / canvas-9-sim / cv-patch (the sixteen Patches…) / engine-track (:2211 `PRESETS.length` 16 and its title only). **Pins found in files the contract did not give K** (the new
  set tile / tile count, nothing weakened): canvas-9b-sim.test (the set-tile lists, the N3 cost row), main.test (:1264), canvas-sim.test (:663 the Moog view in the page).
- **Gates at the last commit** (one file at a time, 2048 MB): green — patch-core 49, golden-moog 6, golden-moog-b 6, cv-tray 40, cv-art 5, cv-cost 18, canvas-9-sim 22, canvas-9b-sim 14, canvas-sim 24,
  main 47, integration 44, cv-migrate 69, lint 163; moog-core 18 / 20 and cv-patch 28 / 29, the rest the windows below.
- **Expected failures until V / X merge** (this lane alone, each exactly the ten new types): moog-core.test ×2 — "moog-core = PatchMoog" (PatchMoog.T lacks the ten: V), "moog-core = the faces" ("a face for
  every type": X); cv-patch.test "faceJacks: every face" (`cvPanel.moduleLayout` null for the ten: X); cv-panel.test ×5 and cv-face.test ×1 (X's pins: the 35 faces, the sizes); moog-dsp.test ×2 ("PatchMoog: the
  frozen global … the 26 types", "K9's starting patches over the evaluator": V's pins, the 16 presets need the ten classes); patch-dsp.test "the Moog presets schedule with no loop step" (the three new presets:
  `why: type` until V's classes exist); engine-track.test (not run: its headroom loop and the warm-payload tests need V; **:2279–2280 `MG.ORDER_ALL.length + 1` → `+ 2` (the two linked types, each warmed twice) and
  :2290–2291's count / sha are V's**, D3 / G4); pwa.test (the lead's precache — `sw.js` untouched). The moog-core.test headroom test **skips** the 9c presets until PatchMoog holds their types (its `waits`), so
  after V's merge it is the first check of the levels above.
- **For the lead**: D2's hash pins of the 9c records at the freeze (`makeSet('s3c')`, the three presets: pk with / without vals, pvOf, rec, vals) — the K9c-a test's form is the template (`FROZEN_9B`); the
  precache; main.js's intro text; ROADMAP / HANDOVER. patch-core.js untouched (D1: the bus grammar held with matching `f3` ids; no need found).

### Lane V
**V (base 5c7e65a, wt-9c merged at 83c61b1 for K's tables and X's faces; `moog-dsp.js`, `tests/moog-dsp.test.mjs`, `tests/golden-moog-c.test.mjs`
(new), `tests/engine-track.test.mjs`, `tests/bench-scenarios.mjs` / `bench.json` / `bench.html`'s note, RM §10's 9c rows, moog-core.js's two
preset levels (the coordinator's grant); scratch `9c/v/`)** — commits 0820121 (circuits + tests), ba3aafe (golden-moog-c), a0876dc
(engine-track, m9c), these notes. Nothing frozen (D2 is the lead's: `GOLDEN_FREEZE_9C=1`, the path tried once and removed).

**Built** — `moog-dsp.js`, appended: the ten SPEC rows (= §1.0 / K's table: moog-core.test's cross-check green), ORDER, `LINK['901b'] =
{ from '901a', def [1, 0] }`, ten classes written out, their `ins` accessors, T, the 9c constants in K. **901**: the 921's phase / event
solver instantiated (no reset), the bench set (saw 1.73 · triangle 2.25 · sine 1.41 · pulse ±1.2 V), variable outputs = fixed × LEVEL / 10,
drift 2 · dv. **901A**: r = ex2(ΣV + FIXED + FINE / 6) a sample (constant a chunk when unpatched), the width offset. **901B**: f = max(0,
f_nom · (r + k − 1)) · 2^(2·dv), no ex2 a sample; the stall holds phase and outputs. **901C**: ± in · AMPLITUDE / 10, railed. **904C**: §1.2's
pair in the 904B's form. **905**: §1.3's tank, its wet path at the base rate. **912**: two peak detectors, the attack, its own log2, the
comparator. **984**: one fused per-sample loop (inputs' couplers, then each read bus). **991**, **CP3** (the CP3A's maths in its own class).

**Refinements [C]** (each with its reason):
1. **901 / 901B Lo = −8 oct about 8′ (1.02 Hz at 0 V)**, not "32′ − 4 oct" (= −6, the 921B's 4.09 Hz): §1.1's own numbers (1.02 Hz, 32 mHz …
   65 Hz over FIXED VOLTAGE) and RM's bench (35 mHz … 70 Hz) all say −8; only the label said −6. Measured 31.9 mHz / 1.022 Hz / 65.41 Hz.
2. **The sine's knee**: (t − 0.314 t³) / 0.686 on the corrected triangle — THD 1.93–1.99 % (§1.1's ≈ 2 %).
3. **904C BAND REJECT = the input less the band pass** (the lead's #9): RM's parallel sum measured on the analog prototype at f0: −20.0 /
   −7.7 / −4.1 / −3.2 / −4.1 / −10.7 dB at B 0 / 0.5 / 1 / 1.5 / 2 / 3 — no reject between ≈ 0.4 and 2.8; in − BP nulls f0 at every B
   (≤ −200 dB measured: the corners are placed symmetric in the bilinear's warped domain, gL = t0 · r, gH = t0 / r, so the band pass is real
   at f0 and the make-up (1 + gH / gL)⁴ exact), its shoulders +2.7 dB (B 0) … +1.3 dB (±1 / ±3 oct). §11's "RM's parallel a known limit" holds.
4. **G5's "−3 dB edges ± 0.1 oct (B ≥ 1)"** read as the coupled pair's: four HP and four LP poles never make a band narrower than 1.62 oct
   (the corners coincident, B 0), so the band's own −3 dB edges sit at ±0.81 / 1.03 / 1.32 / 1.68 oct for B 0 / 1 / 2 / 3, not ±B / 2. B
   stays §1.2's corner spacing ("+1 V widens by an octave, one corner up, the other down"); the test holds the module to the 4 + 4-pole
   prototype's edges within 0.1 oct (measured ≤ 0.003 oct) and the peak at f0 (0.00 %, 0.000 dB) for B 0 … 3, with c1 / c2 and b1.
5. **904C OFF** puts the pair to sleep (no work) and clears it when it wakes (a mode change from OFF); its eight states flushed each chunk
   in `ctl` (the 904B's lesson).
6. **905, the wet path a chunk at a time**: the decimator, the tank and the interpolator run at the chunk's last sample (index CH − 1: the
   same in a block step and a loop member's n = 1), over the chunk's four base samples; the wet for chunk c + 1 comes from chunk c, so that
   chunk (CH − R OS samples) joins the filters' delay off the lines' taps — echoes at 25.00 / 31.00 / 37.00 ms (1 kHz group delay less the
   chain's) at OS 2 / 4 / 8. Per-sample stepping first cost 15.8 ×10⁻³ (OS 4): the chunk form, the chain four samples a stage at once
   (one load and store a stage per chunk) and the half-bands written out brought it to 6.07 (OS 4) / 7.30 (OS 8). **The half-bands**: each
   stage kills only what its own fold brings into 0 … 0.4 fb (the later stages take the rest): 2fb → fb B (K 11, β 6: ≥ 62 dB from 0.6 fb),
   4fb → 2fb A4 (K 4, β 6.5: ≥ 68 dB on 1.6 … 2.4 fb), 8fb → 4fb A8 (K 3, β 6: ≥ 70 dB on 3.6 … 4.4 fb); measured aliases 80 … 105 dB under
   the wet. R = the largest power of two ≤ OS (the app's OS 1 / 2 / 4 / 8: OS itself). **The damping one-pole at 8 kHz**, the wet gain 0.45489
   (fitted: a 100 ms 1 kHz burst's wet energy = its dry, 0.00 dB at OS 2 / 4 / 8). A chunk-number gap clears the tank; `reset` clears it.
7. **912's attack** is a one-pole smoother after ideal peak detectors (charge at once, release toward 0 V), not an RC charge: at ¼ of the
   release an RC charge reads a 10 % pulse at ≈ 0.3 × its p-p (−0.9 V: G5's pulse gate); the smoother keeps "attack ¼". KC per response
   (1.17493 / 1.06184 / 1.01995) puts 250 Hz, 500 mV p-p at 4.500 V on each (the trimmers' calibration; the release's ripple otherwise reads
   SHORT 0.12 V low). The 50 Hz ripple on SHORT measures 0.18 V p-p (§1.4's "≈ 1 V" assumed the release alone). log2: the exponent tracked
   from the last sample, a degree-5 fit of log2(1 + m): ≤ 1.7e-5 oct, no Math.log a sample.
8. **984 shelves: a cut the boost's mirror** (the one-pole's corner × 1 / G low, × G high): ±11.84 dB at 20 Hz, ±11.77 at 20 kHz, symmetric in
   dB (the plain x + (G − 1)·LP form cut only −9.4 dB at 20 kHz); flat at 5 bit-exact (the shelves skipped). One fused per-sample
   loop (the four couplers, then each read bus) — the input-by-input / bus-by-bus first form cost 7.9 ×10⁻³ in a one-member loop (> 7).
9. **PatchMoog.T lists '901b' before '921b'** (the T literal's order, no class or row changed): engine.js's ptWarmOf loops on the table's
   last linked type, undriven (a self cord on its first 1/4" input, a back cord to module 1) — the 901B has no input jack, so last it took the
   warm graphs' loop steps away (engine-track's "a loop step, ramps", "a lone self cord", the sync-in-a-loop checks failed). Sound unaffected.
10. **moog-core.js PRESETS** (K's first levels, the coordinator's grant): *Follower wah* x1 10 / x2 5 (−11.5 → −10.1 dBFS at 48 k × 4 and
    44.1 k × 2), *Spring pluck* x1 10 / x2 5, 904A `re` 1 (−13.7 → −9.5 / −10.1); *Drift choir* as K left it (−5.4 / −4.5). Whole Track,
    pre-limiter: −8.6 / −10.5 / −6.9 dBFS (48 k × 4), −8.8 / −10.6 / −7.8 (44.1 k × 2).

**Gates** (one file at a time, 2048 MB; wt-9c + V):
- **G1**: golden-classic 8 · -fx 3 · -presets 8 · -random 1 · -graph 6 · canonical-stream 1 · golden-drums 5 · -606 11 · -909 9 · -sdsv 5 ·
  golden-moog 6 · golden-moog-b 6 — bit-identical at every moog-dsp.js commit; patch-core 49, moog-core 20 (its "moog-core = PatchMoog" and
  headroom green), patch-dsp 30, golden-moog-c 4 (determinism: not frozen), moog-dsp 68, cv-cost 18, bench 6, bench-page 2, lint 165.
- **G2** per type (V8 node 24 / the macOS jsc shell, ×10⁻³; the type minus its null twin through the evaluator, OS 4, 48 kHz, median of 9
  alternating 1 s pairs — `9c/v/alone.mjs`, `jsc-alone.js`):

  | type | V8 | JSC | gate |
  |---|---|---|---|
  | 901 one output (f1 patched) · no CV | 1.48 · 0.79 | 1.12 · 0.32 | ≤ 1.8 |
  | 901 all eight | 3.35 (the 921's six 3.66 in the same harness) | 2.48 (921: 2.49) | ≤ 3.2 (§3's 921 figure, another harness: 2.9) |
  | 901A (≈ the pair less the 901B) · 901A + 901B | ≈ 0.66 · 2.09 | ≈ 0.6 · 1.68 | ≤ 1.2 |
  | 901B driven (≈) · undriven | ≈ 1.43 · 0.81 | ≈ 1.04 · 0.59 | ≤ 1.6 |
  | **901A + 3 × 901B · 921A + 3 × 921B** | **4.96 · 5.64** | **3.77 · 4.48** | group ≤ (both) |
  | 901C | 0.43–0.49 | 0.34 | ≤ 0.5 |
  | 904C no CV (BP / BR) · c1 · c1 + b1 | 1.77 / 1.77 · 2.45 · 2.74 | 1.55 / 1.58 · 2.43 · 2.84 | ≤ 8 |
  | 905 OS 4 · OS 8 | 6.07 · 7.30 | 6.06 · 7.21 | ≤ 8 · ≤ 8 |
  | 912 follow · + compare (on its normal) | 1.02 · 0.80 | 0.71 · 0.64 | ≤ 2 |
  | 984 four in, four buses · tone on · in a one-member loop | 1.69 · 1.95 · 5.54 | 1.95 · 2.34 · 5.78 | ≤ 5 · ≤ 7 |
  | 991 | 0.55–0.60 | 0.58 | ≤ 1 |
  | CP3 mix 2 / 4 inputs (CP3A 4: 0.25 / 0.23) | 0.30 / 0.20 | 0.25 / 0.23 | ≤ 0.7 |

  The 901's all-eight reads 3.35 against §3's absolute 3.2: in one harness it is cheaper than the 921's six (3.66), §3's ratio holds; the
  absolute figure came from a harness that reads the 921 at 2.9 (the 8-way sum at MAIN OUT is part of this one's). In moog-dsp.test's
  costOf (a module alone, its floor included) every type is inside 3 × its gate (901 eight 2.66, 905 6.43, 984 3.82, the 1960s slice of 16
  modules 0.028 a second).
- **G2b** (the family's size: m9p / m9x / m9d / m9q / m9s with ref-9b's moog-dsp.js vs the new, every other script current, alternating fresh
  processes, 3 each): V8 0.0193 / 0.0372 / 0.0193 / 0.0229 / 0.0438 → 0.0193 / 0.0368 / 0.0192 / 0.0232 / 0.0436 (× 1.000 / 0.989 / 0.995 /
  1.013 / 0.995: within 2 %); JSC (`9c/v/jscrows.mjs`: an offline Track in the jsc shell, 0.25 s pre-roll, median of 5 × 1 s) 0.0156 / 0.0356 /
  0.0172 / 0.0195 / 0.0359 → 0.0155 / 0.0357 / 0.0171 / 0.0196 / 0.0358 (× 0.99 … 1.01); against bench.json "m9b" m9q +1.6 % over its range's
  top, m9d +3 %, the rest inside it — within 5 %.
- **G3** `m9c` (the IIIc as a classic voice: 37 modules, 32 nodes live): node gate **0.0465** calibrated (target 0.06; the estimate 0.045),
  JSC 0.0384–0.0389 (target 0.046), iPad ≈ 0.034 by JSC × 0.88 (target 0.044); its peak −18.7 dBFS.
- **G4**: (a) the warm payload list re-pinned (119 payloads, sha 87b16aac…: still two parts, 17 and 22 modules, a / b / c within 256);
  `ORDER_ALL.length + LINKED.length` (2); both linked types driven and undriven; warmPatchOn's part holds the driven 921B (asserted); see 9.
  **The warm-up time** (engine-track's harness, alternating fresh processes): the stubs first (the ten classes of the right shape): × 1.160 of
  ref-9 (cap 1.25), × 1.047 of ref-9b (cap 1.10) — under both, so built; with the real classes × 1.217–1.238 of ref-9 and × 1.093–1.109 of
  ref-9b (9 pairs: × 1.238 / × 1.103; the tests' own 5-pair runs passed, × 1.236 / × 1.093) — **both at their caps** (reported to the lead:
  the cap is the user's, §10's extra). The classes' own code is ≈ 5 % (all ten stubbed: × 0.952 of now; each 0.6–2 %, within noise).
  **Open, reported**: "9 warm-up (the scripts' own)" fails on one deopt (patch-dsp.js:680 loopRun, "wrong map", m9x's loop arriving) —
  the 9c table's integer-like ids move ptWarms' part boundary to after the 994 (acc 136 vs half of 273), so part 0 ends on a module with no
  1/4" output and has no loop step: loopRun's call site sees three maps (9b's saw seven — 902 / 914 / 921 / 962 in part 0's loop, 921A /
  992 / 921B in part 1's — and went megamorphic). The fix is engine.js's — not edited here (D1); the lead's decision. Tried in scratch only:
  ptWarmOf's loop module = the last with a 1/4" in and out (one line, the 9b table's payloads unchanged) gives part 0 a lone 992 self-loop
  (no chain path reaches it from module 1): four maps, still polymorphic — part 0 needs a real multi-member loop.
  (b) as above; (c) the IIIc tile on a new Track (engine-track's System 55 form, `9c/v/g4c.mjs`, three warmed scopes): its graph()
  0.30–0.31 ms (37 built), first quanta 0.13–0.14 ms / steady 0.056, ▶ 0.23–0.31 ms; 40 CP3 routing flips on m9c: graph() median 0.11–0.13,
  max 0.28–0.33 ms, the flip's quantum ≤ 0.18 ms — inside ¼ of the deadline (0.667 ms), ≤ 0.5 / ≤ 1 ms.
- **G5** (moog-dsp.test, 48 k × 4): the 901's bench set within 0.2 %, THD 1.93 %, the footages within 0.1 cent, Lo 31.9 mHz … 65.4 Hz,
  drift × 2.000; the link law within 0.02 Hz over keys −1 … 2 × verniers −3 / 0 / 3, the beat 2.0226 … 2.0231 Hz over 3 octaves, undriven
  k · f_nom, the stall (pp 0, the pulse at −1.2 V), r within 2.7e-5 cent, the width the driver's; the 912's table 2.494 / 3.006 / 3.511 /
  4.500 / 5.000 / 5.500 / 6.000 V, the pulse within 0.016 V of the sine, silence 0 V, the pairs within 10 mV; the 984 1.2497 at 10 / 10, AC
  −3.01 dB at 10 Hz, the shelves on the prototype within 0.3 dB, flat within 0.1 dB; the 905 at MIX 0 = −in bit for bit, echoes 24.997 /
  30.998 / 37.001 ms, RT60 2.500 s, dispersion 4.42 ms, wet / dry 0.00 dB, alias −86.6 dB, no NaN / subnormal over 60 s; the 904C as 3 and
  4, OFF ≡ in; the 991's corners within 2 %; the CP3 = the CP3A bit for bit.

**For the lead / the others**:
- **cv-cost.js** (K's provisional): from the V8 column — 901 0.0015 (one output; all eight 0.0033), 901A 0.0007, 901B 0.0014, 901C 0.0005,
  904C 0.0018 (0.0025 with CV), 905 0.0061 (0.0073 at OS 8), 912 `[0.0010, 0.0002]`, 984 0.0017 (0.0020 with the tone; + COST.loop in a loop),
  991 0.0006, CP3 `[0.0003, 0.0001, 0]`.
- **Listening renders** (`scratchpad/9c/v/wav/`, 48 kHz 24-bit stereo, the whole Track): 01 901 · 02 901A + three 901Bs (2 / 4 Hz beats) ·
  03 a 901B stalling · 04 901C (vibrato) · 05 904C band pass swept · 06 904C band reject on noise · 07 905 on a pluck · 08 905 wet only ·
  09 912 wah · 10 984 · 11 991 · 12 CP3 routing · 13 Drift choir (the IIIc tile) · 14 Follower wah · 15 Spring pluck.
- The freeze: `GOLDEN_FREEZE_9C=1 node --max-old-space-size=2048 --test tests/golden-moog-c.test.mjs`, then PIN; golden-moog-c's 30 cases
  render in ≈ 7 s.
### Lane X
**X (base 5c7e65a; `panels/m900c.js` (new), `panels/index.js`, `tests/cv-panel.test.mjs`, `tests/cv-face.test.mjs`; scratch `9c/x/`)** — commits
ed542bd (faces, merge, tests), these notes. No photograph fetched or viewed; no cv-panel / panel-check edit (the generic rules held).
- **`panels/m900c.js`**: `MODULES` = the ten faces by type (keyed `901 · 901a · 901b · 901c · 904c · 905 · 912 · 984 · 991 · cp3`, ids
  `pm-<type>`), **no default export** (moog-core.test reads every exported object), data only, m900b's builders copied (that file exports
  `MODULES` alone, cv-panel.test pins it), every face `lite`, every legend ours, "Ours (no photograph viewed)" in every note; merged after
  m900b's in `MODULE_LAYOUTS` (`panels/index.js`). Every param and jack by §1.0's ids; the rear `xr` of the CP3 never placed. Layouts [C]:
  **901** (3 MU) — FIXED VOLTAGE (−5…+6: 12 stops, an integer a stop) · FREQUENCY RANGE (LO + five footages, a 180° rotary as the 921B's) ·
  FINE (±1 oct) · PULSE WIDTH across the top; four columns below (sine · sawtooth · triangle · pulse): each a LEVEL knob over its fixed and
  its variable jack, the three CONTROL INPUTS last (no width jack). **901A** — the 921A's order: FIXED VOLTAGE, FINE, PULSE WIDTH, the
  inputs two over one; "DRIVES UP TO THREE 901B", no range. **901B** — RANGE, FREQUENCY (−6…+6), then four rows [fixed jack · LEVEL knob ·
  variable jack] (the jacks d 11 here: 14 mm nuts do not fit three across 1 MU; centre-to-hit-box 10.5 mm ≥ 9). **901C** (stand-in) INPUT,
  AMPLITUDE, OUTPUT + / −, "TWO OUTPUTS 180° APART". **904C** (2 MU) MODE (a vertical bat: BAND REJECT / OFF / BAND PASS), CENTER
  FREQUENCY (−6…+6) beside BANDWIDTH (0…3 oct.), CENTER FREQUENCY CONTROL ×2 and BANDWIDTH CONTROL under their knobs, SIGNAL INPUT → OUTPUT.
  **905** (2 MU, stand-in) one WET / DRY (DRY … WET), a drawn spring, INPUT → OUTPUT with "INVERTED" under the output [R MS-905]. **912**
  FOLLOWER (SIGNAL INPUT · CONTROL OUTPUT · RESPONSE SHORT / MEDIUM / LONG) over COMPARATOR (THRESHOLD, COMPARATOR INPUT "NORMALLED TO
  CONTROL OUTPUT", the TRIGGER OUTPUT a `strig` socket). **984** (4 MU) a 4 × 4 matrix: the input jack at each row's head (1…4), the bus
  columns 1…4 (`l<i><o>` = row i, column o), a MASTER knob and an OUTPUT jack under each column, BASS / TREBLE (flat at 5) at the right
  "ALL FOUR BUSES"; knob d 17 on 32 × 26 mm pitch, printed 0 … 10 ends, legends ≥ 1.4 mm. **991** (stand-in) LOW PASS (20 Hz … 20 kHz) ·
  HIGH PASS (10 Hz … 10 kHz) · ATTENUATOR, IN → OUT. **CP3** (4 MU console) the CP3A's three sections (MIXER 2 MU · ROUTING with the four lit
  push switches over EXT LEVEL / EXT IN · MULTIPLES a1…a4 + four dimmed TRUNKs), "TO AN OSCILLATOR CONTROL, BEHIND", the plate CP3.
- **Plates (D5)**: boxed "OURS — …" on the **901C, 904C ("THE LOW PASS AND HIGH PASS PAIR IS INSIDE THE MODULE"), 905 ("OUR OWN MODEL OF A
  SPRING TANK"), 991**; the 984, 901 / A / B, 912 and CP3 carry none (real modules, our layout). No maker word on any face, notes or tip:
  cv-panel's `MAKERS` (checked on every text since stage 9) plus **"Gibbs"** (the 905's tank maker, not in `MAKERS`), Bode, Pratt, Cinch —
  a test greps the art's `text` / `title` and the notes.
- **Sizes / counts / MB** (outer px, painted = live layer 1 + 3 a control + a span a jack + the bar 6, texture at dpr 2 base + mips): 901 352
  × 512 · 8 controls, 11 jacks · 42 · 3.54 MB; 901A 128 × 512 · 3, 3 · 19 · 1.29; 901B 128 × 512 · 6, 8 · 33 · 1.29; 901C 128 × 512 · 1, 3 · 13 ·
  1.29; 904C 224 × 512 · 3, 5 · 21 · 2.26; 905 224 × 512 · 1, 2 · 12 · 2.26; 912 128 × 512 · 2, 4 (1 socket) · 17 · 1.29; **984 448 × 512 · 22, 8 ·
  81 (≤ 130) · 4.51**; 991 128 × 512 · 3, 2 · 18 · 1.29; CP3 448 × 352 · 10, 11 (+ 4 dimmed trunks) · 48 · 2.98. All ≤ 90 but the 984.
  panel-check: all ten valid, no overlaps, least hit box 30 × 30 px (901B's levels, the 904C's / 912's bat switches, the CP3's push switches), least jack pitch 22 mm (901B), else
  ≥ 24, least jack-to-hit clearance 10.5 mm (901B; the rest ≥ 18). **The System IIIc's faces ≈ 69.8 MB** (36 modules + the controller: under the
  System 55's 72.6 and a fifth of `FACE_BUDGET_BYTES`).
- **Tests**: cv-panel.test — `B9` / `C9` literal (every module type has its face file: a type added to the table is told), the 36-face loop
  (sizes, params, ports, hits, `INERT.cp3`), `moduleModel` console list + cp3, three new tests: the ten at §1.0's widths / counts / plates / maker
  words; the 901's columns, the 901B's rows, the 984's matrix (row i, column o, master / output under the column, BASS over TREBLE, signal flows
  left → right, top → bottom); the G6 painted counts (the numbers above pinned). cv-face.test — `FACES_9` + ten, the 9c MB pins, the IIIc's
  36-module literal list (69.8 MB) and, once K exports `S3C`, `MG.S3C` ≡ that list as a multiset.
- **Gates** (one file at a time, with a scratch shim of §1.0's table in moog-core.js — never committed — standing in for K): cv-panel 111 / 111,
  cv-face 45 / 45, lint 165 / 165, `tools/panel-check.mjs` valid on all ten; a scratch run of moog-core.test:393–430's face check and
  cv-patch.test:132's `faceJacks` over the ten (ports = the table's non-rear jacks, params, `ev`, one span a jack, hits ≥ 28 px, inside the
  module) passed. **Without K's table** the new cv-panel tests and cv-face's sizes test fail by design (the known window; four + one tests).
  **Not run** (not mine / need K or V): moog-core.test (K adds `m900c.js` to its `PANELS` list at :385 — without it the faces check does not see the
  ten), cv-patch.test's rack DOM test, cv-tray / canvas-9-sim (glyphs, tiles), pwa.test (the lead's precache).
- **Discrepancies for the lead / K** (built to §1.0 and the CP3A's tables, the contract's prose differs): §1.0 says the CP3 has "the CP3A's 14"
  params — the CP3A has **10** (x1…x4, ms, r1…r4, ra) and 12 jacks (m1…m4, mo, mn, x4, rear xr, a1…a4); §1.7 says "3 multiples" while §1.0's
  jacks are the CP3A's **four** (a1…a4): the face places all four — if K trims the CP3 to three, drop a4 and its link line on the face. The
  912's `ci` / `st` sit in the table's section 1: the face's FOLLOWER / COMPARATOR sections are the Tab-order groups only. Screenshots:
  `scratchpad/9c/x/shots/` (faces-*.png at 1×, face-901 / face-984 / face-cp3 and the pairs at 2×, panel-check's `check/*.svg` and
  `check-*.txt`); harness `9c/x/faces.html` + `serve.mjs` + `shot.sh` (port 8931, stopped).
### Reviews and fixes
**Fix E — the warm-up's loop step (lane V's open finding; engine.js `ptWarmOf` only, tests/engine-track.test.mjs; on wt-9c 8bd4fee)**. 9b's
loop was a back cord from the part's last module to module 1 plus a self cord on the last module: a loop only where the chain (each
module fed by the one before it) ran unbroken from module 1 to the last — the table's order decided it. The 9c ids moved the part
boundary: part 0 ended on the 994 (no 1/4" output), so it had no loop step, and loopRun's per-sample call (patch-dsp.js `ms[k].run`)
met three classes in the warm-up (9b's seven — megamorphic past V8's four maps); m9x's loop (904A, the controller's mixer, 902, 921B)
then deopted it on a new Track ("wrong map", every traced run at the base). **The design**: per part, the **loop-capable modules** — a
section with a 1/4" input and a 1/4" output, read from the table's jacks (its loop output the first such output, its loop inputs that
section's 1/4" inputs) — joined in a **ring** in the part's order (each one's loop output into the next one's last loop input, the last
one's into the first's, × 0.53); K = the last with two loop inputs or more (else the last): its self cord, × 0.47, the only source of
its first (9b's lone late read), the ring entering on its last; c retires K. The chain, graph a, the S sum, c's normals and module 1's
empty input are 9b's. So every part's graph b holds **one loop step with all its loop-capable modules**, whatever `Object.keys` order
and however many parts a later table splits into. Now: part 0 (17 modules) one 16-node loop (the 13 loop-capable modules, the 912 / 923
/ 961 with two sections each), c keeping a 3-member one (901 → 991 → 992); part 1 (22) one 14-node loop (its 13, both 921Bs among them, + the 921A by the link);
loopRun's call site meets **26 classes** (every loop-capable type of the table + the 921A). Tried and dropped: the ring capped at the
last five before K (5 + 4 classes: deopt-free too, × 1.257 / × 1.116 — no cheaper than the full ring within noise, and a cap ties the
count to the part split). **Payloads**: still 119 (the same calls; a unchanged, b / c carry the ring: b 247 / 203, c 230 / 178
connections ≤ 256), sha256 re-pinned **5e1aad39…** (was 87b16aac…). **Tests**: the deopt test (red at the base: patch-dsp.js:680:19
"wrong map", m9x arriving × 4.0–4.6 of steady under the trace) green — 0 deopts in patch-dsp / moog-dsp, first quanta × 2.52 / 1.16 /
1.49 (gates 4 / 1.8 / 2.5); **new** "9c warm-up loops (fix E)" (red at the base: part 0 no loop step): each part's graph b holds one
loop step with every loop-capable module of the part (≥ 2, from moog-core's jacks, not engine.js's), and loopRun — wrapped in the
test's scope — meets every loop-capable class, ≥ 9b's seven. **Caps** (§13, the user's): the 9b test ≤ 1.35 × ref-9, the 9c test ≤
1.22 × ref-9b. **Measured** (engine-track's harness, alternating fresh processes, 11 pairs, V8): **× 1.260 of ref-9, × 1.119 of
ref-9b** (the base in the same session × 1.271 / × 1.113: the ring costs nothing measurable; this session's Mac read lane V's base ≈ 3 %
higher); the test's own 5-pair runs × 1.269 / × 1.131 and × 1.258 / × 1.118. **Gates** (one file at a time): engine-track 106 / 106
twice; golden-classic / -fx / -presets / -random / -graph, canonical-stream, golden-drums / -606 / -909 / -sdsv, golden-moog / -moog-b /
-moog-c, patch-core, moog-dsp, integration, lint — all green. **Left as found**: a sporadic "wrong map" at patch-dsp.js:788 (`same()`,
a.length: the entry arrays' packed / holey kinds as graph() tiers) in ≈ 1 of 7 traced runs here — the base 1 of 10, ref-9b 1 of 10
(its :777, beside :547) — 9b's own, absorbed by the test's cleanest of three traces.

**Fix V — review 1 F1 / F2 / F5 (moog-dsp.js: `M905`, its constants and the T literal's comment; tests/moog-dsp.test.mjs,
tests/engine-track.test.mjs; on 88451f6: 39c0326 + 433b579 F1, 9a1bf60 F5, 478fd77 F2; scratch `9c/fxV/`)**. **F1, the design**: the
tank at a nominal **44.1 / 48 kHz whatever the context** — R = the largest power of two ≤ OS, doubled while fs / 2R ≥ 44.1 kHz and
CH / 2R is whole: OS · 2^⌊log2(base / 44.1 k)⌋ at the app's rates (88.2 / 96 kHz × 2, 176.4 / 192 kHz × 4); the cascade gains up to
two half-bands (16fb → 8fb, 32fb → 16fb, A8's filter again: only past osCap's 384 kHz); the lines 2048 doubles (56 kB a 905) at every
rate (were 4096 / 8192 at 88.2 … 192 kHz). Below four tank samples a chunk the wet path works on a **group of G = 2 / 4 chunks** (four
tank samples): the chunks' railed input gathered in the first half-band's buffer, at the group's last sample one call a stage down,
the tank over four (the chain four samples a stage at once), one interpolation into wb (4R) read by the next G chunks; the wait,
G − 1 chunks, comes off the taps. (Tried first: a sample at a time the chain is serial — host 96 k × 4 0.0200 vs 0.0135 s/s grouped;
the filters a call a chunk, G2 8.8 / 11.5 ×10⁻³ at 96 k × 4 / 192 k × 2, a call a group 7.5–7.8 / 8.3–8.5.) **The 44.1 kHz family's
chain is its own**: 71 stages × a 0.5014 — fitted to the 48 kHz chain's group delay (relative to 4 kHz) over 1 … 16 kHz, 2.5 µs rms;
120 × 0.6 at 44.1 kHz was 1.58 × the 48 kHz drip (4 → 16 kHz 2.27 vs 1.44 ms) — and its 1 kHz delay's difference (0.537 vs 0.628 ms:
4 samples) off the taps, so the echoes land on 48 kHz's. A rate of neither family takes the nearer family's chain (its dispersion
that rate's, as before). K gains SP_N44 / SP_A44; K.HB lists five stages. **48 kHz × 1 / 2 / 4 / 8 bit-identical to the base**
(block, n = 1, a chunk gap: `fxV/bits2.mjs`); 44.1 kHz's wet changes — **golden-moog-c**: with the base's three files as a temporary
ref (removed after) 29 of 30 cases bit-identical, **"Drift choir at 44.1 kHz × 1" changed** (max |A − B| 0.110, −19.2 dB, at 1.05 s);
not frozen yet, so its determinism run stays green and the freeze takes the new sound. **Test first** (moog-dsp, red at the base on
44.1 k's dispersion and on 88.2 … 192 k's echoes / dispersion / lines): the 905 at 44.1 / 48 / 88.2 / 96 / 176.4 / 192 kHz × OS 1 / 2 /
4 / 8 as at 48 k × 4 — measured: the first echoes' 1 kHz group delays 25.638 … 25.667 / 31.632 … 31.654 / 37.641 … 37.662 ms (48 k × 4:
25.644 / 31.645 / 37.648; gate ± 0.1), RT60 2.499 – 2.500 s, wet / dry 0.00 (48 k family) / +0.03 dB (44.1 k), dispersion 4 → 16 kHz
1.450 – 1.484 ms (48 k family) / 1.430 (44.1 k family) — at the base 2.26 / 0.11 / 0.08 / 0.001 / −0.002 at 44.1 / 88.2 / 96 / 176.4 /
192 k (gate ≥ 1 ms and ± 25 % of 48 k's) —, the lines no longer than 48 k's, aliases from every fold ≤ −71.0 dB (gate −60), block = per
sample at the grouped rates. Review 1's `p905.mjs` on the fix: 4 → 16 kHz 1.429 ms on all eight of its rows, 4 → 20 kHz 3.76 (48 k
family) / 3.46 (the 44.1 k tank: 20 kHz past its 0.45). **Cost** (G2's method: the 905 minus its null twin through the evaluator,
median of 9 alternating 1 s pairs, two runs, base → fix, ×10⁻³): **48 k × 4 5.72–5.78 → 5.76–5.79, × 8 7.08–7.22 → 7.09–7.51 (≤ 8; the
code path unchanged)**; 44.1 k × 4 5.3 → 4.2, × 8 6.6 → 5.6; 88.2 k × 4 10.4–10.8 → 6.1–6.2; 96 k × 4 11.3–11.5 → 7.5–7.8; 176.4 k × 2
17.1 → 6.6; 192 k × 2 18.8–19.2 → 8.3–8.5 (a 192 kHz context's four × the chunks of 48 k × 8). **Stale contract text (the lead's)**:
§1.3 "R = the largest power of two ≤ OS" / "at the base rate", §11 "runs at the base rate inside the module", RM §10's 905 row → at
44.1 / 48 kHz inside the module (R = OS · 2^⌊log2(base / 44.1 k)⌋), the 44.1 kHz family's chain 71 × 0.5014. **F2**: engine-track's
System 55 test gains its sibling "9c warm-up at System IIIc scale (G4 c)" (green first: it guards): makeSet('s3c') on a new Track,
graph() ≤ 1 ms, first quanta and a key's ≤ ¼ of the deadline, then m9c with 40 flips of CP3 1's KEYBOARD (a bus row in and out, the
payload re-posted): graph() median ≤ 0.5 / max ≤ 1 ms, the flip's quantum ≤ ¼ — measured graph() 0.361 / 0.396 ms (36 modules),
first quanta 0.146 / 0.142, a key 0.072 / 0.073, flips median 0.119 / 0.139, max 0.541 / 0.387, the flip's quantum ≤ 0.205 / 0.310 ms.
JSC not re-run here (review 1: warm-up × 1.206 of ref-9, × 1.085 of ref-9b; G4 (c) on JSC still unrecorded). **F5**: the T literal's
comment — the '901b'-before-'921b' order no longer keeps the warm loops (fix E's ring is order-free); it fixes the warm payload
list, whose sha256 engine-track pins; order kept. **Gates** (one file at a time, 2048 MB): moog-dsp 69 / 69, engine-track
107 / 107 twice (warm-up × 1.268 / × 1.133 and × 1.249 / × 1.123 — caps 1.35 / 1.22), golden-moog-c 4, golden-classic 8 · -fx 3 ·
-presets 8 · -random 1 · -graph 6 · canonical-stream 1 · golden-drums 5 · -606 11 · -909 9 · -sdsv 5 · golden-moog 6 · golden-moog-b 6
(bit-identical), patch-core 49, moog-core 20, bench 6, lint 165; pwa waits for the lead's precache (sw.js untouched).

**Fix U — review 2 F1 / F2 / N1 / N2 and review 1 F3 / F4 (cv-tray.js, cv-patch.js, patch-core.js tip text, moog-core.js's 904C readout, main.js one line; tests/cv-tray, cv-patch, patch-core, moog-core, new canvas-9c-sim; on 1ebff70; scratch `9c/fxU/`)**. Each test seen red first.
**R2-F1** (the tray glyphs): 901, 901B, 901C, 904C, 912 and 984 redrawn from panels/m900c.js (`fxU/mkglyph.mjs`: marks scaled into the panel's own outline, the house sizes; the other four stay): 901 four knobs over four levels over two rows of four outputs and the three control inputs at the foot; 901B range, frequency, then four rows [fixed jack · level · variable jack]; 901C the input jack above the knob; 904C mode, centre and bandwidth side by side, the three control jacks in a row, then in / out; 912 signal in / control out on top, then response, threshold, comparator input / trigger socket; 984 the inputs down the left of the 4 × 4 matrix, bass and treble at the right, masters, outputs. **Test** (cv-tray): per 9c type the glyph's k / j marks in reading order (rows within 2 % of the *outline's* height, so the console-height CP3 reads too) = the face's controls and jacks — red for those six, green for all ten (the older nine's counts / outlines test unchanged).
**R2-F2** (a tap-add out of view): `cv-patch` `add` (tap, not a drop) and `duplicate` call a new dep `show(key)` after the step; main.js passes `modShow` — the modulators' U9 helper: off the band → `focusItem(key, { k: W.k, edit: false })` (the camera brings it in at the zoom it has, no edit state; the module is selected, the world's own highlight — no new highlight style). A module that lands in view and every drag-add: no camera move. **Test**: cv-patch (`show` after a tap / duplicate, not a drop or a refusal) and canvas-9c-sim (the IIIc tile at k 0.5: the 984 lands at y −1888 from the controller, outside the band; red: focusItem never called; green: once, `{k: 0.5, edit: false}`; a 901B that lands in view, and a drop out of view: none). Checked in the app (headless pane, 1440 × 900): the 984 tapped on the IIIc is selected and centred.
**R2-N1** (an undriven 901B / 921B): after an add or a duplicate, a linked module with no driver says "Every 901A already drives three — this 901B runs on its own; add a 901A to drive it" (the patch holding none: "No 901A in this patch — …"; the same for the 921B / 921A), 6 s, no undo tap; the routing notice wins when both apply (they cannot today). Its bar's sub reads "not driven" (any undriven linked module, a Driver ▸ None too; "on 901A n" as before). **Tests**: cv-patch (Model 15 and a 901B with no 901A) and canvas-9c-sim (the IIIc); two older pins moved with it — cv-patch's "the 921Bs undriven" sub `''` → "not driven", and the System 55's seventh 921B (two 921As full at 3 / 3) now carries its notice.
**R2-N2** (the CP3's tip): a row listing several types that finds none says "No 4th of 901A / 901 / 921A / 921 in this patch" (ordinal English: 1st … 4th, 11th … 13th, 21st …); one type keeps its title form ("No 911 3 in this patch"). **The CP3A's tip read the same broken way** ("No 921A / 921 3 in this patch": a module's title) and is fixed with it — "No 3rd of 921A / 921 in this patch"; patch-core.test's two literals moved. Text only: busInfo's `why`, no payload, record or ref-P difference (patch-core 51 / 51 with ref-9-core, ref-P, FROZEN_9B).
**R1-F3**: "Already routed by …" names the panel that holds the route (`typeOf(fam, M[by].t).short`): the CP3's row "Already routed by CP3A 1", the CP3A's "… by CP3 1". **Test** (patch-core): a 921A + CP3A + CP3 both KEYBOARD on, and the other order.
**R1-F4**: the 904C's BANDWIDTH readout shows the band's −3 dB width, a 7-point map (`BW_OCT`, linear between the half steps, held beyond the ends) measured through the evaluator (`fxU/bw904c.mjs`, band pass, 48 kHz × 4, centre 512 Hz): B 0 / ½ / 1 / 1½ / 2 / 2½ / 3 → 1.628 / 1.821 / 2.056 / 2.327 / 2.638 / 2.988 / 3.361 octaves — "1.63 / 2.06 / 2.64 / 3.36 oct" at the printed 0 / 1 / 2 / 3. Display only (the knob's value, range, default and moog-dsp's law unchanged; the face's dial still prints 0 … 3 under "OCTAVES", panels/m900c.js not mine). **Test** (moog-core): the four ends, the half steps, monotonic over 0 … 3, held and NaN-safe; the older "1.00 oct" pin moved. No DSP-side guard ties the table to the 904C's law (it would need the evaluator in moog-core.test): re-run `fxU/bw904c.mjs` if moog-dsp's 904C changes.
### Acceptance
- Holding branch `wt-9c` (K 5f43fba, X 76d372a, V 6bdbf77; fixers E aaa54b3, V e84b9b1, U 2e2324c; the lead's intro text, cv-cost
  measures, the 905's doc lines, canvas-P-sim's set count), from 5c7e65a. Reviews: **1 (real engine)** 1 major (the 905's drip tracked
  the context rate → fix V) · 1 minor · 3 nits — D1 held everywhere (128 render pairs base vs 9c bit-identical; 300 random old racks'
  records / payloads / Tidy byte-identical; an old build opening a 9c record per §11); **2 (headless Chrome)** 2 minor (six glyphs, a
  tapped module out of view → fix U) · 3 nits; the IIIc no worse than the System 55 at 1× / 4× / 6× on every preset (face MB 69.8 / 39.2 /
  17.4), every control and jack by touch, no console error. Sweep: 123 files / 3 631 tests, one at a time, peak 2.24 GB. **Frozen**:
  `tests/ref-9c` (`GOLDEN_FREEZE_9C=1` at e7babd5, `PIN` set) and the 9c records (`FROZEN_9C` in patch-core.test). Squashed onto
  `canvas` as "9c" and deployed 2026-10-23.

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
**The user's answer to §10's extra (2026-10-23)**: "Allow the longer start" — every type stays pre-warmed; G4's caps become **≤ 1.35 ×
ref-9's** (the existing gate, raised by the user's decision, not loosened by a lane) and **≤ 1.22 × ref-9b's** (the same bound: 1.35 /
1.109), measured as before; lane V read × 1.217–1.238 / × 1.093–1.109.
**Left for the lead** (collected): #1 (12 instead of 3 needs a set-aware starter), #2 (the 905's base-rate wet path vs I9's 907A
decision — veto means ≈ 0.02 or no smear), #3 (the warm-up cap, the user's if crossed — §10's extra), #9 (confirm V's Band Reject form);
also the set's name "System IIIc" is a maker's product name like "System 35 / 55" (ROADMAP 15's note — the 9b precedent stands).
