# CLI computer preview

On macOS, captured frames appear in a borderless floating panel: the image inside a
thin glass rim, crossfading between frames. Hover reveals two glass capsules, an
Opcode pill with a live dot and a × cancel button. On macOS 26 these use native
Liquid Glass; earlier systems use a HUD material.
The button cancels in-flight input, pauses the session, and hides the panel.
There is no system title bar, status text, Accessibility wireframe, or action overlay. Drag the image to move the panel. It follows the image's aspect
ratio and stays visible across Spaces without activating the controlled app.

Use the same `--session NAME` across CLI calls to keep the preview process alive.
Browser commands supply a captured frame after each operation. Native capture and
visual inspection supply images when Screen Recording is permitted for Opcode. `cu task --visual` uses the existing local perception path. These are
observation frames, not a continuous video stream. Without an image the panel stays
hidden; a new observation without an image hides the previous capture.

Session controls stay in the CLI:

- `cu pause --session NAME` pauses input.
- `cu resume --session NAME` resumes after the user requests it; observe fresh state.
- `cu stop --session NAME` ends the session and closes the preview.
- `cu preview --session NAME` restarts the preview; the next captured frame shows it.
- `--no-preview` on the first session call or MCP/task command suppresses the preview.

For a delegated task, Ctrl-C cancels the task. The panel closes when its owning
process exits. Rendering is local; captured pixels are not sent to Jev.

Run `cu install` after upgrading to rebuild the Mac preview helper. On Linux,
`cu viewer --session NAME` returns a private web viewer URL; a cloud machine cannot
open a native popup on your local Mac. The Electron app has a separate interface.

## Mac permissions

`cu permission` and `cu capture-permission` open the matching System Settings pane,
then attach a glass strip to the bottom of the Settings window, on whichever
display that window is. Drag the Opcode row from the strip into the list above it
and turn on the switch. The strip follows the Settings window, hides while that
window is on another Space or minimized, and closes after access is granted or
Settings quits. The ‹ button reopens the pane. The arrow cue respects Reduce Motion;
permission status comes from the helper, not the guide process.
If macOS requests a restart, finish active sessions and run `cu helper-restart`.

Opcode uses a monochrome “op” app mark. Its existing bundle ID and on-disk helper
path remain stable; the display name in the new bundle is Opcode. macOS may cache
the previous name until the helper restarts. Production signing requirements remain
unchanged.
