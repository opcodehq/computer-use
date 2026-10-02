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
                // macOS icon grid: 824/1024 body, continuous corners, top-lit graphite with a glass rim.
                let inset = side * 100 / 1024, body = side - inset * 2
                let rect = NSRect(x: inset, y: inset * 1.15, width: body, height: body)
                let shape = NSBezierPath(roundedRect: rect, xRadius: body * 0.225, yRadius: body * 0.225)
                NSGraphicsContext.saveGraphicsState()
                let shadow = NSShadow()
                shadow.shadowColor = NSColor.black.withAlphaComponent(0.35)
                shadow.shadowOffset = NSSize(width: 0, height: -side * 0.012); shadow.shadowBlurRadius = side * 0.03
                shadow.set()
                NSColor.black.setFill(); shape.fill()
                NSGraphicsContext.restoreGraphicsState()
                NSGradient(colors: [NSColor(calibratedWhite: 0.27, alpha: 1), NSColor(calibratedWhite: 0.06, alpha: 1)])?.draw(in: shape, angle: -90)
                NSGraphicsContext.saveGraphicsState()
                shape.addClip()
                let sheen = NSBezierPath(ovalIn: NSRect(x: rect.minX - body * 0.3, y: rect.midY + body * 0.12, width: body * 1.6, height: body * 0.9))
                NSGradient(colors: [NSColor.white.withAlphaComponent(0.16), NSColor.white.withAlphaComponent(0)])?.draw(in: sheen, angle: -90)
                NSGraphicsContext.restoreGraphicsState()
                NSColor.white.withAlphaComponent(0.18).setStroke()
                let rim = NSBezierPath(roundedRect: rect.insetBy(dx: side * 0.003, dy: side * 0.003), xRadius: body * 0.222, yRadius: body * 0.222)
                rim.lineWidth = max(1, side * 0.006); rim.stroke()
                let text = NSAttributedString(string: "op", attributes: [.font: NSFont.systemFont(ofSize: body * 0.5, weight: .heavy), .foregroundColor: NSColor.white, .kern: -body * 0.02])
                let bounds = text.size()
                text.draw(at: NSPoint(x: rect.midX - bounds.width/2, y: rect.midY - bounds.height/2 + body * 0.035))
                image.unlockFocus()
                guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) else { throw NSError(domain: "OpcodeIcon", code: 1) }
                try png.write(to: directory.appendingPathComponent("icon_\(size)x\(size)\(scale == 2 ? "@2x" : "").png"))
            }
        }
    }
}
