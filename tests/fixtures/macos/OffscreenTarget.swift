import AppKit
import Darwin
final class RecordingApp: NSApplication {
    override func sendEvent(_ event: NSEvent) {
        if [.leftMouseDown,.leftMouseUp,.rightMouseDown,.rightMouseUp,.leftMouseDragged,.mouseMoved,.keyDown,.keyUp,.flagsChanged].contains(event.type) {
            let record: [String: Any] = ["type":event.type.rawValue,"windowId":event.windowNumber,"x":event.locationInWindow.x,"y":event.locationInWindow.y,"field51":event.cgEvent?.getIntegerValueField(CGEventField(rawValue:51)!) ?? -1]
            if let data = try? JSONSerialization.data(withJSONObject:record), let line=String(data:data,encoding:.utf8) {
                let path=CommandLine.arguments[1]+"-events.jsonl", old=(try? String(contentsOfFile:path,encoding:.utf8)) ?? ""
                try? (old+line+"\n").write(toFile:path,atomically:true,encoding:.utf8)
            }
        }
        super.sendEvent(event)
    }
}
final class OffscreenWindow: NSWindow {
    override func sendEvent(_ event: NSEvent) {
        if [.leftMouseDown,.leftMouseUp,.rightMouseDown,.rightMouseUp,.leftMouseDragged,.mouseMoved].contains(event.type) {
            let path=CommandLine.arguments[1]+"-window-events.jsonl", old=(try? String(contentsOfFile:path,encoding:.utf8)) ?? ""
            try? (old+String(event.type.rawValue)+"\n").write(toFile:path,atomically:true,encoding:.utf8)
        }
        super.sendEvent(event)
    }
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}
final class Receiver: NSButton {
    let output: String
    var clicks = 0
    init(frame: NSRect, output: String) {
        self.output = output; super.init(frame: frame)
        setAccessibilityElement(true); setAccessibilityLabel("Offscreen receiver")
        title = "Offscreen receiver"; target = self; action = #selector(pressed)
    }
    required init?(coder: NSCoder) { fatalError() }
    @objc func pressed() {
        clicks += 1; title = "Offscreen receiver \(clicks)"
        try? String(clicks).write(toFile: output, atomically: true, encoding: .utf8)
    }
}
let app = RecordingApp.shared
app.setActivationPolicy(.prohibited)
let window = OffscreenWindow(contentRect: NSRect(x: 350, y: 250, width: 320, height: 200), styleMask: [.titled], backing: .buffered, defer: false)
window.title = "Owned offscreen regression"
let receiver = Receiver(frame: NSRect(x: 20, y: 30, width: 260, height: 100), output: CommandLine.arguments[1])
window.contentView?.addSubview(receiver)
window.orderFrontRegardless()
if CommandLine.arguments.contains("--inactive-space") {
 DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
    typealias Main = @convention(c) () -> Int32
    typealias Active = @convention(c) (Int32) -> UInt64
    typealias Copy = @convention(c) (Int32) -> Unmanaged<CFArray>?
    typealias Move = @convention(c) (Int32, CFArray, UInt64) -> Void
    let sky = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_LAZY)!
    let main = unsafeBitCast(dlsym(sky,"SLSMainConnectionID")!,to:Main.self)
    let active = unsafeBitCast(dlsym(sky,"SLSGetActiveSpace")!,to:Active.self)
    let copy = unsafeBitCast(dlsym(sky,"SLSCopyManagedDisplaySpaces")!,to:Copy.self)
    let move = unsafeBitCast(dlsym(sky,"SLSMoveWindowsToManagedSpace")!,to:Move.self)
    let connection = main(), before = active(main())
    let displays = copy(connection)?.takeRetainedValue() as? [[String: Any]] ?? []
    let spaces = displays.flatMap { $0["Spaces"] as? [[String: Any]] ?? [] }
    let normal = spaces.first(where: { ($0["type"] as? NSNumber)?.intValue == 0 && ($0["ManagedSpaceID"] as? NSNumber)?.uint64Value != before })
    guard let destination = normal ?? spaces.first(where: { ($0["ManagedSpaceID"] as? NSNumber)?.uint64Value != before }),
          let id = (destination["ManagedSpaceID"] as? NSNumber)?.uint64Value else { fatalError("An existing inactive Space is required for this regression.") }
    let info = (CGWindowListCopyWindowInfo(.optionIncludingWindow, CGWindowID(window.windowNumber)) as? [[String: Any]])?.first
    precondition(info?[kCGWindowOwnerPID as String] as? Int == Int(getpid()))
    move(connection,[NSNumber(value:window.windowNumber)] as CFArray,id)
    precondition(active(connection) == before,"Fixture setup changed the active Space")
    let metadata: [String: Any] = ["spaceBefore":before,"spaceAfter":active(connection),"destinationSpace":id,"destinationType":destination["type"] ?? -1,"windowId":window.windowNumber,"pid":getpid(),"mode":"existing inactive Space; own window only"]
    if let data = try? JSONSerialization.data(withJSONObject:metadata) { try? data.write(to:URL(fileURLWithPath:CommandLine.arguments[1]+"-setup.json")) }
    _ = Timer.scheduledTimer(withTimeInterval:0.05,repeats:true) { _ in
        let state: [String: Any] = ["activeSpace":active(connection), "windowId":window.windowNumber]
        if let data=try? JSONSerialization.data(withJSONObject:state) { try? data.write(to:URL(fileURLWithPath:CommandLine.arguments[1]+"-state.json")) }
    }
 }
} else { window.setFrameOrigin(NSPoint(x: 50000, y: 50000)) }
app.run()
