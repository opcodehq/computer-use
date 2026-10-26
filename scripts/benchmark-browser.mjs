#!/usr/bin/env node
// Observation microbenchmark, not an end-to-end agent or Pomerado result.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { cpus } from "node:os";
import { resolve } from "node:path";
const baseline =
  process.env.CU_BASELINE_REVISION ??
  "d6e271bfbf4a1899b809c27c5530896ef1296aa7";
const directory = resolve(
  process.env.CU_BENCH_OUTPUT ?? ".context/benchmark-browser",
);
await mkdir(directory, { recursive: true });
const source = execFileSync(
  "git",
  ["show", baseline + ":src/browser/tools.ts"],
  { encoding: "utf8" },
);
await build({
  stdin: {
    contents: source,
    sourcefile: "baseline-tools.ts",
    loader: "ts",
    resolveDir: resolve("src/browser"),
  },
  outfile: directory + "/baseline.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
});
await build({
  entryPoints: ["src/browser/tools.ts"],
  outfile: directory + "/candidate.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
});
const classes = [
  (await import(directory + "/baseline.mjs")).BrowserTools,
  (await import(directory + "/candidate.mjs")).BrowserTools,
];
let count = 100;
const server = createServer((_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(
    "<title>Observation fixture</title>" +
      Array.from(
        { length: count },
        (_, i) => '<button aria-label="Item ' + i + '">' + i + "</button>",
      ).join(""),
  );
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
const tools = classes.map((C) => new C(launch)),
  samples = [];
try {
  const pages = [];
  for (const tool of tools) {
    const opened = await tool.call({ operation: "open" });
    pages.push(opened.tabs[0].id);
  }
  for (count of [100, 400, 1000]) {
    for (let c = 0; c < tools.length; c++)
      await tools[c].call({
        operation: "navigate",
        pageId: pages[c],
        url: url + "/?nodes=" + count,
      });
    for (let sample = 0; sample < 20; sample++)
      for (const c of sample % 2 ? [1, 0] : [0, 1]) {
        const start = performance.now();
        const observed = await tools[c].call({
          operation: "observe",
          pageId: pages[c],
        });
        samples.push({
          task: "observe-" + count,
          competitor: c ? "candidate" : "baseline",
          platform: process.platform,
          route: "ui",
          mode: "warm",
          seed: 0,
          sample,
          status: "passed",
          elapsedMs: performance.now() - start,
          deadlineMs: 30000,
          nodes: observed.nodes.length,
          truncated: observed.truncated,
        });
      }
  }
  const report = {
    kind: "observation-microbenchmark",
    candidateSourceSha256: createHash("sha256")
      .update(await readFile("src/browser/tools.ts"))
      .digest("hex"),
    createdAt: new Date().toISOString(),
    cpu: cpus()[0]?.model,
    baseline,
    node: process.version,
    platform: process.platform,
    chrome: launch.executablePath ?? "channel:chrome",
    warning:
      "No model, task completion, preview or Pomerado timing is measured.",
    samples,
  };
  await writeFile(
    directory + "/samples.json",
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  const { summarize, pairedSpeedup, htmlReport } = await import(
    "../dist/benchmark-report.mjs"
  );
  await writeFile(directory + "/report.html", htmlReport(samples));
  console.log(
    JSON.stringify(
      {
        directory,
        summary: summarize(samples),
        speedup: pairedSpeedup(samples, "baseline", "candidate"),
      },
      null,
      2,
    ),
  );
} finally {
  for (const tool of tools) await tool.close();
  await new Promise((r) => server.close(r));
}
