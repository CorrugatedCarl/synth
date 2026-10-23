import Foundation

// The bundled site (IMPL-A §2.1): tools/app-bundle.sh copies HEAD's precache list into <bundle>/site at build time; this
// enumerates that folder ONCE into a map of exact relative paths, and a request resolves only to a key of the map — exactly
// as cased (the simulator's file system would forgive case, the iPad's and GitHub Pages would not), never a directory, never
// a walk ('..', symlinks and escapes cannot resolve by construction). Foundation only: shared with the Mac shell later (§8).
final class SiteBundle {
    let root: URL
    private(set) var files: [String: URL] = [:]
    /// site/app-build.json (§1.5 step 4): sha, short, date, version, build, dirty — [:] when missing.
    private(set) var build: [String: Any] = [:]

    init(root: URL) {
        self.root = root
        let base = root.standardizedFileURL.path
        if let e = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles]) {
            for case let u as URL in e {
                guard (try? u.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile == true else { continue }
                var rel = u.standardizedFileURL.path
                guard rel.hasPrefix(base) else { continue }
                rel.removeFirst(base.count)
                while rel.hasPrefix("/") { rel.removeFirst() }
                if !rel.isEmpty { files[rel] = u }
            }
        }
        if let d = try? Data(contentsOf: root.appendingPathComponent("app-build.json")), let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] { build = j }
    }
    convenience init() { self.init(root: Bundle.main.bundleURL.appendingPathComponent("site", isDirectory: true)) }

    /// synth://app/<path>?<query> → the map key: the query is ignored ('?v=9', '?dev=1' …), the path percent-decoded once,
    /// '' or '/' → index.html, any other directory path → nil (no implicit index), any other host or scheme → nil (one origin, A5).
    func key(for url: URL) -> String? {
        guard url.scheme?.lowercased() == "synth", url.host?.lowercased() == "app" else { return nil }
        guard let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        var p = comps.percentEncodedPath.removingPercentEncoding ?? comps.percentEncodedPath
        while p.hasPrefix("/") { p.removeFirst() }
        if p.isEmpty { p = "index.html" }
        return files[p] != nil ? p : nil
    }
    func url(for key: String) -> URL? { files[key] }
    func data(for key: String) -> Data? { files[key].flatMap { try? Data(contentsOf: $0, options: .mappedIfSafe) } }
    var count: Int { files.count }
}

// Content-Type by extension (the spike's table): index.html and every .js must be exact — WebKit refuses a module or a
// worklet script with a wrong type; fonts for §3.3; the rest for completeness.
enum MIME {
    static func of(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "map": return "application/json"
        case "webmanifest": return "application/manifest+json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "ico": return "image/x-icon"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "ttf": return "font/ttf"
        case "wasm": return "application/wasm"
        case "txt", "md": return "text/plain; charset=utf-8"
        case "wav": return "audio/wav"
        case "mid", "midi": return "audio/midi"
        default: return "application/octet-stream"
        }
    }
}
