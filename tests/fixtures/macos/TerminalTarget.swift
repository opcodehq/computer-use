import AppKit

final class TerminalController: NSObject, NSTextFieldDelegate {
    let output: String
    let panel = NSView(frame: NSRect(x: 15, y: 15, width: 470, height: 200))
    let input = NSTextField(frame: NSRect(x: 10, y: 90, width: 440, height: 28))
    let result = NSTextField(labelWithString: "")
    var opened = false
    var command = ""
    var stdout = ""
    init(output: String) {
        self.output = output; super.init()
        input.setAccessibilityLabel("Terminal input")
        input.target = self; input.action = #selector(runCommand)
        result.frame = NSRect(x: 10, y: 50, width: 440, height: 28)
        result.setAccessibilityLabel("Terminal output")
        let close = NSButton(title: "Close terminal", target: self, action: #selector(closeTerminal))
        close.frame = NSRect(x: 10, y: 10, width: 160, height: 28)
        panel.addSubview(input); panel.addSubview(result); panel.addSubview(close)
        panel.isHidden = true; save()
    }
    func save() {
        let state: [String: Any] = ["opened": opened, "command": command, "stdout": stdout]
        if let data = try? JSONSerialization.data(withJSONObject: state) { try? data.write(to: URL(fileURLWithPath: output), options: .atomic) }
    }
    @objc func openTerminal() { opened = true; panel.isHidden = false; save() }
    @objc func closeTerminal() { opened = false; panel.isHidden = true; save() }
    @objc func runCommand() {
        command = input.stringValue
        guard command == "echo JEV_TEST_BACKGROUND_917" else { result.stringValue = "Only the test echo command is allowed"; save(); return }
        let process = Process(); process.executableURL = URL(fileURLWithPath: "/bin/sh"); process.arguments = ["-c", command]
        let pipe = Pipe(); process.standardOutput = pipe
        do { try process.run(); process.waitUntilExit(); stdout = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""; result.stringValue = stdout.trimmingCharacters(in: .newlines); input.stringValue = "" } catch { result.stringValue = "Command failed" }
        save()
    }
}
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let controller = TerminalController(output: CommandLine.arguments[1])
let window = NSWindow(contentRect: NSRect(x: 250, y: 200, width: 500, height: 300), styleMask: [.titled], backing: .buffered, defer: false)
window.title = "Jev terminal acceptance fixture"
let open = NSButton(title: "Open terminal", target: controller, action: #selector(TerminalController.openTerminal))
open.frame = NSRect(x: 25, y: 250, width: 180, height: 30)
window.contentView?.addSubview(open); window.contentView?.addSubview(controller.panel)
window.orderBack(nil)
app.run()
