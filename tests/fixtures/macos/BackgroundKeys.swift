import AppKit
struct DriverFailure: Error { let code: String; let message: String }
@main struct BackgroundKeysTest {
    static func main() {
        for (key, code, flags) in [("Meta+Shift+N", CGKeyCode(45), CGEventFlags([.maskCommand,.maskShift])), ("Meta+C", 8, .maskCommand), ("Meta+Alt+V", 9, [.maskCommand,.maskAlternate]), ("Control+ArrowLeft", 123, .maskControl), ("Escape", 53, [])] {
            guard let chord = BackgroundInput.keyChord(key) else { fatalError("Unsupported required chord: \(key)") }
            precondition(chord.0 == code && chord.1 == flags, key)
        }
        for key in ["Meta+Meta+C", "Bogus+C", "Meta+", "C+V", "Meta+F99", "a"] {
            precondition(BackgroundInput.keyChord(key) == nil, "Accepted malformed chord: \(key)")
        }
        print("PASS: background modifier chords and malformed input rejection")
    }
}
