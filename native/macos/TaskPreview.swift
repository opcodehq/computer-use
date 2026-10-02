import AppKit

// Display-only surface. Dragging moves this panel, never the controlled app.
final class PreviewCanvas: NSView {
    var image: NSImage?
    var hover: ((Bool) -> Void)?
    private var tracking: NSTrackingArea?
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking = tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        addTrackingArea(area); tracking = area
    }
    override func mouseEntered(with event: NSEvent) { hover?(true) }
    override func mouseExited(with event: NSEvent) { hover?(false) }

    override var isFlipped: Bool { true }
    override var mouseDownCanMoveWindow: Bool { true }
    override func draw(_ dirtyRect: NSRect) {
        NSColor.black.setFill()
        bounds.fill()
        guard let image = image, image.size.width > 0, image.size.height > 0 else { return }
        let scale = min(bounds.width / image.size.width, bounds.height / image.size.height)
        let size = NSSize(width: image.size.width * scale, height: image.size.height * scale)
        let display = NSRect(x: (bounds.width-size.width)/2, y: (bounds.height-size.height)/2, width: size.width, height: size.height)
        image.draw(in: display, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
    }
}

final class PreviewDelegate: NSObject, NSApplicationDelegate {
    var panel: NSPanel!
    let canvas = PreviewCanvas()
    var snapshotID: String?
    let toolbar = NSVisualEffectView()
    let cancel = NSButton()
    var cancelled = false
    func showToolbar(_ visible: Bool) {
        if visible { toolbar.isHidden = false }
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : 0.16
            toolbar.animator().alphaValue = visible ? 1 : 0
        }, completionHandler: { [weak self] in
            if self?.toolbar.alphaValue == 0 { self?.toolbar.isHidden = true }
        })
    }
    @objc func cancelTask() {
        guard !cancelled else { return }
        cancelled = true
        FileHandle.standardOutput.write(Data("{\"stop\":true}\n".utf8))
        panel.orderOut(nil)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x:0,y:0,width:1280,height:800)
        panel = NSPanel(contentRect:NSRect(x:screen.maxX-474,y:screen.minY+24,width:450,height:280), styleMask:[.borderless,.nonactivatingPanel], backing:.buffered, defer:false)
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.isMovableByWindowBackground = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        canvas.wantsLayer = true
        canvas.layer?.cornerRadius = 12
        canvas.layer?.masksToBounds = true
        panel.contentView = canvas
        toolbar.material = .hudWindow
        toolbar.blendingMode = .withinWindow
        toolbar.state = .active
        toolbar.wantsLayer = true
        toolbar.layer?.cornerRadius = 10
        toolbar.layer?.masksToBounds = true
        toolbar.alphaValue = 0
        toolbar.isHidden = true
        toolbar.translatesAutoresizingMaskIntoConstraints = false
        canvas.addSubview(toolbar)
        let brand = NSImageView()
        let app = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Opcode/CU Driver.app")
        let localIcon = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent().appendingPathComponent("Opcode.icns")
        brand.image = NSImage(contentsOf: localIcon) ?? NSImage(contentsOf: app.appendingPathComponent("Contents/Resources/Opcode.icns")) ?? NSWorkspace.shared.icon(forFile: app.path)
        brand.translatesAutoresizingMaskIntoConstraints = false
        toolbar.addSubview(brand)
        let label = NSTextField(labelWithString: "Opcode")
        label.font = .systemFont(ofSize: 12, weight: .semibold)
        label.textColor = .labelColor
        label.translatesAutoresizingMaskIntoConstraints = false
        toolbar.addSubview(label)
        cancel.image = NSImage(systemSymbolName: "xmark", accessibilityDescription: "Cancel computer use")
        cancel.isBordered = false
        cancel.target = self; cancel.action = #selector(cancelTask)
        cancel.toolTip = "Cancel computer use"
        cancel.setAccessibilityLabel("Cancel computer use")
        cancel.translatesAutoresizingMaskIntoConstraints = false
        toolbar.addSubview(cancel)
        NSLayoutConstraint.activate([
            toolbar.topAnchor.constraint(equalTo: canvas.topAnchor, constant: 8),
            toolbar.leadingAnchor.constraint(equalTo: canvas.leadingAnchor, constant: 8),
            toolbar.trailingAnchor.constraint(equalTo: canvas.trailingAnchor, constant: -8),
            toolbar.heightAnchor.constraint(equalToConstant: 36),
            brand.leadingAnchor.constraint(equalTo: toolbar.leadingAnchor, constant: 10),
            brand.centerYAnchor.constraint(equalTo: toolbar.centerYAnchor),
            brand.widthAnchor.constraint(equalToConstant: 20), brand.heightAnchor.constraint(equalToConstant: 20),
            label.leadingAnchor.constraint(equalTo: brand.trailingAnchor, constant: 8),
            label.centerYAnchor.constraint(equalTo: toolbar.centerYAnchor),
            cancel.trailingAnchor.constraint(equalTo: toolbar.trailingAnchor, constant: -6),
            cancel.centerYAnchor.constraint(equalTo: toolbar.centerYAnchor),
            cancel.widthAnchor.constraint(equalToConstant: 28), cancel.heightAnchor.constraint(equalToConstant: 28)
        ])
        canvas.hover = { [weak self] visible in self?.showToolbar(visible) }

        // No placeholder or Accessibility wireframe: only show actual captured pixels.
        DispatchQueue.global(qos:.utility).async { [weak self] in
            while let line = readLine() {
                guard line.utf8.count < 12_000_000, let data=line.data(using:.utf8), let packet=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any] else { continue }
                DispatchQueue.main.async { self?.receive(packet) }
            }
            DispatchQueue.main.asyncAfter(deadline:.now()+1.2) { NSApp.terminate(nil) }
        }
    }
    func receive(_ packet: [String:Any]) {
        if packet["state"] as? String == "resumed" { cancelled = false }
        guard !cancelled else { return }
        let nextID = packet["snapshotId"] as? String
        if let raw = packet["image"] as? String, let data = Data(base64Encoded: raw), let image = NSImage(data: data), image.size.width > 0, image.size.height > 0 {
            snapshotID = nextID
            canvas.image = image
            let screen = panel.screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? panel.frame
            let width = min(450, screen.width)
            let height = min(width * image.size.height / image.size.width, screen.height * 0.6)
            let size = NSSize(width: height * image.size.width / image.size.height, height: height)
            var frame = panel.frame
            frame.size = size
            frame.origin.x = max(screen.minX, min(frame.minX, screen.maxX-size.width))
            frame.origin.y = max(screen.minY, min(frame.minY, screen.maxY-size.height))
            panel.setFrame(frame, display: true)
            canvas.needsDisplay = true
            panel.orderFrontRegardless()
        } else if let nextID = nextID, nextID != snapshotID {
            // Never leave an old capture looking like the current observation.
            snapshotID = nextID
            canvas.image = nil
            panel.orderOut(nil)
        }
    }
}
@main struct PreviewMain {
    static func main() {
        let app=NSApplication.shared; app.setActivationPolicy(.accessory)
        let delegate=PreviewDelegate(); app.delegate=delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}
