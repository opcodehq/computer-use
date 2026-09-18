import AppKit

// Disposable four-screen workflow. Result file proves a save and subsequent
// reopen happened; text visible in an unsaved input is never acceptance evidence.
final class WorkflowTarget: NSObject {
    let window: NSWindow
    let output: String
    var name = "", callback = ""
    var field: NSTextField?
    var stage = 0, saves = 0
    init(output: String) {
        self.output = output
        window = NSWindow(contentRect:NSRect(x:350,y:260,width:600,height:340),styleMask:[.titled],backing:.buffered,defer:false)
        super.init()
        window.title = "Jev disposable workflow fixture"
        render(); window.orderBack(nil)
    }
    func label(_ text:String,_ y:CGFloat) {
        let l=NSTextField(labelWithString:text);l.frame=NSRect(x:30,y:y,width:540,height:30);window.contentView!.addSubview(l)
    }
    func input(_ title:String) {
        label(title,235)
        let f=NSTextField(frame:NSRect(x:30,y:190,width:540,height:32));f.setAccessibilityLabel(title);window.contentView!.addSubview(f);field=f
    }
    func button(_ title:String,_ action:Selector) {
        let b=NSButton(title:title,target:self,action:action);b.frame=NSRect(x:30,y:60,width:240,height:40);window.contentView!.addSubview(b)
    }
    func render() {
        window.contentView=NSView(frame:NSRect(x:0,y:0,width:600,height:340));field=nil
        switch stage {
        case 0:label("Create a project",285);input("Project name");button("Next",#selector(next))
        case 1:label("Configure callback",285);input("Callback URL");button("Review",#selector(next))
        case 2:label("Review project",285);label("Project: \(name)",235);label("Callback: \(callback)",190);button("Save project",#selector(save))
        case 3:label("Project saved successfully",285);label("Projects: \(name)",235);button("Open saved project",#selector(reopen))
        default:label("Saved project details",285);label("Project: \(name)",235);label("Callback: \(callback)",190);label("Status: Saved and reopened",145)
        }
    }
    @objc func next() {
        guard let value=field?.stringValue,!value.isEmpty else{return}
        if stage==0{name=value}else{callback=value};stage+=1;render()
    }
    @objc func save(){guard stage==2 else{return};saves+=1;stage=3;write(false);render()}
    @objc func reopen(){guard stage==3 else{return};stage=4;write(true);render()}
    func write(_ reopened:Bool){
        let data=try! JSONSerialization.data(withJSONObject:["name":name,"callback":callback,"saves":saves,"reopened":reopened])
        try! data.write(to:URL(fileURLWithPath:output),options:.atomic)
    }
}
let app=NSApplication.shared
app.setActivationPolicy(.accessory)
let output=CommandLine.arguments[1]
try! String(ProcessInfo.processInfo.processIdentifier).write(toFile:output+".pid",atomically:true,encoding:.utf8)
let target=WorkflowTarget(output:output)
app.run()
