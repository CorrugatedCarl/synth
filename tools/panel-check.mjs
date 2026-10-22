// tools/panel-check.mjs — the AUTHORS' checker for a hardware panel layout (docs/canvas/IMPL-panels.md §4.6).
//   node tools/panel-check.mjs <model> [out-dir]
// Prints cv-panel.validate()'s problems, the module size (sizeOf: world px, the 40 px bar included), the live / inert /
// extras counts, the smallest hit box and any overlap, and the per-section control list (in Tab order). With out-dir
// (use the scratchpad) it writes <model>.svg: the decor SVG with every live control drawn as an outline of its kind and
// its hit box dashed — a quick visual check against the research photos without starting the app. Exit code 1 on problems.
// (1i, IMPL-1i §2) A keyboard: its MIDI range, the bed's edges (area frame, content mm, body px) and its front band; in the
// SVG every white / black key outlined from geometry's o.bed and the band hatched; a controller's slot and hit box as above.
// (7a, IMPL-7a §7.3) A model with a token table (tb303, dx7, tr808): every token placed or missing (a repeated one by its
// index: the 808's step keys n 1–16), a detented one's positions, the extras cells with their sizes, the `inert: 'later'`
// jacks. A layout not yet in panels/index.js (an author's first draft) is loaded from panels/<model>.js directly.
// (7b, IMPL-7b §7.3) The TR-606 the same way; a switch token's orientation (want / drawn), a rotary's sweep and `rot`, the
// model's own extras cells and row breaks (TOKENS.<model>.cells / xbreak).
// (7c, IMPL-7c §7.3) The TR-909 the same way; a display token's box against its characters' minimum (dspMin), the keys that
// show their LED (TOKENS.<model>.led) and the LED each one has, the model's own caption.
// (8, IMPL-8 §13) The SDS-V the same way; a grouped token per group (the memory keys n 1–4 and the trimmer rows mem 3 / 4 of
// each channel b s 1 2 3: dr:mem#b:1 …), the switches the memory keys write (x<ch>p — never placed on their own), each
// trimmer row's art and hit box (hitOff).
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as P from '../cv-panel.js?v=9';
import { noteName } from '../cv-keys.js?v=9';
import { MODELS } from '../models.js?v=9';

const [id, out] = process.argv.slice(2);
if (!id) { console.log('usage: node tools/panel-check.mjs <model> [out-dir]\nmodels: ' + P.HW_IDS.join(', ')); process.exit(2); }
const model = MODELS.find(m => m.id === id);
if (!model) { console.error(`unknown model "${id}"`); process.exit(2); }
let L = P.layoutOf(id);
const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'panels', id + '.js');
if (!L && !P.HW_IDS.includes(id) && /^[a-z0-9]+$/.test(id) && existsSync(file)) {
  L = (await import(pathToFileURL(file).href + '?v=9')).default || null;
  if (L) console.log(`(panels/${id}.js is not in panels/index.js yet: loaded directly — the app does not see it until it is listed there)`);
}
if (!L) { console.log(`${id}: no layout yet (panels/${id}.js exports null) — the model shows its Simple panel`); process.exit(0); }
const probs = P.validate(L, model);
console.log(`${id} — ${L.hw || ''}`);
if (probs.length) { console.log(`\n${probs.length} problem(s):`); for (const p of probs) console.log('  · ' + p); }
else console.log('valid');
let geo = null;
try { geo = P.geometry(L, model); } catch (err) { console.log('\ngeometry failed: ' + err.message); process.exit(1); }
const s = P.sizeOf(L, model), live = geo.controls.filter(o => o.live), inert = geo.controls.filter(o => o.inert);
const ex = (L.extras && L.extras.ids) || [];
console.log(`\nmodule ${s.w} × ${s.h} px (body ${geo.body.w} × ${geo.body.h}; content ${geo.content.w} × ${geo.content.h} at x ${geo.content.x})`);
const later = inert.filter(o => L.controls[o.i].inert === 'later').length;
console.log(`live ${live.length} · displays ${geo.controls.filter(o => o.show).length} · inert ${inert.length}${later ? ` (${later} 'later': full contrast, cable-able with full patching)` : ''} · extras ${ex.length}${ex.length ? ' (' + ex.join(' ') + ')' : ''} · decor ${(L.decor || []).length}`);
// (7a) the model's tokens: placed / missing; a repeated one by its index; a detented one's positions and legends
const T = P.TOKENS[id];
if (T) {
  const on = new Map();
  for (const c of L.controls || []) if (c && !c.inert && typeof c.id === 'string' && c.id in T.kind) { if (!on.has(c.id)) on.set(c.id, []); on.get(c.id).push(c); }
  const miss = Object.keys(T.kind).filter(t => !on.has(t)), xmiss = T.extras.filter(t => !ex.includes(t));
  console.log(`\ntokens on the face: ${on.size} of ${Object.keys(T.kind).length}${miss.length ? ' · missing: ' + miss.join(' ') : ''}`);
  for (const [t, [f, lo, hi]] of Object.entries(T.idx || {})) {
    const g = T.grp && T.grp[t]; // ((8) a grouped token: per group — the SDS-V's channels)
    for (const gv of g ? g[1] : [null]) {
      const got = (on.get(t) || []).filter(c => !g || c[g[0]] === gv).map(c => c[f]), gone = [];
      for (let i = lo; i <= hi; i++) if (!got.includes(i)) gone.push(i);
      console.log(`  ${t}${g ? ' ' + g[0] + ' ' + gv : ''}: ${got.length} placed (${f} ${lo}–${hi})${gone.length ? ' · missing ' + f + ' ' + gone.join(', ') : ''}`);
    }
    const stray = g ? (on.get(t) || []).filter(c => !g[1].includes(c[g[0]])).length : 0;
    if (stray) console.log(`  ${t}: ${stray} with no valid ${g[0]} (one of ${g[1].join(', ')})`);
  }
  // (8) a grouped token bound to a models.js switch: the switch each group's keys write (never placed on its own)
  for (const [t, pat] of Object.entries(T.bind || {})) {
    const g = T.grp[t], ids = g[1].map(gv => pat.replace('?', gv));
    console.log(`  ${t} → the switches ${ids.join(' ')} (index = ${T.idx[t][0]} − ${T.idx[t][1]}; placed by these keys${ids.some(id => (L.controls || []).some(c => c && c.id === id)) ? ' — ALSO PLACED ON THEIR OWN' : ''})`);
  }
  // (8) the trimmer rows: their trimmers' art and hit boxes (hitOff)
  for (const c of on.get('dr:trim') || []) {
    const o = geo.controls.find(q => L.controls[q.i] === c);
    console.log(`  dr:trim ch ${c.ch} mem ${c.mem}: ${c.w} × ${c.h} mm, ${P.TRIM_N} trimmers of ${c.d != null ? c.d : 'auto'} mm${c.hitOff ? ', hitOff ' + JSON.stringify(c.hitOff) : ''} · hit ${o ? `${o.hit.w} × ${o.hit.h} px at (${o.hit.x}, ${o.hit.y})` : '?'}`);
  }
  const ori = c => c.orient || (c.h > c.w ? 'v' : 'h');
  for (const [t, n] of Object.entries(T.pos || {})) for (const c of on.get(t) || []) {
    const more = c.kind === 'switch' ? ` (${ori(c) === 'v' ? 'vertical: the first position at the top' : 'horizontal'}${T.orient && T.orient[t] ? ', must be ' + (T.orient[t] === 'v' ? 'vertical' : 'horizontal') : ''})`
      : c.kind === 'rotary' ? ` (sweep ${c.sweep || 270}°${c.rot ? ', centred at ' + c.rot + '°' : ''})` : '';
    console.log(`  ${t}: a ${c.kind}${more}, ${n} positions${Array.isArray(c.legends) ? ' · legends ' + c.legends.map(l => JSON.stringify(l)).join(' ') : ''}`);
  }
  // (7c) a display token's box vs its characters; the LED keys and their LEDs
  for (const [t, n] of Object.entries(T.digits || {})) for (const c of on.get(t) || []) {
    const [mw, mh] = P.dspMin(n);
    console.log(`  ${t}: a ${c.kind} ${c.w} × ${c.h} mm (${n} characters need ≥ ${mw} × ${mh} mm${c.w >= mw && c.h >= mh ? '' : ' — TOO SMALL'})`);
  }
  if (T.led) {
    const ls = T.led.flatMap(t => (on.get(t) || []).map(c => t + (T.idx && T.idx[t] ? '#' + (T.grp && T.grp[t] ? c[T.grp[t][0]] + ':' : '') + c[T.idx[t][0]] : '') + ' ' + (c.led || 'cap')));
    console.log(`  LED keys (each shows its LED): ${ls.join(', ') || '—'}`);
  }
  if (T.extras.length) console.log(`tokens in the extras: ${T.extras.length - xmiss.length} of ${T.extras.length}${xmiss.length ? ' · missing: ' + xmiss.join(' ') : ''}`);
  if (T.caption) console.log(`the model's caption: ${L.extras && L.extras.caption != null ? (L.extras.caption === T.caption ? 'the layout carries it' : 'THE LAYOUT\'S DIFFERS') : 'supplied by the geometry (the layout has none)'}`);
}
const hb = P.hitBoxes(L, model);
if (hb.length) {
  const m = hb.reduce((a, b) => (Math.min(b.w, b.h) < Math.min(a.w, a.h) ? b : a));
  console.log(`smallest hit box: ${m.id}${m.v != null ? '=' + m.v : ''} ${m.w} × ${m.h} px`);
  const ov = [];
  for (let i = 0; i < hb.length; i++) for (let j = i + 1; j < hb.length; j++) { const a = hb[i], b = hb[j]; if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) ov.push(a.id + ' × ' + b.id); }
  console.log(ov.length ? 'overlaps: ' + ov.join(', ') : 'no overlaps');
  const outside = hb.filter(r => r.x < 0 || r.y < 0 || r.x + r.w > geo.body.w || r.y + r.h > geo.body.h).map(r => r.id);
  if (outside.length) console.log('outside the body: ' + outside.join(', '));
}
// (1i) the keyboard and the performance controls
const f3 = v => (Math.round(v * 1000) / 1000).toFixed(3);
for (const o of geo.controls) {
  const c = L.controls[o.i];
  if (o.kind === 'keys' && o.bed) {
    const b = o.bed, m = b.mm, ar = (L.areas || []).find(a => a.id === o.a) || { src: [0, 0], at: [0, 0] }, l = c.x - m.w / 2, t = c.y - m.h / 2;
    const want = c.front != null ? c.front : 8, dx = ar.at[0] - ar.src[0], dy = ar.at[1] - ar.src[1];
    console.log(`\nkeys ${o.id || '(inert)'}: ${b.n} keys ${noteName(b.lo)}–${noteName(b.hi)} (MIDI ${b.lo}–${b.hi}, ${b.whites} white), pitch ${f3(m.pitch)} × len ${m.len} mm, black ${f3(m.bw)} × ${f3(m.bl)}${b.at ? ', aftertouch' : ''}`);
    console.log(`  bed (area "${o.a}" frame, mm): left ${f3(l)} · right ${f3(l + m.w)} · back ${f3(t)} · front ${f3(t + m.h)}`);
    console.log(`  bed (content mm): left ${f3(l + dx)} · right ${f3(l + m.w + dx)} · back ${f3(t + dy)} · front ${f3(t + m.h + dy)}`);
    console.log(`  bed (body px): x ${b.x} → ${f3(b.x + b.w)} · y ${b.y} → ${f3(b.y + b.h)}; front band ${f3(m.front)} mm (${b.front} px)${o.live && m.front < Math.min(8, want) - 1e-9 ? `, clamped from ${want} mm (the room below the keys)` : ''}`);
  } else if (['wheel', 'lever', 'ribbon', 'pad'].includes(o.kind)) {
    const more = o.kind === 'lever' ? `; axis ${c.axis}, up ${c.up}` : o.kind === 'ribbon' ? `; span ${c.span != null ? c.span : 12} st` : o.kind === 'pad' ? `; rise ${c.rise != null ? c.rise : 0.25} s` : `; orient ${c.orient || 'v'}${c.detent ? ', detent' : ''}`;
    console.log(`${o.kind} ${o.id || '(inert)'}: slot ${c.w} × ${c.h} mm at (${c.x}, ${c.y}) in "${o.a}"; hit ${o.hit.w} × ${o.hit.h} px${more}`);
  }
}
if (geo.extras) {
  const X = geo.extras;
  console.log(`\nextras strip ${X.w} × ${X.h} px at y ${X.y}${X.caption ? ` · caption "${X.caption}${X.note ? ' · Dimmed controls are not emulated' : ''}"` : ''}${X.over ? ' · THE CELLS DO NOT FIT' : ''}`);
  for (const c of X.cells) console.log(`  ${c.id.padEnd(12)} ${c.w} × ${c.h} at (${c.x}, ${c.y})`);
  console.log(`  rows: ${[...new Set(X.cells.map(c => c.y))].length} · a new row after ${P.xbreakOf(model).join(' ')} (or when a cell does not fit)`);
}
// a repeated token's index for the listings ((8) a grouped one's group value first: dr:mem#b:1)
const ixOf = o => { const c = L.controls[o.i], ix = o.id && T && T.idx && T.idx[o.id], g = ix && T.grp && T.grp[o.id]; return ix ? ' ' + (g ? c[g[0]] + ':' : '') + c[ix[0]] : ''; };
console.log('\nsections (Tab order):');
const bySec = new Map();
for (const i of geo.order) {
  const o = geo.controls[i], k = o.sec >= 0 ? (L.sections[o.sec] || {}).id : '(none)', ix = ixOf(o);
  if (!bySec.has(k)) bySec.set(k, []);
  bySec.get(k).push(o.id ? o.id + ix.replace(' ', '#') : o.kind);
}
for (const sct of L.sections || []) console.log(`  ${sct.id.padEnd(14)} ${(bySec.get(sct.id) || []).join(' ')}`);
if (bySec.has('(none)')) console.log('  (none)         ' + bySec.get('(none)').join(' '));
if (out) {
  const dir = resolve(out);
  mkdirSync(dir, { recursive: true });
  let svg = P.decorSvg(L, model).replace(/<svg ([^>]*)width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)"/, (m0, a, w, h) => `<svg ${a}width="${w}" height="${h}"`);
  // overlay in body px: a second <svg> over the first in one file (a wrapper with both)
  const ov = [];
  for (const o of geo.controls) {
    if (o.bed) { // (1i) every key from o.bed (white: outlined; black: filled, outlined) and the front band hatched
      for (const k of o.bed.keys) ov.push(`<rect x="${k.x}" y="${k.y}" width="${k.w}" height="${k.h}" fill="${k.black ? 'rgba(20,20,20,0.6)' : 'none'}" stroke="${k.black ? '#ff9f3f' : '#3fd0ff'}" stroke-width="${k.black ? 1 : 0.75}"/>`);
      const bd = o.bed.band;
      if (bd.h > 0) ov.push(`<rect x="${bd.x}" y="${bd.y}" width="${bd.w}" height="${bd.h}" fill="rgba(255,79,163,0.18)" stroke="#ff4fa3" stroke-width="1" stroke-dasharray="4 3"/>`);
      ov.push(`<text x="${o.bed.x + 4}" y="${o.bed.y - 4}" font-size="11" fill="#3fd0ff" font-family="monospace">${o.id || 'keys (inert)'} ${noteName(o.bed.lo)}–${noteName(o.bed.hi)} · band ${o.bed.front} px</text>`);
      continue;
    }
    if (!o.live && !o.show) continue;
    const col = o.live ? '#3fd0ff' : '#ffd23f', r = o.own || o.box;
    if (o.kind === 'knob' || o.kind === 'rotary') ov.push(`<circle cx="${r.x + r.w / 2}" cy="${r.y + r.h / 2}" r="${r.w / 2}" fill="none" stroke="${col}" stroke-width="1.5"/>`);
    else if (o.entries) for (const e of o.entries) ov.push(`<rect x="${e.box.x}" y="${e.box.y}" width="${e.box.w}" height="${e.box.h}" fill="none" stroke="${col}" stroke-width="1.5"/>`);
    else ov.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="none" stroke="${col}" stroke-width="1.5"/>`);
    if (o.live) for (const h of o.entries ? o.entries.map(e => e.hit) : [o.hit]) ov.push(`<rect x="${h.x}" y="${h.y}" width="${h.w}" height="${h.h}" fill="none" stroke="#ff4fa3" stroke-width="1" stroke-dasharray="4 3"/>`);
    const ix = ixOf(o); // (a repeated token: its index; (8) its group's value first)
    if (o.id) ov.push(`<text x="${(o.box.x + o.box.w / 2)}" y="${o.box.y + o.box.h + 9}" font-size="9" text-anchor="middle" fill="#3fd0ff" font-family="monospace">${o.id}${ix}</text>`);
  }
  if (geo.extras) {
    const X = geo.extras;
    ov.push(`<rect x="${X.x}" y="${X.y}" width="${X.w}" height="${X.h}" fill="rgba(20,22,26,0.85)" stroke="#888" stroke-dasharray="2 2"/>`);
    for (const c of X.cells) ov.push(`<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" fill="none" stroke="#9f9"/><text x="${c.x + 4}" y="${c.y + 12}" font-size="10" fill="#9f9" font-family="monospace">${c.id}</text>`);
  }
  const W = geo.W, H = geo.body.h;
  const file = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${L.case === 'wood' ? '#5a3218' : (L.case || '#222')}"/>`
    + svg.replace('<svg ', '<svg x="0" y="0" ') + ov.join('') + '</svg>';
  const f = join(dir, id + '.svg');
  writeFileSync(f, file);
  console.log('\nwrote ' + f);
}
process.exit(probs.length ? 1 : 0);
