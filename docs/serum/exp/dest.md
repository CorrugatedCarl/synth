| idx | fx idx | id | label | law | lo | hi | def n | fmt | scope | ctr | group | inventory |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 |  | `a.level` | Osc A Level | pow2 | 0 | 1 | 0.75 | pct | V |  | Osc A | A3 LEVEL |
| 1 |  | `a.pan` | Osc A Pan | lin | -1 | 1 | 0.5 | pan | V | C | Osc A | A3 PAN |
| 2 |  | `a.oct` | Osc A Octave | int | -4 | 4 | 0.5 | oct | V | C | Osc A | A3 OCT |
| 3 |  | `a.semi` | Osc A Semi | int | -12 | 12 | 0.5 | st | V | C | Osc A | A3 SEM |
| 4 |  | `a.fine` | Osc A Fine | lin | -100 | 100 | 0.5 | ct | V | C | Osc A | A3 FIN |
| 5 |  | `a.crs` | Osc A Coarse Pitch | lin | -64 | 64 | 0.5 | crs | V | C | Osc A | A3 CRS |
| 6 |  | `a.uni` | Osc A Unison | int | 1 | 16 | 0 | int | V* |  | Osc A | A3 UNISON (sampled at note-on, §6.1) |
| 7 |  | `a.det` | Osc A Uni Detune | pow2 | 0 | 1 | 0.5 | det | V |  | Osc A | A3 DETUNE (display = knob²) |
| 8 |  | `a.blend` | Osc A Uni Blend | lin | 0 | 1 | 0.75 | pct | V |  | Osc A | A3 BLEND |
| 9 |  | `a.phase` | Osc A Phase | lin | 0 | 360 | 0.5 | phase | V |  | Osc A | A3 PHASE (n=1 → Mem) |
| 10 |  | `a.rand` | Osc A Rand Phase | lin | 0 | 1 | 1 | pct | V |  | Osc A | A3 RAND |
| 11 |  | `a.wt` | Osc A WT Pos | lin | 0 | 1 | 0 | frame | V |  | Osc A | A3 WT POS |
| 12 |  | `a.warp` | Osc A Warp | lin | 0 | 1 | 0 | pct | V |  | Osc A | A3 WARP |
| 13 |  | `a.uniw` | Osc A Uni Width | lin | 0 | 1 | 1 | pct | V |  | Osc A | A4 Width (Uni LR) |
| 14 |  | `a.uniwarp` | Osc A Uni Warp | lin | -1 | 1 | 0.5 | bip100 | V | C | Osc A | A4 Warp (Uni Warp) |
| 15 |  | `a.uniwt` | Osc A Uni WT Pos | lin | -1 | 1 | 0.5 | bip100 | V | C | Osc A | A4 WT Pos (Uni WTPos) |
| 16 |  | `a.stack` | Osc A Uni Stack | enum | 0 | 8 | 0 | enum:UNI_STACKS | V |  | Osc A | A4 Stack |
| 17 |  | `b.level` | Osc B Level | pow2 | 0 | 1 | 0.75 | pct | V |  | Osc B | A3 LEVEL |
| 18 |  | `b.pan` | Osc B Pan | lin | -1 | 1 | 0.5 | pan | V | C | Osc B | A3 PAN |
| 19 |  | `b.oct` | Osc B Octave | int | -4 | 4 | 0.5 | oct | V | C | Osc B | A3 OCT |
| 20 |  | `b.semi` | Osc B Semi | int | -12 | 12 | 0.5 | st | V | C | Osc B | A3 SEM |
| 21 |  | `b.fine` | Osc B Fine | lin | -100 | 100 | 0.5 | ct | V | C | Osc B | A3 FIN |
| 22 |  | `b.crs` | Osc B Coarse Pitch | lin | -64 | 64 | 0.5 | crs | V | C | Osc B | A3 CRS |
| 23 |  | `b.uni` | Osc B Unison | int | 1 | 16 | 0 | int | V* |  | Osc B | A3 UNISON (sampled at note-on, §6.1) |
| 24 |  | `b.det` | Osc B Uni Detune | pow2 | 0 | 1 | 0.5 | det | V |  | Osc B | A3 DETUNE (display = knob²) |
| 25 |  | `b.blend` | Osc B Uni Blend | lin | 0 | 1 | 0.75 | pct | V |  | Osc B | A3 BLEND |
| 26 |  | `b.phase` | Osc B Phase | lin | 0 | 360 | 0.5 | phase | V |  | Osc B | A3 PHASE (n=1 → Mem) |
| 27 |  | `b.rand` | Osc B Rand Phase | lin | 0 | 1 | 1 | pct | V |  | Osc B | A3 RAND |
| 28 |  | `b.wt` | Osc B WT Pos | lin | 0 | 1 | 0 | frame | V |  | Osc B | A3 WT POS |
| 29 |  | `b.warp` | Osc B Warp | lin | 0 | 1 | 0 | pct | V |  | Osc B | A3 WARP |
| 30 |  | `b.uniw` | Osc B Uni Width | lin | 0 | 1 | 1 | pct | V |  | Osc B | A4 Width (Uni LR) |
| 31 |  | `b.uniwarp` | Osc B Uni Warp | lin | -1 | 1 | 0.5 | bip100 | V | C | Osc B | A4 Warp (Uni Warp) |
| 32 |  | `b.uniwt` | Osc B Uni WT Pos | lin | -1 | 1 | 0.5 | bip100 | V | C | Osc B | A4 WT Pos (Uni WTPos) |
| 33 |  | `b.stack` | Osc B Uni Stack | enum | 0 | 8 | 0 | enum:UNI_STACKS | V |  | Osc B | A4 Stack |
| 34 |  | `n.level` | Noise Level | pow2 | 0 | 1 | 0.25 | pct | V |  | Noise | A8 LEVEL |
| 35 |  | `n.pitch` | Noise Pitch | npitch | -200 | 48 | 0.5 | npitch | V | C | Noise | A8 PITCH |
| 36 |  | `n.fine` | Noise Fine | lin | -100 | 100 | 0.5 | ct | V | C | Noise | A8/A19 Noise Fine |
| 37 |  | `n.pan` | Noise Pan | lin | -1 | 1 | 0.5 | pan | V | C | Noise | A8 PAN |
| 38 |  | `n.rand` | Noise Rand Phase | lin | 0 | 1 | 0 | pct | V |  | Noise | A8 RAND |
| 39 |  | `n.phase` | Noise Phase | lin | 0 | 1 | 0 | pct | V |  | Noise | A8 PHASE |
| 40 |  | `s.level` | Sub Level | lin | 0 | 1 | 0.75 | pct | V |  | Sub | A7 LEVEL (linear amplitude) |
| 41 |  | `s.pan` | Sub Pan | lin | -1 | 1 | 0.5 | pan | V | C | Sub | A7 PAN |
| 42 |  | `f.cutoff` | Filter Cutoff | exp | 8.1758¹ | 22050 | 0.5 | hz | V |  | Filter | A11.1 CUTOFF |
| 43 |  | `f.res` | Filter Res | lin | 0 | 1 | 0.1 | pct | V |  | Filter | A11.1 RES |
| 44 |  | `f.drive` | Filter Drive | lin | 0 | 1 | 0 | pct | V |  | Filter | A11.1 DRIVE |
| 45 |  | `f.var` | Filter Var | lin | 0 | 1 | 0 | var | V |  | Filter | A11.1 VAR |
| 46 |  | `f.mix` | Filter Mix | lin | 0 | 1 | 1 | pct | V |  | Filter | A11.1 MIX |
| 47 |  | `f.pan` | Filter Pan | lin | 0 | 1 | 0.5 | fpan | V | C | Filter | A11.1 PAN (Stereo) |
| 48 |  | `e1.att` | Env 1 Attack | pow5 | 0 | 32 | 0.11 | time | V* |  | Env 1 | A12 Attack |
| 49 |  | `e1.hold` | Env 1 Hold | pow5 | 0 | 32 | 0 | time | V* |  | Env 1 | A12 Hold |
| 50 |  | `e1.dec` | Env 1 Decay | pow5 | 0 | 32 | 0.5 | time | V* |  | Env 1 | A12 Decay |
| 51 |  | `e1.sus` | Env 1 Sustain | pow2 | 0 | 1 | 1 | db | V* |  | Env 1 | A12 Sustain ENV1 (amp = n²) |
| 52 |  | `e1.rel` | Env 1 Release | pow5 | 0 | 32 | 0.215 | time | V* |  | Env 1 | A12 Release |
| 53 |  | `e2.att` | Env 2 Attack | pow5 | 0 | 32 | 0.11 | time | V* |  | Env 2 | A12 Attack |
| 54 |  | `e2.hold` | Env 2 Hold | pow5 | 0 | 32 | 0 | time | V* |  | Env 2 | A12 Hold |
| 55 |  | `e2.dec` | Env 2 Decay | pow5 | 0 | 32 | 0.5 | time | V* |  | Env 2 | A12 Decay |
| 56 |  | `e2.sus` | Env 2 Sustain | lin | 0 | 1 | 1 | pct | V* |  | Env 2 | A12 Sustain ENV2/3 |
| 57 |  | `e2.rel` | Env 2 Release | pow5 | 0 | 32 | 0.215 | time | V* |  | Env 2 | A12 Release |
| 58 |  | `e3.att` | Env 3 Attack | pow5 | 0 | 32 | 0.11 | time | V* |  | Env 3 | A12 Attack |
| 59 |  | `e3.hold` | Env 3 Hold | pow5 | 0 | 32 | 0 | time | V* |  | Env 3 | A12 Hold |
| 60 |  | `e3.dec` | Env 3 Decay | pow5 | 0 | 32 | 0.5 | time | V* |  | Env 3 | A12 Decay |
| 61 |  | `e3.sus` | Env 3 Sustain | lin | 0 | 1 | 1 | pct | V* |  | Env 3 | A12 Sustain ENV2/3 |
| 62 |  | `e3.rel` | Env 3 Release | pow5 | 0 | 32 | 0.215 | time | V* |  | Env 3 | A12 Release |
| 63 |  | `l1.rate` | LFO 1 Rate | pow4 | 0 | 100 | 0.5 | lfoRate | V*M |  | LFO 1 | A13 Rate (Hz) / ladder (BPM) |
| 64 |  | `l1.rise` | LFO 1 Rise | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 1 | A13 Rise |
| 65 |  | `l1.delay` | LFO 1 Delay | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 1 | A13 Delay |
| 66 |  | `l1.smooth` | LFO 1 Smooth | lin | 0 | 1 | 0 | pct | V*M |  | LFO 1 | A13 Smooth |
| 67 |  | `l2.rate` | LFO 2 Rate | pow4 | 0 | 100 | 0.5 | lfoRate | V*M |  | LFO 2 | A13 Rate (Hz) / ladder (BPM) |
| 68 |  | `l2.rise` | LFO 2 Rise | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 2 | A13 Rise |
| 69 |  | `l2.delay` | LFO 2 Delay | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 2 | A13 Delay |
| 70 |  | `l2.smooth` | LFO 2 Smooth | lin | 0 | 1 | 0 | pct | V*M |  | LFO 2 | A13 Smooth |
| 71 |  | `l3.rate` | LFO 3 Rate | pow4 | 0 | 100 | 0.5 | lfoRate | V*M |  | LFO 3 | A13 Rate (Hz) / ladder (BPM) |
| 72 |  | `l3.rise` | LFO 3 Rise | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 3 | A13 Rise |
| 73 |  | `l3.delay` | LFO 3 Delay | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 3 | A13 Delay |
| 74 |  | `l3.smooth` | LFO 3 Smooth | lin | 0 | 1 | 0 | pct | V*M |  | LFO 3 | A13 Smooth |
| 75 |  | `l4.rate` | LFO 4 Rate | pow4 | 0 | 100 | 0.5 | lfoRate | V*M |  | LFO 4 | A13 Rate (Hz) / ladder (BPM) |
| 76 |  | `l4.rise` | LFO 4 Rise | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 4 | A13 Rise |
| 77 |  | `l4.delay` | LFO 4 Delay | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 4 | A13 Delay |
| 78 |  | `l4.smooth` | LFO 4 Smooth | lin | 0 | 1 | 0 | pct | V*M |  | LFO 4 | A13 Smooth |
| 79 |  | `l5.rate` | LFO 5 Rate | pow4 | 0 | 100 | 0.5 | lfoRate | V*M |  | LFO 5 | A13 Rate (Hz) / ladder (BPM) |
| 80 |  | `l5.rise` | LFO 5 Rise | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 5 | A13 Rise |
| 81 |  | `l5.delay` | LFO 5 Delay | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 5 | A13 Delay |
| 82 |  | `l5.smooth` | LFO 5 Smooth | lin | 0 | 1 | 0 | pct | V*M |  | LFO 5 | A13 Smooth |
| 83 |  | `l6.rate` | LFO 6 Rate | pow4 | 0 | 100 | 0.5 | lfoRate | V*M |  | LFO 6 | A13 Rate (Hz) / ladder (BPM) |
| 84 |  | `l6.rise` | LFO 6 Rise | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 6 | A13 Rise |
| 85 |  | `l6.delay` | LFO 6 Delay | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 6 | A13 Delay |
| 86 |  | `l6.smooth` | LFO 6 Smooth | lin | 0 | 1 | 0 | pct | V*M |  | LFO 6 | A13 Smooth |
| 87 |  | `l7.rate` | LFO 7 Rate | pow4 | 0 | 100 | 0.5 | lfoRate | V*M |  | LFO 7 | A13 Rate (Hz) / ladder (BPM) |
| 88 |  | `l7.rise` | LFO 7 Rise | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 7 | A13 Rise |
| 89 |  | `l7.delay` | LFO 7 Delay | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 7 | A13 Delay |
| 90 |  | `l7.smooth` | LFO 7 Smooth | lin | 0 | 1 | 0 | pct | V*M |  | LFO 7 | A13 Smooth |
| 91 |  | `l8.rate` | LFO 8 Rate | pow4 | 0 | 100 | 0.5 | lfoRate | V*M |  | LFO 8 | A13 Rate (Hz) / ladder (BPM) |
| 92 |  | `l8.rise` | LFO 8 Rise | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 8 | A13 Rise |
| 93 |  | `l8.delay` | LFO 8 Delay | lin | 0 | 4 | 0 | lfoTime | V* |  | LFO 8 | A13 Delay |
| 94 |  | `l8.smooth` | LFO 8 Smooth | lin | 0 | 1 | 0 | pct | V*M |  | LFO 8 | A13 Smooth |
| 95 |  | `c1.rate` | Chaos 1 Rate | pow5 | 0 | 1000 | 0.2512 | chaosRate | V*M |  | Chaos | A14 Chaos 1 Rate |
| 96 |  | `c2.rate` | Chaos 2 Rate | pow5 | 0 | 1000 | 0.2512 | chaosRate | V*M |  | Chaos | A14 Chaos 2 Rate |
| 97 |  | `g.porta` | Porta Time | pow5 | 0 | 8 | 0 | time | V |  | Global | A17 Porta |
| 98 |  | `g.curve` | Porta Curve | lin | -1 | 1 | 0.5 | bip100 | V | C | Global | A17 Curve |
| 99 |  | `g.tune` | Master Tune | lin | -64 | 64 | 0.5 | st2 | V | C | Global | A18 Mast.Tun (matrix-only) |
| 100 |  | `g.amp` | Amp | pow2 | 0 | 1 | 1 | pct | V |  | Global | A16.5 Amp. (matrix-only) |
| 101 |  | `g.bendup` | Bend Up | int | -24 | 24 | 13/24 | st | V |  | Global | A14 Bend Up |
| 102 |  | `g.benddn` | Bend Down | int | -24 | 24 | 11/24 | st | V |  | Global | A14 Bend Down |
| 103 |  | `bus1` | LFO Bus 1 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 104 |  | `bus2` | LFO Bus 2 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 105 |  | `bus3` | LFO Bus 3 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 106 |  | `bus4` | LFO Bus 4 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 107 |  | `bus5` | LFO Bus 5 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 108 |  | `bus6` | LFO Bus 6 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 109 |  | `bus7` | LFO Bus 7 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 110 |  | `bus8` | LFO Bus 8 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 111 |  | `bus9` | LFO Bus 9 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 112 |  | `bus10` | LFO Bus 10 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 113 |  | `bus11` | LFO Bus 11 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 114 |  | `bus12` | LFO Bus 12 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 115 |  | `bus13` | LFO Bus 13 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 116 |  | `bus14` | LFO Bus 14 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 117 |  | `bus15` | LFO Bus 15 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 118 |  | `bus16` | LFO Bus 16 | lin | -1 | 1 | 0.5 | bip100 | V*M | C | LFO Bus | A13 point modulation (matrix-only, base fixed 0.5) |
| 119 |  | `a.on` | Osc A On | bool | 0 | 1 | 1 | bool | V |  | Osc A | A23 Osc A/B On |
| 120 |  | `b.on` | Osc B On | bool | 0 | 1 | 0 | bool | V |  | Osc B | A23 Osc A/B On |
| 121 |  | `n.on` | Noise On | bool | 0 | 1 | 0 | bool | V |  | Noise | A23 Osc N On |
| 122 |  | `s.on` | Sub On | bool | 0 | 1 | 0 | bool | V |  | Sub | A23 Osc S On |
| 123 |  | `f.on` | Filter On | bool | 0 | 1 | 0 | bool | V |  | Filter | A23 Filter On |
| 124 |  | `f.routeA` | A>Filter | bool | 0 | 1 | 1 | bool | V |  | Filter | A23 OscA>Fil |
| 125 |  | `f.routeB` | B>Filter | bool | 0 | 1 | 0 | bool | V |  | Filter | A23 OscB>Fil |
| 126 |  | `f.routeN` | Noise>Filter | bool | 0 | 1 | 0 | bool | V |  | Filter | A23 OscN>Fil |
| 127 |  | `f.routeS` | Sub>Filter | bool | 0 | 1 | 0 | bool | V |  | Filter | A23 OscS>Fil |
| 128 |  | `a.track` | Osc A Pitch Track | bool | 0 | 1 | 1 | bool | V |  | Osc A | A23 OscAPitchTrack |
| 129 |  | `b.track` | Osc B Pitch Track | bool | 0 | 1 | 1 | bool | V |  | Osc B | A23 OscBPitchTrack |
| 130 |  | `a.warpMode` | Osc A Warp Mode | enum | 0 | 22 | 0 | enum:WARPS | V |  | Osc A | A23 WarpOscA |
| 131 |  | `b.warpMode` | Osc B Warp Mode | enum | 0 | 22 | 0 | enum:WARPS | V |  | Osc B | A23 WarpOscB |
| 132 |  | `s.shape` | Sub Shape | enum | 0 | 4 | 0 | enum:SUB_SHAPES | V |  | Sub | A23 SubOscShape |
| 133 |  | `s.oct` | Sub Octave | int | -4 | 4 | 0.5 | oct | V | C | Sub | A23 SubOscOctave |
| 134 |  | `f.type` | Filter Type | enum | 0 | 95 | 1/95 | enum:FILTERS | V |  | Filter | A23 Fil Type |
| 135 |  | `e1.ca` | Env 1 Attack Curve | lin | 0 | 1 | 0.5 | pct | V* |  | Env 1 | A23 A curve1 |
| 136 |  | `e1.cd` | Env 1 Decay Curve | lin | 0 | 1 | 0.666 | pct | V* |  | Env 1 | A23 D curve1 |
| 137 |  | `e1.cr` | Env 1 Release Curve | lin | 0 | 1 | 0.666 | pct | V* |  | Env 1 | A23 R curve1 |
| 138 |  | `e2.ca` | Env 2 Attack Curve | lin | 0 | 1 | 0.5 | pct | V* |  | Env 2 | A23 A curve2 |
| 139 |  | `e2.cd` | Env 2 Decay Curve | lin | 0 | 1 | 0.666 | pct | V* |  | Env 2 | A23 D curve2 |
| 140 |  | `e2.cr` | Env 2 Release Curve | lin | 0 | 1 | 0.666 | pct | V* |  | Env 2 | A23 R curve2 |
| 141 |  | `e3.ca` | Env 3 Attack Curve | lin | 0 | 1 | 0.5 | pct | V* |  | Env 3 | A23 A curve3 |
| 142 |  | `e3.cd` | Env 3 Decay Curve | lin | 0 | 1 | 0.666 | pct | V* |  | Env 3 | A23 D curve3 |
| 143 |  | `e3.cr` | Env 3 Release Curve | lin | 0 | 1 | 0.666 | pct | V* |  | Env 3 | A23 R curve3 |
| 144 |  | `c1.bpm` | Chaos 1 BPM | bool | 0 | 1 | 0 | bool | V*M |  | Chaos | A16.5 Chaos1 BPM |
| 145 |  | `c2.bpm` | Chaos 2 BPM | bool | 0 | 1 | 0 | bool | V*M |  | Chaos | A16.5 Chaos2 BPM |
| 146 |  | `g.wheel` | Mod Wheel | lin | 0 | 1 | 0 | pct | G |  | Global | A16.5 Mod Wheel (matrix-only; base = host wheel) |
| 147 |  | `g.bend` | Pitch Bend | lin | -1 | 1 | 0.5 | bip100 | G | C | Global | A16.5 Pitch Bend (matrix-only; base = host bend) |
| 148 | 0 | `g.master` | Master Volume | pow3 | 0 | 1 | 0.7 | db | M |  | Master | A18 Master Volume (state lives in Serum s.p) |
| 149 | 1 | `fx.hyper.on` | Hyper/Dim Enable | bool | 0 | 1 | 0 | bool | M |  | FX Hyper/Dim | A20.1 Hyp Enable |
| 150 | 2 | `fx.hyper.rate` | Hyper Rate | lin | 0 | 1 | 0.4 | pct | M |  | FX Hyper/Dim | A20.4.1 RATE |
| 151 | 3 | `fx.hyper.detune` | Hyper Detune | lin | 0 | 1 | 0.25 | pct | M |  | FX Hyper/Dim | A20.4.1 DETUNE |
| 152 | 4 | `fx.hyper.unison` | Hyper Unison | int | 0 | 7 | 4/7 | int | M |  | FX Hyper/Dim | A20.4.1 UNISON |
| 153 | 5 | `fx.hyper.mix` | Hyper Mix | lin | 0 | 1 | 0.5 | pct | M |  | FX Hyper/Dim | A20.4.1 MIX |
| 154 | 6 | `fx.hyper.level` | Hyper Level | pow2 | 0 | 4 | 0.5 | dbtrim | M |  | FX Hyper/Dim | A20.2 LEVEL trim |
| 155 | 7 | `fx.dim.size` | Dimension Size | lin | 0 | 1 | 0.5 | pct | M |  | FX Hyper/Dim | A20.4.1 SIZE |
| 156 | 8 | `fx.dim.mix` | Dimension Mix | lin | 0 | 1 | 0 | pct | M |  | FX Hyper/Dim | A20.4.1 Dim MIX |
| 157 | 9 | `fx.dim.level` | Dimension Level | pow2 | 0 | 4 | 0.5 | dbtrim | M |  | FX Hyper/Dim | A20.2 LEVEL trim |
| 158 | 10 | `fx.dist.on` | Distortion Enable | bool | 0 | 1 | 0 | bool | M |  | FX Distortion | A20.1 Dist Enable |
| 159 | 11 | `fx.dist.drive` | Dist Drive | lin | 0 | 1 | 0.25 | pct | M |  | FX Distortion | A20.4.2 DRIVE |
| 160 | 12 | `fx.dist.lbh` | Dist LP/BP/HP | lin | 0 | 1 | 0 | lbh | M |  | FX Distortion | A20.4.2 LP/BP/HP |
| 161 | 13 | `fx.dist.freq` | Dist Freq | exp | 8.1758¹ | 13289.75² | 0.5 | hz | M |  | FX Distortion | A20.4.2 F |
| 162 | 14 | `fx.dist.q` | Dist Q | exp | 0.5 | 8 | 0.5 | q01 | M |  | FX Distortion | A20.4.2 Q (engine Q = 0.5·16^n) |
| 163 | 15 | `fx.dist.mix` | Dist Mix | lin | 0 | 1 | 1 | pct | M |  | FX Distortion | A20.4.2 MIX |
| 164 | 16 | `fx.dist.level` | Dist Level | pow2 | 0 | 4 | 0.5 | dbtrim | M |  | FX Distortion | A20.2 LEVEL trim |
| 165 | 17 | `fx.flg.on` | Flanger Enable | bool | 0 | 1 | 0 | bool | M |  | FX Flanger | A20.1 |
| 166 | 18 | `fx.flg.rate` | Flanger Rate | pow4 | 0 | 20 | 0.25 | modRate | M |  | FX Flanger | A20.4.3 RATE (ladder MODFX when BPM) |
| 167 | 19 | `fx.flg.depth` | Flanger Depth | lin | 0 | 1 | 1 | pct | M |  | FX Flanger | A20.4.3 DEPTH |
| 168 | 20 | `fx.flg.feed` | Flanger Feed | lin | 0 | 1 | 0.5 | pct | M |  | FX Flanger | A20.4.3 FEED |
| 169 | 21 | `fx.flg.phase` | Flanger Phase | lin | 0 | 360 | 0.5 | deg | M |  | FX Flanger | A20.4.3 PHASE (Flg_Stereo) |
| 170 | 22 | `fx.flg.mix` | Flanger Mix | lin | 0 | 1 | 1 | pct | M |  | FX Flanger | A20.4.3 MIX |
| 171 | 23 | `fx.flg.level` | Flanger Level | pow2 | 0 | 4 | 0.5 | dbtrim | M |  | FX Flanger | A20.2 LEVEL trim |
| 172 | 24 | `fx.phs.on` | Phaser Enable | bool | 0 | 1 | 0 | bool | M |  | FX Phaser | A20.1 |
| 173 | 25 | `fx.phs.rate` | Phaser Rate | pow4 | 0 | 20 | 0.25 | modRate | M |  | FX Phaser | A20.4.4 RATE |
| 174 | 26 | `fx.phs.depth` | Phaser Depth | lin | 0 | 1 | 0.5 | pct | M |  | FX Phaser | A20.4.4 DEPTH |
| 175 | 27 | `fx.phs.freq` | Phaser Freq | exp | 20 | 18000 | 0.5 | hz | M |  | FX Phaser | A20.4.4 FREQ |
| 176 | 28 | `fx.phs.feed` | Phaser Feed | lin | 0 | 1 | 0.8 | pct | M |  | FX Phaser | A20.4.4 FEED |
| 177 | 29 | `fx.phs.phase` | Phaser Phase | lin | 0 | 360 | 0.5 | deg | M |  | FX Phaser | A20.4.4 PHASE |
| 178 | 30 | `fx.phs.mix` | Phaser Mix | lin | 0 | 1 | 1 | pct | M |  | FX Phaser | A20.4.4 MIX |
| 179 | 31 | `fx.phs.level` | Phaser Level | pow2 | 0 | 4 | 0.5 | dbtrim | M |  | FX Phaser | A20.2 LEVEL trim |
| 180 | 32 | `fx.cho.on` | Chorus Enable | bool | 0 | 1 | 0 | bool | M |  | FX Chorus | A20.1 |
| 181 | 33 | `fx.cho.rate` | Chorus Rate | pow4 | 0 | 20 | 0.25 | modRate | M |  | FX Chorus | A20.4.5 RATE |
| 182 | 34 | `fx.cho.dly1` | Chorus Delay 1 | pow2 | 0 | 20 | 0.5 | ms | M |  | FX Chorus | A20.4.5 DELAY 1 |
| 183 | 35 | `fx.cho.dly2` | Chorus Delay 2 | pow2 | 0 | 20 | 0 | ms | M |  | FX Chorus | A20.4.5 DELAY 2 |
| 184 | 36 | `fx.cho.depth` | Chorus Depth | pow2 | 0 | 26 | 1 | ms | M |  | FX Chorus | A20.4.5 DEPTH |
| 185 | 37 | `fx.cho.feed` | Chorus Feed | lin | 0 | 0.95 | 0.1 | pct1 | M |  | FX Chorus | A20.4.5 FEED |
| 186 | 38 | `fx.cho.lpf` | Chorus LPF | exp | 50 | 20000 | 0.5 | hz | M |  | FX Chorus | A20.4.5 LPF |
| 187 | 39 | `fx.cho.mix` | Chorus Mix | lin | 0 | 1 | 0.5 | pct | M |  | FX Chorus | A20.4.5 MIX |
| 188 | 40 | `fx.cho.level` | Chorus Level | pow2 | 0 | 4 | 0.5 | dbtrim | M |  | FX Chorus | A20.2 LEVEL trim |
| 189 | 41 | `fx.dly.on` | Delay Enable | bool | 0 | 1 | 0 | bool | M |  | FX Delay | A20.1 |
| 190 | 42 | `fx.dly.feed` | Delay Feed | lin | 0 | 1 | 0.4 | pct | M |  | FX Delay | A20.4.6 FEED |
| 191 | 43 | `fx.dly.timeL` | Delay Time L | pow4 | 1 | 501 | 0.625 | dlyTime | M |  | FX Delay | A20.4.6 LEFT time (ladder DLY when BPM) |
| 192 | 44 | `fx.dly.timeR` | Delay Time R | pow4 | 1 | 501 | 0.625 | dlyTime | M |  | FX Delay | A20.4.6 RIGHT time |
| 193 | 45 | `fx.dly.offL` | Delay Offset L | lin | 0.5 | 1.5 | 0.5 | xoff | M |  | FX Delay | A20.4.6 LEFT offset |
| 194 | 46 | `fx.dly.offR` | Delay Offset R | lin | 0.5 | 1.5 | 0.5 | xoff | M |  | FX Delay | A20.4.6 RIGHT offset |
| 195 | 47 | `fx.dly.freq` | Delay Filter Freq | exp | 40 | 18000 | 0.5 | hz | M |  | FX Delay | A20.4.6 F |
| 196 | 48 | `fx.dly.q` | Delay Filter Q | lin | 0.8 | 8.2 | 6/7.4 | q2 | M |  | FX Delay | A20.4.6 Q (bandwidth, octaves) |
| 197 | 49 | `fx.dly.mix` | Delay Mix | lin | 0 | 1 | 0.3 | pct | M |  | FX Delay | A20.4.6 MIX |
| 198 | 50 | `fx.dly.level` | Delay Level | pow2 | 0 | 4 | 0.5 | dbtrim | M |  | FX Delay | A20.2 LEVEL trim |
| 199 | 51 | `fx.cmp.on` | Compressor Enable | bool | 0 | 1 | 0 | bool | M |  | FX Compressor | A20.1 |
| 200 | 52 | `fx.cmp.thr` | Comp Threshold | rpow3 | 0.000001 | 1 | 0.5 | db | M |  | FX Compressor | A20.4.7 THRESH (dB = 60·log10(1−n)) |
| 201 | 53 | `fx.cmp.ratio` | Comp Ratio | ratio | 1 | 32 | 0.75 | ratio | M |  | FX Compressor | A20.4.7 RATIO |
| 202 | 54 | `fx.cmp.att` | Comp Attack | pow2 | 0 | 1000 | 0.3 | cmpAtt | M |  | FX Compressor | A20.4.7 ATTACK (floor 0.1 ms; Limit: 0–10 ms look-ahead) |
| 203 | 55 | `fx.cmp.rel` | Comp Release | pow2 | 0 | 1000 | 0.3 | msFloor | M |  | FX Compressor | A20.4.7 RELEASE (floor 0.1 ms) |
| 204 | 56 | `fx.cmp.gain` | Comp Gain | pow2 | 1 | 32 | 0 | db | M |  | FX Compressor | A20.4.7 GAIN (amp 1+31n²) |
| 205 | 57 | `fx.cmp.mbL` | Comp MB Low | lin | 0 | 2 | 0.5 | pct1 | M |  | FX Compressor | A20.4.7 CompMB L |
| 206 | 58 | `fx.cmp.mbM` | Comp MB Mid | lin | 0 | 2 | 0.5 | pct1 | M |  | FX Compressor | A20.4.7 CompMB M |
| 207 | 59 | `fx.cmp.mbH` | Comp MB High | lin | 0 | 2 | 0.5 | pct1 | M |  | FX Compressor | A20.4.7 CompMB H |
| 208 | 60 | `fx.cmp.mix` | Comp Mix | lin | 0 | 1 | 1 | pct | M |  | FX Compressor | A20.4.7 MIX (default 100 %, see §3.13 note) |
| 209 | 61 | `fx.cmp.level` | Comp Level | pow2 | 0 | 4 | 0.5 | dbtrim | M |  | FX Compressor | A20.2 LEVEL trim |
| 210 | 62 | `fx.rev.on` | Reverb Enable | bool | 0 | 1 | 0 | bool | M |  | FX Reverb | A20.1 |
| 211 | 63 | `fx.rev.size` | Reverb Size | lin | 0 | 1 | 0.33 | pct | M |  | FX Reverb | A20.4.8 SIZE |
| 212 | 64 | `fx.rev.t` | Reverb PreDelay / Decay | lin | 0 | 1 | 0.12 | revT | M |  | FX Reverb | A20.4.8 slot 83 |
| 213 | 65 | `fx.rev.locut` | Reverb Low Cut | lin | 0 | 1 | 0 | pct | M |  | FX Reverb | A20.4.8 LOW CUT |
| 214 | 66 | `fx.rev.c` | Reverb Damp / Spin | lin | 0 | 1 | 0.25 | pct | M |  | FX Reverb | A20.4.8 slot 85 (Hall-era default 25 %) |
| 215 | 67 | `fx.rev.hicut` | Reverb High Cut | lin | 0 | 1 | 0.5 | pct | M |  | FX Reverb | A20.4.8 HIGH CUT |
| 216 | 68 | `fx.rev.w` | Reverb Width / Spin Depth | lin | 0 | 1 | 0.2 | pct | M |  | FX Reverb | A20.4.8 slot 87 (Hall-era default 20 %) |
| 217 | 69 | `fx.rev.mix` | Reverb Mix | lin | 0 | 1 | 0.33 | pct | M |  | FX Reverb | A20.4.8 MIX |
| 218 | 70 | `fx.rev.level` | Reverb Level | pow2 | 0 | 4 | 0.5 | dbtrim | M |  | FX Reverb | A20.2 LEVEL trim |
| 219 | 71 | `fx.eq.on` | EQ Enable | bool | 0 | 1 | 0 | bool | M |  | FX EQ | A20.1 |
| 220 | 72 | `fx.eq.freqL` | EQ Freq L | exp | 21.533 | 20000 | 0.333 | hz | M |  | FX EQ | A20.4.9 FREQ L |
| 221 | 73 | `fx.eq.qL` | EQ Q L | lin | 0 | 1 | 0.6 | pct | M |  | FX EQ | A20.4.9 Q L |
| 222 | 74 | `fx.eq.gainL` | EQ Gain L | lin | -24 | 24 | 0.5 | dbv | M | C | FX EQ | A20.4.9 GAIN L |
| 223 | 75 | `fx.eq.freqH` | EQ Freq H | exp | 21.533 | 20000 | 0.666 | hz | M |  | FX EQ | A20.4.9 FREQ R |
| 224 | 76 | `fx.eq.qH` | EQ Q H | lin | 0 | 1 | 0.6 | pct | M |  | FX EQ | A20.4.9 Q R |
| 225 | 77 | `fx.eq.gainH` | EQ Gain H | lin | -24 | 24 | 0.5 | dbv | M | C | FX EQ | A20.4.9 GAIN R |
| 226 | 78 | `fx.fil.on` | FX Filter Enable | bool | 0 | 1 | 0 | bool | M |  | FX Filter | A20.1 |
| 227 | 79 | `fx.fil.cutoff` | FX Filter Cutoff | exp | 8.1758¹ | 22050 | 0.5 | hz | M |  | FX Filter | A20.4.10 CUTOFF |
| 228 | 80 | `fx.fil.res` | FX Filter Res | lin | 0 | 1 | 0 | pct | M |  | FX Filter | A20.4.10 RES |
| 229 | 81 | `fx.fil.drive` | FX Filter Drive | lin | 0 | 1 | 0 | pct | M |  | FX Filter | A20.4.10 DRIVE |
| 230 | 82 | `fx.fil.var` | FX Filter Var | lin | 0 | 1 | 0 | var | M |  | FX Filter | A20.4.10 VAR |
| 231 | 83 | `fx.fil.pan` | FX Filter Pan | lin | 0 | 1 | 0.5 | fpan | M | C | FX Filter | A20.4.10 PAN |
| 232 | 84 | `fx.fil.mix` | FX Filter Mix | lin | 0 | 1 | 1 | pct | M |  | FX Filter | A20.4.10 MIX |
| 233 | 85 | `fx.fil.level` | FX Filter Level | pow2 | 0 | 4 | 0.5 | dbtrim | M |  | FX Filter | A20.2 LEVEL trim |
| 234 | 86 | `g.bypass` | Bypass | bool | 0 | 1 | 0 | bool | M |  | Master | A16.5 Bypass (state lives in Serum s.p; matrix-only) |
| 235 | 87 | `fx.hyper.retrig` | Hyper Retrig | bool | 0 | 1 | 0 | bool | M |  | FX Hyper/Dim | A20.3 Hyp Retrig |
| 236 | 88 | `fx.dist.mode` | Dist Mode | enum | 0 | 15 | 0 | enum:DIST_MODES | M |  | FX Distortion | A20.3 Dist_Mode |
| 237 | 89 | `fx.dist.filt` | Dist Pre/Post | enum | 0 | 2 | 0 | enum:DIST_FILTER | M |  | FX Distortion | A20.3 Dist_PrePost |
| 238 | 90 | `fx.flg.bpm` | Flanger BPM | bool | 0 | 1 | 0 | bool | M |  | FX Flanger | A20.3 Flg BPM |
| 239 | 91 | `fx.phs.bpm` | Phaser BPM | bool | 0 | 1 | 0 | bool | M |  | FX Phaser | A20.3 Phs BPM |
| 240 | 92 | `fx.cho.bpm` | Chorus BPM | bool | 0 | 1 | 0 | bool | M |  | FX Chorus | A20.3 Cho BPM |
| 241 | 93 | `fx.dly.bpm` | Delay BPM | bool | 0 | 1 | 1 | bool | M |  | FX Delay | A20.3 Dly BPM |
| 242 | 94 | `fx.dly.link` | Delay Link | bool | 0 | 1 | 0 | bool | M |  | FX Delay | A20.3 Dly Link |
| 243 | 95 | `fx.dly.mode` | Delay Mode | enum | 0 | 2 | 0 | enum:DLY_MODES | M |  | FX Delay | A20.3 Dly Mode |
| 244 | 96 | `fx.cmp.mb` | Comp Multiband | bool | 0 | 1 | 0 | bool | M |  | FX Compressor | A20.3 CmpMBnd |
| 245 | 97 | `fx.eq.typeL` | EQ Type L | enum | 0 | 2 | 0 | enum:EQ_TYPES_L | M |  | FX EQ | A20.3 EQ TypL |
| 246 | 98 | `fx.eq.typeH` | EQ Type H | enum | 0 | 2 | 0 | enum:EQ_TYPES_H | M |  | FX EQ | A20.3 EQ TypH |
| 247 | 99 | `fx.fil.type` | FX Filter Type | enum | 0 | 95 | 0 | enum:FILTERS | M |  | FX Filter | A20.3 FX Fil Type |
