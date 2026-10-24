// tools/midi-sender.swift — the simulator's only "other MIDI app" (IMPL-B §8 / §12, reviewer 1's probe kept as a tool): a process
// spawned INSIDE the simulator (xcrun simctl spawn) that lists the MIDI destinations it sees and sends messages into the app's virtual
// destination "SYNTH" — the user's first-test path (another process → "SYNTH" → the page's input "From other apps"). A spawned process
// cannot CREATE virtual endpoints there (kMIDINotPermitted — the sandbox, lane M's day 1) but it can SEND to one. Build for the simulator
// SDK, then spawn it on the booted "SYNTH iPad Pro 13" (the app running, a plain launch or -smokeMode log):
//   xcrun -sdk iphonesimulator swiftc -target arm64-apple-ios17.5-simulator -O -o "$TMPDIR/midi-sender" tools/midi-sender.swift
//   xcrun simctl spawn 6F9F14F6-CF76-4FDF-95BD-6890E098069B "$TMPDIR/midi-sender" list
//   … send <hex bytes…> [--gap ms] [--wait ms] [--to NAME]   e.g. send 903c64 803c00 --gap 500  (--wait: sleep first — press Home meanwhile)
//   … hold <note> <secs>        note-on, wait, exit WITHOUT a note-off (the "sender quits mid-note" case, §11 — Panic clears it)
//   … chord <secs>              CC 64 127 + three note-ons on ch 1, wait, exit without releases (the pedal case)
//   … stream <cc> <hz> <secs>   a CC stream (the long-session memory test; R1 ran 1 kHz × 300 s)
// Fix R1-F1's proof (the background task's expiration releases a note held across the suspension edge): play one key in SYNTH (the
// engine on), then `send 903e64 803e00 --wait 28000 --gap 5000` and press Home at once — the note-on lands at +28 s, its note-off at
// +33 s falls past the edge; back in SYNTH nothing sounds (before the fix: D4 droned until Panic).
import Foundation
import CoreMIDI

var tb = mach_timebase_info(); mach_timebase_info(&tb)
let nsPerTick = Double(tb.numer) / Double(tb.denom)
func ticks(ms m: Double) -> UInt64 { UInt64(m * 1e6 / nsPerTick) }
func str(_ o: MIDIObjectRef, _ p: CFString) -> String { var s: Unmanaged<CFString>?; return MIDIObjectGetStringProperty(o, p, &s) == noErr ? (s?.takeRetainedValue() as String? ?? "") : "" }
func int(_ o: MIDIObjectRef, _ p: CFString) -> Int32? { var v: Int32 = 0; return MIDIObjectGetIntegerProperty(o, p, &v) == noErr ? v : nil }
func oneList(_ word: UInt32, _ ts: MIDITimeStamp, _ f: (UnsafePointer<MIDIEventList>) -> OSStatus) -> OSStatus {
    var list = MIDIEventList(), w = word
    return withUnsafeMutablePointer(to: &list) { lp in
        let pkt = MIDIEventListInit(lp, ._1_0)
        _ = MIDIEventListAdd(lp, MemoryLayout<MIDIEventList>.size, pkt, ts, 1, &w)
        return f(UnsafePointer(lp))
    }
}
func word(_ b: [UInt8]) -> UInt32 { let st = b[0], d1 = b.count > 1 ? b[1] : 0, d2 = b.count > 2 ? b[2] : 0; return (st >= 0xF0 ? UInt32(0x1) << 28 : UInt32(0x2) << 28) | UInt32(st) << 16 | UInt32(d1) << 8 | UInt32(d2) }
func hex(_ s: String) -> [UInt8] { var out: [UInt8] = []; var i = s.startIndex; while i < s.endIndex { let j = s.index(i, offsetBy: 2, limitedBy: s.endIndex) ?? s.endIndex; out.append(UInt8(s[i..<j], radix: 16) ?? 0); i = j }; return out }
func stamp() -> String { let f = DateFormatter(); f.dateFormat = "HH:mm:ss.SSS"; return f.string(from: Date()) }

var client = MIDIClientRef()
let t0 = mach_absolute_time()
let st = MIDIClientCreateWithBlock("SYNTH sender" as CFString, &client) { _ in }
print(stamp(), "client →", st, String(format: "(%.1f ms)", Double(mach_absolute_time() - t0) * nsPerTick / 1e6))
guard st == noErr else { exit(1) }
var outPort = MIDIPortRef()
print("outPort →", MIDIOutputPortCreate(client, "SYNTH sender out" as CFString, &outPort))
var dests: [(MIDIEndpointRef, String)] = []
for i in 0..<MIDIGetNumberOfDestinations() { let e = MIDIGetDestination(i); dests.append((e, str(e, kMIDIPropertyDisplayName))); print("  dst[\(i)] '\(str(e, kMIDIPropertyDisplayName))' name='\(str(e, kMIDIPropertyName))' uid=\(int(e, kMIDIPropertyUniqueID) ?? 0)") }
print("sources:", MIDIGetNumberOfSources(), "destinations:", MIDIGetNumberOfDestinations())
var args = Array(CommandLine.arguments.dropFirst())
let cmd = args.isEmpty ? "list" : args.removeFirst()
var target = "SYNTH", gap = 0.0, waitMs = 0.0
if let i = args.firstIndex(of: "--to"), i + 1 < args.count { target = args[i + 1]; args.removeSubrange(i...i + 1) }
if let i = args.firstIndex(of: "--gap"), i + 1 < args.count { gap = Double(args[i + 1]) ?? 0; args.removeSubrange(i...i + 1) }
if let i = args.firstIndex(of: "--wait"), i + 1 < args.count { waitMs = Double(args[i + 1]) ?? 0; args.removeSubrange(i...i + 1) }
guard cmd != "list" else { exit(0) }
guard let dest = dests.first(where: { $0.1 == target })?.0 else { print("no destination '\(target)'"); exit(2) }
if waitMs > 0 { print("waiting \(Int(waitMs)) ms"); Thread.sleep(forTimeInterval: waitMs / 1000) }
func send(_ b: [UInt8], ahead: Double = 0) { let t = ahead > 0 ? mach_absolute_time() &+ ticks(ms: ahead) : 0; let r = oneList(word(b), t) { MIDISendEventList(outPort, dest, $0) }; print(String(format: "  %@ sent %@ → %d", stamp(), b.map { String(format: "%02x", $0) }.joined(), r)) }
switch cmd {
case "send": for (i, h) in args.enumerated() { if i > 0, gap > 0 { usleep(useconds_t(gap * 1000)) }; send(hex(h)) }
case "hold": let n = UInt8(args.first ?? "60") ?? 60, s = Double(args.count > 1 ? args[1] : "3") ?? 3; send([0x90, n, 0x64]); print("holding \(s) s, then exiting WITHOUT a note-off"); Thread.sleep(forTimeInterval: s)
case "chord": let s = Double(args.first ?? "3") ?? 3; send([0xB0, 64, 127]); for n: UInt8 in [60, 64, 67] { send([0x90, n, 0x64]) }; print("pedal + chord held \(s) s, exiting without releases"); Thread.sleep(forTimeInterval: s)
case "stream":
    let cc = UInt8(args.count > 0 ? args[0] : "74") ?? 74, hz = Double(args.count > 1 ? args[1] : "100") ?? 100, secs = Double(args.count > 2 ? args[2] : "10") ?? 10, n = Int(hz * secs), step = ticks(ms: 1000 / hz)
    let start = mach_absolute_time(); var sent = 0, errs = 0
    for i in 0..<n { mach_wait_until(start &+ step &* UInt64(i)); let r = oneList(word([0xB0, cc, UInt8(i & 0x7f)]), 0) { MIDISendEventList(outPort, dest, $0) }; if r == noErr { sent += 1 } else { errs += 1 } }
    print("stream: \(sent) sent, \(errs) errors over \(String(format: "%.1f", Double(mach_absolute_time() - start) * nsPerTick / 1e9)) s")
default: print("unknown command"); exit(2)
}
usleep(50_000)
