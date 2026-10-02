import AppKit

// Temporary Opcode wordmark icon; replace the artwork when the brand asset is supplied.
@main struct BrandIcon {
    static func main() throws {
        let directory = URL(fileURLWithPath: CommandLine.arguments[1])
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        for size in [16,32,128,256,512] {
            for scale in [1,2] {
                let pixels = size * scale
                let image = NSImage(size: NSSize(width: pixels, height: pixels))
                image.lockFocus()
                let side = CGFloat(pixels)
                NSColor(calibratedWhite: 0.08, alpha: 1).setFill()
                NSBezierPath(roundedRect: NSRect(x: side*0.04, y: side*0.04, width: side*0.92, height: side*0.92), xRadius: side*0.22, yRadius: side*0.22).fill()
                let text = NSAttributedString(string: "op", attributes: [.font: NSFont.systemFont(ofSize: side*0.53, weight: .bold), .foregroundColor: NSColor.white])
                let bounds = text.size()
                text.draw(at: NSPoint(x: (side-bounds.width)/2, y: (side-bounds.height)/2 + side*0.04))
                image.unlockFocus()
                guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) else { throw NSError(domain: "OpcodeIcon", code: 1) }
                try png.write(to: directory.appendingPathComponent("icon_\(size)x\(size)\(scale == 2 ? "@2x" : "").png"))
            }
        }
    }
}
