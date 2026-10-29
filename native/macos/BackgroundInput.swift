import AppKit
import ApplicationServices
import Darwin

/// Narrow background transport. Never posts globally, activates an app, or warps
/// the hardware pointer. Private symbols are optional; absence means refusal.
final class BackgroundInput {
    typealias WindowIDFunction = @convention(c) (AXUIElement, UnsafeMutablePointer<CGWindowID>) -> AXError
    typealias PostFunction = @convention(c) (pid_t, CGEvent) -> Void
    typealias LocalPointFunction = @convention(c) (CGEvent, Double, Double) -> Void
    typealias FieldFunction = @convention(c) (CGEvent, UInt32, Int64) -> Void
    private let sky = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_LAZY)
    private let ax = dlopen("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices", RTLD_LAZY)
    private func symbol<T>(_ handle: UnsafeMutableRawPointer?, _ name: String, _: T.Type) -> T? {
        guard let handle, let address = dlsym(handle, name) else { return nil }
        return unsafeBitCast(address, to: T.self)
    }
    func windowID(_ window: AXUIElement) -> CGWindowID? {
        guard let function = symbol(ax, "_AXUIElementGetWindow", WindowIDFunction.self) else { return nil }
        var id: CGWindowID = 0
        return function(window, &id) == .success && id != 0 ? id : nil
    }
    /// WebKit descendants expose AXWindow even when the private lookup fails.
    /// Require identity with the observed window; never infer ownership by geometry.
    func belongs(_ element: AXUIElement, to window: AXUIElement) -> Bool {
        if CFEqual(element, window) { return true }
        var raw: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, "AXWindow" as CFString, &raw) == .success,
           let raw, CFGetTypeID(raw) == AXUIElementGetTypeID() {
            return CFEqual(raw, window)
        }
        guard let expected = windowID(window), let actual = windowID(element) else { return false }
        return actual == expected
    }
    func windowInfo(_ id: CGWindowID) -> [String: Any]? {
        (CGWindowListCopyWindowInfo(.optionIncludingWindow, id) as? [[String: Any]])?.first
    }
    // kCGWindowIsOnscreen is optional metadata. Its absence is not false.
    // Query membership in the on-screen list instead, preserving query failure.
    func isOnScreen(_ id: CGWindowID) -> Bool? {
        guard let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] else { return nil }
        return windows.contains { ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value == id }
    }
    /// Verify the actual WindowServer target even when it belongs to an inactive
    /// Space. Offscreen delivery stays window-local; visibility is not ownership.
    private func pointerFrame(pid: pid_t, windowID: CGWindowID, observed: CGRect) throws -> CGRect {
        guard let window = windowInfo(windowID),
              window[kCGWindowOwnerPID as String] as? Int == Int(pid),
              window[kCGWindowLayer as String] as? Int == 0,
              let bounds = window[kCGWindowBounds as String] as? [String: Any],
              let x = (bounds["X"] as? NSNumber)?.doubleValue,
              let y = (bounds["Y"] as? NSNumber)?.doubleValue,
              let width = (bounds["Width"] as? NSNumber)?.doubleValue,
              let height = (bounds["Height"] as? NSNumber)?.doubleValue,
              [x,y,width,height].allSatisfy({ $0.isFinite }), width > 0, height > 0 else {
            throw DriverFailure(code: "StaleTarget", message: "Exact WindowServer ownership or pointer bounds changed. No input sent.")
        }
        guard let onScreen = isOnScreen(windowID) else {
            throw DriverFailure(code: "BackgroundUnavailable", message: "WindowServer visibility query failed. No input sent.")
        }
        guard [observed.minX,observed.minY,observed.width,observed.height].allSatisfy({ $0.isFinite }), !observed.isEmpty else {
            throw DriverFailure(code: "StaleTarget", message: "Accessibility pointer bounds are invalid. No input sent.")
        }
        // Preserve the established on-screen route. For an inactive-Space window,
        // require AX/WindowServer geometry agreement (at most half a logical point
        // of rounding) before addressing its real window-local coordinate space.
        if onScreen { return observed }
        let actual = CGRect(x:x,y:y,width:width,height:height)
        guard Self.matchingPointerFrames(observed, actual) else {
            throw DriverFailure(code: "StaleTarget", message: "Accessibility and WindowServer pointer bounds disagree. Observe again; no input sent.")
        }
        return actual
    }
    static func matchingPointerFrames(_ observed: CGRect, _ actual: CGRect) -> Bool {
        let values = [observed.minX,observed.minY,observed.width,observed.height,actual.minX,actual.minY,actual.width,actual.height]
        return values.allSatisfy { $0.isFinite } && !observed.isEmpty && !actual.isEmpty &&
            abs(observed.minX-actual.minX) <= 0.5 && abs(observed.minY-actual.minY) <= 0.5 &&
            abs(observed.width-actual.width) <= 0.5 && abs(observed.height-actual.height) <= 0.5
    }
    func supportsPointer() -> Bool {
        symbol(sky, "SLEventPostToPid", PostFunction.self) != nil &&
        symbol(sky, "CGEventSetWindowLocation", LocalPointFunction.self) != nil &&
        symbol(sky, "SLEventSetIntegerValueField", FieldFunction.self) != nil
    }
    /// Parse physical keys independently of delivery. Chords still require a live
    /// exact-window receiver; this never changes the foreground application.
    static func keyChord(_ key: String) -> (CGKeyCode, CGEventFlags)? {
        let keys: [String: CGKeyCode] = ["Enter":36,"Tab":48,"Escape":53,"Space":49,"Backspace":51,"Delete":117,"ArrowLeft":123,"ArrowRight":124,"ArrowDown":125,"ArrowUp":126,"Home":115,"End":119,"PageUp":116,"PageDown":121,
            "A":0,"S":1,"D":2,"F":3,"H":4,"G":5,"Z":6,"X":7,"C":8,"V":9,"B":11,"Q":12,"W":13,"E":14,"R":15,"Y":16,"T":17,"O":31,"U":32,"I":34,"P":35,"L":37,"J":38,"K":40,"N":45,"M":46,
            "1":18,"2":19,"3":20,"4":21,"6":22,"5":23,"9":25,"7":26,"8":28,"0":29]
        let modifiers: [String: CGEventFlags] = ["Meta":.maskCommand,"Shift":.maskShift,"Alt":.maskAlternate,"Option":.maskAlternate,"Control":.maskControl]
        let parts = key.split(separator: "+", omittingEmptySubsequences: false).map(String.init)
        guard let last = parts.last, let code = keys[last] else { return nil }
        var flags: CGEventFlags = []
        for part in parts.dropLast() {
            guard let modifier = modifiers[part], !flags.contains(modifier) else { return nil }
            flags.insert(modifier)
        }
        // Letters/digits are command chords, not an alternative text transport.
        guard last.count != 1 || !flags.intersection([.maskCommand,.maskControl,.maskAlternate]).isEmpty else { return nil }
        return (code, flags)
    }
    func keyboard(pid: pid_t, windowID: CGWindowID, key: String?, text: String?) throws {
        guard let post = symbol(sky, "SLEventPostToPid", PostFunction.self),
              let field = symbol(sky, "SLEventSetIntegerValueField", FieldFunction.self),
              let window = windowInfo(windowID), window[kCGWindowOwnerPID as String] as? Int == Int(pid) else {
            throw DriverFailure(code: "BackgroundUnavailable", message: "Background keyboard transport or exact window ownership unavailable.")
        }
        var payloads: [(CGKeyCode, String?, CGEventFlags)] = []
        if let text {
            guard !text.isEmpty, text.utf8.count <= 16000 else { throw DriverFailure(code: "InvalidRequest", message: "Text must contain 1–16000 UTF-8 bytes.") }
            var chunk = ""
            for scalar in text.unicodeScalars {
                let next = String(scalar)
                if (chunk + next).utf16.count > 20 { payloads.append((0, chunk, [])); chunk = "" }
                chunk += next
            }
            if !chunk.isEmpty { payloads.append((0, chunk, [])) }
        } else if let key, let (code, flags) = Self.keyChord(key) {
            payloads.append((code, nil, flags))
        } else { throw DriverFailure(code: "InvalidRequest", message: "Unsupported background key.") }
        let source = CGEventSource(stateID: .privateState)
        let events = try payloads.flatMap { code, text, flags -> [CGEvent] in
            try [true, false].map { down in
                guard let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down) else { throw DriverFailure(code: "BackgroundUnavailable", message: "Cannot create keyboard event.") }
                event.flags = flags
                for (key, value): (UInt32, Int64) in [(40,Int64(pid)),(51,Int64(windowID)),(91,Int64(windowID)),(92,Int64(windowID))] { field(event, key, value) }
                if let text { let units = Array(text.utf16); units.withUnsafeBufferPointer { event.keyboardSetUnicodeString(stringLength: units.count, unicodeString: $0.baseAddress!) } }
                return event
            }
        }
        for event in events { post(pid, event); Thread.sleep(forTimeInterval: 0.008) }
    }
    func click(pid: pid_t, windowID: CGWindowID, frame: CGRect, point: CGPoint, chromium: Bool = false) throws {
        guard let post = symbol(sky, "SLEventPostToPid", PostFunction.self),
              let local = symbol(sky, "CGEventSetWindowLocation", LocalPointFunction.self),
              let field = symbol(sky, "SLEventSetIntegerValueField", FieldFunction.self),
              frame.contains(point), point.x.isFinite, point.y.isFinite else {
            throw DriverFailure(code: "BackgroundUnavailable", message: "Exact-window background pointer transport is unavailable.")
        }
        let windows = CGWindowListCopyWindowInfo(.optionIncludingWindow, windowID) as? [[String: Any]] ?? []
        guard windows.count == 1, let window = windows.first,
              window[kCGWindowOwnerPID as String] as? Int == Int(pid),
              window[kCGWindowLayer as String] as? Int == 0 else {
            throw DriverFailure(code: "StaleTarget", message: "Window ownership changed before background dispatch.")
        }
        let deliveryFrame = try pointerFrame(pid: pid, windowID: windowID, observed: frame)
        guard deliveryFrame.contains(point) else { throw DriverFailure(code: "StaleTarget", message: "Pointer target moved outside its WindowServer bounds. No input sent.") }
        let source = CGEventSource(stateID: .privateState)
        let group = Int64.random(in: 1...Int64(Int32.max))
        // Construct the entire sequence before dispatch; never retry a sent event.
        // Chromium needs a non-hit-testing primer pair before its target pair.
        // Route every event to this window; never activate or defocus another app.
        let sequence: [(CGEventType, Int64, Int64, Bool)] = chromium
            ? [(.mouseMoved, 0, 2, false), (.leftMouseDown, 1, 1, true), (.leftMouseUp, 1, 2, true), (.leftMouseDown, 1, 3, false), (.leftMouseUp, 1, 3, false)]
            : [(.mouseMoved, 0, 2, false), (.leftMouseDown, 1, 3, false), (.leftMouseUp, 1, 3, false)]
        let events = try sequence.map { type, count, phase, primer -> CGEvent in
            guard let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: primer ? CGPoint(x: -1, y: -1) : point, mouseButton: .left) else {
                throw DriverFailure(code: "BackgroundUnavailable", message: "Unable to construct background pointer event.")
            }
            event.flags = []
            for (key, value): (UInt32, Int64) in [(0,phase),(1,count),(3,0),(7,3),(40,Int64(pid)),(51,Int64(windowID)),(58,group),(91,Int64(windowID)),(92,Int64(windowID))] {
                field(event, key, value)
            }
            local(event, primer ? -1 : point.x - deliveryFrame.minX, primer ? -1 : point.y - deliveryFrame.minY)
            return event
        }
        for (index, event) in events.enumerated() {
            post(pid, event)
            if index < events.count - 1 { Thread.sleep(forTimeInterval: index == 0 ? 0.015 : (chromium && index == 2) ? 0.100 : (chromium && index == 1) ? 0.001 : 0.028) }
        }
    }
    /// Rich gestures remain addressed to one owning process and window.
    /// No global event tap, focus activation, or physical cursor warp is used.
    func gesture(pid: pid_t, windowID: CGWindowID, frame: CGRect, point: CGPoint, end: CGPoint, kind: String) throws {
        guard let post = symbol(sky, "SLEventPostToPid", PostFunction.self),
              let local = symbol(sky, "CGEventSetWindowLocation", LocalPointFunction.self),
              let field = symbol(sky, "SLEventSetIntegerValueField", FieldFunction.self),
              point.x.isFinite, point.y.isFinite, end.x.isFinite, end.y.isFinite,
              frame.contains(point), frame.contains(end),
              let window = windowInfo(windowID),
              window[kCGWindowOwnerPID as String] as? Int == Int(pid) else {
            throw DriverFailure(code: "BackgroundUnavailable", message: "Gesture requires exact window ownership and geometry.")
        }
        let deliveryFrame = try pointerFrame(pid: pid, windowID: windowID, observed: frame)
        guard deliveryFrame.contains(point), deliveryFrame.contains(end) else { throw DriverFailure(code: "StaleTarget", message: "Gesture target moved outside its WindowServer bounds. No input sent.") }
        let source = CGEventSource(stateID: .privateState)
        let right = kind == "rightClick"
        let button: CGMouseButton = right ? .right : .left
        var sequence: [(CGEventType, CGPoint, Int64)] = [(.mouseMoved, point, 0)]
        if kind == "drag" {
            sequence.append((.leftMouseDown, point, 1))
            for step in 1...24 {
                let t = Double(step) / 24.0
                sequence.append((.leftMouseDragged, CGPoint(x: point.x+(end.x-point.x)*t, y: point.y+(end.y-point.y)*t), 1))
            }
            sequence.append((.leftMouseUp, end, 1))
        } else if kind != "hover" {
            for count in 1...(kind == "doubleClick" ? 2 : 1) {
                sequence.append((right ? .rightMouseDown : .leftMouseDown, point, Int64(count)))
                sequence.append((right ? .rightMouseUp : .leftMouseUp, point, Int64(count)))
            }
        }
        let group = Int64.random(in: 1...Int64(Int32.max))
        let events = try sequence.map { type, location, count -> CGEvent in
            guard let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: location, mouseButton: button) else {
                throw DriverFailure(code: "BackgroundUnavailable", message: "Could not construct gesture.")
            }
            event.flags = []
            for (key, value): (UInt32, Int64) in [(0,3),(1,count),(3,right ? 1 : 0),(7,3),(40,Int64(pid)),(51,Int64(windowID)),(58,group),(91,Int64(windowID)),(92,Int64(windowID))] { field(event,key,value) }
            local(event,location.x-deliveryFrame.minX,location.y-deliveryFrame.minY)
            return event
        }
        for event in events { post(pid,event); Thread.sleep(forTimeInterval: 0.012) }
    }

}
