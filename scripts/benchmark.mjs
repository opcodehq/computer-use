#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { runBenchmark } from "../src/benchmark/runner.ts";
import { catalog } from "../src/benchmark/catalog.ts";
if (process.argv.includes("--catalog"))
  console.log(JSON.stringify(catalog, null, 2));
else if (process.argv[2])
  console.log(
    JSON.stringify(
      await runBenchmark(JSON.parse(await readFile(process.argv[2], "utf8"))),
    ),
  );
else {
  console.error("Usage: bun scripts/benchmark.mjs CONFIG.json | --catalog");
  process.exitCode = 1;
}
