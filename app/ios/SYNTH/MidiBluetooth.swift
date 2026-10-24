import UIKit
import CoreAudioKit

// Bluetooth LE MIDI pairing (IMPL-B §4.1, Q3): Apple's CABTMIDICentralViewController (CoreAudioKit, ios 8 — iPadOS has no system-wide
// pairing UI for BLE MIDI) in a navigation controller with Done, presented through the Presenter as a FORM SHEET (fix R1-F4: as a
// popover, the tap outside that dismissed it also reached the page — a Serum matrix cell edited, a key played; a form sheet's dimmed
// surround consumes that tap) — one sheet at a time with the share sheets and JS dialogs. The item SETTLES on every way the sheet can
// close: Done, a user dismissal (presentationControllerDidDismiss — UIKit's call for a swipe down or a tap on the surround, iOS 13),
// the smoke's auto-dismiss, abandonAll (cancel). A sheet closed by the user with only Done wired would leave the Presenter's `current`
// set for good: every later share sheet waits, the next JS confirm() is never presented and WebKit holds the page's thread until the
// app is killed (IMPL-A §6.4). Our code never imports CoreBluetooth (B3): the system's sheet scans and pairs; NSBluetoothAlwaysUsageDescription
// (Info.plist) is what lets it start CoreBluetooth. Once paired the device is a CoreMIDI source → kMIDIMsgObjectAdded → Midi.relist.
final class MidiBluetoothSheet: UINavigationController, UIAdaptivePresentationControllerDelegate {
    private var onClose: (() -> Void)?

    /// `autoDismiss` (the smoke only): close after that many seconds. `shown` / `closed` are the smoke's `btmidi` lines.
    static func present(via presenter: Presenter, autoDismiss: TimeInterval?, shown: @escaping () -> Void, closed: @escaping () -> Void) {
        presenter.enqueue(cancel: closed) { from, settle in
            let bt = CABTMIDICentralViewController()
            let nav = MidiBluetoothSheet(rootViewController: bt)
            bt.navigationItem.title = "Bluetooth MIDI"
            bt.navigationItem.rightBarButtonItem = UIBarButtonItem(systemItem: .done, primaryAction: UIAction { [weak nav] _ in nav?.dismiss(animated: true) { nav?.onClose?() } })
            nav.onClose = { settle(closed) }                       // once: later calls are ignored by the Presenter
            nav.modalPresentationStyle = .formSheet                 // centred, the surround dimmed: a tap there never reaches the page
            nav.preferredContentSize = CGSize(width: 360, height: 480)
            nav.presentationController?.delegate = nav              // a user dismissal → presentationControllerDidDismiss → settle
            from.present(nav, animated: true) { shown() }
            if let autoDismiss {
                DispatchQueue.main.asyncAfter(deadline: .now() + autoDismiss) { [weak nav] in nav?.dismiss(animated: false) { nav?.onClose?() } }
            }
            return nav
        }
    }
    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) { onClose?() }
}
