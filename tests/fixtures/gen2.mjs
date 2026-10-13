// Generates the Phase-2 index fixtures (SPEC-serum2 §3.10, §3.11, §15.2; owner C1) next to this file:
//   dests2.json   = { NS, NV1, NF1, NS2, ND, NSV, DESTS } — rows 0–247 copied from dests.json (the v1 table, unchanged),
//                   rows 248–528 from the normative §3.11.2 builder transcribed below (same row format as dests.json)
//   sources2.json = { NSRC, SOURCES } — the §3.10 source table (indices 0–33 Phase 1, 34–61 Serum 2)
// Independent of serum-core.js on purpose: tests/serum-core.test.mjs checks DESTS / SOURCES against these files and that
// this script reproduces them byte for byte. Run: node tests/fixtures/gen2.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const here = f => new URL(f, import.meta.url);
const MIDI0 = 440 * Math.pow(2, -69 / 12);        // 8.175798915643707 Hz (MIDI note 0)
const REF = 'SPEC-serum2 §3.11.2';

/* ---------------- destinations ---------------- */
const v1 = JSON.parse(readFileSync(here('dests.json'), 'utf8'));
const D = v1.DESTS.map(d => Object.assign({}, d));
const add = (id, label, law, lo, hi, def, fmt, scope, ctr, group) => D.push({ id, label, law, lo, hi, def, fmt, scope, ctr: ctr ? 1 : 0, group, ref: REF });
const OSC_ROWS_V1 = v1.DESTS.slice(0, 17).map(d => ({ id: k => k + d.id.slice(1), label: K => 'Osc ' + K + d.label.slice(5), law: d.law, lo: d.lo,
  hi: d.hi, def: d.def, fmt: d.fmt, scope: d.scope, ctr: d.ctr }));
// Block C — OSC C base (idx 248–266): the 17 Phase-1 per-oscillator rows with k='c', K='C', then:
for (const r of OSC_ROWS_V1) add(r.id('c'), r.label('C'), r.law, r.lo, r.hi, r.def, r.fmt, r.scope, r.ctr, 'Osc C');
add('c.on', 'Osc C On', 'bool', 0, 1, 0, 'bool', 'V', 0, 'Osc C');
add('c.track', 'Osc C Pitch Track', 'bool', 0, 1, 1, 'bool', 'V', 0, 'Osc C');
// Block O2 — per oscillator a, b, c (51 rows each; idx 267–317 a, 318–368 b, 369–419 c)
for (const [k, K] of [['a', 'A'], ['b', 'B'], ['c', 'C']]) {
  const g = `Osc ${K}`, gs = `Osc ${K} Sample`, gg = `Osc ${K} Granular`, gp = `Osc ${K} Spectral`, gm = `Osc ${K} Multisample`;
  add(`${k}.w1`, `Osc ${K} Warp 1 Mode`, 'enum', 0, 81, 0, 'enum:WARPS2', 'V', 0, g);
  add(`${k}.w2`, `Osc ${K} Warp 2 Mode`, 'enum', 0, 81, 0, 'enum:WARPS2', 'V', 0, g);
  add(`${k}.warp2`, `Osc ${K} Warp 2`, 'lin', 0, 1, 0, 'pct', 'V', 0, g);
  add(`${k}.wvar1`, `Osc ${K} Warp 1 Var`, 'lin', 0, 1, 0, 'pct', 'V', 0, g);
  add(`${k}.wvar2`, `Osc ${K} Warp 2 Var`, 'lin', 0, 1, 0, 'pct', 'V', 0, g);
  add(`${k}.uniwarp2`, `Osc ${K} Uni Warp 2`, 'lin', -1, 1, 0.5, 'bip100', 'V', 1, g);
  add(`${k}.ratio`, `Osc ${K} Ratio`, 'exp', 0.0625, 16, 0.5, 'ratio2', 'V', 0, g);
  add(`${k}.hz`, `Osc ${K} Hz Offset`, 'lin', -50, 50, 0.5, 'hzoff', 'V', 1, g);
  add(`${k}.sstart`, `Osc ${K} Sample Start`, 'lin', 0, 1, 0, 'smpPos', 'V*', 0, gs);
  add(`${k}.send`, `Osc ${K} Sample End`, 'lin', 0, 1, 1, 'smpPos', 'V', 0, gs);
  add(`${k}.lstart`, `Osc ${K} Loop Start`, 'lin', 0, 1, 0, 'smpPos', 'V', 0, gs);
  add(`${k}.lend`, `Osc ${K} Loop End`, 'lin', 0, 1, 1, 'smpPos', 'V', 0, gs);
  add(`${k}.xfade`, `Osc ${K} Loop X-Fade`, 'lin', 0, 1, 0, 'pct', 'V', 0, gs);
  add(`${k}.scan`, `Osc ${K} Scan`, 'lin', -1, 1, 0.75, 'scan', 'V', 1, gs);
  add(`${k}.scanrev`, `Osc ${K} Scan Reverse`, 'bool', 0, 1, 0, 'bool', 'V', 0, gs);
  add(`${k}.pos`, `Osc ${K} Position`, 'lin', 0, 1, 0, 'smpPos', 'V', 0, gs);
  add(`${k}.slice`, `Osc ${K} Single Slice`, 'int', 0, 255, 0, 'slice', 'V*', 0, gs);
  add(`${k}.gy`, `Osc ${K} X|Y Y`, 'lin', 0, 1, 0.5, 'pct', 'V', 0, gg);
  add(`${k}.dens`, `Osc ${K} Density`, 'lin', 0, 1, 0.6, 'dens', 'V', 0, gg);
  add(`${k}.glen`, `Osc ${K} Grain Length`, 'lin', 0, 1, 0.5, 'glen', 'V', 0, gg);
  add(`${k}.wamt`, `Osc ${K} Window Amount`, 'lin', 0, 1, 1, 'pct', 'V', 0, gg);
  add(`${k}.wskew`, `Osc ${K} Window Skew`, 'lin', -1, 1, 0.5, 'bip100', 'V', 1, gg);
  for (const [id, lb, hi, fmt] of [['roff', 'Rand Offset', 1, 'pct'], ['rdir', 'Rand Dir', 1, 'pct'], ['rpitch', 'Rand Pitch', 12, 'st2'],
    ['rlen', 'Rand Length', 1, 'pct'], ['rpan', 'Rand Pan', 1, 'pct'], ['rlvl', 'Rand Level', 1, 'pct'], ['rwamt', 'Rand Window', 1, 'pct'],
    ['rwskew', 'Rand Skew', 1, 'pct'], ['rwarp', 'Rand Warp', 1, 'pct'], ['rwarp2', 'Rand Warp 2', 1, 'pct']]) {
    add(`${k}.${id}`, `Osc ${K} ${lb}`, 'lin', 0, hi, 0, fmt, 'V', 0, gg);
  }
  add(`${k}.grev`, `Osc ${K} Reverse Grains`, 'bool', 0, 1, 0, 'bool', 'V', 0, gg);
  add(`${k}.flo`, `Osc ${K} Freq Lo`, 'exp', MIDI0, 22050, 0, 'hz', 'V', 0, gp);
  add(`${k}.fhi`, `Osc ${K} Freq Hi`, 'exp', MIDI0, 22050, 1, 'hz', 'V', 0, gp);
  add(`${k}.cut`, `Osc ${K} Spectral Cut`, 'lin', -1, 1, 0.5, 'bip100', 'V', 1, gp);
  add(`${k}.smix`, `Osc ${K} Spectral Mix`, 'lin', 0, 1, 1, 'pct', 'V', 0, gp);
  for (const [id, lb, law, hi, def, fmt] of [['mdly', 'MS Delay', 'pow5', 32, 0, 'time'], ['matt', 'MS Attack', 'pow5', 32, 0.11, 'time'],
    ['mhold', 'MS Hold', 'pow5', 32, 0, 'time'], ['mdec', 'MS Decay', 'pow5', 32, 0.5, 'time'], ['msus', 'MS Sustain', 'lin', 1, 1, 'pct'],
    ['mrel', 'MS Release', 'pow5', 32, 0.215, 'time']]) {
    add(`${k}.${id}`, `Osc ${K} ${lb}`, law, 0, hi, def, fmt, 'V*', 0, gm);
  }
  add(`${k}.mvel`, `Osc ${K} Vel Track`, 'lin', 0, 1, 1, 'pct', 'V*', 0, gm);
  add(`${k}.mrand`, `Osc ${K} MS Rand`, 'lin', 0, 1, 0, 'pct', 'V*', 0, gm);
  add(`${k}.timbre`, `Osc ${K} Timbre`, 'lin', -64, 64, 0.5, 'st1', 'V*', 1, gm);
  add(`${k}.ustart`, `Osc ${K} Uni Rand Start`, 'lin', 0, 1, 0, 'pct', 'V*', 0, g);
  add(`${k}.uspan`, `Osc ${K} Uni Span`, 'lin', 0, 1, 0, 'pct', 'V*', 0, g);
  add(`${k}.fbal`, `Osc ${K} Filter Balance`, 'lin', -1, 1, 0, 'fbal', 'V', 1, g);
  add(`${k}.bus1`, `Osc ${K} Bus 1`, 'pow2', 0, 1, 0, 'pct', 'V', 0, g);
  add(`${k}.bus2`, `Osc ${K} Bus 2`, 'pow2', 0, 1, 0, 'pct', 'V', 0, g);
}
// Sub (420–426), Noise (427–431)
add('s.shp', 'Sub Shape', 'enum', 0, 5, 0, 'enum:SUB_SHAPES2', 'V', 0, 'Sub');
add('s.crs', 'Sub Coarse', 'lin', -64, 64, 0.5, 'crs', 'V', 1, 'Sub');
add('s.phase', 'Sub Phase', 'lin', 0, 360, 0, 'deg', 'V*', 0, 'Sub');
add('s.track', 'Sub Pitch Track', 'bool', 0, 1, 1, 'bool', 'V', 0, 'Sub');
add('s.fbal', 'Sub Filter Balance', 'lin', -1, 1, 0, 'fbal', 'V', 1, 'Sub');
add('s.bus1', 'Sub Bus 1', 'pow2', 0, 1, 0, 'pct', 'V', 0, 'Sub');
add('s.bus2', 'Sub Bus 2', 'pow2', 0, 1, 0, 'pct', 'V', 0, 'Sub');
add('n.stereo', 'Noise Stereo', 'lin', 0, 1, 1, 'pct', 'V', 0, 'Noise');
add('n.color', 'Noise Filter', 'lin', -1, 1, 0.5, 'bip100', 'V', 1, 'Noise');
add('n.fbal', 'Noise Filter Balance', 'lin', -1, 1, 0, 'fbal', 'V', 1, 'Noise');
add('n.bus1', 'Noise Bus 1', 'pow2', 0, 1, 0, 'pct', 'V', 0, 'Noise');
add('n.bus2', 'Noise Bus 2', 'pow2', 0, 1, 0, 'pct', 'V', 0, 'Noise');
// Filter 1 extensions (432–438)
add('f.type2', 'Filter 1 Type', 'enum', 0, 107, 1 / 107, 'enum:FILTERS', 'V', 0, 'Filter');
add('f.level', 'Filter 1 Level', 'pow2', 0, 4, 0.5, 'dbtrim', 'V', 0, 'Filter');
add('f.routeC', 'C>Filter', 'bool', 0, 1, 1, 'bool', 'V', 0, 'Filter');
add('f.x', 'Filter 1 X', 'lin', 0, 1, 0, 'pct', 'V', 0, 'Filter');
add('f.y', 'Filter 1 Y', 'lin', 0, 1, 0, 'pct', 'V', 0, 'Filter');
add('f.bus1', 'Filter 1 Bus 1', 'pow2', 0, 1, 0, 'pct', 'V', 0, 'Filter');
add('f.bus2', 'Filter 1 Bus 2', 'pow2', 0, 1, 0, 'pct', 'V', 0, 'Filter');
// Filter 2 (439–456)
add('f2.on', 'Filter 2 On', 'bool', 0, 1, 0, 'bool', 'V', 0, 'Filter 2');
add('f2.type', 'Filter 2 Type', 'enum', 0, 107, 1 / 107, 'enum:FILTERS', 'V', 0, 'Filter 2');
add('f2.cutoff', 'Filter 2 Cutoff', 'exp', MIDI0, 22050, 0.5, 'hz', 'V', 0, 'Filter 2');
add('f2.res', 'Filter 2 Res', 'lin', 0, 1, 0.1, 'pct', 'V', 0, 'Filter 2');
add('f2.drive', 'Filter 2 Drive', 'lin', 0, 1, 0, 'pct', 'V', 0, 'Filter 2');
add('f2.var', 'Filter 2 Var', 'lin', 0, 1, 0, 'var', 'V', 0, 'Filter 2');
add('f2.mix', 'Filter 2 Mix', 'lin', 0, 1, 1, 'pct', 'V', 0, 'Filter 2');
add('f2.pan', 'Filter 2 Pan', 'lin', 0, 1, 0.5, 'fpan', 'V', 1, 'Filter 2');
add('f2.level', 'Filter 2 Level', 'pow2', 0, 4, 0.5, 'dbtrim', 'V', 0, 'Filter 2');
for (const [s, S] of [['A', 'A'], ['B', 'B'], ['C', 'C'], ['N', 'Noise'], ['S', 'Sub']]) add(`f2.route${s}`, `${S}>Filter 2`, 'bool', 0, 1, 1, 'bool', 'V', 0, 'Filter 2');
add('f2.x', 'Filter 2 X', 'lin', 0, 1, 0, 'pct', 'V', 0, 'Filter 2');
add('f2.y', 'Filter 2 Y', 'lin', 0, 1, 0, 'pct', 'V', 0, 'Filter 2');
add('f2.bus1', 'Filter 2 Bus 1', 'pow2', 0, 1, 0, 'pct', 'V', 0, 'Filter 2');
add('f2.bus2', 'Filter 2 Bus 2', 'pow2', 0, 1, 0, 'pct', 'V', 0, 'Filter 2');
// ENV 4 and Start/End (457–470)
add('e4.att', 'Env 4 Attack', 'pow5', 0, 32, 0.11, 'time', 'V*', 0, 'Env 4');
add('e4.hold', 'Env 4 Hold', 'pow5', 0, 32, 0, 'time', 'V*', 0, 'Env 4');
add('e4.dec', 'Env 4 Decay', 'pow5', 0, 32, 0.5, 'time', 'V*', 0, 'Env 4');
add('e4.sus', 'Env 4 Sustain', 'lin', 0, 1, 1, 'pct', 'V*', 0, 'Env 4');
add('e4.rel', 'Env 4 Release', 'pow5', 0, 32, 0.215, 'time', 'V*', 0, 'Env 4');
add('e4.ca', 'Env 4 Attack Curve', 'lin', 0, 1, 0.5, 'pct', 'V*', 0, 'Env 4');
add('e4.cd', 'Env 4 Decay Curve', 'lin', 0, 1, 0.666, 'pct', 'V*', 0, 'Env 4');
add('e4.cr', 'Env 4 Release Curve', 'lin', 0, 1, 0.666, 'pct', 'V*', 0, 'Env 4');
for (const e of [2, 3, 4]) {
  add(`e${e}.start`, `Env ${e} Start`, 'lin', 0, 1, 0, 'db', 'V*', 0, `Env ${e}`);   // 0 → '-inf dB' (inv B15)
  add(`e${e}.end`, `Env ${e} End`, 'lin', 0, 1, 0, 'db', 'V*', 0, `Env ${e}`);
}
// LFO 9, 10 and PHASE of LFO 1–10 (471–488)
for (const l of [9, 10]) {
  const g = `LFO ${l}`;
  add(`l${l}.rate`, `LFO ${l} Rate`, 'pow4', 0, 100, 0.5, 'lfoRate', 'V*M', 0, g);
  add(`l${l}.rise`, `LFO ${l} Rise`, 'lin', 0, 4, 0, 'lfoTime', 'V*', 0, g);
  add(`l${l}.delay`, `LFO ${l} Delay`, 'lin', 0, 4, 0, 'lfoTime', 'V*', 0, g);
  add(`l${l}.smooth`, `LFO ${l} Smooth`, 'lin', 0, 1, 0, 'pct', 'V*M', 0, g);
}
for (let l = 1; l <= 10; l++) add(`l${l}.phase`, `LFO ${l} Phase`, 'lin', 0, 360, 0, 'deg', 'V*M', 0, `LFO ${l}`);
// Macros as destinations (489–496) — VIRTUAL (base = s.macros[m].v)
for (let m = 1; m <= 8; m++) add(`m${m}`, `Macro ${m}`, 'lin', 0, 1, 0, 'pct', 'G', 0, 'Macros');
// Voice Control (497–502)
add('vc.pan', 'VC Rand Pan', 'lin', 0, 1, 0, 'pct', 'V*', 0, 'Voice Control');
add('vc.det', 'VC Rand Detune', 'lin', 0, 1, 0, 'pct', 'V*', 0, 'Voice Control');
add('vc.cut', 'VC Rand Cutoff', 'lin', 0, 1, 0, 'pct', 'V*', 0, 'Voice Control');
add('vc.env', 'VC Rand Envs', 'lin', 0, 1, 0, 'pct', 'V*', 0, 'Voice Control');
add('vc.escale', 'VC Env Scale', 'exp', 0.25, 4, 0.5, 'vcScale', 'V*', 0, 'Voice Control');
add('vc.lscale', 'VC LFO Scale', 'exp', 0.25, 4, 0.5, 'vcScale', 'V*M', 0, 'Voice Control');
// Mixer processor gains (503–505)
add('g.direct', 'Direct Level', 'pow2', 0, 4, 0.5, 'dbtrim', 'M', 0, 'Mixer');
add('g.bus1v', 'Bus 1 Level', 'pow2', 0, 4, 0.5, 'dbtrim', 'M', 0, 'Mixer');
add('g.bus2v', 'Bus 2 Level', 'pow2', 0, 4, 0.5, 'dbtrim', 'M', 0, 'Mixer');
// Arpeggiator (506–519): arp.on stored; the rest VIRTUAL (base = playing slot's n.*)
add('arp.on', 'Arp Enable', 'bool', 0, 1, 0, 'bool', 'G', 0, 'Arp');
add('arp.rate', 'Arp Rate', 'lin', 0, 1, 0.75, 'arpRate', 'G', 0, 'Arp');
add('arp.shift', 'Arp Shift', 'int', -24, 24, 0.75, 'st', 'G', 1, 'Arp');
add('arp.range', 'Arp Range', 'int', 1, 8, 0, 'int', 'G', 0, 'Arp');
add('arp.offset', 'Arp Offset', 'int', 0, 15, 0, 'int', 'G', 0, 'Arp');
add('arp.repeats', 'Arp Repeats', 'int', 0, 16, 0, 'inf0', 'G', 0, 'Arp');
add('arp.gate', 'Arp Gate', 'lin', 0, 2, 0.375, 'pct1', 'G', 0, 'Arp');
add('arp.chance', 'Arp Chance', 'lin', 0, 1, 1, 'pct', 'G', 0, 'Arp');
add('arp.rrate', 'Arp Retrig Rate', 'enum', 0, 5, 0.4, 'enum:RRATE_LADDER', 'G', 0, 'Arp');
add('arp.vdecay', 'Arp Velo Decay', 'lin', -1, 1, 0.5, 'bip100', 'G', 1, 'Arp');
add('arp.vtarget', 'Arp Velo Target', 'lin', 0, 1, 0.5, 'pct', 'G', 0, 'Arp');
add('arp.trans', 'Arp Transpose', 'int', -24, 24, 0.5, 'st', 'G', 1, 'Arp');
add('arp.wtrans', 'Arp Wrap Transpose', 'int', 0, 24, 0.5, 'st', 'G', 0, 'Arp');
add('arp.wrange', 'Arp Wrap Range', 'int', 0, 8, 0, 'int', 'G', 0, 'Arp');
// Clip player (520–523): clip.on stored; the rest VIRTUAL (base = playing clip's n.*)
add('clip.on', 'Clip Player Enable', 'bool', 0, 1, 0, 'bool', 'G', 0, 'Clip');
add('clip.trans', 'Clip Transpose', 'int', -24, 24, 0.5, 'st', 'G', 1, 'Clip');
add('clip.rate', 'Clip Rate', 'enum', 0, 10, 0.5, 'enum:CLIP_RATES', 'G', 0, 'Clip');
add('clip.offset', 'Clip Offset', 'lin', 0, 1, 0, 'pct', 'G', 0, 'Clip');
// Review round 2 appendix (524–528) — appended, never reordered
for (const [k, K] of [['a', 'A'], ['b', 'B'], ['c', 'C']]) {      // Sample Length to BPM RATE (inv B6 "Scan BPM Rate")
  add(`${k}.lenrate`, `Osc ${K} Scan BPM Rate`, 'enum', 0, 14, 5 / 14, 'enum:LEN_LADDER', 'V', 0, `Osc ${K} Sample`);
}
add('g.bu2', 'Pitch Bend Up', 'int', 0, 48, 2 / 48, 'st', 'V', 0, 'Global');          // S2 bend ranges (inv B19), outside S1 mode
add('g.bd2', 'Pitch Bend Down', 'int', -48, 0, 46 / 48, 'st', 'V', 0, 'Global');   // labels unique vs the v1 rows

const ND = D.length, NS = 148, NV1 = 248, NF1 = 100, NS2 = ND - NV1, NSV = NS + NS2;
if (ND !== 529 || NS2 !== 281 || NSV !== 429) throw new Error(`dests2: ND ${ND}, NS2 ${NS2}, NSV ${NSV}`);
writeFileSync(here('dests2.json'), JSON.stringify({ NS, NV1, NF1, NS2, ND, NSV, DESTS: D }, null, 1));

/* ---------------- sources (§3.10) ---------------- */
const S = [{ id: '', label: '(none)', pol: '', scope: '', tile: 0 }];
const src = (id, label, pol, scope, tile) => S.push({ id, label, pol, scope, tile: tile ? 1 : 0 });
src('wheel', 'Mod Wheel', 'uni', 'G', 1);
for (let e = 1; e <= 3; e++) src('env' + e, 'Env ' + e, 'uni', 'V', 1);
for (let l = 1; l <= 8; l++) src('lfo' + l, 'LFO ' + l, 'uni', 'V/G', 1);
src('velo', 'Velocity', 'uni', 'V', 1);
src('note', 'Note', 'uni', 'V', 1);
src('at', 'Aftertouch', 'uni', 'G');
src('pat', 'Poly AT', 'uni', 'V');
src('chaos1', 'Chaos 1', 'bi', 'V/G');
src('chaos2', 'Chaos 2', 'bi', 'V/G');
src('noise', 'Noise Osc', 'bi', 'V');
src('rand1', 'NoteOn Rand 1', 'uni', 'V');
src('rand2', 'NoteOn Rand 2', 'uni', 'V');
src('alt1', 'NoteOn Alt', 'uni', 'V');
src('alt2', 'NoteOn Alt 2', 'uni', 'V');
for (let m = 1; m <= 4; m++) src('macro' + m, 'Macro ' + m, 'uni', 'G', 1);
src('bend', 'Pitch Bend', 'bi', 'G');
src('mpex', 'MPE X', 'bi', 'V');
src('mpey', 'MPE Y', 'uni', 'V');
src('mpez', 'MPE Z', 'uni', 'V');
src('relvel', 'Rel. Velo', 'uni', 'V');
src('fixed', 'Fixed', 'uni', 'G');
src('env4', 'Env 4', 'uni', 'V', 1);                                          // 34
src('lfo9', 'LFO 9', 'uni', 'V/G', 1);                                        // 35
src('lfo10', 'LFO 10', 'uni', 'V/G', 1);                                      // 36
for (let l = 1; l <= 10; l++) src(`lfo${l}y`, `LFO ${l} Y`, 'uni', 'V/G');    // 37–46
for (let m = 5; m <= 8; m++) src('macro' + m, 'Macro ' + m, 'uni', 'G', 1);   // 47–50
src('randd', 'Note-On Rand (Discrete)', 'uni', 'V');                         // 51
src('osca', 'OSC A', 'bi', 'V');                                              // 52
src('oscb', 'OSC B', 'bi', 'V');
src('oscc', 'OSC C', 'bi', 'V');
src('sub', 'SUB', 'bi', 'V');                                                 // 55
src('filt1', 'Filter 1', 'bi', 'V');
src('filt2', 'Filter 2', 'bi', 'V');
src('actv', 'Active Voices', 'uni', 'G');                                     // 58
src('vidx', 'Voice Index', 'uni', 'V');
src('vmod1', 'Voice Mod 1', 'bi', 'V');
src('vmod2', 'Voice Mod 2', 'bi', 'V');                                       // 61
if (S.length !== 62) throw new Error('sources2: ' + S.length);
writeFileSync(here('sources2.json'), JSON.stringify({ NSRC: S.length, SOURCES: S }, null, 1));
console.log('wrote dests2.json (' + ND + ' rows) and sources2.json (' + S.length + ' sources)');
