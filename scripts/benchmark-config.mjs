#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
const root = process.cwd(),
  output = resolve(".context/browser-smoke");
await mkdir(output, { recursive: true });
const config = {
  output,
  route: "ui",
  mode: "first",
  samples: 1,
  deadlineMs: 300000,
  tasks: [
    {
      id: "browser-search",
      fixture: "browser",
      instruction:
        "Use browser controls to search for the exact supplied project name and verify the matching result.",
      workspace: resolve(".context/browser-smoke-fixture"),
    },
  ],
  competitors: [
    {
      id: "baseline",
      command: [
        "env",
        "CU_BENCH_CLI=" + join(root, ".context/cu-baseline/dist/cli.mjs"),
        "CU_WORKFLOWS=0",
        "node",
        join(root, "scripts/benchmark-codex.mjs"),
      ],
    },
    {
      id: "candidate",
      command: [
        "env",
        "CU_BENCH_CLI=" + join(root, "dist/cli.mjs"),
        "CU_WORKFLOWS=0",
        "node",
        join(root, "scripts/benchmark-codex.mjs"),
      ],
    },
  ],
};
const path = join(output, "config.json");
await writeFile(path, JSON.stringify(config, null, 2), { mode: 0o600 });
console.log(path);
