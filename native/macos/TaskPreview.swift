import AppKit

// This window visualizes CLI events; it never dispatches input to another app.
final class PreviewCanvas: NSView {
    var packet: [String: Any] = [:]
    var image: NSImage?
    var snapshotID: String?
    var capturedAt: String?
    var targetTime = Date.distantPast
    override var isFlipped: Bool { true }
    func rect(_ value: Any?) -> NSRect? {
        guard let b = value as? [String: Any], let x = b["x"] as? Double,
              let y = b["y"] as? Double, let w = b["width"] as? Double,
              let h = b["height"] as? Double, [x,y,w,h].allSatisfy({ $0.isFinite }), w > 0, h > 0 else { return nil }
        return NSRect(x: x, y: y, width: w, height: h)
    }
    func update(_ next: [String: Any]) {
        if let id = next["snapshotId"] as? String, id != snapshotID { image = nil; capturedAt = nil; snapshotID = id }
        for (key,value) in next { packet[key] = value }
        if let raw = next["image"] as? String, let data = Data(base64Encoded: raw) { image = NSImage(data: data); capturedAt = DateFormatter.localizedString(from:Date(),dateStyle:.none,timeStyle:.medium) }
        if next["target"] is [String: Any] { targetTime = Date() }
        if next["terminal"] as? Bool == true { packet.removeValue(forKey: "target") }
        needsDisplay = true
    }
    override func draw(_ dirtyRect: NSRect) {
        NSColor(calibratedWhite: 0.10, alpha: 1).setFill(); bounds.fill()
        guard let frame = rect(packet["frame"]) ?? image.map({ NSRect(origin: .zero, size: $0.size) }) else {
            drawLabel("Waiting for app observation", at: NSPoint(x: 20, y: 25), color: .lightGray); return
        }
        let scale = min((bounds.width-24)/frame.width, (bounds.height-24)/frame.height)
        let origin = NSPoint(x: (bounds.width-frame.width*scale)/2, y: (bounds.height-frame.height*scale)/2)
        func mapped(_ r: NSRect) -> NSRect { NSRect(x: origin.x+(r.minX-frame.minX)*scale, y: origin.y+(r.minY-frame.minY)*scale, width: r.width*scale, height: r.height*scale) }
        let display = mapped(frame)
        if let image = image { image.draw(in: display, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil) }
        else {
            for node in (packet["nodes"] as? [[String: Any]] ?? []) {
                guard let r = rect(node["frame"]), r.intersects(frame) else { continue }
                let b = mapped(r).intersection(display)
                NSColor(calibratedWhite: 0.55, alpha: 0.45).setStroke()
                NSBezierPath(rect: b).stroke()
                if b.width > 36 && b.height > 12, let label = node["label"] as? String, !label.isEmpty {
                    let text = NSAttributedString(string: label, attributes: [.font: NSFont.systemFont(ofSize: 9), .foregroundColor: NSColor.lightGray])
                    text.draw(with: b.insetBy(dx: 3, dy: 2), options: [.truncatesLastVisibleLine])
                }
            }
        }
        if Date().timeIntervalSince(targetTime) < 2, let target = rect(packet["target"]) {
            let p = mapped(target).center
            if display.contains(p) {
                let age = Date().timeIntervalSince(targetTime)
                let radius = 10 + 8 * min(age, 1)
                NSColor.systemBlue.withAlphaComponent(CGFloat(max(0.15, 1-age/2))).setStroke()
                let ring = NSBezierPath(ovalIn: NSRect(x: p.x-radius, y: p.y-radius, width: radius*2, height: radius*2)); ring.lineWidth = 2; ring.stroke()
                let cursor = NSBezierPath(); cursor.move(to: p); cursor.line(to: NSPoint(x:p.x+4,y:p.y+18)); cursor.line(to:NSPoint(x:p.x+8,y:p.y+11)); cursor.line(to:NSPoint(x:p.x+16,y:p.y+8)); cursor.close()
                NSColor.systemBlue.setFill(); cursor.fill(); NSColor.white.setStroke(); cursor.lineWidth = 1; cursor.stroke()
            }
        }
    }
    func drawLabel(_ value: String, at: NSPoint, color: NSColor) { (value as NSString).draw(at: at, withAttributes: [.font:NSFont.systemFont(ofSize:12), .foregroundColor:color]) }
}
extension NSRect { var center: NSPoint { NSPoint(x: midX, y: midY) } }

final class PreviewDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    var panel: NSPanel!
    let canvas = PreviewCanvas()
    let title = NSTextField(labelWithString: "CU · Computer")
    let message = NSTextField(wrappingLabelWithString: "Connecting to task…")
    let source = NSTextField(labelWithString: "Accessibility layout · no screenshot")
    let stop = NSButton(title: "Stop", target: nil, action: nil)
    var timer: Timer?
    func applicationDidFinishLaunching(_ notification: Notification) {
        let frame = NSScreen.main?.visibleFrame ?? NSRect(x:0,y:0,width:1280,height:800)
        panel = NSPanel(contentRect:NSRect(x:frame.maxX-500,y:frame.minY+24,width:450,height:330), styleMask:[.titled,.closable,.resizable,.nonactivatingPanel], backing:.buffered, defer:false)
        panel.title = "CU · Computer"; panel.level = .floating; panel.hidesOnDeactivate = false; panel.becomesKeyOnlyIfNeeded = true
        panel.standardWindowButton(.closeButton)?.setAccessibilityLabel("Hide preview")
        panel.minSize = NSSize(width:360,height:280); panel.delegate = self
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        guard let content = panel.contentView else { return }
        content.wantsLayer = true; content.layer?.backgroundColor = NSColor(calibratedWhite:0.09,alpha:1).cgColor
        title.textColor = .white; message.textColor = .lightGray
        title.font = .systemFont(ofSize:12,weight:.medium); message.font = .systemFont(ofSize:12)
        source.font = .monospacedSystemFont(ofSize:10,weight:.regular); source.textColor = .secondaryLabelColor
        stop.target = self; stop.action = #selector(stopTask)
        for view in [title,message,source,canvas,stop] { view.translatesAutoresizingMaskIntoConstraints = false; content.addSubview(view) }
        NSLayoutConstraint.activate([
            title.leadingAnchor.constraint(equalTo:content.leadingAnchor,constant:14),title.topAnchor.constraint(equalTo:content.topAnchor,constant:12), title.trailingAnchor.constraint(lessThanOrEqualTo:stop.leadingAnchor,constant:-8),
            stop.trailingAnchor.constraint(equalTo:content.trailingAnchor,constant:-12),stop.centerYAnchor.constraint(equalTo:title.centerYAnchor),
            canvas.topAnchor.constraint(equalTo:title.bottomAnchor,constant:12),canvas.leadingAnchor.constraint(equalTo:content.leadingAnchor,constant:10),canvas.trailingAnchor.constraint(equalTo:content.trailingAnchor,constant:-10),canvas.bottomAnchor.constraint(equalTo:source.topAnchor,constant:-10),
            source.leadingAnchor.constraint(equalTo:canvas.leadingAnchor),source.trailingAnchor.constraint(equalTo:canvas.trailingAnchor),source.bottomAnchor.constraint(equalTo:message.topAnchor,constant:-6),
            message.leadingAnchor.constraint(equalTo:canvas.leadingAnchor),message.trailingAnchor.constraint(equalTo:canvas.trailingAnchor),message.bottomAnchor.constraint(equalTo:content.bottomAnchor,constant:-12),message.heightAnchor.constraint(equalToConstant:36)
        ])
        panel.orderFrontRegardless() // nonactivating panel: no app activation or hardware cursor changes
        timer = Timer.scheduledTimer(withTimeInterval:0.05,repeats:true) { [weak self] _ in self?.canvas.needsDisplay = true }
        DispatchQueue.global(qos:.utility).async { [weak self] in
            while let line = readLine() {
                guard line.utf8.count < 12_000_000, let data=line.data(using:.utf8), let packet=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any] else { continue }
                DispatchQueue.main.async { self?.receive(packet) }
            }
            DispatchQueue.main.asyncAfter(deadline:.now()+1.2) { NSApp.terminate(nil) }
        }
    }
    func receive(_ packet: [String:Any]) {
        canvas.update(packet)
        if let name=packet["title"] as? String { title.stringValue = "CU · " + name }
        let state = packet["state"] as? String ?? "running"
        message.stringValue = state.capitalized + " · " + (packet["message"] as? String ?? "")
        stop.isEnabled = packet["terminal"] as? Bool != true
        source.stringValue = canvas.image == nil ? "Accessibility layout · no screenshot" : "Captured frame · " + (canvas.capturedAt ?? "unknown time")
    }
    @objc func stopTask() {
        stop.isEnabled=false; message.stringValue="Stopping…"
        FileHandle.standardOutput.write(Data("{\"stop\":true}\n".utf8))
    }
    func windowWillClose(_ notification: Notification) { timer?.invalidate(); NSApp.terminate(nil) }
}
@main struct PreviewMain {
    static func main() {
        let app=NSApplication.shared; app.setActivationPolicy(.accessory)
        let delegate=PreviewDelegate(); app.delegate=delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}
