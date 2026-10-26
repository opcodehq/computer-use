#!/usr/bin/env node
// Build with `bun run build`; invoke dist/pomerado-harness.mjs using Node.
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { codexPomeradoProvider } from "../src/harness/pomerado.ts";
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
if (nodeMajor !== 24 || nodeMinor < 21)
  throw Error(
    "Pomerado requires Node >=24.21 <25. Use a supported Node executable.",
  );
const root = process.env.POMERADO_ROOT;
if (!root)
  throw Error("Set POMERADO_ROOT to the pinned, built Pomerado checkout.");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (pkg.version !== "0.4.0")
  throw Error(
    "Expected pinned Pomerado 0.4.0; review compatibility before changing versions.",
  );
const require = createRequire(resolve(root, "package.json"));
const { Effect } = require("effect");
const { createPomerado } = await import(
  pathToFileURL(resolve(root, "dist/typescript/src/standalone/pomerado.js"))
    .href
);
const { makeTerminalAsker } = await import(
  pathToFileURL(resolve(root, "dist/typescript/src/inputs/terminal.js")).href
);
const { readArtifact, writeArtifact } = await import(
  pathToFileURL(
    resolve(root, "dist/typescript/src/standalone/artifact-files.js"),
  ).href
);
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: "string" },
    intent: { type: "string" },
    input: { type: "string" },
    out: { type: "string" },
    artifact: { type: "string" },
    effect: { type: "string", default: "read" },
    endpoint: { type: "string" },
    "timeout-seconds": { type: "string", default: "1200" },
  },
});
if (!["mint", "run"].includes(positionals[0]) || !values.url)
  throw Error(
    "Usage: node dist/pomerado-harness.mjs mint|run --url URL [--intent TEXT --out NEW_DIRECTORY | --artifact DIRECTORY]",
  );
if (!["read", "write"].includes(values.effect))
  throw Error("effect must be read or write.");
const timeoutMs = Number(values["timeout-seconds"]) * 1000;
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 1200000)
  throw Error("timeout-seconds must be 1–1200.");
const providers = [
  codexPomeradoProvider(),
  codexPomeradoProvider(),
  codexPomeradoProvider(),
];
const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => controller.abort());
console.error(
  "Baseline: Pomerado OSS + Codex provider adapter; API cache/compaction semantics are not interchangeable.",
);
try {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const p = yield* createPomerado({
          ask: makeTerminalAsker(),
          timeoutMs,
          browser: {
            headless: true,
            ...(values.endpoint ? { endpoint: values.endpoint } : {}),
          },
          minterProvider: providers[0],
          guardianProvider: providers[1],
          outcomeReviewerProvider: providers[2],
        });
        const request = {
          url: values.url,
          intent: values.intent ?? "",
          input: JSON.parse(values.input ?? "{}"),
          effect: values.effect,
        };
        if (positionals[0] === "mint") {
          if (!values.out || !values.intent)
            throw Error("Mint requires --out and --intent.");
          // Refuse an existing destination before performing any site action.
          const { mkdir } = yield* Effect.promise(
            () => import("node:fs/promises"),
          );
          yield* Effect.promise(() => mkdir(resolve(values.out)));
          const result = yield* p.mint(request);
          if (!result.artifact) throw Error(result.summary);
          yield* writeArtifact(resolve(values.out), result.artifact);
          console.log(
            JSON.stringify({
              status: "minted",
              directory: resolve(values.out),
            }),
          );
        } else {
          if (!values.artifact) throw Error("Run requires --artifact.");
          const artifact = yield* readArtifact(resolve(values.artifact));
          const result = yield* p.run(artifact, request);
          console.log(JSON.stringify(result));
        }
      }),
    ),
    { signal: controller.signal },
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Pomerado adapter failed",
  );
  process.exitCode = 1;
} finally {
  for (const provider of providers) provider.close();
}
