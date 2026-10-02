# @opcodehq/cu

A native computer driver your existing coding agent calls through the CLI or MCP.
The agent keeps its own model, login, planning and conversation. CU discovers apps,
reads controls, delivers exact actions, and returns fresh observations.

**No Jev, model picker, or separate API key is required for native tools.** Your
agent's existing authentication and usage limits continue to apply. The Electron
app is optional. Direct API model delegation is an opt-in extension.

```text
Your logged-in agent → cu CLI / MCP → native Mac driver → fresh app state
```

## Use it from any agent

An agent with shell access to the controlled Mac can read `cu instructions` and
start a persistent driver session:

```sh
cu apps --session my-work
cu observe --session my-work --app Safari
cu execute --session my-work --app Safari \
  --snapshot-id CURRENT_ID --ref CURRENT_REF --operation press
cu stop --session my-work
```

The agent substitutes real IDs from observations and continues until your whole
request is verified. Action results include fresh state, so it can proceed without
asking you for each click. MCP clients can use `cu config generic` and `cu mcp`.
For an agent with a custom skill directory, run `cu skill generic --dir PATH`.

Mac driver sessions show captured frames in a borderless, draggable preview.
Use `cu pause --session my-work` to pause input and `cu stop --session my-work`
to close the session. Resume only after the user asks, then observe fresh state.
Use `--no-preview` on the first session call, or on `cu mcp`, for quiet operation.

## Install the CLI

Install the npm CLI on macOS or Linux:

```sh
npm install -g @opcodehq/cu
cu install
cu doctor
```

The npm package requires Node.js 20+ and Bun 1.3.10+. `cu install` builds the
native runtime in your user cache: macOS requires Xcode Command Line Tools;
Linux requires a C compiler, X11/XTest development headers, and Xvfb. On Mac, setup installs the Opcode helper app as the permission owner. It does
not run sudo or modify system packages. On both platforms it downloads a
checksum-verified UI detection model; see [Linux setup](docs/LINUX_CLOUD.md)
for system packages and model terms. Chrome/Chromium is required for browser tools.

For an isolated Linux desktop, start your agent with `cu desktop -- YOUR_AGENT`.
Use `cu config generic` for MCP configuration or `cu instructions` for CLI usage.
No decision-model API key is needed. The npm package installs the CLI; run the
Electron app from a source checkout during this beta.

### Standalone bundles

The standalone Mac bundle contains `jev`, the native driver, and harness skills.
Users need **no Python, Node, Bun, Xcode, or source checkout** to run that bundle.
Requires macOS 14+.

Extract the bundle matching your Mac architecture and run its installer:

```sh
sh /path/to/extracted-jev-bundle/install.sh
```

It installs under `~/.local/share/jev` and links `~/.local/bin/cu` (with `jev` as an alias). Add
`~/.local/bin` to PATH if the installer reports it missing. Then:

```sh
cu permission    # Request macOS Accessibility access
cu setup both    # Install skills for Codex and Claude Code
cu doctor        # Check this command host's readiness
```

Use `cu setup codex` or `cu setup claude` for just one harness. Accessibility
must be granted to the responsible host macOS identifies. Capture is optional.
`setup` and `doctor` exit 2 when required setup remains. Key presence is checked
locally in `jevReady`; native-tool `ready` does not require a model key. Key validity is checked on the first Jev request.

**Distribution status:** the release builder and installer are in this repository;
there is not yet a published download or Homebrew formula. To produce a Mac bundle
from source, a maintainer runs:

```sh
bun install --frozen-lockfile
bun run build:cli
```

This generates `release/jev-VERSION-darwin-ARCH.tar.gz` using Bun and Xcode Command
Line Tools on the build Mac. The extracted bundle is independent of that checkout.
For source development only, `bun run setup both` remains available.

## Use it in your current conversation

Ask your coding agent:

> Use jev-desktop to inspect my running Mac apps without changing anything.

Then give it a complete task, for example:

> Use jev-desktop to test Zuse’s terminal: open the panel, run a harmless command,
> verify its output, then close the panel. Preserve my existing work.

If the agent cannot find the skill, ask it to read its installed file:

| Agent | Installed skill |
| --- | --- |
| Codex | `~/.agents/skills/jev-desktop/SKILL.md` |
| Claude Code | `~/.claude/skills/jev-desktop/SKILL.md` |

A new session is another way to refresh discovery. The skill teaches the agent to
find or launch the right app, choose exact controls, verify results, and recover
from local blockers while retaining ownership of the full workflow. You should not have to dictate each click.

**A cloud coding workspace needs a Mac command bridge supplied by its host.**
Install and execute Jev on the Mac through that bridge. A Linux shell or cloud MCP
process alone cannot operate your Mac. Jev does not provide a remote bridge.

## Optional delegated workflows

The default workflow stays inside your existing agent. If you explicitly want a
separate decision loop, `task` supports Jev, Vercel AI SDK providers and custom
adapters. Direct API calls use provider credentials and their own billing, not
your coding-agent subscription. See [agent integrations](docs/AGENTS.md).

```sh
cu task --app Safari --instruction 'Complete the requested workflow and verify the result.'
```

A borderless, image-only preview appears on Mac when a captured frame is available.
`--visual` supplies captured frames for delegated tasks; `--no-preview` hides the
panel. See [CLI preview](docs/CLI_PREVIEW.md).

The release downloader selects the Mac architecture and verifies SHA-256 before
installation. Once release assets are published, `sh scripts/download-cli.sh`
installs the latest release and `CU_VERSION=0.1.0 sh scripts/download-cli.sh` pins
a version. `cu update` uses the same verified download path. Until publication,
use a locally built bundle; there is no working public release download yet.

## What works today

- Native Accessibility observation, supported control actions, exact text entry,
  guarded background clicks/keys, and app discovery/launch.
- Model-free exact tools and optional multi-step `task` execution with fresh observations and no fixed step cap.
- Optional local OCR/YOLO for controls missing from Accessibility; no pixels sent
  to Jev. The host agent can inspect a screenshot when needed.
- Background input that preserves your hardware cursor and yields when you use
  the target app.

This is a Mac beta, not an isolated second desktop. Off-screen windows, secure
fields, unsupported controls, and unresolved uncertainty can stop a task.
Cross-app planning, generated text, and missing account information belong to the
host coding agent. The documented fixture tests do not guarantee arbitrary
website signup or account setup. Linux native control is not implemented.

## Guides

- [Harness setup and troubleshooting](docs/HARNESS_SETUP.md) — installation,
  updating, permissions, cloud hosts, and optional MCP.
- [Task and recovery commands](.agents/skills/jev-desktop/references/commands.md) —
  complete workflows, persistent sessions, exact actions, and screenshots.
- [Runtime and development reference](docs/REFERENCE.md) — settings storage,
  diagnostics, native tests, and implementation boundaries.
- [Background execution](BACKGROUND_EXECUTION.md) · [Vision](VISION.md) ·
  [Validation evidence](VALIDATION.md)

## Development

```sh
bun install --frozen-lockfile
bun run check
bun test
bun run build
# On Mac:
bun run build:native
bun run desktop
```

Bun manages packages and runs the CLI. Effect manages native driver requests.
Reference repositories live in ignored `.repos/`; dependencies, build output,
secrets, and `.context/` artifacts are also ignored.

## Linux cloud desktops

Run a separate Xvfb desktop with local YOLO/OCR and model-free CLI/MCP input.
See [Linux cloud setup and the real desktop smoke test](docs/LINUX_CLOUD.md).

## Pointer, browser and viewer tools

Use `cu pointer` for ref-based gestures, `cu browser` for session-owned tabs, frames,
dialogs and file transfers, and `cu viewer` for a live stream with read-only sharing
and takeover. See [commands and platform limits](docs/WORKSPACE_TOOLS.md).

## Read beyond Accessibility

`cu inspect` selects native Accessibility or local vision; an explicit `pageId`
selects browser DOM. `cu browser` can attach a local CDP endpoint to read an
existing tab without native Screen Recording. The npm CLI runs on Node; Bun
remains the package manager and native setup runtime.

See [observation routes and Mac helper setup](docs/OBSERVATION_ROUTES.md) for
attachment, model installation, permission ownership, and platform limits.
