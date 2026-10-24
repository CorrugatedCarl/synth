import UIKit
import WebKit

// The shell (IMPL-A §2.3–2.4, §3.1, §4, §5.3–5.4, §6): one WKWebView owning the whole screen, the synth:// handler, the offline
// guard (a content rule list + the navigation policy — the page is not loaded if the rule list fails to compile), the marker user
// script (one-shot `restarted`), the bridge's host (files out → the share sheet; engine state → the idle timer; ready → the queued
// native → web calls), WKDownload for the module savers' <a download> blobs, the WKUIDelegate for every JS dialog, and the
// WebContent-termination restart.
// A4: the page's env(safe-area-inset-*) read 0 everywhere. Without UIRequiresFullScreen iPadOS reports the home indicator's 20 pt
// at the bottom (the spike measured 0 with the key); WebKit derives env() from the web view's safeAreaInsets, so the view answers 0.
final class ShellWebView: WKWebView { override var safeAreaInsets: UIEdgeInsets { .zero } }

// Stage B (IMPL-B): the MIDI shim (MidiShim.js, a bundle resource) is a document-start user script after the marker in both installs;
// `Midi` gets the gate's inputs (ready, midiOpen, onScreen from sceneBackground — NOT the scene's active state —, backgroundAudio, and
// backgroundExpired from the background task below), delivers through `midiCall` (one callAsyncJavaScript per batch) and is reset on
// every main-frame commit and WebContent termination; its client is prepared at launch on a utility queue (fix R2-N5).
final class ShellViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, BridgeHost, MidiHost {
    static let bg = UIColor(named: "LaunchBackground") ?? UIColor(red: 0x0c / 255, green: 0x0d / 255, blue: 0x0f / 255, alpha: 1)   // style.css --bg
    static let home = URL(string: "synth://app/index.html")!
    static let offlineRules = #"[{"trigger":{"url-filter":"^https?://"},"action":{"type":"block"}},{"trigger":{"url-filter":"^wss?://"},"action":{"type":"block"}}]"#

    let site = SiteBundle()
    private(set) var webView: WKWebView!
    let bridge = Bridge()
    let presenter = Presenter()
    let midi = Midi()
    private(set) var ready = false                       // the page posted { t: 'ready' } (§3.2 item 4)
    private var pending: [() -> Void] = []               // native → web calls queued until ready (§4.3)
    private var restarted = false                        // the marker's one-shot flag (§3.1, §5.4)
    private(set) var engineOn = false
    private(set) var backgroundAudio = true              // "Sound in background" (Q2, default on; the page posts { t: 'bg', on })
    private var foreground = true
    private var terminations: [TimeInterval] = []        // §5.4: twice within a minute → the alert
    private var downloads: [ObjectIdentifier: (download: WKDownload, url: URL, t0: TimeInterval)] = [:]
    private(set) var midiTask: UIBackgroundTaskIdentifier = .invalid   // fix R1-F1: held while MIDI flows behind another app (sceneBackground)
    private var loggedSize = CGSize.zero                 // (the smoke's `layout` lines: the view's size per change — R1-F3's bisect)
    var sheetsDone = 0                                   // the smoke counts sheets
    var dialogsDone = 0

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    // No edge deferral (fix R1-F1): with .all, a Home / app-switcher round trip left WebKit's visualViewport.scale at 1.333 (its
    // width unchanged) — the page's "page zoomed" chip for good and the canvas's pinch handed to the page zoom; and the first edge
    // swipe acted anyway (Sources, the Dock), so the deferral bought nothing. The home indicator stays auto-hidden.
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { [] }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .all }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Self.bg
        presenter.host = self
        bridge.host = self
        midi.host = self
        midi.gateChanged = { [weak self] open in if !open { self?.endMidiTask() } }   // the gate shut (for any reason): nothing left to keep the process up for
        AudioSession.shared.onInterruptionEnded = { [weak self] in self?.resumePage() }
        webView = makeWebView()
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([   // the view's edges, never the safe area (A4: insets read 0 — the page's env() rules stay inert)
            webView.topAnchor.constraint(equalTo: view.topAnchor), webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor), webView.trailingAnchor.constraint(equalTo: view.trailingAnchor)])
        Smoke.log(["k": "launch", "run": Smoke.run ?? "", "bundle": Bundle.main.bundleURL.path, "siteFiles": site.count, "build": site.build,
                   "screen": [UIScreen.main.bounds.width, UIScreen.main.bounds.height], "scale": UIScreen.main.scale,
                   "app": Bundle.main.infoDictionary?["CFBundleShortVersionString"] ?? "", "appBuild": Bundle.main.infoDictionary?["CFBundleVersion"] ?? ""])
        startGuarded()
        midi.prepare()                                   // IMPL-B fix R2-N5: the CoreMIDI client on a utility queue while the page loads
    }
    override func viewDidAppear(_ animated: Bool) { super.viewDidAppear(animated); presenter.pump() }
    override func viewDidLayoutSubviews() {              // (the smoke only: the view's size per change — a Home round trip's resizes, R1-F3)
        super.viewDidLayoutSubviews()
        if Smoke.on, view.bounds.size != loggedSize { loggedSize = view.bounds.size; Smoke.log(["k": "layout", "size": [view.bounds.width, view.bounds.height], "window": [view.window?.bounds.width ?? 0, view.window?.bounds.height ?? 0], "safe": [view.safeAreaInsets.top, view.safeAreaInsets.bottom]]) }
    }
    override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
        super.viewWillTransition(to: size, with: coordinator)
        Smoke.log(["k": "layout", "transitionTo": [size.width, size.height]])
    }

    // MARK: configuration (§2.3)
    private func makeWebView() -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.setURLSchemeHandler(SchemeHandler(site: site), forURLScheme: "synth")
        cfg.websiteDataStore = .default()                       // persistent: IndexedDB survives relaunch and reinstall (spike §1)
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []       // an AudioContext resumes without a tap; the page's power flow is unchanged
        cfg.preferences.isFraudulentWebsiteWarningEnabled = false
        cfg.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "synth")
        installUserScripts(cfg.userContentController, restarted: false)
        let wv = ShellWebView(frame: .zero, configuration: cfg)
        wv.navigationDelegate = self
        wv.uiDelegate = self
        wv.scrollView.contentInsetAdjustmentBehavior = .never
        wv.scrollView.bounces = false
        wv.isOpaque = false
        wv.backgroundColor = Self.bg
        wv.underPageBackgroundColor = Self.bg
        wv.allowsLinkPreview = false
        wv.allowsBackForwardNavigationGestures = false
        #if DEBUG
        if #available(iOS 16.4, *) { wv.isInspectable = true }  // Safari's Web Inspector from the Mac, Debug only
        #endif
        return wv
    }

    // §3.1 the marker (main frame, document start; `restarted` one-shot) + the MIDI shim (IMPL-B §1.1: after the marker, both installs,
    // a Resource in Release too) + the smoke's hook (-smoke only)
    private func installUserScripts(_ uc: WKUserContentController, restarted: Bool) {
        uc.removeAllUserScripts()
        let info = Bundle.main.infoDictionary ?? [:]
        let m: [String: Any] = ["os": "ipados", "idiom": "pad", "app": info["CFBundleShortVersionString"] as? String ?? "", "build": info["CFBundleVersion"] as? String ?? "",
                                "sha": site.build["short"] as? String ?? "", "site": site.build["version"] as? String ?? "", "restarted": restarted]
        let json = (try? JSONSerialization.data(withJSONObject: m)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        let src = "window.SYNTH_SHELL = Object.assign(\(json), { post: m => webkit.messageHandlers.synth.postMessage(m) });"
        uc.addUserScript(WKUserScript(source: src, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        if let u = Bundle.main.url(forResource: "MidiShim", withExtension: "js"), let shim = try? String(contentsOf: u, encoding: .utf8) {
            uc.addUserScript(WKUserScript(source: shim, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        if Smoke.on, let u = Bundle.main.url(forResource: "Smoke", withExtension: "js"), let hook = try? String(contentsOf: u, encoding: .utf8) {
            uc.addUserScript(WKUserScript(source: hook, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
    }

    // MARK: the offline guard (§2.4 item 1) then the page
    private func startGuarded() {
        WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "synth-offline-1", encodedContentRuleList: Self.offlineRules) { [weak self] list, err in
            guard let self else { return }
            guard let list else {
                Smoke.log(["k": "nav", "guardFailed": err.map { "\($0)" } ?? "no list"])
                self.nativeAlert("SYNTH could not start its offline guard", err.map { "\($0.localizedDescription)" })
                return
            }
            self.webView.configuration.userContentController.add(list)
            Smoke.log(["k": "guard", "compiled": true])
            self.load()
        }
    }
    private func load() {
        var req = URLRequest(url: Self.home)
        req.cachePolicy = .reloadIgnoringLocalCacheData
        webView.load(req)
    }

    // MARK: navigation (§2.4 item 2: download, allow, cancel)
    func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = a.request.url, scheme = url?.scheme?.lowercased() ?? "", local = ["synth", "blob", "data"].contains(scheme)
        let main = a.targetFrame?.isMainFrame ?? true
        if a.shouldPerformDownload {                                   // (i) an <a download> click (the three module savers' blob: URLs)
            Smoke.log(["k": "nav", "download": url?.absoluteString.prefix(120) ?? "", "allowed": local])
            decisionHandler(local ? .download : .cancel); return
        }
        if scheme == "synth" || (!main && (local || url?.absoluteString == "about:blank")) { decisionHandler(.allow); return }   // (ii)
        Smoke.log(["k": "nav", "cancelled": url?.absoluteString.prefix(120) ?? "", "main": main])                             // (iii)
        decisionHandler(.cancel)
    }
    func webView(_ w: WKWebView, decidePolicyFor r: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(r.canShowMIMEType ? .allow : .download)
    }
    func webView(_ w: WKWebView, navigationAction a: WKNavigationAction, didBecome d: WKDownload) { d.delegate = self }
    func webView(_ w: WKWebView, navigationResponse r: WKNavigationResponse, didBecome d: WKDownload) { d.delegate = self }
    // IMPL-B §3.4 / §5.1: every main-frame commit — our load() AND a page-initiated location.reload() — shuts the MIDI gate until the
    // new page opens access (midiOpen = false), drops the queue and the in-flight flag (a call to the gone page never completes it)
    func webView(_ w: WKWebView, didCommit n: WKNavigation!) {
        Smoke.log(["k": "nav", "committed": w.url?.absoluteString ?? ""])
        midi.pageReset()
    }
    func webView(_ w: WKWebView, didFinish n: WKNavigation!) {
        Smoke.log(["k": "nav", "finished": w.url?.absoluteString ?? "", "restarted": restarted])
        w.becomeFirstResponder()                                       // a hardware keyboard's notes and ⌘Z reach the page (§6.2)
        smokeDidFinish()
    }
    func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { Smoke.log(["k": "nav", "fail": "\(e)"]) }
    func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { Smoke.log(["k": "nav", "provisionalFail": "\(e)"]) }

    // §5.4 the WebContent process died (memory pressure): dialogs answered, transfers dropped, the page reloaded with restarted: true
    func webViewWebContentProcessDidTerminate(_ w: WKWebView) {
        Smoke.log(["k": "nav", "terminated": true, "openTransfers": bridge.open])
        presenter.abandonAll()
        bridge.closeAll()
        ready = false; pending.removeAll()
        midi.pageReset(); midi.ready = false                       // IMPL-B §5.1 (fix R2-N2: the reset first — the masks and the queue cleared, nothing built for the dead page)
        bridgeEngine(on: false)
        let now = Date().timeIntervalSince1970
        terminations = terminations.filter { now - $0 < 60 } + [now]
        if terminations.count >= 2 {
            terminations.removeAll()
            let ac = UIAlertController(title: nil, message: "SYNTH keeps running out of memory — a smaller project or a lower performance preset may help", preferredStyle: .alert)
            ac.addAction(UIAlertAction(title: "Reload", style: .default) { [weak self] _ in self?.restart() })
            present(ac, animated: true)
            return
        }
        restart()
    }
    private func restart() {
        restarted = true
        installUserScripts(webView.configuration.userContentController, restarted: true)
        load()
    }

    // MARK: WKDownload (§4.1 (ii)): tmp/<uuid>/<name> → the sheet
    func download(_ d: WKDownload, decideDestinationUsing r: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        do {
            let url = try FileExport.destination(id: UUID().uuidString, name: suggestedFilename)
            downloads[ObjectIdentifier(d)] = (d, url, ProcessInfo.processInfo.systemUptime)
            completionHandler(url)
        } catch { Smoke.log(["k": "download", "error": "\(error)"]); completionHandler(nil) }
    }
    func downloadDidFinish(_ d: WKDownload) {
        guard let e = downloads.removeValue(forKey: ObjectIdentifier(d)) else { return }
        if Smoke.on {
            let ms = Int((ProcessInfo.processInfo.systemUptime - e.t0) * 1000), size = FileExport.size(of: e.url)
            DispatchQueue.global(qos: .utility).async { Smoke.log(["k": "download", "name": e.url.lastPathComponent, "size": size, "sha256": FileExport.sha256(of: e.url) ?? "", "ms": ms]) }
        }
        bridgeShare(e.url) { _ in }
    }
    func download(_ d: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        if let e = downloads.removeValue(forKey: ObjectIdentifier(d)) { FileExport.discard(e.url) }
        Smoke.log(["k": "download", "failed": "\(error)"])
    }

    // MARK: WKUIDelegate — every JS dialog (§6.4), no new windows
    func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }
    func webView(_ w: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        dialog("alert", message, nil) { _, _ in completionHandler() }
    }
    func webView(_ w: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        dialog("confirm", message, nil) { ok, _ in completionHandler(ok) }
    }
    func webView(_ w: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        dialog("prompt", prompt, defaultText ?? "") { ok, text in completionHandler(ok ? (text ?? "") : nil) }
    }
    /// The completion is called on every path exactly once (the Presenter's `settle`; `cancel` on abandon): WebKit holds the page's
    /// thread until it is. While the dialog is up WebKit suspends the page's AudioContext; the user's answer resumes it (fix R1-F4:
    /// SYNTH_SHELL.on({ t: 'resume' }) → wake(), as an interruption's end — the page's Sound-in-background rule applies; not on
    /// abandon: the process is gone). While the smoke drives, the dialog is answered Cancel after a second (simctl cannot tap).
    private func dialog(_ kind: String, _ message: String, _ defaultText: String?, _ answer: @escaping (Bool, String?) -> Void) {
        Smoke.log(["k": "dialog", "type": kind, "message": String(message.prefix(200))])
        presenter.enqueue(cancel: { answer(false, nil) }) { [weak self] from, settle in
            let ac = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            if kind == "prompt" { ac.addTextField { $0.text = defaultText } }
            let done: (Bool) -> Void = { ok in settle { self?.dialogsDone += 1; answer(ok, ac.textFields?.first?.text); self?.resumePage() } }
            if kind != "alert" { ac.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in done(false) }) }
            ac.addAction(UIAlertAction(title: "OK", style: .default) { _ in done(true) })
            from.present(ac, animated: true)
            if Smoke.drives { DispatchQueue.main.asyncAfter(deadline: .now() + 1) { ac.dismiss(animated: false) { done(false) } } }
            return ac
        }
    }
    private func nativeAlert(_ title: String, _ message: String?) {
        let ac = UIAlertController(title: title, message: message, preferredStyle: .alert)
        ac.addAction(UIAlertAction(title: "OK", style: .default))
        present(ac, animated: true)
    }

    // MARK: BridgeHost
    func bridgeShare(_ fileURL: URL, done: @escaping (Bool) -> Void) {
        let name = fileURL.lastPathComponent
        FileExport.share(fileURL, via: presenter, anchor: webView, autoDismiss: Smoke.drives ? 2 : nil) { [weak self] ok in
            self?.sheetsDone += 1
            Smoke.log(["k": "sheet", "name": name, "done": ok])
            done(ok)
        }
    }
    func bridgeEngine(on: Bool) {                                  // §5.3 Q4: the screen stays awake while the engine is on
        engineOn = on
        UIApplication.shared.isIdleTimerDisabled = on && foreground
        Smoke.log(["k": "engine", "on": on])
        if on { Smoke.log(AudioSession.shared.reading(stage: "engine")) }
    }
    func bridgeReady() {
        ready = true
        midi.ready = true
        Smoke.log(["k": "ready", "restarted": restarted])
        if restarted { restarted = false; installUserScripts(webView.configuration.userContentController, restarted: false) }   // one-shot (§3.1)
        let p = pending; pending.removeAll(); p.forEach { $0() }
    }
    func bridgeBackgroundAudio(on: Bool) { backgroundAudio = on; midi.backgroundAudio = on; Smoke.log(["k": "bg", "on": on]) }
    // IMPL-B §3.1: the shim's four messages (`midi` replies when the client exists — made off the main thread, fix R2-N5)
    func bridgeMidiOpen(_ done: @escaping ([String: Any]) -> Void) { midi.open(done) }
    func bridgeMidiSend(id: String, bytes: [UInt8], delay: Double) -> String? { midi.send(id: id, bytes: bytes, delay: delay) }
    func bridgeMidiBluetooth() {                                    // §4.1: through the Presenter; settles on every close path
        MidiBluetoothSheet.present(via: presenter, autoDismiss: Smoke.drives ? 2 : nil,
                                   shown: { Smoke.log(["k": "btmidi", "shown": true]) }, closed: { Smoke.log(["k": "btmidi", "closed": true]) })
    }
    func bridgeMidiClock() -> Double { Midi.hostMs }
    func bridgeSmokeMidi(_ bytes: [UInt8]) {
        #if SMOKE
        if Smoke.on, bytes.first ?? 0 >= 0x80 { Midi.smokeQ.async { [midi] in midi.smokeSend(bytes) } }
        #endif
    }

    // MARK: native → web (§4.3: every call waits for ready; arguments, never a built JS string)
    func whenReady(_ f: @escaping () -> Void) { if ready { f() } else { pending.append(f) } }
    func call(_ body: String, _ args: [String: Any] = [:], _ done: ((Result<Any, Error>) -> Void)? = nil) {
        webView.callAsyncJavaScript(body, arguments: args, in: nil, in: .page) { r in done?(r) }
    }
    // MidiHost (IMPL-B §3.2): the one call per batch; every completion, success or error, reaches Midi (its in-flight flag)
    func midiCall(_ body: String, _ args: [String: Any], _ done: @escaping (Bool, String?) -> Void) {
        call(body, args) { r in if case .failure(let e) = r { done(false, "\(e)") } else { done(true, nil) } }
    }
    private func resumePage() { whenReady { [weak self] in self?.call("if (SYNTH_SHELL.on) SYNTH_SHELL.on({ t: 'resume' })") { _ in } } }

    /// Open from Files (§4.3): the bytes (≤ 64 MB) → SYNTH_SHELL.openFile(name, b64), queued until ready. File URLs only (fix
    /// R2-F5): a URL type added later must not turn into a synchronous native fetch outside the offline guard (A2).
    func openDocument(_ url: URL) {
        guard url.isFileURL else { Smoke.log(["k": "open", "refused": url.scheme ?? ""]); return }
        let scoped = url.startAccessingSecurityScopedResource()
        let name = url.lastPathComponent
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let data = try? Data(contentsOf: url)
            if scoped { url.stopAccessingSecurityScopedResource() }
            DispatchQueue.main.async {
                guard let self else { return }
                guard let data else { self.nativeAlert("SYNTH could not read " + name, nil); return }
                guard data.count <= 64 << 20 else { self.nativeAlert(name + " is too large to open (over 64 MB)", nil); return }
                let b64 = data.base64EncodedString()
                Smoke.log(["k": "open", "name": name, "size": data.count])
                self.whenReady { [weak self] in
                    self?.call("return SYNTH_SHELL.openFile ? SYNTH_SHELL.openFile(name, b64) : Promise.reject(new Error('no openFile'))", ["name": name, "b64": b64]) { r in
                        if case .failure(let e) = r { Smoke.log(["k": "open", "name": name, "error": "\(e)"]) }
                    }
                }
            }
        }
    }

    // MARK: scene lifecycle (§5.1, §5.3)
    func sceneActive(_ active: Bool) {
        foreground = active
        presenter.active = active
        UIApplication.shared.isIdleTimerDisabled = engineOn && active
        if active { AudioSession.shared.activate(); presenter.pump() }
    }
    func sceneBackground(_ background: Bool) {
        // "Sound in background" off: the page suspends its context on hidden; the app's session is let go so other apps' audio is no
        // longer ducked (indicative — WebKit's own session is its own, §5.1). On: nothing — the audio background mode keeps the app alive.
        // IMPL-B §3.4: the MIDI gate follows this state (the page's `hidden`), never the scene's active state — Control Center, a
        // notification pull or a system alert must not cut a held MIDI note.
        midi.onScreen = !background
        // IMPL-B fix R1-F1: with Sound in background on the gate stays open behind another app, but iPadOS suspends the process later
        // (the simulator: CoreMIDI deliveries stop ≈ 30 s after this call, whether or not the engine sounds; the device may keep a
        // sounding app longer — §11) and a note-off that falls past that edge is lost for good: the note drones until Panic. A
        // background task's expiration handler is the one hook that still runs in the live process just before the suspension —
        // it shuts the gate (the release triple reaches the page, which is still alive) until the foreground. The task ends there,
        // or as soon as the gate shuts for any other reason (gateChanged). No silent-audio keep-alive (the lead's decision).
        if background {
            if midi.midiOpen && backgroundAudio && midiTask == .invalid {
                midiTask = UIApplication.shared.beginBackgroundTask(withName: "synth.midi") { [weak self] in self?.midiBackgroundExpired() }
                Smoke.log(["k": "midiGate", "bgTask": midiTask != .invalid, "remaining": min(1e6, UIApplication.shared.backgroundTimeRemaining)])
            }
        } else {
            midi.backgroundExpired = false
            endMidiTask()
        }
        if !backgroundAudio { if background { AudioSession.shared.deactivate() } else { AudioSession.shared.activate() } }
    }
    /// The background task's expiration (main thread, the process still alive for a moment): the gate's release path, then the task ends.
    /// The smoke's step 8b calls it directly, as iPadOS would ≈ 30 s after the background.
    func midiBackgroundExpired() {
        Smoke.log(["k": "midiGate", "expired": true, "remaining": min(1e6, UIApplication.shared.backgroundTimeRemaining), "counters": midi.counters])
        midi.backgroundExpired = true                    // → the gate shuts: the releases flushed to the page; gateChanged ends the task
        endMidiTask()
    }
    private func endMidiTask() { if midiTask != .invalid { UIApplication.shared.endBackgroundTask(midiTask); midiTask = .invalid } }
}
