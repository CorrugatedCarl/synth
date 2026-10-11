// Generates the index tables embedded in SPEC-serum.md (v2) and the fixture JSON files that E1 copies into
// tests/fixtures/ in milestone M1. Run: node gen.mjs   (outputs dest.md, filters.md, fixtures/*.json)
import { writeFileSync, mkdirSync } from 'node:fs';
const out = (f, s) => writeFileSync(new URL(f, import.meta.url), s);
mkdirSync(new URL('fixtures/', import.meta.url), { recursive: true });

const MIDI0 = 440 * Math.pow(2, -69 / 12);       // 8.175798915643707 Hz (MIDI note 0)
const MIDI128 = 440 * Math.pow(2, 59 / 12);      // 13289.750322 Hz (MIDI note 128)

/* ---------------- destinations ---------------- */
const D = [];
const add = (id, label, law, lo, hi, def, fmt, scope, ctr, group, ref) => D.push({ id, label, law, lo, hi, def, fmt, scope, ctr: ctr ? 1 : 0, group, ref });
for (const [k, K] of [['a', 'A'], ['b', 'B']]) {
  const g = `Osc ${K}`;
  add(`${k}.level`, `Osc ${K} Level`, 'pow2', 0, 1, 0.75, 'pct', 'V', 0, g, 'A3 LEVEL');
  add(`${k}.pan`, `Osc ${K} Pan`, 'lin', -1, 1, 0.5, 'pan', 'V', 1, g, 'A3 PAN');
  add(`${k}.oct`, `Osc ${K} Octave`, 'int', -4, 4, 0.5, 'oct', 'V', 1, g, 'A3 OCT');
  add(`${k}.semi`, `Osc ${K} Semi`, 'int', -12, 12, 0.5, 'st', 'V', 1, g, 'A3 SEM');
  add(`${k}.fine`, `Osc ${K} Fine`, 'lin', -100, 100, 0.5, 'ct', 'V', 1, g, 'A3 FIN');
  add(`${k}.crs`, `Osc ${K} Coarse Pitch`, 'lin', -64, 64, 0.5, 'crs', 'V', 1, g, 'A3 CRS');
  add(`${k}.uni`, `Osc ${K} Unison`, 'int', 1, 16, 0, 'int', 'V*', 0, g, 'A3 UNISON (sampled at note-on, §6.1)');
  add(`${k}.det`, `Osc ${K} Uni Detune`, 'pow2', 0, 1, 0.5, 'det', 'V', 0, g, 'A3 DETUNE (display = knob²)');
  add(`${k}.blend`, `Osc ${K} Uni Blend`, 'lin', 0, 1, 0.75, 'pct', 'V', 0, g, 'A3 BLEND');
  add(`${k}.phase`, `Osc ${K} Phase`, 'lin', 0, 360, 0.5, 'phase', 'V', 0, g, 'A3 PHASE (n=1 → Mem)');
  add(`${k}.rand`, `Osc ${K} Rand Phase`, 'lin', 0, 1, 1, 'pct', 'V', 0, g, 'A3 RAND');
  add(`${k}.wt`, `Osc ${K} WT Pos`, 'lin', 0, 1, 0, 'frame', 'V', 0, g, 'A3 WT POS');
  add(`${k}.warp`, `Osc ${K} Warp`, 'lin', 0, 1, 0, 'pct', 'V', 0, g, 'A3 WARP');
  add(`${k}.uniw`, `Osc ${K} Uni Width`, 'lin', 0, 1, 1, 'pct', 'V', 0, g, 'A4 Width (Uni LR)');
  add(`${k}.uniwarp`, `Osc ${K} Uni Warp`, 'lin', -1, 1, 0.5, 'bip100', 'V', 1, g, 'A4 Warp (Uni Warp)');
  add(`${k}.uniwt`, `Osc ${K} Uni WT Pos`, 'lin', -1, 1, 0.5, 'bip100', 'V', 1, g, 'A4 WT Pos (Uni WTPos)');
  add(`${k}.stack`, `Osc ${K} Uni Stack`, 'enum', 0, 8, 0, 'enum:UNI_STACKS', 'V', 0, g, 'A4 Stack');
}
add('n.level', 'Noise Level', 'pow2', 0, 1, 0.25, 'pct', 'V', 0, 'Noise', 'A8 LEVEL');
add('n.pitch', 'Noise Pitch', 'npitch', -200, 48, 0.5, 'npitch', 'V', 1, 'Noise', 'A8 PITCH');
add('n.fine', 'Noise Fine', 'lin', -100, 100, 0.5, 'ct', 'V', 1, 'Noise', 'A8/A19 Noise Fine');
add('n.pan', 'Noise Pan', 'lin', -1, 1, 0.5, 'pan', 'V', 1, 'Noise', 'A8 PAN');
add('n.rand', 'Noise Rand Phase', 'lin', 0, 1, 0, 'pct', 'V', 0, 'Noise', 'A8 RAND');
add('n.phase', 'Noise Phase', 'lin', 0, 1, 0, 'pct', 'V', 0, 'Noise', 'A8 PHASE');
add('s.level', 'Sub Level', 'lin', 0, 1, 0.75, 'pct', 'V', 0, 'Sub', 'A7 LEVEL (linear amplitude)');
add('s.pan', 'Sub Pan', 'lin', -1, 1, 0.5, 'pan', 'V', 1, 'Sub', 'A7 PAN');
add('f.cutoff', 'Filter Cutoff', 'exp', MIDI0, 22050, 0.5, 'hz', 'V', 0, 'Filter', 'A11.1 CUTOFF');
add('f.res', 'Filter Res', 'lin', 0, 1, 0.1, 'pct', 'V', 0, 'Filter', 'A11.1 RES');
add('f.drive', 'Filter Drive', 'lin', 0, 1, 0, 'pct', 'V', 0, 'Filter', 'A11.1 DRIVE');
add('f.var', 'Filter Var', 'lin', 0, 1, 0, 'var', 'V', 0, 'Filter', 'A11.1 VAR');
add('f.mix', 'Filter Mix', 'lin', 0, 1, 1, 'pct', 'V', 0, 'Filter', 'A11.1 MIX');
add('f.pan', 'Filter Pan', 'lin', 0, 1, 0.5, 'fpan', 'V', 1, 'Filter', 'A11.1 PAN (Stereo)');
for (let e = 1; e <= 3; e++) {
  const g = `Env ${e}`;
  add(`e${e}.att`, `Env ${e} Attack`, 'pow5', 0, 32, 0.11, 'time', 'V*', 0, g, 'A12 Attack');
  add(`e${e}.hold`, `Env ${e} Hold`, 'pow5', 0, 32, 0, 'time', 'V*', 0, g, 'A12 Hold');
  add(`e${e}.dec`, `Env ${e} Decay`, 'pow5', 0, 32, 0.5, 'time', 'V*', 0, g, 'A12 Decay');
  if (e === 1) add(`e${e}.sus`, `Env ${e} Sustain`, 'pow2', 0, 1, 1, 'db', 'V*', 0, g, 'A12 Sustain ENV1 (amp = n²)');
  else add(`e${e}.sus`, `Env ${e} Sustain`, 'lin', 0, 1, 1, 'pct', 'V*', 0, g, 'A12 Sustain ENV2/3');
  add(`e${e}.rel`, `Env ${e} Release`, 'pow5', 0, 32, 0.215, 'time', 'V*', 0, g, 'A12 Release');
}
for (let l = 1; l <= 8; l++) {
  const g = `LFO ${l}`;
  add(`l${l}.rate`, `LFO ${l} Rate`, 'pow4', 0, 100, 0.5, 'lfoRate', 'V*M', 0, g, 'A13 Rate (Hz) / ladder (BPM)');
  add(`l${l}.rise`, `LFO ${l} Rise`, 'lin', 0, 4, 0, 'lfoTime', 'V*', 0, g, 'A13 Rise');
  add(`l${l}.delay`, `LFO ${l} Delay`, 'lin', 0, 4, 0, 'lfoTime', 'V*', 0, g, 'A13 Delay');
  add(`l${l}.smooth`, `LFO ${l} Smooth`, 'lin', 0, 1, 0, 'pct', 'V*M', 0, g, 'A13 Smooth');
}
add('c1.rate', 'Chaos 1 Rate', 'pow5', 0, 1000, 0.2512, 'chaosRate', 'V*M', 0, 'Chaos', 'A14 Chaos 1 Rate');
add('c2.rate', 'Chaos 2 Rate', 'pow5', 0, 1000, 0.2512, 'chaosRate', 'V*M', 0, 'Chaos', 'A14 Chaos 2 Rate');
add('g.porta', 'Porta Time', 'pow5', 0, 8, 0, 'time', 'V', 0, 'Global', 'A17 Porta');
add('g.curve', 'Porta Curve', 'lin', -1, 1, 0.5, 'bip100', 'V', 1, 'Global', 'A17 Curve');
add('g.tune', 'Master Tune', 'lin', -64, 64, 0.5, 'st2', 'V', 1, 'Global', 'A18 Mast.Tun (matrix-only)');
add('g.amp', 'Amp', 'pow2', 0, 1, 1, 'pct', 'V', 0, 'Global', 'A16.5 Amp. (matrix-only)');
add('g.bendup', 'Bend Up', 'int', -24, 24, 26 / 48, 'st', 'V', 0, 'Global', 'A14 Bend Up');
add('g.benddn', 'Bend Down', 'int', -24, 24, 22 / 48, 'st', 'V', 0, 'Global', 'A14 Bend Down');
for (let b = 1; b <= 16; b++) add(`bus${b}`, `LFO Bus ${b}`, 'lin', -1, 1, 0.5, 'bip100', 'V*M', 1, 'LFO Bus', 'A13 point modulation (matrix-only, base fixed 0.5)');
// v2 additions (inv A16.5 / A23 automatable switches and enums) — appended so idx 0–118 keep their meaning
for (const [k, K, def] of [['a', 'A', 1], ['b', 'B', 0]]) add(`${k}.on`, `Osc ${K} On`, 'bool', 0, 1, def, 'bool', 'V', 0, `Osc ${K}`, 'A23 Osc A/B On');
add('n.on', 'Noise On', 'bool', 0, 1, 0, 'bool', 'V', 0, 'Noise', 'A23 Osc N On');
add('s.on', 'Sub On', 'bool', 0, 1, 0, 'bool', 'V', 0, 'Sub', 'A23 Osc S On');
add('f.on', 'Filter On', 'bool', 0, 1, 0, 'bool', 'V', 0, 'Filter', 'A23 Filter On');
for (const [k, K, def] of [['A', 'A', 1], ['B', 'B', 0], ['N', 'Noise', 0], ['S', 'Sub', 0]]) add(`f.route${k}`, `${K}>Filter`, 'bool', 0, 1, def, 'bool', 'V', 0, 'Filter', `A23 Osc${k}>Fil`);
for (const [k, K] of [['a', 'A'], ['b', 'B']]) add(`${k}.track`, `Osc ${K} Pitch Track`, 'bool', 0, 1, 1, 'bool', 'V', 0, `Osc ${K}`, 'A23 Osc' + K + 'PitchTrack');
for (const [k, K] of [['a', 'A'], ['b', 'B']]) add(`${k}.warpMode`, `Osc ${K} Warp Mode`, 'enum', 0, 22, 0, 'enum:WARPS', 'V', 0, `Osc ${K}`, 'A23 WarpOsc' + K);
add('s.shape', 'Sub Shape', 'enum', 0, 4, 0, 'enum:SUB_SHAPES', 'V', 0, 'Sub', 'A23 SubOscShape');
add('s.oct', 'Sub Octave', 'int', -4, 4, 0.5, 'oct', 'V', 1, 'Sub', 'A23 SubOscOctave');
add('f.type', 'Filter Type', 'enum', 0, 95, 1 / 95, 'enum:FILTERS', 'V', 0, 'Filter', 'A23 Fil Type');
for (let e = 1; e <= 3; e++) {
  add(`e${e}.ca`, `Env ${e} Attack Curve`, 'lin', 0, 1, 0.5, 'pct', 'V*', 0, `Env ${e}`, 'A23 A curve' + e);
  add(`e${e}.cd`, `Env ${e} Decay Curve`, 'lin', 0, 1, 0.666, 'pct', 'V*', 0, `Env ${e}`, 'A23 D curve' + e);
  add(`e${e}.cr`, `Env ${e} Release Curve`, 'lin', 0, 1, 0.666, 'pct', 'V*', 0, `Env ${e}`, 'A23 R curve' + e);
}
add('c1.bpm', 'Chaos 1 BPM', 'bool', 0, 1, 0, 'bool', 'V*M', 0, 'Chaos', 'A16.5 Chaos1 BPM');
add('c2.bpm', 'Chaos 2 BPM', 'bool', 0, 1, 0, 'bool', 'V*M', 0, 'Chaos', 'A16.5 Chaos2 BPM');
add('g.wheel', 'Mod Wheel', 'lin', 0, 1, 0, 'pct', 'G', 0, 'Global', 'A16.5 Mod Wheel (matrix-only; base = host wheel)');
add('g.bend', 'Pitch Bend', 'lin', -1, 1, 0.5, 'bip100', 'G', 1, 'Global', 'A16.5 Pitch Bend (matrix-only; base = host bend)');
const NS = D.length;
// ---------------- FX segment ----------------
add('g.master', 'Master Volume', 'pow3', 0, 1, 0.7, 'db', 'M', 0, 'Master', 'A18 Master Volume (state lives in Serum s.p)');
const fxm = (m, grp, rows) => { for (const r of rows) add(`fx.${m}.${r[0]}`, r[1], r[2], r[3], r[4], r[5], r[6], 'M', r[7] || 0, grp, r[8]); };
const LVL = (nm) => ['level', `${nm} Level`, 'pow2', 0, 4, 0.5, 'dbtrim', 0, 'A20.2 LEVEL trim'];
fxm('hyper', 'FX Hyper/Dim', [
  ['on', 'Hyper/Dim Enable', 'bool', 0, 1, 0, 'bool', 0, 'A20.1 Hyp Enable'],
  ['rate', 'Hyper Rate', 'lin', 0, 1, 0.4, 'pct', 0, 'A20.4.1 RATE'],
  ['detune', 'Hyper Detune', 'lin', 0, 1, 0.25, 'pct', 0, 'A20.4.1 DETUNE'],
  ['unison', 'Hyper Unison', 'int', 0, 7, 4 / 7, 'int', 0, 'A20.4.1 UNISON'],
  ['mix', 'Hyper Mix', 'lin', 0, 1, 0.5, 'pct', 0, 'A20.4.1 MIX'],
  LVL('Hyper'),
]);
fxm('dim', 'FX Hyper/Dim', [
  ['size', 'Dimension Size', 'lin', 0, 1, 0.5, 'pct', 0, 'A20.4.1 SIZE'],
  ['mix', 'Dimension Mix', 'lin', 0, 1, 0, 'pct', 0, 'A20.4.1 Dim MIX'],
  LVL('Dimension'),
]);
fxm('dist', 'FX Distortion', [
  ['on', 'Distortion Enable', 'bool', 0, 1, 0, 'bool', 0, 'A20.1 Dist Enable'],
  ['drive', 'Dist Drive', 'lin', 0, 1, 0.25, 'pct', 0, 'A20.4.2 DRIVE'],
  ['lbh', 'Dist LP/BP/HP', 'lin', 0, 1, 0, 'lbh', 0, 'A20.4.2 LP/BP/HP'],
  ['freq', 'Dist Freq', 'exp', MIDI0, MIDI128, 0.5, 'hz', 0, 'A20.4.2 F'],
  ['q', 'Dist Q', 'exp', 0.5, 8, 0.5, 'q01', 0, 'A20.4.2 Q (engine Q = 0.5·16^n)'],
  ['mix', 'Dist Mix', 'lin', 0, 1, 1, 'pct', 0, 'A20.4.2 MIX'],
  LVL('Dist'),
]);
fxm('flg', 'FX Flanger', [
  ['on', 'Flanger Enable', 'bool', 0, 1, 0, 'bool', 0, 'A20.1'],
  ['rate', 'Flanger Rate', 'pow4', 0, 20, 0.25, 'modRate', 0, 'A20.4.3 RATE (ladder MODFX when BPM)'],
  ['depth', 'Flanger Depth', 'lin', 0, 1, 1, 'pct', 0, 'A20.4.3 DEPTH'],
  ['feed', 'Flanger Feed', 'lin', 0, 1, 0.5, 'pct', 0, 'A20.4.3 FEED'],
  ['phase', 'Flanger Phase', 'lin', 0, 360, 0.5, 'deg', 0, 'A20.4.3 PHASE (Flg_Stereo)'],
  ['mix', 'Flanger Mix', 'lin', 0, 1, 1, 'pct', 0, 'A20.4.3 MIX'],
  LVL('Flanger'),
]);
fxm('phs', 'FX Phaser', [
  ['on', 'Phaser Enable', 'bool', 0, 1, 0, 'bool', 0, 'A20.1'],
  ['rate', 'Phaser Rate', 'pow4', 0, 20, 0.25, 'modRate', 0, 'A20.4.4 RATE'],
  ['depth', 'Phaser Depth', 'lin', 0, 1, 0.5, 'pct', 0, 'A20.4.4 DEPTH'],
  ['freq', 'Phaser Freq', 'exp', 20, 18000, 0.5, 'hz', 0, 'A20.4.4 FREQ'],
  ['feed', 'Phaser Feed', 'lin', 0, 1, 0.8, 'pct', 0, 'A20.4.4 FEED'],
  ['phase', 'Phaser Phase', 'lin', 0, 360, 0.5, 'deg', 0, 'A20.4.4 PHASE'],
  ['mix', 'Phaser Mix', 'lin', 0, 1, 1, 'pct', 0, 'A20.4.4 MIX'],
  LVL('Phaser'),
]);
fxm('cho', 'FX Chorus', [
  ['on', 'Chorus Enable', 'bool', 0, 1, 0, 'bool', 0, 'A20.1'],
  ['rate', 'Chorus Rate', 'pow4', 0, 20, 0.25, 'modRate', 0, 'A20.4.5 RATE'],
  ['dly1', 'Chorus Delay 1', 'pow2', 0, 20, 0.5, 'ms', 0, 'A20.4.5 DELAY 1'],
  ['dly2', 'Chorus Delay 2', 'pow2', 0, 20, 0, 'ms', 0, 'A20.4.5 DELAY 2'],
  ['depth', 'Chorus Depth', 'pow2', 0, 26, 1, 'ms', 0, 'A20.4.5 DEPTH'],
  ['feed', 'Chorus Feed', 'lin', 0, 0.95, 0.1, 'pct1', 0, 'A20.4.5 FEED'],
  ['lpf', 'Chorus LPF', 'exp', 50, 20000, 0.5, 'hz', 0, 'A20.4.5 LPF'],
  ['mix', 'Chorus Mix', 'lin', 0, 1, 0.5, 'pct', 0, 'A20.4.5 MIX'],
  LVL('Chorus'),
]);
fxm('dly', 'FX Delay', [
  ['on', 'Delay Enable', 'bool', 0, 1, 0, 'bool', 0, 'A20.1'],
  ['feed', 'Delay Feed', 'lin', 0, 1, 0.4, 'pct', 0, 'A20.4.6 FEED'],
  ['timeL', 'Delay Time L', 'pow4', 1, 501, 0.625, 'dlyTime', 0, 'A20.4.6 LEFT time (ladder DLY when BPM)'],
  ['timeR', 'Delay Time R', 'pow4', 1, 501, 0.625, 'dlyTime', 0, 'A20.4.6 RIGHT time'],
  ['offL', 'Delay Offset L', 'lin', 0.5, 1.5, 0.5, 'xoff', 0, 'A20.4.6 LEFT offset'],
  ['offR', 'Delay Offset R', 'lin', 0.5, 1.5, 0.5, 'xoff', 0, 'A20.4.6 RIGHT offset'],
  ['freq', 'Delay Filter Freq', 'exp', 40, 18000, 0.5, 'hz', 0, 'A20.4.6 F'],
  ['q', 'Delay Filter Q', 'lin', 0.8, 8.2, 6 / 7.4, 'q2', 0, 'A20.4.6 Q (bandwidth, octaves)'],
  ['mix', 'Delay Mix', 'lin', 0, 1, 0.3, 'pct', 0, 'A20.4.6 MIX'],
  LVL('Delay'),
]);
fxm('cmp', 'FX Compressor', [
  ['on', 'Compressor Enable', 'bool', 0, 1, 0, 'bool', 0, 'A20.1'],
  ['thr', 'Comp Threshold', 'rpow3', 1e-6, 1, 0.5, 'db', 0, 'A20.4.7 THRESH (dB = 60·log10(1−n))'],
  ['ratio', 'Comp Ratio', 'ratio', 1, 32, 0.75, 'ratio', 0, 'A20.4.7 RATIO'],
  ['att', 'Comp Attack', 'pow2', 0, 1000, 0.3, 'cmpAtt', 0, 'A20.4.7 ATTACK (floor 0.1 ms; Limit: 0–10 ms look-ahead)'],
  ['rel', 'Comp Release', 'pow2', 0, 1000, 0.3, 'msFloor', 0, 'A20.4.7 RELEASE (floor 0.1 ms)'],
  ['gain', 'Comp Gain', 'pow2', 1, 32, 0, 'db', 0, 'A20.4.7 GAIN (amp 1+31n²)'],
  ['mbL', 'Comp MB Low', 'lin', 0, 2, 0.5, 'pct1', 0, 'A20.4.7 CompMB L'],
  ['mbM', 'Comp MB Mid', 'lin', 0, 2, 0.5, 'pct1', 0, 'A20.4.7 CompMB M'],
  ['mbH', 'Comp MB High', 'lin', 0, 2, 0.5, 'pct1', 0, 'A20.4.7 CompMB H'],
  ['mix', 'Comp Mix', 'lin', 0, 1, 1, 'pct', 0, 'A20.4.7 MIX (default 100 %, see §3.13 note)'],
  LVL('Comp'),
]);
fxm('rev', 'FX Reverb', [
  ['on', 'Reverb Enable', 'bool', 0, 1, 0, 'bool', 0, 'A20.1'],
  ['size', 'Reverb Size', 'lin', 0, 1, 0.33, 'pct', 0, 'A20.4.8 SIZE'],
  ['t', 'Reverb PreDelay / Decay', 'lin', 0, 1, 0.12, 'revT', 0, 'A20.4.8 slot 83'],
  ['locut', 'Reverb Low Cut', 'lin', 0, 1, 0, 'pct', 0, 'A20.4.8 LOW CUT'],
  ['c', 'Reverb Damp / Spin', 'lin', 0, 1, 0.25, 'pct', 0, 'A20.4.8 slot 85 (Hall-era default 25 %)'],
  ['hicut', 'Reverb High Cut', 'lin', 0, 1, 0.5, 'pct', 0, 'A20.4.8 HIGH CUT'],
  ['w', 'Reverb Width / Spin Depth', 'lin', 0, 1, 0.2, 'pct', 0, 'A20.4.8 slot 87 (Hall-era default 20 %)'],
  ['mix', 'Reverb Mix', 'lin', 0, 1, 0.33, 'pct', 0, 'A20.4.8 MIX'],
  LVL('Reverb'),
]);
fxm('eq', 'FX EQ', [
  ['on', 'EQ Enable', 'bool', 0, 1, 0, 'bool', 0, 'A20.1'],
  ['freqL', 'EQ Freq L', 'exp', 21.533, 20000, 0.333, 'hz', 0, 'A20.4.9 FREQ L'],
  ['qL', 'EQ Q L', 'lin', 0, 1, 0.6, 'pct', 0, 'A20.4.9 Q L'],
  ['gainL', 'EQ Gain L', 'lin', -24, 24, 0.5, 'dbv', 1, 'A20.4.9 GAIN L'],
  ['freqH', 'EQ Freq H', 'exp', 21.533, 20000, 0.666, 'hz', 0, 'A20.4.9 FREQ R'],
  ['qH', 'EQ Q H', 'lin', 0, 1, 0.6, 'pct', 0, 'A20.4.9 Q R'],
  ['gainH', 'EQ Gain H', 'lin', -24, 24, 0.5, 'dbv', 1, 'A20.4.9 GAIN R'],
]);
fxm('fil', 'FX Filter', [
  ['on', 'FX Filter Enable', 'bool', 0, 1, 0, 'bool', 0, 'A20.1'],
  ['cutoff', 'FX Filter Cutoff', 'exp', MIDI0, 22050, 0.5, 'hz', 0, 'A20.4.10 CUTOFF'],
  ['res', 'FX Filter Res', 'lin', 0, 1, 0, 'pct', 0, 'A20.4.10 RES'],
  ['drive', 'FX Filter Drive', 'lin', 0, 1, 0, 'pct', 0, 'A20.4.10 DRIVE'],
  ['var', 'FX Filter Var', 'lin', 0, 1, 0, 'var', 0, 'A20.4.10 VAR'],
  ['pan', 'FX Filter Pan', 'lin', 0, 1, 0.5, 'fpan', 1, 'A20.4.10 PAN'],
  ['mix', 'FX Filter Mix', 'lin', 0, 1, 1, 'pct', 0, 'A20.4.10 MIX'],
  LVL('FX Filter'),
]);
// v2 additions: automatable FX switches/enums (inv A20.3) — appended so fx idx 0–85 keep their meaning
add('g.bypass', 'Bypass', 'bool', 0, 1, 0, 'bool', 'M', 0, 'Master', 'A16.5 Bypass (state lives in Serum s.p; matrix-only)');
fxm('hyper', 'FX Hyper/Dim', [['retrig', 'Hyper Retrig', 'bool', 0, 1, 0, 'bool', 0, 'A20.3 Hyp Retrig']]);
fxm('dist', 'FX Distortion', [
  ['mode', 'Dist Mode', 'enum', 0, 15, 0, 'enum:DIST_MODES', 0, 'A20.3 Dist_Mode'],
  ['filt', 'Dist Pre/Post', 'enum', 0, 2, 0, 'enum:DIST_FILTER', 0, 'A20.3 Dist_PrePost'],
]);
fxm('flg', 'FX Flanger', [['bpm', 'Flanger BPM', 'bool', 0, 1, 0, 'bool', 0, 'A20.3 Flg BPM']]);
fxm('phs', 'FX Phaser', [['bpm', 'Phaser BPM', 'bool', 0, 1, 0, 'bool', 0, 'A20.3 Phs BPM']]);
fxm('cho', 'FX Chorus', [['bpm', 'Chorus BPM', 'bool', 0, 1, 0, 'bool', 0, 'A20.3 Cho BPM']]);
fxm('dly', 'FX Delay', [
  ['bpm', 'Delay BPM', 'bool', 0, 1, 1, 'bool', 0, 'A20.3 Dly BPM'],
  ['link', 'Delay Link', 'bool', 0, 1, 0, 'bool', 0, 'A20.3 Dly Link'],
  ['mode', 'Delay Mode', 'enum', 0, 2, 0, 'enum:DLY_MODES', 0, 'A20.3 Dly Mode'],
]);
fxm('cmp', 'FX Compressor', [['mb', 'Comp Multiband', 'bool', 0, 1, 0, 'bool', 0, 'A20.3 CmpMBnd']]);
fxm('eq', 'FX EQ', [
  ['typeL', 'EQ Type L', 'enum', 0, 2, 0, 'enum:EQ_TYPES_L', 0, 'A20.3 EQ TypL'],
  ['typeH', 'EQ Type H', 'enum', 0, 2, 0, 'enum:EQ_TYPES_H', 0, 'A20.3 EQ TypH'],
]);
fxm('fil', 'FX Filter', [['type', 'FX Filter Type', 'enum', 0, 95, 0, 'enum:FILTERS', 0, 'A20.3 FX Fil Type']]);
const ND = D.length, NF = ND - NS;

// exact-fraction printing for defaults on stepped laws (k / (hi − lo)), 6 significant digits otherwise
const stepped = (law) => law === 'int' || law === 'enum' || law === 'bool';
function defStr(d) {
  if (stepped(d.law)) {
    const m = d.hi - d.lo, k = Math.round(d.def * m);
    if (Math.abs(k / m - d.def) > 1e-12) throw new Error('off-grid default ' + d.id);
    if (k === 0) return '0'; if (k === m) return '1';
    const g = (a, b) => (b ? g(b, a % b) : a), q = g(k, m);
    const dec = k / m;
    return Number.isInteger(dec * 1e6) ? String(dec) : `${k / q}/${m / q}`;
  }
  if (d.id === 'fx.dly.q') return '6/7.4';
  return (+d.def.toPrecision(6)).toString();
}
const num = (x) => (Math.abs(x - MIDI0) < 1e-9 ? '8.1758¹' : Math.abs(x - MIDI128) < 1e-6 ? '13289.75²' : Number.isInteger(x) ? String(x) : (+x.toPrecision(6)).toString());
let md = `| idx | fx idx | id | label | law | lo | hi | def n | fmt | scope | ctr | group | inventory |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
D.forEach((d, i) => { md += `| ${i} | ${i >= NS ? i - NS : ''} | \`${d.id}\` | ${d.label} | ${d.law} | ${num(d.lo)} | ${num(d.hi)} | ${defStr(d)} | ${d.fmt} | ${d.scope} | ${d.ctr ? 'C' : ''} | ${d.group} | ${d.ref} |\n`; });
out('dest.md', md);
out('dest.json', JSON.stringify({ NS, NF, ND, D }, null, 0));
out('fixtures/dests.json', JSON.stringify({ NS, NF, ND, DESTS: D.map(d => ({ id: d.id, label: d.label, law: d.law, lo: d.lo, hi: d.hi, def: d.def, fmt: d.fmt, scope: d.scope, ctr: d.ctr, group: d.group, ref: d.ref })) }, null, 1));
console.log('NS', NS, 'NF', NF, 'ND', ND);

/* ---------------- filters ---------------- */
const F = [];
const fa = (name, id, cat, varLabel, family, hint) => F.push({ id, name, cat, varLabel, family, hint });
for (const n of [6, 12, 18, 24]) fa(`MG Low ${n}`, `mg_low${n}`, 'Normal', 'FAT', 'ladder', `${n / 6} ladder stage(s) tapped (${n} dB/oct); tanh per stage; FAT = tanh drive in the resonance feedback`);
for (const n of [6, 12, 18, 24]) fa(`Low ${n}`, `low${n}`, 'Normal', 'FAT', 'svf', n === 6 ? 'TPT one-pole LP (res ignored)' : n === 12 ? 'TPT SVF LP' : n === 18 ? 'SVF LP → one-pole LP' : 'SVF LP → SVF LP');
for (const n of [6, 12, 18, 24]) fa(`High ${n}`, `high${n}`, 'Normal', 'FAT', 'svf', n === 6 ? 'TPT one-pole HP (res ignored)' : n === 12 ? 'TPT SVF HP' : n === 18 ? 'SVF HP → one-pole HP' : 'SVF HP → SVF HP');
for (const n of [12, 24]) fa(`Band ${n}`, `band${n}`, 'Normal', 'FAT', 'svf', n === 12 ? 'SVF BP (unity peak)' : 'SVF BP → SVF BP');
for (const n of [12, 24]) fa(`Peak ${n}`, `peak${n}`, 'Normal', 'FAT', 'svf', n === 12 ? 'SVF peak = x + 2k·bp·res-gain (boost at fc)' : 'peak → peak');
for (const n of [12, 24]) fa(`Notch ${n}`, `notch${n}`, 'Normal', 'FAT', 'svf', n === 12 ? 'SVF notch = lp + hp' : 'notch → notch');
fa('LH 6', 'lh6', 'Multi', 'FREQ', 'dual', 'one-pole LP @cutoff → one-pole HP @f2');
fa('LH 12', 'lh12', 'Multi', 'FREQ', 'dual', 'SVF LP @cutoff → SVF HP @f2');
for (const [p, s] of [['L', 'B'], ['L', 'P'], ['L', 'N'], ['H', 'B'], ['H', 'P'], ['H', 'N'], ['B', 'P'], ['B', 'N'], ['P', 'P'], ['P', 'N'], ['N', 'N']]) fa(`${p}${s} 12`, `${p}${s}12`.toLowerCase(), 'Multi', 'FREQ', 'dual', `SVF ${p} @cutoff → SVF ${s} @f2 (series, shared res)`);
for (const [a, b, c] of [['L', 'B', 'H'], ['L', 'P', 'H'], ['L', 'N', 'H'], ['B', 'P', 'N']]) for (const n of [12, 24]) fa(`${a}/${b}/${c} ${n}`, `${a}${b}${c}${n}`.toLowerCase(), 'Multi', 'MORPH', 'morph', `SVF${n === 24 ? '×2' : ''} output blend ${a}→${b} (var 0..0.5) → ${c} (0.5..1)`);
for (const [pre, fam] of [['Cmb', 'comb'], ['Flg', 'flange']]) {
  for (const pol of ['+', '-']) fa(`${pre} ${pol}`, `${pre.toLowerCase()}_${pol === '+' ? 'p' : 'n'}`, 'Flanges', 'FAT', fam, `${fam === 'comb' ? 'feedback comb' : 'flanger (x + comb)/2'}, delay = 1/cutoff, ${pol === '+' ? 'positive' : 'negative'} feedback = res`);
  for (const [t, v, h] of [['L6', 'LP FREQ', 'one-pole LP @f_var in loop'], ['H6', 'HP FREQ', 'one-pole HP @f_var in loop'], ['HL6', 'HL WID', 'HP @cutoff·2^-w and LP @cutoff·2^w in loop']]) for (const pol of ['+', '-']) fa(`${pre} ${t}${pol}`, `${pre.toLowerCase()}_${t.toLowerCase()}${pol === '+' ? 'p' : 'n'}`, 'Flanges', v, fam, `as ${pre} ${pol}; ${h}`);
}
for (const o of [12, 24, 36, 48]) for (const pol of ['+', '-']) fa(`Phs ${o}${pol}`, `phs${o}${pol === '+' ? 'p' : 'n'}`, 'Flanges', 'FAT', 'phaser', `${o / 3} first-order allpasses @cutoff, ${pol === '+' ? '+' : '−'}feedback = res, out = (x+ap)/2`);
for (const [t, v, h] of [['L6', 'LP FREQ', 'LP @f_var in loop'], ['H6', 'HP FREQ', 'HP @f_var in loop'], ['HL6', 'HL WID', 'HP/LP pair around cutoff in loop']]) for (const pol of ['+', '-']) fa(`Phs 48${t}${pol}`, `phs48${t.toLowerCase()}${pol === '+' ? 'p' : 'n'}`, 'Flanges', v, 'phaser', `16 allpasses; ${h}`);
for (const pol of ['+', '-']) fa(`FPhs 12HL6${pol}`, `fphs12hl6${pol === '+' ? 'p' : 'n'}`, 'Flanges', 'HL WID', 'fphs', 'comb (1/cutoff) whose loop holds 4 allpasses + HL6 pair');
fa('Low EQ 6', 'loweq6', 'Misc', 'DB', 'eq', '1st-order low shelf @cutoff, gain from var (0 → −96 dB = HP)');
fa('Low EQ 12', 'loweq12', 'Misc', 'DB', 'eq', 'RBJ low shelf, Q = 0.5+4·res');
fa('Band EQ 12', 'bandeq12', 'Misc', 'DB', 'eq', 'RBJ peaking, Q = 0.5+9.5·res');
fa('High EQ 6', 'higheq6', 'Misc', 'DB', 'eq', '1st-order high shelf (0 → LP)');
fa('High EQ 12', 'higheq12', 'Misc', 'DB', 'eq', 'RBJ high shelf, Q = 0.5+4·res');
fa('Ring Mod', 'ringmod', 'Misc', '', 'ring', 'x·sin(2π·cutoff·t); custom display');
fa('Ring Modx2', 'ringmod2', 'Misc', 'SPREAD', 'ring', '½x·(sin(2πf(1+s)t)+sin(2πf(1−s)t)), s = 0.5·var; custom display');
fa('SampHold', 'samphold', 'Misc', '', 'snh', 'hold input at rate = cutoff; custom display');
fa('SampHold-', 'samphold_n', 'Misc', '', 'snh', 'x − held; custom display');
fa('Combs', 'combs', 'Misc', 'DAMP', 'bank', '6 parallel feedback combs at cutoff·[1,1.5,2,2.5,3,4] (R ×1.007), fb = 0.97·res, LP damping in loop; voice-filter MIX forced to 1 (inv A11.1)');
fa('Allpasses', 'allpasses', 'Misc', 'DAMP', 'bank', '6 series Schroeder allpasses, delays (fs/cutoff)·[1,.77,.59,.45,.34,.26], g = 0.5+0.45·res');
fa('Reverb', 'reverb', 'Misc', 'DAMP', 'bank', '4-line Hadamard FDN, lengths (fs/cutoff)·[1,1.33,1.57,1.91], fb = 0.5+0.49·res');
fa('French LP', 'french_lp', 'Misc', 'BOEUF', 'french', 'saturating 4-pole ladder ×2 drive + BP @2·cutoff fed back (amount var)');
fa('German LP', 'german_lp', 'Misc', '', 'german', 'linear ZDF 4-pole ladder, res to self-oscillation');
fa('Add Bass', 'add_bass', 'Misc', 'THRU', 'addbass', 'tanh(1.5·SVF-LP) + var·(1st-order allpass of x @cutoff)');
fa('Formant-I', 'formant1', 'Misc', 'FORMNT', 'formant', '3 parallel BP (table I), cutoff picks vowel, var shifts ×2^(2·var)');
fa('Formant-II', 'formant2', 'Misc', 'FORMNT', 'formant', 'table II');
fa('Formant-III', 'formant3', 'Misc', 'FORMNT', 'formant', 'table III');
fa('Bandreject', 'bandreject', 'Misc', 'WIDTH', 'breject', 'x − BP(x), bandwidth 0.1..4 oct from var, res narrows');
fa('Dist.Comb 1 LP', 'distcomb1_lp', 'Misc', 'COMBFRQ', 'distcomb', 'SVF LP; comb (f = cutoff·2^(4(var−.5))) + tanh in feedback, +fb');
fa('Dist.Comb 1 BP', 'distcomb1_bp', 'Misc', 'COMBFRQ', 'distcomb', 'SVF BP; +fb');
fa('Dist.Comb 2 LP', 'distcomb2_lp', 'Misc', 'COMBFRQ', 'distcomb', 'SVF LP; −fb');
fa('Dist.Comb 2 BP', 'distcomb2_bp', 'Misc', 'COMBFRQ', 'distcomb', 'SVF BP; −fb');
fa('Scream LP', 'scream_lp', 'Misc', 'SCREAM', 'scream', 'SVF LP + feedback loop: one-pole LP @f_var, gain 2+30·drive², tanh, ×res');
fa('Scream BP', 'scream_bp', 'Misc', 'SCREAM', 'scream', 'SVF BP + same loop');
let fm = `| # | id | name | category | Var label | family | recipe hint |\n|---|---|---|---|---|---|---|\n`;
F.forEach((f, i) => { fm += `| ${i} | \`${f.id}\` | ${f.name} | ${f.cat} | ${f.varLabel || '—'} | ${f.family} | ${f.hint} |\n`; });
out('filters.md', fm);
out('filters.json', JSON.stringify(F));
out('fixtures/filters.json', JSON.stringify({ FILTERS: F }, null, 1));
console.log('filters', F.length, 'families', [...new Set(F.map(f => f.family))].join(','));
