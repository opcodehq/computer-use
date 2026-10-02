# Connect CU to your coding agent

Use the skill installation for driver tools inside your existing agent conversation.
Your agent owns the full workflow using its current model and login.
MCP is an optional alternative for individual tools, not a prerequisite.
For other harnesses and decision models, see [agent integrations](AGENTS.md).
Exact native tools work without a TypeSafe key; Jev is optional.
`cu task --provider NAME --model ID` runs full workflows through Vercel AI SDK;
`cu providers` lists the built-in provider routes and credential variables.

## First installation

Install an extracted standalone Mac bundle with its `install.sh`, then:

```sh
jev permission
jev setup both
jev doctor
```

Choose `codex` or `claude` instead of `both` if preferred. The binary contains the
TypeScript/Effect runtime; the bundle supplies the Swift driver. No Python, Bun,
Node, or compiler is needed on the receiving Mac. See the
[release build guide](CLI_RELEASE.md) for producing a bundle; no public download
has been published yet.

`jev auth` hides input and saves the key in the same owner-only plaintext file
used by Electron. It also supports `jev auth --stdin` for a pipe from a credential
manager. Avoid putting secrets in arguments or transcripts. An empty key is
rejected without replacing the saved key. `TYPESAFE_API_KEY` overrides the file.
The app is optional. See [settings storage](REFERENCE.md#desktop-app-settings).

Grant Accessibility to the responsible command host, then ask your existing agent
to use jev-desktop to inspect running apps without changing anything. That checks
the connection without executing a paid model request or mutating an app.

Source development is still supported with `bun run setup codex|claude|both`
(choose one), which requires Bun and Xcode Command Line Tools on the build Mac.

## Discovery and updates

Codex discovers user skills in `~/.agents/skills`; Claude Code uses
`~/.claude/skills`. These locations follow the official
[Codex skills documentation](https://developers.openai.com/codex/skills) and
[Claude Code skills documentation](https://code.claude.com/docs/en/skills).

Ask an already-running agent to read the installed `jev-desktop/SKILL.md` if it
hasn't discovered the skill yet, or start a new session. Installation supplies
both instructions and their command/recovery references.

After installing a new bundle, run `jev skill both` to refresh instructions and
the absolute CLI fallback command. This updates Jev-owned skill files. An unrelated skill
with the same name is left untouched and reported as a conflict; move or rename
that skill yourself if you want this one to occupy its path.

A packaged CLI works from any directory without a checkout. Source installations
record their runtime/checkout command; keep those paths or reinstall the skill. If
you already rebuilt and only need updated instructions, use:

```sh
jev skill both
```

No npm package or additional Electron installation is required.

## Full workflows inside the existing agent

Give the user goal to your existing coding agent. It uses a persistent
`--session NAME` (or MCP connection), chooses exact native controls, supplies
known text, and reads the fresh result of each action until the whole goal is
verified. It can change apps within the workflow by observing the new app.
No separate model, key, agent process or provider picker is needed.

`cu instructions` explains the native tools. For a harness with a custom skill
location, `cu skill generic --dir PATH` installs the same instructions and
references there, preserving unrelated existing skills.

Mac driver sessions include a local preview. Stop pauses input; observations
remain available. Resume only after the user asks, then observe before acting.
Closing the preview hides it without stopping input. Use `--no-preview` on the
first helper request or the persistent MCP command for quiet operation.

Optional `task` delegation has separate provider credentials; see
[agent integrations](AGENTS.md). It is not required for the user's existing
subscription-backed agent to use native computer tools.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Setup exits 2 | Installation succeeded but required readiness checks remain. Follow the printed fixes and rerun `jev doctor`. |
| No Mac / Linux platform | Run through the harness's existing Mac command bridge or use a local Mac harness. Installing locally in the cloud is insufficient. |
| Accessibility missing | Request it from the same command host that will run Jev; grant the host macOS identifies and restart it if requested. |
| Key missing after saving | Check the command host's user and `JEV_SETTINGS_PATH`; the app and shell must read the same settings file. |
| Capture works in Electron but fails from CLI | Screen Recording grants may differ by host. Grant the actual terminal/agent host for visual tasks. |
| Skill absent in agent | Ask it to read the installed SKILL.md or refresh the session. |
| Installed command path is missing | Reinstall the bundle and run `jev skill both`. |
| Task blocked despite working setup | Read its evidence and use the [recovery guide](../.agents/skills/jev-desktop/references/recovery.md); reinstalling is not an action-recovery strategy. |

`doctor` reports key presence, not API validity, and permission readiness, not
support for every app. It does not take a screenshot or modify an app.

## Optional MCP

For a local harness that needs named `desktop_*` tools:

```sh
jev config codex   # Preview configuration
jev connect codex  # Register with the installed Codex CLI
# Or: jev connect claude
```

Registration uses the harness's CLI and preserves existing approval settings.
Claude registration uses user scope. The generated config pins absolute paths
and contains no key. Start a new agent session to load its tools. Add
`--app 'Exact App Name'` when registering to restrict it to that app; re-register
without this option for cross-app discovery. Keep the installed bundle in place.

MCP provides individual observation/action tools; it currently does not expose a
`desktop_task` tool. Use the installed shell skill to run full workflows. You do
not need both transports. For protocol details, see the
[command reference](../.agents/skills/jev-desktop/references/commands.md#other-transports).
