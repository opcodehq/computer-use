#!/usr/bin/env bun
// Disposable GTK app + isolated X11 display; no model or private applications.
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { createDesktopTool } from "../src/tool/service.ts";
import { openTaskPreview } from "../src/tool/preview.ts";
import { WorkflowStore } from "../src/workflow/runtime.ts";
const directory = await mkdtemp(join(tmpdir(), "cu-native-workflow-"));
const flags = execFileSync("pkg-config", ["--cflags", "--libs", "gtk+-3.0"], {
  encoding: "utf8",
})
  .trim()
  .split(/\s+/);
execFileSync("cc", [
  "tests/fixtures/benchmark/native.c",
  ...flags,
  "-o",
  join(directory, "fixture"),
]);
const display = spawn(
  process.env.TEST_XVFB ?? "Xvfb",
  ["-displayfd", "3", "-screen", "0", "1280x900x24", "-nolisten", "tcp"],
  { stdio: ["ignore", "ignore", "pipe", "pipe"] },
);
let app, tool, close;
try {
  const number = await new Promise((resolveNumber, reject) => {
    let text = "";
    const timer = setTimeout(() => reject(Error("Xvfb startup timeout")), 5000);
    display.once("error", reject);
    display.stdio[3].on("data", (b) => {
      text += b;
      if (text.includes("\n")) {
        clearTimeout(timer);
        resolveNumber(text.trim());
      }
    });
  });
  process.env.DISPLAY = ":" + number;
  process.env.CU_LINUX_DESKTOP = "1";
  process.env.NO_AT_BRIDGE = "0";
  app = spawn(join(directory, "fixture"), [join(directory, "saved.txt")], {
    env: process.env,
    stdio: "ignore",
  });
  const created = createDesktopTool(
    resolve("native/linux/build/desktop-driver"),
    () => {},
  );
  tool = created.tool;
  close = created.close;
  let snapshot;
  for (let i = 0; i < 30; i++) {
    try {
      snapshot = await tool.call("observe", { app: String(app.pid) });
      if (snapshot.source === "ax") break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(
    snapshot?.source,
    "ax",
    "Real AT-SPI observation required, not visual fallback",
  );
  const visual = await tool.call("observe", {
    app: String(app.pid),
    visual: true,
  });
  const field = visual.nodes.find((n) => n.name === "Project name");
  const root = visual.nodes.find((n) => n.role === "AXWindow");
  assert.ok(field?.frame && root?.frame);
  const clicked = await tool.call("input", {
    app: String(app.pid),
    snapshotId: visual.id,
    visual: true,
    action: {
      kind: "click",
      x: field.frame.x - root.frame.x + field.frame.width / 2,
      y: field.frame.y - root.frame.y + field.frame.height / 2,
    },
  });
  assert.equal(clicked.status, "dispatchedUnverified");
  const keyed = await tool.call("input", {
    app: String(app.pid),
    snapshotId: clicked.snapshot.id,
    visual: true,
    action: { kind: "key", text: "Control+A" },
  });
  assert.equal(keyed.status, "dispatchedUnverified");
  const store = new WorkflowStore(join(directory, "workflows"));
  const workflow = {
    version: 1,
    id: "native-project",
    description: "Save and verify native fixture",
    scope: { route: "native", app: String(app.pid) },
    effect: "write",
    inputs: { project: {} },
    outputs: [],
    steps: [
      {
        kind: "action",
        target: { name: "Project name" },
        operation: "setValue",
        value: { input: "project" },
      },
      {
        kind: "action",
        target: { name: "Save project" },
        operation: "press",
        commit: true,
      },
      {
        kind: "wait",
        condition: { target: { name: "Saved and reopened" } },
        timeoutMs: 5000,
      },
      { kind: "assert", condition: { target: { name: "Saved and reopened" } } },
    ],
  };
  const { revision } = await store.register(workflow);
  const { workflowService } = await import("../src/workflow/service.ts");
  const call = workflowService(
    (m, a, s) => tool.call(m, a, s),
    async () => {
      throw Error("Browser route forbidden");
    },
    () => {},
    store.directory,
  );
  const receipt = await call({
    operation: "validate",
    id: workflow.id,
    revision,
    input: { project: "Native verified" },
    effect: "write",
    windowId: snapshot.windowId,
  });
  assert.equal(receipt.status, "passed", JSON.stringify(receipt));
  assert.equal(
    await readFile(join(directory, "saved.txt"), "utf8"),
    "Native verified",
  );
  const captured = await tool.call("capture", { app: String(app.pid) });
  let stopped = false;
  const preview = await openTaskPreview(
    resolve("native/linux/build/task-preview"),
    () => {
      stopped = true;
    },
    (message) => {
      throw Error(message);
    },
  );
  try {
    preview.send({
      state: "acting",
      message: "Native fixture",
      image: captured.image.base64,
    });
    let panel;
    for (let i = 0; i < 30; i++) {
      panel = JSON.parse(
        execFileSync("native/linux/build/cu-x11", ["list"], {
          env: process.env,
          encoding: "utf8",
        }),
      ).find((w) => w.title === "Opcode CU Preview");
      if (panel) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(panel, "Linux popup displayed a real frame");
    const nextFrame = await preview.capture(() =>
      tool.call("capture", { app: String(app.pid) }),
    );
    preview.send({
      state: "acting",
      message: "Recaptured without preview overlay",
      image: nextFrame.image.base64,
    });
    await new Promise((r) => setTimeout(r, 100));

    execFileSync(
      "native/linux/build/cu-x11",
      ["click", String(panel.id), "100", String(panel.height - 15)],
      { env: { ...process.env, CU_INPUT_DELIVERY: "isolated" } },
    );
    for (let i = 0; i < 30 && !stopped; i++)
      await new Promise((r) => setTimeout(r, 50));
    assert.ok(stopped, "Popup cancel delivered to owner");
  } finally {
    await preview.close();
  }
  console.log(
    JSON.stringify({
      status: "passed",
      route: "atspi",
      steps: receipt.completed,
      independentFileVerification: true,
      linuxPopupAndCancel: true,
    }),
  );
} finally {
  await tool?.close?.();
  await close?.();
  app?.kill();
  display.kill();
  await rm(directory, { recursive: true, force: true });
}
