#!/usr/bin/env node
// Build to dist/pomerado-probe.mjs. A real upstream mint + run, not a unit test.
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { codexPomeradoProvider } from "../src/harness/pomerado.ts";
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
if (nodeMajor !== 24 || nodeMinor < 21)
  throw Error(
    "Pomerado requires Node >=24.21 <25. Use a supported Node executable.",
  );
const root = process.env.POMERADO_ROOT;
if (!root) throw Error("Set POMERADO_ROOT to the pinned built checkout.");
const require = createRequire(resolve(root, "package.json")),
  { Effect } = require("effect"),
  { chromium } = require("playwright");
const { createPomerado } = await import(
  pathToFileURL(resolve(root, "dist/typescript/src/standalone/pomerado.js"))
    .href
);
const { writeArtifact } = await import(
  pathToFileURL(
    resolve(root, "dist/typescript/src/standalone/artifact-files.js"),
  ).href
);
const kind = process.argv[2] ?? "read";
if (!["read", "write"].includes(kind)) throw Error("Choose read or write.");
const output = resolve(
  process.env.CU_BENCH_OUTPUT ?? ".context/pomerado-" + kind,
);
await mkdir(output, { recursive: true, mode: 0o700 });
const providers = [
  codexPomeradoProvider(),
  codexPomeradoProvider(),
  codexPomeradoProvider(),
];
let saves = 0,
  last = "";
const server = createServer(async (req, res) => {
  if (req.method === "POST") {
    let body = "";
    for await (const b of req) body += b;
    last = new URLSearchParams(body).get("name") ?? "";
    saves++;
    res.setHeader("Content-Type", "text/plain");
    res.end("Saved " + last);
    return;
  }
  res.setHeader("Content-Type", "text/html");
  if (kind === "read") {
    res.end("<h1>Fixture heading</h1>");
    return;
  }
  res.end(
    '<h1>Fixture heading</h1><label>Name<input aria-label="Name" id="name"></label><button id="save">Save</button><p role="status">' +
      (last ? "Saved " + last : "Waiting") +
      '</p><script>document.querySelector("button").onclick=async()=>{const r=await fetch("/",{method:"POST",body:new URLSearchParams({name:document.querySelector("input").value})});document.querySelector("[role=status]").textContent=await r.text();};</script>',
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let browser;
const started = performance.now();
try {
  browser = await chromium.launchServer({
    headless: true,
    ...(process.env.TEST_CHROME_PATH
      ? { executablePath: process.env.TEST_CHROME_PATH }
      : {}),
    args: ["--no-sandbox"],
  });
  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const p = yield* createPomerado({
          ask: () =>
            Effect.fail(new Error("Unexpected question in synthetic mint.")),
          browser: { endpoint: browser.wsEndpoint() },
          timeoutMs: 600000,
          minterProvider: providers[0],
          guardianProvider: providers[1],
          outcomeReviewerProvider: providers[2],
        });
        const request = {
          url: "http://127.0.0.1:" + server.address().port,
          intent:
            kind === "read"
              ? "Read the main heading from this fixture page. Keep read-only."
              : 'Enter the name "First fixture" and save it once. Return the saved name and verify the saved status. Build a reusable operation whose name is a string input.',
          input: kind === "write" ? { name: "First fixture" } : {},
          effect: kind,
        };
        const mint = yield* p.mint(request);
        if (!mint.artifact)
          return {
            status: "not_minted",
            stopReason: mint.stopReason,
            hostFailure: mint.hostFailure,
            diagnostics: mint.diagnostics,
            summary: mint.summary,
          };
        yield* writeArtifact(output + "/artifact", mint.artifact);
        // For writes, use a distinct second request; never replay the original business input.
        if (kind === "write" && saves !== 1)
          throw Error("Write mint did not perform exactly one save.");
        const run = yield* p.run(mint.artifact, {
          ...request,
          input: kind === "write" ? { name: "Second fixture" } : {},
        });
        if (kind === "write" && (saves !== 2 || last !== "Second fixture"))
          throw Error("Independent write count or readback failed.");
        return {
          status: "passed",
          kind,
          summary: mint.summary,
          output: run,
          saves,
        };
      }),
    ),
  );
  await writeFile(
    output + "/result.json",
    JSON.stringify(
      {
        ...result,
        elapsedMs: performance.now() - started,
        label: "Pomerado OSS + Codex provider adapter",
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(result));
  if (result.status !== "passed") process.exitCode = 1;
} catch (error) {
  const result = {
    status: "blocked",
    kind,
    reason: error instanceof Error ? error.message : "Probe failed",
    saves,
  };
  await writeFile(output + "/result.json", JSON.stringify(result, null, 2), {
    mode: 0o600,
  });
  console.log(JSON.stringify(result));
  process.exitCode = 1;
} finally {
  for (const provider of providers) provider.close();
  await browser?.close();
  server.close();
}
