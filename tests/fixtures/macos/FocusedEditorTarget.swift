import AppKit
// The editor is deliberately omitted from AXChildren, as transient inline
// editors are in some applications. AXFocusedUIElement still exposes it.
final class SelectionRow: NSView {
    private var selected = false
    override func isAccessibilityElement() -> Bool { true }
    override func accessibilityRole() -> NSAccessibility.Role? { .row }
    override func accessibilityLabel() -> String? { "Selectable row" }
    override func accessibilityPerformShowMenu() -> Bool {
        try? "shown".write(toFile: CommandLine.arguments[1] + "-menu", atomically: true, encoding: .utf8)
        return true
    }
    override func isAccessibilitySelected() -> Bool { selected }
    override func setAccessibilitySelected(_ value: Bool) {
        selected = value
        try? String(value).write(toFile: CommandLine.arguments[1] + "-selection", atomically: true, encoding: .utf8)
    }
}
final class EditorContainer: NSView {
    var row: SelectionRow?
    override func accessibilityChildren() -> [Any]? { CommandLine.arguments.contains("--visible") ? super.accessibilityChildren() : row.map { [$0] } ?? [] }
}
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let window = NSWindow(contentRect: NSRect(x: 120, y: 160, width: 350, height: 160), styleMask: [.titled], backing: .buffered, defer: false)
window.title = "Focused editor regression"
let container = EditorContainer(frame: NSRect(x: 0, y: 0, width: 350, height: 160))
let field: NSTextField = CommandLine.arguments.contains("--secure") ? NSSecureTextField(frame: NSRect(x: 20, y: 45, width: 280, height: 24)) : NSTextField(frame: NSRect(x: 20, y: 45, width: 280, height: 24))
final class Recorder: NSObject {
    @objc func shortcut(_ sender: Any?) {
        try? "invoked".write(toFile: CommandLine.arguments[1] + "-shortcut", atomically: true, encoding: .utf8)
    }
    @objc func submitted(_ sender: NSTextField) {
        try? sender.stringValue.write(toFile: CommandLine.arguments[1], atomically: true, encoding: .utf8)
    }
}
let recorder = Recorder()
let menu = NSMenu()
let root = NSMenuItem()
let commands = NSMenu()
let command = NSMenuItem(title: "New container", action: #selector(Recorder.shortcut(_:)), keyEquivalent: "n")
command.keyEquivalentModifierMask = [.command, .shift]; command.target = recorder
commands.addItem(command); root.submenu = commands; menu.addItem(root); app.mainMenu = menu
field.target = recorder; field.action = #selector(Recorder.submitted(_:))
field.setAccessibilityLabel("Transient editor")
container.addSubview(field)
let row = SelectionRow(frame: NSRect(x: 20, y: 95, width: 280, height: 24))
container.addSubview(row); container.row = row
window.contentView = container
window.orderBack(nil)
window.makeFirstResponder(field)
app.run()
