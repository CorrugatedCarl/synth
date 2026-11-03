// The kit's fixture groove (docs/canvas/IMPL-DM.md §5.7; stage DM phase 0): ours, 16 steps, never shipped (KIT.DEMO is null — the
// user's empty grid). G3's loudness, G4's steps ≡ notes, G5's refs, the dkp bench row and G9's scenes play it on the Starter kit,
// whose slots are KIT.STARTER's order: 0 Kick · 1 Snare · 2 Clap · 3 Closed hat · 4 Open hat · 5 Low tom · 6 High tom · 7 Rim.
// A pattern in the record's shape (kit-core normKit leaves it as it is): kick 1 · 5 · 9 · 13; clap 5 · 13; closed hat 3 · 7 · 11 at
// 100 and 1 · 5 · 9 · 13 at 64; open hat 15 at 100 (choked by the closed hat on the next bar's step 1); rim 12 at 64.
// Plain data, no imports: every lane's tests share it.
const hits = [
  [0, [1, 5, 9, 13], 100], [2, [5, 13], 100], [3, [3, 7, 11], 100], [3, [1, 5, 9, 13], 64], [4, [15], 100], [7, [12], 64],
];
const cells = hits.flatMap(([l, steps, v]) => steps.map(n => ({ l, s: n - 1, v }))).sort((a, b) => a.s - b.s || a.l - b.l);
const freeze = o => { Object.freeze(o); for (const v of Object.values(o)) if (v && typeof v === 'object') freeze(v); return o; };
export const GROOVE = freeze({ len: 16, sc: 3, cells });
