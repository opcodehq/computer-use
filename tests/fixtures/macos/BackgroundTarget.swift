import AppKit

final class Receiver: NSButton {
    var clicks = 0
    let output: String
    init(frame: NSRect, output: String, label: String) { self.output = output; super.init(frame: frame); setAccessibilityElement(true); setAccessibilityRole(.button); setAccessibilityLabel(label); title = label; target = self; action = #selector(pressed) }
    required init?(coder: NSCoder) { fatalError() }
    @objc func pressed() {
        clicks += 1
        try? String(clicks).write(toFile: output, atomically: true, encoding: .utf8)
    }
}
final class FieldRecorder: NSObject, NSTextFieldDelegate {
    let output: String
    init(output: String) { self.output = output }
    @objc func submitted(_ field: NSTextField) { try? field.stringValue.write(toFile: output + "-submitted", atomically: true, encoding: .utf8) }
    func controlTextDidChange(_ notification: Notification) {
        guard let field = notification.object as? NSTextField else { return }
        try? field.stringValue.write(toFile: output + "-text", atomically: true, encoding: .utf8)
    }
}
var recorders: [FieldRecorder] = []
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
var windows: [NSWindow] = []
for (index, label) in ["A", "B"].enumerated() {
    let window = NSWindow(contentRect: NSRect(x: 300 + index * 310, y: 220, width: 280, height: 160), styleMask: [.titled], backing: .buffered, defer: false)
    window.title = "Jev background fixture " + label
    let view = Receiver(frame: NSRect(x: 25, y: 30, width: 220, height: 80), output: CommandLine.arguments[1] + label, label: "Background target " + label)
    window.contentView?.addSubview(view)
    let recorder = FieldRecorder(output: CommandLine.arguments[1] + label)
    let field = NSTextField(frame: NSRect(x: 25, y: 5, width: 220, height: 24))
    field.setAccessibilityLabel("Background field " + label)
    field.delegate = recorder; field.target = recorder; field.action = #selector(FieldRecorder.submitted(_:))
    window.contentView?.addSubview(field)
    recorders.append(recorder)
    window.orderBack(nil)
    windows.append(window)
}
app.run()
