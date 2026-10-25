import UIKit
import Capacitor
import PhotosUI
import ImageIO
import Vision
import UniformTypeIdentifiers

/// Lets the user choose photos with the system photo picker, and reports each
/// one's capture time, GPS position and QR codes. The picker needs no photo
/// library permission; it hands over only the chosen photos, as their original
/// files with their metadata.
@objc(PhotoImportPlugin)
public class PhotoImportPlugin: CAPPlugin, CAPBridgedPlugin, PHPickerViewControllerDelegate {
    public let identifier = "PhotoImportPlugin"
    public let jsName = "PhotoImport"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickPhotos", returnType: CAPPluginReturnPromise)
    ]

    /// The call waiting for the picker.
    private var pendingCall: CAPPluginCall?

    @objc func pickPhotos(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                call.reject("View controller unavailable")
                return
            }
            if let previous = self.pendingCall {
                previous.resolve(["photos": []])
            }
            self.pendingCall = call
            var config = PHPickerConfiguration()
            config.filter = .images
            config.selectionLimit = 0
            // The original file, rather than a converted copy that may lose metadata.
            config.preferredAssetRepresentationMode = .current
            let picker = PHPickerViewController(configuration: config)
            picker.delegate = self
            presenter.present(picker, animated: true)
        }
    }

    public func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let call = pendingCall else { return }
        pendingCall = nil
        // Cancelling picks none.
        readAll(results.map(\.itemProvider), photos: [], call: call)
    }

    /// Reads the photos one at a time, in the order picked, reporting progress
    /// (loading a photo may mean downloading it from iCloud first).
    private func readAll(_ providers: [NSItemProvider], photos: [[String: Any]], call: CAPPluginCall) {
        if photos.count == providers.count {
            call.resolve(["photos": photos])
            return
        }
        notifyListeners("importProgress", data: ["done": photos.count, "total": providers.count])
        read(providers[photos.count]) { photo in
            self.readAll(providers, photos: photos + [photo], call: call)
        }
    }

    /// The photo's file is only available inside the load's completion
    /// handler, so it is read there.
    private func read(_ provider: NSItemProvider, completion: @escaping ([String: Any]) -> Void) {
        var photo: [String: Any] = ["codes": [String]()]
        if let name = provider.suggestedName { photo["name"] = name }
        provider.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { url, error in
            if let url {
                photo.merge(Self.metadata(url)) { _, new in new }
                photo["codes"] = Self.qrCodes(url)
            } else {
                photo["error"] = error?.localizedDescription ?? "No image data"
            }
            completion(photo)
        }
    }

    /// EXIF capture time and GPS fields, with coordinates signed by hemisphere.
    private static func metadata(_ url: URL) -> [String: Any] {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        else { return [:] }
        var out: [String: Any] = [:]
        if let exif = props[kCGImagePropertyExifDictionary] as? [CFString: Any] {
            out["dateTimeOriginal"] = exif[kCGImagePropertyExifDateTimeOriginal] as? String
            out["offsetTimeOriginal"] = exif[kCGImagePropertyExifOffsetTimeOriginal] as? String
        }
        if let gps = props[kCGImagePropertyGPSDictionary] as? [CFString: Any] {
            if let lat = gps[kCGImagePropertyGPSLatitude] as? Double,
               let lng = gps[kCGImagePropertyGPSLongitude] as? Double {
                out["latitude"] = (gps[kCGImagePropertyGPSLatitudeRef] as? String) == "S" ? -lat : lat
                out["longitude"] = (gps[kCGImagePropertyGPSLongitudeRef] as? String) == "W" ? -lng : lng
            }
            if let alt = gps[kCGImagePropertyGPSAltitude] as? Double {
                // Ref 1 means below sea level.
                out["altitude"] = (gps[kCGImagePropertyGPSAltitudeRef] as? Int) == 1 ? -alt : alt
            }
            out["accuracy"] = gps[kCGImagePropertyGPSHPositioningError] as? Double
            if let date = gps[kCGImagePropertyGPSDateStamp] as? String,
               let time = gps[kCGImagePropertyGPSTimeStamp] as? String,
               let ms = gpsTime(date: date, time: time) {
                out["gpsTimestamp"] = ms
            }
        }
        return out
    }

    /// EXIF GPS date ("yyyy:MM:dd") and time ("HH:mm:ss", maybe with
    /// fractional seconds), which are UTC, as epoch milliseconds.
    private static func gpsTime(date: String, time: String) -> Double? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy:MM:dd HH:mm:ss"
        guard let d = formatter.date(from: "\(date) \(time.prefix(8))") else { return nil }
        return (d.timeIntervalSince1970 * 1000).rounded()
    }

    /// The distinct QR code payloads found anywhere in the image.
    private static func qrCodes(_ url: URL) -> [String] {
        let request = VNDetectBarcodesRequest()
        request.symbologies = [.qr]
        let handler = VNImageRequestHandler(url: url, options: [:])
        do {
            try handler.perform([request])
        } catch {
            return []
        }
        var codes: [String] = []
        for observation in request.results ?? [] {
            if let s = observation.payloadStringValue, !codes.contains(s) { codes.append(s) }
        }
        return codes
    }
}
