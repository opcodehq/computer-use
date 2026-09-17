import AppKit
import Vision
import CoreML
import CryptoKit

struct VisualRegion {
    let label: String
    let confidence: Float
    let source: String
    let bounds: CGRect // image pixels, origin at top left
    func json(ref: String) -> [String: Any] {
        ["ref": ref, "label": label, "confidence": Double(confidence), "source": source,
         "bounds": ["x": bounds.minX, "y": bounds.minY, "width": bounds.width, "height": bounds.height]]
    }
}

/// Local-only perception. A detection is evidence of a region, not proof it is clickable.
final class VisualDetector {
    private var cachedPath = ""
    private var cachedModel: VNCoreMLModel?
    private var compiledURL: URL?
    deinit { if let compiledURL { try? FileManager.default.removeItem(at: compiledURL) } }
    static var defaultModelPath: String {
        ProcessInfo.processInfo.environment["JEV_YOLO_MODEL_PATH"] ??
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/jev-desktop/models/ui-detector.mlpackage").path
    }
    func analyze(_ image: CGImage, modelPath: String?, threshold: Float = 0.35) throws -> (regions: [VisualRegion], model: String, warning: String?) {
        guard image.width > 0, image.height > 0, image.width * image.height <= 24_000_000 else {
            throw DriverFailure(code: "InvalidImage", message: "Image must contain at most 24 million pixels.")
        }
        let path = modelPath ?? Self.defaultModelPath
        var warning: String?
        var detector: VNCoreMLRequest?
        if FileManager.default.fileExists(atPath: path) {
            do {
                if cachedPath != path || cachedModel == nil {
                    let url = URL(fileURLWithPath: path)
                    let compiled = url.pathExtension == "mlmodelc" ? url : try MLModel.compileModel(at: url)
                    if let previous = compiledURL { try? FileManager.default.removeItem(at: previous) }
                    compiledURL = compiled != url ? compiled : nil
                    let config = MLModelConfiguration(); config.computeUnits = .all
                    cachedModel = try VNCoreMLModel(for: MLModel(contentsOf: compiled, configuration: config))
                    cachedPath = path
                }
                if let model = cachedModel { detector = VNCoreMLRequest(model: model); detector?.imageCropAndScaleOption = .scaleFill }
            } catch { warning = "YOLO model could not load: \(error.localizedDescription). OCR remains available." }
        } else { warning = "YOLO model not installed. Running local OCR only." }
        let ocr = VNRecognizeTextRequest()
        ocr.recognitionLevel = .accurate
        ocr.usesLanguageCorrection = false
        if #available(macOS 13.0, *) { ocr.automaticallyDetectsLanguage = true }
        try VNImageRequestHandler(cgImage: image, options: [:]).perform([ocr])
        if let detector {
            do { try VNImageRequestHandler(cgImage: image, options: [:]).perform([detector]) }
            catch { warning = "YOLO inference failed: \(error.localizedDescription). OCR remains available." }
        }
        func pixels(_ box: CGRect) -> CGRect {
            CGRect(x: box.minX * Double(image.width), y: (1 - box.maxY) * Double(image.height),
                   width: box.width * Double(image.width), height: box.height * Double(image.height))
                .intersection(CGRect(x: 0, y: 0, width: image.width, height: image.height))
        }
        let text: [VisualRegion] = (ocr.results ?? []).compactMap { observation in
            guard let candidate = observation.topCandidates(1).first, candidate.confidence >= threshold else { return nil }
            let bounds = pixels(observation.boundingBox)
            guard !bounds.isNull, bounds.width >= 1, bounds.height >= 1 else { return nil }
            return VisualRegion(label: String(candidate.string.prefix(1000)), confidence: candidate.confidence, source: "ocr", bounds: bounds)
        }
        var regions: [VisualRegion] = []
        if let observations = detector?.results as? [VNRecognizedObjectObservation] {
            for observation in observations where observation.confidence >= threshold {
                let bounds = pixels(observation.boundingBox)
                guard !bounds.isNull, bounds.width >= 2, bounds.height >= 2 else { continue }
                let labels = text.filter { bounds.contains(CGPoint(x: $0.bounds.midX, y: $0.bounds.midY)) }
                    .sorted { abs($0.bounds.minY - $1.bounds.minY) > 6 ? $0.bounds.minY < $1.bounds.minY : $0.bounds.minX < $1.bounds.minX }
                let label = labels.isEmpty ? (observation.labels.first?.identifier ?? "unlabeled UI region") : labels.map(\.label).joined(separator: " · ")
                regions.append(VisualRegion(label: String(label.prefix(1000)), confidence: observation.confidence, source: "yolo", bounds: bounds))
            }
        } else if detector != nil && warning == nil {
            warning = "Model did not return object detections. Export a detection model with embedded NMS (nms=True)."
        }
        // Keep text outside detector boxes as independent evidence.
        regions += text.filter { line in !regions.contains { $0.bounds.contains(CGPoint(x: line.bounds.midX, y: line.bounds.midY)) } }
        regions.sort { $0.confidence > $1.confidence }
        return (Array(regions.prefix(500)), detector != nil && warning == nil ? URL(fileURLWithPath: path).lastPathComponent : "ocr-only", warning)
    }
    static func patchDigest(_ image: CGImage, bounds: CGRect) -> String? {
        guard let crop = image.cropping(to: bounds.integral),
              let data = NSBitmapImageRep(cgImage: crop).representation(using: .png, properties: [:]) else { return nil }
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
    static func overlay(_ image: CGImage, regions: [VisualRegion]) -> String? {
        let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: image.width, pixelsHigh: image.height,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
        guard let rep, let graphics = NSGraphicsContext(bitmapImageRep: rep) else { return nil }
        NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = graphics
        let ctx = graphics.cgContext
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        ctx.setLineWidth(2)
        for (index, region) in regions.enumerated() {
            let box = CGRect(x: region.bounds.minX, y: Double(image.height) - region.bounds.maxY, width: region.bounds.width, height: region.bounds.height)
            let color = region.source == "yolo" ? NSColor.systemGreen : NSColor.systemCyan
            ctx.setStrokeColor(color.cgColor); ctx.stroke(box)
            ("\(index) \(region.label.prefix(45))" as NSString).draw(at: CGPoint(x: box.minX, y: box.maxY), withAttributes: [.font: NSFont.monospacedSystemFont(ofSize: 11, weight: .medium), .foregroundColor: color, .backgroundColor: NSColor.black.withAlphaComponent(0.8)])
        }
        NSGraphicsContext.restoreGraphicsState()
        return rep.representation(using: .png, properties: [:])?.base64EncodedString()
    }
}
