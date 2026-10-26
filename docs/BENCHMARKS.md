# CU performance and Pomerado comparisons

Run deterministic checks before model benchmarks:

```sh
bun install --frozen-lockfile
bun run check
bun run build
TEST_CHROME_PATH=/absolute/path/to/chrome bun test
TEST_CHROME_PATH=/absolute/path/to/chrome bun run benchmark:browser
bun run test:native-workflow
```

The native workflow test needs GTK development packages, AT-SPI, Xvfb and D-Bus.
It creates a disposable app/display, saves through semantic controls, independently
checks a file, displays the Linux popup and presses its cancel button. It makes
no model calls. Mac hardware is required for actual Mac delivery validation.

## Observation microbenchmark

`benchmark:browser` compiles the frozen CU source at
`d6e271bfbf4a1899b809c27c5530896ef1296aa7` and the working tree into separate
modules. It measures 100/400/1,000-element observations with 20 samples per case,
alternates execution order, and writes raw data plus HTML to
`.context/benchmark-browser/`. This excludes model reasoning, task completion,
startup and preview. It cannot establish the 2× end-to-end release target or a
Pomerado speed advantage.

## Agent benchmark runner

`bun run benchmark -- --catalog` lists 24 task templates: 12 browser, eight native,
and four cross-application. Browser fixtures are built in. Native and cross-app
templates require an image with the real applications, task reset commands and
independent expected file hashes; catalog presence is not a passing test.

Run `bun scripts/benchmark.mjs CONFIG.json`. A config uses this shape:

```json
{
  "output": ".context/agent-benchmark",
  "route": "ui",
  "mode": "first",
  "samples": 20,
  "deadlineMs": 1200000,
  "tasks": [
    {
      "id": "browser-search",
      "fixture": "browser",
      "instruction": "Use browser controls to search for the supplied exact project and verify the result.",
      "workspace": ".context/fixtures/search"
    }
  ],
  "competitors": [
    {
      "id": "candidate",
      "command": ["node", "/absolute/checkout/scripts/benchmark-codex.mjs"]
    }
  ]
}
```

Set `CU_BENCH_CLI` to the built baseline or candidate `dist/cli.mjs` and
`CU_BENCH_MODEL` to an exact installed Codex model (default `gpt-6.1-sol`, medium
reasoning). `benchmark-codex.mjs` uses existing authentication, an ephemeral
session, no unrelated user config, and a read-only shell sandbox with built-in
shell/patch tools disabled. Only the selected CU MCP is provided. Set
`CU_WORKFLOWS=1` to expose workflows. The benchmark's UI route disables direct
JSON reads and best-route workflow execution as well as instructing the agent
against scripting. Full route compliance still requires auditing tool traces.

Comparator commands are argv arrays, never shell fragments. They receive one
JSON request on stdin with task, route, mode, seed, sample, instruction, workspace
and deadline metadata. Each command must return zero only after its task finishes.
The runner independently verifies file hashes. A reset that already satisfies
the expected output is rejected. Fixture state is reset each run, and its origin
is reused across samples so a warm workflow can remain compatible.

For native/custom tasks provide `reset` as an argv array and `expected` as
`[{"path":"result.txt","sha256":"..."}]`. Keep workspaces disposable. Task
setup/reset time is excluded from completion timing; app/model startup inside a
competitor command is included. Mode-specific warmup, artifact prebuilding and
application mutations belong to the competitor/reset implementation: a `mode`
label alone does not establish warm/cold or repair conditions. Do not publish
those comparisons without verifying their manifests and setup.

The runner alternates competitor order, cycles three seeds, charges failures the
full deadline, and excludes infrastructure/unsupported entries. A comparator with
`native:false` is unsupported on native/cross-app tasks. Raw traces, config,
samples and an HTML report are owner-only. Reports escape task names. Paired
bootstrap utilities are provided for confidence intervals; keep platform, route
and mode groups separate. Subscription dollar spend is reported unavailable.

## Pomerado through the Codex harness

Use the reviewed Pomerado 0.4.0 commit
`1d8a016862b6b1c8e43c770a75514d487efb8bc5`, its own locked dependencies, and its
required Node version (`>=24.21 <25`). Set `POMERADO_ROOT` to the built checkout.
The CU wrapper is built into `dist/pomerado-harness.mjs`:

```sh
node dist/pomerado-harness.mjs mint --url URL --intent 'Read the requested data' --out NEW_DIRECTORY --effect read
node dist/pomerado-harness.mjs run --url URL --artifact DIRECTORY --input '{}'
```

Use `--endpoint` for a matching Playwright browser server. Keep the installed
Codex authenticated; do not copy tokens or supply API credentials. The bridge
keeps separate minter, Guardian and outcome-reviewer conversations and returns
SDK tool calls to upstream execution. Native patch calls are translated to their
upstream structured operation; the bridge does not edit Pomerado files itself.

Always label this **Pomerado OSS + Codex provider adapter**. It is a modified
model transport, not stock Pomerado or Pomerado Cloud. API cache prewarming,
imported compaction, streaming SDK responses and changing tool catalogs are not
interchangeable with this transport and fail explicitly. Model tokens may be
unavailable; zero-valued SDK accounting placeholders are not measured usage.

The compatibility gate requires successful read and disposable write minting,
followed by verified execution. The read probe published an upstream-generated
artifact and replayed it successfully. The write probe did not publish: Guardian
rejected commit-boundary ordering and the probe reached its deadline. The full
compatibility gate therefore remains unmet. These mint probes used Node 24.18;
repeat both on supported Node before treating them as release evidence. The
separate runtime microbenchmark used Node 24.21. First-write minting performs the
task: never immediately replay the write merely to obtain a benchmark result.

Reproduce the runtime comparison with the supported Node executable:

```sh
POMERADO_ROOT=/path/to/built/pomerado POMERADO_ARTIFACT=/path/to/minted/read/artifact node dist/benchmark-pomerado-runtime.mjs
```

This compares an upstream-minted read artifact against a manually authored CU
workflow on one local heading fixture. Both reload the page each trial; execution
order alternates across 20 pairs. It excludes outer-agent, minting, popup, repair
and desktop costs. See [measured results](BENCHMARK_RESULTS.md).

For an authenticated Codex browser smoke test, first run
`bun scripts/benchmark-prepare.mjs`, then `bun scripts/benchmark-config.mjs` and
follow the generated config/output paths. Inspect these small scripts to change environment-specific paths. The frozen baseline is built separately;
its native executable is not supplied by the browser preparation step.

## Release gate

Keep workflows opt-in until actual Mac and Linux task benchmarks demonstrate
≥2× aggregate repeat-task speedup versus frozen CU, a 95% paired lower confidence
bound above 1×, no lower observed verified success rate, and no duplicate or
unauthorized writes in fault tests. Publish per-task mixed results. Track minting,
repair, account state, permissions, preview/recording configuration and sample
counts; compute amortization separately from repeat latency.
