# Pomerado: execution speed, evidence, and opportunities for CU

Research date: 2026-10-26. Upstream inspected: Pomerado 0.4.0, commit
`1d8a016862b6b1c8e43c770a75514d487efb8bc5`. CU inspected:
`d6e271bfbf4a1899b809c27c5530896ef1296aa7`.

## Finding

Pomerado moves the model out of repeat website execution. A model explores a
website and writes a parameterized, validated operation; subsequent callers invoke
that operation as an MCP tool. This amortizes exploration, planning, and code
generation across runs. It does not demonstrate a faster general coding model.
Codex can itself use the generated tools.

The current minter uses GPT-6.1 Sol. Guardian and the outcome reviewer use GPT-6
Luna. The benchmark's calling-agent model and these build-time models have distinct
roles; changing the calling model does not change how the integration was built.
[Model constants](https://github.com/Pomerado/pomerado/blob/1d8a016862b6b1c8e43c770a75514d487efb8bc5/typescript/src/models/models.ts).

The strongest adaptation for us is a reusable, typed workflow layer over our
existing browser/native drivers, alongside faster observations and fewer agent
round trips. Keep general computer use for discovery, unsupported applications,
and recovery.

## What their numbers establish

The [vendor homepage](https://pomerado.ai/) reports:

| Claim | Published observation | Interpretation |
| --- | --- | --- |
| Onboarding demonstration | Pomerado 8m16s/$0.03; Codex Computer Use 21m22s/$41.01 | Derived time ratio 2.585×; displayed cost ratio 1,367×. A single demonstration, not a population estimate. |
| Broader evaluation | 30 tasks, 25 business apps, one attempt each | Codex calls pre-minted Pomerado APIs. Measures execution with prior integration work. |
| Headline results | 2× faster; 10–1,000× cheaper; 30% more accurate | Vendor claims; the accuracy wording does not resolve relative improvement versus percentage points. |
| Chart costs | Computer Use/Astra $13.63; Pomerado/Astra $1.62; Pomerado/Luna $0.02 per task | Derived ratios 8.41× and 681.5×. Costs cover model tokens at list price, not full operating cost. |
| Customer claim | 7× speedups | Not the speed ratio of the onboarding demonstration. |

Those are vendor-reported figures, not measurements reproduced in this research.
The chart's precise time/accuracy coordinates were not available as a textual data
table in the inspected page; they are not estimated here from pixel positions.

I inspected the public repository and homepage, including the embedded benchmark
description and chart labels. I did not locate a reproducible benchmark runner,
raw per-task trajectories, or a complete scoring protocol in those inspected
materials. This is a limit of the inspected evidence, not proof none exists.
The YC launch page and hosted documentation index did not load in the web tool.

Missing information needed for an independent comparison:

- Exact prompts, tasks, initial application state, scoring rules and expected outputs.
- Baseline agent/client version, model configuration, reasoning effort and permissions.
- Integration mint time, mint token cost, failed mint attempts and human assistance.
- Repeated samples, run ordering, timeouts and treatment of failed/incomplete tasks.
- Login/2FA time, browser startup, warm/cold state, proxy and regional differences.
- Repair costs, hosting/browser costs, and cost per successfully verified task.

One attempt on each task cannot characterize run-to-run variance. A faster median
also needs success accounting: failures must not disappear from the denominator.
The pre-minted comparison is relevant for recurring business workflows, but does
not establish superiority for unfamiliar, one-off workflows or software engineering.

## How the speed advantage works

### 1. Build once, execute code repeatedly

The build produces source modules, input/output schemas, a deployment description,
an authentication recipe when needed, and an MCP launcher. An ordinary saved
integration run makes no model request in the local implementation. The outer
agent can still spend tokens selecting the tool, supplying inputs, or explaining
results. Hosted maintenance/challenge handling is a separate source of model work.
[Repository README](https://github.com/Pomerado/pomerado/blob/1d8a016862b6b1c8e43c770a75514d487efb8bc5/README.md),
[runtime description](https://github.com/Pomerado/pomerado/blob/1d8a016862b6b1c8e43c770a75514d487efb8bc5/docs/how-it-works.md#the-runtime).

For a repeated workflow, the conceptual comparison is:

```text
Agent loop: sum(model decision + tool transport + action + observation) over steps
Saved operation: route to operation + deterministic steps/waits + output validation
```

Both still pay for the site's latency. Saved code removes repeated deliberation
and observation exchanges; it does not make the website itself faster.

### 2. Execute a meaningful operation per browser call

The authoring contract prefers one Playwright execute call per operation, splitting
at human choices, dialogs, challenges, long flows, and composed write steps. Code
can fill several fields, wait, extract structured results, and verify state without
returning to a model between each primitive action.
[Core authoring contract](https://github.com/Pomerado/pomerado/blob/1d8a016862b6b1c8e43c770a75514d487efb8bc5/typescript/authoring/core/SKILL.md).

This is materially different from making independent mutations concurrently.
The minter parallelizes contiguous read-only source/captcha calls, orders other
tools, and suppresses later calls after an execution fails or becomes uncertain.
Edits and their dependent execution can be emitted together without an intervening
model request, with explicit edit barriers.
[Scheduler implementation](https://github.com/Pomerado/pomerado/blob/1d8a016862b6b1c8e43c770a75514d487efb8bc5/typescript/src/mint/openai.ts).

### 3. Use structured site data and, in the hosted system, HTTP versions

The prompts prefer embedded JSON and the responses the page renders from over
reconstructing data from visible text. The browser path first establishes how
the controls work and verifies applied inputs. A shortcut URL requires observed
evidence, read-back, and a controls fallback; guessed endpoints are not the design.
[Workspace guidance](https://github.com/Pomerado/pomerado/blob/1d8a016862b6b1c8e43c770a75514d487efb8bc5/typescript/authoring/workspace/AGENTS.md).

The repository defines a `SiteHttp` capability interface and HTTP operation
helpers. A host can supply session-aware transports and execute an HTTP version
without replaying the rendered UI. However, automatic HTTP recording, captures,
HTTP versions and savedHTTP are explicitly unavailable in the local host.
The published benchmark cannot be assumed to use only the local browser path.
[HTTP contract](https://github.com/Pomerado/pomerado/blob/1d8a016862b6b1c8e43c770a75514d487efb8bc5/typescript/src/runtime/site-http.ts),
[hosted feature boundary](https://github.com/Pomerado/pomerado/blob/1d8a016862b6b1c8e43c770a75514d487efb8bc5/typescript/src/hosted-features.ts).

### 4. Wait for outcomes, rather than sleeping after every click

Their helpers recognize success, validation errors, empty results, URL changes,
responses, dialogs, popups, and readiness. Progress-aware deadlines distinguish
activity from a stuck page; repeating polls and decorative animation should not
keep a wait alive forever. Polling still uses timers internally; the improvement
is waiting on a condition instead of inserting an unconditional delay.
[Wait implementation](https://github.com/Pomerado/pomerado/blob/1d8a016862b6b1c8e43c770a75514d487efb8bc5/typescript/src/browser/wait.ts),
[outcome kinds](https://github.com/Pomerado/pomerado/blob/1d8a016862b6b1c8e43c770a75514d487efb8bc5/typescript/src/browser/action-waits.ts).

### 5. Reduce build-time model overhead

- Stable tools/instructions precede job-specific data, preserving cacheable prefixes.
- Explicit long-lived cache breakpoints and a prewarm hook prepare shared context.
- Tool availability changes through allowed-tool selection rather than rewriting tools.
- Large execution results are stored as artifacts and returned as bounded digests.
  The whole-result threshold is 16 KiB; the digest retains shape, samples, errors
  and a path for further reading. There are additional digest and hard-cap budgets.
- Background compaction overlaps tool execution, with a barrier near context limits.
- Reasoning continuity is explicitly preserved across turns.
- Smaller models handle Guardian/outcome reviews; minter effort defaults to medium.

These mechanisms are visible in code; their individual speed contribution is not
quantified by the published benchmark.
[Cache utilities](https://github.com/Pomerado/pomerado/blob/1d8a016862b6b1c8e43c770a75514d487efb8bc5/typescript/src/models/prompt-cache.ts),
[result digest](https://github.com/Pomerado/pomerado/blob/1d8a016862b6b1c8e43c770a75514d487efb8bc5/typescript/src/mint/result-digest.ts),
[minter adapter](https://github.com/Pomerado/pomerado/blob/1d8a016862b6b1c8e43c770a75514d487efb8bc5/typescript/src/mint/openai.ts).

Official OpenAI documentation independently recommends fewer requests, parallel
independent work, and deterministic logic where appropriate. Current prompt-cache
documentation supports explicit breakpoints/prewarming for supported models.
These are API-adapter opportunities where we own requests, not settings CU can
impose on an external agent's subscription-backed Codex session. Cache writes
also cost money, and cache eligibility alone does not guarantee lower latency.
[Latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization),
[prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

## What is open source, and what is missing

| Available in the public core | Requires another host / hosted implementation |
| --- | --- |
| Minter, Guardian, authoring prompts | Maintenance and automatic repair |
| Native Playwright adapter and operation runtime | HTTP recording/captures and generated HTTP versions |
| Typed inputs, outputs, questions and job lifecycle | Saved logins and browser profiles; direct sign-in |
| Local MCP hosting and artifacts | Anti-bot handling, proxies and browser replacement |
| Failure/commit classification contracts | Per-step state-changing request lists and write fencing |

The code itself lists these exclusions in `hosted-features.ts`; contracts and
prompt text describing a capability are not evidence that the local host supplies
it. Local served calls start new browser contexts. Library calls can share the
context of their `createPomerado` scope. We should not attribute hosted speed to
saved authentication in the public local runtime.

Guardian reviews build-time actions and final source; it is not a fresh review of
every saved run's authority or intent. The README explicitly says runs do not
check authority/intent, and later source/deployment edits are not reviewed. Our
design should bind execution to a reviewed revision and validate each invocation's
scope. Fast deterministic execution can repeat a wrong operation very efficiently.

Write outcomes are more careful than simple success/failure: commit evidence,
confirmation and possible dispatch affect whether retrying is safe. An uncertain
write must be reconciled before replay or repair. Adopt this property with the
speed improvements.
[Run outcome implementation](https://github.com/Pomerado/pomerado/blob/1d8a016862b6b1c8e43c770a75514d487efb8bc5/typescript/src/runtime/run-outcome.ts).

## Findings in our current CU code

These are source observations and optimization hypotheses, not profiled bottlenecks.

| Area | Current implementation | Proposed adaptation |
| --- | --- | --- |
| Browser observation | `src/browser/tools.ts`, `snapshot`: queries element handles, then awaits one `element.evaluate` per element, up to 400 included nodes; still disposes overflow handles. | Extract bounded metadata in one in-page pass per frame; lazily bind exact handles for selected targets. Preserve identity and revalidation. |
| Observation payload | Same snapshot can include 400 nodes plus 24,000 characters of body text; names/values can be long. | Scope by region/role/task, deduplicate text, return counts/truncation and an artifact handle for large reads. |
| Browser interaction | Action consumes snapshot validity and returns `dispatchedUnverified`; caller separately observes. No public workflow/batch/evaluate operation in this tool list. | Add bounded action-plus-condition-plus-readback operations; expose structured intermediate failures. |
| Browser/session concurrency | `BrowserTools.call` and `DriverSession.call` reject overlapping calls with a busy flag. | Keep single mutation ownership. Parallelize only isolated contexts or immutable artifacts, never shared physical input. |
| Native tools | `src/tool/service.ts` already returns fresh observations after many actions, provides a condition-based `wait`, and reports observation/selection/dispatch/total timings. | Reuse these facilities; extend spans across browser, model, transport and workflow boundaries. |
| Optional Jev task loop | `src/tool/task.ts` commonly makes selection and then value-selection calls for writes, with conditional verification/audit calls and 200–350 ms settling delays in several branches. | Benchmark combined action/value decisions and event/condition waits. Keep separate audits when risk or uncertainty requires them. |
| Decision context | `src/tool/decision-state.ts` already removes empty wrappers, excludes secure values, limits ordinary history, and special-cases large document bodies in sharing tasks. | Extend focused observations without discarding evidence needed for completion. Put stable instructions before volatile state when an owned API adapter supports it. |
| Existing architecture | Persistent sessions, exact refs, cancellation, ownership, uncertain-delivery behavior, browser DOM, native AX and vision routes already exist. | Build on those primitives; a wholesale driver rewrite is unnecessary. |

Rebinding a compiled workflow must use durable semantic descriptions and current
evidence, never yesterday's ephemeral ref IDs or coordinates. AX/vision recipes
will need more observation checkpoints than a stable browser operation. The
browser benchmark does not establish native Mac/Linux desktop speedups.

## Recommended implementation order

### P0: establish where the time goes

Extend current timings into a common trace across browser/native/MCP/CLI routes:
queue, startup, observation extraction, serialization, transport, model TTFT and
completion, dispatch, condition waits, verification and repair. Record token/cache
usage only where the host exposes it; subscription-account data may be unavailable.
Include workflow revision and dispatch state, but no credentials or raw private text.

Start with observation and transport microbenchmarks and a baseline end-to-end
fixture suite. Otherwise a faster model could hide slower DOM extraction or vice versa.

### P1: make existing primitives cheaper

Batch DOM metadata extraction, bound handle creation, add focused observations,
and provide action-plus-outcome/readback calls. Cancel and inspect after any
partial execution; do not rerun a whole sequence because its last wait failed.
Preserve current snapshot consumption and attached-browser behavior, including
the distinct untrusted DOM click route on attached Macs.

This is the most contained first code change. It benefits unfamiliar tasks as
well as recurring workflows, without building an integration compiler first.

### P2: add a small reusable workflow runtime

Start with repeated read-only browser tasks: list/filter records, open a detail
page, and export/read results. A workflow artifact should include:

```text
id + version + reviewed source digest
site/tenant + authentication realm + required capabilities
input schema + output schema + permitted effects
semantic targets + preconditions + bounded steps + outcome assertions
timeout/cancellation contract + execution receipts + reconciliation strategy
validation cases + evidence provenance + compatibility/fingerprint metadata
```

Suggested flow: look up compatible workflow → validate input/scope → run with
current target binding → verify schema and business outcome → return structured
result. On mismatch, return a diagnostic artifact to the host agent. Let the
agent repair a new revision, validate it, then promote it; keep rollback possible.
For writes, confirm the original outcome before any retry and verify authorization
for the requested effect. Do not silently expand a repaired workflow's scope.

Use a constrained recipe/interpreter first if that covers our use cases. General
generated JavaScript adds sandboxing, dependencies, review, and capability-boundary
work. A child process alone is not a security sandbox.

### P3: add learned HTTP execution where justified

Discover requests from successful browser workflows; parameterize business inputs,
resolve fresh session/CSRF state at execution time, validate applied filters and
record identity, and retain a browser fallback. Do not persist secrets in source.
Start with reads and compare structured outputs to the browser version. Write
replay needs stronger commit/reconciliation evidence and separate validation.

### P4: optimize owned model adapters

Use stable prompt/tool ordering, supported cache controls, smaller models for
bounded routing, compact results, and grouped decisions where accuracy holds.
Benchmark each change. CU cannot control the external host agent's model request
format, and a second small-model check may cost more latency than one larger call.

## Evaluation needed before claiming a speedup

Use the same machine/region, application fixtures, auth state, task inputs,
verification criteria, and paired run ordering. Separate:

1. Unfamiliar task: full exploration and any workflow build included.
2. Warm repeat: compatible artifact already exists.
3. Cold repeat: artifact exists, browser/auth must start fresh.
4. Changed site: renamed/moved control, changed response or altered login.
5. Uncertain write: timeout after server commit, before client receipt.

Compare current agent/CU, optimized primitives, saved browser workflow, and HTTP
workflow when available. Include host-agent time in every end-to-end result.
Vary record values and filters so a recipe cannot pass by memorizing its example.

Fixtures should exercise empty results, pagination, late-loading controls,
validation errors, dialogs, DOM replacement/stale targets, cross-origin frames,
cancellation, user takeover, wrong-account state, and duplicate-submit prevention.
Run repeated paired samples (proposed initial minimum: 20 per task/mode), report
sample sizes and uncertainty, median/p95 completion time, verified success rate,
cost per verified success, calls/tokens, observation bytes, and repair frequency.
Do not calculate a precision-looking p95 from a single attempt.

For recurring tasks, measure the break-even condition using consistent units:

```text
N * (baseline_run - saved_run) > build + expected_repairs_over_N_runs
```

Calculate it separately for elapsed time and money. If recurring savings are not
positive, there is no break-even point under those conditions. Report total cost
as minting + executions + repairs + browser/hosting, rather than only token cost.

## Adopt, integrate, or copy?

- Adopt the architecture: deterministic repeat execution with typed contracts,
  conditions, bounded observations and explicit outcomes.
- Consider an optional Pomerado adapter for browser-only workflows after a paired
  evaluation; it would not replace our native desktop, multiplayer or ownership layer.
- Do not assume installing their public package supplies cloud HTTP acceleration,
  authentication brokerage or self-healing.
- If selectively reusing current code, preserve MIT attribution and third-party
  notices. The README says versions 0.1.2 and earlier were AGPL-only; pin the exact
  reviewed release and inspect each copied component. Guardian policy and accessible
  name code carry Apache-2.0-derived notices. Current package engine requirements
  are Node `>=24.21.0 <25`, which differ from CU's Node 20+ baseline.

## Original research scope (before implementation)

Read upstream source, prompts, runtime interfaces, hosted exclusions, representative
tests and public claims; compared them with CU source; checked relevant official
OpenAI latency/cache documentation. No paid model calls, website writes, integration
installation or production behavior changes were made. At that research stage, this document was the only
repository change. See [implementation and measured results](BENCHMARK_RESULTS.md)
for the subsequent code and live tests. Upstream tests use synthetic sites/scripted model responses;
their existence does not independently reproduce the hosted performance benchmark.
Neither upstream suites nor live CU/model performance tests were run: this was a
source/claims investigation, and no speedup is asserted for our system yet.
