# CLI computer preview

`cu` native driver sessions and optional `cu task` delegation open a small
native floating panel on macOS. The `jev`
command is an alias. It needs neither Electron nor a web server. `--no-preview`
on the first helper call or the MCP/task command suppresses it; machine-readable task output remains on stdout and preview warnings
use stderr.

The panel shows the selected app, current state, observed controls, and a local
animated action pointer. It includes **Stop** and the standard close button:

- **Stop** cancels the current request and pauses native-session input. Read-only
  inspection remains available. After the user asks to continue, `cu resume --session NAME` or `desktop_resume` resumes the connection; observe fresh state
  before acting. In optional delegated `task` mode, Stop aborts that task.
- **Close / Hide** hides only the preview; the task continues.
- Completion clears action markers and disables Stop. The panel closes shortly
  after the task process finishes.

The panel is nonactivating. It never dispatches input into the target app or moves
the hardware cursor. It shares the user's desktop; it does not create an isolated
login, VM, or independent mouse session.

## What is displayed

The default is an **Accessibility layout**, labeled as such. No screenshots are
requested just to display this panel. `cu task --visual` can supply captured frames
as part of the existing local OCR/YOLO path. Capture permission belongs to the CLI
host. Captured frames carry their capture time; they are not a continuous video.
The panel drops an old frame when a newer observation arrives without an image.

Typed values and actionable refs are excluded from the preview's structural
payload. App labels and optional screenshots may still contain private content;
all rendering is local. Pixel data is not sent to Jev.

The existing Electron floating view follows the same compact design: one header,
a large app view, one status line, and Stop/Hide controls. The CLI uses a separate
AppKit helper so the standalone distribution does not depend on Electron.

## Validation

Linux tests cover event sanitization, retained observations for action markers,
Stop routing, absent/closed helper handling, compiled-session startup, and renderer
states. Browser fixture checks cover pointer alignment, stop/completion cleanup,
and 360×280 layout. These are not native Linux computer-use support.

The first Mac compiled task smoke test completed a five-screen disposable workflow
with preview discovery and independently persisted results. The subsequent native
pointer-invariance test was inconclusive because the hardware cursor moved during
the measurement. Mac testing was then paused at the user's request. Later native
styling and app-launch readiness changes still require Mac verification.

### Persistent CLI preview

Use the same `--session NAME` across calls to keep the panel alive between commands.
A standalone command closes its panel when the command exits. Browser-only sessions
also open the Mac panel automatically, with a local browser frame after each command.
The panel appears across Spaces without activating the target app.

To reopen a panel you hid, run `cu preview --session NAME`. This does not resume
paused input. Use `cu stop --session NAME` when finished. If the preview helper is
missing, run `cu install`. On Linux, use `cu viewer --session NAME` and open its
private viewer URL; a cloud machine cannot open a native popup on your local Mac.
