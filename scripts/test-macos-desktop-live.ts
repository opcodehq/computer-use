import assert from "node:assert/strict";
import {
  type ChildProcessWithoutNullStreams,
  spawn,
  spawnSync,
} from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import type { Grant } from "../src/desktop/authority.js";
import { DesktopController } from "../src/desktop/controller.js";
import { MacBackend, type MacDriver } from "../src/desktop/mac-backend.js";
import {
  type Action,
  type Observation,
  scopes,
} from "../src/desktop/protocol.js";

if (
  process.platform !== "darwin" ||
  process.env.CI !== "true" ||
  process.env.GITHUB_ACTIONS !== "true"
)
  throw Error(
    "Live Mac desktop tests run only on disposable GitHub macOS CI runners.",
  );
if (!process.env.RUNNER_TEMP || !process.env.CU_NATIVE_DIR)
  throw Error(
    "Set RUNNER_TEMP and CU_NATIVE_DIR to the CI temporary build directory.",
  );
const runner = await realpath(process.env.RUNNER_TEMP);
const native = await realpath(process.env.CU_NATIVE_DIR);
const withinRunner = relative(runner, native);
if (
  !withinRunner ||
  withinRunner.startsWith("..") ||
  withinRunner.startsWith("/")
)
  throw Error(
    "CU_NATIVE_DIR must be a temporary build directory beneath RUNNER_TEMP.",
  );
const directory = await mkdtemp(join(runner, "opcode-live-"));
const driverProcess = spawn(join(native, "desktop-driver"), [], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, JEV_INTERACTION_MODE: "background" },
});
let fixtureProcess: ChildProcessWithoutNullStreams | undefined;
let controller: DesktopController | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;
let diagnostics = "";
driverProcess.stderr.on("data", (chunk) => {
  diagnostics = (diagnostics + chunk).slice(-16_000);
});
const pending = new Map<
  string,
  {
    resolve(value: unknown): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
function disconnected() {
  for (const task of pending.values()) {
    clearTimeout(task.timer);
    task.reject(Error("Temporary native driver disconnected. " + diagnostics));
  }
  pending.clear();
}
driverProcess.on("error", disconnected);
driverProcess.on("exit", disconnected);
const lines = createInterface({ input: driverProcess.stdout });
lines.on("line", (line) => {
  try {
    const reply = JSON.parse(line);
    const task = pending.get(reply.id);
    if (!task) throw Error("Unexpected native reply ID.");
    pending.delete(reply.id);
    clearTimeout(task.timer);
    if (reply.ok) task.resolve(reply.data);
    else task.reject(Object.assign(Error(reply.error.message), reply.error));
  } catch (error) {
    disconnected();
    driverProcess.kill();
  }
});
const driver: MacDriver = {
  async request(method, args = {}, signal) {
    signal?.throwIfAborted();
    const id = randomUUID();
    const result = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error(`Native ${method} timed out.`));
        driverProcess.kill();
      }, 15_000);
      pending.set(id, { resolve, reject, timer });
      driverProcess.stdin.write(JSON.stringify({ ...args, id, method }) + "\n");
    });
    signal?.throwIfAborted();
    return result;
  },
};
async function poll<T>(
  read: () => Promise<T | undefined>,
  message: string,
): Promise<T> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const value = await read();
    if (value !== undefined) return value;
    await delay(100);
  }
  throw Error(message);
}
async function stop(child: ChildProcessWithoutNullStreams | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const force = setTimeout(() => child.kill("SIGKILL"), 1000);
    child.once("exit", () => {
      clearTimeout(force);
      resolve();
    });
    child.kill("SIGTERM");
  });
}
try {
  const status = (await driver.request("status")) as {
    accessibility: boolean;
    screenRecording: boolean;
  };
  assert.equal(
    status.accessibility,
    true,
    "Live CI requires Accessibility; native delivery is unverified without it.",
  );
  assert.equal(
    status.screenRecording,
    true,
    "Live CI requires Screen Recording; native capture is unverified without it.",
  );
  const fixtureBinary = join(directory, "fixture");
  const compile = spawnSync(
    "xcrun",
    [
      "swiftc",
      "-swift-version",
      "5",
      "-parse-as-library",
      "-framework",
      "AppKit",
      resolve("tests/fixtures/mac-desktop.swift"),
      "-o",
      fixtureBinary,
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  assert.equal(compile.status, 0, compile.stderr || compile.error?.message);
  const title = "Opcode CI " + randomUUID();
  const output = join(directory, "result.json");
  fixtureProcess = spawn(fixtureBinary, [output, title], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  fixtureProcess.on("error", () => {});
  fixtureProcess.stderr.on("data", (chunk) => {
    diagnostics = (diagnostics + chunk).slice(-16_000);
  });
  const manifest = await poll(async () => {
    try {
      return JSON.parse(await readFile(output + ".ready", "utf8")) as {
        pid: number;
        field: { x: number; y: number };
        save: { x: number; y: number };
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return undefined;
    }
  }, "Fixture did not become ready. " + diagnostics);
  const backend = new MacBackend(driver);
  const window = await poll(
    async () =>
      (await backend.windows()).find(
        (window) => window.title === title && window.pid === manifest.pid,
      ),
    "Exact fixture window was not found.",
  );
  controller = new DesktopController(
    backend,
    "live-ci",
    join(directory, "recordings"),
  );
  await controller.init();
  const c = controller;
  const call = (
    grant: Grant,
    method: string,
    args: Record<string, unknown> = {},
  ) => c.call({ id: randomUUID(), generation: "live-ci", method, args }, grant);
  const agent = c.authority.issue("agent", [...scopes], 60_000);
  const human = c.authority.issue("human", [...scopes], 60_000);
  const a = (await call(agent, "presence.join", {
    name: "CI agent",
    role: "agent",
  })) as { id: string };
  const h = (await call(human, "presence.join", {
    name: "CI human",
    role: "human",
  })) as { id: string };
  heartbeat = setInterval(() => {
    void call(agent, "presence.update", { participantId: a.id }).catch(
      () => {},
    );
    void call(human, "presence.update", { participantId: h.id }).catch(
      () => {},
    );
  }, 3000);
  const before = await backend.state();
  await call(agent, "presence.update", {
    participantId: a.id,
    cursor: { x: 0.2, y: 0.3 },
  });
  await call(human, "presence.update", {
    participantId: h.id,
    cursor: { x: 0.7, y: 0.8 },
  });
  const after = await backend.state();
  assert.deepEqual(
    { x: after.x, y: after.y },
    { x: before.x, y: before.y },
    "Overlay cursors must not move the real Mac pointer.",
  );
  const presence = (await call(human, "presence.list")) as {
    participants: { cursor: unknown }[];
  };
  assert.equal(presence.participants.length, 2);
  assert.deepEqual(
    presence.participants.map((participant) => participant.cursor),
    [
      { x: 0.2, y: 0.3 },
      { x: 0.7, y: 0.8 },
    ],
  );
  const firstLease = (await call(agent, "acquire", {
    participantId: a.id,
  })) as { id: string };
  await assert.rejects(
    call(human, "acquire", { participantId: h.id }),
    /controller/,
  );
  const old = await c.observe(agent, { kind: "display" });
  const lease = (await call(human, "takeover", { participantId: h.id })) as {
    id: string;
  };
  await assert.rejects(
    call(agent, "input", {
      leaseId: firstLease.id,
      observationId: old.observationId,
      action: { kind: "hover", x: 1, y: 1 },
    }),
    /lease|control/i,
  );
  // Focus only our exact disposable window before delivering physical input.
  const observed = await c.observe(human, { kind: "display" });
  await call(human, "input", {
    leaseId: lease.id,
    observationId: observed.observationId,
    action: { kind: "focus", windowId: window.id },
  });
  await poll(
    async () =>
      (await backend.state()).focus === window.id ? true : undefined,
    "Fixture window did not become focused.",
  );
  const target = { kind: "window" as const, id: window.id };
  async function act(action: Action | ((observation: Observation) => Action)) {
    await delay(200);
    const observation = await c.observe(human, target);
    const png = Buffer.from(observation.image.base64, "base64");
    assert.equal(png.readUInt32BE(16), observation.image.width);
    assert.equal(png.readUInt32BE(20), observation.image.height);
    assert.equal(observation.imageToDesktop.scaleX, 1);
    assert.equal(observation.imageToDesktop.scaleY, 1);
    await call(human, "input", {
      leaseId: lease.id,
      observationId: observation.observationId,
      action: typeof action === "function" ? action(observation) : action,
    });
  }
  const click =
    (point: { x: number; y: number }) =>
    (observation: Observation): Action => ({
      kind: "click",
      x: point.x - observation.desktopBounds.x,
      y: point.y - observation.desktopBounds.y,
    });
  await act(click(manifest.field));
  const text = "Opcode shared desktop CI Unicode α🙂 and chunked text verified";
  await act({ kind: "text", text });
  await act(click(manifest.save));
  const result = await poll(async () => {
    try {
      return JSON.parse(await readFile(output, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return undefined;
    }
  }, "Native save click did not produce fixture output.");
  assert.deepEqual(
    result,
    { saved: true, text },
    "Native text/click outcome must match exactly.",
  );
  await call(human, "release", { leaseId: lease.id });
  console.log(
    "PASS real Mac capture/point geometry, two independent overlay cursors, exclusive control/takeover, native focus/click/Unicode text/save against disposable fixture.",
  );
} finally {
  if (heartbeat) clearInterval(heartbeat);
  try {
    await controller?.close();
  } finally {
    lines.close();
    await stop(driverProcess);
    await stop(fixtureProcess);
    await rm(directory, { recursive: true, force: true });
  }
}
