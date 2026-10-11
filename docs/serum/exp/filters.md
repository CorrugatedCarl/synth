| # | id | name | category | Var label | family | recipe hint |
|---|---|---|---|---|---|---|
| 0 | `mg_low6` | MG Low 6 | Normal | FAT | ladder | 1 ladder stage(s) tapped (6 dB/oct); tanh per stage; FAT = tanh drive in the resonance feedback |
| 1 | `mg_low12` | MG Low 12 | Normal | FAT | ladder | 2 ladder stage(s) tapped (12 dB/oct); tanh per stage; FAT = tanh drive in the resonance feedback |
| 2 | `mg_low18` | MG Low 18 | Normal | FAT | ladder | 3 ladder stage(s) tapped (18 dB/oct); tanh per stage; FAT = tanh drive in the resonance feedback |
| 3 | `mg_low24` | MG Low 24 | Normal | FAT | ladder | 4 ladder stage(s) tapped (24 dB/oct); tanh per stage; FAT = tanh drive in the resonance feedback |
| 4 | `low6` | Low 6 | Normal | FAT | svf | TPT one-pole LP (res ignored) |
| 5 | `low12` | Low 12 | Normal | FAT | svf | TPT SVF LP |
| 6 | `low18` | Low 18 | Normal | FAT | svf | SVF LP → one-pole LP |
| 7 | `low24` | Low 24 | Normal | FAT | svf | SVF LP → SVF LP |
| 8 | `high6` | High 6 | Normal | FAT | svf | TPT one-pole HP (res ignored) |
| 9 | `high12` | High 12 | Normal | FAT | svf | TPT SVF HP |
| 10 | `high18` | High 18 | Normal | FAT | svf | SVF HP → one-pole HP |
| 11 | `high24` | High 24 | Normal | FAT | svf | SVF HP → SVF HP |
| 12 | `band12` | Band 12 | Normal | FAT | svf | SVF BP (unity peak) |
| 13 | `band24` | Band 24 | Normal | FAT | svf | SVF BP → SVF BP |
| 14 | `peak12` | Peak 12 | Normal | FAT | svf | SVF peak = x + 2k·bp·res-gain (boost at fc) |
| 15 | `peak24` | Peak 24 | Normal | FAT | svf | peak → peak |
| 16 | `notch12` | Notch 12 | Normal | FAT | svf | SVF notch = lp + hp |
| 17 | `notch24` | Notch 24 | Normal | FAT | svf | notch → notch |
| 18 | `lh6` | LH 6 | Multi | FREQ | dual | one-pole LP @cutoff → one-pole HP @f2 |
| 19 | `lh12` | LH 12 | Multi | FREQ | dual | SVF LP @cutoff → SVF HP @f2 |
| 20 | `lb12` | LB 12 | Multi | FREQ | dual | SVF L @cutoff → SVF B @f2 (series, shared res) |
| 21 | `lp12` | LP 12 | Multi | FREQ | dual | SVF L @cutoff → SVF P @f2 (series, shared res) |
| 22 | `ln12` | LN 12 | Multi | FREQ | dual | SVF L @cutoff → SVF N @f2 (series, shared res) |
| 23 | `hb12` | HB 12 | Multi | FREQ | dual | SVF H @cutoff → SVF B @f2 (series, shared res) |
| 24 | `hp12` | HP 12 | Multi | FREQ | dual | SVF H @cutoff → SVF P @f2 (series, shared res) |
| 25 | `hn12` | HN 12 | Multi | FREQ | dual | SVF H @cutoff → SVF N @f2 (series, shared res) |
| 26 | `bp12` | BP 12 | Multi | FREQ | dual | SVF B @cutoff → SVF P @f2 (series, shared res) |
| 27 | `bn12` | BN 12 | Multi | FREQ | dual | SVF B @cutoff → SVF N @f2 (series, shared res) |
| 28 | `pp12` | PP 12 | Multi | FREQ | dual | SVF P @cutoff → SVF P @f2 (series, shared res) |
| 29 | `pn12` | PN 12 | Multi | FREQ | dual | SVF P @cutoff → SVF N @f2 (series, shared res) |
| 30 | `nn12` | NN 12 | Multi | FREQ | dual | SVF N @cutoff → SVF N @f2 (series, shared res) |
| 31 | `lbh12` | L/B/H 12 | Multi | MORPH | morph | SVF output blend L→B (var 0..0.5) → H (0.5..1) |
| 32 | `lbh24` | L/B/H 24 | Multi | MORPH | morph | SVF×2 output blend L→B (var 0..0.5) → H (0.5..1) |
| 33 | `lph12` | L/P/H 12 | Multi | MORPH | morph | SVF output blend L→P (var 0..0.5) → H (0.5..1) |
| 34 | `lph24` | L/P/H 24 | Multi | MORPH | morph | SVF×2 output blend L→P (var 0..0.5) → H (0.5..1) |
| 35 | `lnh12` | L/N/H 12 | Multi | MORPH | morph | SVF output blend L→N (var 0..0.5) → H (0.5..1) |
| 36 | `lnh24` | L/N/H 24 | Multi | MORPH | morph | SVF×2 output blend L→N (var 0..0.5) → H (0.5..1) |
| 37 | `bpn12` | B/P/N 12 | Multi | MORPH | morph | SVF output blend B→P (var 0..0.5) → N (0.5..1) |
| 38 | `bpn24` | B/P/N 24 | Multi | MORPH | morph | SVF×2 output blend B→P (var 0..0.5) → N (0.5..1) |
| 39 | `cmb_p` | Cmb + | Flanges | FAT | comb | feedback comb, delay = 1/cutoff, positive feedback = res |
| 40 | `cmb_n` | Cmb - | Flanges | FAT | comb | feedback comb, delay = 1/cutoff, negative feedback = res |
| 41 | `cmb_l6p` | Cmb L6+ | Flanges | LP FREQ | comb | as Cmb +; one-pole LP @f_var in loop |
| 42 | `cmb_l6n` | Cmb L6- | Flanges | LP FREQ | comb | as Cmb -; one-pole LP @f_var in loop |
| 43 | `cmb_h6p` | Cmb H6+ | Flanges | HP FREQ | comb | as Cmb +; one-pole HP @f_var in loop |
| 44 | `cmb_h6n` | Cmb H6- | Flanges | HP FREQ | comb | as Cmb -; one-pole HP @f_var in loop |
| 45 | `cmb_hl6p` | Cmb HL6+ | Flanges | HL WID | comb | as Cmb +; HP @cutoff·2^-w and LP @cutoff·2^w in loop |
| 46 | `cmb_hl6n` | Cmb HL6- | Flanges | HL WID | comb | as Cmb -; HP @cutoff·2^-w and LP @cutoff·2^w in loop |
| 47 | `flg_p` | Flg + | Flanges | FAT | flange | flanger (x + comb)/2, delay = 1/cutoff, positive feedback = res |
| 48 | `flg_n` | Flg - | Flanges | FAT | flange | flanger (x + comb)/2, delay = 1/cutoff, negative feedback = res |
| 49 | `flg_l6p` | Flg L6+ | Flanges | LP FREQ | flange | as Flg +; one-pole LP @f_var in loop |
| 50 | `flg_l6n` | Flg L6- | Flanges | LP FREQ | flange | as Flg -; one-pole LP @f_var in loop |
| 51 | `flg_h6p` | Flg H6+ | Flanges | HP FREQ | flange | as Flg +; one-pole HP @f_var in loop |
| 52 | `flg_h6n` | Flg H6- | Flanges | HP FREQ | flange | as Flg -; one-pole HP @f_var in loop |
| 53 | `flg_hl6p` | Flg HL6+ | Flanges | HL WID | flange | as Flg +; HP @cutoff·2^-w and LP @cutoff·2^w in loop |
| 54 | `flg_hl6n` | Flg HL6- | Flanges | HL WID | flange | as Flg -; HP @cutoff·2^-w and LP @cutoff·2^w in loop |
| 55 | `phs12p` | Phs 12+ | Flanges | FAT | phaser | 4 first-order allpasses @cutoff, +feedback = res, out = (x+ap)/2 |
| 56 | `phs12n` | Phs 12- | Flanges | FAT | phaser | 4 first-order allpasses @cutoff, −feedback = res, out = (x+ap)/2 |
| 57 | `phs24p` | Phs 24+ | Flanges | FAT | phaser | 8 first-order allpasses @cutoff, +feedback = res, out = (x+ap)/2 |
| 58 | `phs24n` | Phs 24- | Flanges | FAT | phaser | 8 first-order allpasses @cutoff, −feedback = res, out = (x+ap)/2 |
| 59 | `phs36p` | Phs 36+ | Flanges | FAT | phaser | 12 first-order allpasses @cutoff, +feedback = res, out = (x+ap)/2 |
| 60 | `phs36n` | Phs 36- | Flanges | FAT | phaser | 12 first-order allpasses @cutoff, −feedback = res, out = (x+ap)/2 |
| 61 | `phs48p` | Phs 48+ | Flanges | FAT | phaser | 16 first-order allpasses @cutoff, +feedback = res, out = (x+ap)/2 |
| 62 | `phs48n` | Phs 48- | Flanges | FAT | phaser | 16 first-order allpasses @cutoff, −feedback = res, out = (x+ap)/2 |
| 63 | `phs48l6p` | Phs 48L6+ | Flanges | LP FREQ | phaser | 16 allpasses; LP @f_var in loop |
| 64 | `phs48l6n` | Phs 48L6- | Flanges | LP FREQ | phaser | 16 allpasses; LP @f_var in loop |
| 65 | `phs48h6p` | Phs 48H6+ | Flanges | HP FREQ | phaser | 16 allpasses; HP @f_var in loop |
| 66 | `phs48h6n` | Phs 48H6- | Flanges | HP FREQ | phaser | 16 allpasses; HP @f_var in loop |
| 67 | `phs48hl6p` | Phs 48HL6+ | Flanges | HL WID | phaser | 16 allpasses; HP/LP pair around cutoff in loop |
| 68 | `phs48hl6n` | Phs 48HL6- | Flanges | HL WID | phaser | 16 allpasses; HP/LP pair around cutoff in loop |
| 69 | `fphs12hl6p` | FPhs 12HL6+ | Flanges | HL WID | fphs | comb (1/cutoff) whose loop holds 4 allpasses + HL6 pair |
| 70 | `fphs12hl6n` | FPhs 12HL6- | Flanges | HL WID | fphs | comb (1/cutoff) whose loop holds 4 allpasses + HL6 pair |
| 71 | `loweq6` | Low EQ 6 | Misc | DB | eq | 1st-order low shelf @cutoff, gain from var (0 → −96 dB = HP) |
| 72 | `loweq12` | Low EQ 12 | Misc | DB | eq | RBJ low shelf, Q = 0.5+4·res |
| 73 | `bandeq12` | Band EQ 12 | Misc | DB | eq | RBJ peaking, Q = 0.5+9.5·res |
| 74 | `higheq6` | High EQ 6 | Misc | DB | eq | 1st-order high shelf (0 → LP) |
| 75 | `higheq12` | High EQ 12 | Misc | DB | eq | RBJ high shelf, Q = 0.5+4·res |
| 76 | `ringmod` | Ring Mod | Misc | — | ring | x·sin(2π·cutoff·t); custom display |
| 77 | `ringmod2` | Ring Modx2 | Misc | SPREAD | ring | ½x·(sin(2πf(1+s)t)+sin(2πf(1−s)t)), s = 0.5·var; custom display |
| 78 | `samphold` | SampHold | Misc | — | snh | hold input at rate = cutoff; custom display |
| 79 | `samphold_n` | SampHold- | Misc | — | snh | x − held; custom display |
| 80 | `combs` | Combs | Misc | DAMP | bank | 6 parallel feedback combs at cutoff·[1,1.5,2,2.5,3,4] (R ×1.007), fb = 0.97·res, LP damping in loop; voice-filter MIX forced to 1 (inv A11.1) |
| 81 | `allpasses` | Allpasses | Misc | DAMP | bank | 6 series Schroeder allpasses, delays (fs/cutoff)·[1,.77,.59,.45,.34,.26], g = 0.5+0.45·res |
| 82 | `reverb` | Reverb | Misc | DAMP | bank | 4-line Hadamard FDN, lengths (fs/cutoff)·[1,1.33,1.57,1.91], fb = 0.5+0.49·res |
| 83 | `french_lp` | French LP | Misc | BOEUF | french | saturating 4-pole ladder ×2 drive + BP @2·cutoff fed back (amount var) |
| 84 | `german_lp` | German LP | Misc | — | german | linear ZDF 4-pole ladder, res to self-oscillation |
| 85 | `add_bass` | Add Bass | Misc | THRU | addbass | tanh(1.5·SVF-LP) + var·(1st-order allpass of x @cutoff) |
| 86 | `formant1` | Formant-I | Misc | FORMNT | formant | 3 parallel BP (table I), cutoff picks vowel, var shifts ×2^(2·var) |
| 87 | `formant2` | Formant-II | Misc | FORMNT | formant | table II |
| 88 | `formant3` | Formant-III | Misc | FORMNT | formant | table III |
| 89 | `bandreject` | Bandreject | Misc | WIDTH | breject | x − BP(x), bandwidth 0.1..4 oct from var, res narrows |
| 90 | `distcomb1_lp` | Dist.Comb 1 LP | Misc | COMBFRQ | distcomb | SVF LP; comb (f = cutoff·2^(4(var−.5))) + tanh in feedback, +fb |
| 91 | `distcomb1_bp` | Dist.Comb 1 BP | Misc | COMBFRQ | distcomb | SVF BP; +fb |
| 92 | `distcomb2_lp` | Dist.Comb 2 LP | Misc | COMBFRQ | distcomb | SVF LP; −fb |
| 93 | `distcomb2_bp` | Dist.Comb 2 BP | Misc | COMBFRQ | distcomb | SVF BP; −fb |
| 94 | `scream_lp` | Scream LP | Misc | SCREAM | scream | SVF LP + feedback loop: one-pole LP @f_var, gain 2+30·drive², tanh, ×res |
| 95 | `scream_bp` | Scream BP | Misc | SCREAM | scream | SVF BP + same loop |
