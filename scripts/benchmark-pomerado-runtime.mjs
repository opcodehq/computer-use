#!/usr/bin/env node
// Deterministic runtime comparison only. Both return the same nonempty heading.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BrowserTools } from "../src/browser/tools.ts";
import { WorkflowStore } from "../src/workflow/runtime.ts";
import { workflowService } from "../src/workflow/service.ts";
import {
  summarize,
  bootstrapSpeedup,
  htmlReport,
} from "../src/benchmark/report.ts";
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
if (nodeMajor !== 24 || nodeMinor < 21)
  throw Error(
    "Pomerado requires Node >=24.21 <25. Use a supported Node executable.",
  );
const root = process.env.POMERADO_ROOT;
if (!root) throw Error("Set POMERADO_ROOT.");
const artifactDirectory = resolve(
  process.env.POMERADO_ARTIFACT ?? ".context/pomerado-read/artifact",
);
const output = resolve(
  process.env.CU_BENCH_OUTPUT ?? ".context/pomerado-runtime",
);
await mkdir(output, { recursive: true, mode: 0o700 });
const require = createRequire(resolve(root, "package.json")),
  { Effect } = require("effect"),
  { chromium } = require("playwright");
const { createPomerado } = await import(
  pathToFileURL(resolve(root, "dist/typescript/src/standalone/pomerado.js"))
    .href
);
const { readArtifact } = await import(
  pathToFileURL(
    resolve(root, "dist/typescript/src/standalone/artifact-files.js"),
  ).href
);
const server = createServer((_, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end('<h1 aria-label="Main heading">Fixture heading</h1>');
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = "http://127.0.0.1:" + server.address().port;
const launch = {
  headless: true,
  args: ["--no-sandbox"],
  ...(process.env.TEST_CHROME_PATH
    ? { executablePath: process.env.TEST_CHROME_PATH }
    : {}),
};
const cu = new BrowserTools(launch),
  samples = [];
let browser;
try {
  browser = await chromium.launchServer(launch);
  const opened = await cu.call({ operation: "open" }),
    pageId = opened.tabs[0].id;
  await cu.call({ operation: "navigate", pageId, url });
  const service = workflowService(
    async () => {
      throw Error("Native route forbidden");
    },
    (_m, a, s) => cu.call(a, s),
    () => {},
    output + "/workflows",
  );
  const workflow = {
    version: 1,
    id: "runtime-heading",
    description: "Return a nonempty main heading",
    scope: { route: "browser", origin: url },
    effect: "read",
    inputs: {},
    outputs: ["heading"],
    steps: [
      { kind: "navigate", url: { literal: url } },
      {
        kind: "extract",
        target: { name: "Main heading", role: "h1" },
        output: "heading",
        field: "value",
      },
      {
        kind: "assert",
        condition: {
          target: { name: "Main heading", role: "h1" },
          nonEmpty: true,
        },
      },
    ],
  };
  const { revision } = await service({ operation: "register", workflow });
  await service({
    operation: "validate",
    id: workflow.id,
    revision,
    effect: "read",
    input: {},
    pageId,
  });
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const p = yield* createPomerado({
          ask: () => Effect.fail(Error("Unexpected question")),
          browser: { endpoint: browser.wsEndpoint() },
          timeoutMs: 30000,
        });
        const artifact = yield* readArtifact(artifactDirectory);
        yield* p.run(artifact, { url, intent: "Read main heading", input: {} });
        for (let sample = 0; sample < 20; sample++)
          for (const competitor of sample % 2
            ? ["cu-workflow", "pomerado-runtime"]
            : ["pomerado-runtime", "cu-workflow"]) {
            const started = performance.now();
            let status = "passed";
            const attempt = yield* Effect.either(
              competitor === "cu-workflow"
                ? Effect.promise(() =>
                    service({
                      operation: "run",
                      id: workflow.id,
                      revision,
                      effect: "read",
                      input: {},
                      pageId,
                    }),
                  )
                : p.run(artifact, {
                    url,
                    intent: "Read main heading",
                    input: {},
                  }),
            );
            if (attempt._tag === "Left") status = "failed";
            else {
              const result = attempt.right;
              const heading =
                competitor === "cu-workflow"
                  ? result.outputs?.heading
                  : result.heading;
              if (
                heading !== "Fixture heading" ||
                (competitor === "cu-workflow" && result.status !== "passed")
              )
                status = "failed";
            }
            samples.push({
              task: "nonempty-heading",
              platform: process.platform,
              route: "ui",
              mode: "warm-runtime",
              competitor,
              seed: 0,
              sample,
              status,
              elapsedMs: performance.now() - started,
              deadlineMs: 30000,
            });
          }
      }),
    ),
  );
  const result = {
    kind: "deterministic-runtime-microbenchmark",
    label: "Upstream-minted Pomerado artifact vs manually authored CU workflow",
    limits:
      "One simple read; warm library sessions; no outer agent, minting, preview, repair or desktop timing.",
    node: process.version,
    platform: process.platform,
    workflowRevision: revision,
    pomeradoVersion: JSON.parse(
      await readFile(resolve(root, "package.json"), "utf8"),
    ).version,
    samples,
  };
  await writeFile(output + "/samples.json", JSON.stringify(result, null, 2), {
    mode: 0o600,
  });
  await writeFile(output + "/report.html", htmlReport(samples), {
    mode: 0o600,
  });
  console.log(
    JSON.stringify(
      {
        output,
        summary: summarize(samples),
        comparison: bootstrapSpeedup(
          samples,
          "pomerado-runtime",
          "cu-workflow",
        ),
      },
      null,
      2,
    ),
  );
} finally {
  await cu.close();
  await browser?.close();
  server.close();
}
