import AppKit

func opcodeIcon(_ app: URL) -> NSImage {
    NSImage(contentsOf: app.appendingPathComponent("Contents/Resources/Opcode.icns")) ?? NSWorkspace.shared.icon(forFile: app.path)
}

final class AppDragCard: NSView, NSDraggingSource {
    let appURL: URL
    init(appURL: URL) { self.appURL = appURL; super.init(frame: .zero) }
    required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }
    override func hitTest(_ point: NSPoint) -> NSView? { bounds.contains(convert(point, from: superview)) ? self : nil }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override var mouseDownCanMoveWindow: Bool { false }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .openHand) }
    override func mouseDown(with event: NSEvent) {
        let item = NSDraggingItem(pasteboardWriter: appURL as NSURL)
        item.setDraggingFrame(NSRect(x: 10, y: (bounds.height-32)/2, width: 32, height: 32), contents: opcodeIcon(appURL))
        beginDraggingSession(with: [item], event: event, source: self)
    }
    func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation { .copy }
}

/// The System Settings window the guide attaches to, read from window bounds only (no capture permission needed).
struct SettingsWindow {
    let number: Int
    let frame: NSRect
    static func find() -> SettingsWindow? {
        guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]],
              let primary = NSScreen.screens.first?.frame else { return nil }
        let settings = Set(NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.systempreferences").map(\.processIdentifier))
        var best: SettingsWindow?
        for info in list {
            guard let pid = info[kCGWindowOwnerPID as String] as? pid_t, settings.contains(pid),
                  info[kCGWindowLayer as String] as? Int == 0,
                  let number = info[kCGWindowNumber as String] as? Int,
                  let bounds = info[kCGWindowBounds as String] as? NSDictionary,
                  let rect = CGRect(dictionaryRepresentation: bounds), rect.width > 300, rect.height > 200 else { continue }
            // Window bounds use a top-left origin on the primary display; AppKit uses bottom-left.
            let frame = NSRect(x: rect.minX, y: primary.maxY - rect.maxY, width: rect.width, height: rect.height)
            if best == nil || frame.width * frame.height > best!.frame.width * best!.frame.height { best = SettingsWindow(number: number, frame: frame) }
        }
        return best
    }
}

final class PermissionGuide: NSObject, NSApplicationDelegate {
    static let height: CGFloat = 112
    var panel: NSPanel!
    let args = CommandLine.arguments
    var appURL: URL { URL(fileURLWithPath: args.count > 1 ? args[1] : "") }
    var capture: Bool { args.count < 3 || args[2] == "screenRecording" }
    var permissionName: String { capture ? "Screen Recording" : "Accessibility" }
    var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
    let arrow = NSImageView()
    let instruction = NSTextField(labelWithString: "")
    var follow: Timer?
    var attachedOnce = false
    var launched = Date()
    var granted = false

    func symbol(_ name: String, size: CGFloat, weight: NSFont.Weight = .regular) -> NSImage? {
        NSImage(systemSymbolName: name, accessibilityDescription: nil)?.withSymbolConfiguration(.init(pointSize: size, weight: weight))
    }
    func instructionText(done: Bool) -> NSAttributedString {
        let regular: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 13), .foregroundColor: NSColor.secondaryLabelColor]
        let strong: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 13, weight: .semibold), .foregroundColor: NSColor.labelColor]
        let text = NSMutableAttributedString()
        if done {
            text.append(NSAttributedString(string: "Opcode", attributes: strong))
            text.append(NSAttributedString(string: capture ? " can now see your screen" : " can now use your Mac", attributes: regular))
        } else {
            text.append(NSAttributedString(string: "Drag ", attributes: regular))
            text.append(NSAttributedString(string: "Opcode", attributes: strong))
            text.append(NSAttributedString(string: " to the list above to allow ", attributes: regular))
            text.append(NSAttributedString(string: permissionName, attributes: strong))
        }
        return text
    }

    func content() -> NSView {
        let root = NSView()
        let back = NSButton()
        back.image = symbol("chevron.left", size: 13, weight: .semibold)
        back.isBordered = false
        back.contentTintColor = .secondaryLabelColor
        back.target = self; back.action = #selector(openSettings)
        back.toolTip = "Show \(permissionName) settings"
        back.setAccessibilityLabel("Show \(permissionName) settings")
        let backGlass = glassSurface(back, cornerRadius: 17)

        arrow.image = symbol("arrow.up", size: 22, weight: .heavy)
        arrow.contentTintColor = .controlAccentColor
        instruction.attributedStringValue = instructionText(done: false)
        instruction.lineBreakMode = .byTruncatingTail

        let card = AppDragCard(appURL: appURL)
        card.setAccessibilityElement(true)
        card.setAccessibilityRole(.button)
        card.setAccessibilityLabel("Opcode app. Drag to the \(permissionName) list in System Settings.")
        let icon = NSImageView(); icon.image = opcodeIcon(appURL)
        let name = NSTextField(labelWithString: "Opcode")
        name.font = .systemFont(ofSize: 13, weight: .medium)
        for view in [icon, name] { view.translatesAutoresizingMaskIntoConstraints = false; card.addSubview(view) }
        card.wantsLayer = true
        card.layer?.cornerRadius = 10; card.layer?.cornerCurve = .continuous
        card.layer?.backgroundColor = NSColor.controlBackgroundColor.withAlphaComponent(0.7).cgColor
        card.layer?.borderWidth = 0.5
        card.layer?.borderColor = NSColor.separatorColor.cgColor

        for view in [backGlass, arrow, instruction, card] { view.translatesAutoresizingMaskIntoConstraints = false; root.addSubview(view) }
        NSLayoutConstraint.activate([
            backGlass.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 18),
            backGlass.centerYAnchor.constraint(equalTo: card.centerYAnchor),
            backGlass.widthAnchor.constraint(equalToConstant: 34), backGlass.heightAnchor.constraint(equalToConstant: 34),
            card.leadingAnchor.constraint(equalTo: backGlass.trailingAnchor, constant: 14),
            card.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -14),
            card.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -14),
            card.heightAnchor.constraint(equalToConstant: 44),
            icon.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 10), icon.centerYAnchor.constraint(equalTo: card.centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: 30), icon.heightAnchor.constraint(equalToConstant: 30),
            name.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 10), name.centerYAnchor.constraint(equalTo: card.centerYAnchor),
            arrow.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 8),
            arrow.bottomAnchor.constraint(equalTo: card.topAnchor, constant: -8),
            arrow.widthAnchor.constraint(equalToConstant: 28), arrow.heightAnchor.constraint(equalToConstant: 30),
            instruction.leadingAnchor.constraint(equalTo: arrow.trailingAnchor, constant: 8),
            instruction.trailingAnchor.constraint(lessThanOrEqualTo: card.trailingAnchor),
            instruction.centerYAnchor.constraint(equalTo: arrow.centerYAnchor)
        ])
        return root
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 640, height: Self.height), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.collectionBehavior = [.fullScreenAuxiliary, .moveToActiveSpace]
        panel.contentView = glassSurface(content(), cornerRadius: 22)
        startArrow()
        openSettings()
        follow = Timer.scheduledTimer(withTimeInterval: 0.15, repeats: true) { [weak self] _ in self?.attach() }

        DispatchQueue.global(qos: .utility).async { [weak self] in
            while let line = readLine() {
                guard let data = line.data(using: .utf8), let status = (try? JSONSerialization.jsonObject(with: data)) as? [String: Bool] else { continue }
                DispatchQueue.main.async {
                    guard let self = self else { return }
                    self.update(granted: status[self.capture ? "screenRecording" : "accessibility"] == true)
                }
            }
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
    }

    // Pin the strip inside the bottom of the Settings window, on whichever display that window is.
    func attach() {
        guard let settings = SettingsWindow.find() else {
            panel.orderOut(nil)
            // Hidden on another Space or minimized: wait. Quit once Settings itself quits.
            let running = !NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.systempreferences").isEmpty
            if !running && (attachedOnce || Date().timeIntervalSince(launched) > 20) { NSApp.terminate(nil) }
            return
        }
        attachedOnce = true
        let inset: CGFloat = settings.frame.width >= 680 ? 200 : 12
        let target = NSRect(x: settings.frame.minX + inset, y: settings.frame.minY + 12, width: settings.frame.width - inset - 12, height: Self.height)
        if panel.frame != target { panel.setFrame(target, display: true) }
        let settingsActive = NSWorkspace.shared.frontmostApplication?.bundleIdentifier == "com.apple.systempreferences"
        panel.level = settingsActive ? .floating : .normal
        if settingsActive { panel.orderFrontRegardless() } else { panel.order(.above, relativeTo: settings.number) }
    }

    func startArrow() {
        guard !reduceMotion else { return }
        arrow.wantsLayer = true
        let nudge = CAKeyframeAnimation(keyPath: "transform.translation.y")
        nudge.values = [0, 6, 0, 0]; nudge.keyTimes = [0, 0.2, 0.45, 1]
        nudge.duration = 1.4; nudge.repeatCount = .infinity
        nudge.timingFunctions = [CAMediaTimingFunction(name: .easeOut), CAMediaTimingFunction(name: .easeIn), CAMediaTimingFunction(name: .linear)]
        arrow.layer?.add(nudge, forKey: "nudge")
    }

    func update(granted next: Bool) {
        guard next != granted else { return }
        granted = next
        instruction.attributedStringValue = instructionText(done: next)
        arrow.layer?.removeAllAnimations()
        let image = symbol(next ? "checkmark.circle.fill" : "arrow.up", size: 22, weight: .heavy)!
        arrow.contentTintColor = next ? .systemGreen : .controlAccentColor
        if #available(macOS 14.0, *), !reduceMotion { arrow.setSymbolImage(image, contentTransition: .replace) } else { arrow.image = image }
        if next {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in if self?.granted == true { NSApp.terminate(nil) } }
        } else { startArrow() }
    }

    @objc func openSettings() {
        let pane = capture ? "Privacy_ScreenCapture" : "Privacy_Accessibility"
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?" + pane) { NSWorkspace.shared.open(url) }
    }
}
@main struct GuideMain {
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let delegate = PermissionGuide(); app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}
