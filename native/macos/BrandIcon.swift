import AppKit

// Renders the Opcode app icon: the white mark on a flat graphite squircle.
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
                // macOS icon grid: 824/1024 body with continuous-looking corners.
                let inset = side * 100 / 1024, body = side - inset * 2
                let rect = NSRect(x: inset, y: inset, width: body, height: body)
                let shape = NSBezierPath(roundedRect: rect, xRadius: body * 0.225, yRadius: body * 0.225)
                NSColor(srgbRed: 0.067, green: 0.067, blue: 0.067, alpha: 1).setFill()
                shape.fill()
                // Hairline edge keeps the dark icon visible on a dark Dock.
                NSColor.white.withAlphaComponent(0.12).setStroke()
                let edge = NSBezierPath(roundedRect: rect.insetBy(dx: side * 0.002, dy: side * 0.002), xRadius: body * 0.224, yRadius: body * 0.224)
                edge.lineWidth = max(1, side * 0.004); edge.stroke()
                let mark = body * 0.62
                OpcodeMark.draw(in: NSRect(x: rect.midX - mark/2, y: rect.midY - mark/2, width: mark, height: mark), color: .white)
                image.unlockFocus()
                guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) else { throw NSError(domain: "OpcodeIcon", code: 1) }
                try png.write(to: directory.appendingPathComponent("icon_\(size)x\(size)\(scale == 2 ? "@2x" : "").png"))
            }
        }
    }
}
