// Regenerates the compiled-default fixtures from serum-core.js (spec §0.5 M1):
//   cp-default.json  = compileSerum(defaultSerum()).serum      (CP, §4.1)
//   ct-default.json  = compileSerum(defaultSerum()).serumT     (CT, §4.1)
//   fxp-default.json = compileFx(defaultFx())                  (FXP, §4.2; no ctx: master 1, not bypassed)
//   fxt-default.json = compileFxT(defaultFx())                 (FXT, §4.2; linear X-Shaper tables)
// Run: node tests/fixtures/gen-compiled.mjs   (tests/serum-core.test.mjs fails when these drift from serum-core)
import { writeFileSync } from 'node:fs';
import { defaultSerum, compileSerum, defaultFx, compileFx, compileFxT } from '../../serum-core.js';
import { stringify } from './load.mjs';

const out = (f, o) => writeFileSync(new URL('./' + f, import.meta.url), stringify(o));
const patch = compileSerum(defaultSerum());
out('cp-default.json', patch.serum);
out('ct-default.json', patch.serumT);
out('fxp-default.json', compileFx(defaultFx()));
out('fxt-default.json', compileFxT(defaultFx()));
console.log('wrote cp-default.json ct-default.json fxp-default.json fxt-default.json');
