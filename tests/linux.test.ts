import { test } from "node:test";
import assert from "node:assert/strict";
import { suppress } from "../src/linux/vision.js";
import { DesktopTool } from "../src/tool/service.js";
import { readiness } from "../src/tool/doctor.js";
import type { Snapshot } from "../src/shared/contracts.js";
test("YOLO suppression keeps stronger overlapping detection and distinct controls", () => {
  const box = {
    ref: "s:visual:0",
    label: "button",
    source: "yolo" as const,
    confidence: 0.9,
    bounds: { x: 0, y: 0, width: 50, height: 30 },
  };
  const result = suppress([
    box,
    { ...box, confidence: 0.5 },
    { ...box, ref: "other", bounds: { ...box.bounds, x: 80 } },
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0]?.confidence, 0.9);
});
test("Linux readiness requires a dedicated display and installed detector, not Mac permissions", () => {
  const input = {
    platform: "linux",
    executable: true,
    credential: { source: "missing" },
  };
  assert.equal(readiness(input).ready, false);
  assert.equal(
    readiness({
      ...input,
      status: {
        permissions: {
          isolated: true,
          displayReady: true,
          visual: { modelInstalled: true },
        },
      },
    }).ready,
    true,
  );
});
test("raw Linux input requires current matching snapshot and invalidates refs after dispatch", async () => {
  let id = 0;
  const calls: string[] = [];
  const request = async (method: string) => {
    calls.push(method);
    if (method === "apps") return [{ pid: 1, name: "chrome" }];
    if (method === "snapshot")
      return {
        id: String(++id),
        source: "visual",
        pid: 1,
        title: "test",
        truncated: false,
        nodes: [],
      } satisfies Snapshot;
    if (method === "detect") throw new Error("Fixture has no screenshot");
    if (method === "linuxInput") return { delivery: "dispatchedUnverified" };
    throw new Error(method);
  };
  const tool = new DesktopTool(request, async () => {
    throw new Error("No model should run");
  });
  await assert.rejects(
    tool.call("input", {
      app: "chrome",
      snapshotId: "1",
      action: { kind: "click", x: 1, y: 1 },
    }),
    /Stale/,
  );
  const state = (await tool.call("observe", { app: "chrome" })) as Snapshot;
  await tool.call("input", {
    app: "chrome",
    snapshotId: state.id,
    action: { kind: "click", x: 1, y: 1 },
  });
  await assert.rejects(
    tool.call("input", {
      app: "chrome",
      snapshotId: state.id,
      action: { kind: "click", x: 1, y: 1 },
    }),
    /Stale/,
  );
  assert.equal(calls.filter((c) => c === "linuxInput").length, 1);
});
