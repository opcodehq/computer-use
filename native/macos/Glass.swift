import AppKit

// Native Liquid Glass on macOS 26; older SDKs and systems fall back to a HUD material.
func glassSurface(_ content: NSView, cornerRadius: CGFloat, clear: Bool = false, tint: NSColor? = nil) -> NSView {
    #if compiler(>=6.2)
    if #available(macOS 26.0, *) {
        let glass = NSGlassEffectView()
        glass.cornerRadius = cornerRadius
        glass.style = clear ? .clear : .regular
        glass.tintColor = tint
        glass.contentView = content
        return glass
    }
    #endif
    let blur = NSVisualEffectView()
    blur.material = .hudWindow; blur.blendingMode = .withinWindow; blur.state = .active
    blur.wantsLayer = true
    blur.layer?.backgroundColor = tint?.withAlphaComponent(0.85).cgColor
    blur.layer?.cornerRadius = cornerRadius; blur.layer?.cornerCurve = .continuous; blur.layer?.masksToBounds = true
    content.translatesAutoresizingMaskIntoConstraints = false
    blur.addSubview(content)
    NSLayoutConstraint.activate([
        content.topAnchor.constraint(equalTo: blur.topAnchor), content.bottomAnchor.constraint(equalTo: blur.bottomAnchor),
        content.leadingAnchor.constraint(equalTo: blur.leadingAnchor), content.trailingAnchor.constraint(equalTo: blur.trailingAnchor)
    ])
    return blur
}
