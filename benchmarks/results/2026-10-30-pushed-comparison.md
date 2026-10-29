# Pushed build: fresh workflow comparison

Measured production source: `c23bb834c76eed43fa454adadeb189d76eab2b20`. Later commits change test startup budgets and CI setup only. The frozen CLI and native helper hashes are in the adjacent JSON. This is a small interface-level pilot, not a controlled model/driver ranking.

## Browser workflows

| Task | Current completion | Strict grade | Native reference |
|---|---:|---|---|
| Create, review and reopen project | 31.824s | passed | setup unavailable |
| Triage three requests and verify | 64.930s | passed | setup unavailable |
| Read two pages and save report | 44.704s | passed | setup unavailable |

The current arm used fresh gpt-6.1-sol medium contexts, headless DOM and the frozen CLI, with 7/19/10 tool calls respectively. All exact state/write-count/reopen checks passed; no tool errors or observed non-UI task calls occurred. Timing includes fresh CLI/model initialization through grading; browser startup and reset are excluded.

The built-in native reference could observe the file manager but timed out binding its owned graphical browser, including a sequential retry after all owned headless processes were stopped. Its built-in browser provider was also unavailable and inventory was empty. No browser task started or received input. These setup outcomes have no task latency and are not task failures; older browser reference numbers are not substituted.

## Native file organization

| Interface | Outcome | Measured elapsed | Completion latency |
|---|---|---:|---:|
| Built-in native reference | passed | 87.362s | 87.362s |
| Current scoped native input | incomplete, AppClosed refusal | 4.207s | unavailable |

Each arm received six identical disposable source files and the same complete goal: two folders, six moves, two renames and one duplicate. The reference completed with 39 input actions across 19 timed tool calls. Independent tree and SHA-256 grading passed every check for all seven final files. Its recovery and reasoning remain included; setup and independent filesystem grading are excluded.

The valid current retry made its first folder rename persist using an observed click-away recovery, then refused observation of the second fresh editor surface with `AppClosed`. The file manager's PID was independently confirmed still alive; the error does not prove the application closed. All six source hashes remained intact. Foreground, Space and cursor changed during this attempt, and the cause is not established. Do not use 4.207s as completion speed, or attribute the failure solely to that environment drift.

An earlier current attempt had an invalid controller recovery call and a long inter-turn pause; it remains preserved and excluded. The retry's module alias setup mistake occurred before timing and task effects. No partial workspace was reset to hide a write.

Native strategies and orchestration differ: the reference used host-agent decisions and grouping; the current arm used a deterministic controller and contextual move commands. The reference's input-isolation invariants were not independently instrumented. One sample per interface cannot establish general speed or reliability. Neither strategy establishes raw drag support; the current raw drag regression remains unresolved.

## Validation and reproducibility

TypeScript, JavaScript/native/CLI builds, and local full tests passed: 227 passed, 3 skipped, 0 failed. Skips are two Linux-only cases on macOS and a CI-only native broker case. Fresh production-native offscreen action/isolation and child-window discovery smoke checks passed. The hosted native-helper workflow passed on the measured production source. Shared desktop CI exposed cold process startup limits; follow-up commits adjust test harness/CI budgets without changing benchmarked production code.

The exact operations fixture and goals are checked in under `benchmarks/fixtures/`. Setup-only grading verified all six browser namespaces initially failed before task execution. Raw prompts, tool traces, grader results, failed setup attempts, file hashes and cleanup evidence remain under `.context/pushed-benchmark/`. The compact structured record is the adjacent JSON. All owned browser/helper processes and the fixture server were stopped; user windows and file evidence remain preserved.
