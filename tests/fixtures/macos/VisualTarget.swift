import AppKit

// An intentionally non-accessible canvas. The test must find the drawn button
// through local perception; there is no AXPress or AXValue for its label.
final class VisualTarget: NSView {
    let output: String
    var clicks = 0
    let button = NSRect(x: 95, y: 70, width: 330, height: 64)
    init(output: String) {
        self.output = output
        super.init(frame: NSRect(x: 0, y: 0, width: 520, height: 260))
        setAccessibilityElement(false)
    }
    required init?(coder: NSCoder) { fatalError() }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func draw(_ dirtyRect: NSRect) {
        NSColor.white.setFill(); bounds.fill()
        ("Disposable vision test" as NSString).draw(at: NSPoint(x: 95, y: 200), withAttributes: [.font: NSFont.systemFont(ofSize: 24, weight: .medium), .foregroundColor: NSColor.black])
        ("Clicks: \(clicks)" as NSString).draw(at: NSPoint(x: 95, y: 160), withAttributes: [.font: NSFont.systemFont(ofSize: 20), .foregroundColor: NSColor.black])
        NSColor.systemBlue.setFill(); NSBezierPath(roundedRect: button, xRadius: 8, yRadius: 8).fill()
        let text = clicks == 0 ? "Complete vision test" : "VISION TEST PASSED"
        (text as NSString).draw(at: NSPoint(x: 117, y: 91), withAttributes: [.font: NSFont.systemFont(ofSize: 23, weight: .semibold), .foregroundColor: NSColor.white])
    }
    override func mouseDown(with event: NSEvent) {
        guard button.contains(convert(event.locationInWindow, from: nil)) else { return }
        clicks += 1
        try? String(clicks).write(toFile: output, atomically: true, encoding: .utf8)
        needsDisplay = true
    }
}
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
try? String(ProcessInfo.processInfo.processIdentifier).write(toFile: CommandLine.arguments[1] + ".pid", atomically: true, encoding: .utf8)
let window = NSWindow(contentRect: NSRect(x: 350, y: 250, width: 520, height: 260), styleMask: [.titled], backing: .buffered, defer: false)
window.title = "Jev disposable vision fixture"
window.contentView = VisualTarget(output: CommandLine.arguments[1])
window.orderBack(nil)
app.run()
