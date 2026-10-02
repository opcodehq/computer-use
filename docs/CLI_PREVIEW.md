# CLI computer preview

On macOS, captured frames appear in a borderless floating panel. The panel contains
only the image: no title bar, window buttons, status text, Accessibility wireframes,
or action overlays. Drag the image to move the panel. It follows the image's aspect
ratio and stays visible across Spaces without activating the controlled app.

Use the same `--session NAME` across CLI calls to keep the preview process alive.
Browser commands supply a captured frame after each operation. Native capture and
visual inspection supply images when Screen Recording is permitted for Opcode CU
Driver. `cu task --visual` uses the existing local perception path. These are
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
