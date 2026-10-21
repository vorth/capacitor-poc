import UIKit
import Capacitor

/// Root view controller; registers the app's own (non-npm) plugins.
class AppViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PrinterPlugin())
    }
}

/// Prints the app's own web view through the system print dialog. WKWebView
/// ignores `window.print()`; the print formatter lays the page out with
/// `@media print` styles, so the page decides what appears on paper.
@objc(PrinterPlugin)
public class PrinterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PrinterPlugin"
    public let jsName = "Printer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "printWebView", returnType: CAPPluginReturnPromise)
    ]

    @objc func printWebView(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let webView = self.bridge?.webView else {
                call.reject("Web view unavailable")
                return
            }
            let info = UIPrintInfo(dictionary: nil)
            info.jobName = call.getString("jobName") ?? "Labels"
            info.outputType = .general
            let controller = UIPrintInteractionController.shared
            controller.printInfo = info
            controller.printFormatter = webView.viewPrintFormatter()
            controller.present(animated: true) { _, completed, error in
                if let error {
                    call.reject(error.localizedDescription)
                } else {
                    call.resolve(["completed": completed])
                }
            }
        }
    }
}
