import Foundation
import AppKit
import ApplicationServices
import ScreenCaptureKit

struct DriverFailure: Error {
    let code: String
    let message: String
    var delivery = "notDispatched"
}

struct SavedElement {
    let element: AXUIElement
    let role: String
    let name: String
}

@MainActor final class Driver {
    let backgroundInput = BackgroundInput()
    let visualDetector = VisualDetector()
    var visualRegions: [String: (region: VisualRegion, digest: String)] = [:]
    var visualCapturedAt: Date?
    var lastCaptureImage: CGImage?
    var virtualCursor: CGPoint?
    let foregroundAllowed = ProcessInfo.processInfo.environment["JEV_INTERACTION_MODE"] == "foreground"
    var activatedRenderers = Set<String>()
    var observationErrors = 0
    var trackingObservation = false
    var refs: [String: SavedElement] = [:]
    var generation = ""
    var targetPID: pid_t = 0
    var targetLaunch: Date?
    var targetWindow: AXUIElement?
    var captureFrame: CGRect?
    var captureGeneration = ""

    func value(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
        var result: CFTypeRef?
        let status = AXUIElementCopyAttributeValue(element, name as CFString, &result)
        if trackingObservation && status != .success && status != .attributeUnsupported && status != .noValue { observationErrors += 1 }
        return status == .success ? result : nil
    }

    func string(_ element: AXUIElement, _ name: String) -> String {
        guard let raw = value(element, name) else { return "" }
        if let text = raw as? String { return String(text.prefix(2000)) }
        if let number = raw as? NSNumber { return number.stringValue }
        return ""
    }

    func name(_ element: AXUIElement) -> String {
        for attribute in ["AXTitle", "AXDescription", "AXHelp", "AXPlaceholderValue", "AXIdentifier"] {
            let text = string(element, attribute)
            if !text.isEmpty { return text }
        }
        return ""
    }

    func actions(_ element: AXUIElement) -> [String] {
        var result: CFArray?
        AXUIElementCopyActionNames(element, &result)
        return result as? [String] ?? []
    }

    func requireAX() throws {
        if !AXIsProcessTrusted() { throw DriverFailure(code: "AccessibilityDenied", message: "Enable Accessibility for the app launching the driver in System Settings.") }
    }

    func snapshot(_ pid: pid_t, windowID: CGWindowID? = nil, nodeLimit: Int = 1000) throws -> [String: Any] {
        try requireAX()
        observationErrors = 0; trackingObservation = true
        defer { trackingObservation = false }
        guard let app = NSRunningApplication(processIdentifier: pid), !app.isTerminated else {
            throw DriverFailure(code: "AppClosed", message: "The selected application is no longer running.")
        }
        refs.removeAll(); visualRegions.removeAll(); visualCapturedAt = nil; lastCaptureImage = nil; captureFrame = nil; captureGeneration = ""
        generation = UUID().uuidString; targetPID = pid; targetLaunch = app.launchDate
        let application = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(application, 1.5)
        // Chromium/Electron can expose only window chrome until accessibility is enabled.
        // Use the modern renderer opt-in; only legacy Electron gets the older fallback.
        let rendererIdentity = "\(pid):\(app.launchDate?.timeIntervalSince1970 ?? 0)"
        if !activatedRenderers.contains(rendererIdentity), (value(application, "AXManualAccessibility") as? Bool) != true {
            activatedRenderers.insert(rendererIdentity)
            let enabled = AXUIElementSetAttributeValue(application, "AXManualAccessibility" as CFString, kCFBooleanTrue)
            if enabled == .success {
                Thread.sleep(forTimeInterval: 0.25)
            } else if enabled == .attributeUnsupported,
                      let bundleURL = app.bundleURL,
                      FileManager.default.fileExists(atPath: bundleURL.appendingPathComponent("Contents/Frameworks/Electron Framework.framework").path) {
                if AXUIElementSetAttributeValue(application, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue) == .success {
                    Thread.sleep(forTimeInterval: 0.25)
                }
            }
        }
        func validWindow(_ raw: CFTypeRef?) -> AXUIElement? {
            guard let raw, CFGetTypeID(raw) == AXUIElementGetTypeID() else { return nil }
            let element = raw as! AXUIElement
            var owner: pid_t = 0
            guard AXUIElementGetPid(element, &owner) == .success, owner == pid,
                  string(element, "AXRole") == "AXWindow" else { return nil }
            return element
        }
        var windowValue: CFTypeRef?
        var windowStatus = AXError.cannotComplete
        for attempt in 0..<8 {
            windowStatus = AXUIElementCopyAttributeValue(application, "AXWindows" as CFString, &windowValue)
            if windowStatus == .success {
                if !(windowValue as? [AXUIElement] ?? []).isEmpty { break }
                if validWindow(value(application, "AXFocusedWindow")) != nil || validWindow(value(application, "AXMainWindow")) != nil { break }
                // Renderer activation can temporarily remove its windows while rebuilding AX.
                if attempt == 7 { break }
            } else if windowStatus != .cannotComplete || attempt >= 1 { break }
            Thread.sleep(forTimeInterval: 0.2)
        }
        guard windowStatus == .success else {
            throw DriverFailure(code: "ObservationFailed", message: "Cannot read AXWindows (AX error \(windowStatus.rawValue)). Check the app is responsive and Accessibility is enabled for this launch identity.")
        }
        let windows = windowValue as? [AXUIElement] ?? []
        // Some Electron apps expose a real focused window but an empty AXWindows array.
        let focused = validWindow(value(application, "AXFocusedWindow"))
        let main = validWindow(value(application, "AXMainWindow"))
        let childWindow = (value(application, "AXChildren") as? [AXUIElement] ?? []).first { string($0, "AXRole") == "AXWindow" }
        let alternatives = [focused, main, childWindow].compactMap { $0 } + windows
        let selected = windowID.flatMap { id in alternatives.first { backgroundInput.windowID($0) == id } }
        guard windowID == nil || selected != nil else { throw DriverFailure(code: "StaleTarget", message: "Requested window is no longer accessible. List windows again.") }
        guard let window = selected ?? focused ?? main ?? windows.first ?? childWindow else { throw DriverFailure(code: "UnsupportedSurface", message: "App returned no accessible windows. Open a window in the selected app first.") }
        targetWindow = window
        let deadline = Date().addingTimeInterval(6)
        var nodes: [[String: Any]] = []
        var truncated = false
        var visited: [CFHashCode: [AXUIElement]] = [:]
        func walk(_ element: AXUIElement, _ depth: Int) {
            if nodes.count >= nodeLimit || depth > 40 || Date() > deadline { truncated = true; return }
            let hash = CFHash(element)
            if visited[hash, default: []].contains(where: { CFEqual($0, element) }) { return }
            visited[hash, default: []].append(element)
            AXUIElementSetMessagingTimeout(element, 0.15)
            let role = string(element, "AXRole")
            let label = name(element)
            let ref = "\(generation):\(nodes.count)"
            let secure = role == "AXSecureTextField" || string(element, "AXSubrole") == "AXSecureTextField"
            var supported = actions(element)
            for attribute in ["AXValue", "AXSelectedText"] {
                var writable = DarwinBoolean(false)
                if AXUIElementIsAttributeSettable(element, attribute as CFString, &writable) == .success && writable.boolValue && !secure {
                    supported.append(attribute == "AXValue" ? "setValue" : "insertText")
                }
            }
            var focusable = DarwinBoolean(false)
            if !secure && AXUIElementIsAttributeSettable(element, "AXFocused" as CFString, &focusable) == .success && focusable.boolValue {
                supported.append("focus")
            }
            refs[ref] = SavedElement(element: element, role: role, name: label)
            var node: [String: Any] = ["ref": ref, "role": role, "name": label,
                          "value": secure ? "[secure]" : string(element, "AXValue"),
                          "focused": (value(element, "AXFocused") as? Bool) ?? false,
                          "enabled": (value(element, "AXEnabled") as? Bool) ?? true,
                          "actions": secure ? [] : supported, "depth": depth]
            if let frame = windowFrame(element) {
                node["frame"] = ["x": frame.minX, "y": frame.minY, "width": frame.width, "height": frame.height]
            }
            nodes.append(node)
            let children = value(element, "AXChildren") as? [AXUIElement] ?? []
            for child in children {
                if nodes.count >= nodeLimit || Date() > deadline { truncated = true; break }
                walk(child, depth + 1)
            }
        }
        walk(window, 0)
        var result: [String: Any] = ["id": generation, "source": "ax", "pid": Int(pid),
                "title": string(window, "AXTitle"), "nodes": nodes, "truncated": truncated || observationErrors > 0, "observationErrors": observationErrors,
                "capturedAt": ISO8601DateFormatter().string(from: Date()),
                "windowListed": windows.contains { CFEqual($0, window) }]
        if let id = backgroundInput.windowID(window) {
            result["windowId"] = Int(id)
            if let onScreen = backgroundInput.isOnScreen(id) { result["windowOnScreen"] = onScreen }
        }
        return result
    }

    /// Safari may omit application AXFocusedUIElement while in the background.
    /// In that case require exactly one leaf of the window's live focused AX tree.
    func keyboardReceiver(_ element: AXUIElement, window: AXUIElement) -> Bool {
        let application = AXUIElementCreateApplication(targetPID)
        guard let focusedWindow = value(application, "AXFocusedWindow"), CFEqual(focusedWindow, window),
              backgroundInput.belongs(element, to: window) else { return false }
        if let focused = value(application, "AXFocusedUIElement"), CFGetTypeID(focused) == AXUIElementGetTypeID() {
            return CFEqual(focused, element)
        }
        var leaves: [AXUIElement] = []
        var visited: [CFHashCode: [AXUIElement]] = [:]
        var visitedCount = 0
        var valid = true
        let deadline = Date().addingTimeInterval(2)
        @discardableResult func walk(_ node: AXUIElement) -> Bool {
            if Date() > deadline || visitedCount > 2500 { valid = false; return false }
            let hash = CFHash(node)
            if visited[hash, default: []].contains(where: { CFEqual($0, node) }) { return false }
            visited[hash, default: []].append(node); visitedCount += 1
            var childrenValue: CFTypeRef?
            let status = AXUIElementCopyAttributeValue(node, "AXChildren" as CFString, &childrenValue)
            if status != .success && status != .attributeUnsupported && status != .noValue { valid = false }
            var childFocused = false
            for child in childrenValue as? [AXUIElement] ?? [] { if walk(child) { childFocused = true } }
            let focused = (value(node, "AXFocused") as? Bool) == true
            if focused && !childFocused { leaves.append(node) }
            return focused || childFocused
        }
        walk(window)
        return valid && leaves.count == 1 && CFEqual(leaves[0], element)
    }

    func checkGeneration(_ request: [String: Any]) throws {
        guard let supplied = request["snapshotId"] as? String, !generation.isEmpty, supplied == generation,
              let app = NSRunningApplication(processIdentifier: targetPID), !app.isTerminated,
              app.launchDate == targetLaunch else {
            throw DriverFailure(code: "StaleTarget", message: "Observe the target again before acting.")
        }
    }

    func target(_ action: [String: Any]) throws -> AXUIElement {
        guard let ref = action["ref"] as? String, let saved = refs[ref],
              string(saved.element, "AXRole") == saved.role,
              name(saved.element) == saved.name else {
            throw DriverFailure(code: "StaleTarget", message: "The referenced control changed or disappeared.")
        }
        guard (value(saved.element, "AXEnabled") as? Bool) != false else {
            throw DriverFailure(code: "NotActionable", message: "The control is disabled.")
        }
        return saved.element
    }

    // Visual feedback is optional and does not replace semantic AX dispatch.
    func indicate(_ element: AXUIElement) {
        guard let frame = windowFrame(element), !frame.isEmpty,
              frame.minX.isFinite, frame.minY.isFinite,
              let start = CGEvent(source: nil)?.location,
              let primary = NSScreen.screens.first else { return }
        let destination = CGPoint(x: frame.midX, y: frame.midY)
        let reduced = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        let steps = reduced ? 1 : 18
        for step in 1...steps {
            let t = Double(step) / Double(steps)
            let eased = t * t * (3 - 2 * t)
            CGWarpMouseCursorPosition(CGPoint(x: start.x + (destination.x - start.x) * eased,
                                             y: start.y + (destination.y - start.y) * eased))
            if !reduced { Thread.sleep(forTimeInterval: 0.012) }
        }
        let panel = NSPanel(contentRect: NSRect(x: destination.x - 22, y: primary.frame.maxY - destination.y - 22, width: 44, height: 44),
                            styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.animationBehavior = .none
        panel.isOpaque = false; panel.backgroundColor = .clear; panel.hasShadow = false
        panel.ignoresMouseEvents = true; panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        let view = NSView(frame: NSRect(x: 0, y: 0, width: 44, height: 44))
        view.wantsLayer = true; view.layer?.cornerRadius = 22
        view.layer?.borderWidth = 3; view.layer?.borderColor = NSColor.systemGreen.cgColor
        view.layer?.backgroundColor = NSColor.systemGreen.withAlphaComponent(0.15).cgColor
        panel.isReleasedWhenClosed = false
        defer { panel.orderOut(nil); panel.close() }
        panel.contentView = view; panel.orderFrontRegardless()
        RunLoop.current.run(until: Date().addingTimeInterval(0.18))
        panel.orderOut(nil)
        RunLoop.current.run(until: Date().addingTimeInterval(0.03))
    }

    func execute(_ request: [String: Any]) throws -> [String: Any] {
        try requireAX(); try checkGeneration(request)
        guard let action = request["action"] as? [String: Any], let kind = action["kind"] as? String else {
            throw DriverFailure(code: "InvalidRequest", message: "Missing action.")
        }
        guard foregroundAllowed || !["key", "click", "clickElement"].contains(kind) else {
            throw DriverFailure(code: "BackgroundOnly", message: "Physical input is disabled in background mode. Use semantic actions or an isolated desktop.")
        }
        if !foregroundAllowed && NSWorkspace.shared.frontmostApplication?.processIdentifier == targetPID {
            throw DriverFailure(code: "UserActiveInTarget", message: "The target app is currently foreground. Background automation yields to your work; retry only after you leave this app.")
        }
        let result: AXError
        switch kind {
        case "press":
            let element = try target(action)
            guard actions(element).contains("AXPress") else { throw DriverFailure(code: "UnsupportedAction", message: "Control does not advertise AXPress.") }
            if foregroundAllowed && request["animate"] as? Bool == true { indicate(element) }
            // Traversal sets 150 ms on this very AX object. Actions need their own budget.
            AXUIElementSetMessagingTimeout(element, 3)
            result = AXUIElementPerformAction(element, "AXPress" as CFString)
        case "focus":
            let element = try target(action)
            var writable = DarwinBoolean(false)
            guard let window = targetWindow, backgroundInput.belongs(element, to: window),
                  string(element, "AXRole") != "AXSecureTextField", string(element, "AXSubrole") != "AXSecureTextField",
                  AXUIElementIsAttributeSettable(element, "AXFocused" as CFString, &writable) == .success, writable.boolValue else {
                throw DriverFailure(code: "UnsupportedAction", message: "Control does not expose writable focus in this window.")
            }
            result = AXUIElementSetAttributeValue(element, "AXFocused" as CFString, kCFBooleanTrue)
        case "setValue", "insertText":
            let element = try target(action)
            guard let text = action["text"] as? String, text.utf8.count <= 16000,
                  string(element, "AXRole") != "AXSecureTextField", string(element, "AXSubrole") != "AXSecureTextField" else {
                throw DriverFailure(code: "InvalidRequest", message: "Invalid text or protected field.")
            }
            let attribute = kind == "setValue" ? "AXValue" : "AXSelectedText"
            var writable = DarwinBoolean(false)
            guard AXUIElementIsAttributeSettable(element, attribute as CFString, &writable) == .success && writable.boolValue else {
                throw DriverFailure(code: "UnsupportedAction", message: "Field does not support semantic text entry.")
            }
            if foregroundAllowed && request["animate"] as? Bool == true { indicate(element) }
            AXUIElementSetMessagingTimeout(element, 3)
            result = AXUIElementSetAttributeValue(element, attribute as CFString, text as CFString)
        case "backgroundKey", "backgroundText":
            let element = try target(action)
            guard let window = targetWindow, let expectedID = backgroundInput.windowID(window),
                  backgroundInput.belongs(element, to: window),
                  (kind == "backgroundKey" || ["AXTextField", "AXTextArea", "AXComboBox"].contains(string(element, "AXRole"))),
                  string(element, "AXSubrole") != "AXSecureTextField" else {
                throw DriverFailure(code: "BackgroundUnavailable", message: "Background keyboard requires an exact non-protected editable control and window.")
            }
            guard keyboardReceiver(element, window: window) else {
                throw DriverFailure(code: "BackgroundUnavailable", message: "The exact keyboard receiver is ambiguous or no longer focused. Observe before retrying.")
            }
            guard let text = action["text"] as? String else { throw DriverFailure(code: "InvalidRequest", message: "Missing keyboard payload.") }
            try backgroundInput.keyboard(pid: targetPID, windowID: expectedID, key: kind == "backgroundKey" ? text : nil, text: kind == "backgroundText" ? text : nil)
            result = .success
        case "backgroundClick":
            let element = try target(action)
            guard let window = targetWindow, let windowID = backgroundInput.windowID(window),
                  let bounds = windowFrame(window), let frame = windowFrame(element), !frame.isEmpty,
                  backgroundInput.belongs(element, to: window),
                  string(element, "AXRole") != "AXSecureTextField", string(element, "AXSubrole") != "AXSecureTextField" else {
                throw DriverFailure(code: "BackgroundUnavailable", message: "Background click requires an exact window and non-protected control bounds.")
            }
            let point = CGPoint(x: frame.midX, y: frame.midY)
            let bundle = NSRunningApplication(processIdentifier: targetPID)?.bundleURL
            let chromium = bundle.map { FileManager.default.fileExists(atPath: $0.appendingPathComponent("Contents/Frameworks/Electron Framework.framework").path) } ?? false
            try backgroundInput.click(pid: targetPID, windowID: windowID, frame: bounds, point: point, chromium: chromium)
            virtualCursor = point
            result = .success
        case "clickElement":
            let element = try target(action)
            guard let frame = windowFrame(element), !frame.isEmpty,
                  let window = targetWindow, let bounds = windowFrame(window),
                  frame.midX.isFinite, frame.midY.isFinite,
                  bounds.contains(CGPoint(x: frame.midX, y: frame.midY)) else {
                throw DriverFailure(code: "NotActionable", message: "Control has no visible bounds inside the observed window.")
            }
            NSRunningApplication(processIdentifier: targetPID)?.activate(options: [])
            AXUIElementPerformAction(window, "AXRaise" as CFString)
            Thread.sleep(forTimeInterval: 0.15)
            guard NSWorkspace.shared.frontmostApplication?.processIdentifier == targetPID else {
                throw DriverFailure(code: "NotActionable", message: "Target app is not foreground.")
            }
            let point = CGPoint(x: frame.midX, y: frame.midY)
            var hit: AXUIElement?
            let status = AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(point.x), Float(point.y), &hit)
            var matches = false
            if status == .success, var current = hit {
                for _ in 0..<50 {
                    var owner: pid_t = 0
                    AXUIElementGetPid(current, &owner)
                    let sameControl = owner == targetPID && string(current, "AXRole") == string(element, "AXRole") && name(current) == name(element) && windowFrame(current) == frame
                    if CFEqual(current, element) || sameControl { matches = true; break }
                    guard let parent = value(current, "AXParent"), CFGetTypeID(parent) == AXUIElementGetTypeID() else { break }
                    current = parent as! AXUIElement
                }
            }
            guard matches else { throw DriverFailure(code: "NotActionable", message: "Control center is occluded or hit testing does not match its ref (hit role: \(hit.map { string($0, "AXRole") } ?? "none"), AX status: \(status.rawValue)).") }
            if foregroundAllowed && request["animate"] as? Bool == true { indicate(element) }
            guard windowFrame(element) == frame,
                  NSWorkspace.shared.frontmostApplication?.processIdentifier == targetPID else {
                throw DriverFailure(code: "StaleTarget", message: "Target moved before pointer dispatch.")
            }
            guard let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left),
                  let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left) else {
                throw DriverFailure(code: "UnsupportedAction", message: "Could not create pointer events.")
            }
            down.post(tap: .cghidEventTap); up.post(tap: .cghidEventTap)
            result = .success
        case "key":
            let keys: [String: CGKeyCode] = ["Escape": 53, "Tab": 48, "Shift+Tab": 48,
                "Enter": 36, "Space": 49, "ArrowLeft": 123, "ArrowRight": 124,
                "ArrowDown": 125, "ArrowUp": 126, "Backspace": 51,
                "Home": 115, "End": 119, "PageUp": 116, "PageDown": 121, "Meta+A": 0]
            guard let key = action["text"] as? String, let code = keys[key], let window = targetWindow else {
                throw DriverFailure(code: "UnsupportedAction", message: "Unsupported named key or missing window.")
            }
            let application = AXUIElementCreateApplication(targetPID)
            if let raw = value(application, "AXFocusedUIElement"), CFGetTypeID(raw) == AXUIElementGetTypeID() {
                let focused = raw as! AXUIElement
                guard string(focused, "AXRole") != "AXSecureTextField", string(focused, "AXSubrole") != "AXSecureTextField" else {
                    throw DriverFailure(code: "NotActionable", message: "Keyboard input is disabled in protected fields.")
                }
            }
            NSRunningApplication(processIdentifier: targetPID)?.activate(options: [])
            AXUIElementPerformAction(window, "AXRaise" as CFString)
            Thread.sleep(forTimeInterval: 0.15)
            guard NSWorkspace.shared.frontmostApplication?.processIdentifier == targetPID,
                  let focusedWindow = value(application, "AXFocusedWindow"), CFEqual(focusedWindow, window) else {
                throw DriverFailure(code: "StaleTarget", message: "The observed window is not focused. Observe again.")
            }
            guard let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true),
                  let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false) else {
                throw DriverFailure(code: "UnsupportedAction", message: "Could not create keyboard events.")
            }
            let flags: CGEventFlags = key == "Meta+A" ? .maskCommand : key == "Shift+Tab" ? .maskShift : []
            down.flags = flags; up.flags = flags
            down.postToPid(targetPID); up.postToPid(targetPID)
            result = .success
        case "click":
            guard request["foregroundApproved"] as? Bool == true,
                  captureGeneration == generation, let frame = captureFrame,
                  let x = action["x"] as? Double, let y = action["y"] as? Double,
                  x.isFinite, y.isFinite, x >= 0, y >= 0, x < frame.width, y < frame.height else {
                throw DriverFailure(code: "NotActionable", message: "A fresh screenshot and foreground approval are required for a pixel click.")
            }
            guard let window = targetWindow, windowFrame(window) == frame else {
                throw DriverFailure(code: "StaleTarget", message: "Window moved since capture.")
            }
            NSRunningApplication(processIdentifier: targetPID)?.activate(options: [])
            Thread.sleep(forTimeInterval: 0.15)
            guard NSWorkspace.shared.frontmostApplication?.processIdentifier == targetPID else {
                throw DriverFailure(code: "NotActionable", message: "Target app did not become foreground.")
            }
            let point = CGPoint(x: frame.minX + x, y: frame.minY + y)
            CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
            CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
            result = .success
        default:
            throw DriverFailure(code: "UnsupportedAction", message: "This driver supports press, setValue, insertText, named keys, and approved visual click.")
        }
        generation = ""; refs.removeAll(); captureFrame = nil
        if result != .success {
            throw DriverFailure(code: "ActionOutcomeUnknown", message: "macOS did not confirm the action (AX error \(result.rawValue)). It may have been delivered; inspect fresh state before retrying.", delivery: "dispatchedUnverified")
        }
        return ["delivery": "dispatchedUnverified", "message": "Action dispatched. Verify with a new observation."]
    }

    func windowFrame(_ element: AXUIElement) -> CGRect? {
        guard let position = value(element, "AXPosition"), let size = value(element, "AXSize"),
              CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID() else { return nil }
        var point = CGPoint.zero; var dimensions = CGSize.zero
        guard AXValueGetValue(position as! AXValue, .cgPoint, &point),
              AXValueGetValue(size as! AXValue, .cgSize, &dimensions) else { return nil }
        return CGRect(origin: point, size: dimensions)
    }

    func screenshot(_ request: [String: Any]) async throws -> [String: Any] {
        try checkGeneration(request)
        guard CGPreflightScreenCaptureAccess() else {
            throw DriverFailure(code: "ScreenRecordingDenied", message: "Visual fallback is optional. Enable Screen Recording to use it.")
        }
        if #available(macOS 14.0, *) {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            guard let axWindow = targetWindow, let frame = windowFrame(axWindow) else { throw DriverFailure(code: "UnsupportedSurface", message: "Window geometry unavailable.") }
            let title = string(axWindow, "AXTitle")
            let expectedID = backgroundInput.windowID(axWindow)
            let matches = content.windows.filter { candidate in
                guard candidate.owningApplication?.processID == targetPID else { return false }
                if let expectedID { return candidate.windowID == expectedID }
                return candidate.title == title && abs(candidate.frame.width - frame.width) < 2 && abs(candidate.frame.height - frame.height) < 2
            }
            guard matches.count == 1, let window = matches.first else {
                throw DriverFailure(code: "AmbiguousTarget", message: "Could not bind capture to exactly one accessible window.")
            }
            let config = SCStreamConfiguration()
            config.width = max(1, Int(frame.width)); config.height = max(1, Int(frame.height))
            config.showsCursor = false
            config.ignoreShadowsSingleWindow = true
            config.ignoreGlobalClipSingleWindow = true
            let image = try await SCScreenshotManager.captureImage(contentFilter: SCContentFilter(desktopIndependentWindow: window), configuration: config)
            guard let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]), data.count <= 6_000_000 else {
                throw DriverFailure(code: "CaptureFailed", message: "Screenshot encoding failed or image exceeds limit.")
            }
            lastCaptureImage = image
            captureFrame = frame; captureGeneration = generation
            return ["base64": data.base64EncodedString(), "width": config.width, "height": config.height, "origin": ["x": frame.minX, "y": frame.minY]]
        }
        throw DriverFailure(code: "UnsupportedPlatform", message: "Visual fallback requires macOS 14 or later.")
    }

    func detect(_ request: [String: Any], fromFile: Bool = false) async throws -> [String: Any] {
        let started = Date()
        let image: CGImage
        if fromFile {
            guard let path = request["imagePath"] as? String,
                  let attributes = try? FileManager.default.attributesOfItem(atPath: path),
                  let bytes = attributes[.size] as? Int, bytes <= 30_000_000,
                  let loaded = NSImage(contentsOfFile: path), let cg = loaded.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
                throw DriverFailure(code: "InvalidImage", message: "Provide a readable image file under 30 MB.")
            }
            image = cg
        } else {
            _ = try await screenshot(request)
            guard let captured = lastCaptureImage else { throw DriverFailure(code: "CaptureFailed", message: "No image captured.") }
            image = captured
        }
        let threshold = request["threshold"] as? Double ?? 0.35
        guard threshold.isFinite && threshold >= 0.1 && threshold <= 1 else { throw DriverFailure(code: "InvalidRequest", message: "Detection threshold must be 0.1–1.") }
        let output = try visualDetector.analyze(image, modelPath: request["modelPath"] as? String, threshold: Float(threshold))
        let prefix = fromFile ? "image-\(UUID().uuidString)" : generation
        let captureID = UUID().uuidString
        var regions: [[String: Any]] = []
        if !fromFile { visualRegions.removeAll(); visualCapturedAt = Date() }
        for (index, region) in output.regions.enumerated() {
            let ref = "\(prefix):visual:\(captureID):\(index)"
            if !fromFile, let digest = VisualDetector.patchDigest(image, bounds: region.bounds) { visualRegions[ref] = (region, digest) }
            regions.append(region.json(ref: ref))
        }
        var result: [String: Any] = ["snapshotId": fromFile ? prefix : generation,
            "width": image.width, "height": image.height, "regions": regions,
            "model": output.model, "actionable": !fromFile, "durationMs": Int(Date().timeIntervalSince(started) * 1000)]
        if let frame = captureFrame, !fromFile { result["origin"] = ["x": frame.minX, "y": frame.minY]; result["pointSize"] = ["width": frame.width, "height": frame.height] }
        if let warning = output.warning { result["warning"] = warning }
        if request["overlay"] as? Bool == true { result["overlay"] = VisualDetector.overlay(image, regions: output.regions) }
        else { result["image"] = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])?.base64EncodedString() }
        if let imageData = result["overlay"] as? String, imageData.utf8.count > 7_500_000 { result.removeValue(forKey: "overlay"); result["warning"] = "Overlay exceeds preview size limit; detections remain available." }
        if let imageData = result["image"] as? String, imageData.utf8.count > 7_500_000 { result.removeValue(forKey: "image"); result["warning"] = "Image exceeds preview size limit; detections remain available." }
        return result
    }

    func executeVisual(_ request: [String: Any]) async throws -> [String: Any] {
        try requireAX(); try checkGeneration(request)
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier != targetPID else {
            throw DriverFailure(code: "UserActiveInTarget", message: "Visual background input yields while you use the target app.")
        }
        guard let action = request["action"] as? [String: Any], let ref = action["ref"] as? String,
              let saved = visualRegions[ref], let capturedAt = visualCapturedAt, Date().timeIntervalSince(capturedAt) < 15,
              captureGeneration == generation, let capturedFrame = captureFrame,
              let window = targetWindow, windowFrame(window) == capturedFrame,
              let windowID = backgroundInput.windowID(window) else {
            throw DriverFailure(code: "StaleTarget", message: "Visual target is missing, expired, or moved. Observe with visual detection again.")
        }
        guard let capturedImage = lastCaptureImage else { throw DriverFailure(code: "StaleTarget", message: "Capture is no longer available.") }
        let scaleX = capturedFrame.width / CGFloat(capturedImage.width)
        let scaleY = capturedFrame.height / CGFloat(capturedImage.height)
        let targetBounds = CGRect(x: capturedFrame.minX + saved.region.bounds.minX * scaleX, y: capturedFrame.minY + saved.region.bounds.minY * scaleY, width: saved.region.bounds.width * scaleX, height: saved.region.bounds.height * scaleY)
        for savedElement in refs.values {
            let element = savedElement.element
            let protected = savedElement.role == "AXSecureTextField" || string(element, "AXSubrole") == "AXSecureTextField"
            if protected, let bounds = windowFrame(element), bounds.intersects(targetBounds) {
                throw DriverFailure(code: "ProtectedTarget", message: "Visual input cannot target a protected field.")
            }
        }
        // Recheck pixels immediately before input; detections never authorize blind coordinates.
        _ = try await screenshot(["snapshotId": generation])
        guard let current = lastCaptureImage,
              VisualDetector.patchDigest(current, bounds: saved.region.bounds) == saved.digest,
              windowFrame(window) == capturedFrame else {
            throw DriverFailure(code: "VisualTargetChanged", message: "Pixels changed at the detected target. Re-observe before selecting it again.")
        }
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier != targetPID else {
            throw DriverFailure(code: "UserActiveInTarget", message: "You started using the target app during verification. No click sent.")
        }
        let point = CGPoint(x: targetBounds.midX, y: targetBounds.midY)
        try backgroundInput.click(pid: targetPID, windowID: windowID, frame: capturedFrame, point: point)
        generation = ""; refs.removeAll(); visualRegions.removeAll(); lastCaptureImage = nil
        return ["delivery": "dispatchedUnverified", "message": "Visual region clicked in the background. Read fresh state to verify."]
    }

    func installedApps() -> [(id: String, name: String, url: URL)] {
        let roots = ["/Applications", "/System/Applications", "/System/Applications/Utilities", NSHomeDirectory() + "/Applications"]
        var found: [String: (id: String, name: String, url: URL)] = [:]
        for root in roots {
            guard let urls = try? FileManager.default.contentsOfDirectory(at: URL(fileURLWithPath: root), includingPropertiesForKeys: nil) else { continue }
            for url in urls where url.pathExtension == "app" {
                guard let bundle = Bundle(url: url), let id = bundle.bundleIdentifier else { continue }
                found[id] = (id, url.deletingPathExtension().lastPathComponent, url)
            }
        }
        return found.values.sorted { $0.name < $1.name }
    }

    func handle(_ request: [String: Any]) async throws -> Any {
        switch request["method"] as? String {
        case "installedApps": return installedApps().map { ["id": $0.id, "name": $0.name] }
        case "launchApp":
            guard let id = request["appId"] as? String, let target = installedApps().first(where: { $0.id == id }) else {
                throw DriverFailure(code: "UnknownApp", message: "Application is not in the installed catalog.")
            }
            let configuration = NSWorkspace.OpenConfiguration()
            configuration.activates = foregroundAllowed
            let running = try await NSWorkspace.shared.openApplication(at: target.url, configuration: configuration)
            for _ in 0..<(foregroundAllowed ? 10 : 0) {
                if NSWorkspace.shared.frontmostApplication?.processIdentifier == running.processIdentifier { break }
                try await Task.sleep(nanoseconds: 100_000_000)
            }
            return ["pid": Int(running.processIdentifier), "active": NSWorkspace.shared.frontmostApplication?.processIdentifier == running.processIdentifier]
        case "windows":
            try requireAX()
            guard let pid = request["pid"] as? Int, pid > 0, pid <= Int(Int32.max) else { throw DriverFailure(code: "InvalidRequest", message: "Select an application.") }
            let app = AXUIElementCreateApplication(pid_t(pid))
            AXUIElementSetMessagingTimeout(app, 1.5)
            var candidates = value(app, "AXWindows") as? [AXUIElement] ?? []
            for attribute in ["AXFocusedWindow", "AXMainWindow"] {
                if let raw = value(app, attribute), CFGetTypeID(raw) == AXUIElementGetTypeID() { candidates.append(raw as! AXUIElement) }
            }
            var ids = Set<CGWindowID>()
            return candidates.compactMap { window -> [String: Any]? in
                guard let id = backgroundInput.windowID(window), ids.insert(id).inserted else { return nil }
                var item: [String: Any] = ["windowId": Int(id), "title": string(window, "AXTitle"), "minimized": (value(window, "AXMinimized") as? Bool) ?? false]
                if let onScreen = backgroundInput.isOnScreen(id) { item["onScreen"] = onScreen }
                return item
            }
        case "inputState":
            let cursor = CGEvent(source: nil)?.location ?? .zero
            return ["foregroundPID": Int(NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0),
                    "cursor": ["x": cursor.x, "y": cursor.y],
                    "hardwareMouseMoves": CGEventSource.counterForEventType(.hidSystemState, eventType: .mouseMoved),
                    "backgroundPointerAvailable": backgroundInput.supportsPointer(),
                    "virtualCursor": virtualCursor.map { ["x": $0.x, "y": $0.y] } as Any? ?? NSNull()]
        case "status":
            return ["accessibility": AXIsProcessTrusted(), "screenRecording": CGPreflightScreenCaptureAccess(), "platform": "macOS", "visual": ["ocr": true, "modelInstalled": FileManager.default.fileExists(atPath: VisualDetector.defaultModelPath), "modelPath": VisualDetector.defaultModelPath]]
        case "requestAccessibility":
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
            return ["granted": AXIsProcessTrustedWithOptions(options)]
        case "requestScreenRecording": return ["granted": CGRequestScreenCaptureAccess()]
        case "apps":
            return NSWorkspace.shared.runningApplications.filter { $0.activationPolicy != .prohibited }.map { ["pid": Int($0.processIdentifier), "name": $0.localizedName ?? "Unknown"] as [String: Any] }
        case "snapshot":
            guard let pid = request["pid"] as? Int, pid > 0, pid <= Int(Int32.max) else { throw DriverFailure(code: "InvalidRequest", message: "Select an application.") }
            // Yield the main actor so pending accessibility updates can be delivered.
            try await Task.sleep(nanoseconds: 100_000_000)
            let requestedID: CGWindowID?
            if let id = request["windowId"] as? Int {
                guard id > 0, let exact = CGWindowID(exactly: id) else { throw DriverFailure(code: "InvalidRequest", message: "Invalid window ID.") }
                requestedID = exact
            } else { requestedID = nil }
            let nodeLimit = min(2500, max(100, request["nodeLimit"] as? Int ?? 1000))
            return try snapshot(pid_t(pid), windowID: requestedID, nodeLimit: nodeLimit)
        case "detect": return try await detect(request)
        case "detectImage": return try await detect(request, fromFile: true)
        case "execute":
            if let action = request["action"] as? [String: Any], action["kind"] as? String == "visualClick" { return try await executeVisual(request) }
            let result = try execute(request)
            try await Task.sleep(nanoseconds: 150_000_000)
            return result
        case "screenshot": return try await screenshot(request)
        case "cancel": generation = ""; refs.removeAll(); captureFrame = nil; return ["cancelled": true]
        default: throw DriverFailure(code: "InvalidRequest", message: "Unknown method.")
        }
    }
}

@main struct Main {
    @MainActor static func main() async {
        let driver = Driver()
        // Do not block the main actor on stdin: AppKit/NSWorkspace must process
        // application lifecycle notifications between protocol requests.
        while let line = await Task.detached(priority: .userInitiated, operation: { readLine() }).value {
            var id = ""
            var envelope: [String: Any]
            do {
                guard line.utf8.count <= 128_000, let data = line.data(using: .utf8),
                      let request = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let requestID = request["id"] as? String else { throw DriverFailure(code: "InvalidRequest", message: "Invalid request envelope.") }
                id = requestID
                envelope = ["id": id, "ok": true, "data": try await driver.handle(request)]
            } catch let failure as DriverFailure {
                envelope = ["id": id, "ok": false, "error": ["code": failure.code, "message": failure.message, "delivery": failure.delivery]]
            } catch {
                envelope = ["id": id, "ok": false, "error": ["code": "DriverError", "message": error.localizedDescription, "delivery": "notDispatched"]]
            }
            if let data = try? JSONSerialization.data(withJSONObject: envelope, options: [.sortedKeys]), let output = String(data: data, encoding: .utf8) {
                print(output); fflush(stdout)
            }
        }
    }
}
