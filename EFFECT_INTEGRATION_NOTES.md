# Effect integration for the Mac beta

Research snapshot: 2026-09-17. The implementation now follows these boundaries; see README.md for current behavior and validation.

Use Effect for the TypeScript agent runtime; keep macOS accessibility operations in a small native Swift helper. Effect manages that helper, model requests, task cancellation, retries, and the stream of UI events.

## Version choice

The supplied [effect-smol LLMS.md](https://github.com/Effect-TS/effect-smol/blob/main/LLMS.md) describes the Effect 4 API. Its current [effect manifest](https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/package.json) and [Node platform manifest](https://github.com/Effect-TS/effect-smol/blob/main/packages/platform-node/package.json) both declare `4.0.0-beta.98`.

Direct npm registry checks found `effect` tags `latest=3.22.2`, `beta=4.0.0-beta.107`, and `rc=4.0.0-rc.115`; `@effect/platform-node` has matching v4 prerelease tags but `latest=0.108.2`. An unqualified install therefore does not match the supplied guide.

For the first spike, pin `effect@4.0.0-beta.98` and `@effect/platform-node@4.0.0-beta.98` exactly to match the inspected source. Both are published; the Node package accepts that Effect version. Recheck release status before implementation and upgrade the pair together only against matching docs/tests. Commands used: `npm view effect dist-tags --json`, `npm view @effect/platform-node dist-tags --json`, and version-specific `npm view` checks. [Registry metadata](https://registry.npmjs.org/effect), [Node platform registry metadata](https://registry.npmjs.org/@effect%2fplatform-node).

Implementation finding: also override `@effect/platform-node-shared` to `4.0.0-beta.98`. Its permissive transitive range otherwise resolved to `4.0.0-rc.115`, causing a missing `effect/ByteSize` import. The project uses Bun and commits `bun.lock`; registry commands above record research history only.

## Small service boundary

Define services with `Context.Service`, implementations with `Layer`, operations with named `Effect.fn`, and input/output contracts with `Schema`. Define expected failures using `Schema.TaggedErrorClass`; handle them by tag. These are the conventions in the [requested guide](https://github.com/Effect-TS/effect-smol/blob/main/LLMS.md).

| Service | Beta responsibility |
| --- | --- |
| `DesktopDriver` | Helper lifecycle; capability and permission status; text accessibility snapshots; execute one typed action; cancel pending work. |
| `DecisionModel` | Jev adapter for bounded choices and verification; optional text planner adapter for open-ended decomposition and text generation. |
| `TaskRunner` | One active task; observe → choose → validate target → execute → verify; step/time budget and bounded recovery. |
| `TaskEvents` | Publish task state, selected target, action result, and stop status to the UI. |

Keep the driver protocol independent of macOS so a Linux helper can implement it later. Include `requestId`, `taskId`, snapshot generation, application identity, and element handle in action requests. Reject handles from stale snapshots. Driver-side guards must enforce cancellation and target validity even if a model response arrives late. These are project recommendations, not guarantees provided by Effect.

## Lifecycle and Stop

Create one `ManagedRuntime` in the desktop application's backend, built from the application Layer. UI handlers call into it; they do not build fresh service graphs per action. Keep the running task fiber from `runtime.runFork`, and call `runtime.dispose()` on shutdown. [ManagedRuntime source](https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/src/ManagedRuntime.ts).

Launch the Swift helper with `ChildProcess.make` and `ChildProcessSpawner`, provided by `NodeServices.layer`. Keep it in a service scope. Parse bounded newline-delimited JSON messages; keep diagnostics on stderr. A spawned process has scoped lifetime and output streams. [Official child-process example](https://github.com/Effect-TS/effect-smol/blob/main/ai-docs/src/60_child-process/10_working-with-child-processes.ts).

Stop should immediately revoke the task's permission to enqueue driver actions, then interrupt its fiber, cancel network/IPC work, and wait for helper acknowledgement. `Fiber.interrupt` waits for cleanup; interruption is cooperative. It cannot retract a click already delivered to macOS. A hung helper needs a bounded termination path, and restarting it must never replay the last action. [Fiber implementation and cancellation semantics](https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/src/Fiber.ts).

## Typed failure policy

| Failure | Behavior |
| --- | --- |
| `AccessibilityDenied` | Show permission setup and pause; no repeated polling loop. |
| `StaleTarget` | Refresh observation and reconsider once. |
| `UnsupportedSurface` | Report the limitation; allow handoff. |
| `ModelUnavailable` | Bounded backoff for inference calls. |
| `ActionOutcomeUnknown` | Re-observe; never blindly retry a click, keystroke, or submission. |
| `DriverDisconnected` | Stop the task; reconnect only for fresh observation. |

Keep user cancellation as an interrupted task outcome, separate from failures. First meaningful tests: stale handles cannot execute; a late model response cannot act after Stop; lost acknowledgements cannot duplicate actions; helper death closes pending requests. Native accessibility behavior still requires testing on a real Mac.
