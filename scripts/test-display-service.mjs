import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { startDesktop as sourceStartDesktop } from "../src/desktop/server.ts";
const { startDesktop } = process.env.CU_TEST_DESKTOP_MODULE
  ? await import(process.env.CU_TEST_DESKTOP_MODULE)
  : { startDesktop: sourceStartDesktop };
const root = process.cwd(),
  artifacts = await mkdtemp(join(root, ".context/display-service-"));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
execFileSync("cc", [
  "tests/fixtures/desktop-scene.c",
  "-lX11",
  "-o",
  join(artifacts, "scene"),
]);
const xvfb = spawn(
  "Xvfb",
  ["-displayfd", "3", "-screen", "0", "1280x900x24", "-nolisten", "tcp", "-ac"],
  { stdio: ["ignore", "ignore", "ignore", "pipe"] },
);
const number = await new Promise((resolve, reject) => {
  let b = "";
  const timer = setTimeout(() => reject(Error("Xvfb timeout")), 5000);
  xvfb.stdio[3].on("data", (c) => {
    b += c;
    if (b.includes("\n")) {
      clearTimeout(timer);
      resolve(b.trim());
    }
  });
});
const display = ":" + number,
  env = { ...process.env, DISPLAY: display };
let service, wm, viewerBrowser;
const children = [];
let one = "",
  two = "";
try {
  wm = spawn("metacity", ["--sm-disable"], { env, stdio: "ignore" });
  await wait(600);
  for (const [i, x] of [30, 600].entries()) {
    const child = spawn(join(artifacts, "scene"), [String(x)], {
      env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    child.stdout.on("data", (b) => {
      if (i === 0) one += b;
      else two += b;
    });
    children.push(child);
  }
  await wait(500);
  service = await startDesktop({
    display,
    uid: process.getuid(),
    generation: "fixture-one",
    helper:
      process.env.CU_TEST_X11_HELPER ?? resolve("native/linux/build/cu-x11"),
    directory: join(artifacts, "recordings"),
    basePath: "/desktop",
  });
  const descriptor = JSON.parse(await readFile(service.path, "utf8"));
  let token = descriptor.token,
    generation = "fixture-one";
  async function rpc(method, args = {}, id = randomUUID()) {
    const response = await fetch(service.endpoint + "/rpc", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id, generation, method, args }),
    });
    const r = await response.json();
    if (!r.ok) throw Object.assign(Error(r.error.message), r.error);
    return r.result;
  }
  await assert.rejects(
    startDesktop({
      display: "unix" + display,
      uid: process.getuid(),
      generation,
      helper:
        process.env.CU_TEST_X11_HELPER ?? resolve("native/linux/build/cu-x11"),
      basePath: "",
    }),
    /already owns/,
  );
  const windows = await rpc("windows");
  assert.equal(windows.length, 2);
  const first = windows.find((w) => w.title === "Opcode Terminal"),
    second = windows.find((w) => w.title === "Opcode Notes");
  assert(first && second);
  const unauthorized = await fetch(service.endpoint + "/frame");
  assert.equal(unauthorized.status, 403);
  const wrongOrigin = await fetch(service.endpoint + "/frame", {
    headers: {
      Authorization: "Bearer " + descriptor.token,
      Origin: "https://untrusted.invalid",
    },
  });
  assert.equal(wrongOrigin.status, 403);
  const expiring = await rpc("grant", {
    subject: "short-view",
    scopes: ["viewer-read"],
    ttlMs: 1000,
  });
  await wait(1100);
  assert.equal(
    (
      await fetch(service.endpoint + "/frame", {
        headers: { Authorization: "Bearer " + expiring.token },
      })
    ).status,
    403,
  );
  const observer = await rpc("grant", {
    subject: "observer",
    scopes: ["viewer-read"],
    ttlMs: 60000,
  });
  viewerBrowser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await viewerBrowser.newPage();
  const uiErrors = [];
  page.on("pageerror", (error) => uiErrors.push(error.message));
  const firstFrameAt = performance.now();
  await page.goto(service.endpoint + "/view#" + observer.token);
  await page.waitForFunction(
    () => document.querySelector("#screen").naturalWidth > 0,
  );
  const firstViewerFrameMs = performance.now() - firstFrameAt;
  for (const id of ["take", "release", "resize"])
    assert.equal(await page.locator("#" + id).isVisible(), false);
  assert.deepEqual(uiErrors, []);
  await page.screenshot({ path: join(artifacts, "viewer.png") });
  await page.close();
  const agent = await rpc("grant", {
    subject: "agent",
    scopes: ["observe", "input-control", "recording-start", "recording-read"],
    ttlMs: 60000,
  });
  const human = await rpc("grant", {
    subject: "human",
    scopes: ["observe", "input-control", "viewer-read"],
    ttlMs: 60000,
  });
  token = observer.token;
  await assert.rejects(rpc("acquire"), /scope/);
  const viewed = await fetch(service.endpoint + "/frame", {
    headers: { Authorization: "Bearer " + token },
  });
  assert.equal(viewed.status, 200);
  const displayed = await viewed.json();
  assert.equal(displayed.image.width, 1280);
  assert.equal(displayed.image.height, 900);
  await writeFile(
    join(artifacts, "full-desktop.png"),
    Buffer.from(displayed.image.base64, "base64"),
  );
  token = agent.token;
  let lease = await rpc("acquire");
  const windowFrame = await rpc("observe", {
    target: { kind: "window", id: first.id },
  });
  assert.equal(windowFrame.image.width, first.width);
  assert.equal(windowFrame.image.height, first.height);
  assert.equal(windowFrame.imageToDesktop.offsetX, first.x);
  const observe = () => rpc("observe", { target: { kind: "display" } });
  async function action(action) {
    const obs = await observe();
    return rpc("input", {
      leaseId: lease.id,
      observationId: obs.observationId,
      action,
    });
  }
  const recording = await rpc("recording.start", {
    fps: 5,
    maxSeconds: 30,
    maxBytes: 10000000,
  });
  await action({ kind: "launch", appId: "xterm.desktop" });
  let terminal;
  for (let i = 0; i < 30 && !terminal; i++) {
    await wait(100);
    terminal = (await rpc("windows")).find(
      (w) => !windows.some((original) => original.id === w.id),
    );
  }
  assert(terminal, "Real terminal launched through installed app ID");
  await action({ kind: "focus", windowId: terminal.id });
  const terminalOutput = join(artifacts, "terminal-output.txt");
  await action({
    kind: "text",
    text: "printf '%s' 'Opcode café 日本語 👋' > '" + terminalOutput + "'",
  });
  await action({ kind: "key", key: "Enter" });
  for (let i = 0; i < 30; i++) {
    try {
      if ((await readFile(terminalOutput, "utf8")) === "Opcode café 日本語 👋")
        break;
    } catch {}
    await wait(100);
  }
  assert.equal(await readFile(terminalOutput, "utf8"), "Opcode café 日本語 👋");
  await action({ kind: "text", text: "exit" });
  await action({ kind: "key", key: "Enter" });
  await wait(150);
  await action({ kind: "focus", windowId: first.id });
  await action({ kind: "text", text: "Opcode café 日本語 👋" });
  await wait(350);
  assert.match(one, /Opcode café 日本語 👋/);
  await action({ kind: "focus", windowId: second.id });
  await action({ kind: "text", text: "Second native app" });
  await wait(350);
  assert.match(two, /Second native app/);
  await action({ kind: "hover", x: second.x + 60, y: second.y + 70 });
  await action({ kind: "doubleClick", x: second.x + 60, y: second.y + 70 });
  await action({ kind: "rightClick", x: second.x + 60, y: second.y + 70 });
  await action({ kind: "scroll", amount: 2, axis: "y" });
  await action({ kind: "scroll", amount: 2, axis: "x" });
  await action({ kind: "keyDown", key: "Shift" });
  await action({ kind: "keyUp", key: "Shift" });
  await action({ kind: "buttonDown", button: 1 });
  await action({ kind: "buttonUp", button: 1 });
  await wait(100);
  for (const expected of [
    "button 4 3",
    "button 4 5",
    "button 4 7",
    "key 2 65505",
    "key 3 65505",
  ])
    assert(two.includes(expected), "Native app received " + expected);
  const obs = await observe();
  const id = randomUUID();
  const args = {
    leaseId: lease.id,
    observationId: obs.observationId,
    action: { kind: "click", x: first.x + 50, y: first.y + 70 },
  };
  await rpc("input", args, id);
  for (let i = 0; i < 30 && !one.includes("button 5 1 50 70"); i++)
    await wait(20);
  assert(one.includes("button 5 1 50 70"), "First click reached the app");
  const before = one;
  await rpc("input", args, id);
  await wait(100);
  assert.equal(one, before);
  await action({
    kind: "drag",
    x: first.x + 70,
    y: first.y + 100,
    toX: second.x + 70,
    toY: second.y + 100,
  });
  const stale = await observe();
  const interrupted = rpc("input", {
    leaseId: lease.id,
    observationId: stale.observationId,
    action: {
      kind: "drag",
      x: first.x + 60,
      y: first.y + 80,
      toX: first.x + 350,
      toY: first.y + 220,
    },
  });
  const interruptedResult = assert.rejects(
    interrupted,
    /may have been delivered|control|Control/,
  );
  await wait(140);
  token = human.token;
  const stopStarted = performance.now();
  const humanLease = await rpc("takeover");
  const takeoverMs = performance.now() - stopStarted;
  await interruptedResult;
  token = agent.token;
  await assert.rejects(
    rpc("input", {
      leaseId: lease.id,
      observationId: stale.observationId,
      action: { kind: "click", x: 100, y: 100 },
    }),
    /control/,
  );
  token = human.token;
  await rpc("release", { leaseId: humanLease.id });
  token = agent.token;
  lease = await rpc("acquire");
  await rpc("recording.pause", { id: recording.id });
  await wait(300);
  await rpc("recording.resume", { id: recording.id });
  await action({ kind: "focus", windowId: first.id });
  await action({ kind: "text", text: "Final scene marker" });
  await wait(1000);
  const final = await rpc("recording.stop", { id: recording.id });
  assert.equal(final.state, "completed");
  assert(final.bytes > 1000);
  assert.deepEqual(await rpc("recording.stop", { id: recording.id }), final);
  const range = await fetch(service.endpoint + "/artifacts/" + recording.id, {
    headers: { Authorization: "Bearer " + token, Range: "bytes=0-99" },
  });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 100);
  execFileSync(
    process.env.CU_FFMPEG,
    [
      "-v",
      "error",
      "-i",
      join(artifacts, "recordings", recording.id + ".mp4"),
      "-f",
      "null",
      "-",
    ],
    { stdio: "pipe" },
  );
  const playbackPage = await viewerBrowser.newPage();
  await playbackPage.route(service.endpoint + "/playback-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Recording playback test</title>",
    }),
  );
  await playbackPage.goto(service.endpoint + "/playback-test");
  const playback = await playbackPage.evaluate(
    async ({ endpoint, token, id }) => {
      const response = await fetch(endpoint + "/artifacts/" + id, {
        headers: { Authorization: "Bearer " + token },
      });
      if (!response.ok) throw new Error("Artifact download failed");
      const video = document.createElement("video");
      video.muted = true;
      video.src = URL.createObjectURL(await response.blob());
      document.body.append(video);
      await video.play();
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Playback timed out")),
          5000,
        );
        video.ontimeupdate = () => {
          if (video.currentTime > 0) {
            clearTimeout(timer);
            resolve();
          }
        };
      });
      const result = {
        width: video.videoWidth,
        height: video.videoHeight,
        currentTime: video.currentTime,
      };
      video.pause();
      URL.revokeObjectURL(video.src);
      video.remove();
      return result;
    },
    { endpoint: service.endpoint, token, id: recording.id },
  );
  assert.equal(playback.width, 1280);
  assert.equal(playback.height, 900);
  assert(playback.currentTime > 0);
  const humanPage = await viewerBrowser.newPage();
  await humanPage.goto(service.endpoint + "/view#" + human.token);
  await humanPage.waitForFunction(
    () => document.querySelector("#screen").naturalWidth === 1280,
  );
  await humanPage.locator("#take").click();
  await humanPage.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("You have control"),
  );
  const beforeHumanKey = one.length;
  await humanPage.locator("#screen").focus();
  await humanPage.keyboard.press("a");
  for (
    let i = 0;
    i < 50 && !one.slice(beforeHumanKey).includes("key 2 97");
    i++
  )
    await wait(50);
  assert(
    one.slice(beforeHumanKey).includes("key 2 97"),
    "Viewer keyboard reached native app",
  );
  await humanPage.locator("#release").click();
  await humanPage.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("Watching desktop"),
  );
  await humanPage.reload();
  await humanPage.waitForFunction(
    () => document.querySelector("#screen").naturalWidth === 1280,
  );
  await humanPage.close();
  token = agent.token;
  lease = await rpc("acquire");
  const resized = await rpc("resize", {
    leaseId: lease.id,
    width: 1280,
    height: 900,
  });
  assert.equal(resized.geometry.width, 1280);
  await assert.rejects(rpc("renew", { leaseId: lease.id }), /control/);
  token = descriptor.token;
  await rpc("revoke", { id: observer.id });
  const revoked = await fetch(service.endpoint + "/frame", {
    headers: { Authorization: "Bearer " + observer.token },
  });
  assert.equal(revoked.status, 403);
  await rpc("rebind", { generation: "fixture-two" });
  await assert.rejects(rpc("health"), /rebind/);
  generation = "fixture-two";
  await rpc("health");
  const expired = await fetch(service.endpoint + "/frame", {
    headers: { Authorization: "Bearer " + agent.token },
  });
  assert.equal(expired.status, 403);
  const timings = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    await service.controller.backend.capture({ kind: "display" });
    timings.push(performance.now() - start);
  }
  timings.sort((a, b) => a - b);
  await writeFile(
    join(artifacts, "results.json"),
    JSON.stringify(
      {
        display,
        implementation: process.env.CU_TEST_DESKTOP_MODULE ?? "source",
        rootDimensions: [1280, 900],
        apps: windows.map((w) => w.title),
        recording: final,
        playback,
        firstViewerFrameMs,
        takeoverMs,
        rawCaptureMs: { samples: timings, p95: timings[9] },
        provider: "local Xvfb + Metacity; cloud providers not tested",
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS same-display root capture, two native apps, Unicode, popup, scroll/drag, idempotency, takeover, headless video/decode, byte ranges, revocation, lifecycle rebind",
  );
  console.log(artifacts);
} finally {
  await viewerBrowser?.close();
  await service?.close();
  for (const child of children) child.kill();
  wm?.kill();
  xvfb.kill();
}
