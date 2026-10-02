import AppKit

// Opcode mark: a screen with the agent as a dot. Geometry matches docs/brand/opcode-mark.svg (100-unit box, y down).
enum OpcodeMark {
    static let frame = NSRect(x: 15, y: 20, width: 70, height: 60)
    static let radius: CGFloat = 14, stroke: CGFloat = 10
    static let dot = NSPoint(x: 62, y: 57), dotRadius: CGFloat = 9

    /// Paths for the mark drawn into `box` (AppKit coordinates, y up).
    static func paths(in box: NSRect) -> (frame: CGPath, dot: CGPath, lineWidth: CGFloat) {
        let unit = min(box.width, box.height) / 100
        let origin = NSPoint(x: box.midX - 50 * unit, y: box.midY - 50 * unit)
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: origin.x + x * unit, y: origin.y + (100 - y) * unit) }
        let corner = point(frame.minX, frame.maxY)
        let rect = CGRect(x: corner.x, y: corner.y, width: frame.width * unit, height: frame.height * unit)
        let center = point(dot.x, dot.y), r = dotRadius * unit
        return (CGPath(roundedRect: rect, cornerWidth: radius * unit, cornerHeight: radius * unit, transform: nil),
                CGPath(ellipseIn: CGRect(x: center.x - r, y: center.y - r, width: r * 2, height: r * 2), transform: nil),
                stroke * unit)
    }

    static func draw(in box: NSRect, color: NSColor) {
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        let mark = paths(in: box)
        context.setStrokeColor(color.cgColor); context.setFillColor(color.cgColor)
        context.setLineWidth(mark.lineWidth)
        context.addPath(mark.frame); context.strokePath()
        context.addPath(mark.dot); context.fillPath()
    }
}

/// Live mark for the preview: the agent dot pulses while Opcode is acting.
final class OpcodeMarkView: NSView {
    private let frameLayer = CAShapeLayer(), dotLayer = CAShapeLayer()
    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        frameLayer.fillColor = nil
        layer?.addSublayer(frameLayer); layer?.addSublayer(dotLayer)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }
    override var wantsUpdateLayer: Bool { true }
    override func updateLayer() {
        effectiveAppearance.performAsCurrentDrawingAppearance {
            frameLayer.strokeColor = NSColor.labelColor.cgColor
            dotLayer.fillColor = NSColor.labelColor.cgColor
        }
    }
    override func layout() {
        super.layout()
        let mark = OpcodeMark.paths(in: bounds)
        frameLayer.frame = bounds; dotLayer.frame = bounds
        frameLayer.path = mark.frame; frameLayer.lineWidth = mark.lineWidth
        dotLayer.path = mark.dot
    }
    func pulse() {
        guard !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else { return }
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 1; fade.toValue = 0.25; fade.duration = 0.9
        fade.autoreverses = true; fade.repeatCount = .infinity
        fade.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        dotLayer.add(fade, forKey: "live")
    }
}
