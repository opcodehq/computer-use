import AppKit
final class SlowButton: NSButton {
    override func accessibilityPerformPress() -> Bool {
        Thread.sleep(forTimeInterval: 0.4)
        return true
    }
}
let app = NSApplication.shared
app.setActivationPolicy(.regular)
let window = NSWindow(contentRect: NSRect(x: 100, y: 100, width: 260, height: 120), styleMask: [.titled, .closable], backing: .buffered, defer: false)
window.title = "Jev AX regression"
let button = SlowButton(frame: NSRect(x: 40, y: 35, width: 180, height: 40))
button.title = "Slow press"
window.contentView?.addSubview(button)
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
app.run()
