import Foundation
import CoreMIDI
import os

// CoreMIDI behind the page's Web MIDI shim (IMPL-B §2, §3, §5): one client, made on a utility queue at launch (`prepare`) or at the
// page's first { t: 'midi', on: true } (`open`, which replies once it exists — fix R2-N5: the main thread never waits the ≈ 700 ms a
// simulator session's first MIDIServer start can take) and never disposed (MIDIServices.h:1462–1479); one input port connected to
// every source (USB, Bluetooth once paired, other apps' virtual sources), keyed uid → endpoint ref (fix R2-F3: an endpoint re-created
// under the same uniqueID is reconnected); one output port (pad lights back); the virtual destination "SYNTH" — other apps play SYNTH
// through it, the page sees it as the input "From other apps". The receive block (CoreMIDI's high-priority thread) parses UMP words to
// MIDI 1.0 bytes, decides the gate AT ARRIVAL, keeps the per-port release masks and appends to a locked pending buffer; the main thread
// flushes it as ONE callAsyncJavaScript per batch — flush starts ≥ 2 ms apart (a hard 500 calls / s), one call in flight, a lone note
// never waits. Every path that stops delivery (the gate closing — incl. the shell's background task expiring, fix R1-F1 —, a port gone,
// offline or re-created, a never-thinned overflow) queues the release triple in THREE PASSES over the sounding channels of every port
// concerned — all CC 64 = 0 where sustain was down, then every bend centred, then every CC 123 (fix R1-F2: the page's held / sustain are
// per channel, so the order must hold across ports) — ahead of anything that follows, on the one ordered native → page queue the port
// lists share. Main thread unless said otherwise; `Shared` only under `lock`.
protocol MidiHost: AnyObject {
    /// native → web: callAsyncJavaScript with arguments (never a built string); `done(ok, error)` on main, on every completion
    func midiCall(_ body: String, _ args: [String: Any], _ done: @escaping (Bool, String?) -> Void)
}

final class Midi {
    static let flushIntervalMs: Double = 2        // §3.2: the minimum between flush starts — a 1 kHz stream makes ≤ 500 calls / s
    static let pendingCap = 2048                   // §3.2: above it controllers are thinned to their latest values
    static let neverThinnedCap = 4096              // §3.2: the never-thinned alone past this → the release path (never "drop the oldest")
    static let maxAgeMs: Double = 2000             // §1.3: age clamped 0…2 000 ms (another app's stale stamp); a hold ≤ 2 s ahead
    static let relistDebounceMs: Double = 50       // §2.1: a device plugs in as several notifications
    static let otherApps = "From other apps"       // §2.4: the virtual destination "SYNTH", as the page's input
    static var defaults = UserDefaults.standard    // the "SYNTH" destination's persisted uniqueID (the harness swaps in a memory store)
    private static let umpWords = [1, 1, 1, 2, 2, 4, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4]   // §2.3: words per UMP message type 0x0–0xF

    struct Msg { var uid: Int32; var at: UInt64; var st: UInt8; var d1: UInt8; var d2: UInt8 }   // `at`: host ticks (0 stamp → arrival)
    /// Per port (§3.4): a bit per channel for sustain down and bend off centre, and the notes on since the last release — 128 bits per
    /// channel (fix R1-F9: a note-off, or a velocity-0 note-on, clears its note; CC 120 / 123 the channel; a channel sounds while any is set)
    struct Masks {
        var sus: UInt16 = 0, bend: UInt16 = 0
        var held = [UInt64](repeating: 0, count: 32)
        var notes: UInt16 { var m: UInt16 = 0; for ch in 0..<16 where held[2 * ch] | held[2 * ch + 1] != 0 { m |= 1 << ch }; return m }
        mutating func note(_ ch: Int, _ n: UInt8, on: Bool) { let i = 2 * ch + Int(n >> 6), b = UInt64(1) << UInt64(n & 63); if on { held[i] |= b } else { held[i] &= ~b } }
        mutating func allOff(_ ch: Int) { held[2 * ch] = 0; held[2 * ch + 1] = 0 }
        mutating func dirty(_ ch: Int) { let b = UInt16(1 << ch); sus |= b; bend |= b; held[2 * ch] |= 1 }   // fix R2-F2: the whole triple owed
    }
    struct Shared {
        var pending: [Msg] = []
        var dropped = 0                   // thinned or dropped since the last batch (rides in it)
        var unexpected = 0                // ChannelVoice2 words on a ._1_0 port (§2.3)
        var gateOpen = false              // the gate (§3.4), mirrored by main
        var openedAt: UInt64 = 0          // the last reopen; with `closedAt` the shut window whose stamps are dropped (§2.2, fix R2-F4)
        var closedAt: UInt64 = 0
        var flushScheduled = false
        var masks: [Int32: Masks] = [:]
        var nextThin = Midi.pendingCap
        var overflows = 0
        var appUid: Int32 = 0             // the "SYNTH" destination's uniqueID (its block gets no refCon)
    }
    private let lock = OSAllocatedUnfairLock(initialState: Shared())
    weak var host: MidiHost?

    // the gate's inputs (main) — the shell assigns them; the gate itself is recomputed and mirrored under the lock
    var ready = false { didSet { updateGate() } }
    var midiOpen = false { didSet { updateGate() } }
    var onScreen = true { didSet { updateGate() } }           // sceneBackground, NOT the scene's active state (§3.4)
    var backgroundAudio = true { didSet { updateGate() } }
    var backgroundExpired = false { didSet { updateGate() } }   // fix R1-F1: the shell's background task expired — iPadOS suspends the app next; shut until the foreground
    var gateChanged: ((Bool) -> Void)?                        // main, after each change (the shell ends its background task when the gate shuts)
    private(set) var gate = false

    private(set) var client = MIDIClientRef()
    private var creating = false, waiters: [([String: Any]) -> Void] = [], lastError = "MIDI client not created"
    private var inPort = MIDIPortRef()
    private(set) var outPort = MIDIPortRef(), appDest = MIDIEndpointRef()
    struct Port { let ref: MIDIEndpointRef; let uid: Int32; let name: String; let manufacturer: String }
    private(set) var sources: [Port] = [], destinations: [Port] = []
    private var connected: [Int32: MIDIEndpointRef] = [:]     // uid → the endpoint our input port is connected to (fix R2-F3)
    private(set) var gen = 0
    private var relistTimer: DispatchSourceTimer?

    private enum Item { case batch([Msg], dropped: Int), ports([[String: Any]], gen: Int) }
    private var queue: [Item] = []                 // the one ordered native → page queue (§3.1)
    private var inFlight = false
    private var pageGen = 0                        // bumped by pageReset: a late completion from the old page is ignored
    private var lastFlushStart: UInt64 = 0
    private var future: [Msg] = []                 // §1.3: another app's future-stamped events, held until due (main)
    private var timer: DispatchSourceTimer?
    private var timerDeadline: UInt64 = 0
    private(set) var calls = 0, batches = 0
    #if SMOKE
    var smokeSrc = MIDIEndpointRef(), smokeDst = MIDIEndpointRef()
    #endif

    // MARK: host time (MIDITimeStamp = mach_absolute_time, MIDIServices.h:253–263)
    private static let timebase: Double = { var tb = mach_timebase_info(); mach_timebase_info(&tb); return Double(tb.numer) / Double(tb.denom) / 1e6 }()   // ms per tick
    static func ms(_ ticks: UInt64) -> Double { Double(ticks) * timebase }
    static func ticks(ms: Double) -> UInt64 { UInt64(max(0, ms) / timebase) }
    static var hostMs: Double { ms(mach_absolute_time()) }

    // MARK: the client (§2.1) — made once, off the main thread; the page's { t: 'midi', on: true } (and a restarted page's) relists
    /// Launch (fix R2-N5): the client is made on a utility queue while the page loads, so the page's open finds it ready.
    func prepare() { if client == 0 { createClient() } }
    /// The reply to { t: 'midi' } — the current ports, gen and the host clock, or ["error": …] (retried on the page's next request) —
    /// through `done` on main, at once when the client exists, else when it has been made.
    func open(_ done: @escaping ([String: Any]) -> Void) {
        waiters.append(done)
        if client != 0 { answer() } else { createClient() }
    }
    /// A utility THREAD of its own, its run loop kept alive for the app's life — not a GCD worker: a client made on a worker while main
    /// ran its run loop missed every notification in two of three harness runs (CoreMIDI may bind them to the creating thread's run
    /// loop, which a worker never runs; the probe with main blocked during the create always delivered). ≈ 12 ms, ≈ 700 ms once per
    /// simulator session (its MIDIServer starting) — never on the main thread.
    private func createClient() {
        guard !creating else { return }
        creating = true
        let t = Thread { [weak self] in
            var c = MIDIClientRef()
            let t0 = mach_absolute_time()
            let st = MIDIClientCreateWithBlock("SYNTH" as CFString, &c) { [weak self] n in self?.notified(n.pointee.messageID) }   // any thread (:1451): a hop to main, nothing else
            let createMs = Self.ms(mach_absolute_time() &- t0)
            DispatchQueue.main.async { [weak self] in self?.clientCreated(c, st, createMs) }
            RunLoop.current.add(Foundation.Port(), forMode: .default)                       // (a source keeps the loop from returning at once)
            while true { RunLoop.current.run(mode: .default, before: .distantFuture) }
        }
        t.name = "synth.midi.client"; t.qualityOfService = .utility
        t.start()
    }
    private func clientCreated(_ c: MIDIClientRef, _ st: OSStatus, _ createMs: Double) {
        creating = false
        guard st == noErr else { Smoke.log(["k": "midi", "client": st, "createMs": createMs]); lastError = "MIDIClientCreateWithBlock \(st)"; answer(); return }
        client = c
        var line: [String: Any] = ["k": "midi", "client": st, "createMs": createMs, "sources": MIDIGetNumberOfSources(), "destinations": MIDIGetNumberOfDestinations(), "devices": MIDIGetNumberOfDevices()]
        line.merge(createEndpoints()) { a, _ in a }
        Smoke.log(line)
        answer()
    }
    /// The ports and the "SYNTH" destination — each made when missing (fix R2-N1: a failed one is retried at the next open, never left 0
    /// behind a live client); the statuses of what was made, for the log.
    private func createEndpoints() -> [String: Any] {
        var line: [String: Any] = [:]
        if inPort == 0 {
            let st = MIDIInputPortCreateWithProtocol(client, "SYNTH in" as CFString, ._1_0, &inPort) { [weak self] list, refCon in
                self?.receive(list, uid: Int32(truncatingIfNeeded: refCon.map { Int(bitPattern: $0) } ?? 0))
            }
            if st != noErr { inPort = 0; lastError = "MIDIInputPortCreateWithProtocol \(st)" }
            line["inPort"] = st
        }
        if outPort == 0 { let st = MIDIOutputPortCreate(client, "SYNTH out" as CFString, &outPort); if st != noErr { outPort = 0 }; line["outPort"] = st }
        if appDest == 0 {
            // §2.4 the virtual destination "SYNTH": other apps list SYNTH as a destination; the same parse, the uid from the lock
            let st = MIDIDestinationCreateWithProtocol(client, "SYNTH" as CFString, ._1_0, &appDest) { [weak self] list, _ in
                guard let self else { return }
                self.receive(list, uid: self.lock.withLock { $0.appUid })
            }
            var appUid: Int32 = 0
            if st == noErr {
                let saved = Int32(truncatingIfNeeded: Self.defaults.integer(forKey: "midiDestUID"))
                if saved != 0 { _ = MIDIObjectSetIntegerProperty(appDest, kMIDIPropertyUniqueID, saved) }   // kMIDIIDNotUnique → keep the assigned one (:142–164)
                appUid = Self.int(appDest, kMIDIPropertyUniqueID) ?? 0
                Self.defaults.set(Int(appUid), forKey: "midiDestUID")
                let uid = appUid
                lock.withLock { $0.appUid = uid }
            } else { appDest = 0 }
            line["dest"] = st; line["destUid"] = appUid
        }
        #if SMOKE
        if Smoke.on, smokeSrc == 0 { line["smoke"] = smokeCreateEndpoints() }
        #endif
        return line
    }
    /// Every waiting open answered: the ports (the tables rebuilt, the gate's `midiOpen`) or the error.
    private func answer() {
        let r: [String: Any]
        if client == 0 { r = ["error": lastError] }
        else {
            let made = createEndpoints()
            if !made.isEmpty { var l = made; l["k"] = "midi"; l["retry"] = true; Smoke.log(l) }
            if inPort == 0 { r = ["error": lastError] }
            else { rebuildTables(); gen += 1; midiOpen = true; r = ["ports": portList(), "gen": gen, "h": Self.hostMs] }
        }
        let w = waiters; waiters.removeAll()
        w.forEach { $0(r) }
    }

    private func notified(_ id: MIDINotificationMessageID) {
        switch id {
        case .msgSetupChanged, .msgObjectAdded, .msgObjectRemoved, .msgPropertyChanged: DispatchQueue.main.async { [weak self] in self?.scheduleRelist() }
        default: break
        }
    }
    private func scheduleRelist() {           // debounced 50 ms (§2.1)
        if relistTimer == nil {
            let t = DispatchSource.makeTimerSource(queue: .main)
            t.setEventHandler { [weak self] in self?.relistTimer = nil; self?.relist() }
            relistTimer = t
            t.schedule(deadline: .now() + .milliseconds(Int(Self.relistDebounceMs)))
            t.resume()
        }
    }
    /// Hot-plug (§2.1): rebuild the tables (connect new sources, disconnect gone ones — their releases queued first), then the list.
    /// Nothing while no page has opened access (its open rebuilds the tables itself).
    func relist() {
        guard client != 0, midiOpen else { return }
        rebuildTables()
        gen += 1
        queue.append(.ports(portList(), gen: gen))
        pump()
        Smoke.log(["k": "midiPorts", "gen": gen, "inputs": sources.map(\.name) + (appDest != 0 ? [Self.otherApps] : []), "outputs": destinations.map(\.name)])
    }
    private func rebuildTables() {
        var src: [Port] = []
        for i in 0..<MIDIGetNumberOfSources() { let e = MIDIGetSource(i); if Self.listed(e) { src.append(Self.port(e)) } }
        let ids = Set(src.map(\.uid))
        var dead = Set(connected.keys).subtracting(ids)                                        // gone or offline
        for p in src { if let old = connected[p.uid], old != p.ref { dead.insert(p.uid) } }     // fix R2-F3: the same uid on a new endpoint — the old one is dead
        let stale = dead
        for (uid, ref) in connected where stale.contains(uid) { _ = MIDIPortDisconnectSource(inPort, ref); connected.removeValue(forKey: uid) }
        if !stale.isEmpty {                   // §3.4: a vanished, offline or re-created input's sounding channels released, before the list (one queue)
            let now = mach_absolute_time()
            let n = lock.withLock { s in self.releases(&s, ports: stale, at: now) }
            flush(force: true)
            Smoke.log(["k": "midiGate", "gone": stale.sorted().map { String($0) }, "released": n])
        }
        for p in src where connected[p.uid] == nil { if MIDIPortConnectSource(inPort, p.ref, UnsafeMutableRawPointer(bitPattern: Int(p.uid))) == noErr { connected[p.uid] = p.ref } }
        sources = src
        var dst: [Port] = []
        for i in 0..<MIDIGetNumberOfDestinations() { let e = MIDIGetDestination(i); if e != appDest, Self.listed(e) { dst.append(Self.port(e)) } }   // never "SYNTH" itself (no self-loop)
        destinations = dst
    }
    /// The whole list each time (§1.2: an id absent from it is 'disconnected'); "From other apps" last (§6).
    func portList() -> [[String: Any]] {
        var l: [[String: Any]] = sources.map { ["id": String($0.uid), "name": $0.name, "manufacturer": $0.manufacturer, "type": "input", "state": "connected"] }
        if appDest != 0 { l.append(["id": String(lock.withLock { $0.appUid }), "name": Self.otherApps, "manufacturer": "SYNTH", "type": "input", "state": "connected"]) }
        l += destinations.map { ["id": String($0.uid), "name": $0.name, "manufacturer": $0.manufacturer, "type": "output", "state": "connected"] }
        return l
    }
    private static func listed(_ e: MIDIEndpointRef) -> Bool { (int(e, kMIDIPropertyPrivate) ?? 0) == 0 && (inherited(e, kMIDIPropertyOffline) ?? 0) == 0 }
    private static func port(_ e: MIDIEndpointRef) -> Port {
        var name = str(e, kMIDIPropertyDisplayName); if name.isEmpty { name = str(e, kMIDIPropertyName) }
        var man = str(e, kMIDIPropertyManufacturer)
        var ent = MIDIEntityRef(), dev = MIDIDeviceRef()
        if man.isEmpty, MIDIEndpointGetEntity(e, &ent) == noErr { man = str(ent, kMIDIPropertyManufacturer); if man.isEmpty, MIDIEntityGetDevice(ent, &dev) == noErr { man = str(dev, kMIDIPropertyManufacturer) } }
        return Port(ref: e, uid: int(e, kMIDIPropertyUniqueID) ?? 0, name: name, manufacturer: man)
    }
    static func str(_ o: MIDIObjectRef, _ p: CFString) -> String { var s: Unmanaged<CFString>?; return MIDIObjectGetStringProperty(o, p, &s) == noErr ? (s?.takeRetainedValue() as String? ?? "") : "" }
    static func int(_ o: MIDIObjectRef, _ p: CFString) -> Int32? { var v: Int32 = 0; return MIDIObjectGetIntegerProperty(o, p, &v) == noErr ? v : nil }
    private static func inherited(_ e: MIDIEndpointRef, _ p: CFString) -> Int32? {   // endpoint → entity → device (:992–1000: offline is the device's)
        if let v = int(e, p) { return v }
        var ent = MIDIEntityRef(), dev = MIDIDeviceRef()
        guard MIDIEndpointGetEntity(e, &ent) == noErr else { return nil }
        if let v = int(ent, p) { return v }
        return MIDIEntityGetDevice(ent, &dev) == noErr ? int(dev, p) : nil
    }

    // MARK: the gate (§3.4) — recomputed on main, mirrored under the lock; closing queues the releases with its own pass
    private func updateGate() {
        let open = ready && midiOpen && (onScreen || (backgroundAudio && !backgroundExpired))
        guard open != gate else { return }
        gate = open
        let now = mach_absolute_time()
        let n = lock.withLock { s -> Int in
            s.gateOpen = open
            if open { s.openedAt = now; return 0 }
            s.closedAt = now
            return self.releases(&s, ports: nil, at: now)
        }
        if !open { future.removeAll(); flush(force: true) }   // the closing batch: what was pending, then the releases
        Smoke.log(["k": "midiGate", "open": open, "released": n, "ready": ready, "midiOpen": midiOpen, "onScreen": onScreen, "backgroundAudio": backgroundAudio, "backgroundExpired": backgroundExpired, "counters": counters])
        gateChanged?(open)
    }
    /// A page commit or a WebContent termination (§5.1): nothing to release (the new page starts with nothing held), the queue,
    /// the in-flight flag and the masks dropped, the page generation bumped, the gate shut until the new page opens access.
    func pageReset() {
        lock.withLock { s in s.masks.removeAll(); s.pending.removeAll(); s.dropped = 0 }
        future.removeAll(); queue.removeAll(); inFlight = false; pageGen += 1
        midiOpen = false
    }
    /// Per port (`ports` nil: every port) in three passes over the selected ports' channels — every CC 64 = 0 where sustain is down,
    /// then every bend centred where bent, then every CC 123 where a note is still on (§3.4; fix R1-F2: the order holds across ports) —
    /// appended to pending (past the gate: the closing batch carries them); the selected ports' masks cleared.
    @discardableResult private func releases(_ s: inout Shared, ports: Set<Int32>?, at now: UInt64) -> Int {
        let sel = s.masks.filter { ports?.contains($0.key) ?? true }.sorted { $0.key < $1.key }
        var n = 0
        for (uid, m) in sel { for ch in 0..<16 where m.sus & (1 << ch) != 0 { s.pending.append(Msg(uid: uid, at: now, st: 0xB0 | UInt8(ch), d1: 64, d2: 0)); n += 1 } }        // 1. sustain up
        for (uid, m) in sel { for ch in 0..<16 where m.bend & (1 << ch) != 0 { s.pending.append(Msg(uid: uid, at: now, st: 0xE0 | UInt8(ch), d1: 0, d2: 0x40)); n += 1 } }    // 2. bend centred
        for (uid, m) in sel { let on = m.notes; for ch in 0..<16 where on & (1 << ch) != 0 { s.pending.append(Msg(uid: uid, at: now, st: 0xB0 | UInt8(ch), d1: 123, d2: 0)); n += 1 } }   // 3. All Notes Off
        for (uid, _) in sel { s.masks.removeValue(forKey: uid) }
        return n
    }

    // MARK: receive (CoreMIDI's thread, §2.2) — UMP → bytes (§2.3) outside the lock, then under it the gate at arrival, the masks, the
    // thinner (one lock per event list, not per message); one hop to main while no flush is pending
    func receive(_ list: UnsafePointer<MIDIEventList>, uid: Int32) {
        let now = mach_absolute_time()
        let n = Int(list.pointee.numPackets); guard n > 0 else { return }
        var p = UnsafeRawPointer(list).advanced(by: MemoryLayout<MIDIEventList>.offset(of: \.packet)!).assumingMemoryBound(to: MIDIEventPacket.self)
        var parsed: [Msg] = [], cv2 = 0
        for _ in 0..<n {
            let ts = p.pointee.timeStamp, at = ts == 0 ? now : ts, wc = Int(p.pointee.wordCount)
            let words = UnsafeRawPointer(p).advanced(by: MemoryLayout<MIDIEventPacket>.offset(of: \.words)!).assumingMemoryBound(to: UInt32.self)
            var i = 0
            while i < wc {                                         // a packet may hold several UMPs: advance by the type's size (§2.3)
                let w = words[i], type = Int(w >> 28)
                i += Self.umpWords[type]
                let st = UInt8((w >> 16) & 0xff), d1 = UInt8((w >> 8) & 0x7f), d2 = UInt8(w & 0x7f)
                if type == 0x2 || (type == 0x1 && st >= 0xF1 && st != 0xF7 && st != 0xF8 && st != 0xFE) { parsed.append(Msg(uid: uid, at: at, st: st, d1: d1, d2: d2)) }   // no clock / sensing (§2.3)
                else if type == 0x4 { cv2 += 1 }
            }
            p = UnsafePointer(MIDIEventPacketNext(p))
        }
        guard !parsed.isEmpty || cv2 > 0 else { return }
        let msgs = parsed, unexpected = cv2
        let schedule = lock.withLock { s -> Bool in
            s.unexpected += unexpected
            for m in msgs { accept(&s, m, now) }
            if !s.pending.isEmpty && !s.flushScheduled { s.flushScheduled = true; return true }
            return false
        }
        if schedule { DispatchQueue.main.async { [weak self] in self?.flush(force: false) } }
    }
    private func accept(_ s: inout Shared, _ m: Msg, _ now: UInt64) {
        // §2.2 / fix R2-F4: dropped while shut, or stamped while it was (a resumed receive thread's backlog) — an older or absurd stamp
        // passes (another app's stale stamp: the shim clamps its age at 2 000, §1.3)
        guard s.gateOpen, !(s.closedAt != 0 && m.at >= s.closedAt && m.at < s.openedAt) else { s.dropped += 1; return }
        s.pending.append(m)
        let uid = m.uid, st = m.st, d1 = m.d1, d2 = m.d2, ch = Int(st & 0x0f), bit = UInt16(1 << ch)
        switch st & 0xf0 {                                         // the release masks (§2.3 / §3.4)
        case 0x90 where d2 > 0: s.masks[uid, default: Masks()].note(ch, d1, on: true)
        case 0x80, 0x90: s.masks[uid]?.note(ch, d1, on: false)   // (a velocity-0 note-on is a note-off)
        case 0xB0:
            if d1 == 64 { if d2 >= 64 { s.masks[uid, default: Masks()].sus |= bit } else { s.masks[uid]?.sus &= ~bit } }
            else if d1 == 120 || d1 == 123 { s.masks[uid]?.allOff(ch) }
        case 0xE0: if d1 == 0 && d2 == 0x40 { s.masks[uid]?.bend &= ~bit } else { s.masks[uid, default: Masks()].bend |= bit }
        default: break
        }
        if s.pending.count > Self.pendingCap && s.pending.count >= s.nextThin { thin(&s, now) }
    }
    /// §3.2: controllers (CC 0–119 but 64–69, channel / poly pressure, bend) keep only their latest value, at its latest position;
    /// notes, PC, CC 64–69 and 120–127 never; the never-thinned alone past 4 096 → emptied (counted) and the release path.
    private func thin(_ s: inout Shared, _ now: UInt64) {
        var seen = Set<UInt64>(), kept: [Msg] = []; kept.reserveCapacity(s.pending.count)
        for m in s.pending.reversed() {
            if let k = Self.thinKey(m) { if seen.contains(k) { s.dropped += 1; continue }; seen.insert(k) }
            kept.append(m)
        }
        kept.reverse(); s.pending = kept
        if s.pending.count > Self.neverThinnedCap {
            // fix R2-F2: a pedal-up / bend centre / note-off inside the dropped buffer already cleared its bit, so every (port, channel)
            // in it owes the whole triple (idempotent resets: a redundant one costs nothing, a missing one is a stuck pedal)
            for m in s.pending where m.st < 0xF0 { s.masks[m.uid, default: Masks()].dirty(Int(m.st & 0x0f)) }
            s.dropped += s.pending.count; s.pending.removeAll(); s.overflows += 1; releases(&s, ports: nil, at: now)
        }
        s.nextThin = max(Self.pendingCap, s.pending.count) + 256
    }
    private static func thinKey(_ m: Msg) -> UInt64? {
        let kind: UInt64, data: UInt64
        switch m.st & 0xf0 {
        case 0xB0: guard m.d1 < 120, !(64...69).contains(m.d1) else { return nil }; kind = 0; data = UInt64(m.d1)
        case 0xD0: kind = 1; data = 0
        case 0xA0: kind = 2; data = UInt64(m.d1)
        case 0xE0: kind = 3; data = 0
        default: return nil
        }
        return UInt64(UInt32(bitPattern: m.uid)) << 16 | UInt64(m.st & 0x0f) << 12 | kind << 8 | data
    }

    // MARK: flush (main, §3.2) — one batch per call; ≥ 2 ms between flush starts; one in flight; `force`: now, ahead of the interval
    func flush(force: Bool) {
        let now = mach_absolute_time()
        if !force {
            if inFlight || !queue.isEmpty { lock.withLock { $0.flushScheduled = false }; return }   // the completion flushes
            let since = Self.ms(now &- lastFlushStart)
            if lastFlushStart != 0 && since < Self.flushIntervalMs { armTimer(afterMs: Self.flushIntervalMs - since); return }
        }
        var (batch, dropped) = lock.withLock { s -> ([Msg], Int) in
            let b = s.pending, d = s.dropped
            s.pending.removeAll(keepingCapacity: true); s.dropped = 0; s.nextThin = Self.pendingCap; s.flushScheduled = false
            return (b, d)
        }
        if !future.isEmpty || batch.contains(where: { Self.ms($0.at) > Self.ms(now) + 1 }) {   // §1.3: a virtual source's future stamps
            let h = Self.ms(now)
            var due: [Msg] = [], keep: [Msg] = []
            for m in batch {
                let ahead = Self.ms(m.at) - h
                if ahead > 1 && ahead <= Self.maxAgeMs { future.append(m); Smoke.log(["k": "midiHeld", "aheadMs": ahead, "st": m.st, "d1": m.d1]) } else { keep.append(m) }
            }
            future.sort { $0.at < $1.at }
            while let f = future.first, Self.ms(f.at) <= h + 1 { due.append(f); future.removeFirst() }
            batch = due + keep
            if let f = future.first { armTimer(afterMs: Self.ms(f.at) - h) }
        }
        guard !batch.isEmpty || dropped > 0 else { return }
        lastFlushStart = now
        queue.append(.batch(batch, dropped: dropped))
        pump()
    }
    private func armTimer(afterMs: Double) {
        let deadline = mach_absolute_time() &+ Self.ticks(ms: afterMs)
        if timerDeadline != 0 && timerDeadline <= deadline { lock.withLock { $0.flushScheduled = true }; return }
        if timer == nil {
            let t = DispatchSource.makeTimerSource(queue: .main)
            t.setEventHandler { [weak self] in self?.timerDeadline = 0; self?.flush(force: false) }
            t.resume(); timer = t
        }
        timerDeadline = deadline
        lock.withLock { $0.flushScheduled = true }
        timer?.schedule(deadline: .now() + .microseconds(Int(afterMs * 1000)), leeway: .nanoseconds(0))
    }
    private func pump() {
        guard !inFlight, !queue.isEmpty, let host else { return }
        let item = queue.removeFirst(), gen = pageGen, t0 = mach_absolute_time(), h = Self.ms(t0)
        let body: String, args: [String: Any], kind: String, n: Int, dropped: Int
        switch item {
        case .batch(let msgs, let d):
            var b: [Double] = [h, Double(d)]; b.reserveCapacity(2 + msgs.count * 5)
            for m in msgs { b += [Double(m.uid), min(Self.maxAgeMs, max(0, h - Self.ms(m.at))), Double(m.st), Double(m.d1), Double(m.d2)] }
            body = "if (window.SYNTH_SHELL && SYNTH_SHELL.midiIn) SYNTH_SHELL.midiIn(b)"; args = ["b": b]; kind = "batch"; n = msgs.count; dropped = d; batches += 1
        case .ports(let list, let g):
            body = "if (window.SYNTH_SHELL && SYNTH_SHELL.midiPorts) SYNTH_SHELL.midiPorts(list, gen)"; args = ["list": list, "gen": g]; kind = "ports"; n = list.count
            dropped = lock.withLock { $0.dropped }   // (fix R1-F8: the drops waiting to ride in the next batch — a log-mode reader sees them here)
        }
        inFlight = true; calls += 1
        host.midiCall(body, args) { [weak self] ok, err in
            guard let self, gen == self.pageGen else { return }     // the old page's completion: its flag was cleared by pageReset
            self.inFlight = false
            if Smoke.on {
                var line: [String: Any] = ["k": "midiBatch", "kind": kind, "n": n, "rtt": (Self.ms(mach_absolute_time() &- t0) * 1000).rounded() / 1000, "dropped": dropped, "h": h]
                if let err { line["error"] = err }
                Smoke.log(line)
            }
            self.pump()
            if self.queue.isEmpty { self.flush(force: false) }
        }
    }

    // MARK: send (§2.1) — one MIDI 1.0 message to a destination by uniqueID; delay ms → a host-time stamp
    func send(id: String, bytes: [UInt8], delay: Double) -> String? {
        guard client != 0, let uid = Int32(id) else { return "midi-send: unknown destination" }
        guard let dest = destinations.first(where: { $0.uid == uid }) else { return "midi-send: unknown destination \(id)" }
        guard let st = bytes.first, st >= 0x80, st != 0xF0, st != 0xF7, bytes.count <= 3, bytes.dropFirst().allSatisfy({ $0 < 0x80 }) else { return "midi-send: bad message" }
        let d1 = bytes.count > 1 ? bytes[1] : 0, d2 = bytes.count > 2 ? bytes[2] : 0
        let word = (st >= 0xF0 ? UInt32(0x1) << 28 : UInt32(0x2) << 28) | UInt32(st) << 16 | UInt32(d1) << 8 | UInt32(d2)   // MIDIMessages.h:276–277, :312
        let time: MIDITimeStamp = delay > 0 ? mach_absolute_time() &+ Self.ticks(ms: delay) : 0
        let r = Self.oneList(word, time) { MIDISendEventList(outPort, dest.ref, $0) }
        return r == noErr ? nil : "MIDISendEventList \(r)"
    }
    /// A one-packet MIDI 1.0 list built and used inside one pointer scope (fix R2-N3: the packet pointer Init returns never outlives it).
    static func oneList(_ word: UInt32, _ time: MIDITimeStamp, _ f: (UnsafePointer<MIDIEventList>) -> OSStatus) -> OSStatus {
        var list = MIDIEventList(), w = word
        return withUnsafeMutablePointer(to: &list) { lp in
            let pkt = MIDIEventListInit(lp, ._1_0)
            _ = MIDIEventListAdd(lp, MemoryLayout<MIDIEventList>.size, pkt, time, 1, &w)
            return f(UnsafePointer(lp))
        }
    }
    /// The shared counters (the smoke's `midiGate` lines).
    var counters: [String: Any] { lock.withLock { ["dropped": $0.dropped, "pending": $0.pending.count, "unexpected": $0.unexpected, "overflows": $0.overflows, "gateOpen": $0.gateOpen, "masks": $0.masks.count] } }
}
