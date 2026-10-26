# Reusable CU workflows (experimental)

Enable the MCP surface with `CU_WORKFLOWS=1 cu mcp`. Direct `cu workflow` commands
are an explicit opt-in. Existing primitive commands remain available. Workflows
are experimental until the cross-platform end-to-end release benchmark passes;
the browser observation microbenchmark is not that release benchmark.

The existing authenticated host agent creates workflows. CU does not require a
second model key. Ask it to call `desktop_workflow` with `operation: "schema"`,
explore the task using ordinary tools, then register the resulting definition.
Always select the actual `pageId` from this session's browser or a native app and
window. Native Mac execution uses the existing AX driver. Linux semantics require
AT-SPI; raw/vision primitives remain the fallback when a control is unsupported.

## Definition

Definitions are declarative JSON, version 1, with a stable id, description, effect,
app/site scope, string inputs, named string outputs, and bounded steps. There is
no arbitrary JavaScript or shell evaluator. Text can be literal, a caller input,
or `{"parts":[{"literal":"Saved: "},{"input":"name"}]}`. The last step must
assert the requested outcome. A target's name must match exactly unless it
explicitly requests `match: "contains"`; ambiguous matches fail.

```json
{
  "version": 1,
  "id": "save-project",
  "description": "Save the requested project and verify its status",
  "scope": {"route": "native", "app": "Example App"},
  "effect": "write",
  "inputs": {"name": {"required": true, "maxLength": 100}},
  "outputs": [],
  "steps": [
    {"kind":"action","target":{"name":"Project name"},"operation":"setValue","value":{"input":"name"}},
    {"kind":"action","target":{"name":"Save project"},"operation":"press","commit":true},
    {"kind":"wait","condition":{"target":{"name":"Saved and reopened"}},"timeoutMs":5000},
    {"kind":"assert","condition":{"target":{"name":"Saved and reopened"}}}
  ]
}
```

This example assumes the app actually exposes those controls. Derive targets and
assertions from observations; do not copy example names into another application.
Browser scope is `{"route":"browser","origin":"https://example.com"}`.
Account-sensitive workflows should additionally declare `scope.account` as a
condition against current account identity. Scope is checked on each observation.
Secret fields are refused; use the host's existing credential flow outside the
saved workflow. Do not embed credentials in definitions or inputs.

Supported steps: `action`, `extract`, `wait`, `assert`, `checkpoint`, `branch` and
`repeat`. Branches contain `condition`, `then` and `otherwise`; repeats contain
`condition`, `steps` and `maxIterations`. There are at most 200 authored steps,
1,000 executed steps and five minutes per run. Conditions can check a target's
value or `absent:true`; absence is never inferred from a truncated observation.
A checkpoint returns control to the host agent rather than guessing a decision.

## Lifecycle and recovery

Use these JSON request shapes with `cu workflow --session NAME --input-json JSON`
or the `desktop_workflow` MCP tool:

- `{"operation":"register","workflow":DEFINITION}` returns a draft and its content-derived revision.
- `{"operation":"validate","id":"save-project","revision":"HASH","effect":"write","input":{"name":"Exact value"},"windowId":123}` performs the authorized task and records evidence.
- `{"operation":"find"}` lists validated revisions with their scopes and inputs.
- `{"operation":"run","id":"save-project","revision":"HASH","effect":"write","input":{"name":"Another value"},"windowId":123}` reuses one.
- `get` and `retire` accept id/revision. `receipt` accepts `runId`.

Browser invocations require `pageId`; native invocations accept `windowId`.
String input validation rejects undeclared keys and oversized values. Outputs
are currently strings; structured tables should be handled by the host or an
explicit HTTP field mapping, not inferred from a success message.

A parameterized read needs three distinct successful inputs, including a case
marked `noMatch:true` with a successful absence assertion. An input-free read
needs one verified run. A write uses its original authorized execution: validation
is a real write, not a dry run. Never repeat a production write merely to validate.

Receipts are persisted before possible write dispatch. An interrupted or failed
write blocks further writes in that scope. `reconcile` takes the original id,
revision, `runId`, input, effect and page/window binding, then checks fresh evidence
without sending input. It accepts the original final assertion or the definition's
optional `notCommitted` condition, and refuses missing/conflicting evidence. It
never turns an incomplete run into a successful output or automatically retries.

Repairs are new definitions/revisions registered by the host agent. Old revisions
remain available for inspection or retirement; the host explicitly chooses a
validated revision to roll back. `recover` accepts id/revision and removes a scope lock only when its owning PID
no longer exists; uncertain receipts still require reconciliation afterward. A
malformed lock or live/reused PID requires manual inspection. There is no automatic resume of an interrupted action sequence.

Store defaults to `~/.local/share/opcode-cu/workflows`; `CU_WORKFLOW_DIR` selects
an isolated store. Files are owner-only. Definitions, output data and receipts
can contain private application information; keep benchmark stores separate.
Traces contain stage names/durations rather than input/page text.

## Optional HTTP read acceleration

A browser read may declare `http` with a site-relative `path`, `query` values and
`fields` mapping output names to JSON property paths. The host must derive this
from observed requests. Validation still runs the UI, then compares the HTTP
outputs to it. `execution:"best"` uses HTTP only when every recorded validation
matched; otherwise execution stays on the UI. A failed HTTP read falls back to
the UI. `execution:"ui"` is the default.

HTTP is GET-only, same-origin, uses the current browser session, refuses redirects,
and limits JSON responses to 1 MiB. Writes have no HTTP implementation. These
constraints do not establish that an arbitrary GET is harmless: only register
requests within the task's authorized read scope. UI-only benchmarks explicitly
disable this route.

## Linux setup and preview

Install development packages for `atspi-2`, `gtk+-3.0`, and `json-glib-1.0`, plus
the existing X11/XTest build dependencies, before running `cu install`. On Ubuntu
these include `libatspi2.0-dev libgtk-3-dev libjson-glib-dev`. The installer does
not run sudo. Helpers are optional for raw installs; the source build accepts
`--require-desktop-features` to require all of them.

Start isolated tests in a D-Bus session and X11 display. AT-SPI uses the selected
app PID and an unambiguous window title, retains current accessible objects and
revalidates before dispatch. Unsupported actions fail instead of falling back to
another control. `CU_ACCESSIBILITY=off` explicitly selects the existing visual path.
Shared-broker displays still refuse the legacy input path: this release does not
bypass a broker lease to send semantic input.

Linux now has a local image preview with drag/cancel, in addition to the web viewer.
It is displayed on the controlled Linux display, not automatically on a remote
user's Mac. The Mac popup remains unchanged. `--no-preview` suppresses either.
Only the selected application window is captured for this popup; it does not
record the preview recursively. An acknowledged hide/restore exchange excludes
the popup during captures; failed acknowledgement closes only the popup.
Preview frames are coalesced and cannot authorize
input. Cancel pauses further input and cannot undo an already delivered action.
