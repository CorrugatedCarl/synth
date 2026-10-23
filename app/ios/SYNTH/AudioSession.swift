import AVFoundation

// The audio session (IMPL-A §5.1, §5.3; A7: the shell adds no audio path — WebKit's AudioContext is the output). `.playback` +
// `.mixWithOthers` (the Ring / Silent switch does not mute; other apps' music is not paused — best effort: WebKit drives its own
// session from the page's navigator.audioSession.type, [R?] device-only), active at launch (before the page loads) and on every
// foreground. Never re-set while the engine is on (a category change mid-render reconfigures the route — a click). The
// interruption observer: `.ended` + `.shouldResume` → setActive and the host's resume (→ SYNTH_SHELL.on({ t: 'resume' }) → wake()).
// The readings feed the smoke's `avsession` lines (indicative only, §5.1).
final class AudioSession {
    static let shared = AudioSession()
    var onInterruptionEnded: (() -> Void)?
    private(set) var configured = false

    func configure() {
        let s = AVAudioSession.sharedInstance()
        do {
            try s.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            if let b = Smoke.ioBuffer { try s.setPreferredIOBufferDuration(b) }     // Debug -iobuf <seconds> (the device pass)
            try s.setActive(true)
            configured = true
        } catch { Smoke.log(["k": "avsession", "stage": "configure", "err": "\(error)"]) }
        NotificationCenter.default.addObserver(self, selector: #selector(interrupted(_:)), name: AVAudioSession.interruptionNotification, object: s)
        NotificationCenter.default.addObserver(self, selector: #selector(routeChanged(_:)), name: AVAudioSession.routeChangeNotification, object: s)
        Smoke.log(reading(stage: "launch"))
    }
    func activate() { try? AVAudioSession.sharedInstance().setActive(true) }
    func deactivate() { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }

    func reading(stage: String) -> [String: Any] {
        let s = AVAudioSession.sharedInstance()
        return ["k": "avsession", "stage": stage, "category": s.category.rawValue, "options": s.categoryOptions.rawValue, "mode": s.mode.rawValue,
                "sampleRate": s.sampleRate, "ioBufferS": s.ioBufferDuration, "outputLatencyS": s.outputLatency, "inputLatencyS": s.inputLatency,
                "route": s.currentRoute.outputs.map { $0.portType.rawValue }, "otherAudio": s.isOtherAudioPlaying, "secondaryShouldSilence": s.secondaryAudioShouldBeSilencedHint]
    }

    @objc private func interrupted(_ n: Notification) {
        guard let info = n.userInfo, let tv = info[AVAudioSessionInterruptionTypeKey] as? UInt, let type = AVAudioSession.InterruptionType(rawValue: tv) else { return }
        switch type {
        case .began: Smoke.log(["k": "interruption", "began": true])
        case .ended:
            let opts = AVAudioSession.InterruptionOptions(rawValue: info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
            Smoke.log(["k": "interruption", "ended": true, "shouldResume": opts.contains(.shouldResume)])
            if opts.contains(.shouldResume) { activate(); onInterruptionEnded?() }
        @unknown default: break
        }
    }
    @objc private func routeChanged(_ n: Notification) {
        Smoke.log(["k": "route", "reason": (n.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt) ?? 0, "outputs": AVAudioSession.sharedInstance().currentRoute.outputs.map { $0.portType.rawValue }])
    }
}
