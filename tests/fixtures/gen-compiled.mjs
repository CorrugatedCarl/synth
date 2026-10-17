// Regenerates the compiled-default fixtures (SPEC-serum §0.5 M1, SPEC-serum2 §4.1):
//   cp-default.json   = Phase-1 compileSerum(defaultSerum()).serum   (CP v1, from the frozen tests/ref-p1/serum-core.js)
//   ct-default.json   = Phase-1 compileSerum(defaultSerum()).serumT  (CT v1, idem) — the v1 fixtures stay byte-stable for
//                       the tests of DSP code that still reads the v1 formats
//   cp2-default.json  = compileSerum(defaultSerum()).serum                (CP v2, §4.1)
//   ct2-default.json  = assembleCT(compileSerum(defaultSerum()).serumT)   (CT v2, the full layout assembled from its parts)
//   fxp-default.json  = compileFx(defaultFxV1())                (FXP v2 of the Phase-1 default rack, fx-core; no ctx: master 1,
//                       not bypassed; owner F1)
//   fxt-default.json  = compileFxT(defaultFxV1())               (FXT, fx-core; linear X-Shaper tables; owner F1)
// Run: node tests/fixtures/gen-compiled.mjs   (tests/serum-core.test.mjs fails when these drift from the modules)
import { writeFileSync } from 'node:fs';
import * as P1 from '../ref-p1/serum-core.js';
import { defaultSerum, compileSerum, assembleCT } from '../../serum-core.js?v=10';
import { defaultFxV1, compileFx, compileFxT } from '../../fx-core.js?v=10';
import { stringify } from './load.mjs';

const out = (f, o) => writeFileSync(new URL('./' + f, import.meta.url), stringify(o));
const p1 = P1.compileSerum(P1.defaultSerum()), p2 = compileSerum(defaultSerum());
out('cp-default.json', p1.serum);
out('ct-default.json', p1.serumT);
out('cp2-default.json', p2.serum);
out('ct2-default.json', assembleCT(p2.serumT));
out('fxp-default.json', compileFx(defaultFxV1()));
out('fxt-default.json', compileFxT(defaultFxV1()));
console.log('wrote cp-default.json ct-default.json cp2-default.json ct2-default.json fxp-default.json fxt-default.json');
