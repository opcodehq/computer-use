import AppKit
struct DriverFailure: Error { let code: String; let message: String }
@main struct PointerScopeTest {
    static func main() throws {
        let input = BackgroundInput()
        let pid = pid_t(CommandLine.arguments[1])!, id = CGWindowID(CommandLine.arguments[2])!
        guard let info = input.windowInfo(id), info[kCGWindowOwnerPID as String] as? Int == Int(pid),
              input.isOnScreen(id) == false,
              let b = info[kCGWindowBounds as String] as? [String: Any],
              let x = (b["X"] as? NSNumber)?.doubleValue, let y = (b["Y"] as? NSNumber)?.doubleValue,
              let w = (b["Width"] as? NSNumber)?.doubleValue, let h = (b["Height"] as? NSNumber)?.doubleValue else { fatalError("Regression requires its owned inactive-Space window") }
        let frame = CGRect(x:x,y:y,width:w,height:h), point = CGPoint(x:frame.midX,y:frame.midY)
        let cases: [(String,pid_t,CGWindowID,CGRect)] = [
            ("wrong PID",pid+1,id,frame),
            ("wrong window",pid,CGWindowID.max,frame),
            ("stale overlapping geometry",pid,id,frame.offsetBy(dx:1,dy:0))
        ]
        for (name,owner,window,bounds) in cases {
            do { try input.click(pid:owner,windowID:window,frame:bounds,point:point); fatalError("Dispatched \(name)") }
            catch let failure as DriverFailure { precondition(failure.code == "StaleTarget" || failure.code == "BackgroundUnavailable", "Unexpected refusal: \(failure.code)") }
        }
        precondition(BackgroundInput.matchingPointerFrames(frame,frame))
        precondition(BackgroundInput.matchingPointerFrames(frame,frame.offsetBy(dx:0.5,dy:0)))
        precondition(!BackgroundInput.matchingPointerFrames(frame,frame.offsetBy(dx:0.51,dy:0)))
        precondition(!BackgroundInput.matchingPointerFrames(frame,CGRect(x:x,y:y,width:w+1,height:h)))
        precondition(!BackgroundInput.matchingPointerFrames(frame,CGRect(x:Double.nan,y:y,width:w,height:h)))
        precondition(!BackgroundInput.matchingPointerFrames(frame,.zero))
        print("PASS: wrong PID/window and overlapping stale geometry refused before posting; finite geometry and rounding bounds validated")
    }
}
