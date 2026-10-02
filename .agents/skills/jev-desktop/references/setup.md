# Setup and connection recovery

With the standalone CLI installed on the controlled Mac:

```sh
jev permission
jev setup both
jev doctor
```

Use `codex` or `claude` instead of `both` for one harness. The Mac bundle includes
its runtime and driver. No Python, Bun, or compiler is required to use it. A source
checkout can use `bun run setup both` with Bun and Xcode Command Line Tools.
`auth` hides input; `auth --stdin` accepts a pipe. Never paste a key into prompts.

User skill locations:

| Harness | Skill |
| --- | --- |
| Codex | `~/.agents/skills/jev-desktop/SKILL.md` |
| Claude Code | `~/.claude/skills/jev-desktop/SKILL.md` |

Read the installed skill in the current session if discovery has not refreshed;
otherwise start a new session. The installed skill records an absolute CLI command as a PATH fallback. Reinstall
the skill after moving the CLI. To update only the skill after building, use `jev skill codex|claude|both`
(select one argument, not the literal pipe-separated text).

Use `doctor` through `jev` to check the actual command
host. It prints credential source, never the credential. Exit 2 means required
setup remains; Optional Capture alone does not make it fail.

- Missing Accessibility: run `permission` through `jev`, then enable the
  responsible terminal/agent host in System Settings → Privacy & Security →
  Accessibility. Restart that host if macOS requests it and recheck.
- Optional Jev delegation only: run `jev auth`, or save it in the optional desktop app. The app
  and CLI share `~/Library/Application Support/jev-desktop/config/settings.json`.
  It is plaintext with owner-only permissions, not Apple Keychain. An environment
  key overrides the file; `JEV_SETTINGS_PATH` can select a different file.
- Missing capture: enable Screen Recording for the actual command host only when
  vision is needed. Permission granted to Electron does not necessarily cover
  the coding agent's terminal or Mac command bridge.
- Missing driver: reinstall the complete Mac bundle. For source development, run `bun run build:native` on the Mac.
- Missing CLI: reinstall the Mac bundle, then run `jev skill both` to refresh paths.
- Cloud harness: use its existing Mac command bridge. Jev provides no remote
  transport of its own. Installing a skill in Linux does not connect it to a Mac.

The Electron app can be closed after saving settings. MCP is an optional alternate
integration; the shell skill lets your existing agent complete whole workflows
using the native tools without a separate model or API key.
