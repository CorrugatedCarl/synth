#!/bin/zsh
# tools/app-smoke.sh — the iPad app's headless smoke (IMPL-A §9.2): build (Debug, simulator, unsigned) → install → launch with
# `-smoke <run>` → the Debug shell drives the page (SmokeSteps.swift / Smoke.js) and logs JSON lines → a timed relaunch reads the
# storage back → screenshot → PASS / FAIL with the failing keys. Run alone (one xcodebuild at a time); the bundle is HEAD's (A3):
# commit first. Needs node on the Mac's PATH for the evaluation (the Xcode build phase itself needs none).
#   tools/app-smoke.sh [--udid <udid>] [--no-build] [--run <label>] [--base] [--mode bg|log] [--keep]
#   --base   gate the native half only (the base site has no SYNTH_SHELL.probe / save, no shell-aware pwa.js, Google Fonts links):
#            launch, the request log, the guard (the blocked Google loads are its positive control), storage, WKDownload, the bridge
#            through N's Debug JS, the screenshot; the W1 / W2 criteria are reported as pending. Full green is the integration's.
#   --mode bg  the §5.2 measure instead of the steps: a held note + an own context, state every 2 s for 60 s; background the app
#            meanwhile (xcrun simctl launch <udid> com.apple.mobilesafari, then … com.domlavin.synth to come back) and read the log.
#   --mode log a by-hand review (fix R1-F5): install and launch with `-smoke <run> -smokeMode log` — the log only (requests,
#            navigation, console, scene, dialogs, downloads, sheets), nothing driven: real sheets, real dialogs; the script exits
#            at once and prints the log's path (each launch with the same label appends to it).
#   The bundle id is the built app's (a Local.xcconfig may override it — IMPL-A §1.2).
# Output: $SYNTH_SMOKE_DIR (default $TMPDIR/synth-app-smoke): app-build/ (SYMROOT), <run>.jsonl, <run>b.jsonl, <run>.png, rss-<run>.log.
set -uo pipefail

UDID=6F9F14F6-CF76-4FDF-95BD-6890E098069B
BID=com.domlavin.synth
BUILD=1; BASE=0; MODE=""; RUN=$(date +%H%M%S); KEEP=0
ROOT=${0:A:h:h}
OUT=${SYNTH_SMOKE_DIR:-${TMPDIR:-/tmp}/synth-app-smoke}
while (( $# )); do
  case $1 in
    --udid) UDID=$2; shift 2 ;;
    --no-build) BUILD=0; shift ;;
    --run) RUN=$2; shift 2 ;;
    --base) BASE=1; shift ;;
    --mode) MODE=$2; shift 2 ;;
    --keep) KEEP=1; shift ;;
    *) print -u2 "unknown argument: $1"; exit 2 ;;
  esac
done
mkdir -p "$OUT"
APP=$OUT/app-build/Debug-iphonesimulator/SYNTH.app
say() { print -- "smoke: $*"; }
fail() { print -u2 -- "smoke: FAIL — $*"; exit 1; }

# 1. build (≈ 1 min cold)
if (( BUILD )); then
  say "building (Debug, iphonesimulator, unsigned) → $OUT/xcodebuild-$RUN.log"
  xcodebuild -project "$ROOT/app/ios/SYNTH.xcodeproj" -scheme SYNTH -configuration Debug -sdk iphonesimulator \
    -destination "id=$UDID" CODE_SIGNING_ALLOWED=NO SYMROOT="$OUT/app-build" OBJROOT="$OUT/app-build/obj" build > "$OUT/xcodebuild-$RUN.log" 2>&1 \
    || { grep -E 'error:|site:' "$OUT/xcodebuild-$RUN.log" | head -20; fail "xcodebuild (see $OUT/xcodebuild-$RUN.log)"; }
  grep -E '^site:' "$OUT/xcodebuild-$RUN.log" | tail -1
fi
[[ -d $APP ]] || fail "no app at $APP (build first)"
BID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist" 2>/dev/null) || BID=com.domlavin.synth

# the simulator (a stale CoreSimulatorService can refuse the runtime: kill it and retry — spike §6)
if ! xcrun simctl list devices | grep "$UDID" | grep -q Booted; then
  xcrun simctl boot "$UDID" 2>/dev/null || { killall com.apple.CoreSimulator.CoreSimulatorService 2>/dev/null; sleep 3; xcrun simctl boot "$UDID" || fail "cannot boot $UDID"; }
fi
xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1

# 2. install, the log location
xcrun simctl install "$UDID" "$APP" || fail "simctl install"
xcrun simctl terminate "$UDID" "$BID" 2>/dev/null
DATA=$(xcrun simctl get_app_container "$UDID" "$BID" data) || fail "no data container"
LOGDIR=$DATA/Library/Caches/smoke
mkdir -p "$LOGDIR"
rm -f "$LOGDIR/$RUN.jsonl" "$LOGDIR/${RUN}b.jsonl"

if [[ $MODE == log ]]; then   # (fix R1-F5) the log for a by-hand pass: no steps, no sheet or dialog closed by itself
  xcrun simctl launch "$UDID" "$BID" -smoke "$RUN" -smokeMode log >/dev/null || fail "simctl launch $RUN"
  say "log mode ($BID): nothing driven — use the app by hand; the log: $LOGDIR/$RUN.jsonl"
  say "relaunch into the same log: xcrun simctl launch $UDID $BID -smoke $RUN -smokeMode log"
  exit 0
fi

# the WebContent RSS sampler (every 0.5 s → rss-<run>.log: "t kB"): the max over the simulator's com.apple.WebKit.WebContent
# processes — children of launchd_sim (the Mac's own WebContent is a child of launchd); with several devices booted it is the
# max over all of them (a prewarmed spare may exist too — §9.2: gated loosely)
RSS=$OUT/rss-$RUN.log; : > "$RSS"
webcontent_rss() {
  ps -axo ppid=,rss=,comm= | awk -v L=" $(pgrep -x launchd_sim | tr '\n' ' ') " '$0 ~ /WebKit\.WebContent/ && index(L, " " $1 " ") && $2 > m { m = $2 } END { print m + 0 }'
}
( while :; do print -- "$(date +%s.%N | cut -c1-14) $(webcontent_rss)"; sleep 0.5; done ) >> "$RSS" &
SAMPLER=$!
trap 'kill $SAMPLER 2>/dev/null' EXIT

# 3. launch <run>, wait for the done line
launch_wait() { # $1 run label, $2 timeout s, $@ extra launch args
  local run=$1 to=$2; shift 2
  local log=$LOGDIR/$run.jsonl; rm -f "$log"
  xcrun simctl launch "$UDID" "$BID" -smoke "$run" "$@" >/dev/null || fail "simctl launch $run"
  local i
  for i in $(seq 1 "$to"); do sleep 1; [[ -f $log ]] && grep -q '"k":"done"' "$log" && break; done
  [[ -f $log ]] || fail "no log after ${to}s: $log"
  cp "$log" "$OUT/$run.jsonl"
  say "$run: $(wc -l < "$log" | tr -d ' ') lines in ${i}s → $OUT/$run.jsonl"
}
if [[ $MODE == bg ]]; then
  say "mode bg: now background the app (xcrun simctl launch $UDID com.apple.mobilesafari; later xcrun simctl launch $UDID $BID)"
  launch_wait "$RUN" 100 -smokeMode bg
  xcrun simctl io "$UDID" screenshot "$OUT/$RUN.png" >/dev/null 2>&1
  node - "$OUT/$RUN.jsonl" <<'EOF'
const fs = require('fs'); const L = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map(l => JSON.parse(l));
for (const l of L) if (['scene', 'vis', 'bg', 'engine', 'key', 'bgStart'].includes(l.k)) console.log(l.t, l.k, JSON.stringify(Object.fromEntries(Object.entries(l).filter(([k]) => !['k', 't', 'at', 'probe', 'vis'].includes(k)))).slice(0, 220));
EOF
  exit 0
fi
launch_wait "$RUN" 150
xcrun simctl terminate "$UDID" "$BID" 2>/dev/null; sleep 1
launch_wait "${RUN}b" 40
xcrun simctl io "$UDID" screenshot "$OUT/$RUN.png" >/dev/null 2>&1
kill $SAMPLER 2>/dev/null; trap - EXIT
APP_KB=$(du -sk "$APP" | cut -f1)
HEAD_SHA=$(git -C "$ROOT" rev-parse HEAD)
RSS_MAX_KB=$(awk 'NF == 2 && $2 > m { m = $2 } END { print m + 0 }' "$RSS")
(( KEEP )) || true

# 4. evaluate (§9.2's pass list; --base gates the native half and reports the rest as pending)
node - "$OUT/$RUN.jsonl" "$OUT/${RUN}b.jsonl" "$BASE" "$APP_KB" "$HEAD_SHA" "$RSS_MAX_KB" "$RSS" <<'EOF'
const fs = require('fs');
const [, , fa, fb, baseFlag, appKb, head, rssMaxKb, rssFile] = process.argv, base = baseFlag === '1';
const lines = f => fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return { k: 'bad', raw: l }; } });
const A = lines(fa), B = lines(fb), of = (L, k) => L.filter(l => l.k === k), fails = [], pend = [], info = [];
const gate = (ok, key, detail) => { (ok ? info : fails).push(key + (detail ? ': ' + detail : '')); };
const pending = (ok, key, detail) => { (ok ? info : pend).push(key + (detail ? ': ' + detail : '')); };
const status = stage => of(A, 'status').find(s => s.stage === stage) || {};
// launch, navigation
const navA = of(A, 'nav').find(n => n.finished), navB = of(B, 'nav').find(n => n.finished), launchB = of(B, 'launch')[0] || {};
gate(!!navA && !!navB, 'nav.finished', navA && navB ? `${navA.t} ms (first run), ${navB.t} ms (relaunch)` : 'missing');
gate(!navB || navB.t <= 2000, 'launch ≤ 2000 ms (relaunch)', navB && navB.t + ' ms');
gate(of(A, 'guard').some(g => g.compiled), 'content rule list compiled');
gate(!of(A, 'nav').some(n => n.terminated) && !of(A, 'nav').some(n => n.fail || n.provisionalFail), 'no navigation failure / termination');
// the request log: only synth://, no 404 except the deliberate ?smoke= probes, ≥ 98
const reqs = of(A, 'req'), bad404 = reqs.filter(r => r.status !== 200 && !/[?&]smoke=/.test(r.url)), foreign = reqs.filter(r => !/^synth:\/\/app\//.test(r.url) && !/[?&]smoke=/.test(r.url));
gate(reqs.length >= 98, 'requests ≥ 98', reqs.length + ' (' + reqs.filter(r => r.status === 200).length + ' × 200)');
gate(bad404.length === 0, 'no 404', bad404.map(r => r.url).join(' '));
gate(foreign.length === 0, 'only synth://app/ requests', foreign.map(r => r.url).join(' '));
const probes = (of(A, 'probe404')[0] || {}).probes || [];
gate(probes.filter(p => /smoke=404/.test(p.u)).every(p => p.status === 404 || p.error), '404 probes (Index.html, panels/, nope.js, other host)', JSON.stringify(probes).slice(0, 300));
// the guard's negative probe: every attempt failed
const g = of(A, 'guard').find(x => x.attempts) || { attempts: [] };
gate(g.attempts.length >= 5 && g.attempts.every(a => a.failed), 'negative network probe all failed (online ' + g.online + ')', g.attempts.map(a => a.what + ':' + (a.failed ? 'blocked' : 'REACHED ' + a.result)).join(' '));
// console: no errors; the capture-phase load errors — on the base tree the blocked Google links are the positive control
const con = of(A, 'console'), loads = con.filter(c => c.level === 'load' && !/[?&]smoke=/.test(c.src || '')), errs = con.filter(c => c.level !== 'load' && c.level !== 'warn');
gate(errs.length === 0, 'no console errors / unhandled rejections', errs.map(c => c.level + ' ' + (c.msg || '').slice(0, 120)).join(' | '));
if (base) gate(loads.some(l => /fonts\.g/.test(l.src)), 'positive control: the Google font links fail to load', loads.map(l => l.tag + ' ' + l.src).join(' '));
else gate(loads.length === 0, 'no failed element loads', loads.map(l => l.tag + ' ' + l.src).join(' '));
if (con.some(c => c.level === 'warn')) info.push('console.warn × ' + con.filter(c => c.level === 'warn').length + ': ' + con.filter(c => c.level === 'warn').map(c => (c.msg || '').slice(0, 80)).join(' | '));
// the page
const s6 = status('6s'), se = status('engine');
gate(s6.secure === true && s6.protocol === 'synth:', 'secure context on synth:', `secure ${s6.secure} protocol ${s6.protocol} origin ${s6.origin}`);
gate(s6.shell === true, 'SYNTH_SHELL present', 'keys ' + JSON.stringify(s6.shellKeys));
gate((s6.keys || 0) >= 24, 'keys ≥ 24', s6.keys + ' at ' + JSON.stringify(s6.inner));
gate(s6.build && s6.build.dirty === false && s6.build.sha === head, 'app-build.json: not dirty, sha = HEAD', JSON.stringify(s6.build));
info.push('insets ' + JSON.stringify(s6.insets) + ', dpr ' + s6.dpr + ', inner ' + JSON.stringify(s6.inner) + ', standalone ' + s6.standalone + ', sw ' + s6.sw);
pending(s6.install === true && s6.fs === true && s6.toast !== false, 'W1: Install / Full screen / toast hidden', `install ${s6.install} fs ${s6.fs} toast ${s6.toast}`);
pending(Array.isArray(s6.fonts) && s6.fonts.includes('Inter:loaded') && s6.fonts.includes('JetBrains Mono:loaded') && s6.interW !== s6.fallbackW, 'W2: Inter / JetBrains Mono loaded from the bundle', JSON.stringify(s6.fonts) + ` interW ${s6.interW} vs ${s6.fallbackW}, mono ${s6.monoW} vs ${s6.monoFallbackW}`);
pending(of(A, 'ready').length === 1, 'W1: { t: ready } posted once', of(A, 'ready').length + '');
// the engine step (keydown KeyA held 1 s): the probe (W1) or, on the base tree, the DSP load text
const p = se.probe || null;
if (p) gate(p.ctx === 'running' && p.nodes >= 1 && p.held >= 1 && p.peak > 0.01 && /DSP load \d+%/.test(p.cpu || ''), 'engine: ctx running, a held note sounding', JSON.stringify(p));
else pending(false, 'W1: SYNTH_SHELL.probe() for the engine step', 'cpu text while held: ' + JSON.stringify(se.cpu));
pending(of(A, 'engine').some(e => e.on === true), 'W1: { t: engine, on: true } posted', of(A, 'engine').map(e => e.on).join(','));
const avs = of(A, 'avsession'); info.push('avsession ' + avs.map(a => `${a.stage}: ${a.category} opts ${a.options} mode ${a.mode} sr ${a.sampleRate} io ${a.ioBufferS} out ${a.outputLatencyS} route ${JSON.stringify(a.route)}`).join(' | '));
// storage round-trip
const st = of(B, 'storage')[0] || {}, run = (of(A, 'launch')[0] || {}).run;
gate(st.ls === run && st.idb === run, 'storage round-trip (localStorage + IndexedDB across relaunch)', JSON.stringify(st));
// files out
const dls = of(A, 'download').filter(d => d.name && d.sha256), pageDl = of(A, 'download').filter(d => d.size && d.sha256 && !d.name), bridges = of(A, 'bridge'), sheets = of(A, 'sheet'), save100 = of(A, 'save100')[0] || {}, twice = of(A, 'saveTwice')[0] || {};
const dl1 = dls.find(d => d.size === 1024), dl100 = dls.find(d => d.size === 104857600), pg1 = pageDl.find(d => d.size === 1024), pg100 = pageDl.find(d => d.size === 104857600);
gate(!!dl1 && !!pg1 && dl1.sha256 === pg1.sha256, 'WKDownload of a 1 KB blob: <a download> (wk.js shape) → file, bytes intact', dl1 ? `${dl1.name} ${dl1.ms} ms` : 'no download line');
gate(!!dl100 && !!pg100 && dl100.sha256 === pg100.sha256, 'WKDownload of a 100 MB blob: bytes intact', dl100 ? `${dl100.ms} ms` : 'no download line');
const b100 = bridges.find(b => b.name === 'smoke-100.bin');
gate(!!b100 && b100.sha256 === save100.sha256 && b100.size === 104857600, 'bridge: 100 MB in 2 MiB chunks, SHA-256 equal', b100 ? `${b100.ms} ms native file→end, ${save100.transferMs} ms page file→end sent (toBase64 ${save100.toBase64}), ${save100.ms} ms to the sheet's close` : 'no bridge line ' + JSON.stringify(save100).slice(0, 200));
gate(!!save100.transferMs && save100.transferMs <= 5000, 'bridge: 100 MB ≤ 5 s', save100.transferMs + ' ms');
gate(bridges.filter(b => /smoke-[ab]\.json/.test(b.name)).length === 2 && Array.isArray(twice.replies) && twice.replies.length === 2, 'two saves back to back → two files', JSON.stringify(twice).slice(0, 200));
const fsave = sheets.find(s => /\.synth\.json$/.test(s.name)) || bridges.find(b => /\.synth\.json$/.test(b.name)) || dls.find(d => /\.synth\.json$/.test(d.name));
gate(!!fsave, 'Save (#fSave) → a .synth.json reached native', fsave ? JSON.stringify(fsave).slice(0, 160) : 'none');
gate(sheets.length >= 6, 'share sheets presented in turn (≥ 6)', sheets.map(s => s.name + ':' + s.done).join(' '));
const dialogs = of(A, 'dialog'); gate(dialogs.some(d => d.type === 'confirm'), 'JS confirm (≡ → New) reached the WKUIDelegate', dialogs.map(d => d.type + ' "' + (d.message || '').slice(0, 60) + '"').join(' | '));
// (fix R1-F4) WebKit suspends the page's context while a JS dialog is up; the dialog's close resumes it ({ t: 'resume' } → wake()):
// the end status, a second after the confirm's Cancel, finds the engine running without a tap
const sEnd = status('end');
if (sEnd.probe) gate(sEnd.probe.ctx === 'running', 'after the ≡ → New dialog: the engine running again, no tap', `ctx ${sEnd.probe.ctx}, cpu ${JSON.stringify(sEnd.probe.cpu)}`);
else pending(false, 'W1: SYNTH_SHELL.probe() after the dialog', 'cpu ' + JSON.stringify(sEnd.cpu));
// budgets
gate(+appKb <= 16 * 1024, 'the .app ≤ 16 MB', (appKb / 1024).toFixed(1) + ' MB');
{ // WebContent RSS (the sampler, 0.5 s): at the engine step (§9.4's gate, loose — jetsam is device-only) and the run's max
  // (dominated by the smoke's own 100 MB blobs); the 100 MB bridge save's rise over its level just before (the mark) — recorded
  // for the lead's bridge-vs-WKDownload decision (§4.1: the chunks' slices and base64 strings are GC garbage the process keeps)
  const S = fs.existsSync(rssFile) ? fs.readFileSync(rssFile, 'utf8').trim().split('\n').map(l => l.split(' ').map(Number)).filter(x => x.length === 2) : [];
  const t0 = (of(A, 'launch')[0] || {}).at ? Date.parse(of(A, 'launch')[0].at) / 1000 - of(A, 'launch')[0].t / 1000 : 0;
  const near = line => { const t = t0 + line.t / 1000, v = S.filter(x => Math.abs(x[0] - t) <= 0.6).map(x => x[1]); return v.length ? Math.max(...v) : null; };
  const atEngine = se.t ? near(se) : null;
  // the engine's own memory (engine step − the +2 s boot level) is what the gate watches: the simulator's absolute WebContent level
  // drifts with its state (the same commit read 583 then 620 MB at the engine step, ≈ 425 then 500 MB at boot — fixer N); a
  // 1 GB absolute ceiling stays as the blow-up guard (jetsam is device-only, §11)
  const s2 = status('2s'), atBoot = s2.t ? near(s2) : null;
  gate(atEngine == null || atEngine <= 1024 * 1024, 'WebContent RSS at the engine step ≤ 1 GB (blow-up guard)', atEngine == null ? 'no sample' : `${(atEngine / 1024).toFixed(0)} MB (run max ${(rssMaxKb / 1024).toFixed(0)} MB)`);
  gate(atEngine == null || atBoot == null || atEngine - atBoot <= 250 * 1024, 'the engine adds ≤ 250 MB to WebContent (engine step − boot)', atEngine == null || atBoot == null ? 'no sample' : `+${((atEngine - atBoot) / 1024).toFixed(0)} MB (${(atBoot / 1024).toFixed(0)} → ${(atEngine / 1024).toFixed(0)} MB)`);
  const mark = of(A, 'mark').find(m => m.what === 'save100-blob-ready');
  if (mark && b100 && S.length) {
    const t1 = t0 + mark.t / 1000, t2 = t0 + b100.t / 1000;
    const before = S.filter(x => x[0] <= t1 && x[0] > t1 - 3).map(x => x[1]), after = S.filter(x => x[0] >= t1 && x[0] <= t2 + 3).map(x => x[1]);
    if (before.length && after.length) { const b = Math.max(...before), d = Math.max(...after); info.push(`bridge: WebContent ${(b / 1024).toFixed(0)} → ${(d / 1024).toFixed(0)} MB (+${((d - b) / 1024).toFixed(0)}) over the 100 MB save (recorded; §4.1's +150 MB budget ${d - b <= 150 * 1024 ? 'met' : 'exceeded'})`); }
  }
}
const bad = A.filter(l => l.k === 'bad'); if (bad.length) fails.push('unparsable log lines: ' + bad.length);
for (const i of info) console.log('  ok   ' + i);
for (const p of pend) console.log('  pend ' + p + (base ? '  (not gated with --base)' : ''));
for (const f of fails) console.log('  FAIL ' + f);
console.log((fails.length || (!base && pend.length)) ? `smoke: FAIL (${fails.length} failing${pend.length ? ', ' + pend.length + ' pending' : ''})` : `smoke: PASS${base ? ' (--base: native half; ' + pend.length + ' pending for W1 / W2)' : ''}`);
console.log(`smoke: logs ${fa} ${fb}; screenshot ${fa.replace(/\.jsonl$/, '.png')}; rss ${rssFile}`);
process.exit(fails.length || (!base && pend.length) ? 1 : 0);
EOF
