import UIKit
import WebKit
import CoreMIDI

// The smoke's MIDI half (IMPL-B §8; Debug -DSMOKE AND -smoke only — Smoke.on for the endpoints and the log, Smoke.drives for the
// steps). Under -smoke the client gains a virtual source "SYNTH smoke in" (our own input port connects to it like anyone's — a
// loopback through the simulator's MIDI server: CoreMIDI → receive thread → batch → callAsyncJavaScript → shim → midi.js → engine)
// and a virtual destination "SYNTH smoke out" (its block logs the bytes — step 7). The senders run on their own high-priority queue,
// never the main queue the flush runs on; MIDIReceivedEventList takes a real stamp (a 0 is NOT "now" for a virtual source,
// MIDIServices.h:2517). Steps, after the files steps: open → status → a note → controls → the common clock → the per-call cost →
// a 1 kHz burst → a busy page → hot-plug → MIDI out → the gate (the script backgrounds the app on each `"step":"ready"` line and
// brings it back on each `"step":"bgdone"`) → 8b the background task's expiry (fix R1-F1, Sound in background on) → inactive ≠ hidden
// → lone-note latency → a stall (a confirm up while native streams) → the Bluetooth sheet LAST (its permission alert, if the simulator
// shows one, cannot be dismissed by the script) → a Save sheet proves the Presenter free. `-smokeMode midicold` (step 11): the engine
// never started, the app hidden, one note — recorded.
#if SMOKE
extension Midi {
    static let smokeQ = DispatchQueue(label: "synth.smoke.midi", qos: .userInteractive)
    func smokeCreateEndpoints() -> [String: Any] {
        let stSrc = MIDISourceCreateWithProtocol(client, "SYNTH smoke in" as CFString, ._1_0, &smokeSrc)
        let stDst = MIDIDestinationCreateWithProtocol(client, "SYNTH smoke out" as CFString, ._1_0, &smokeDst) { list, _ in
            let got = Midi.hostMs
            for (ts, words) in Midi.smokeWalk(list) { Smoke.log(["k": "midiOut", "bytes": words.map { String(format: "%06x", $0 & 0xffffff) }, "stamp": Midi.ms(ts), "got": got]) }
        }
        return ["src": stSrc, "dst": stDst, "srcUid": Self.int(smokeSrc, kMIDIPropertyUniqueID) ?? 0, "dstUid": Self.int(smokeDst, kMIDIPropertyUniqueID) ?? 0]
    }
    static func smokeWalk(_ list: UnsafePointer<MIDIEventList>) -> [(MIDITimeStamp, [UInt32])] {
        var out: [(MIDITimeStamp, [UInt32])] = []
        let n = Int(list.pointee.numPackets); guard n > 0 else { return out }
        var p = UnsafeRawPointer(list).advanced(by: MemoryLayout<MIDIEventList>.offset(of: \.packet)!).assumingMemoryBound(to: MIDIEventPacket.self)
        for _ in 0..<n {
            let words = UnsafeRawPointer(p).advanced(by: MemoryLayout<MIDIEventPacket>.offset(of: \.words)!).assumingMemoryBound(to: UInt32.self)
            out.append((p.pointee.timeStamp, Array(UnsafeBufferPointer(start: words, count: Int(p.pointee.wordCount)))))
            p = UnsafePointer(MIDIEventPacketNext(p))
        }
        return out
    }
    /// Send from "SYNTH smoke in", stamped now (+ `aheadMs`); returns the host ms of the send. Any thread.
    @discardableResult func smokeSend(_ bytes: [UInt8], aheadMs: Double = 0) -> Double {
        let st = bytes[0], d1 = bytes.count > 1 ? bytes[1] : 0, d2 = bytes.count > 2 ? bytes[2] : 0
        let word = (st >= 0xF0 ? UInt32(0x1) << 28 : UInt32(0x2) << 28) | UInt32(st) << 16 | UInt32(d1) << 8 | UInt32(d2)
        let t = mach_absolute_time()
        let r = Self.oneList(word, t &+ Self.ticks(ms: aheadMs)) { MIDIReceivedEventList(smokeSrc, $0) }
        if r != noErr { Smoke.log(["k": "midi", "smokeSendError": r]) }
        return Self.ms(t)
    }
    /// Send through our output port INTO our own "SYNTH" destination (what another app does), stamped now + `aheadMs`; the host ms of the send.
    @discardableResult func smokeSendToApp(_ bytes: [UInt8], aheadMs: Double = 0) -> Double {
        let st = bytes[0], d1 = bytes.count > 1 ? bytes[1] : 0, d2 = bytes.count > 2 ? bytes[2] : 0
        let word = UInt32(0x2) << 28 | UInt32(st) << 16 | UInt32(d1) << 8 | UInt32(d2), t = mach_absolute_time()
        let r = Self.oneList(word, aheadMs > 0 ? t &+ Self.ticks(ms: aheadMs) : 0) { MIDISendEventList(outPort, appDest, $0) }
        if r != noErr { Smoke.log(["k": "midi", "smokeSendToAppError": r]) }
        return Self.ms(t)
    }
    func smokeDisposeSource() -> OSStatus { let r = MIDIEndpointDispose(smokeSrc); smokeSrc = 0; return r }
    func smokeRecreateSource() -> OSStatus { MIDISourceCreateWithProtocol(client, "SYNTH smoke in" as CFString, ._1_0, &smokeSrc) }
    /// A paced stream on the smoke queue: `n` messages `everyUs` apart (mach_wait_until), `make(i)` the bytes; the send times logged under `k`.
    func smokeStream(_ k: String, n: Int, everyUs: Int, make: @escaping (Int) -> [UInt8], done: (() -> Void)? = nil) {
        Self.smokeQ.async { [self] in
            let t0 = mach_absolute_time(), step = Self.ticks(ms: Double(everyUs) / 1000)
            var sends: [Double] = []; sends.reserveCapacity(n)
            for i in 0..<n { mach_wait_until(t0 &+ step &* UInt64(i)); sends.append(smokeSend(make(i))) }
            Smoke.log(["k": k, "n": n, "everyUs": everyUs, "sends": sends.map { ($0 * 1000).rounded() / 1000 }, "spanMs": Self.ms(mach_absolute_time() &- t0)])
            if let done { DispatchQueue.main.async(execute: done) }
        }
    }
}

extension ShellViewController {
    func smokeMidiSteps(sheetsSoFar: Int) -> [Step] {
        let m = midi
        let send: (String, [[UInt8]], Double) -> Step = { k, msgs, gapS in   // a few messages from the smoke source, `gapS` apart, logged with their host times
            { n in Midi.smokeQ.async { var at: [Double] = []; for (i, b) in msgs.enumerated() { if i > 0 { usleep(useconds_t(gapS * 1e6)) }; at.append(m.smokeSend(b)) }
                                      Smoke.log(["k": k, "bytes": msgs.map { $0.map { String(format: "%02x", $0) }.joined() }, "sends": at]); DispatchQueue.main.async(execute: n) } }
        }
        return [
            // 0 / 1. open (the page's requestMIDIAccess → { t: 'midi', on: true }), the ports
            js("midiOpen", "return __smoke.midiOpen()"), wait(0.3), js("midiStatus", "return __smoke.midiStatus()"),
            // 2. a note sounds (page gates pend with lane M's stub)
            send("midiNote", [[0x90, 0x3C, 0x64]], 0), js("midiWait", "return __smoke.midiWait(3000)"), send("midiNote", [[0x80, 0x3C, 0x00]], 0), wait(0.3), js("midiTake", "return __smoke.midiTake()"),
            // 3. controls: CC 1 0 / 127, bend centre / max
            send("midiCtl", [[0xB0, 1, 0], [0xB0, 1, 127], [0xE0, 0x00, 0x40], [0xE0, 0x7F, 0x7F]], 0.02), wait(0.4), js("midiCtlTake", "return __smoke.midiTake()"),
            // 4. the common clock (host − page), then the per-call cost of a tiny callAsyncJavaScript (day 1, §3.2 [R?])
            js("midiClock", "return __smoke.midiClock()"), callCost(1000),
            // 5. a 1 kHz burst: 1 000 CC 74 (values cycling 0…127)
            native("midiArm") { nil }, { n in m.smokeStream("midiBurstSent", n: 1000, everyUs: 1000, make: { [0xB0, 74, UInt8($0 & 0x7f)] }, done: n) }, wait(1.5), js("midiBurst", "return __smoke.midiTake()"),
            // 5b. a busy page: the main thread spun 150 ms while 5 notes arrive 20 ms apart
            { n in m.smokeStream("midiBusySent", n: 5, everyUs: 20000, make: { [0x90, UInt8(0x30 + $0), 0x64] }); self.js("midiBusy", "return __smoke.busy(150)")(n) },
            wait(0.5), send("midiBusyOff", (0..<5).map { [0x80, UInt8(0x30 + $0), 0] }, 0.005), wait(0.3), js("midiBusyTake", "return __smoke.midiTake()"),
            // 6. hot-plug: a note held on the smoke source, the source disposed → its release before the list; re-created → listed
            send("midiHold", [[0x90, 0x40, 0x64]], 0), wait(0.15),
            native("midiDispose") { ["dispose": m.smokeDisposeSource()] }, wait(0.6), js("midiHotplug", "return __smoke.midiStatus()"), js("midiHotplugTake", "return __smoke.midiTake()"),
            native("midiRecreate") { ["recreate": m.smokeRecreateSource(), "uid": Midi.int(m.smokeSrc, kMIDIPropertyUniqueID) ?? 0] }, wait(0.6), js("midiHotplug2", "return __smoke.midiStatus()"), js("midiHotplugTake2", "return __smoke.midiTake()"),
            // 7. MIDI out: the page → 'SYNTH smoke out' → the destination's block logs midiOut
            js("midiOutSend", "return __smoke.midiSend('SYNTH smoke out', [144, 36, 127])"), wait(0.3),
            // 7b. future stamps (§1.3 / §2.4 [R?]): a virtual source's note 300 ms ahead (the server holds it, or we do — `midiHeld`);
            // a note INTO our own "SYNTH" destination 300 ms ahead ("From other apps": the server delivers at its time, advance schedule 0)
            native("midiFuture") { ["kind": "source", "ahead": 300, "send": m.smokeSend([0x90, 0x41, 0x64], aheadMs: 300)] }, wait(0.7),
            native("midiFuture") { ["kind": "dest", "ahead": 300, "send": m.smokeSendToApp([0x90, 0x42, 0x64], aheadMs: 300)] }, wait(0.7),
            native("midiFuture") { ["kind": "destNow", "ahead": 0, "send": m.smokeSendToApp([0x90, 0x43, 0x64])] }, wait(0.3),
            send("midiFutureOff", [[0x80, 0x41, 0]], 0), native("midiFutureOff") { m.smokeSendToApp([0x80, 0x42, 0]); m.smokeSendToApp([0x80, 0x43, 0]); return nil }, wait(0.3), js("midiFutureTake", "return __smoke.midiTake()"),
            // 8. the gate: Sound in background off, a pedal and a note down, the app backgrounded by the script → the release triple, 3 dropped
            js("midiBgOff", "return __smoke.click('cvBg')"), wait(0.3), send("midiGateHold", [[0xB0, 64, 127], [0x90, 0x3E, 0x64]], 0.02), wait(0.3),
            gateStep(), wait(0.5), js("midiGateTake", "return __smoke.midiTake()"),
            send("midiGateNext", [[0x90, 0x3F, 0x64]], 0), wait(0.3), send("midiGateNext", [[0x80, 0x3F, 0x00]], 0), wait(0.3), js("midiGateTake2", "return __smoke.midiTake()"),
            // 9. inactive is not hidden (Sound in background still off): the scene resigns active as under Control Center → nothing released, nothing dropped
            native("midiInactive") { self.sceneActive(false); return ["active": false, "counters": m.counters] }, wait(0.2),
            send("midiInactiveCtl", [[0xB0, 1, 5]], 0), wait(0.3),
            native("midiInactive") { self.sceneActive(true); return ["active": true, "counters": m.counters] }, wait(0.2), js("midiInactiveTake", "return __smoke.midiTake()"),
            js("midiBgOn", "return __smoke.click('cvBg')"), wait(0.3),
            // 8b (fix R1-F1). Sound in background ON, a pedal and a note down, the app backgrounded by the script → the shell's background
            // task; its expiration path run by the Debug shell (as iPadOS does ≈ 30 s later) → the triple to the still-live page, the gate
            // shut (3 hidden sends dropped); the foreground reopens it and the next note plays
            send("midiBgTaskHold", [[0xB0, 64, 127], [0x90, 0x3D, 0x64]], 0.02), wait(0.3),
            bgTaskStep(), wait(0.5), js("midiBgTaskTake", "return __smoke.midiTake()"),
            send("midiBgTaskNext", [[0x90, 0x3B, 0x64]], 0), wait(0.3), send("midiBgTaskNext", [[0x80, 0x3B, 0x00]], 0), wait(0.3), js("midiBgTaskTake2", "return __smoke.midiTake()"),
            // 10. lone-note latency: 50 single notes 200 ms apart (a batch of 1 for all 50 — no coalescing delay)
            { n in m.smokeStream("midiLoneSent", n: 50, everyUs: 200_000, make: { [0x90, UInt8(0x30 + $0 % 12), 0x64] }, done: n) }, wait(0.3),
            send("midiLoneOff", (0..<12).map { [0x80, UInt8(0x30 + $0), 0] }, 0.005), wait(0.3), js("midiLone", "return __smoke.midiTake()"),
            // the stall (§9, optional): a confirm() holds the page's thread ≈ 1 s (the shell answers it) while native streams 4 kHz — controllers thinned, notes intact
            { n in Midi.smokeQ.asyncAfter(deadline: .now() + 0.05) { m.smokeStream("midiStallSent", n: 4000, everyUs: 250, make: { $0 % 40 == 0 ? [0x90, UInt8(0x24 + ($0 / 40) % 12), 0x64] : $0 % 40 == 1 ? [0x80, UInt8(0x24 + ($0 / 40) % 12), 0] : [0xB0, 74, UInt8($0 & 0x7f)] }) }
                   self.js("midiStall", "return __smoke.midiStall()")(n) },
            wait(2), js("midiStallTake", "return __smoke.midiTake()"), native("midiCounters") { m.counters },
            // 12. the Bluetooth sheet — last; a Save sheet right after proves the Presenter free (§4.1's settle rule)
            js("midiBt", "return __smoke.midiBt()"), wait(3), js("files", "return __smoke.click('fSave')"), sheets(sheetsSoFar + 1, 20),
        ]
    }
    /// Day 1: 1 000 sequential tiny calls (a 10-number array) through the same path as a batch; mean / p50 / p99 of the completion.
    private func callCost(_ n: Int) -> Step {
        { [weak self] next in
            guard let self else { return }
            var times: [Double] = []; times.reserveCapacity(n)
            let b: [Double] = Array(repeating: 1, count: 10)
            func one(_ i: Int) {
                guard i < n else {
                    times.sort()
                    let mean = times.reduce(0, +) / Double(max(1, times.count))
                    Smoke.log(["k": "midiCallCost", "n": times.count, "mean": mean, "p50": times[times.count / 2], "p90": times[times.count * 9 / 10], "p99": times[times.count * 99 / 100], "max": times.last ?? 0])
                    next(); return
                }
                let t0 = mach_absolute_time()
                self.midiCall("if (window.SYNTH_SHELL && SYNTH_SHELL.midiIn) SYNTH_SHELL.midiIn(b)", ["b": [-1.0, 0.0] + b]) { _, _ in times.append(Midi.ms(mach_absolute_time() &- t0)); one(i + 1) }
            }
            one(0)
        }
    }
    /// Step 8's round trip: `ready` → the script backgrounds the app → 3 sends while hidden (dropped at arrival) → `bgdone` → the script brings it back.
    private func gateStep() -> Step {
        { [weak self] next in
            guard let self else { return }
            let m = self.midi
            Smoke.log(["k": "midiGate", "step": "ready", "counters": m.counters])
            self.untilFlag(20, { !m.onScreen }, "background") { hidden in
                guard hidden else { Smoke.log(["k": "midiGate", "step": "bgdone", "timeout": true]); next(); return }
                let before = m.counters
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    Midi.smokeQ.async {
                        let at = [m.smokeSend([0x80, 0x3E, 0x00]), m.smokeSend([0xB0, 64, 0]), m.smokeSend([0x90, 0x3E, 0x64])]
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                            Smoke.log(["k": "midiGate", "step": "bgdone", "before": before, "after": m.counters, "onScreen": m.onScreen, "sends": at, "hiddenSendsOk": true])
                            self.untilFlag(30, { m.onScreen }, "foreground") { _ in Smoke.log(["k": "midiGate", "step": "fg", "counters": m.counters]); next() }
                        }
                    }
                }
            }
        }
    }
    /// Step 8b's round trip (fix R1-F1): `ready` → the script backgrounds the app → the shell holds a background task → its expiration
    /// path run here (iPadOS runs it ≈ 30 s in; the live process) → 3 sends while hidden and shut (dropped) → `bgdone` → the script brings it back.
    private func bgTaskStep() -> Step {
        { [weak self] next in
            guard let self else { return }
            let m = self.midi
            Smoke.log(["k": "midiBgTask", "step": "ready", "counters": m.counters])
            self.untilFlag(20, { !m.onScreen }, "background") { hidden in
                guard hidden else { Smoke.log(["k": "midiBgTask", "step": "bgdone", "timeout": true]); next(); return }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    let task = self.midiTask != .invalid, before = m.counters, gateBefore = m.gate
                    self.midiBackgroundExpired()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                        Midi.smokeQ.async {
                            let at = [m.smokeSend([0x80, 0x3D, 0x00]), m.smokeSend([0xB0, 64, 0]), m.smokeSend([0x90, 0x3D, 0x64])]
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                                Smoke.log(["k": "midiBgTask", "step": "bgdone", "task": task, "gateBefore": gateBefore, "gate": m.gate, "taskAfter": self.midiTask != .invalid, "before": before, "after": m.counters, "onScreen": m.onScreen, "sends": at])
                                self.untilFlag(30, { m.onScreen }, "foreground") { _ in Smoke.log(["k": "midiBgTask", "step": "fg", "counters": m.counters, "gate": m.gate]); next() }
                            }
                        }
                    }
                }
            }
        }
    }
    /// -smokeMode midicold (§8 step 11): no key played, Sound in background on (the default), the app backgrounded by the script,
    /// one note from the smoke source, probe() 2 s later and again in the foreground — recorded (the user's first-test shape).
    func smokeMidiCold() {
        let m = midi
        seq([wait(3), js("midiOpen", "return __smoke.midiOpen()"), js("status", "return __smoke.status('cold')"),
             native("midiCold") { ["step": "ready", "counters": m.counters] },
             { n in self.untilFlag(20, { !m.onScreen }, "background") { _ in n() } }, wait(1),
             { n in Midi.smokeQ.async { let at = m.smokeSend([0x90, 0x3C, 0x64]); Smoke.log(["k": "midiCold", "step": "sent", "at": at]); DispatchQueue.main.async(execute: n) } },
             wait(2), js("midiColdBg", "return __smoke.midiStatus()"), native("midiCold") { ["step": "bgdone", "counters": m.counters] },
             { n in self.untilFlag(30, { m.onScreen }, "foreground") { _ in n() } }, wait(1),
             js("midiColdFg", "return __smoke.midiStatus()"), { n in Midi.smokeQ.async { m.smokeSend([0x80, 0x3C, 0]); DispatchQueue.main.async(execute: n) } }, done])
    }
}
#endif
