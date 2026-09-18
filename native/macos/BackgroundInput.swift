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
    func supportsPointer() -> Bool {
        symbol(sky, "SLEventPostToPid", PostFunction.self) != nil &&
        symbol(sky, "CGEventSetWindowLocation", LocalPointFunction.self) != nil &&
        symbol(sky, "SLEventSetIntegerValueField", FieldFunction.self) != nil
    }
    func keyboard(pid: pid_t, windowID: CGWindowID, key: String?, text: String?) throws {
        guard let post = symbol(sky, "SLEventPostToPid", PostFunction.self),
              let field = symbol(sky, "SLEventSetIntegerValueField", FieldFunction.self),
              let window = windowInfo(windowID), window[kCGWindowOwnerPID as String] as? Int == Int(pid) else {
            throw DriverFailure(code: "BackgroundUnavailable", message: "Background keyboard transport or exact window ownership unavailable.")
        }
        let keys: [String: CGKeyCode] = ["Enter":36,"Tab":48,"Shift+Tab":48,"Option+Tab":48,"Option+Shift+Tab":48,"Escape":53,"Space":49,"Backspace":51,"ArrowLeft":123,"ArrowRight":124,"ArrowDown":125,"ArrowUp":126,"Meta+A":0,"Home":115,"End":119,"PageUp":116,"PageDown":121]
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
        } else if let key, let code = keys[key] {
            payloads.append((code, nil, key == "Meta+A" ? .maskCommand : key == "Shift+Tab" ? .maskShift : key == "Option+Tab" ? .maskAlternate : key == "Option+Shift+Tab" ? [.maskAlternate, .maskShift] : []))
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
        guard let onScreen = isOnScreen(windowID) else {
            throw DriverFailure(code: "BackgroundUnavailable", message: "WindowServer visibility query failed. No input sent.")
        }
        guard onScreen else {
            throw DriverFailure(code: "WindowOffScreen", message: "The target window is absent from WindowServer's current on-screen list. This does not mean the app is unresponsive. No input sent and no Space switch attempted.")
        }
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
            local(event, primer ? -1 : point.x - frame.minX, primer ? -1 : point.y - frame.minY)
            return event
        }
        for (index, event) in events.enumerated() {
            post(pid, event)
            if index < events.count - 1 { Thread.sleep(forTimeInterval: index == 0 ? 0.015 : (chromium && index == 2) ? 0.100 : (chromium && index == 1) ? 0.001 : 0.028) }
        }
    }
}
