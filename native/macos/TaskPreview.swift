import AppKit

// Display-only surface. Dragging moves this panel, never the controlled app.
final class PreviewCanvas: NSView {
    var image: NSImage?
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
