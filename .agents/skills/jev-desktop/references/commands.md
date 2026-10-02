# Command reference

Call `jev` directly from the current harness shell.
All commands execute on the controlled Mac. `--input-json` accepts structured
arguments; keep secrets out of command lines and transcripts.

## Persistent helper

```sh
jev apps --session task-unique-name
jev installed_apps --session task-unique-name
jev launch --session task-unique-name --app Safari
jev windows --session task-unique-name --app Safari
jev observe --session task-unique-name --app Safari
```

A private local socket helper retains fresh refs/history across these shell calls.
It starts automatically and stops after 30 minutes idle or `stop --session NAME`.
Refs expire when the helper restarts. A one-shot CLI invocation cannot reuse refs
from another invocation. Concurrent requests to one helper are rejected; avoid
concurrent desktop operations across all helpers and tasks as well.

## Recovery actions

`act` selects at most one action; reserve it for a local recovery, not routine
workflow orchestration. For an unambiguous current target, `execute` skips Jev:

```sh
jev execute --session task-unique-name \
  --input-json '{"app":"Safari","snapshotId":"LATEST_ID","ref":"LATEST_REF","operation":"press"}'
```

Copy real snapshot IDs and refs from the latest response in the same session.
Action results include fresh state. `act` can receive `candidateRefs` plus
`snapshotId` to narrow selection. `act --dry-run` selects without dispatching.

Additional structured commands:

| Command | Arguments / purpose |
| --- | --- |
| `observe` | `app`, optional `windowId`, `nodeLimit` (100–2500), `visual` |
| `act` | `app`, `instruction`, optional `operation`, exact `text`, `candidateRefs`, `snapshotId` |
| `execute` | `app`, `snapshotId`, `ref`, advertised `operation`, exact `text` if required |
| `type` | `app`, `snapshotId`, focused editable `ref`, exact `text` |
| `key` | `app`, `snapshotId`, focused editable `ref`, named `key`, e.g. `Enter` |
| `click` | `app`, `snapshotId`, current `ref`; experimental background pointer route |
| `wait` | `app`, `waitText`, `outputOnly:true`, optional `timeoutMs`, `match` |

Use `expectedOutput` on actions or `wait` with `outputOnly:true` for terminal
verification. Preexisting output and editable-field echoes do not prove execution.

## Visual ambiguity

`observe --visual` adds local OCR and optional YOLO regions; without weights it
reports OCR-only fallback. `task --visual` enables this for the workflow. Capture
permission belongs to the command host. For an unlabeled icon, inspect one fresh
image using the existing harness's vision:

```sh
jev capture --session task-unique-name \
  --app Safari --input-json '{"outputPath":"/tmp/jev-window-unique.png"}'
```

The PNG is created on the Mac with owner-only permissions and must be a new path.
Use your Mac bridge's image retrieval if the harness is remote. A local detector
locates regions; it does not explain icons. `detect_image` is offline analysis,
not an actionable live ref. Never derive a click from an expired image/ref.

## Other transports

`session` provides newline-delimited JSON on stdin/stdout, preserving refs in one
process: `{"id":1,"method":"observe","args":{"app":"Safari"}}`.
Replies retain `id` and an `ok` flag. MCP exposes the individual `desktop_*` tools;
it currently has no full-workflow `desktop_task` tool. Use this skill's `task`
command for that loop. These are alternative transports, not required setup steps.

## Session pause and resume

`cu pause --session NAME` cancels current input and pauses the connection. It also
accepts pause requests while another command is pending. Read-only observations
remain available. Resume only after the user asks: `cu resume --session NAME`,
then obtain a fresh observation before executing another action. MCP equivalents
are `desktop_pause` and `desktop_resume`. `cu stop --session NAME` closes an idle
helper entirely. Mac helper and MCP sessions include a local preview by default;
`--no-preview` on the first helper call or on `cu mcp` suppresses it.

Exact CLI actions accept `--snapshot-id`, `--ref`, `--operation`, `--text`, and
`--key` directly. `--input-json` remains available for richer arguments. These
commands use the host agent's decisions and make no model API calls.
