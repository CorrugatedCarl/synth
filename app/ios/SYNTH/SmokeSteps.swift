import UIKit
import WebKit

// The headless smoke's native half (IMPL-A §9.2; Debug only AND `-smoke <run>` only — Smoke.on). After didFinish the shell drives
// the page through Smoke.js's `__smoke` functions with callAsyncJavaScript (it awaits), logging each answer:
//   run <x>   : +2 s status · the guard's negative probe · the 404 probes · the engine step (keydown KeyA held, probe, keyup) · +6 s
//               status · files out (Save → the download / bridge; a 100 MB bridge save; two saves back to back; 1 KB and 100 MB
//               <a download> blobs; ≡ → New's confirm) · the storage write · the MIDI steps (SmokeMidi.swift, IMPL-B §8) · status · done
//   -smokeMode relaunch : +2 s status · the storage read-back · done    (the relaunch, timed by the script, logged as <x>b; fix R1-F6:
//               the mode, not the label's last letter — `--run r1b` used to run this half)
//   -smokeMode bg : a held note + an own AudioContext, state every 2 s for 60 s while the script backgrounds the app (§5.2)
//   -smokeMode midicold : IMPL-B §8 step 11 — the engine never started, the app backgrounded by the script, one MIDI note (SmokeMidi.swift)
//   -smokeMode log: nothing here (Smoke.drives false) — the log only, for a by-hand review (§9.2)
#if SMOKE
extension ShellViewController {
    func smokeDidFinish() {
        guard Smoke.drives, let run = Smoke.run else { return }   // (-smokeMode log: nothing driven)
        if Smoke.mode == "bg" { smokeBackground(); return }
        if Smoke.mode == "midicold" { smokeMidiCold(); return }
        if Smoke.mode == "relaunch" {
            seq([wait(2), js("status", "return __smoke.status('2s')"), js("storage", "return __smoke.storageRead()"), done])
            return
        }
        seq([
            wait(2), js("status", "return __smoke.status('2s')"), js("guard", "return __smoke.guard()"), js("probe404", "return __smoke.probe404()"),
            js("key", "return __smoke.keyDown('KeyA')"), js("engineWait", "return __smoke.engineWait(8000)"), avsession("held"), js("status", "return __smoke.status('engine')"), js("key", "return __smoke.keyUp('KeyA')"),
            wait(2.5), js("status", "return __smoke.status('6s')"),
            // the sheet totals are absolute: a bridge save's JS resolves only after its sheet closed, a WKDownload's at once
            js("files", "return __smoke.click('fSave')"), sheets(1, 20),
            js("save100", "return __smoke.save100()"), sheets(2, 20),
            js("saveTwice", "return __smoke.saveTwice()"), sheets(4, 20),
            js("download", "return __smoke.download(1024)"), sheets(5, 20),
            js("download", "return __smoke.download(100 << 20)"), sheets(6, 30),
            js("files", "return __smoke.click('fNew')"), dialogs(1, 10),
            js("storage", "return __smoke.storageWrite(run)", ["run": run]),
        ] + smokeMidiSteps(sheetsSoFar: 6) + [
            wait(1), js("status", "return __smoke.status('end')"), done])
    }

    typealias Step = (@escaping () -> Void) -> Void
    func seq(_ steps: [Step]) { var i = 0; func next() { guard i < steps.count else { return }; let s = steps[i]; i += 1; s(next) }; next() }
    func wait(_ s: TimeInterval) -> Step { { n in DispatchQueue.main.asyncAfter(deadline: .now() + s, execute: n) } }
    var done: Step { { n in Smoke.log(["k": "done"]); n() } }
    func js(_ k: String, _ body: String, _ args: [String: Any] = [:]) -> Step {
        { [weak self] n in
            guard let self else { return }
            let t0 = Smoke.ms
            self.call(body, args) { r in
                var line: [String: Any] = ["k": k, "ms": Smoke.ms - t0]
                switch r {
                case .success(let v): if let d = v as? [String: Any] { line.merge(d) { a, _ in a } } else { line["value"] = Smoke.jsonSafe(v) }
                case .failure(let e): line["error"] = "\(e)"
                }
                Smoke.log(line)
                n()
            }
        }
    }
    /// A native action on main; a returned dictionary is logged under `k`.
    func native(_ k: String, _ f: @escaping () -> [String: Any]?) -> Step { { n in if var d = f() { d["k"] = k; Smoke.log(d) }; n() } }
    /// Wait until `total` sheets have closed since launch (the Debug shell auto-dismisses each after 2 s), at most `timeout` s.
    func sheets(_ total: Int, _ timeout: TimeInterval) -> Step { { [weak self] next in guard let self else { return }; self.until(total, timeout, { self.sheetsDone }, "sheets", next) } }
    func dialogs(_ total: Int, _ timeout: TimeInterval) -> Step { { [weak self] next in guard let self else { return }; self.until(total, timeout, { self.dialogsDone }, "dialogs", next) } }
    func avsession(_ stage: String) -> Step { { n in Smoke.log(AudioSession.shared.reading(stage: stage)); n() } }
    func until(_ target: Int, _ timeout: TimeInterval, _ get: @escaping () -> Int, _ what: String, _ next: @escaping () -> Void) {
        let t0 = Smoke.ms
        func poll() {
            if get() >= target { Smoke.log(["k": "waited", "for": what, "n": target, "ms": Smoke.ms - t0]); next(); return }
            if Smoke.ms - t0 > Int(timeout * 1000) { Smoke.log(["k": "waited", "for": what, "n": target, "got": get(), "timeout": true]); next(); return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1, execute: poll)
        }
        poll()
    }
    /// Wait (≤ `timeout` s, polling 100 ms) until `cond`; `then(true)` when met, `then(false)` on the timeout — the MIDI gate step's background round trip.
    func untilFlag(_ timeout: TimeInterval, _ cond: @escaping () -> Bool, _ what: String, _ then: @escaping (Bool) -> Void) {
        let t0 = Smoke.ms
        func poll() {
            if cond() { Smoke.log(["k": "waited", "for": what, "ms": Smoke.ms - t0]); then(true); return }
            if Smoke.ms - t0 > Int(timeout * 1000) { Smoke.log(["k": "waited", "for": what, "timeout": true]); then(false); return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1, execute: poll)
        }
        poll()
    }

    // §5.2: does WebKit keep rendering while the app is in the background? A held engine note + Smoke.js's own context; state every 2 s.
    private func smokeBackground() {
        var ticks: [Step] = [wait(3), js("key", "return __smoke.keyDown('KeyA')"), js("bgStart", "return __smoke.bgStart()")]
        for _ in 0..<30 { ticks.append(wait(2)); ticks.append(js("bg", "return __smoke.bgState()")) }
        ticks.append(js("key", "return __smoke.keyUp('KeyA')")); ticks.append(done)
        seq(ticks)
    }
}
extension Smoke {
    static func jsonSafe(_ v: Any) -> Any {
        if JSONSerialization.isValidJSONObject([v]) { return v }
        return String(describing: v)
    }
}
#else
extension ShellViewController { func smokeDidFinish() {} }
#endif
