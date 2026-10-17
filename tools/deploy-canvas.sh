#!/bin/zsh
# Publish the 'canvas' branch to canvas.domlavin.com (GitHub Pages of CorrugatedCarl/synth-canvas) without touching main or the live site.
# The deploy is a throwaway commit on top of canvas: CNAME → canvas.domlavin.com, the installed app named "SYNTH Canvas", precache rebuilt.
set -e
ROOT=${0:A:h:h}
SITE=https://github.com/CorrugatedCarl/synth-canvas.git
WT=$(mktemp -d)/site
cd "$ROOT"
git worktree add -q --detach "$WT" canvas
trap 'cd "$ROOT"; git worktree remove --force "$WT" >/dev/null 2>&1 || true' EXIT
cd "$WT"
print -n canvas.domlavin.com > CNAME
sed -i '' 's/"name": *"SYNTH"/"name": "SYNTH Canvas"/; s/"short_name": *"SYNTH"/"short_name": "Canvas"/' manifest.webmanifest
sed -i '' 's/name="apple-mobile-web-app-title" content="SYNTH"/name="apple-mobile-web-app-title" content="Canvas"/' index.html
node tools/precache.mjs --write >/dev/null
git add -A
git -c user.name="$(git -C "$ROOT" config user.name)" -c user.email="$(git -C "$ROOT" config user.email)" commit -q -m "Deploy canvas $(git -C "$ROOT" rev-parse --short canvas) to canvas.domlavin.com"
git push -q --force "$SITE" HEAD:main
echo "deployed canvas $(git -C "$ROOT" rev-parse --short canvas) → canvas.domlavin.com"
