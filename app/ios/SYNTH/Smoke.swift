import Foundation
import os

// The headless smoke's log (IMPL-A §9.2). Compiled into Debug only (-DSMOKE, Config.xcconfig) AND active only with the
// `-smoke <run>` launch argument (the user's device build is Debug too — without the argument nothing here logs, probes,
// dismisses or answers anything). JSON lines to Library/Caches/smoke/<run>.jsonl (never Documents: UIFileSharingEnabled shows
// those in the Files app), read back by tools/app-smoke.sh through `simctl get_app_container … data`. Every line carries
// `k` (the kind), `t` (ms since process start — the smoke's timings) and `at` (ISO time).
// `-smokeMode log` (fix R1-F5, a by-hand review): the log only — requests, navigation, console, scene, dialogs, downloads,
// sheets — and nothing driven: no steps, no sheet closed or dialog answered by itself (`drives` false).
enum Smoke {
    #if SMOKE
    static let run: String? = UserDefaults.standard.string(forKey: "smoke")   // simctl launch … -smoke <run> → the argument domain
    static let mode: String = UserDefaults.standard.string(forKey: "smokeMode") ?? ""   // "" the steps · "bg" §5.2's measure · "log"
    /// Debug only: `-iobuf <seconds>` asks the session for an IO buffer (§5.1; the device pass measures whether WebKit's baseLatency follows).
    static let ioBuffer: Double? = { let d = UserDefaults.standard.double(forKey: "iobuf"); return d > 0 ? d : nil }()
    #else
    static let run: String? = nil
    static let mode = ""
    static let ioBuffer: Double? = nil
    #endif
    static var on: Bool { run != nil }                       // the log (and Smoke.js's console capture)
    static var drives: Bool { on && mode != "log" }          // the steps, the sheets' auto-dismiss, the dialogs' auto-answer

    private static let q = DispatchQueue(label: "synth.smoke")
    private static let t0 = ProcessInfo.processInfo.systemUptime
    private static let logger = Logger(subsystem: "com.domlavin.synth", category: "smoke")
    static let fileURL: URL? = {
        guard let run else { return nil }
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("smoke", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let safe = run.replacingOccurrences(of: "/", with: "_")
        return dir.appendingPathComponent(safe + ".jsonl")
    }()
    static var ms: Int { Int((ProcessInfo.processInfo.systemUptime - t0) * 1000) }

    static func log(_ dict: [String: Any]) {
        guard on, let fileURL else { return }
        var d = dict
        d["t"] = ms
        d["at"] = ISO8601DateFormatter().string(from: Date())
        q.async {
            let s: String
            if JSONSerialization.isValidJSONObject(d), let data = try? JSONSerialization.data(withJSONObject: d), let str = String(data: data, encoding: .utf8) { s = str }
            else { s = "{\"k\":\"unserialisable\",\"desc\":\(quote(String(describing: dict)))}" }
            logger.notice("SMOKE \(s, privacy: .public)")
            let line = Data((s + "\n").utf8)
            if let h = try? FileHandle(forWritingTo: fileURL) { h.seekToEndOfFile(); h.write(line); try? h.close() }
            else { try? line.write(to: fileURL) }
        }
    }
    static func quote(_ s: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [s]), let arr = String(data: data, encoding: .utf8) else { return "\"?\"" }
        return String(arr.dropFirst().dropLast())
    }
}
