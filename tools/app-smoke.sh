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
#   --mode midicold  IMPL-B §8 step 11 (recorded): the engine never started, the app backgrounded by this script, one MIDI note.
#   The MIDI steps (IMPL-B §8, SmokeMidi.swift) run inside the main run; steps 8 (the gate), 8b (the background task, fix R1-F1) and
#   midicold ask for background round trips: on each `"step":"ready"` log line the script sends the app behind Safari, on each
#   `"step":"bgdone"` it brings it back (counted — several per run). The relaunch half runs on `-smokeMode relaunch` (fix R1-F6: a
#   label ending in "b" is just a label). The bundle id is the built app's (a Local.xcconfig may override it — IMPL-A §1.2).
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
  local i bg=0 fg=0 r d
  for i in $(seq 1 "$to"); do
    sleep 1; [[ -f $log ]] || continue
    grep -q '"k":"done"' "$log" && break
    # IMPL-B §8 steps 8, 8b, 11: the Debug shell asks for background round trips — behind Safari on each `ready`, back on each `bgdone`
    r=$(grep -c '"step":"ready"' "$log"); d=$(grep -c '"step":"bgdone"' "$log")
    if (( r > bg )); then bg=$r; say "$run: → background (Safari) #$bg"; xcrun simctl launch "$UDID" com.apple.mobilesafari >/dev/null 2>&1; fi
    if (( d > fg )); then fg=$d; say "$run: → foreground #$fg"; xcrun simctl launch "$UDID" "$BID" -smoke "$run" "$@" >/dev/null 2>&1; fi
  done
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
if [[ $MODE == midicold ]]; then   # IMPL-B §8 step 11: recorded, not gated — the simulator need not match the iPad
  launch_wait "$RUN" 90 -smokeMode midicold
  node - "$OUT/$RUN.jsonl" <<'EOF'
const fs = require('fs'); const L = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map(l => JSON.parse(l));
for (const l of L) if (['scene', 'vis', 'midiCold', 'midiColdBg', 'midiColdFg', 'midiOpen', 'midiGate', 'midiBatch', 'engine', 'status'].includes(l.k))
  console.log(l.t, l.k, JSON.stringify(Object.fromEntries(Object.entries(l).filter(([k]) => !['k', 't', 'at', 'vis', 'resources', 'fonts', 'shellKeys', 'build', 'inputs', 'outputs'].includes(k)))).slice(0, 260));
EOF
  exit 0
fi
launch_wait "$RUN" 200
xcrun simctl terminate "$UDID" "$BID" 2>/dev/null; sleep 1
launch_wait "${RUN}b" 40 -smokeMode relaunch
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
// ---- MIDI (IMPL-B §8): the native half's gates; the page-side gates pend on lane M's recorder stub (midiOpen.stub), probe().midi on lane W
{
  const f3 = x => typeof x === 'number' ? (Math.round(x * 1000) / 1000).toString() : String(x);
  const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : NaN; };
  const mo = of(A, 'midiOpen')[0] || {}, stub = !!mo.stub, pageGate = stub ? pending : gate, pageTag = stub ? ' (stub: pending lane S)' : '';
  const ml = of(A, 'midi').find(l => 'client' in l) || {}, smk = ml.smoke || {};
  gate(ml.client === 0 && ml.inPort === 0 && ml.outPort === 0, 'MIDI day 1: client, input and output port created in the simulator (its own MIDIServer)', `client ${ml.client} in ${f3(ml.createMs)} ms, in ${ml.inPort} out ${ml.outPort}; ${ml.sources} sources / ${ml.destinations} destinations / ${ml.devices} devices before ours`);
  gate(ml.dest === 0 && ml.destUid, 'MIDI: the virtual destination "SYNTH" ("From other apps") created, uid persisted', `dest ${ml.dest} uid ${ml.destUid}`);
  gate(smk.src === 0 && smk.dst === 0, 'MIDI smoke mode: server (in-app loopback) — "SYNTH smoke in" / "SYNTH smoke out" created', JSON.stringify(smk));
  gate(mo.ok === true, 'MIDI: the page opened access (requestMIDIAccess → { t: midi } → the reply)', `${mo.ms} ms, stub ${stub}, ${(mo.inputs || []).length} inputs ${(mo.outputs || []).length} outputs`);
  const names = l => (l || []).map(p => p.name), st1 = of(A, 'midiStatus')[0] || {}, inN = names(st1.inputs), outN = names(st1.outputs);
  gate(inN.includes('SYNTH smoke in') && inN.includes('From other apps'), 'step 1: inputs list "SYNTH smoke in" and "From other apps"', JSON.stringify(inN));
  gate(outN.includes('SYNTH smoke out') && !outN.includes('From other apps'), 'step 1: outputs list "SYNTH smoke out", never "From other apps"', JSON.stringify(outN));
  pageGate(typeof st1.button === 'string' && /^MIDI: /.test(st1.button) && /SYNTH smoke in/.test(st1.button) && /From other apps/.test(st1.button) && st1.disabled === false, 'step 1: the #midi button connected by itself and names the ports' + pageTag, JSON.stringify(st1.button));
  const srcUid = smk.srcUid, hex = e => [e.st, e.d1, e.d2].map(x => x.toString(16).padStart(2, '0')).join('');
  const logOf = (k, i = 0) => ((of(A, k)[i] || {}).log) || [], msgs = (k, i = 0) => logOf(k, i).filter(e => e.k === 'msg');
  // step 2: the note
  const w = of(A, 'midiWait')[0] || {}, t2 = msgs('midiTake'), tk2 = of(A, 'midiTake')[0] || {};
  gate(w.got >= 1 && t2.some(e => e.st === 0x90 && e.d1 === 0x3c && e.d2 === 0x64) && t2.some(e => e.st === 0x80 && e.d1 === 0x3c), 'step 2: the note on / off reached the page through the shim', `waited ${w.waited} ms for the first, ${t2.length} messages`);
  pageGate(w.held >= 1 && w.peak > 0.01 && w.ctx === 'running', 'step 2: the MIDI note sounds (held ≥ 1, peak > 0.01, ctx running)' + pageTag, JSON.stringify({ held: w.held, peak: w.peak, ctx: w.ctx }));
  pageGate(tk2.held === 0, 'step 2: the note-off → held 0' + pageTag, 'held ' + tk2.held);
  pending(w.midi && w.midi.n >= 1, 'step 2: probe().midi.n ≥ 1 (lane W)', JSON.stringify(w.midi));
  // step 3: controls
  const t3 = msgs('midiCtlTake').map(hex), ct = of(A, 'midiCtlTake')[0] || {};
  gate(['b00100', 'b0017f', 'e00040', 'e07f7f'].every(s => t3.includes(s)) && t3.indexOf('b00100') < t3.indexOf('b0017f') && t3.indexOf('e00040') < t3.indexOf('e07f7f'), 'step 3: CC 1 0 / 127 and bend centre / max reached the page in order', t3.join(' '));
  pending(ct.midi && ct.midi.wheel === 1 && ct.midi.bend > 0.98, 'step 3: probe().midi wheel 1, bend ≈ 1 (lane W)', JSON.stringify(ct.midi));
  // step 4: the common clock, the per-call cost (day 1)
  const ck = of(A, 'midiClock')[0] || {}, off = ck.offset;   // host ms − page ms
  gate(typeof off === 'number' && ck.rtt < 20, 'step 4: the common clock (host − page) from the best of 20 round trips', `offset ${f3(off)} ms ± ${f3(Math.max(0.5, ck.rtt / 2))} (best rtt ${f3(ck.rtt)} ms at a 1 ms performance.now() quantum)`);
  const cc = of(A, 'midiCallCost')[0] || {};
  gate(cc.n === 1000 && cc.p99 < 20, 'day 1: a tiny callAsyncJavaScript × 1000 — recorded (p99 > 5 ms would raise §3.2\'s streaming fallback)', `mean ${f3(cc.mean)} p50 ${f3(cc.p50)} p90 ${f3(cc.p90)} p99 ${f3(cc.p99)} max ${f3(cc.max)} ms`);
  if (cc.p99 > 5) info.push('NOTE: the per-call p99 is above 5 ms (§3.2): the streaming fallback is to be considered');
  // step 5: the 1 kHz burst — in order, ≤ 520 calls, 0 dropped; transit and timestamp error against the sender's host times
  const K = (() => { const d = of(A, 'midiBatch').filter(b => typeof b.h === 'number').map(b => b.h - b.t); return d.length ? pct(d, 0.5) : null; })();   // host ms − log ms
  const bs = of(A, 'midiBurstSent')[0] || {}, bj = of(A, 'midiBurst')[0] || {}, bl = msgs('midiBurst').filter(e => e.st === 0xb0 && e.d1 === 74);
  const inOrder = bl.every((e, i) => e.d2 === (i & 0x7f));
  gate(bl.length === 1000 && inOrder, 'step 5: 1 000 / 1 000 CC 74 received in order', `${bl.length} received, in order ${inOrder}, sender span ${f3(bs.spanMs)} ms`);
  const bWin = of(A, 'midiBatch').filter(b => b.kind === 'batch' && b.t >= bs.t - (bs.spanMs || 0) - 30 && b.t <= bj.t);
  gate(bWin.length > 0 && bWin.length <= 520, 'step 5: ≤ 520 calls for the 1 kHz burst (the 2 ms minimum interval)', `${bWin.length} calls, sizes ${pct(bWin.map(b => b.n), 0)}…${pct(bWin.map(b => b.n), 1)} (p50 ${pct(bWin.map(b => b.n), 0.5)}), rtt p50 ${f3(pct(bWin.map(b => b.rtt), 0.5))} p99 ${f3(pct(bWin.map(b => b.rtt), 0.99))} ms`);
  gate(bWin.reduce((s, b) => s + (b.dropped || 0), 0) === 0, 'step 5: dropped = 0 over the burst', bWin.reduce((s, b) => s + (b.dropped || 0), 0) + '');
  const stats = (recvd, sends) => {   // transit = recv − (hostSend − off); tsErr = ts − (hostSend − off) (the stub's ts is host ms: − hostSend)
    const tr = [], te = []; recvd.forEach((e, i) => { if (i < sends.length) { tr.push(e.recv - (sends[i] - off)); te.push(stub ? e.ts - sends[i] : e.ts - (sends[i] - off)); } });
    return { tr, te, n: tr.length };
  };
  if (bl.length && Array.isArray(bs.sends)) {
    const s = stats(bl, bs.sends), q = (() => { const r = [...new Set(bl.map(e => e.recv))].sort((a, b) => a - b), d = r.slice(1).map((v, i) => v - r[i]).filter(v => v > 0); return d.length ? Math.min(...d) : NaN; })();
    gate(pct(s.tr, 0.5) <= 6 && pct(s.tr, 0.99) <= 16, 'step 5: one-way transit of the 1 kHz stream (target p50 ≤ 3, p99 ≤ 8 — recorded; gated loosely at 2×)', `p50 ${f3(pct(s.tr, 0.5))} p99 ${f3(pct(s.tr, 0.99))} max ${f3(pct(s.tr, 1))} ms; performance.now() quantum ${f3(q)} ms`);
    gate(pct(s.te.map(Math.abs), 0.95) <= 2, 'step 5: timestamp error p95 ≤ 2 ms (B6)', `p50 ${f3(pct(s.te, 0.5))} p95 |e| ${f3(pct(s.te.map(Math.abs), 0.95))} min ${f3(pct(s.te, 0))} max ${f3(pct(s.te, 1))} ms`);
  } else fails.push('step 5: no burst data to join');
  // step 5b: the busy page — transit up to ≈ 150 ms, the stamps still right (the shim's minimum filter)
  const bus = of(A, 'midiBusySent')[0] || {}, busyJs = of(A, 'midiBusy')[0] || {}, bm = msgs('midiBusyTake').filter(e => e.st === 0x90 && e.d1 >= 0x30 && e.d1 <= 0x34);
  if (bm.length === 5 && Array.isArray(bus.sends)) {
    const s = stats(bm, bus.sends);
    info.push(`step 5b: the page spun ${busyJs.spun} ms; the 5 notes' transit ${s.tr.map(f3).join(' / ')} ms (delayed by the spin, as in Chrome)`);
    gate(pct(s.te.map(Math.abs), 0.95) <= 2, 'step 5b: timestamp error p95 ≤ 2 ms with the page\'s thread blocked 150 ms (B6, §1.3)', `errors ${s.te.map(f3).join(' / ')} ms`);
  } else fails.push('step 5b: expected 5 notes through the busy page, got ' + bm.length);
  // step 6: hot-plug — the release before the disconnect, the port back on re-creation
  const hp = logOf('midiHotplugTake'), hpSt = of(A, 'midiHotplug')[0] || {}, hp2 = of(A, 'midiHotplug2')[0] || {};
  const iRel = hp.findIndex(e => e.k === 'msg' && e.uid === srcUid && e.st === 0xb0 && e.d1 === 123), iDis = hp.findIndex(e => e.k === 'state' && e.uid === srcUid && e.state === 'disconnected');
  gate(iRel >= 0 && iDis >= 0 && iRel < iDis, 'step 6: the disposed source\'s CC 123 reached the page BEFORE its disconnect (one ordered queue)', `release at ${iRel}, disconnect at ${iDis}, ${hp.length} entries`);
  gate((hpSt.inputs || []).some(p => p.name === 'SYNTH smoke in' && p.state === 'disconnected') && !(hpSt.inputs || []).some(p => p.name === 'SYNTH smoke in' && p.state === 'connected'), 'step 6: "SYNTH smoke in" disconnected in the access (kept in its Map)', JSON.stringify(hpSt.inputs));
  pageGate(hpSt.held === 0 && typeof hpSt.button === 'string' && !/SYNTH smoke in/.test(hpSt.button), 'step 6: the held note released (held 0) and the button no longer names it' + pageTag, `held ${hpSt.held}, button ${JSON.stringify(hpSt.button)}`);
  gate((hp2.inputs || []).some(p => p.name === 'SYNTH smoke in' && p.state === 'connected'), 'step 6: re-created → "SYNTH smoke in" connected again', JSON.stringify(hp2.inputs));
  pageGate(typeof hp2.button === 'string' && /SYNTH smoke in/.test(hp2.button), 'step 6: the button names it again' + pageTag, JSON.stringify(hp2.button));
  // step 7: MIDI out
  const outJs = of(A, 'midiOutSend')[0] || {}, outN8 = of(A, 'midiOut').find(l => l.bytes) || {};
  gate(Array.isArray(outN8.bytes) && outN8.bytes.includes('90247f') && typeof outJs.sentAt === 'number' && outN8.got - (outJs.sentAt + off) <= 50, 'step 7: the page\'s send to "SYNTH smoke out" reached the destination (90 24 7F) within 50 ms', outN8.bytes ? `${JSON.stringify(outN8.bytes)}, ${f3(outN8.got - (outJs.sentAt + off))} ms page send → native receive` : JSON.stringify(outJs).slice(0, 160));
  // step 7b: future stamps — a virtual source's note 300 ms ahead reaches the page at its time (held by the server, or by us: midiHeld);
  // a note sent INTO "SYNTH" 300 ms ahead arrives from "From other apps" at its time; one stamped 0 at once
  const fut = of(A, 'midiFuture'), fm = msgs('midiFutureTake'), held = of(A, 'midiHeld');
  const fAt = (kind, note) => { const s = fut.find(l => l.kind === kind) || {}, m = fm.find(e => e.st === 0x90 && e.d1 === note); return s.send && m ? { d: m.recv - (s.send + s.ahead - off), uid: m.uid, te: m.ts - (s.send + s.ahead - off) } : null; };
  const fs1 = fAt('source', 0x41), fd = fAt('dest', 0x42), fn = fAt('destNow', 0x43);
  gate(fs1 && fs1.d >= -2 && fs1.d <= 12, 'step 7b: a virtual source\'s note stamped 300 ms ahead reached the page at its time, not early', fs1 ? `${f3(fs1.d)} ms after its stamp; ${held.length ? 'held natively (the server delivered it at once — midiHeld ' + f3(held[0].aheadMs) + ' ms ahead)' : 'the server held it (no midiHeld line)'}; ts error ${f3(fs1.te)} ms` : 'no data');
  gate(fd && fd.d >= -2 && fd.d <= 12 && String(fd.uid) === String(ml.destUid), 'step 7b: a note sent INTO "SYNTH" 300 ms ahead arrived from "From other apps" at its time (advance schedule 0: the server delivers it)', fd ? `${f3(fd.d)} ms after its stamp, uid ${fd.uid} (SYNTH ${ml.destUid}); ts error ${f3(fd.te)} ms` : 'no data');
  gate(fn && fn.d >= -2 && fn.d <= 12 && String(fn.uid) === String(ml.destUid), 'step 7b: a note sent INTO "SYNTH" stamped 0 arrived at once', fn ? `${f3(fn.d)} ms` : 'no data');
  if (held.length) info.push('step 7b: native held ' + held.length + ' future-stamped message(s) until due (§1.3)');
  // step 8: the gate — Sound in background off, hidden: the release triple, 3 dropped, nothing stuck on return
  const gl = of(A, 'midiGate'), gReady = gl.find(g => g.step === 'ready'), gClose = gl.find(g => g.open === false && gReady && g.t >= gReady.t), gBg = gl.find(g => g.step === 'bgdone') || {}, gFg = gl.find(g => g.step === 'fg');
  gate(!!gReady && !gBg.timeout, 'step 8: the background round trip happened (the script sent the app behind Safari)', gBg.timeout ? 'TIMEOUT: the app never left the screen' : `hidden; onScreen at bgdone ${gBg.onScreen}`);
  gate(!!gClose && gClose.released >= 2 && gClose.backgroundAudio === false && gClose.onScreen === false, 'step 8: the gate closed on hidden with Sound in background off, the releases queued', gClose ? `released ${gClose.released} (CC 64 = 0 + CC 123 on ch 1)` : 'no close');
  gate(gBg.after && gBg.before && gBg.after.dropped - gBg.before.dropped === 3, 'step 8: 3 messages dropped at arrival while hidden', gBg.after ? `dropped ${gBg.before.dropped} → ${gBg.after.dropped}` : 'no counters');
  const gt = msgs('midiGateTake').map(hex), gt2 = msgs('midiGateTake2').map(hex);   // (the re-created smoke source has a new uid: no uid filter)
  // (fix R1-F2) the order per KIND, whatever the ports' uids: every pedal-up (bn 40 00) before any All Notes Off (bn 7B 00)
  const kinds = (l, re) => l.map((x, i) => re.test(x) ? i : -1).filter(i => i >= 0);
  const pedalFirst = l => { const u = kinds(l, /^b[0-9a-f]4000$/), a = kinds(l, /^b[0-9a-f]7b00$/); return u.length > 0 && a.length > 0 && Math.max(...u) < Math.min(...a); };
  gate(pedalFirst(gt) && !gt.includes('803e00') && gt.filter(x => x === '903e64').length <= 1, 'step 8: the release triple reached the page (every sustain up, then All Notes Off) — the 3 hidden sends did not', gt.join(' '));
  gate(!!gFg && gFg.counters && gFg.counters.gateOpen === true && gt2.includes('903f64') && gt2.includes('803f00'), 'step 8: back on screen the gate is open and the next note plays', `gateOpen ${gFg && gFg.counters && gFg.counters.gateOpen}, ${gt2.join(' ')}`);
  const gtk = of(A, 'midiGateTake')[0] || {}; pageGate(gtk.held === 0, 'step 8: nothing stuck on return (held 0)' + pageTag, 'held ' + gtk.held);
  // step 8b (fix R1-F1): Sound in background ON → the shell's background task at sceneDidEnterBackground; its expiration path (run by the
  // Debug shell as iPadOS does ≈ 30 s in) → the triple to the still-live page, the gate shut (3 hidden sends dropped); the foreground reopens
  const bt8 = of(A, 'midiBgTask'), b8r = bt8.find(l => l.step === 'ready'), b8d = bt8.find(l => l.step === 'bgdone') || {}, b8f = bt8.find(l => l.step === 'fg');
  const b8task = gl.find(g => 'bgTask' in g && b8r && g.t >= b8r.t) || {}, b8exp = gl.find(g => g.expired && b8r && g.t >= b8r.t), b8close = gl.find(g => g.open === false && g.backgroundExpired === true && b8r && g.t >= b8r.t);
  gate(!!b8r && !b8d.timeout && b8task.bgTask === true && b8d.task === true && b8d.gateBefore === true, 'step 8b: hidden with Sound in background on → the gate still open and a background task held', b8d.timeout ? 'TIMEOUT: the app never left the screen' : `bgTask ${b8task.bgTask} (remaining ${f3(b8task.remaining)} s), held at the expiry ${b8d.task}, gate before ${b8d.gateBefore}`);
  gate(!!b8exp && !!b8close && b8close.released >= 2 && b8close.backgroundAudio === true && b8close.onScreen === false, 'step 8b: the task\'s expiration path shut the gate and queued the releases (CC 64 = 0 + CC 123)', b8close ? `released ${b8close.released}` : 'no close with backgroundExpired');
  gate(b8d.after && b8d.before && b8d.after.dropped - b8d.before.dropped === 3 && b8d.gate === false && b8d.taskAfter === false, 'step 8b: 3 sends while hidden and expired dropped at arrival, the task ended', b8d.after ? `dropped ${b8d.before.dropped} → ${b8d.after.dropped}, gate ${b8d.gate}, task after ${b8d.taskAfter}` : 'no counters');
  const b8t = msgs('midiBgTaskTake').map(hex), b8t2 = msgs('midiBgTaskTake2').map(hex);
  gate(pedalFirst(b8t) && !b8t.includes('803d00') && b8t.filter(x => x === '903d64').length <= 1, 'step 8b: the release triple reached the hidden page (every sustain up, then All Notes Off) — the 3 hidden sends did not', b8t.join(' '));
  gate(!!b8f && b8f.gate === true && b8t2.includes('903b64') && b8t2.includes('803b00'), 'step 8b: back on screen the gate is open and the next note plays', `gate ${b8f && b8f.gate}, ${b8t2.join(' ')}`);
  const b8tk = of(A, 'midiBgTaskTake')[0] || {}; pageGate(b8tk.held === 0, 'step 8b: nothing stuck on return (held 0)' + pageTag, 'held ' + b8tk.held);
  // step 9: inactive is not hidden
  const ina = of(A, 'midiInactive'), inaOff = ina.find(l => l.active === false), inaOn = ina.find(l => l.active === true), inaTake = msgs('midiInactiveTake').map(hex);
  gate(inaOff && inaOn && !gl.some(g => g.open === false && g.t > inaOff.t && g.t < inaOn.t) && inaOn.counters.dropped === inaOff.counters.dropped && inaTake.includes('b00105'), 'step 9: the scene inactive (Control Center) with Sound in background off → nothing released, nothing dropped, the CC delivered', `dropped ${inaOff && inaOff.counters.dropped} → ${inaOn && inaOn.counters.dropped}; ${inaTake.join(' ')}`);
  // (fix R2-N5) the client is made on a utility queue at launch: ready before the page's open asks (its reply then waits for nothing)
  const readyT = (of(A, 'ready')[0] || {}).t; if (ml.t && readyT) info.push(`MIDI client made at t=${ml.t} ms (${f3(ml.createMs)} ms, off the main thread), the page ready at ${readyT}, its access reply in ${mo.ms} ms`);
  // step 10: lone notes
  const ls = of(A, 'midiLoneSent')[0] || {}, lj = of(A, 'midiLone')[0] || {}, lm = msgs('midiLone').filter(e => e.st === 0x90);
  if (lm.length === 50 && Array.isArray(ls.sends)) {
    const s = stats(lm, ls.sends), lWin = of(A, 'midiBatch').filter(b => b.kind === 'batch' && b.t >= ls.t - (ls.spanMs || 0) - 30 && b.t <= ls.t + 30);
    gate(pct(s.tr, 0.5) <= 6 && pct(s.tr, 0.99) <= 16, 'step 10: lone-note transit (target p50 ≤ 3, p99 ≤ 8 — recorded; gated loosely at 2×)', `p50 ${f3(pct(s.tr, 0.5))} p90 ${f3(pct(s.tr, 0.9))} p99 ${f3(pct(s.tr, 0.99))} max ${f3(pct(s.tr, 1))} ms; ts error p95 |e| ${f3(pct(s.te.map(Math.abs), 0.95))} ms`);
    gate(lWin.filter(b => b.n === 1).length >= 50, 'step 10: every lone note its own batch of 1 (no coalescing delay)', `${lWin.filter(b => b.n === 1).length} batches of 1 over ${lWin.length}`);
  } else fails.push('step 10: expected 50 lone notes, got ' + lm.length);
  // the stall (optional, recorded): a confirm() held the page ≈ 1 s while native streamed 4 kHz — notes intact, controllers thinned
  const ss = of(A, 'midiStallSent')[0] || {}, sj = of(A, 'midiStall')[0] || {}, sl = msgs('midiStallTake'), sOn = sl.filter(e => e.st === 0x90 && e.d1 >= 0x24 && e.d1 < 0x30).length, sOff = sl.filter(e => e.st === 0x80 && e.d1 >= 0x24 && e.d1 < 0x30).length, sCC = sl.filter(e => e.st === 0xb0 && e.d1 === 74).length;
  const sWin = of(A, 'midiBatch').filter(b => b.kind === 'batch' && b.t >= ss.t - (ss.spanMs || 0) - 100 && b.t <= (of(A, 'midiStallTake')[0] || {}).t), sDropped = sWin.reduce((s, b) => s + (b.dropped || 0), 0);
  gate(ss.n === 4000 && sOn === 100 && sOff === 100 && sCC + sDropped === 3800 && sDropped > 0, 'stall: a confirm() up ≈ 1 s under a 4 kHz stream — all 200 notes intact, controllers thinned to their latest values', `dialog ${sj.ms} ms; notes ${sOn}/${sOff}, CC ${sCC} received + ${sDropped} thinned = 3800; largest batch ${pct(sWin.map(b => b.n), 1)} (≤ ${2048 + 200}), ${sWin.length} calls`);
  gate(pct(sWin.map(b => b.n), 1) <= 2048 + 200, 'stall: the largest batch ≤ 2 048 + the never-thinned', pct(sWin.map(b => b.n), 1) + '');
  const mc = of(A, 'midiCounters')[0] || {}; gate(mc.overflows === 0 && mc.unexpected === 0, 'no never-thinned overflow, no ChannelVoice2 word on the 1.0 port', JSON.stringify(mc));
  // step 12: the Bluetooth sheet — last; shown, auto-dismissed, the Presenter free for the Save sheet after it
  const btj = of(A, 'midiBt')[0] || {}, bt = of(A, 'btmidi'), btShown = bt.find(b => b.shown), btClosed = bt.find(b => b.closed);
  gate(btj.reply && btj.reply.ok === true && !!btShown && !!btClosed && btClosed.t > btShown.t, 'step 12: { t: midi-bt } → the pairing sheet shown and closed (auto-dismiss), reply at once', `reply in ${btj.ms} ms; shown ${btShown && btShown.t}, closed ${btClosed && btClosed.t}`);
  const sheetAfterBt = sheets.find(s => btClosed && s.t > btClosed.t), waitedBt = of(A, 'waited').find(l => l.for === 'sheets' && btClosed && l.t > btClosed.t);
  gate(!!sheetAfterBt && waitedBt && !waitedBt.timeout, 'step 12: a Save sheet right after the Bluetooth sheet → the Presenter was free (settle on every close path)', sheetAfterBt ? `${sheetAfterBt.name} ${sheetAfterBt.t}` : 'no sheet after');
  const alertAfterBt = of(A, 'scene').find(s => s.state === 'inactive' && btj.t && s.t > btj.t && btClosed && s.t < btClosed.t); if (alertAfterBt) info.push('step 12: the scene went inactive while the sheet was up (a system Bluetooth alert?) at ' + alertAfterBt.t);
  gate(of(A, 'nav').filter(n => n.committed).length === 1, 'one main-frame commit (no page-initiated reload during the run)', of(A, 'nav').filter(n => n.committed).length + '');
  if (K != null) info.push(`MIDI clocks: host ms − log ms ≈ ${f3(K)} (the batch lines' h − t)`);
}
const bad = A.filter(l => l.k === 'bad'); if (bad.length) fails.push('unparsable log lines: ' + bad.length);
for (const i of info) console.log('  ok   ' + i);
for (const p of pend) console.log('  pend ' + p + (base ? '  (not gated with --base)' : ''));
for (const f of fails) console.log('  FAIL ' + f);
console.log((fails.length || (!base && pend.length)) ? `smoke: FAIL (${fails.length} failing${pend.length ? ', ' + pend.length + ' pending' : ''})` : `smoke: PASS${base ? ' (--base: native half; ' + pend.length + ' pending for W1 / W2)' : ''}`);
console.log(`smoke: logs ${fa} ${fb}; screenshot ${fa.replace(/\.jsonl$/, '.png')}; rss ${rssFile}`);
process.exit(fails.length || (!base && pend.length) ? 1 : 0);
EOF
