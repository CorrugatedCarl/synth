// The classic control class table of cv-mods.js (SPEC-canvas §7.2, §7.8): runs cv-mods classTable() (the sweep over the
// default patch and every factory preset of each model) and prints it, or with --write rewrites CLASS_TABLE between the
// <cv-classes> markers of cv-mods.js. tests/cv-mods.test.mjs checks that the checked-in table equals a fresh run. Serum (custom)
// and the 900 Series (family 'patch', stage 9: no classic modulation, IMPL-9 §4.8) have no row: classTable() skips them.
//   node tools/cv-classes.mjs            prints the counts and any difference from the checked-in table
//   node tools/cv-classes.mjs --write    rewrites the table
import { readFileSync, writeFileSync } from 'node:fs';
import { classTable, counts, CLASS_TABLE } from '../cv-mods.js?v=9';

const FILE = new URL('../cv-mods.js', import.meta.url);
// the table as source: one line per model, controls in panel order
export function tableSource(t) {
  const lines = Object.entries(t).map(([m, c]) => `  ${m}: { ${Object.entries(c).map(([k, v]) => `${/^[a-z_$][\w$]*$/i.test(k) ? k : JSON.stringify(k)}: '${v}'`).join(', ')} },`);
  return 'export const CLASS_TABLE = Object.freeze({\n' + lines.join('\n') + '\n});';
}
const fresh = classTable();
console.log('counts', JSON.stringify(counts(fresh)));
const diff = [];
for (const [m, c] of Object.entries(fresh)) for (const [k, v] of Object.entries(c)) if (!CLASS_TABLE[m] || CLASS_TABLE[m][k] !== v) diff.push(`${m}.${k}: ${CLASS_TABLE[m] && CLASS_TABLE[m][k]} → ${v}`);
console.log(diff.length ? diff.join('\n') : 'the checked-in table is current');
if (process.argv.includes('--write')) {
  const src = readFileSync(FILE, 'utf8'), a = src.indexOf('// <cv-classes>\n'), b = src.indexOf('// </cv-classes>');
  if (a < 0 || b < a) throw new Error('cv-classes: markers not found in cv-mods.js');
  writeFileSync(FILE, src.slice(0, a) + '// <cv-classes>\n' + tableSource(fresh) + '\n' + src.slice(b));
  console.log('cv-mods.js CLASS_TABLE written');
}
