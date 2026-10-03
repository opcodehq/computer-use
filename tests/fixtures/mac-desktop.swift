import AppKit
import Foundation

// Disposable CI-only target. No user files, network access, or installed helper.
@MainActor final class Fixture: NSObject, NSApplicationDelegate {
    let output: String
    let title: String
    var window: NSWindow!
    var field: NSTextField!
    var save: NSButton!
    init(output: String, title: String) { self.output = output; self.title = title }
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 100, y: 100, width: 480, height: 240), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = title
        window.isReleasedWhenClosed = false
        field = NSTextField(frame: NSRect(x: 40, y: 150, width: 390, height: 28))
        field.placeholderString = "CI text fixture"
        save = NSButton(frame: NSRect(x: 40, y: 80, width: 140, height: 32))
        save.title = "Save fixture"
        save.bezelStyle = .rounded
        save.target = self; save.action = #selector(saveFixture)
        window.contentView!.addSubview(field)
        window.contentView!.addSubview(save)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        window.makeFirstResponder(field)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.ready() }
    }
    func center(_ view: NSView) -> [String: Double] {
        let rect = window.convertToScreen(view.convert(view.bounds, to: nil))
        let primaryTop = NSScreen.screens[0].frame.maxY
        return ["x": rect.midX, "y": primaryTop - rect.midY]
    }
    func ready() {
        let manifest: [String: Any] = ["title": title, "pid": Int(ProcessInfo.processInfo.processIdentifier), "field": center(field), "save": center(save)]
        do {
            let data = try JSONSerialization.data(withJSONObject: manifest)
            try data.write(to: URL(fileURLWithPath: output + ".ready"), options: .atomic)
        } catch { fputs("Could not write fixture readiness.\n", stderr); exit(1) }
    }
    @objc func saveFixture() {
        do {
            let data = try JSONSerialization.data(withJSONObject: ["text": field.stringValue, "saved": true])
            try data.write(to: URL(fileURLWithPath: output), options: .atomic)
        } catch { fputs("Could not write fixture outcome.\n", stderr); exit(1) }
    }
}

@main struct Main {
    @MainActor static func main() {
        guard ProcessInfo.processInfo.environment["CI"] == "true", ProcessInfo.processInfo.environment["GITHUB_ACTIONS"] == "true", CommandLine.arguments.count == 3 else {
            fputs("Fixture only runs on disposable GitHub CI.\n", stderr); exit(1)
        }
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        let fixture = Fixture(output: CommandLine.arguments[1], title: CommandLine.arguments[2])
        app.delegate = fixture
        withExtendedLifetime(fixture) { app.run() }
    }
}
