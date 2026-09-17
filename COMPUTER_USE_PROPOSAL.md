# Computer-use agent proposal

Research date: 2026-09-17. Status: proposal; no application implemented yet.

Update: the immediate implementation scope and schedule are now in [MAC_BETA_PLAN.md](MAC_BETA_PLAN.md). The user wants a faster private Mac beta using standalone Cua Driver. The broader estimates below are retained as background, not the current delivery target.

## Recommended first product

Build a macOS desktop agent first, then add Linux. A user enters a task, watches execution, can pause or take over, and receives a result with evidence. Start with three workflows: gather browser information into a local CSV, organize a selected Finder folder, and move supplied data between a browser and a native app. Use a test folder and test accounts for validation.

The user selected Mac first and Linux second. Own the product UI, orchestration, decision policy, workflow library, and evaluation suite. Reuse browser/desktop drivers initially. Building a foundation model or hypervisor is outside the estimate. Local execution means actions happen on the Mac; hosted model inference still sends selected observations to an external service. Offline inference is a separate scope.

## What Cua contributes as inspiration

Cua separates computer access from the agent/model. Its current repository offers Driver (native and browser automation), Fleets (cloud desktop capacity), Lume (Apple Silicon local VMs), and Bench (tasks and evaluation). Borrow that separation and the emphasis on verified outcomes. Desktop support varies by platform and application; validate the selected driver against target apps.

Source: https://github.com/trycua/cua
Driver architecture: https://github.com/trycua/cua/blob/main/libs/cua-driver/README.md

## Jev's role

The installed TypeSafe skill is at `.agents/skills/typesafe-ai/SKILL.md`.

Jev currently accepts text/JSON, not screenshots, audio, or video, and returns typed judgments rather than generated plans or prose. Feed it the goal, current observed page state, relevant history, and candidate actions. Use:

- Choice to select a candidate action, target element, workflow, or recovery path, including no-match/escalate options.
- Noul to judge a specific condition, such as whether observed evidence supports completion.
- Score to rank candidate relevance when an ordered scale is useful.

Code enumerates candidates, validates arguments, checks permissions, and executes. A reasoning model constructs unfamiliar plans and free text; a vision model handles screens without usable semantic structure. Jev-only execution is an experiment for bounded workflows with complete candidate coverage, not an assumption of general desktop capability.

Independent questions over the same state can be batched. Reobserve before using results against a changed page. Tune thresholds on representative tasks; confidence is neither an authorization grant nor an end-to-end correctness guarantee. Keep API credentials server-side.

Sources:
- https://docs.typesafe.ai/concepts/system-one.md
- https://docs.typesafe.ai/concepts/state.md
- https://docs.typesafe.ai/cookbooks/function_calling.md
- https://docs.typesafe.ai/sdk/javascript.md

## Execution architecture

User task -> orchestrator -> observation -> candidate construction -> Jev decision -> deterministic policy checks -> executor -> fresh observation -> verification -> next step or finish.

Escalate missing candidates, ambiguous decisions, and repeated failures to the reasoning/vision model or user. Treat page content as untrusted observations; it cannot modify the user's permissions. Enforce step/time/cost budgets, cancellation, and explicit authorization for externally consequential actions. Avoid blindly retrying submissions that may already have succeeded.

Suggested implementation: TypeScript orchestration and UI inside a Mac desktop shell; a macOS driver adapter using accessibility data, screenshots, and native input; a browser adapter for semantic browser actions; TypeSafe JavaScript SDK; replaceable reasoning/vision provider; SQLite for prototype run metadata and files for artifacts. Prototype with Cua Driver's supported standalone Mac app, then validate its supported embedding path before distributing our own shell. macOS Accessibility and Screen Recording grants must be tied to the responsible application identity. Add a Linux adapter after Mac validation, explicitly testing the supported desktop environment and display server. Multi-user isolation and cloud fleets belong to later milestones.

Product surfaces: task entry, live view, action timeline, pause/stop/takeover, requested approvals, output downloads, run history, and per-run usage. Later: reusable workflows, schedules, concurrent workers, desktop apps, API/MCP access, and team controls.

## Effort estimates

The following are judgment-based estimates, not measurements or delivery promises. Apply the user's planning convention exactly: one human engineer-month equals one agent development day. Rows are cumulative alternative scope targets, not additive phases. Assume existing drivers and hosted models, ready credentials, access to a Mac for implementation testing, an initial defined app set, and no model training.

| Cumulative milestone | Human engineer-months | Agent development days under requested conversion |
| --- | ---: | ---: |
| Mac proof of concept: one app workflow, Jev decisions, execution trace | 1–2 | 1–2 |
| Usable Mac MVP: three workflows, desktop UI, cancellation, recovery, artifacts | 4–7 | 4–7 |
| Mac private beta: packaging, permissions, reliable defined app set, evaluation | 8–12 | 8–12 |
| Mac plus Linux beta: Linux adapter, packaging, desktop compatibility tests | 12–18 | 12–18 |
| Broad cross-platform platform: Mac/Windows/Linux, fleets, SDK, team administration | 20–40+ | 20–40+ |

Calendar time additionally depends on Mac access, hardware, signing/notarization setup, real-world observation, and user acceptance. The requested conversion does not establish actual agent throughput. Re-estimate after the first working workflow. This workspace is Linux and cannot validate native macOS behavior; Mac testing will require access to the user's Mac or a dedicated Mac test host.

## Validation and costs

Build a repeatable task suite covering success, missing targets, stale observations, login interruptions, ambiguous inputs, failed downloads, service timeouts, and duplicate-submission risk. Verify saved state and artifacts independently of model self-reports. Compare the hybrid agent with a reasoning-model-only baseline on completion rate, false completion, latency, cost per successful task, and human interventions. A proposed private-alpha gate is at least 90% completion on 30 representative tasks repeated three times, with no unauthorized actions in the suite; this is a target, not an achieved result or broad reliability claim.

TypeSafe currently lists Jev 1.13 at $0.042 per million input tokens, with free output tokens. An illustrative workload of 30 calls at 10,000 total input tokens each costs $0.0126 in Jev usage. Include state and questions in the token budget and use actual reported usage when available. This excludes reasoning/vision inference, browser/VM runtime, storage, and retries. Total cost per successful task must be measured; no total dollar estimate is justified until those choices and workload are specified.

Pricing source: https://docs.typesafe.ai/models.md

## Current workspace state

Installed using only `npx --yes skills add typesafe-ai/skills --skill typesafe-ai --agent codex --yes`. Installation created the skill directory and `skills-lock.json`. Read the skill and live TypeSafe documentation for this proposal. No paid API requests, application implementation, or live agent benchmarks have been performed.
