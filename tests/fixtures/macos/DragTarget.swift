import AppKit
import Darwin
let output = CommandLine.arguments[1]
func record(_ name:String,_ details:[String:Any]=[:]) {
 let data = try! JSONSerialization.data(withJSONObject: ["event":name,"time":Date().timeIntervalSince1970].merging(details){_,new in new})
 let path=output+"-drag.jsonl", old=(try? String(contentsOfFile:path,encoding:.utf8)) ?? ""
 try? (old+String(data:data,encoding:.utf8)!+"\n").write(toFile:path,atomically:true,encoding:.utf8)
}
final class DragApp:NSApplication {
 override func sendEvent(_ e:NSEvent){
  if [.leftMouseDown,.leftMouseDragged,.leftMouseUp,.mouseMoved].contains(e.type) {record("appEvent",["type":e.type.rawValue,"window":e.windowNumber,"x":e.locationInWindow.x,"y":e.locationInWindow.y,"number":e.eventNumber,"pressure":e.pressure,"flags":e.modifierFlags.rawValue,"pressedButtons":NSEvent.pressedMouseButtons])}
  super.sendEvent(e)
 }
}
final class DragView:NSView,NSDraggingSource {
 let source:Bool
 var started=false
 init(frame:NSRect,source:Bool){self.source=source;super.init(frame:frame);setAccessibilityElement(true);setAccessibilityRole(.button);setAccessibilityLabel(source ? "Drag source":"Drop destination");if !source {registerForDraggedTypes([.string])}}
 required init?(coder:NSCoder){fatalError()}
 override func acceptsFirstMouse(for event:NSEvent?)->Bool {true}
 override func draw(_ rect:NSRect){(source ? NSColor.systemBlue : NSColor.systemGreen).setFill();bounds.fill()}
 override func mouseDown(with event:NSEvent){record("mouseDown",["source":source])}
 override func mouseDragged(with event:NSEvent){
  guard source && !started else{return};started=true;record("beginDraggingSession")
  let item=NSDraggingItem(pasteboardWriter:"owned-drag-payload" as NSString)
  let image=NSImage(size:NSSize(width:20,height:20));image.lockFocus();NSColor.systemBlue.setFill();NSRect(x:0,y:0,width:20,height:20).fill();image.unlockFocus()
  item.setDraggingFrame(NSRect(x:bounds.midX,y:bounds.midY,width:20,height:20),contents:image)
  beginDraggingSession(with:[item],event:event,source:self)
 }
 func draggingSession(_ session:NSDraggingSession,sourceOperationMaskFor context:NSDraggingContext)->NSDragOperation{.copy}
 func draggingSession(_ session:NSDraggingSession,willBeginAt point:NSPoint){record("sessionWillBegin",["x":point.x,"y":point.y])}
 func draggingSession(_ session:NSDraggingSession,endedAt point:NSPoint,operation:NSDragOperation){record("sessionEnded",["operation":operation.rawValue,"x":point.x,"y":point.y])}
 override func draggingEntered(_ sender:NSDraggingInfo)->NSDragOperation{record("destinationEntered");return .copy}
 override func draggingUpdated(_ sender:NSDraggingInfo)->NSDragOperation{record("destinationUpdated");return .copy}
 override func prepareForDragOperation(_ sender:NSDraggingInfo)->Bool{record("prepareDrop");return true}
 override func performDragOperation(_ sender:NSDraggingInfo)->Bool{let payload=sender.draggingPasteboard.string(forType:.string) ?? "";record("performDrop",["payload":payload]);try? payload.write(toFile:output,atomically:true,encoding:.utf8);return payload=="owned-drag-payload"}
}
let app=DragApp.shared;app.setActivationPolicy(.prohibited)
let window=NSWindow(contentRect:NSRect(x:350,y:250,width:500,height:260),styleMask:[.titled],backing:.buffered,defer:false);window.title="Owned drag regression"
window.contentView?.addSubview(DragView(frame:NSRect(x:20,y:70,width:130,height:100),source:true));window.contentView?.addSubview(DragView(frame:NSRect(x:320,y:70,width:130,height:100),source:false));window.orderFrontRegardless()
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
}
app.run()
