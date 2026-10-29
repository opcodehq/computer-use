import AppKit

final class FixtureApp: NSApplication {
    static var focusedControl: Any?
    var origin: NSWindow?
    var editing = false
    override class func accessibilityFocusedUIElement() -> Any? { focusedControl ?? super.accessibilityFocusedUIElement() }
    override func accessibilityAttributeValue(_ attribute: NSAccessibility.Attribute) -> Any? {
        if attribute.rawValue == "AXFocusedUIElement" { return Self.focusedControl }
        if attribute.rawValue == "AXFocusedWindow" { return editing ? nil : origin }
        if attribute.rawValue == "AXWindows" { return origin.map { [$0] } ?? [] }
        return super.accessibilityAttributeValue(attribute)
    }
    override func accessibilityFocusedWindow() -> Any? { editing ? nil : origin }
    override func accessibilityWindows() -> [Any]? { origin.map { [$0] } ?? [] }
}
final class OrphanField: NSTextField {
    override func isAccessibilityElement() -> Bool { true }
    override func accessibilityRole() -> NSAccessibility.Role? { .textField }
    override func accessibilityLabel() -> String? { "Transient panel editor" }
    override func accessibilityValue() -> String? { stringValue }
    override func setAccessibilityValue(_ value: Any?) { if let text = value as? String { stringValue = text } }
    override func accessibilityParent() -> Any? { NSApplication.shared }
    override func accessibilityWindow() -> Any? { nil }
    override func accessibilityTopLevelUIElement() -> Any? { nil }
    override func isAccessibilityFocused() -> Bool { true }
}
final class OrphanSecureField: NSSecureTextField {
    override func isAccessibilityElement() -> Bool { true }
    override func accessibilityRole() -> NSAccessibility.Role? { .textField }
    override func accessibilitySubrole() -> NSAccessibility.Subrole? { .secureTextField }
    override func accessibilityLabel() -> String? { "Transient panel editor" }
    override func accessibilityParent() -> Any? { NSApplication.shared }
    override func accessibilityWindow() -> Any? { nil }
    override func accessibilityTopLevelUIElement() -> Any? { nil }
    override func isAccessibilityFocused() -> Bool { true }
}
final class OriginView: NSView {
    var open: (() -> Void)?
    override var acceptsFirstResponder: Bool { true }
    override func isAccessibilityElement() -> Bool { true }
    override func accessibilityRole() -> NSAccessibility.Role? { .outline }
    override func accessibilityLabel() -> String? { "Origin outline" }
    override func isAccessibilityFocused() -> Bool { !(NSApplication.shared as! FixtureApp).editing }
    override func keyDown(with event: NSEvent) { if event.keyCode == 36 { open?() } else { super.keyDown(with: event) } }
}
final class EditorPanel: NSPanel {
    override func accessibilityRole() -> NSAccessibility.Role? { nil }
    var submit: (() -> Void)?
    override var canBecomeKey: Bool { true }
    override func sendEvent(_ event: NSEvent) {
        if event.type == .keyDown && event.keyCode == 36 { submit?(); return }
        super.sendEvent(event)
    }
}
final class Recorder: NSObject {
    @objc func submitted(_ field: NSTextField) { try? field.stringValue.write(toFile: CommandLine.arguments[1], atomically: true, encoding: .utf8) }
}
let app = FixtureApp.shared as! FixtureApp
app.setActivationPolicy(.accessory)
let window = NSWindow(contentRect: NSRect(x: 130, y: 180, width: 350, height: 180), styleMask: [.titled], backing: .buffered, defer: false)
window.title = "Transient surface origin"
let origin = OriginView(frame: NSRect(x: 0, y: 0, width: 350, height: 180))
window.contentView = origin
app.origin = window
let panel = EditorPanel(contentRect: NSRect(x: 180, y: 220, width: 250, height: 36), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
let field: NSTextField = CommandLine.arguments.contains("--secure") ? OrphanSecureField(frame: NSRect(x: 4, y: 4, width: 240, height: 24)) : OrphanField(frame: NSRect(x: 4, y: 4, width: 240, height: 24))
field.setAccessibilityLabel("Transient panel editor")
let recorder = Recorder(); field.target = recorder; field.action = #selector(Recorder.submitted(_:))
panel.contentView?.addSubview(field)
panel.submit = { recorder.submitted(field) }
origin.open = {
    app.editing = true
    panel.orderBack(nil); panel.makeKey(); panel.makeFirstResponder(field)
    FixtureApp.focusedControl = field
    try? String(panel.windowNumber).write(toFile: CommandLine.arguments[1] + "-surface", atomically: true, encoding: .utf8)
}
window.orderBack(nil); window.makeFirstResponder(origin)
FixtureApp.focusedControl = origin
let timer = Timer.scheduledTimer(withTimeInterval: 0.025, repeats: true) { _ in
    let command = (try? String(contentsOfFile: CommandLine.arguments[1] + "-control", encoding: .utf8)) ?? ""
    if command == "drift" { FixtureApp.focusedControl = origin; app.editing = false }
    if command == "restore" { FixtureApp.focusedControl = field; app.editing = true }
}
app.run()
