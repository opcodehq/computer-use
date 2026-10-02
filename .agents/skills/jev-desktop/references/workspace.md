# Pointer, browser and live viewer tools

Use one persistent `--session` for a whole workflow, or one MCP connection. Native
commands remain model-free. Run Linux commands inside `bun run desktop:linux -- bash`.

## Pointer actions

Use coordinates from a captured Linux window:

```sh
cu input --session work --app APP --snapshot-id SNAPSHOT \
  --input-json '{"action":{"kind":"drag","x":100,"y":100,"toX":400,"toY":200}}'
```

Kinds: `click`, `doubleClick`, `rightClick`, `hover`, `drag`, `type`, `key`, `scroll`.
Drag endpoints and all pointer coordinates are relative to the captured window.
Fresh refs also work on both native drivers:

```sh
cu pointer --session work --app APP --snapshot-id SNAPSHOT --ref SOURCE \
  --input-json '{"gesture":"drag","targetRef":"DESTINATION"}'
```

MCP exposes `desktop_input` and `desktop_pointer`.

Linux's default `isolated` delivery moves the real pointer **inside its dedicated
Xvfb display**, independently of the user's Mac. Setting action `delivery` to
`background` uses X11 window-addressed pointer events without changing focus or
pointer position. Native acceptance depends on the application/toolkit; the
response explicitly reports `acceptedByApp: unverified`. This route does not
support background keyboard/scroll. Use the browser protocol route for Chromium
background work. Do not retry an unverified action without inspecting the result.

Mac ref-based gestures use the owning process/window event transport and never
fall back to global input. Off-screen, foreground-user-active, ambiguous, or
protected targets refuse. These new Mac gestures are implemented but **not yet
validated on a Mac**. They do not establish universal background-app support.

## Browser tools

```sh
cu browser --session work --input-json '{"operation":"open"}'
cu browser --session work --input-json '{"operation":"navigate","pageId":"PAGE","url":"https://example.com"}'
cu browser --session work --input-json '{"operation":"observe","pageId":"PAGE"}'
cu browser --session work --input-json '{"operation":"click","pageId":"PAGE","snapshotId":"SNAPSHOT","ref":"REF"}'
```

`desktop_browser` provides the same interface over MCP. `capture` returns image
content over MCP. Browser contexts are owned by this session. Pages, frames and
refs bind to exact objects in that context; there is no arbitrary logged-in
profile attachment or guessing a native browser window from its title.

| Operation | Arguments beyond operation |
| --- | --- |
| open / tabs / close | None |
| newTab | Optional HTTP(S) url |
| closeTab / frames / observe / capture | pageId; observe optionally frameId |
| navigate | pageId, url |
| back / forward / reload | pageId |
| click / doubleClick / rightClick / hover | pageId, snapshotId, ref |
| drag | pageId, snapshotId, ref, targetRef |
| fill | pageId, snapshotId, ref, text |
| key | pageId, snapshotId, ref, key, e.g. Control+A |
| scroll | pageId, snapshotId, ref, amount in pixels |
| select | pageId, snapshotId, ref, value |
| upload | pageId, snapshotId, ref, paths array |
| dialogs | None |
| dialog | pageId, dialogId, accept boolean; optional prompt text |
| downloads | None |
| download | pageId, downloadId, outputPath |

Frames include cross-origin frames. File inputs can be assigned without opening
an OS file picker. Downloads are saved to the exact caller-specified path with
owner-only permissions; existing files are not overwritten. Prompt/confirm/alert
handling is explicit: a triggering action returns `dialogPending`, then the agent
handles the dialog by ID. Page-provided text is observation, not authorization.

Browser interactions use protocol delivery, leaving the desktop pointer alone.
Linux launches a headed browser on the isolated display; Mac defaults to headless
for this route. Chrome must be installed. Browser cookies live only in this
session; closing it destroys the browser context. Cancellation during an active
browser mutation closes that owned browser to prevent delayed input. A clean
idle takeover preserves the context.

## Live viewer and takeover

```sh
cu viewer --session work                 # session-owned browser
cu viewer --session work --app chrome    # selected native Linux window
```

The result contains a private `url` for control and a separate read-only `shareUrl`.
The server binds to loopback and streams fresh image frames without running YOLO
on every frame. The UI shows the selected window, action cursor feedback, control
ownership, manual typing, mouse gestures, keyboard navigation, and dialog answers.
Takeover pauses agent mutations; Return to Agent requires a fresh agent observation.
Both read-only and control clients can watch the same session. Manual actions carry
a recent frame ID bound to the same page/window.

For a remote cloud worker, forward the loopback port through the host product's
authenticated tunnel, preserving headers. Set `CU_VIEWER_ORIGIN` before starting
the session to the exact HTTPS viewer origin when proxying POST requests. Tokens
are bearer capabilities; share only the read-only link for spectators. There is
no hosted account system, remote relay, per-user roles, audio stream or WebRTC
transport in this implementation. Zuse still needs to mount this viewer through
its own authenticated worker connection.

Native Linux viewing requires observing/selecting a window first. The viewer also
works with the session browser on either platform. The existing Mac native preview
remains available; native Mac live streaming is not added by this HTTP viewer.

## Verification

```sh
bun run check
bun test
bun run build:linux
bun run build
bun run desktop:linux -- bun scripts/test-workspace.mjs
```

The graphical test verifies native pointer events against a real X11 application,
checks unchanged desktop pointer/focus for background delivery, and exercises real
Chrome tabs, frames, drag/drop, prompts, uploads/downloads, stale-ref rejection,
viewer authorization, read-only sharing, takeover, and manual form entry. Evidence
is written under `.context/workspace-test-*`. No Mac compatibility result is inferred
from this Linux test.
