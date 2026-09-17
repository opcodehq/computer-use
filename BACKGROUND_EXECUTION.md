# Concurrent user and agent execution

The user must be able to keep working while the agent runs. Our default is
background semantic accessibility delivery, with no physical cursor movement,
window activation/raising, physical key input, or clipboard mutation. An
unsupported background action is a recoverable blocked result, never permission
to fall back to foreground input.

This preserves input ownership but does not isolate application state. Two actors
editing the same document or navigating the same window can still interfere.
The current driver cannot promise complete non-interference for arbitrary apps.

## Execution routes

| Route | User input | Application state | Intended use |
| --- | --- | --- | --- |
| Background AX on this Mac | No intentional physical input or activation | Shared with the targeted app | Supported semantic tasks in a window the user is not using |
| Dedicated browser process/profile | Independent browser input | Separate browser session; external account data can still be shared | Web app end-to-end testing |
| Separate desktop/VM running our driver | Independent desktop input and focus | Separate installed app/session; synced data may still be shared | Full arbitrary Mac app testing while the user works |

A cursor drawn by an agent is a presentation artifact. It does not create another
macOS hardware pointer or independent focus. Put that visualization inside the
agent's preview, not over the user's workspace. A second macOS Space alone does
not establish an independent input session.

## Implemented boundary

- Native Swift driver defaults to background mode. Global physical key and pixel-click routes return `BackgroundOnly`.
  An experimental `backgroundClick` route posts directly to the exact app/window.
- Semantic actions suppress cursor animation, including requests from the existing
  Electron UI. App launch does not request activation in background mode.
- `desktop_click` uses window-routed background delivery. `desktop_type` and
  `desktop_key` require a fresh exact ref to a focused, non-secure editable control;
  the native driver additionally verifies the app's focused window and receiver.
  Generic keyboard input without this proof is refused.
- Actions yield with `UserActiveInTarget` when the target app is foreground.
- The test launcher forces background mode and exposes our native MCP tools only.
- `JEV_INTERACTION_MODE=foreground` is an explicit launcher opt-in intended for
  a dedicated test desktop; it must not be enabled silently on the user's desktop.

The Zuse foreground test was stopped when the concurrency requirement was stated.
Its partial traces are diagnostic evidence, not a completed end-to-end pass.
Window-list fallback is verified; delayed Zuse AX state remains unresolved.

## Reference findings

Cua separates background/foreground input delivery and explicitly forbids an
automatic foreground fallback after background refusal:
https://github.com/trycua/cua/blob/main/libs/cua-driver/docs/native-window-sdk-migration.md

Agent Desktop describes its cursor as presentation-only; physical pointer actions
still coordinate the shared OS pointer:
https://github.com/lahfir/agent-desktop#agent-cursor-overlay-macos

These projects are references only. Our runtime uses our Swift driver, not Cua.

## Verified background pointer prototype

`native/macos/BackgroundInput.swift` dynamically resolves `SLEventPostToPid`,
`CGEventSetWindowLocation`, `SLEventSetIntegerValueField`, and
`_AXUIElementGetWindow`. It binds the live AX window to its WindowServer owner,
stamps window-local coordinates and routing fields, and posts a single
move/down/up sequence. It never posts to global HID, warps the hardware cursor,
raises a window, defocuses the front app, or silently retries through another
transport. Missing symbols produce a refusal. These are private macOS APIs;
availability and behavior require native regression testing across OS versions.

The driver retains its own virtual cursor position; a visible cursor overlay is
not implemented yet. `inputState` reports the virtual position separately from
the real cursor and foreground PID.

Native evidence on the user's Mac:

- A standard NSButton in a background disposable application fired exactly once.
- A second window in the same process received zero clicks.
- The foreground application and real cursor were unchanged immediately around
  dispatch. An earlier longer measurement included cursor movement and failed;
  narrowing measurement to dispatch produced a pass, including the NSButton run.
- No Screen Recording permission or screenshots were used.
- One Zuse Settings click preserved cursor/focus but did not verify the expected
  transition. Zuse/Chromium compatibility remains unresolved.

Run `python3 scripts/mac-background-smoke.py` on macOS for app-side click evidence
plus input-state assertions. The fixture opens two disposable windows behind the
current window and removes them at the end. Real user pointer movement during
the measurement can invalidate the cursor assertion.

Cua's `activate_without_raise` helper explicitly posts a defocus record to the
front app. We do not implement that helper: unchanged z-order is insufficient to
prove uninterrupted user input. Generic raw-key delivery remains blocked. Exact focused-field typing and named
keys use the private app-directed transport after receiver validation. Chromium
terminal canvases without an accessible editable receiver are not supported by
this path.

Reference event-field conventions: Cua's `input/mouse.rs` and `input/skylight.rs`.
The MIT notice is retained in `licenses/cua-MIT.txt`. There is no Cua runtime
or binary dependency.


## Terminal verification and current limits

`desktop_windows` exposes accessible window IDs. Observations and action readback
stay pinned to the chosen window. `desktop_wait` polls fresh observations for an
exact output line; a typed `echo MARKER` is not evidence of output `MARKER`.
Failed observations invalidate cached refs, and ambiguous dispatch is never
silently replayed. MCP errors preserve native error codes and delivery status.

`python3 scripts/mac-terminal-smoke.py` exercises Open → type → Enter → read real
shell stdout → Close in a disposable native fixture. One full run passed with
unchanged foreground app and hardware cursor. Subsequent runs failed to discover
the fixture window, including the full Codex/MCP run. This is an unresolved
intermittent failure, not a consistently passing acceptance test.

The actual Zuse test has not passed: the initial run observed an unavailable local
computer and did not create a terminal. Native app testing remains the requested
route; the separate browser probe was closed. No browser pairing is required for
our native driver. No claim of arbitrary Mac app compatibility is made.


## Latest native acceptance

The corrected accessory terminal fixture now passes the full Codex → Jev → MCP →
Swift → real shell → output verification → close sequence. Independent fixture
state confirms the command and stdout after closure. Earlier regular-app fixture
startup failures remain recorded in VALIDATION.md for context.

A disposable Electron app passes semantic AXPress with exactly one application
callback and changed AX readback, preserving foreground and cursor. Its pointer
case fails even with a Chromium primer; keep `scripts/mac-electron-smoke.py` as
an explicit failing compatibility test, with `--semantic` as the passing route.
The primer uses only app/window-directed events and does not activate or defocus.

Zuse's inspected window was off-screen according to WindowServer. The current
pointer path now refuses that condition instead of posting unverifiable input.
This does not provide separate-Space control: neither the driver nor tests switch
Spaces. Zuse terminal end-to-end acceptance remains blocked.
