#!/bin/zsh
# tools/midi-harness/run.sh — the native MIDI logic's executable test (IMPL-B §7, fixer M): compiles the REAL app/ios/SYNTH/Midi.swift
# (+ Smoke.swift, no -DSMOKE) for macOS with main.swift's fake host and cases, runs them, exits with the failure count. ≈ 15 s (the
# hot-plug case waits on the Mac's real MIDI server). No Xcode project, no simulator; `xcrun swiftc` on the Mac is all it needs.
#   tools/midi-harness/run.sh            build to $SYNTH_HARNESS_DIR (default $TMPDIR/synth-midi-harness) and run
# Nothing is written outside that directory (the "SYNTH" destination's uid goes to an in-memory UserDefaults).
set -uo pipefail
ROOT=${0:A:h:h:h}
OUT=${SYNTH_HARNESS_DIR:-${TMPDIR:-/tmp}/synth-midi-harness}
mkdir -p "$OUT"
SRC=$ROOT/app/ios/SYNTH
xcrun swiftc -swift-version 5 -Onone -module-name SYNTH -o "$OUT/midi-harness" "$SRC/Midi.swift" "$SRC/Smoke.swift" "$ROOT/tools/midi-harness/main.swift" || { print -u2 "midi-harness: the build failed"; exit 1; }
"$OUT/midi-harness"
