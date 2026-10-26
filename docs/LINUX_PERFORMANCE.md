# Native Linux performance work

This follow-up addresses native X11 capture and control costs identified in the
Linux performance audit. Browser DOM and workflow replay measurements are separate.

## Runtime changes

- Capture converts XImage rows in bulk. Packed 24/32-bit RGB visuals have a direct
  path; other layouts retain Xlib pixel decoding and color-mask scaling. Row pitch,
  endianness and masks are respected. Indexed/DirectColor visuals are refused
  rather than interpreted as TrueColor. No MIT-SHM dependency was added.
- The desktop broker owns one private persistent X11 helper. Binary frames carry
  request IDs, bounded UTF-8 arguments, response status and bounded payloads. Calls
  serialize with bounded queues and deadlines. A disconnected, cancelled or corrupt
  session stays fenced until broker restart. Actions are never automatically replayed.
- Full observations obtain target/display geometry, focus and pixels in one helper
  request. Input validation obtains the same RGB sampling grid and metadata without
  sending a full image or encoding PNG. Captures still detect geometry/focus changes
  during acquisition; separate X11 operations are not atomic.
- The clipboard owner remains alive to serve subsequent selection requests after
  reporting that the consumer requested text. This acknowledgement does not prove
  insertion. Unicode text is supported; clipboard contents are not preserved.
- Held native keys/buttons are released on helper termination or pipe disconnect.
  The controller's recovery journal remains authoritative after uncertain delivery.
- Legacy capture uses shared PPM validation/PNG code; its freshness comparison
  resizes raw pixels with the same Sharp filter instead of encoding and decoding
  a new PNG. Its existing 180 ms post-input delay remains: no application-readiness
  guarantee has been substituted for it.
- Window activation sends the window manager an EWMH activation request. Native
  state reports the owning top-level window so a text-entry sequence can accept
  focus moves within that window and stop when focus leaves it. App discovery now
  includes Snap and XDG data directories with user/Hidden precedence.

The helper protocol is private and versioned by the installed CU build. Rebuild
native helpers with the CLI; an old helper cannot be used by the new backend. Set
`CU_X11_TRANSPORT=oneshot` only to diagnose the transport with the matching new
helper; it does not restore the old capture protocol. Stop/restart existing broker
processes explicitly to load an updated build, after releasing active control and
recordings. The source checkout's `node bin/cu.mjs` dispatches desktop-api; calling
`dist/cli.mjs` directly does not dispatch that subcommand.

## Bounded text-entry sequence

`desktop-api call --method sequence` accepts:

```json
{
  "leaseId": "CURRENT_LEASE",
  "observationId": "CURRENT_OBSERVATION",
  "field": "addressBar",
  "text": "https://example.test/",
  "submit": true,
  "finalObservation": false
}
```

`field` is `addressBar` (Control+L) or `focused` (Control+A). Only this fixed
shortcut/text/optional-Enter sequence is supported, with at most three steps and
a ten-second dispatch deadline. It does not accept arbitrary coordinate batches.
The initial observation is consumed, each step rechecks authority/lease and later
steps recheck geometry and the authorized top-level window. A 50 ms dispatch pause
lets address-field focus settle; it is pacing, not proof of readiness.

The broker serializes the whole sequence through its existing input queue. Each
step retains held-input journaling. Results include per-step delivery; partial
failure includes `steps`, `failedStep` and `failedStepDelivery`. If any previous
step ran, overall delivery is `unknown`; inspect fresh state rather than replaying.
`finalObservation` requests a screenshot, not a wait for page loading. Failure of
that final capture preserves the completed-step receipt and asks for a new capture.
This first sequence implementation is Linux-only.

## Reproduce the Firefox benchmark

Build the CLI and matching native helper, then run:

```sh
bun run build
bun run build:linux
TEST_XVFB=/path/to/Xvfb TEST_FIREFOX_PATH=/path/to/firefox \
  CU_BENCH_SAMPLES=20 CU_BENCH_OUTPUT=.context/benchmark-firefox \
  node scripts/benchmark-firefox.mjs
```

The benchmark freezes CU commit `7c1a96f56ff675fff796f7df0eaa5a4bbf3ce8b3`, compiles
its original helper and desktop CLI, and compares three paths: previous primitives,
new primitives, and the fixed text-entry sequence. It creates one isolated Firefox
profile and Xvfb display, alternates arm order, and performs two local navigations
mirroring opening the console and inspecting a release. Each navigation requires
a rendered-page nonce callback, matching native Firefox title and a screenshot.
The fixture is synthetic and read-only; it contains no Google account data.

Timing includes actual CLI subprocesses and authenticated broker HTTP calls,
observations, input, local navigation readiness, independent title checks and
screenshot file writes. Setup/Firefox/broker startup is excluded. It is a native
transport benchmark, not a model-driven task-completion or stock Firefox product
benchmark. No prior assistant wall-clock conversation time is a valid baseline.
The live Play Console check is a separate single validation, not a repeated live
account performance experiment.

Raw samples contain per-operation stages, source hashes and environment details.
Only metadata/numeric samples should be published; signed-in screenshots stay local.
See [results](LINUX_PERFORMANCE_RESULTS.md).

## Validation

Run `bun run check`, `bun test` and the pixel-layout executable in
`tests/fixtures/x11-pixels.c`. `scripts/test-x11-runtime.mjs` exercises real X11
framing/sample parity, Unicode clipboard insertion, held-key release on disconnect
and refusal to replay after failure. It requires Xvfb and X11 development headers.
`scripts/test-native-workflow.mjs` covers GTK/AT-SPI, raw fallback and popup capture.
Browser tests should use a display without a registered broker, because their
independent mutation path deliberately refuses a display with an active broker.

Viewer/recording contention, MIT-SHM, Wayland, Mac live tests and complete model
latency accounting remain outside this change. No perception model was made
mandatory and no existing controller lease or freshness guard was removed.
