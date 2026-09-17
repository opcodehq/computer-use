# Jev Desktop

A Mac computer-use CLI and MCP server for Claude Code, Codex, and other coding agents. The coding agent plans; Jev selects actions from live Accessibility controls and optional local YOLO/OCR regions; our Swift driver executes it. Effect manages the driver process and request lifecycle. Bun is the package manager and CLI runtime.

**Only a TypeSafe API key is needed for Jev tasks.** No extra Claude/OpenAI API key or model ID. Read-only tools need no model credentials. Accessibility is required for controls; Screen Recording is not needed for this core path. No screenshots are sent to Jev.

## Run on your Mac

Requires macOS 14+, Bun, and Xcode Command Line Tools.

```sh
bun install --frozen-lockfile
bun run build:native
bun run build
bun start permission
bun start status
bun start apps
bun start observe --app Calculator
```

Grant Accessibility to the responsible terminal/host shown by macOS, then restart the tool if needed. The CLI automatically loads the TypeSafe key saved in the app. `TYPESAFE_API_KEY` overrides it; `JEV_SETTINGS_PATH` selects another settings file. Read-only tools and exact-ref actions need no model key.

```sh
bun start act --app Calculator --instruction "Press the 7 button"
bun start act --app TextEdit --operation setValue --instruction "Replace the document text" --text "Hello from my coding agent"
# Preview the selection without executing:
bun start act --app Calculator --instruction "Press Clear" --dry-run
```

`act` returns JSON and performs at most one action; `task` runs multiple steps without a fixed cap. The caller supplies exact text; Jev selects, it does not generate document content. `act` returns `dispatchedUnverified` plus fresh state: inspect that state before deciding the next step. No-match and uncertain selections return without dispatch. The initial 0.6 confidence threshold is provisional, not an accuracy or permission guarantee.

## Use inside your current Codex or Claude session

The primary workflow is a skill calling our CLI through the coding agent's
existing shell tool. It does not launch another agent or require MCP registration.
The skill is installed on the test Mac for both Codex and Claude.

Tell your existing agent: **“Use jev-desktop to inspect Zuse and test its terminal.”**
If that already-running session hasn't discovered the new skill, tell it to read
`~/.agents/skills/jev-desktop/SKILL.md` (Codex) or
`~/.claude/skills/jev-desktop/SKILL.md` (Claude). It can use the skill immediately.

The agent calls the bundled Python launcher with a unique `--session NAME`:

```sh
python3 ~/.agents/skills/jev-desktop/scripts/jev.py observe --session my-task --app 'Zuse (Beta)'
python3 ~/.agents/skills/jev-desktop/scripts/jev.py act --session my-task --app 'Zuse (Beta)' --instruction 'Open the terminal panel'
python3 ~/.agents/skills/jev-desktop/scripts/jev.py stop --session my-task
```

Each call returns JSON. A private Unix-socket helper retains native refs and
history across separate shell calls. It starts automatically and exits on `stop`
or after 30 minutes idle. Different tasks should use different session names;
concurrent calls within a session are rejected when busy. Mutating requests are
never automatically replayed after a disconnect. A crashed helper may leave a
stale socket; use a new session name and observe again rather than replaying.

On another Mac, build this checkout and run `bun start skill codex` or
`bun start skill claude` once. Installed launchers reference this checkout, so keep
it at that location. The project also includes both agents' skill discovery paths.
For a cloud harness, execute through its Mac command bridge, not the cloud shell.

## Optional MCP integration


From this repository on the Mac being controlled:

```sh
bun start doctor
bun start connect codex
# Or connect Claude Code:
bun start connect claude
```

Start a new coding-agent session, then ask: “Use Jev Desktop to inspect Zuse and
verify the terminal workflow.” The Electron panel does not need to be running.
The harness uses its existing login and supplies planning/recovery; our tools need
no extra Claude/OpenAI API key. `connect` registers an absolute Bun/CLI path using
the agent's own MCP command. Keep this checkout at that path. Claude registration
uses user scope; Codex uses its normal MCP configuration. Existing host approval
settings remain in effect. Registration includes no secret.

`bun start config codex` or `config claude` prints the connection specification
without modifying configuration. Add `--app 'Zuse (Beta)'` to either command to
restrict the generated connection to that app. Reconnect without this option for
cross-app work. Default delivery is background-only.

The server provides startup instructions to the harness, keeps one native helper
alive, and exposes status, running/installed app discovery, launch, windows,
observation, Jev selection, exact execution, click, type, key and wait tools.
Fresh state returned by actions avoids redundant observation calls. Exact-ref
execution skips inference when the host already knows the target. These reduce
round trips; no new end-to-end latency claim is established.

For other harnesses, `bun start session` accepts newline-delimited JSON and returns
one JSON response per request, preserving refs throughout the process:

```json
{"id":1,"method":"observe","args":{"app":"Calculator"}}
```

Use the resulting snapshot/ref in a subsequent `execute` request in the **same
process**. A new CLI invocation cannot reuse refs. Request errors do not terminate
the session. `bun start instructions` prints the harness guidance. One-shot
commands accept `--input-json '{"app":"Calculator"}'` for structured arguments.

Connection syntax is based on the installed Mac CLIs and official
[Codex MCP documentation](https://developers.openai.com/codex/mcp) and
[Claude Code MCP documentation](https://code.claude.com/docs/en/mcp).

The cloud VM cannot control your Mac through local stdio: the MCP host must run on your Mac. A remote bridge is not implemented.

## Current boundaries

Mac Accessibility controls: press, replace value, and insert exact text where advertised.
MCP also lists windows, pins observations to a window, background-clicks exact
controls, and types/sends named keys into a proven focused editable receiver.
`desktop_wait` verifies expected output from fresh observations. Secure fields, general scrolling, and Linux native automation remain
unsupported. Local YOLO/OCR can ground visible controls missing from AX; background
pointer compatibility still varies by app. Missing controls return no-match; the coding agent can inspect and
choose an exact observed action instead of ending the whole task.

The Electron app (`bun run desktop`) defaults to Jev task mode: exact named-app launch requests use an installed-app catalog; other tasks run semantic presses without a fixed step cap with fresh observations and Jev completion judgments. TypeSafe is the only model credential for this mode. It can fill observed writable fields using exact text you provide or phrases copied from your task, then inspect recipient/search suggestions. It stops on uncertainty or unsupported steps; generated prose and general cross-app planning remain the host coding agent’s job. Supported focused-control keyboard navigation is available. The older desktop/browser planner modes still require Claude. CLI/MCP `act` remains one bounded action for the host coding agent to compose.

## Development

```sh
bun run check
bun test
bun run build
```

The TypeSafe skill is installed at `.agents/skills/typesafe-ai`. Reference checkouts live in ignored `.repos/{effect,agent-desktop,cua}`. Native build output, dependencies, secrets, and `.context` artifacts are ignored. See `VALIDATION.md` for the distinction between automated checks, native Mac checks, and live-model testing.

## Desktop app settings

The Electron app saves your TypeSafe key as plaintext in `config/settings.json` under Electron's user-data directory (on macOS, normally `~/Library/Application Support/jev-desktop`). The config directory is mode 0700 and the file is mode 0600. It does not use Apple Keychain. Save once; later launches load it automatically. Blank key fields preserve the existing key; **Forget saved key** removes it. No saved key is returned to the renderer. Optional Claude credentials remain session-only.

Accessibility and Optional Capture buttons show checked, disabled states only when the native permission checks return true. Status refreshes on return from System Settings and periodically while the app is idle. Capture remains optional and is not used in Jev task mode.

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
isolation: see [BACKGROUND_EXECUTION.md](BACKGROUND_EXECUTION.md) before running
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

See [VISION.md](VISION.md) for the pinned YOLO/CoreML export, licensing, local OCR,
fresh visual references, and screenshot access for the existing host harness.
The Electron panel now includes a dedicated computer preview, floating preview,
optional detection boxes, animated action cursor, and a semantic-layout fallback.
The virtual pointer never moves the hardware mouse. Stop/completion clears it.

Enable **Local vision** for Jev tasks after granting optional capture. Without a
CoreML detector, OCR works alone with an explicit status message. Detected labels
and controls go to Jev; pixels stay local. `capture` lets the host coding agent
inspect a screenshot when an unlabeled icon needs actual visual understanding.

The preview shows the selected Mac window; it is not a separate OS login/VM.
Background delivery still yields to your activity in the target app. Native vision
compilation and live capture validation are pending Mac connectivity; see
[VALIDATION.md](VALIDATION.md) for what has actually passed.
