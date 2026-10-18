// tools/panel-check.mjs — the AUTHORS' checker for a hardware panel layout (docs/canvas/IMPL-panels.md §4.6).
//   node tools/panel-check.mjs <model> [out-dir]
// Prints cv-panel.validate()'s problems, the module size (sizeOf: world px, the 40 px bar included), the live / inert /
// extras counts, the smallest hit box and any overlap, and the per-section control list (in Tab order). With out-dir
// (use the scratchpad) it writes <model>.svg: the decor SVG with every live control drawn as an outline of its kind and
// its hit box dashed — a quick visual check against the research photos without starting the app. Exit code 1 on problems.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as P from '../cv-panel.js?v=9';
import { MODELS } from '../models.js?v=9';

const [id, out] = process.argv.slice(2);
if (!id) { console.log('usage: node tools/panel-check.mjs <model> [out-dir]\nmodels: ' + P.HW_IDS.join(', ')); process.exit(2); }
const model = MODELS.find(m => m.id === id), L = P.layoutOf(id);
if (!model) { console.error(`unknown model "${id}"`); process.exit(2); }
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
console.log(`live ${live.length} · displays ${geo.controls.filter(o => o.show).length} · inert ${inert.length} · extras ${ex.length}${ex.length ? ' (' + ex.join(' ') + ')' : ''} · decor ${(L.decor || []).length}`);
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
console.log('\nsections (Tab order):');
const bySec = new Map();
for (const i of geo.order) { const o = geo.controls[i], k = o.sec >= 0 ? (L.sections[o.sec] || {}).id : '(none)'; if (!bySec.has(k)) bySec.set(k, []); bySec.get(k).push(o.id || o.kind); }
for (const sct of L.sections || []) console.log(`  ${sct.id.padEnd(14)} ${(bySec.get(sct.id) || []).join(' ')}`);
if (bySec.has('(none)')) console.log('  (none)         ' + bySec.get('(none)').join(' '));
if (out) {
  const dir = resolve(out);
  mkdirSync(dir, { recursive: true });
  let svg = P.decorSvg(L, model).replace(/<svg ([^>]*)width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)"/, (m0, a, w, h) => `<svg ${a}width="${w}" height="${h}"`);
  // overlay in body px: a second <svg> over the first in one file (a wrapper with both)
  const ov = [];
  for (const o of geo.controls) {
    if (!o.live && !o.show) continue;
    const col = o.live ? '#3fd0ff' : '#ffd23f', r = o.own || o.box;
    if (o.kind === 'knob' || o.kind === 'rotary') ov.push(`<circle cx="${r.x + r.w / 2}" cy="${r.y + r.h / 2}" r="${r.w / 2}" fill="none" stroke="${col}" stroke-width="1.5"/>`);
    else if (o.entries) for (const e of o.entries) ov.push(`<rect x="${e.box.x}" y="${e.box.y}" width="${e.box.w}" height="${e.box.h}" fill="none" stroke="${col}" stroke-width="1.5"/>`);
    else ov.push(`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="none" stroke="${col}" stroke-width="1.5"/>`);
    if (o.live) for (const h of o.entries ? o.entries.map(e => e.hit) : [o.hit]) ov.push(`<rect x="${h.x}" y="${h.y}" width="${h.w}" height="${h.h}" fill="none" stroke="#ff4fa3" stroke-width="1" stroke-dasharray="4 3"/>`);
    if (o.id) ov.push(`<text x="${(o.box.x + o.box.w / 2)}" y="${o.box.y + o.box.h + 9}" font-size="9" text-anchor="middle" fill="#3fd0ff" font-family="monospace">${o.id}</text>`);
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
