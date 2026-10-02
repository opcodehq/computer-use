import AppKit
import QuartzCore

// Display-only surface. Dragging moves this panel, never the controlled app.
final class PreviewCanvas: NSView {
    let frameLayer = CALayer()
    var hover: ((Bool) -> Void)?
    private var tracking: NSTrackingArea?
    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.cornerRadius = PreviewDelegate.innerRadius
        layer?.cornerCurve = .continuous
        layer?.masksToBounds = true
        layer?.backgroundColor = NSColor.black.cgColor
        frameLayer.contentsGravity = .resizeAspect
        layer?.addSublayer(frameLayer)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }
    override func layout() {
        super.layout()
        CATransaction.begin(); CATransaction.setDisableActions(true)
        frameLayer.frame = bounds
        CATransaction.commit()
    }
    func show(_ image: NSImage) {
        // A short crossfade makes successive observations read as one live view.
        if frameLayer.contents != nil, !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            let fade = CATransition(); fade.type = .fade; fade.duration = 0.18
            frameLayer.add(fade, forKey: "frame")
        }
        frameLayer.contentsScale = window?.backingScaleFactor ?? 2
        frameLayer.contents = image
    }
    func clear() { frameLayer.contents = nil }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking = tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        addTrackingArea(area); tracking = area
    }
    override func mouseEntered(with event: NSEvent) { hover?(true) }
    override func mouseExited(with event: NSEvent) { hover?(false) }
    override var mouseDownCanMoveWindow: Bool { true }
}

final class PreviewDelegate: NSObject, NSApplicationDelegate {
    // Concentric corners: the image sits inside a thin glass rim.
    static let rim: CGFloat = 3
    static let innerRadius: CGFloat = 14
    static let outerRadius: CGFloat = innerRadius + rim
    static let maxWidth: CGFloat = 460

    var panel: NSPanel!
    let canvas = PreviewCanvas()
    let controls = NSView()
    let liveDot = NSView()
    var snapshotID: String?
    var cancelled = false

    func showControls(_ visible: Bool) {
        if visible { controls.isHidden = false }
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : 0.2
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            controls.animator().alphaValue = visible ? 1 : 0
        }, completionHandler: { [weak self] in
            if self?.controls.alphaValue == 0 { self?.controls.isHidden = true }
        })
    }
    @objc func cancelTask() {
        guard !cancelled else { return }
        cancelled = true
        FileHandle.standardOutput.write(Data("{\"stop\":true}\n".utf8))
        panel.orderOut(nil)
    }

    func brandPill() -> NSView {
        let row = NSStackView()
        row.orientation = .horizontal; row.spacing = 7; row.alignment = .centerY
        row.edgeInsets = NSEdgeInsets(top: 0, left: 11, bottom: 0, right: 12)
        liveDot.wantsLayer = true
        liveDot.layer?.cornerRadius = 3.5
        liveDot.layer?.backgroundColor = NSColor.systemGreen.cgColor
        liveDot.widthAnchor.constraint(equalToConstant: 7).isActive = true
        liveDot.heightAnchor.constraint(equalToConstant: 7).isActive = true
        let label = NSTextField(labelWithString: "Opcode")
        label.font = .systemFont(ofSize: 12, weight: .semibold)
        label.textColor = .labelColor
        row.addArrangedSubview(liveDot); row.addArrangedSubview(label)
        row.setAccessibilityElement(true)
        row.setAccessibilityLabel("Opcode is using your computer")
        return glassSurface(row, cornerRadius: 15)
    }

    func cancelButton() -> NSView {
        let button = NSButton()
        let symbol = NSImage.SymbolConfiguration(pointSize: 11, weight: .bold)
        button.image = NSImage(systemSymbolName: "xmark", accessibilityDescription: "Cancel computer use")?.withSymbolConfiguration(symbol)
        button.isBordered = false
        button.contentTintColor = .labelColor
        button.target = self; button.action = #selector(cancelTask)
        button.toolTip = "Cancel computer use"
        button.setAccessibilityLabel("Cancel computer use")
        return glassSurface(button, cornerRadius: 15)
    }

    func pulseLiveDot() {
        guard !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion, let layer = liveDot.layer else { return }
        let pulse = CABasicAnimation(keyPath: "opacity")
        pulse.fromValue = 1; pulse.toValue = 0.35; pulse.duration = 0.9
        pulse.autoreverses = true; pulse.repeatCount = .infinity
        pulse.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        layer.add(pulse, forKey: "live")
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x:0,y:0,width:1280,height:800)
        let initial = NSSize(width: Self.maxWidth, height: 290)
        panel = NSPanel(contentRect:NSRect(x:screen.maxX-initial.width-20,y:screen.minY+20,width:initial.width,height:initial.height), styleMask:[.borderless,.nonactivatingPanel], backing:.buffered, defer:false)
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.isMovableByWindowBackground = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true

        let stage = NSView()
        canvas.translatesAutoresizingMaskIntoConstraints = false
        stage.addSubview(canvas)
        NSLayoutConstraint.activate([
            canvas.topAnchor.constraint(equalTo: stage.topAnchor, constant: Self.rim),
            canvas.bottomAnchor.constraint(equalTo: stage.bottomAnchor, constant: -Self.rim),
            canvas.leadingAnchor.constraint(equalTo: stage.leadingAnchor, constant: Self.rim),
            canvas.trailingAnchor.constraint(equalTo: stage.trailingAnchor, constant: -Self.rim)
        ])
        panel.contentView = glassSurface(stage, cornerRadius: Self.outerRadius)

        // Hover controls float over the image as separate glass capsules.
        let brand = brandPill(), cancel = cancelButton()
        for view in [brand, cancel] { view.translatesAutoresizingMaskIntoConstraints = false; controls.addSubview(view) }
        controls.translatesAutoresizingMaskIntoConstraints = false
        controls.alphaValue = 0
        controls.isHidden = true
        canvas.addSubview(controls)
        NSLayoutConstraint.activate([
            controls.topAnchor.constraint(equalTo: canvas.topAnchor, constant: 9),
            controls.leadingAnchor.constraint(equalTo: canvas.leadingAnchor, constant: 9),
            controls.trailingAnchor.constraint(equalTo: canvas.trailingAnchor, constant: -9),
            controls.heightAnchor.constraint(equalToConstant: 30),
            brand.leadingAnchor.constraint(equalTo: controls.leadingAnchor),
            brand.topAnchor.constraint(equalTo: controls.topAnchor), brand.bottomAnchor.constraint(equalTo: controls.bottomAnchor),
            cancel.trailingAnchor.constraint(equalTo: controls.trailingAnchor),
            cancel.topAnchor.constraint(equalTo: controls.topAnchor), cancel.bottomAnchor.constraint(equalTo: controls.bottomAnchor),
            cancel.widthAnchor.constraint(equalToConstant: 30)
        ])
        canvas.hover = { [weak self] visible in self?.showControls(visible) }
        pulseLiveDot()

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
            canvas.show(image)
            let screen = panel.screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? panel.frame
            let inset = Self.rim * 2
            let width = min(Self.maxWidth, screen.width) - inset
            let height = min(width * image.size.height / image.size.width, screen.height * 0.6)
            let size = NSSize(width: (height * image.size.width / image.size.height).rounded() + inset, height: height.rounded() + inset)
            var frame = panel.frame
            if frame.size != size {
                // Keep the panel anchored to its bottom-right corner as the aspect ratio changes.
                frame.origin.x = frame.maxX - size.width
                frame.size = size
                frame.origin.x = max(screen.minX, min(frame.minX, screen.maxX-size.width))
                frame.origin.y = max(screen.minY, min(frame.minY, screen.maxY-size.height))
                panel.setFrame(frame, display: true)
            }
            if !panel.isVisible {
                panel.alphaValue = 0
                panel.orderFrontRegardless()
                NSAnimationContext.runAnimationGroup { context in
                    context.duration = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : 0.22
                    panel.animator().alphaValue = 1
                }
            }
        } else if let nextID = nextID, nextID != snapshotID {
            // Never leave an old capture looking like the current observation.
            snapshotID = nextID
            canvas.clear()
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
