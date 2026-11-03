#!/bin/bash
# the full test sweep, ONE file at a time (the user's Mac crashed twice from parallel runs; CLAUDE.md "Tests"):
#   tools/sweep.sh <repo or worktree> <out dir in the scratchpad>
# per file: <out>/<name>.log + .time; <out>/summary.txt gets "<name> rc=<code> <secs>s <peak RSS GB>", then DONE.
# totals: for f in <out>/*.log; do grep -hE '^ℹ (tests|pass|fail) ' $f; done | awk '{s[$2]+=$3} END {for (k in s) print k, s[k]}'
# known flaky timing gates under load (pass alone): classic-mod "N4 row mk", master-proc "G4 warm-up".
cd "$1" || exit 1
OUT="$2"; mkdir -p "$OUT"; rm -f "$OUT"/*.log "$OUT"/*.time; : > "$OUT/summary.txt"
for f in tests/*.test.mjs; do
  n=$(basename "$f" .test.mjs); s=$(date +%s)
  /usr/bin/time -l node --max-old-space-size=2048 --test "$f" > "$OUT/$n.log" 2> "$OUT/$n.time"; rc=$?
  e=$(( $(date +%s) - s ))
  rss=$(grep "maximum resident" "$OUT/$n.time" | awk '{printf "%.2f", $1/1073741824}')
  echo "$n rc=$rc ${e}s ${rss}GB" >> "$OUT/summary.txt"
done
echo DONE >> "$OUT/summary.txt"
