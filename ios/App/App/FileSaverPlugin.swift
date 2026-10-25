import UIKit
import Capacitor

/// Saves text to a file the user places with the system document picker
/// (Files, iCloud Drive, other providers). The text is written to a temporary
/// file first, which the picker copies to the chosen location.
@objc(FileSaverPlugin)
public class FileSaverPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "FileSaverPlugin"
    public let jsName = "FileSaver"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "saveFile", returnType: CAPPluginReturnPromise)
    ]

    /// The call waiting for the picker, and the temporary file it is saving.
    private var pendingCall: CAPPluginCall?
    private var tempURL: URL?

    @objc func saveFile(_ call: CAPPluginCall) {
        guard let filename = call.getString("filename"), let contents = call.getString("contents") else {
            call.reject("filename and contents are required")
            return
        }
        // A plain file name only; the picker chooses the folder.
        let safeName = filename.replacingOccurrences(of: "/", with: "-")
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let url = dir.appendingPathComponent(safeName)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            try contents.write(to: url, atomically: true, encoding: .utf8)
        } catch {
            call.reject(error.localizedDescription)
            return
        }
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                self.cleanUp(url)
                call.reject("View controller unavailable")
                return
            }
            if let previous = self.pendingCall {
                previous.resolve(["saved": false])
            }
            self.pendingCall = call
            self.tempURL = url
            let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
            picker.delegate = self
            presenter.present(picker, animated: true)
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        finish(saved: true)
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        finish(saved: false)
    }

    private func finish(saved: Bool) {
        pendingCall?.resolve(["saved": saved])
        pendingCall = nil
        if let url = tempURL { cleanUp(url) }
        tempURL = nil
    }

    private func cleanUp(_ url: URL) {
        try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
    }
}
