import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summarize,
  pairedSpeedup,
  htmlReport,
  type Sample,
} from "../src/benchmark/report.js";
import { catalog } from "../src/benchmark/catalog.js";
const base = {
  task: "browser-search",
  platform: "linux",
  route: "ui",
  mode: "warm",
  seed: 0,
  sample: 0,
  deadlineMs: 1000,
};
test("benchmarks penalize failures and never score unsupported native Pomerado as failure", () => {
  const samples: Sample[] = [
    { ...base, competitor: "before", status: "failed", elapsedMs: 2 },
    { ...base, competitor: "after", status: "passed", elapsedMs: 100 },
    { ...base, competitor: "pomerado", status: "unsupported", elapsedMs: 0 },
  ];
  assert.equal(summarize(samples)[0]?.meanPenalizedMs, 1000);
  assert.equal(summarize(samples)[2]?.attempts, 0);
  assert.ok(
    Math.abs(pairedSpeedup(samples, "before", "after").speedup! - 10) < 1e-10,
  );
  assert.ok(
    htmlReport([{ ...samples[0]!, task: "<script>" }]).includes(
      "&lt;script&gt;",
    ),
  );
  assert.equal(catalog.length, 24);
});
