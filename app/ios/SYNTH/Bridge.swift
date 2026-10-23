import WebKit

// webkit.messageHandlers.synth, with reply (IMPL-A §4.1, §10's frozen messages). Web → native, each replied { ok: true } or
// { ok: false, error }:
//   file  { id, name, type, size }   a FileHandle in tmp/<id>/<name>; refused when the free space is short
//   chunk { id, at, b64 }            one 2 MiB slice, base64 (a script message carries no ArrayBuffer); `at` must be the next byte
//   end   { id }                     close → the share sheet; the reply { ok: true, done } waits for the sheet to close
//   abort { id }                     close and delete tmp/<id>
//   engine { on }                    the page's power state (§5.3 idle timer); ready {} (§3.2 item 4: queued native → web calls run)
//   bg { on }                        the "Sound in background" setting (Q2) — recorded for the session handling
//   log { … }                        the Debug smoke JS's lines (dropped without -smoke)
// The host (ShellViewController) owns the sheet and the page; decoding and writing happen on a serial queue, replies on main.
protocol BridgeHost: AnyObject {
    func bridgeEngine(on: Bool)
    func bridgeReady()
    func bridgeBackgroundAudio(on: Bool)
    func bridgeShare(_ fileURL: URL, done: @escaping (Bool) -> Void)
}

final class Bridge: NSObject, WKScriptMessageHandlerWithReply {
    weak var host: BridgeHost?
    private final class Transfer {
        let id: String, url: URL, handle: FileHandle, size: Int, t0: TimeInterval
        var at = 0
        init(id: String, url: URL, handle: FileHandle, size: Int) { self.id = id; self.url = url; self.handle = handle; self.size = size; t0 = ProcessInfo.processInfo.systemUptime }
    }
    private var transfers: [String: Transfer] = [:]        // main thread
    private let q = DispatchQueue(label: "synth.bridge", qos: .userInitiated)
    private static let headroom: Int64 = 16 << 20

    func userContentController(_ u: WKUserContentController, didReceive m: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        let ok: ([String: Any]) -> Void = { d in var r = d; r["ok"] = true; replyHandler(r, nil) }
        let no: (String) -> Void = { e in replyHandler(["ok": false, "error": e], nil) }
        guard let body = m.body as? [String: Any], let t = body["t"] as? String else { no("bad message"); return }
        switch t {
        case "file":
            guard let id = body["id"] as? String, !id.isEmpty, let name = body["name"] as? String, let size = (body["size"] as? NSNumber)?.intValue, size >= 0 else { no("file: id, name, size"); return }
            guard transfers[id] == nil else { no("file: id in use"); return }
            guard FileExport.freeBytes() > Int64(size) + Self.headroom else { no("file: not enough free space"); return }
            do {
                let url = try FileExport.destination(id: id, name: name)
                guard FileManager.default.createFile(atPath: url.path, contents: nil) else { no("file: create"); return }
                transfers[id] = Transfer(id: id, url: url, handle: try FileHandle(forWritingTo: url), size: size)
                ok([:])
            } catch { no("file: \(error.localizedDescription)") }
        case "chunk":
            guard let id = body["id"] as? String, let tr = transfers[id] else { no("chunk: unknown id"); return }
            guard let at = (body["at"] as? NSNumber)?.intValue, at == tr.at else { no("chunk: at \(body["at"] ?? "?") ≠ \(tr.at)"); drop(id); return }
            guard let b64 = body["b64"] as? String else { no("chunk: b64"); drop(id); return }
            q.async {
                guard let data = Data(base64Encoded: b64) else { DispatchQueue.main.async { no("chunk: base64"); self.drop(id) }; return }
                var err: String?
                if at + data.count > tr.size { err = "chunk: beyond size" }
                else { do { try tr.handle.write(contentsOf: data) } catch { err = "chunk: write \(error.localizedDescription)" } }
                DispatchQueue.main.async {
                    if let err { no(err); self.drop(id) } else { tr.at += data.count; ok([:]) }
                }
            }
        case "end":
            guard let id = body["id"] as? String, let tr = transfers.removeValue(forKey: id) else { no("end: unknown id"); return }
            try? tr.handle.close()
            guard tr.at == tr.size else { FileExport.discard(tr.url); no("end: \(tr.at) of \(tr.size) bytes"); return }
            if Smoke.on {
                let ms = Int((ProcessInfo.processInfo.systemUptime - tr.t0) * 1000)
                q.async { let sha = FileExport.sha256(of: tr.url) ?? ""; Smoke.log(["k": "bridge", "id": id, "name": tr.url.lastPathComponent, "size": tr.size, "sha256": sha, "ms": ms]) }
            }
            guard let host else { FileExport.discard(tr.url); no("end: no host"); return }
            host.bridgeShare(tr.url) { done in ok(["done": done]) }
        case "abort":
            if let id = body["id"] as? String { drop(id) }
            ok([:])
        case "engine": host?.bridgeEngine(on: body["on"] as? Bool ?? false); ok([:])
        case "ready": host?.bridgeReady(); ok([:])
        case "bg": host?.bridgeBackgroundAudio(on: body["on"] as? Bool ?? true); ok([:])
        case "log":
            if Smoke.on { var d = body; d.removeValue(forKey: "t"); if d["k"] == nil { d["k"] = "log" }; Smoke.log(d) }
            ok([:])
        default: no("unknown t: " + t)
        }
    }
    private func drop(_ id: String) {
        guard let tr = transfers.removeValue(forKey: id) else { return }
        try? tr.handle.close()
        FileExport.discard(tr.url)
    }
    /// §5.4: the WebContent process died mid-transfer — every open tmp/<id> closed and deleted.
    func closeAll() { for id in Array(transfers.keys) { drop(id) } }
    var open: Int { transfers.count }
}
