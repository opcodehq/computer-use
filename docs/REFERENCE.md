# Runtime and development reference

For first-time setup, start with the [quick start](../README.md). For agent installation, see [harness setup](HARNESS_SETUP.md).

## Current boundaries

Mac Accessibility controls: press, replace value, and insert exact text where advertised.
MCP also lists windows, pins observations to a window, background-clicks exact
controls, and types/sends named keys into a proven focused editable receiver.
`desktop_wait` verifies expected output from fresh observations. Secure fields, general scrolling, and Linux native automation remain
unsupported. Local YOLO/OCR can ground visible controls missing from AX; background
pointer compatibility still varies by app. Missing controls return no-match; the coding agent can inspect and
choose an exact observed action instead of ending the whole task.

The Electron app (`bun run desktop`) defaults to Jev task mode: exact named-app launch requests use an installed-app catalog; other tasks run semantic presses without a fixed step cap with fresh observations and Jev completion judgments. TypeSafe is the only model credential for this mode. It can fill observed writable fields using exact text you provide or phrases copied from your task, then inspect recipient/search suggestions. It stops on uncertainty or unsupported steps; generated prose and general cross-app planning remain the host coding agent’s job. Supported focused-control keyboard navigation is available. The older desktop/browser planner modes still require Claude. CLI/MCP `act` remains one bounded action for the host coding agent to compose.


Submit a complete workflow in one `task` invocation. The runner keeps the original
goal and progress in memory, excludes ineffective actions in unchanged states,
and selects action and target together. Direct controls are considered before
keyboard alternatives. If foreground activity prevents dispatch, the same run
waits and resumes from fresh refs when you leave the target app; Stop cancels it.
Unknown delivery still stops rather than replaying an action. Recovery and
completion use separate evidence judgments; unresolved uncertainty can still
block a task. Progress is not restored after a process restart.

A real native workflow acceptance creates a disposable project, fills its callback,
reviews, saves, reopens, and independently checks the persisted result. Run on Mac
with the saved TypeSafe key and Accessibility enabled:

```sh
node scripts/mac-workflow-session.mjs 'Cedar Sandbox' 'https://sandbox.example.test/login/return'
```

The test uses one task invocation, no host actions during execution, and no
screenshots. Its 120-second test timeout is not a product step cap. This fixture
does not establish arbitrary website or cross-app workflow reliability.

## Development

```sh
bun run check
bun test
bun run build
```

The TypeSafe skill is installed at `.agents/skills/typesafe-ai`. Reference checkouts live in ignored `.repos/`. Native build output, dependencies, secrets, and `.context` artifacts are ignored. See `VALIDATION.md` for the distinction between automated checks, native Mac checks, and live-model testing.

## Desktop app settings

The Electron app saves your TypeSafe key as plaintext in `config/settings.json` under Electron's user-data directory (on macOS, normally `~/Library/Application Support/jev-desktop`). The config directory is mode 0700 and the file is mode 0600. It does not use Apple Keychain. Save once; later launches load it automatically. Blank key fields preserve the existing key; **Forget saved key** removes it. No saved key is returned to the renderer. Optional Claude credentials remain session-only.

Accessibility and Optional Capture buttons show checked, disabled states only when the native permission checks return true. Status refreshes on return from System Settings and periodically while the app is idle. Capture remains optional; Local vision enables it for Jev tasks.

### Sustained Mac agent testing

The local coding agent owns planning and recovery. `desktop_act` uses Jev for a
narrow semantic judgment; `desktop_execute` accepts an exact control ref and
snapshot ID from the latest observation when the host resolves an ambiguous
target. Both return fresh state for verification. No task step cap is imposed.

After building on the Mac, run a scoped session using your existing agent login:

```sh
python3 scripts/mac-agent-session.py --agent codex --app 'Zuse (Beta)' \
  --task-file tests/scenarios/zuse.md --output /tmp/jev-zuse-test-1
```

`--agent claude` is also supported when the account allows Claude Code. The
launcher reads the app's saved TypeSafe key locally and passes it in the child
environment; credentials are never written to the MCP config. Each output
directory must be new. It contains the task, process ID, and private JSONL tool
trace; Codex also writes `report.md`. Stop the session with `kill -TERM <pid>`
using the PID printed by the launcher. No global agent config is modified.
The scenario allows disposable local test items, not sending, publishing,
launching agents, changing credentials, or creating cloud compute.

The Swift driver supports apps whose `AXWindows` list is empty but whose focused
or main AX window is valid (including Zuse Beta). The live regression check is:

```sh
python3 scripts/mac-observation-smoke.py --app 'Zuse (Beta)'
```

**Concurrent work:** the driver and test launcher now default to background-only
semantic input. Global pointer/key routes refuse rather than stealing focus. `desktop_click`
uses our experimental exact-window background pointer route; native button
delivery has passed controlled native tests, while Zuse compatibility and intermittent
fixture window discovery remain unresolved. `desktop_type` and `desktop_key` require
an exact focused editable receiver; they never fall back to global input.
Cursor animation is suppressed in this mode. This is not complete app-state
isolation: see [BACKGROUND_EXECUTION.md](../BACKGROUND_EXECUTION.md) before running
end-to-end tasks while using the same app yourself. A separate agent cursor is a
visualization, not another independent macOS input session.

### Native decision and verification diagnostics

A persistent MCP session now retains the last 20 compact action/outcome events
for Jev, scoped to the observed app/window/title. This is a context bound, not a
step limit. Dispatch still never automatically repeats an uncertain action.

To narrow a decision, call `desktop_observe`, then pass its `snapshotId` and a
`candidateRefs` shortlist to `desktop_act`. Stale/unsupported refs fail before
inference. Jev still has an abstain option and the existing confidence threshold.
Results retain the provider's probability distribution, candidate count, and
separate observation, selection, dispatch, and total timings.

Action tools accept `expectedOutput`: an exact line to check in non-editable
`AXStaticText` after dispatch, with up to one second of read-only settling.
`verification.status` reports observed/notObserved/unknown separately from delivery.
`alreadyPresent` identifies output that predates the action. This is fresh AX
evidence, not an independent application oracle or proof that the action caused
that output. `desktop_wait` supports `outputOnly: true` for longer explicit waits.

Native snapshots expose `windowOnScreen` and `observationErrors`. Unexpected AX
attribute-read errors mark the tree partial. Off-screen background pointer requests
return `WindowOffScreen` without input or a Space switch. Accessory apps are now
included in discovery. Electron pointer transport remains experimental; semantic
AXPress is the preferred supported route.


## Hybrid vision and the computer workspace

See [VISION.md](../VISION.md) for the pinned YOLO/CoreML export, licensing, local OCR,
fresh visual references, and screenshot access for the existing host harness.
The Electron panel now includes a dedicated computer preview, floating preview,
optional detection boxes, animated action cursor, and a semantic-layout fallback.
The virtual pointer never moves the hardware mouse. Stop/completion clears it.

Enable **Local vision** for Jev tasks after granting optional capture. Without a
CoreML detector, OCR works alone with an explicit status message. Detected labels
and controls go to Jev; pixels stay local. `capture` lets the host coding agent
inspect a screenshot when an unlabeled icon needs actual visual understanding.

The preview shows the selected Mac window; it is not a separate OS login/VM.
Background delivery still yields to your activity in the target app. Native compilation, local CoreML/OCR, and a complete disposable canvas click task
have passed on the Mac, including unchanged foreground and hardware cursor. See
[VALIDATION.md](../VALIDATION.md) for the measured scope and remaining limitations.


On macOS, `bun run desktop` uses Launch Services so capture permission belongs to
the Electron app. Quit an existing instance after rebuilding before reopening it.
CLI hosts have their own macOS capture grant; enabling capture in Electron does not
necessarily enable capture for a terminal or Conductor command host.
