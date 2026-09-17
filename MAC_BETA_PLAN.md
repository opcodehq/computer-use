# Current product direction

The primary beta is now the TypeSafe-only CLI/MCP tool described in README.md. Claude Code or Codex owns planning. The desktop UI below is an earlier prototype, not required setup.

# Mac beta: own driver + Jev + Effect

Updated 2026-09-17. This replaces the initial Cua-only integration plan.

## Current direction

Build a small Swift macOS accessibility driver, using agent-desktop and Cua as architectural references. Own the TypeScript orchestration in Effect 4. Accessibility and browser DOM are the default observations. Optional screenshots go to a separate Claude vision model, never to Jev. Screen Recording is optional, and its permission request is separate from Accessibility.

Jev selects among grounded action candidates and judges completion from fresh textual evidence. Claude proposes next steps and generates text. The native driver, browser adapter, and application code validate targets and execute actions. No model response grants itself additional permissions.

## Implementation in this workspace

- Native Swift driver: status, separate permission requests, app discovery, bounded accessibility snapshots, snapshot-scoped references, press, writable text operations, cancellation, optional window capture, and manually approved visual clicks.
- Effect services: DesktopDriver, DecisionModel, TaskRunner; scoped process lifecycle, Schema validation, interruptible execution, and typed failures.
- Browser adapter: an isolated Chrome session, main-document DOM snapshots, reference-based clicks/fills, and HTTP(S) navigation.
- Electron UI: task entry, app selection, model settings, text observations, optional image, timeline, approval, and Stop.
- Safety/correctness boundaries: a selected native app, explicit automatic-action opt-in, manual review by default, 30-step/10-minute limits, fresh observations, and no automatic mutation retries.

This is a developer beta in progress, not a signed public distribution or a claim of universal app support. See README.md for exact commands and limitations.

## Verification approach

Use larger implementation batches followed by one consolidated check, as requested by the user. Run typechecking, behavioral tests, and build in the cloud. Use a small Mac test after a coherent batch: compile the driver, read permissions, perform Calculator arithmetic through AX, verify the result, and reject a stale reference.

The first Mac probe compiled successfully and read Calculator controls with Accessibility enabled and Screen Recording disabled. A foreground Calculator window was needed for the tested accessibility tree. This does not establish background reliability in other applications. Live model and optional capture validation are separate checks requiring credentials and the corresponding user-granted permission.

## Next acceptance targets

1. Calculator 6 × 7, actual result 42 through AX, stale mutation refused.
2. Browser form filled through DOM, post-submit result observed, old refs rejected.
3. Late model responses cannot act after Stop; uncertain native actions never retry automatically.
4. UI handles missing credentials, missing native build, approval, and cancellation clearly.
5. Run the integrated Jev + planner loop with real API keys on the Mac, then test TextEdit and Finder-specific flows before claiming support.

## Scope boundaries

The current beta does not implement generic keyboard shortcuts, native menu traversal, arbitrary filesystem tools, cross-app autonomous plans, a Linux native driver, multi-agent fleets, signed/notarized packaging, or general canvas support. Vision may help identify a target but cannot guarantee app compatibility. Completion judged by two models is still not an independent guarantee.

A small native driver is feasible; cloning the complete behavior of the references is a separate project. The previous 1–2 agent-day target remains an aggressive planning estimate under the user's human-month conversion, not a measured delivery promise. Update it from the consolidated test results.

## References

Reference repositories live under ignored `.repos/`:

- `.repos/agent-desktop`: `7a8e4a10281c7319733aa200fd79501f34529716`
- `.repos/effect`: `3a1128c7684e04d34d9f541f77adaac38a513056`
- `.repos/cua`: `592f6ee39e1d65101b00af756cb52b6181fdbfc8` (sparse driver checkout)

[agent-desktop](https://github.com/lahfir/agent-desktop) separates semantic snapshots/actions from screenshot capture and currently has placeholder Linux adapters. Its generic permission-request command requests multiple grants, so our implementation uses separate requests. [Effect LLMS.md](https://github.com/Effect-TS/effect-smol/blob/main/LLMS.md) describes the v4 APIs used here. See EFFECT_INTEGRATION_NOTES.md for detailed source links.
