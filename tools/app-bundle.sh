#!/bin/zsh
# tools/app-bundle.sh — the iPad app's "Bundle the site" Run Script phase (IMPL-A §1.5; A3: one source, the committed tree).
# Copies HEAD's precache list (sw.js ASSETS + STATIC, parsed with awk / grep / sed — Xcode's PATH has no node) with `git archive
# HEAD` into the app's Resources/site, writes site/app-build.json and stamps CFBundleVersion with the commit count. Refuses
# uncommitted site work (the deploy-canvas rule) and a stale sw.js: BUILD is recomputed by tools/precache.mjs buildHash's formula
# (per listed name in byte order: `name \0 sha256hex(bytes) \n`, the stream's SHA-256, 12 hex digits) with shasum.
#   tools/app-bundle.sh                                   inside Xcode (TARGET_BUILD_DIR etc. set); ROOT = $SRCROOT/../..
#   tools/app-bundle.sh --dry-run <dir> [--root <repo>]   empty <dir> (new, empty or a previous bundle only), copy into it, no Info.plist stamp (tests/app-native.test.mjs's throwaway repo; a check)
#   tools/app-bundle.sh --list-from <sw.js>               print the parsed file list ('./' → index.html), one per line (the test vs the crawl)
#   SYNTH_ALLOW_DIRTY=1                                   skip the dirty check for a LOCAL try — app-build.json then says "dirty": true
set -euo pipefail

err() { print -u2 -- "error: $*"; exit 1; }

ROOT=""; DRY=""; LIST_FROM=""
while (( $# )); do
  case $1 in
    --root) ROOT=$2; shift 2 ;;
    --dry-run) DRY=$2; shift 2 ;;
    --list-from) LIST_FROM=$2; shift 2 ;;
    *) err "unknown argument: $1" ;;
  esac
done

# the two lists of a sw.js source on stdin: every '…' string between `const ASSETS = [` / `const STATIC = [` and the closing `];`
lists_of() {
  awk '/^const (ASSETS|STATIC) = \[/ { on = 1 } on { print } on && /\];/ { on = 0 }' | grep -o "'[^']*'" | tr -d "'"
}
if [[ -n $LIST_FROM ]]; then lists_of < "$LIST_FROM" | sed 's#^\./$#index.html#'; exit 0; fi

if [[ -z $ROOT ]]; then
  if [[ -n ${SRCROOT:-} ]]; then ROOT=$SRCROOT/../..; else ROOT=${0:A:h:h}; fi
fi
ROOT=${ROOT:A}
[[ -d $ROOT ]] || err "no repo at $ROOT"
git -C "$ROOT" rev-parse --verify -q HEAD >/dev/null || err "$ROOT is not a git repository with a HEAD"

if [[ -n $DRY ]]; then
  # step 3 empties <dir> first: never a folder that is not a bundle of its own (fix R2-F3) — a file, the repo or a folder
  # holding it (even with an app-build.json lying there), a non-empty folder without app-build.json (a previous bundle has one)
  DEST=${DRY:A}
  [[ $DEST == / || $DEST == $ROOT || $ROOT == "$DEST"/* ]] && err "refusing to empty $DEST: it is the repo or holds it"
  [[ -e $DEST && ! -d $DEST ]] && err "refusing to empty $DEST: not a folder"
  ents=("$DEST"/*(DN))
  [[ -d $DEST ]] && (( ${#ents} )) && [[ ! -f $DEST/app-build.json ]] && err "refusing to empty $DEST: not empty and not a previous bundle (no app-build.json)"
else
  [[ -n ${TARGET_BUILD_DIR:-} && -n ${UNLOCALIZED_RESOURCES_FOLDER_PATH:-} ]] || err "run from Xcode, or with --dry-run <dir>"
  DEST=$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/site
fi

# 2. the file list = HEAD's sw.js precache (sw.js itself never ships: nothing may register it)
SW=$(git -C "$ROOT" show HEAD:sw.js) || err "no sw.js in HEAD"
names=("${(@f)$(print -r -- "$SW" | lists_of)}")
(( ${#names} )) || err "sw.js: no ASSETS / STATIC lists"
files=()
for n in "${names[@]}"; do [[ $n == ./ ]] && files+=(index.html) || files+=("$n"); done
for f in "${files[@]}"; do git -C "$ROOT" cat-file -e "HEAD:$f" 2>/dev/null || err "$f is listed in sw.js but not committed"; done

# stale lists refuse the build: a missed `node tools/precache.mjs --write` would be a silent 404 in the app
BUILD=$(print -r -- "$SW" | sed -n "s/^const BUILD = '\([0-9a-f]*\)';.*/\1/p" | head -1)
want=$(for n in "${names[@]}"; do print -r -- "$n"; done | LC_ALL=C sort | while IFS= read -r n; do
  f=$n; [[ $f == ./ ]] && f=index.html
  h=$(git -C "$ROOT" cat-file -p "HEAD:$f" | shasum -a 256 | cut -c1-64)
  printf '%s\0%s\n' "$n" "$h"
done | shasum -a 256 | cut -c1-12)
[[ $BUILD == $want ]] || err "sw.js is stale (BUILD $BUILD, the files hash to $want) — run node tools/precache.mjs --write and commit"

# 1. refuse uncommitted site work (SYNTH_ALLOW_DIRTY=1: a local try, marked dirty)
dirty=false
if [[ -n ${SYNTH_ALLOW_DIRTY:-} ]]; then dirty=true
else
  git -C "$ROOT" diff --quiet HEAD -- "${files[@]}" sw.js || err "uncommitted site changes — commit first"
  untracked=$(git -C "$ROOT" ls-files --others --exclude-standard -- ':(glob)*.js' ':(glob)panels/*.js' ':(glob)fonts/**' index.html style.css)
  [[ -z $untracked ]] || err "untracked site files — commit first: ${untracked//$'\n'/ }"
fi

# 3. the content from HEAD (reproducible: the same commit → the same bytes and mtimes)
rm -rf "$DEST"
mkdir -p "$DEST"
git -C "$ROOT" archive HEAD "${files[@]}" | tar -x -C "$DEST"

# 4. app-build.json (Help & about, the smoke)
sha=$(git -C "$ROOT" rev-parse HEAD); short=$(git -C "$ROOT" rev-parse --short HEAD); date=$(git -C "$ROOT" log -1 --format=%cI HEAD)
version=$(git -C "$ROOT" show HEAD:main.js | sed -n "s/^const VERSION = '\([0-9]*\)';.*/\1/p" | head -1)
count=$(git -C "$ROOT" rev-list --count HEAD)
printf '{ "sha": "%s", "short": "%s", "date": "%s", "version": "%s", "build": %s, "dirty": %s }\n' "$sha" "$short" "$date" "$version" "$count" "$dirty" > "$DEST/app-build.json"

# 5. the build number (Xcode only: the processed Info.plist is this phase's declared input)
if [[ -z $DRY ]]; then /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $count" "$TARGET_BUILD_DIR/$INFOPLIST_PATH"; fi

# 6. one line
kb=$(du -sk "$DEST" | cut -f1)
printf 'site: %d files, %.1f MB, %s (v%s, build %s)%s\n' "${#files}" "$(( kb / 1024.0 ))" "$short" "$version" "$count" "$([[ $dirty == true ]] && print -n ' — DIRTY (SYNTH_ALLOW_DIRTY)')"
