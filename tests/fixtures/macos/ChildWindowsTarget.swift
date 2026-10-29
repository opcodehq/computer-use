import AppKit
final class ChildWindowsApp: NSApplication {
    var owned: [NSWindow] = []
    var nonWindow: NSButton?
    override func accessibilityAttributeValue(_ attribute: NSAccessibility.Attribute) -> Any? {
        switch attribute.rawValue {
        case "AXWindows": return Array(owned.prefix(1))
        case "AXChildren": return nonWindow.map { [$0] + owned } ?? owned
        case "AXFocusedWindow", "AXMainWindow": return owned.first
        default: return super.accessibilityAttributeValue(attribute)
        }
    }
}
let app = ChildWindowsApp.shared as! ChildWindowsApp
app.setActivationPolicy(.prohibited)
for (i,label) in ["A","B"].enumerated() {
    let window=NSWindow(contentRect:NSRect(x:250+i*40,y:200,width:300,height:160),styleMask:[.titled],backing:.buffered,defer:false)
    window.title="Owned child window "+label
    let button=NSButton(frame:NSRect(x:20,y:40,width:240,height:60));button.title="Child control "+label
    window.contentView?.addSubview(button);window.orderBack(nil);app.owned.append(window)
    if label=="B" {app.nonWindow=button}
}
DispatchQueue.main.asyncAfter(deadline:.now()+0.25) {
    let data=try! JSONSerialization.data(withJSONObject:["pid":getpid(),"windows":app.owned.map{$0.windowNumber}])
    try! data.write(to:URL(fileURLWithPath:CommandLine.arguments[1]))
}
app.run()
