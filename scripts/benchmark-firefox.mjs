#!/usr/bin/env node
// Native Firefox transport benchmark. No model, DOM automation, user profile or Play writes.
import { build } from "esbuild";
import { spawn, execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, readFile, symlink, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createServer } from "node:http";
import { randomUUID, createHash } from "node:crypto";
const exec = promisify(execFile),
  root = process.cwd(),
  out = resolve(process.env.CU_BENCH_OUTPUT ?? ".context/benchmark-firefox");
await mkdir(out, { recursive: true });
const sourceFiles = [
  "native/linux/x11.c",
  "src/desktop/backend.ts",
  "src/desktop/controller.ts",
  "src/desktop/protocol.ts",
  "src/desktop/client.ts",
  "src/desktop/server.ts",
  "src/linux/x11-session.ts",
  "src/linux/capture.ts",
];
const candidateSources = Object.fromEntries(
  await Promise.all(
    sourceFiles.map(async (path) => [
      path,
      createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    ]),
  ),
);
const candidateSourceSha256 = createHash("sha256")
  .update(JSON.stringify(candidateSources))
  .digest("hex");
const revision =
    process.env.CU_BASELINE_REVISION ??
    "7c1a96f56ff675fff796f7df0eaa5a4bbf3ce8b3",
  base = join(out, "baseline");
try {
  await access(base);
} catch {
  await mkdir(base);
  execFileSync("tar", ["-x", "-C", base], {
    input: execFileSync("git", ["archive", revision], {
      maxBuffer: 64 * 1024 * 1024,
    }),
  });
  await symlink(join(root, "node_modules"), join(base, "node_modules"), "dir");
}
for (const [dir, name] of [
  [base, "baseline"],
  [root, "candidate"],
]) {
  await build({
    stdin: {
      contents: 'export {startDesktop} from "./src/desktop/server.ts";',
      resolveDir: dir,
      loader: "ts",
    },
    outfile: join(out, name + ".mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
  });
  if (name === "baseline") {
    await mkdir(join(base, "dist"), { recursive: true });
    await build({
      entryPoints: [join(base, "src/desktop/cli.ts")],
      outfile: join(base, "dist/desktop-api.mjs"),
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
    });
    execFileSync("cc", [
      "-O2",
      join(base, "native/linux/x11.c"),
      "-lX11",
      "-lXtst",
      "-o",
      join(out, "baseline-x11"),
    ]);
  }
}
await build({
  stdin: {
    contents:
      'export {bootstrapSpeedup,htmlReport} from "./src/benchmark/report.ts";',
    resolveDir: root,
    loader: "ts",
  },
  outfile: join(out, "reporting.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
});
const { bootstrapSpeedup, htmlReport } = await import(
  join(out, "reporting.mjs")
);
const baseline = await import(join(out, "baseline.mjs")),
  candidate = await import(join(out, "candidate.mjs"));
const observed = new Set();
const server = createServer((req, res) => {
  const u = new URL(req.url, "http://local");
  if (u.pathname === "/seen") {
    observed.add(u.searchParams.get("nonce"));
    res.end("ok");
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(
    `<title>Loading fixture</title><style>body{font:24px sans-serif;margin:60px;background:#f5f8ff}article{padding:35px;background:white;border:1px solid #abc}</style><h1>Zuse · release status</h1><article><h2>1.1.0 (3)</h2><p>Closed testing – Alpha · Available to testers</p><p>Production inactive · 2 of 12 testers opted in</p><p>Release notes: background reconnection and network recovery</p><a href="/details">View release details</a></article><script>requestAnimationFrame(()=>requestAnimationFrame(()=>{document.title=${JSON.stringify("CU fixture " + u.searchParams.get("nonce"))};fetch('/seen?nonce='+encodeURIComponent(${JSON.stringify(u.searchParams.get("nonce"))}));}));</script>`,
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const xvfb = spawn(
  process.env.TEST_XVFB ?? "Xvfb",
  [
    "-displayfd",
    "3",
    "-screen",
    "0",
    (process.env.CU_BENCH_RESOLUTION ?? "1920x1080") + "x24",
    "-nolisten",
    "tcp",
  ],
  { stdio: ["ignore", "ignore", "pipe", "pipe"] },
);
let firefox, service;
const samples = [];
let display;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (check, timeout = 15000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await wait(30);
  }
  throw Error("Fixture readiness deadline");
};
try {
  const number = await new Promise((r, j) => {
    let text = "";
    const t = setTimeout(() => j(Error("Xvfb startup deadline")), 5000);
    xvfb.once("error", j);
    xvfb.stdio[3].on("data", (b) => {
      text += b;
      if (text.includes("\n")) {
        clearTimeout(t);
        r(text.trim());
      }
    });
  });
  display = ":" + number;
  const env = {
    ...process.env,
    DISPLAY: display,
    MOZ_ENABLE_WAYLAND: "0",
    GDK_SCALE: "1",
    GDK_DPI_SCALE: "1",
    MOZ_DISABLE_CONTENT_SANDBOX: "1",
    NO_AT_BRIDGE: "1",
  };
  const profile = join(out, "firefox-profile");
  await mkdir(profile, { recursive: true });
  await writeFile(
    join(profile, "user.js"),
    'user_pref("browser.shell.checkDefaultBrowser",false);\nuser_pref("browser.aboutwelcome.enabled",false);\nuser_pref("browser.startup.homepage_override.mstone","ignore");\nuser_pref("datareporting.policy.dataSubmissionEnabled",false);\nuser_pref("toolkit.telemetry.reportingpolicy.firstRun",false);\nuser_pref("browser.newtabpage.enabled",false);\n',
  );
  firefox = spawn(
    process.env.TEST_FIREFOX_PATH ??
      "/snap/firefox/current/usr/lib/firefox/firefox",
    [
      "--no-remote",
      "--profile",
      profile,
      "--width",
      "1900",
      "--height",
      "1000",
      "about:blank",
    ],
    { env, stdio: "ignore" },
  );
  await until(async () => {
    try {
      return JSON.parse(
        (await exec(join(out, "baseline-x11"), ["list"], { env })).stdout,
      ).some(
        (w) =>
          w.pid === firefox.pid &&
          w.width > 800 &&
          w.height > 500 &&
          w.title.includes("Firefox"),
      );
    } catch {
      return false;
    }
  }, 30000);
  await wait(1000);
  const arms = ["baseline", "candidate-primitives", "candidate-sequence"],
    count = Number(process.env.CU_BENCH_SAMPLES ?? 20);
  for (let sample = 0; sample < count; sample++)
    for (const arm of sample % 2 ? [...arms].reverse() : arms) {
      const isBase = arm === "baseline",
        directory = join(out, arm + "-" + sample);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      service = await (isBase ? baseline : candidate).startDesktop({
        display,
        uid: process.getuid(),
        generation: "firefox-" + randomUUID(),
        helper: isBase
          ? join(out, "baseline-x11")
          : resolve("native/linux/build/cu-x11"),
        directory,
      });
      const credential = JSON.parse(await readFile(service.path, "utf8"));
      // Actual CLI processes call the authenticated broker; never print its credential.
      const cli = isBase ? join(base, "bin/cu.mjs") : join(root, "bin/cu.mjs");
      const call = async (method, args = {}) => {
        const { stdout } = await exec(
          process.execPath,
          [
            cli,
            "desktop-api",
            "call",
            "--display",
            display,
            "--method",
            method,
            "--args",
            JSON.stringify(args),
          ],
          { env, maxBuffer: 80 * 1024 * 1024, timeout: 30000 },
        );
        return JSON.parse(stdout);
      };
      const windows = await call("windows"),
        window = windows.find(
          (w) => w.pid === firefox.pid && w.width > 800 && w.height > 500,
        );
      if (!window) throw Error("Firefox window missing");
      if (process.env.CU_BENCH_DEBUG)
        console.error(JSON.stringify({ arm, window }));
      // Give both paths the same explicit focus and a warm broker before timing.
      let lease = await call("acquire", { ttlMs: 60000 }),
        obs = await call("observe", {
          target: { kind: "display" },
        });
      await call("input", {
        leaseId: lease.id,
        observationId: obs.observationId,
        action: { kind: "focus", windowId: window.id },
      });
      await wait(100);
      const stages = [];
      const timed = async (name, run) => {
        const t = performance.now();
        const value = await run();
        stages.push({ stage: name, ms: performance.now() - t });
        return value;
      };
      const started = performance.now();
      let status = "passed",
        error;
      try {
        // Two navigations mirror opening the console and inspecting a release. Each
        // has its own independently confirmed nonce and a final native observation.
        for (const page of ["dashboard", "release"]) {
          const nonce = randomUUID(),
            url =
              "http://127.0.0.1:" +
              server.address().port +
              "/" +
              page +
              "?nonce=" +
              nonce;
          if (arm === "candidate-sequence") {
            obs = await timed("observe", () =>
              call("observe", { target: { kind: "display" } }),
            );
            await timed("sequence", () =>
              call("sequence", {
                leaseId: lease.id,
                observationId: obs.observationId,
                field: "addressBar",
                text: url,
                submit: true,
              }),
            );
          } else
            for (const action of [
              { kind: "key", key: "Control+l" },
              { kind: "text", text: url },
              { kind: "key", key: "Enter" },
            ]) {
              obs = await timed("observe", () =>
                call("observe", { target: { kind: "display" } }),
              );
              // Caret and location-bar animations can invalidate a freshly captured frame.
              // Reobserve only on a certified not-dispatched failure, never unknown delivery.
              try {
                await timed("input:" + action.kind, () =>
                  call("input", {
                    leaseId: lease.id,
                    observationId: obs.observationId,
                    action,
                  }),
                );
              } catch (e) {
                if (
                  !String(e.stderr).includes("stale_observation") ||
                  !String(e.stderr).includes("notDispatched")
                )
                  throw e;
                await wait(80);
                obs = await call("observe", {
                  target: { kind: "display" },
                });
                await call("input", {
                  leaseId: lease.id,
                  observationId: obs.observationId,
                  action,
                });
              }
            }
          await timed("page-ready", () => until(() => observed.has(nonce)));
          obs = await timed("final-observe", () =>
            call("observe", { target: { kind: "display" } }),
          );
          if (!obs.image?.base64 || obs.image.width < 100)
            throw Error("Missing final screenshot");
          await writeFile(
            join(directory, page + ".png"),
            Buffer.from(obs.image.base64, "base64"),
          );
          const actual = JSON.parse(
            (
              await exec(resolve("native/linux/build/cu-x11"), ["list"], {
                env,
              })
            ).stdout,
          );
          if (
            !actual.some((w) => w.id === window.id && w.title.includes(nonce))
          )
            throw Error("Native Firefox title did not confirm navigation");
        }
      } catch (e) {
        status = "failed";
        error = String(e.stderr ?? e.message).slice(0, 600);
      }
      samples.push({
        competitor: arm,
        sample,
        status,
        elapsedMs: performance.now() - started,
        stages,
        ...(error ? { error } : {}),
      });
      await call("release", { leaseId: lease.id }).catch(() => {});
      await service.close();
      service = undefined;
    }
  const summary = arms.map((competitor) => {
    const all = samples.filter((s) => s.competitor === competitor),
      ok = all.filter((s) => s.status === "passed"),
      values = ok.map((s) => s.elapsedMs).sort((a, b) => a - b);
    return {
      competitor,
      passed: ok.length,
      attempts: all.length,
      meanMs: values.reduce((a, b) => a + b, 0) / values.length,
      medianMs:
        values.length % 2
          ? values[Math.floor(values.length / 2)]
          : (values[values.length / 2 - 1] + values[values.length / 2]) / 2,
      p95Ms: values[Math.ceil(values.length * 0.95) - 1],
    };
  });
  const comparable = samples.map((sample) => ({
    ...sample,
    task: "firefox-release-navigation",
    platform: process.platform,
    route: "ui",
    mode: "warm-native-cli",
    seed: 0,
    deadlineMs: 30000,
  }));
  const comparisons = ["candidate-primitives", "candidate-sequence"].map(
    (competitor) => ({
      competitor,
      ...bootstrapSpeedup(comparable, "baseline", competitor),
    }),
  );
  await writeFile(join(out, "report.html"), htmlReport(comparable));
  const result = {
    kind: "native-firefox-cli-benchmark",
    comparisons,
    baselineRevision: revision,
    candidateSourceSha256,
    candidateSources,
    createdAt: new Date().toISOString(),
    node: process.version,
    firefox: (
      await exec(
        process.env.TEST_FIREFOX_PATH ??
          "/snap/firefox/current/usr/lib/firefox/firefox",
        ["--version"],
      )
    ).stdout.trim(),
    resolution: process.env.CU_BENCH_RESOLUTION ?? "1920x1080",
    limits:
      "Isolated Firefox profile; synthetic read-only release dashboard; native CLI navigation and screenshots, no outer model or live Play latency. Startup excluded. No application writes.",
    samples,
    summary,
  };
  await writeFile(join(out, "samples.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ output: out, summary, comparisons }, null, 2));
  if (samples.some((s) => s.status !== "passed")) process.exitCode = 1;
} finally {
  await service?.close();
  firefox?.kill("SIGTERM");
  xvfb.kill("SIGTERM");
  server.close();
}
