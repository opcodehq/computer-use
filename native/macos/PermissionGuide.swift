import AppKit

func opcodeIcon(_ app: URL) -> NSImage {
    NSImage(contentsOf: app.appendingPathComponent("Contents/Resources/Opcode.icns")) ?? NSWorkspace.shared.icon(forFile: app.path)
}

final class AppDragCard: NSView, NSDraggingSource {
    let appURL: URL
    init(appURL: URL) { self.appURL = appURL; super.init(frame: .zero) }
    required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }
    override func hitTest(_ point: NSPoint) -> NSView? { bounds.contains(convert(point, from: superview)) ? self : nil }
    override func mouseDown(with event: NSEvent) {
        let item = NSDraggingItem(pasteboardWriter: appURL as NSURL)
        item.setDraggingFrame(NSRect(x: 12, y: 12, width: 48, height: 48), contents: opcodeIcon(appURL))
        beginDraggingSession(with: [item], event: event, source: self)
    }
    func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation { .copy }
}

final class PermissionGuide: NSObject, NSApplicationDelegate, NSWindowDelegate {
    var window: NSWindow!
    let args = CommandLine.arguments
    var appURL: URL { URL(fileURLWithPath: args.count > 1 ? args[1] : "") }
    var capture: Bool { args.count < 3 || args[2] == "screenRecording" }
    let state = NSTextField(labelWithString: "Waiting for permission")
    let arrow = NSImageView()
    var animation: Timer?
    var tick = false
    func label(_ value: String, size: CGFloat, weight: NSFont.Weight = .regular) -> NSTextField {
        let text = NSTextField(wrappingLabelWithString: value)
        text.font = .systemFont(ofSize: size, weight: weight)
        text.translatesAutoresizingMaskIntoConstraints = false
        return text
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 0,y: 0,width: 420,height: 370), styleMask: [.titled,.closable], backing: .buffered, defer: false)
        window.title = "Opcode"
        window.titlebarAppearsTransparent = true
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.level = .floating
        let glass = NSVisualEffectView()
        glass.material = .popover; glass.state = .active; glass.blendingMode = .behindWindow
        window.contentView = glass
        let title = label(capture ? "Let Opcode see your apps" : "Let Opcode control your apps", size: 23, weight: .semibold)
        let subtitle = label(capture ? "Drag Opcode into Screen & System Audio Recording, then enable its switch." : "Drag Opcode into Accessibility, then enable its switch.", size: 13)
        subtitle.textColor = .secondaryLabelColor
        let computer = NSImageView()
        computer.image = NSImage(systemSymbolName: "desktopcomputer", accessibilityDescription: "Computer use")
        computer.contentTintColor = .labelColor
        arrow.image = NSImage(systemSymbolName: "arrow.up", accessibilityDescription: "Drag the app to Settings")
        arrow.contentTintColor = .controlAccentColor
        let card = AppDragCard(appURL: appURL)
        card.wantsLayer = true; card.layer?.cornerRadius = 14
        card.layer?.backgroundColor = NSColor.controlBackgroundColor.cgColor
        card.setAccessibilityElement(true)
        card.setAccessibilityRole(.button)
        card.setAccessibilityLabel("Opcode app. Drag to System Settings. Use Show in Finder as an alternative.")
        let icon = NSImageView()
        icon.image = opcodeIcon(appURL)
        let name = label("Opcode", size: 17, weight: .semibold)
        let hint = label("Drag to System Settings", size: 11)
        hint.textColor = .secondaryLabelColor
        for view in [icon,name,hint] { view.translatesAutoresizingMaskIntoConstraints = false; card.addSubview(view) }
        let settings = NSButton(title: "Open Settings", target: self, action: #selector(openSettings))
        settings.bezelStyle = .rounded
        let finder = NSButton(title: "Show in Finder", target: self, action: #selector(showFinder))
        finder.bezelStyle = .rounded
        state.font = .systemFont(ofSize: 11)
        state.textColor = .secondaryLabelColor
        let restart = label("Already enabled? If macOS asks, restart Opcode with cu helper-restart.", size: 11)
        restart.textColor = .secondaryLabelColor
        for view in [computer,title,subtitle,arrow,card,settings,finder,state,restart] { view.translatesAutoresizingMaskIntoConstraints = false; glass.addSubview(view) }
        NSLayoutConstraint.activate([
            computer.topAnchor.constraint(equalTo: glass.topAnchor, constant: 16), computer.leadingAnchor.constraint(equalTo: glass.leadingAnchor, constant: 24), computer.widthAnchor.constraint(equalToConstant: 42), computer.heightAnchor.constraint(equalToConstant: 36),
            title.topAnchor.constraint(equalTo: computer.bottomAnchor, constant: 14), title.leadingAnchor.constraint(equalTo: glass.leadingAnchor, constant: 24), title.trailingAnchor.constraint(equalTo: glass.trailingAnchor, constant: -24),
            subtitle.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 8), subtitle.leadingAnchor.constraint(equalTo: title.leadingAnchor), subtitle.trailingAnchor.constraint(equalTo: title.trailingAnchor),
            arrow.topAnchor.constraint(equalTo: subtitle.bottomAnchor, constant: 12), arrow.centerXAnchor.constraint(equalTo: glass.centerXAnchor), arrow.heightAnchor.constraint(equalToConstant: 24), arrow.widthAnchor.constraint(equalToConstant: 24),
            card.topAnchor.constraint(equalTo: arrow.bottomAnchor, constant: 10), card.leadingAnchor.constraint(equalTo: title.leadingAnchor), card.trailingAnchor.constraint(equalTo: title.trailingAnchor), card.heightAnchor.constraint(equalToConstant: 72),
            icon.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 14), icon.centerYAnchor.constraint(equalTo: card.centerYAnchor), icon.widthAnchor.constraint(equalToConstant: 44), icon.heightAnchor.constraint(equalToConstant: 44),
            name.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 12), name.topAnchor.constraint(equalTo: card.topAnchor, constant: 15),
            hint.leadingAnchor.constraint(equalTo: name.leadingAnchor), hint.topAnchor.constraint(equalTo: name.bottomAnchor, constant: 3),
            settings.topAnchor.constraint(equalTo: card.bottomAnchor, constant: 16), settings.leadingAnchor.constraint(equalTo: card.leadingAnchor),
            finder.centerYAnchor.constraint(equalTo: settings.centerYAnchor), finder.trailingAnchor.constraint(equalTo: card.trailingAnchor),
            state.topAnchor.constraint(equalTo: settings.bottomAnchor, constant: 10), state.leadingAnchor.constraint(equalTo: card.leadingAnchor),
            restart.topAnchor.constraint(equalTo: state.bottomAnchor, constant: 8), restart.leadingAnchor.constraint(equalTo: card.leadingAnchor), restart.trailingAnchor.constraint(equalTo: card.trailingAnchor)
        ])
        window.center(); window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        if !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            animation = Timer.scheduledTimer(withTimeInterval: 0.8, repeats: true) { [weak self] _ in
                guard let self = self else { return }
                self.tick.toggle()
                NSAnimationContext.runAnimationGroup { context in context.duration = 0.6; self.arrow.animator().alphaValue = self.tick ? 0.35 : 1 }
            }
        }
        DispatchQueue.global(qos: .utility).async { [weak self] in
            while let line = readLine() {
                guard let data = line.data(using: .utf8), let status = (try? JSONSerialization.jsonObject(with: data)) as? [String: Bool] else { continue }
                DispatchQueue.main.async {
                    guard let self = self else { return }
                    let granted = status[self.capture ? "screenRecording" : "accessibility"] == true
                    self.state.stringValue = granted ? "✓ Permission enabled" : "Waiting for permission"
                    if granted { self.animation?.invalidate(); self.arrow.alphaValue = 1 }
                }
            }
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
    }
    @objc func openSettings() {
        let pane = capture ? "Privacy_ScreenCapture" : "Privacy_Accessibility"
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?" + pane) { NSWorkspace.shared.open(url) }
    }
    @objc func showFinder() { NSWorkspace.shared.activateFileViewerSelecting([appURL]) }
    func windowWillClose(_ notification: Notification) { animation?.invalidate(); NSApp.terminate(nil) }
}
@main struct GuideMain {
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let delegate = PermissionGuide(); app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}
