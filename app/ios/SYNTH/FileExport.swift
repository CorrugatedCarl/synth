import UIKit
import CryptoKit

// One presentation at a time (IMPL-A §4.1, §6.4): share sheets and JavaScript dialogs wait in one queue; each is presented
// from the topmost presented controller of the host while the scene is active, and `settle` (the user's answer, once) advances
// the queue. `abandonAll` (§5.4: the WebContent process died) answers every waiting item with its default and dismisses the one on
// screen — a dialog's completion handler is called on every path, exactly once (WebKit holds the page's thread until it is).
final class Presenter {
    final class Item {
        let make: (UIViewController, @escaping (() -> Void) -> Void) -> UIViewController?
        let cancel: () -> Void
        var settled = false
        init(make: @escaping (UIViewController, @escaping (() -> Void) -> Void) -> UIViewController?, cancel: @escaping () -> Void) { self.make = make; self.cancel = cancel }
    }
    weak var host: UIViewController?
    var active = true                         // the scene is foreground-active (SceneDelegate)
    private var queue: [Item] = []
    private var current: (vc: UIViewController, item: Item)?
    var busy: Bool { current != nil || !queue.isEmpty }

    /// `cancel`: the default answer (used when the item is abandoned). `make`: present from `from`, return the presented controller,
    /// and call `settle { answer }` exactly when the user answers (later calls are ignored).
    func enqueue(cancel: @escaping () -> Void, make: @escaping (UIViewController, @escaping (() -> Void) -> Void) -> UIViewController?) {
        queue.append(Item(make: make, cancel: cancel))
        pump()
    }
    func pump() {
        guard current == nil, active, let host, host.viewIfLoaded?.window != nil, !queue.isEmpty else { return }
        let item = queue.removeFirst()
        var top = host
        while let p = top.presentedViewController, !p.isBeingDismissed { top = p }
        let settle: (() -> Void) -> Void = { [weak self, item] answer in
            guard !item.settled else { return }
            item.settled = true
            answer()
            if let self, self.current?.item === item { self.current = nil }
            self?.pump()
        }
        if let vc = item.make(top, settle), !item.settled { current = (vc, item) }
        else if !item.settled { settle {} }
    }
    func abandonAll() {
        let waiting = queue
        queue.removeAll()
        for i in waiting where !i.settled { i.settled = true; i.cancel() }
        if let (vc, item) = current {
            current = nil
            if !item.settled { item.settled = true; item.cancel() }
            vc.dismiss(animated: false)
        }
    }
}

// Files out (§4.1): a transfer or a WKDownload lands in tmp/<id>/<sanitised name>; the share sheet (Save to Files, AirDrop, Mail…)
// as a popover from the top centre of the web view (an iPad needs an anchor; the tap's point is unknown to native); the sheet's
// completion deletes tmp/<id> and reports `done` (false: closed without saving — the page may offer its retry). A sweep at launch
// removes tmp/ entries older than a day.
enum FileExport {
    static var tmpRoot: URL { FileManager.default.temporaryDirectory }

    /// The name is page-controlled and becomes a path: lastPathComponent only, no ':' / NUL, never empty or a dot name, ≤ 200 bytes.
    static func sanitise(_ name: String) -> String {
        var s = (name as NSString).lastPathComponent
        s = s.replacingOccurrences(of: ":", with: "-").replacingOccurrences(of: "\0", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty || s == "." || s == ".." || s.hasPrefix(".") { s = "file" + s }
        while s.utf8.count > 200 { s.removeLast() }
        return s
    }
    static func destination(id: String, name: String) throws -> URL {
        let dir = tmpRoot.appendingPathComponent(sanitise(id), isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent(sanitise(name))
    }
    static func discard(_ fileURL: URL) { try? FileManager.default.removeItem(at: fileURL.deletingLastPathComponent()) }
    static func freeBytes() -> Int64 {
        (try? tmpRoot.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]).volumeAvailableCapacityForImportantUsage) ?? Int64.max
    }
    static func sweep(olderThan age: TimeInterval = 86400) {
        let fm = FileManager.default
        guard let items = try? fm.contentsOfDirectory(at: tmpRoot, includingPropertiesForKeys: [.contentModificationDateKey]) else { return }
        for u in items {
            let d = (try? u.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            if Date().timeIntervalSince(d) > age { try? fm.removeItem(at: u) }
        }
    }
    static func sha256(of url: URL) -> String? {
        guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { return nil }
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
    static func size(of url: URL) -> Int { (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? -1 }

    /// `autoDismiss` (the smoke only): close the sheet after that many seconds, reporting done = false.
    static func share(_ fileURL: URL, via presenter: Presenter, anchor: UIView, autoDismiss: TimeInterval?, done: @escaping (Bool) -> Void) {
        presenter.enqueue(cancel: { discard(fileURL); done(false) }) { from, settle in
            let avc = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
            avc.completionWithItemsHandler = { _, completed, _, _ in settle { discard(fileURL); done(completed) } }
            if let pop = avc.popoverPresentationController {
                pop.sourceView = anchor
                pop.sourceRect = CGRect(x: anchor.bounds.midX, y: 0, width: 1, height: 1)
                pop.permittedArrowDirections = .up
            }
            from.present(avc, animated: true)
            if let autoDismiss {
                DispatchQueue.main.asyncAfter(deadline: .now() + autoDismiss) { [weak avc] in
                    avc?.dismiss(animated: false) { settle { discard(fileURL); done(false) } }
                }
            }
            return avc
        }
    }
}
