# Current reliability status — native background execution

The sections below this status are historical checkpoints, not current coverage counts.

- 42 automated tests and TypeScript checking passed for the current reliability batch.
- The Swift driver compiles on the user's Mac. Background pointer and exact-field
  keyboard delivery passed a controlled two-window native fixture.
- A complete native terminal smoke run opened a panel, typed the allowed echo
  command, pressed Enter, checked actual shell stdout in both AX and independent
  app state, and closed the panel. Foreground app and cursor stayed unchanged.
- Repeated terminal smoke tests subsequently failed at window discovery. The full
  Codex/MCP fixture session also failed before dispatch for the same reason.
  Consistent native acceptance and integrated agent success are **not established**.
- The first actual Zuse Codex session reported its local computer unavailable and
  could not open a new terminal. It sent no shell command and closed no existing
  terminal. The browser probe was closed at the user's request; testing is native only.
- A second actual Zuse run observed 455 nodes without truncation. Jev selected
  “New tab in this chat” at 0.97 confidence; one semantic press and one background
  click were acknowledged but no menu or new terminal appeared in fresh reads.
  Nine MCP calls completed (seven read-only, two dispatches); no keyboard input,
  shell execution, or terminal closure occurred. This remains a blocked test.
- Exact window selection, fresh refs, unknown-delivery handling, focused-field
  guards, and exact-line output verification have automated regression coverage.

## CLI/MCP update

- Type checking, build, and all 16 tests pass. Four new tests cover bounded dispatch, no-match/preview, cancellation/concurrency, and observation failure without replay.
- An actual MCP SDK stdio client completed initialization, listed all four tools, and verified unknown-tool rejection.
- CLI help runs successfully. CLI/MCP imports no Claude planner and requires no Claude/OpenAI credentials.
- Live TypeSafe selection has not been tested with a real API key. The new CLI wrapper has not yet been run on the Mac; prior native Mac results below still apply to its unchanged driver.

# Beta validation

2026-09-17. Larger implementation batch, followed by consolidated checks.

- TypeScript check and application build pass with Bun.
- Twelve passing automated tests cover invalid targets, protected fields, visual-evidence requirements,
  browser URL restrictions, cancellation, late model replies, uncertain mutation outcomes,
  semantic completion verification, and no-capture operation.
- Effect process tests verify repeated NDJSON requests, structured errors, and immediate
  failure of pending requests when the helper dies.
- Real headless Chrome test fills and submits a local form, observes the result, and
  verifies stale DOM references are rejected.
- The actual Electron renderer launches in the Linux test environment. Its preload IPC
  works; missing native-driver and missing-model-credential states display correctly.
- On the user's Apple Silicon Mac (macOS 26.6.2), the Swift driver compiles and the
  Calculator smoke test passes: All Clear -> 6 -> Multiply -> 7 -> Equals, fresh AX
  readback is 42, and an old snapshot's action is rejected.
- The native action test ran with Accessibility enabled and Screen Recording disabled.
- Initial AX window discovery timed out. The driver now preserves AX errors and retries
  transient observation failures, rather than reporting every failure as an empty window.

Not yet validated: live Jev/Claude requests and integrated model-driven completion,
optional screenshot capture/pixel control, TextEdit/Finder task reliability, packaged
Electron permission attribution, signed distribution, or Linux native automation.
These require credentials, explicit optional capture permission, or further Mac acceptance
tests. The Calculator test drives the native protocol deterministically; it is not evidence
of model decision quality.

## AX action timeout and feedback fix

Reproduced the exact -25204 error using a native NSButton whose AX callback takes 400 ms. Traversal set 150 ms on the saved AX object, and dispatch inherited it. Setting a separate 3-second action timeout made the same fixture pass with pointer animation enabled. Reproduction is retained in `scripts/mac-timeout-smoke.py` and `tests/fixtures/macos/SlowButton.swift`.

Added a service regression for unknown delivery: fresh observation, no replay. The user's original target app remains unspecified, so that exact workflow is not yet verified. Calculator passed foreground/background checks before the fix; the post-fix Calculator run found no accessible window and did not dispatch. The controlled timeout fixture passed after the fix.

## Jev task mode and Granola correction

20 tests pass. Regression tests cover exact installed-app launch routing, refusal to fall back to unrelated controls for an unknown app, and fresh observation before a completion judgment. The native launch path opened Granola on the Mac and verified its process was foreground. The app now runs a bounded press loop; live Jev multi-step reliability remains unverified. Launch commands are deterministic catalog lookups, not generated shell commands.

The fixed step cap was removed at user request; task execution continues until completion, Stop, uncertainty, or no progress. Overlay regression initially found a 44×44 helper window still on screen during AppKit's implicit dismissal animation. Disabling NSPanel animationBehavior removes the dependency on a continuously pumped app event loop.

## Granola renderer accessibility

Read-only native reproduction initially returned 13 nodes, zero AXWebAreas, and one named window-management press target. Added AXManualAccessibility activation (legacy fallback restricted to Electron), a bounded wait for windows to return while the renderer rebuilds its AX tree, and traversal depth 40 instead of 14. Native validation then exposed one AXWebArea and 32 named press targets. The observation hits the existing 350-node cap, so it is still partial; this is not an end-to-end task success claim. A reusable count-only check is in `scripts/mac-observation-smoke.py`. No screenshot permission or model request was used for this validation.

## Persistent settings, permission feedback, and task text entry

25 tests pass, plus type checking and build. Tests cover settings read across fresh store instances, atomic replacement, 0600 file/0700 directory modes, blank-key rejection, forgetting keys, malformed settings, exact recipient text dispatch, and rejection of text not supplied by the caller. Browser UI checks with a mocked desktop API verified checked/disabled permission buttons, saved/ready status, clearing the key input after save, and Forget visibility. Screenshot `.context/settings-check.png` is a simulated UI check, not evidence of real Mac permission grants. No live Granola sharing action was performed; end-to-end task reliability is still unverified.

## Live low-confidence diagnosis and Search recovery

Used the saved TypeSafe key locally; no credentials were printed. The original read-only Granola home-screen decision selected press/none with combined confidence 0.37. Compact state and clearer next-step instructions increased operation confidence above 0.90, but target selection still confused upcoming events with notes. Added correct text-only card labels, scoped heading/date context, and removal of equivalent/empty click wrappers. Confidence threshold remains 0.60.

For an explicit latest/newest subject in a notes/documents/files/reports request, low-confidence selection can now open a uniquely labelled Search button and enter the exact subject from the user's goal into a uniquely labelled search field. This recovery runs once per task and never retries unknown delivery. Live test allowed only Search and text `daily`: after those two actions, Jev selected the actual `Legion Equity Daily, Sep 16` search result at 0.98 confidence. The diagnostic executor refused the subsequent note-open action, so no note was opened or shared. Full sharing completion remains unverified.

## Note-view sharing ambiguity

Read-only live checks confirmed the correct note title but Jev still preferred a sidebar record at low target confidence. Editor-content clicks are now excluded; long editable bodies are omitted from sharing decision state while short title textareas remain. Actual Granola exposes two distinct Share popups on one row (28×28 icon and 73×28 labelled control), not duplicate references. Added a deterministic recovery only when the observed title matches task history: resolve a unique Share popup, or the wider target of an adjacent same-label icon/text pair. Geometry and title-match tests pass; read-only Mac validation resolved the expected Share popup. The popup was not pressed during this diagnostic and recipient selection/sharing completion is not verified.

## Cua-inspired native reliability batch

48 tests, type checking, and build pass after this batch.

- Added bounded decision history (no task step cap), caller-provided fresh-ref
  shortlists, full provider distributions, phase timings, and explicit output
  postconditions that distinguish preexisting evidence and exclude editable fields.
- Native traversal now detects AX attribute errors and marks partial observations;
  hash collisions no longer silently omit distinct elements. Native metadata
  includes WindowServer visibility; off-screen pointer delivery refuses explicitly.
- Corrected the disposable terminal fixture lifecycle to accessory mode. Its full
  Codex/Jev/MCP/native run passed all six steps. Independent app state confirmed
  `opened:false`, command `echo JEV_TEST_BACKGROUND_917`, and matching shell stdout.
  This establishes fixture integration, not arbitrary-app reliability.
- Native Electron fixture AXPress passed exactly once with changed AX readback,
  unchanged foreground/cursor, and zero physical mouse movements. The same fixture's
  background pointer route failed; the Chromium primer is not a proven fix.
- Zuse window 82924 was independently reported off-screen by WindowServer. The
  latest actual app run remained blocked creating a terminal. No command was typed
  and no existing terminal was closed. No browser route was used.
- A terminal smoke run verified real shell output with unchanged foreground, but
  cursor equality was inconclusive because 33 hardware mouse moves occurred.
  An earlier keyboard regression failed its input-state assertion; its delivery
  checks passed, but that run does not prove non-interference.


## CLI-first harness integration

52 tests, type checking, and build pass. Added connect/config commands for Codex
and Claude, doctor, automatic saved-file credentials, persistent JSONL sessions,
MCP startup instructions, and exact installed-app discovery/background launch.
Registration arguments were checked against both installed Mac CLIs; user MCP
configuration was not modified during validation.

An actual MCP SDK client on the Mac initialized the final server, received its
harness instructions, listed all 12 tools, and verified Accessibility enabled
and the saved TypeSafe key loaded without passing it in the transport environment.
Screen Recording remained disabled. No new provider latency benchmark or real
cross-app workflow completion is claimed.


## Direct existing-harness skill

53 tests and type checking pass. The skill validator passes. Installed the direct
shell-call skill for Codex and Claude on the Mac without MCP registration.
Verified saved-key/native status through the installed launcher. Two separate CLI
processes observed real Zuse and previewed an exact ref from the same retained
snapshot; no action was dispatched, no MCP was used, and no nested agent ran.
The full direct-CLI fixture test stopped before its first action because the
fixture was foreground (`UserActiveInTarget`); that run is not an end-to-end pass.
The earlier full MCP/native terminal acceptance remains a separate result.


## Hybrid visual observation and preview workspace (current batch)

- 64 tests, TypeScript check, and build passed after initial integration. New tests
  cover fresh visual generations, coordinate translation, AX preference, secure
  fields, malformed/low-confidence regions, denied-capture fallback, and a visual
  task that re-observes before completion. These are integration fixtures, not a
  live Jev model or Mac input success claim.
- Pinned OmniParser v2 weights passed SHA-256 validation and exported successfully
  to a Vision/NMS CoreML package using Ultralytics 8.3.78/coremltools 8.2. Export
  output is `.context/vision/model.mlpackage` (not committed).
- Actual PyTorch CPU inference on the three supplied TipTour screenshots returned
  55, 39, and 19 regions at confidence >=0.35, 640px input; reported inference times
  were 145, 153, and 134ms. This does not measure CoreML/Mac latency or icon semantics.
- Renderer QA with a mocked DesktopAPI verified semantic preview layout, action
  pointer coordinates, marker cleanup on Stop, and re-enabled task controls.
  axe reported zero violations (one decorative glyph contrast check incomplete).
  `.context/jev-workspace.png` is a UI fixture screenshot, not a live Zuse run.
- The native compile request through RunLocalCommand timed out waiting for the Mac
  client. Swift/CoreML compilation, real Apple OCR, target-window capture, native
  visual-click delivery, and the Electron popout window on macOS remain unverified.
  `scripts/vision-smoke.py` is ready for offline Mac acceptance without live input.
- No isolated macOS login/VM was provisioned. Same-desktop background guards remain.
  Apple developer setup was paused; this batch did not complete its outstanding forms.

Final cloud checks for this batch: 66 tests pass; type check and build pass. The
real Electron 44 app launched under Xvfb, created a separate preview BrowserWindow,
and exposed the expected preload API. A dummy (noncredential) key was saved, the
entire app exited and restarted, and the key remained configured while the renderer
input stayed empty. Forget then removed it. This caught a destroyed-window IPC
validation race, fixed before the second launch. These checks validate Electron
on Linux, not macOS capture permissions or native input.

## Visual refusal recovery

A native `StaleTarget`/`VisualTargetChanged` refusal with explicit `notDispatched`
now refreshes perception and asks for a new decision (at most two consecutive
recovery refreshes). It never reuses the old visual ref. Unknown delivery still
stops without another decision. Stop during perception is checked before selection,
including when capture fallback would otherwise swallow an abort. Eleven vision
tests pass, including these three cases; type check and build pass.

A subsequent read-only Mac build-status request also timed out waiting for the
client. It provided no evidence that either earlier build ran or finished.

## Mac resumed: real native hybrid vision acceptance

Native Swift compilation succeeded on the arm64 Mac. The pinned CoreML UI model
was exported on the Mac and installed in the default Application Support path.
Offline native Apple OCR found 56 regions in a supplied screenshot (528 ms).
YOLO+OCR returned 73 regions with no warning (1837 ms initial load). The native
OCR overlay was inspected and matched the source image orientation and text boxes.

Live testing uncovered and fixed stale app inventory: the persistent driver could
not see a newly launched fixture while a fresh driver could. Moving blocking stdin
reads off the main actor allowed NSWorkspace lifecycle updates; the corrected
persistent driver discovered subsequent disposable fixture launches.

Capture permission depends on the responsible host. The shell-launched driver
reported false while the Electron app launched through Launch Services reported
true. The Mac `desktop` command now launches the app bundle through `open`.

The first visual run clicked correctly but rejected completion. Read-only Jev
comparison on fixture evidence returned revised Noul scores 0.03 before, 0.91 after,
and 0.04 with the success label removed. Completion now requires agreement from
both the done-operation confidence and fresh-outcome probability at >=0.90; this is
a provisional gate matching the planner route, not a calibrated general accuracy
claim. Input authorization/selection thresholds were not changed.

Final real Electron/Jev/CoreML/native run using an inaccessible canvas fixture:
- `starting → selecting → acting → selecting → succeeded`
- Independent fixture counter: exactly 1 click.
- Fresh visual readback: `VISION TEST PASSED`, `Clicks: 1`.
- Foreground PID remained 90636; cursor position unchanged; 0 hardware mouse moves.
- Initial perception: 1680 ms; follow-up: 114 ms.
- Actual Mac popout showed the completed image; pointer and ripple were hidden.
- A prior run had a foreground change without enough PID evidence to attribute it;
  the subsequent controlled runs recorded unchanged foreground and cursor.

70 cloud tests, type checking, and build passed before the final picker polish.
The replayable Mac acceptance is `scripts/mac-vision-session.mjs`; it uses Node for
Playwright because Bun's CDP WebSocket connection stalled in this environment.
`.context/jev-mac-completed.png` is an actual Electron screenshot of the test result.
This validates the disposable canvas workflow, not arbitrary-app or full lifecycle
reliability. Separate macOS user/VM isolation remains unimplemented.

Final picker QA passed after the Mac screenshot exposed a misleading default:
the picker now starts at “Choose an application,” follows the actual running
snapshot's app, locks app/mode during a task, and unlocks them on completion.
The mocked renderer check verified all four behaviors with no page errors.
