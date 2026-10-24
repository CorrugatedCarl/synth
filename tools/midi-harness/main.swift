// tools/midi-harness — the native MIDI logic's executable test (IMPL-B §7, fixer M after review 2's F5): the REAL app/ios/SYNTH/Midi.swift
// (+ the real Smoke.swift, compiled without -DSMOKE: the log is off) built for macOS by run.sh with this file — Midi.swift needs only
// Foundation, CoreMIDI and os. A fake MidiHost records every callAsyncJavaScript the app would make (body + args) and completes it on
// the main queue, or holds the completion (a page stalled by a JS dialog). Event lists are built with MIDIEventListInit / MIDIEventListAdd
// and handed to Midi.receive (the very function the input port's block calls); the hot-plug case uses the Mac's real MIDI server
// (virtual endpoints of this process — the "SYNTH" destination exists on the Mac while it runs and vanishes with it). Nothing is written
// outside the build directory: the "SYNTH" destination's persisted uid goes to MemoryDefaults (review 2 found ~/Library/Preferences/
// midiharness.plist). Each case prints `ok` or `FAIL`; the exit status is the count of failures. Seeded from reviewer 2's harness.
import Foundation
import CoreMIDI

final class FakeHost: MidiHost {
    var calls: [[String: Any]] = []
    var hold = false
    var held: [(Bool, String?) -> Void] = []
    var callTimes: [UInt64] = []
    func midiCall(_ body: String, _ args: [String: Any], _ done: @escaping (Bool, String?) -> Void) {
        calls.append(args); callTimes.append(mach_absolute_time())
        if hold { held.append(done) } else { DispatchQueue.main.async { done(true, nil) } }
    }
    func release() { let h = held; held = []; for d in h { d(true, nil) } }
    /// every message delivered in batches since call index i: (uid, st, d1, d2)
    func msgs(from i: Int = 0) -> [M] {
        var out: [M] = []
        for a in calls[i...] { guard let b = a["b"] as? [Double] else { continue }
            var k = 2; while k + 5 <= b.count { out.append(M(uid: Int(b[k]), st: Int(b[k + 2]), d1: Int(b[k + 3]), d2: Int(b[k + 4]))); k += 5 } }
        return out
    }
    func dropped(from i: Int = 0) -> Int { calls[i...].compactMap { ($0["b"] as? [Double])?[1] }.reduce(0) { $0 + Int($1) } }
}
struct M { let uid: Int, st: Int, d1: Int, d2: Int; var hex: String { String(format: "%02X %02X %02X", st, d1, d2) } }
/// UserDefaults that keep everything in memory: the harness leaves no plist behind
final class MemoryDefaults: UserDefaults {
    private var d: [String: Any] = [:]
    override func object(forKey k: String) -> Any? { d[k] }
    override func set(_ v: Any?, forKey k: String) { d[k] = v }
    override func removeObject(forKey k: String) { d.removeValue(forKey: k) }
    override func integer(forKey k: String) -> Int { d[k] as? Int ?? 0 }
    override func set(_ v: Int, forKey k: String) { d[k] = v }
}
func spin(_ s: Double) { RunLoop.main.run(until: Date().addingTimeInterval(s)) }
/// an event list of `packets` (time, UMP words) → body(list)
func withList(_ packets: [(MIDITimeStamp, [UInt32])], _ body: (UnsafePointer<MIDIEventList>) -> Void) {
    let size = 65536, raw = UnsafeMutableRawPointer.allocate(byteCount: size, alignment: 16)
    defer { raw.deallocate() }
    let lp = raw.bindMemory(to: MIDIEventList.self, capacity: 1)
    var pkt: UnsafeMutablePointer<MIDIEventPacket> = MIDIEventListInit(lp, ._1_0)
    for (t, words) in packets { var w = words; pkt = MIDIEventListAdd(lp, size, pkt, t, w.count, &w) }
    body(UnsafePointer(lp))
}
func cv1(_ st: UInt8, _ d1: UInt8, _ d2: UInt8) -> UInt32 { 0x2 << 28 | UInt32(st) << 16 | UInt32(d1) << 8 | UInt32(d2) }
func send(_ m: Midi, uid: Int32, _ msgs: [[UInt8]], at: MIDITimeStamp = 0) {
    withList(msgs.map { (at, [cv1($0[0], $0.count > 1 ? $0[1] : 0, $0.count > 2 ? $0[2] : 0)]) }) { m.receive($0, uid: uid) }
}
func gateOpen(_ m: Midi) { m.ready = true; m.midiOpen = true; m.onScreen = true; m.backgroundAudio = true }
/// indexes of the messages matching `f`
func idx(_ l: [M], _ f: (M) -> Bool) -> [Int] { l.enumerated().filter { f($0.element) }.map(\.offset) }
/// every index of a before every index of b (both present)
func before(_ a: [Int], _ b: [Int]) -> Bool { !a.isEmpty && !b.isEmpty && a.max()! < b.min()! }
var failures = 0
func check(_ name: String, _ ok: Bool, _ detail: String) { print((ok ? "ok   " : "FAIL ") + name + " — " + detail); if !ok { failures += 1 } }
let tick = { (ms: Double) -> UInt64 in Midi.ticks(ms: ms) }
Midi.defaults = MemoryDefaults()

// ---------------------------------------------------------------- 1. UMP → bytes: one packet holding mixed UMP sizes (§2.3)
do {
    let m = Midi(), h = FakeHost(); m.host = h; gateOpen(m)
    let words: [UInt32] = [cv1(0x90, 0x3C, 0x64),                 // CV1 note on
                           0x3016_0102, 0x0304_0506,               // SysEx7 (2 words) — dropped
                           0xD010_0000, 0x1111_1111, 0x2222_2222, 0x3333_3333,   // FlexData (4 words) — skipped by size
                           0x10F2_0102,                            // System F2 (SPP)
                           0x10F8_0000, 0x10FE_0000,               // clock / sensing — dropped
                           cv1(0xC5, 0x07, 0x00),                  // program change
                           0x4090_3C00, 0xFFFF_0000,               // CV2 (2 words) — counted unexpected
                           0x0000_0000,                            // utility NOOP
                           cv1(0xE0, 0x7F, 0x7F), cv1(0xA1, 0x3C, 0x40), cv1(0xD2, 0x7F, 0x00), 0x10F6_0000, 0x10F1_2100, 0x10F3_0400, 0x10FA_0000]
    withList([(0, words)]) { m.receive($0, uid: 5) }
    spin(0.05)
    let got = h.msgs().map(\.hex).joined(separator: " | ")
    check("1 UMP → bytes", got == "90 3C 64 | F2 01 02 | C5 07 00 | E0 7F 7F | A1 3C 40 | D2 7F 00 | F6 00 00 | F1 21 00 | F3 04 00 | FA 00 00" && (m.counters["unexpected"] as? Int) == 1, got + "  unexpected=\(m.counters["unexpected"] ?? "?")")
}

// ---------------------------------------------------------------- 2. review 2 F2: a never-thinned overflow with the pedal let go inside the dropped buffer
do {
    let m = Midi(), h = FakeHost(); m.host = h; gateOpen(m)
    send(m, uid: 7, [[0xB0, 64, 127]]); spin(0.02)               // pedal down — delivered
    h.hold = true
    send(m, uid: 7, [[0x90, 60, 100]]); spin(0.02)               // a note — its call stays in flight (the page stalled: a JS dialog)
    let i0 = h.calls.count
    send(m, uid: 7, [[0xB0, 64, 0]])                             // pedal UP — queued behind the stall
    for k in 0..<4200 { send(m, uid: 7, [k % 2 == 0 ? [0x90, 61, 90] : [0x80, 61, 0]]) }   // a sequencer keeps playing (never-thinned)
    spin(0.02)
    let c = m.counters
    h.hold = false; h.release(); spin(0.1)
    let after = h.msgs(from: i0), up = idx(after) { $0.st == 0xB0 && $0.d1 == 64 && $0.d2 == 0 }, off = idx(after) { $0.st == 0xB0 && $0.d1 == 123 }
    check("2 overflow: the pedal-up in the dropped buffer → CC 64 = 0 before CC 123", before(up, off) && (c["overflows"] as? Int) == 1, "after the stall \(after.count) messages: CC 64 = 0 at \(up), CC 123 at \(off); counters at the stall \(c)")
}
// 2b. the same with the bend returned to centre inside the dropped buffer
do {
    let m = Midi(), h = FakeHost(); m.host = h; gateOpen(m)
    send(m, uid: 7, [[0xE0, 0x7F, 0x7F]]); spin(0.02)            // bent up — delivered
    h.hold = true; send(m, uid: 7, [[0x90, 60, 100]]); spin(0.02)
    let i0 = h.calls.count
    send(m, uid: 7, [[0xE0, 0x00, 0x40]])                        // back to centre — queued
    for k in 0..<4200 { send(m, uid: 7, [k % 2 == 0 ? [0x90, 61, 90] : [0x80, 61, 0]]) }
    h.hold = false; h.release(); spin(0.1)
    let after = h.msgs(from: i0), centre = idx(after) { $0.st == 0xE0 && $0.d1 == 0 && $0.d2 == 0x40 }, off = idx(after) { $0.st == 0xB0 && $0.d1 == 123 }
    check("2b overflow: the bend centre in the dropped buffer → E0 00 40 before CC 123", before(centre, off), "bend centre at \(centre), CC 123 at \(off)")
}

// ---------------------------------------------------------------- 3. review 2 F4: the gate at arrival drops only what was stamped while it was shut
do {
    let m = Midi(), h = FakeHost(); m.host = h; gateOpen(m)
    spin(0.01)
    let now = mach_absolute_time()
    send(m, uid: 9, [[0x90, 60, 100]], at: 0)                    // 0 → arrival
    send(m, uid: 9, [[0x90, 61, 100]], at: now &- tick(1000))    // stamped 1 s ago (another app's stale / render-time stamp)
    send(m, uid: 9, [[0x90, 62, 100]], at: now &- tick(5))       // 5 ms ago, 10 ms after the gate opened
    send(m, uid: 9, [[0x90, 63, 100]], at: 1)                     // an absurd stamp (§1.3: "→ age 2 000", delivered)
    spin(0.05)
    let got = h.msgs().map { String(format: "%02X", $0.d1) }
    check("3a stamps before openedAt (never shut): all delivered", got == ["3C", "3D", "3E", "3F"] && h.dropped() == 0, "delivered \(got), dropped \(h.dropped())")
    // shut for 50 ms, reopened: a stamp inside the shut window is a resumed receive thread's backlog → dropped; one older than the shut passes
    let i0 = h.calls.count
    m.onScreen = false; m.backgroundAudio = false; spin(0.05)
    let shut = mach_absolute_time(); spin(0.05)
    m.onScreen = true; spin(0.01)
    let reopened = mach_absolute_time()
    send(m, uid: 9, [[0x90, 64, 100]], at: shut)                  // stamped while shut
    send(m, uid: 9, [[0x90, 65, 100]], at: reopened &- tick(200)) // stamped before the shut (older than the window)
    send(m, uid: 9, [[0x90, 66, 100]], at: 0)                      // now
    spin(0.05)
    let got2 = h.msgs(from: i0).filter { $0.st == 0x90 }.map { String(format: "%02X", $0.d1) }   // (the shut's own CC 123 for the notes above rides first)
    check("3b a stamp inside [closedAt, openedAt) dropped, an older one and a fresh one delivered", got2 == ["41", "42"] && h.dropped(from: i0) == 1, "delivered \(got2), dropped \(h.dropped(from: i0))")
}

// ---------------------------------------------------------------- 4. thinning (§3.2): latest value at its latest position; 64–69 / 120–127 / PC / notes never
do {
    let m = Midi(), h = FakeHost(); m.host = h; gateOpen(m)
    h.hold = true; send(m, uid: 3, [[0x90, 40, 1]]); spin(0.01)
    let i0 = h.calls.count
    for k in 0..<2100 {
        let b: [UInt8] = k == 1000 ? [0x90, 50, 100] : k == 1001 ? [0xB0, 66, 127] : k == 1002 ? [0xC0, 5] : k == 1003 ? [0xB0, 123, 0] : k == 1500 ? [0x80, 50, 0] : [0xB0, 1, UInt8(k & 0x7f)]
        send(m, uid: 3, [b])
    }
    h.hold = false; h.release(); spin(0.1)
    let got = h.msgs(from: i0).map(\.hex)
    check("4 thin: notes, CC 66, PC, CC 123 kept in order; CC 1 to its latest values at the end", got.prefix(5) == ["90 32 64", "B0 42 7F", "C0 05 00", "B0 7B 00", "80 32 00"] && got.last == "B0 01 33" && got.count < 100 && h.dropped(from: i0) == 2100 - got.count, "\(got.count) delivered, dropped \(h.dropped(from: i0)); first \(got.prefix(6).joined(separator: " | ")) … last \(got.last ?? "-")")
}

// ---------------------------------------------------------------- 5. pacing (§3.2, B4): a lone note at once; a 1 kHz stream ≤ 500 calls / s (+ slop)
do {
    let m = Midi(), h = FakeHost(); m.host = h; gateOpen(m)
    spin(0.01)
    let t0 = mach_absolute_time(); send(m, uid: 1, [[0x90, 60, 100]]); spin(0.01)
    let lone = Midi.ms(h.callTimes[0] &- t0)
    check("5a a lone note: one call at once", h.calls.count == 1 && lone < 5, String(format: "%.3f ms after receive", lone))
    let c0 = h.calls.count, q = DispatchQueue(label: "src", qos: .userInteractive), done = DispatchSemaphore(value: 0)
    q.async { let s = mach_absolute_time(); for k in 0..<1000 { mach_wait_until(s &+ tick(Double(k))); send(m, uid: 1, [[0xB0, 74, UInt8(k & 0x7f)]]) }; done.signal() }
    while done.wait(timeout: .now()) == .timedOut { spin(0.005) }
    spin(0.05)
    let got = h.msgs(from: c0), calls = h.calls.count - c0
    check("5b 1 kHz × 1 000: all in order, ≤ 520 calls", got.count == 1000 && got.map(\.d2) == (0..<1000).map { $0 & 0x7f } && calls <= 520, "\(calls) calls, \(got.count) delivered")
}

// ---------------------------------------------------------------- 6. review 2 N2: a WebContent termination — pageReset FIRST, then ready = false: nothing built for the dead page
do {
    let m = Midi(), h = FakeHost(); m.host = h; gateOpen(m)
    send(m, uid: 2, [[0xB0, 64, 127], [0x90, 60, 100]]); spin(0.02)
    let c0 = h.calls.count
    m.pageReset(); m.ready = false                              // the shell's order (ShellViewController.webViewWebContentProcessDidTerminate)
    spin(0.02)
    check("6 termination: no call to the dead page", h.calls.count == c0 && (m.counters["masks"] as? Int) == 0, "\(h.calls.count - c0) call(s): " + h.msgs(from: c0).map(\.hex).joined(separator: " | "))
}

// ---------------------------------------------------------------- 7. review 2 F3 + N5 / N1: the Mac's real MIDI server — the client made off the main thread (open replies later);
// another app's virtual source re-created with the SAME uniqueID is reconnected (keyed by endpoint ref)
do {
    let m = Midi(), h = FakeHost(); m.host = h
    var reply: [String: Any]? = nil, replies = 0
    m.prepare()                                                  // (the shell's launch call: the client on a utility queue)
    m.open { r in reply = r; replies += 1 }
    var waited = 0.0; while reply == nil && waited < 5 { spin(0.02); waited += 0.02 }
    let r = reply ?? [:]
    check("7 open: the client made off the main thread, the reply has ports / gen / h", r["error"] == nil && (r["ports"] as? [[String: Any]]) != nil && (r["gen"] as? Int) == 1 && (r["h"] as? Double) != nil, String(format: "after %.2f s: %@", waited, r.keys.sorted().joined(separator: ",")))
    m.open { _ in replies += 1 }; spin(0.02)
    check("7 a second open answers at once (one client)", replies == 2 && m.gen == 2, "replies \(replies), gen \(m.gen)")
    if r["error"] == nil {
        m.ready = true; spin(0.3)
        var oc = MIDIClientRef(); _ = MIDIClientCreateWithBlock("Other app" as CFString, &oc, nil)
        let UID: Int32 = 0x2B5E_0D01
        func make() -> MIDIEndpointRef { var s = MIDIEndpointRef(); _ = MIDISourceCreateWithProtocol(oc, "Other app out" as CFString, ._1_0, &s); _ = MIDIObjectSetIntegerProperty(s, kMIDIPropertyUniqueID, UID); return s }
        func play(_ s: MIDIEndpointRef, _ n: UInt8) -> Bool {
            let c0 = h.calls.count
            withList([(mach_absolute_time(), [cv1(0x90, n, 100)])]) { _ = MIDIReceivedEventList(s, $0) }
            spin(0.3)
            return h.msgs(from: c0).contains { $0.uid == Int(UID) && $0.d1 == Int(n) }
        }
        let listed = { m.portList().contains { ($0["id"] as? String) == String(UID) } }
        var src = make(); spin(0.6)
        check("7a another app's source: listed, a note arrives", listed() && play(src, 60), "listed \(listed())")
        // the app restarts its MIDI (dispose + create, the same uniqueID — Apple's advice) within one 50 ms debounce: the ref changed, the uid did not
        let c1 = h.calls.count
        _ = MIDIEndpointDispose(src); src = make(); spin(0.6)
        let rel = h.msgs(from: c1).filter { $0.uid == Int(UID) && $0.st == 0xB0 && $0.d1 == 123 }.count
        check("7b disposed + re-created at once (same uid): still listed, reconnected (a note arrives), its held note released", listed() && play(src, 61) && rel == 1, "released \(rel)")
        _ = MIDIEndpointDispose(src); spin(0.6); src = make(); spin(0.6)
        check("7c disposed, 0.6 s, re-created (two relists)", play(src, 62), "")
        _ = MIDIEndpointDispose(src); spin(0.6)
        var line: [String] = [], allPlay = true
        for (i, gap) in [0.02, 0.05, 0.1, 0.2, 0.3].enumerated() {
            src = make(); spin(0.6)
            _ = MIDIEndpointDispose(src); spin(gap); src = make(); spin(0.6)
            let p = play(src, UInt8(70 + i)); allPlay = allPlay && p
            line.append(String(format: "%.0f ms → %@", gap * 1000, p ? "plays" : "DEAF"))
            _ = MIDIEndpointDispose(src); spin(0.6)
        }
        check("7d dispose → gap → re-create (same uid): every gap plays", allPlay, line.joined(separator: ", "))
    }
}

// ---------------------------------------------------------------- 8. review 1 F2: the release triple ordered ACROSS ports — all CC 64 = 0, then all bend centres, then all CC 123
do {
    let m = Midi(), h = FakeHost(); m.host = h; gateOpen(m)
    send(m, uid: 9, [[0xB0, 64, 127], [0x90, 60, 100]])          // the higher uid: pedal + note on ch 1
    send(m, uid: 3, [[0x90, 62, 100], [0xE1, 0x7F, 0x7F]])       // the lower uid (sorts first): a note on ch 1, a bend on ch 2
    spin(0.02)
    let c0 = h.calls.count
    m.onScreen = false; m.backgroundAudio = false; spin(0.05)    // the gate shuts: the closing batch
    let got = h.msgs(from: c0), up = idx(got) { $0.st == 0xB0 && $0.d1 == 64 }, bend = idx(got) { $0.st & 0xF0 == 0xE0 }, off = idx(got) { $0.st == 0xB0 && $0.d1 == 123 }
    check("8 release order across ports: CC 64 = 0 (uid 9) < bend centre (uid 3) < CC 123 (uids 3, 9)", before(up, bend) && before(bend, off) && off.count == 2 && got.count == 4, got.map { "\($0.uid):\($0.hex)" }.joined(separator: " | "))
}

// ---------------------------------------------------------------- 9. review 1 F9: a note-off clears its note; a port that played and released owes no CC 123
do {
    let m = Midi(), h = FakeHost(); m.host = h; gateOpen(m)
    send(m, uid: 5, [[0x90, 60, 100], [0x80, 60, 0]])            // on, off
    send(m, uid: 6, [[0x90, 60, 100], [0x90, 60, 100], [0x90, 60, 0]])   // doubled, then a velocity-0 note-on (= off)
    send(m, uid: 7, [[0x90, 60, 100], [0x90, 62, 100], [0x80, 60, 0]])   // 62 still held
    send(m, uid: 8, [[0x91, 60, 100], [0xB1, 123, 0]])           // the device's own All Notes Off on ch 2
    spin(0.02)
    let c0 = h.calls.count
    m.onScreen = false; m.backgroundAudio = false; spin(0.05)
    let got = h.msgs(from: c0)
    check("9 note-offs clear the held notes: only uid 7 owes a CC 123", got.map { "\($0.uid):\($0.hex)" } == ["7:B0 7B 00"], got.map { "\($0.uid):\($0.hex)" }.joined(separator: " | "))
}

// ---------------------------------------------------------------- 10. review 1 F1 (the native half): the background task expired → the gate shut with its releases; arrivals dropped; the foreground reopens
do {
    let m = Midi(), h = FakeHost(); m.host = h; gateOpen(m)
    var gates: [Bool] = []; m.gateChanged = { gates.append($0) }
    m.onScreen = false; spin(0.02)                               // behind another app, Sound in background on: still open
    send(m, uid: 4, [[0xB0, 64, 127], [0x90, 60, 100]]); spin(0.02)
    let c0 = h.calls.count
    check("10a hidden with Sound in background on: the gate open, the note delivered", m.gate && h.msgs().count == 2 && gates.isEmpty, "gate \(m.gate), \(h.msgs().count) delivered")
    m.backgroundExpired = true; spin(0.05)                       // the shell's expiration handler
    let got = h.msgs(from: c0).map(\.hex)
    check("10b the task expired: the gate shut, CC 64 = 0 then CC 123 flushed, gateChanged(false)", !m.gate && got == ["B0 40 00", "B0 7B 00"] && gates == [false], "gate \(m.gate), \(got), gateChanged \(gates)")
    let c1 = h.calls.count
    send(m, uid: 4, [[0x90, 62, 100]]); spin(0.02)
    check("10c an arrival while expired is dropped at arrival", h.calls.count == c1 && (m.counters["dropped"] as? Int) == 1, "dropped \(m.counters["dropped"] ?? "?")")
    m.onScreen = true; m.backgroundExpired = false; spin(0.02)   // sceneWillEnterForeground
    let c2 = h.calls.count
    send(m, uid: 4, [[0x90, 64, 100]]); spin(0.02)
    check("10d the foreground reopens: the next note delivered (the drop reported in its batch)", m.gate && gates == [false, true] && h.msgs(from: c2).map(\.hex) == ["90 40 64"] && h.dropped(from: c2) == 1, "gate \(m.gate), gateChanged \(gates), \(h.msgs(from: c2).map(\.hex))")
}

print(failures == 0 ? "midi-harness: PASS" : "midi-harness: FAIL (\(failures) failing)")
exit(Int32(min(failures, 125)))
