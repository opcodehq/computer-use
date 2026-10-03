# Desktop service validation

Validated locally on 2026-10-03 with Node 24.14.1, Bun 1.3.10, Linux X11,
Xvfb and Metacity. The test creates a disposable X server; Opcode attaches to it
and never creates or destroys the server itself.

| Check | Result |
| --- | --- |
| Existing display attachment, canonical display alias, duplicate broker rejection | Passed |
| Full 1280×900 display, native decorations, background, two apps and popup | Passed |
| Real Xterm launch, Unicode shell input, independent output-file verification | Passed |
| Native app Unicode paste, right-click, scrolling, cross-window drag | Passed |
| Duplicate request ID does not click twice | Passed |
| Human takeover interrupts an active drag; old lease rejected | Passed |
| Observer cannot control; expired/revoked credentials rejected | Passed |
| Lifecycle rebind invalidates old credentials | Passed |
| Installed-package viewer, observer controls hidden, takeover/return buttons, native keyboard, reload | Passed |
| Window-only capture and coordinate offsets | Passed |
| Resize request at existing size, lease invalidation | Passed; xrandr required |
| Headless recording pause/resume/stop, byte-range download | Passed |
| H.264 recording decodes with FFmpeg and plays in Chrome | Passed |
| Exact byte limit, duration limit, real encoder kill, persisted failure | Passed |
| Minimal npm install, Node-only native build, no model packages | Passed |
| Packed CLI and two MCP clients, actual image response, one controller | Passed |
| Broker shutdown preserves the attached X server | Passed |
| Repository tests | 149 passed |
| Live Boat / boxd / E2B desktop | Not yet tested |
| Provider-specific resolution changes | Not yet tested |

One local run measured first viewer frame at 113 ms, takeover at 14 ms, and
raw capture at 50–70 ms over ten samples. These are smoke-test timings, not a
cloud latency guarantee. The completed 16.4-second recording was 468,836 bytes.
The viewer polls PNG frames; it is not a high-frame-rate video transport.

Run `bun test` and `bun run check` for unit/type checks. The integration scripts
are `scripts/test-display-service.mjs`, `scripts/test-recording-failures.mjs`,
and `scripts/test-packed-desktop.mjs`. Bundle the first two with esbuild's Node
ESM mode before running with Node. They require the native helper, Xvfb, Metacity,
Xterm, Chrome and `CU_FFMPEG` pointing to an FFmpeg build with libx264.
The packed test reads `.context/core-install-path`, containing the temporary npm
installation prefix with its helper under `runtime/`.

Artifacts from local runs are kept in ignored `.context/` directories. No provider
account, production application, or user's Mac was used by these tests.

The package was also installed in Conductor's Linux workspace under
`.context/local-desktop`, using `npm install --omit=optional` and
`cu install --minimal`. The full desktop suite can select this installed build
with `CU_TEST_DESKTOP_MODULE` (absolute path to its `dist/desktop-service.mjs`)
and `CU_TEST_X11_HELPER` (installed native helper). `CU_TEST_INSTALL` selects
the same installation for the packed CLI/MCP suite. There was no live Conductor
cloud display to reuse, so the test created a disposable X11 desktop first.
This is not a test of the Conductor Mac app.
