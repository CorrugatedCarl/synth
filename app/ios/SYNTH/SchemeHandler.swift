import WebKit

// synth://app/<path>?<query> served from the bundled site (IMPL-A §2.1–2.2). WebKit calls start/stop on the main thread; the
// read happens on a serial utility queue and the answer is delivered back on main ONLY while the task is still live — WebKit's
// contract forbids touching a stopped task (`stop` removes it from `live`). One didReceive(response), one didReceive(data),
// didFinish; a miss is a 404 text/plain "not found". Headers as the spike: Content-Type (exact for .js / .html), Content-Length,
// Cache-Control: no-store (a Debug relaunch must never see WebKit's memory-cached copy; offline there is nothing to gain from a
// cache), Access-Control-Allow-Origin: * (harmless, same origin anyway). No Range support (§0 Media: nothing in the site needs
// it) — a Range request gets the full 200 and is logged under -smoke so a future media file is noticed. WebKit + Foundation
// only: shared with the Mac shell later (§8).
final class SchemeHandler: NSObject, WKURLSchemeHandler {
    private let site: SiteBundle
    private var live = Set<ObjectIdentifier>()          // main thread only
    private let q = DispatchQueue(label: "synth.scheme", qos: .userInitiated)
    init(site: SiteBundle) { self.site = site }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let id = ObjectIdentifier(task)
        live.insert(id)
        guard let url = task.request.url else { fail(task, id); return }
        let t0 = ProcessInfo.processInfo.systemUptime
        let range = task.request.value(forHTTPHeaderField: "Range")
        let key = site.key(for: url)
        q.async { [site] in
            let data = key.flatMap { site.data(for: $0) }
            DispatchQueue.main.async {
                guard self.live.contains(id) else { return }           // stopped meanwhile: WebKit must not hear from us
                self.live.remove(id)
                let ms = Int((ProcessInfo.processInfo.systemUptime - t0) * 1000)
                if let key, let data {
                    let mime = MIME.of((key as NSString).pathExtension)
                    let resp = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
                        "Content-Type": mime, "Content-Length": String(data.count), "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"])!
                    task.didReceive(resp); task.didReceive(data); task.didFinish()
                    var line: [String: Any] = ["k": "req", "url": url.absoluteString, "status": 200, "mime": mime, "bytes": data.count, "ms": ms]
                    if let range { line["range"] = range }
                    Smoke.log(line)
                } else {
                    let body = Data("not found".utf8)
                    let resp = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: [
                        "Content-Type": "text/plain; charset=utf-8", "Content-Length": String(body.count), "Cache-Control": "no-store"])!
                    task.didReceive(resp); task.didReceive(body); task.didFinish()
                    Smoke.log(["k": "req", "url": url.absoluteString, "status": 404, "ms": ms])
                }
            }
        }
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) { live.remove(ObjectIdentifier(task)) }

    private func fail(_ task: WKURLSchemeTask, _ id: ObjectIdentifier) {
        guard live.contains(id) else { return }
        live.remove(id)
        task.didFailWithError(NSError(domain: "synth.scheme", code: 1, userInfo: [NSLocalizedDescriptionKey: "no URL"]))
    }
}
