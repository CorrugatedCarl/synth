# SYNTH — project instructions

Browser synthesizer studio by the user (GitHub: CorrugatedCarl). Plain ES modules, no build step, AudioWorklet DSP in 64-bit with
oversampling. Circuit-level emulations of 12 classic synths (Moog Modular, Minimoog, ARP 2600, Solina, CS-80, Prophet-5, MS-20, TB-303,
OB-Xa, Jupiter-8, Juno-60, DX7) + a full Serum 2 recreation + a Serum-style FX rack on every track + a multitrack MIDI studio (piano roll,
arrangement). Installable PWA, used heavily on the user's iPad Pro (iPadOS, Chrome for iOS / Safari = WebKit) and on a Mac (M4 Max).

**Read [docs/HANDOVER.md](docs/HANDOVER.md) first** — current status, what's next, every decision and preference. Then
[docs/canvas/ROADMAP.md](docs/canvas/ROADMAP.md) (living tracker) and [docs/canvas/SPEC-canvas.md](docs/canvas/SPEC-canvas.md) (design).

## Two sites, two branches — never mix them

| | Branch | Site | Deploy |
|---|---|---|---|
| Live app | `main` | synth.domlavin.com (GitHub Pages of CorrugatedCarl/synth) | commit + push `main` (`git pull --rebase` first) |
| Canvas redesign | `canvas` | canvas.domlavin.com (GitHub Pages of CorrugatedCarl/synth-canvas) | commit + push `canvas`, then `tools/deploy-canvas.sh` |

- The working tree normally sits on `canvas`. Never merge canvas into main, never push canvas work to main ("in case I regret it").
- To change the live site, use a separate worktree of `main` (e.g. `git worktree add <scratch>/main-wt main`), test there, push, remove it.
- `tools/deploy-canvas.sh` publishes the committed `canvas` HEAD (throwaway commit: CNAME canvas.domlavin.com, app name "SYNTH Canvas",
  precache rebuilt) by force-pushing to synth-canvas `main`. Uncommitted work is never deployed.
- DNS is on Cloudflare (CNAMEs `synth` and `canvas` → corrugatedcarl.github.io, grey cloud); the user edits DNS. HTTPS is enforced on both
  Pages sites (if a cert stalls: remove and re-add the custom domain via the Pages API).

## The iPad app (stage A, docs/canvas/IMPL-A.md)

- `app/ios/` wraps the site in a WKWebView over `synth://app/`, fully offline. The bundle is the **committed** tree's precache list
  (`tools/app-bundle.sh`; a dirty tree refuses — commit first). `tools/app-smoke.sh` builds, installs and checks it on the simulator
  "SYNTH iPad Pro 13" (iOS 27.0 runtime; 27.1's has no iPads). Never commit `app/ios/Local.xcconfig` (the user's team / bundle-id suffix).
- The fonts are local (`fonts/`, Inter + JetBrains Mono, OFL texts beside them); `node tools/precache.mjs --write` covers them.
- The user installs with a free Apple ID over a cable (7-day re-sign); before any switch to the paid Program, every project is saved to Files.
- MIDI in the app (IMPL-B): `app/ios/SYNTH/Midi.swift` + `MidiShim.js` (midi.js stays byte-identical); after any Midi.swift change run
  `tools/midi-harness/run.sh` (the real Swift on the Mac, a fake host) and the smoke; `tools/midi-sender.swift` plays the simulator's app as another app.

## Release hygiene

- Every import/URL carries `?v=N` and `VERSION` in main.js / assets.js / sw.js matches (lint enforces). `main` is at v=10, `canvas` at v=9
  (bump past 10 if canvas is ever merged). Bump on every `main` release.
- After ANY site-file change run `node tools/precache.mjs --write` (sw.js BUILD hash; tests/pwa.test.mjs checks it). New modules must be
  reachable from main.js so they're precached.
- The service worker serves versioned files cache-first and never reloads by itself: users get updates via the "Update available — Reload"
  toast. Verify deploys with the service worker active (unregistering it and reloading can show stale HTTP-cached files).

## Tests — memory safety is mandatory

The user's Mac crashed twice from test memory blowups (one full run peaked at 47.5 GB).
- One file at a time: `node --max-old-space-size=2048 --test tests/<file>.test.mjs`. Never run the suite from parallel agents; the lead
  may run every file sequentially (a loop, one file at a time). Node 24 rejects a bare directory: `node --test 'tests/*.test.mjs'`.
- New test files `import './v8-guard.mjs'` first, import modules with the app's `?v=` suffix, and NEVER pass fake-DOM nodes to `assert.*`
  (AssertionError walks the cyclic fake DOM: tens of GB). tests/serum-ui.test.mjs has a safe assert wrapper.
- Sound must stay bit-identical: golden-classic / golden-fx / golden-presets / golden-random / golden-graph (frozen refs in tests/ref-p1,
  tests/ref-1c). Never weaken a test or loosen a gate; fix the code.
- Bench gates: tests/bench.json ("node", "jsc", "ipad" rows). The user can run `canvas.domlavin.com/tests/bench.html` on the iPad
  (Run 5 passes → Copy results). WebKit's 1 ms timer quantizes the "worst" columns (0.375 = one tick).

## Working rules

- Search only inside this folder and your scratchpad. NEVER disk-wide searches (`find /`, `find ~`, `mdfind`, `/Volumes`,
  `~/Library/CloudStorage`) — they trigger macOS privacy prompts for the user's external drive and Dropbox.
- Original content only: never copy Xfer (Serum) wavetables, presets, samples or manual text; instrument art/panels are original (no logos).
- Don't change macOS system/privacy settings; the user does that.
- Code style: dense, terse comments in the existing voice; match surrounding idioms.
- Local preview: `.claude/launch.json` config `synth` (`node .claude/serve.mjs`, port 8817, no-store). Check desktop (1440×900) and iPad
  sizes (1366×1024, 1024×1366); reset viewport emulation afterwards.
- Long background work stops if the Mac sleeps (closed lid): ask the user to keep it plugged in with the lid open.
- "Push it live when it's done" is the user's standing expectation for finished, tested work.
- Process (the user's decision, 2026-10-19, after the week's Fable budget went in one day): the **leaner** multi-agent shape — cheaper models for mapping, mechanical lanes and fixers; two reviewers (one with the real engine, one in headless Chrome), not four; one sweep; short briefs. Keep: a contract first, builders in worktrees reset to the base, failing-test-first fixes, goldens bit-identical, one test file at a time.
