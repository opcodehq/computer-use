import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { z } from "zod";
import { browserFixture } from "./browser-fixture.js";
import { catalog } from "./catalog.js";
import { htmlReport, type Sample } from "./report.js";
const Config = z.object({
  output: z.string(),
  route: z.enum(["ui", "best"]),
  mode: z.enum(["first", "warm", "cold", "changed", "interrupted"]),
  samples: z.number().int().min(1).max(100).default(20),
  deadlineMs: z.number().int().min(1000).max(1200000).default(1200000),
  tasks: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z][a-z0-9-]{0,80}$/),
        instruction: z.string(),
        fixture: z.literal("browser").optional(),
        workspace: z.string(),
        expected: z
          .array(
            z.object({
              path: z.string(),
              sha256: z.string().regex(/^[a-f0-9]{64}$/),
            }),
          )
          .default([]),
        reset: z.array(z.string()).min(1).optional(),
      }),
    )
    .min(1),
  competitors: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z][a-z0-9-]{0,80}$/),
        command: z.array(z.string()).min(1),
        native: z.boolean().default(true),
      }),
    )
    .min(1),
});
async function command(
  argv: string[],
  input: unknown,
  deadlineMs: number,
  cwd: string,
  log: string,
) {
  return new Promise<{ ok: boolean; elapsedMs: number }>(
    (resolveResult, reject) => {
      const started = performance.now(),
        child = spawn(argv[0]!, argv.slice(1), {
          cwd,
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
          detached: process.platform !== "win32",
        });
      let output = Buffer.alloc(0),
        stderr = Buffer.alloc(0),
        expired = false;
      let hardTimer: ReturnType<typeof setTimeout> | undefined;
      const stop = () => {
        expired = true;
        try {
          if (child.pid) process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill();
        }
        hardTimer ??= setTimeout(() => {
          try {
            if (child.pid) process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        }, 500);
      };
      const timer = setTimeout(stop, deadlineMs);
      child.stdout.on("data", (b) => {
        if (output.length < 16000000) output = Buffer.concat([output, b]);
        else stop();
      });
      child.stderr.on("data", (b) => {
        if (stderr.length < 1000000) stderr = Buffer.concat([stderr, b]);
      });
      child.once("error", (e) => {
        clearTimeout(timer);
        if (hardTimer) clearTimeout(hardTimer);
        reject(e);
      });
      child.once("close", async (code) => {
        clearTimeout(timer);
        if (hardTimer) clearTimeout(hardTimer);
        await writeFile(log, output, { mode: 0o600 });
        await writeFile(log + ".stderr", stderr, { mode: 0o600 });
        resolveResult({
          ok: code === 0 && !expired,
          elapsedMs: performance.now() - started,
        });
      });
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify(input) + "\n");
    },
  );
}
export async function runBenchmark(value: unknown) {
  const config = Config.parse(value),
    output = resolve(config.output);
  await mkdir(output, { recursive: true, mode: 0o700 });
  const samples: Sample[] = [];
  const ports = new Map<string, number>();
  await writeFile(
    join(output, "manifest.json"),
    JSON.stringify(
      {
        config,
        platform: process.platform,
        node: process.version,
        createdAt: new Date().toISOString(),
        catalog,
        labels: { pomerado: "Pomerado OSS + Codex provider adapter" },
        cost: "unavailable",
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  for (const task of config.tasks)
    for (let n = 0; n < config.samples; n++)
      for (const competitor of n % 2
        ? [...config.competitors].reverse()
        : config.competitors) {
        const base = {
          task: task.id,
          competitor: competitor.id,
          platform: process.platform,
          route: config.route,
          mode: config.mode,
          seed: n % 3,
          sample: n,
          deadlineMs: config.deadlineMs,
        };
        if (!competitor.native && !task.id.startsWith("browser-")) {
          samples.push({ ...base, status: "unsupported", elapsedMs: 0 });
          continue;
        }
        const cwd = resolve(task.workspace),
          log = join(
            output,
            task.id + "-" + competitor.id + "-" + n + ".jsonl",
          );
        let fixture: Awaited<ReturnType<typeof browserFixture>> | undefined;
        try {
          await mkdir(cwd, { recursive: true });
          if (task.reset) {
            const reset = await command(
              task.reset,
              {},
              config.deadlineMs,
              cwd,
              log + ".reset",
            );
            if (!reset.ok) throw new Error("Task reset failed.");
          }
          if (task.fixture) {
            await rm(join(cwd, "result.json"), { force: true });
            await rm(join(cwd, "export.csv"), { force: true });
            fixture = await browserFixture(
              task.id.replace(/^browser-/, ""),
              cwd,
              n % 3,
              ports.get(task.id),
            );
            ports.set(task.id, Number(new URL(fixture.url).port));
          }
          const expectedFiles = fixture?.expected ?? task.expected;
          if (!expectedFiles.length)
            throw new Error("Independent evaluator required.");
          for (const expected of expectedFiles) {
            const path = resolve(cwd, expected.path);
            if (
              relative(cwd, path).startsWith("..") ||
              relative(cwd, path) === ""
            )
              throw new Error("Evaluator path outside workspace.");
            const existing = await readFile(path).catch(() => undefined);
            if (
              existing &&
              createHash("sha256").update(existing).digest("hex") ===
                expected.sha256
            )
              throw new Error("Reset already satisfies expected task output.");
          }
          const result = await command(
            competitor.command,
            {
              ...base,
              instruction:
                task.instruction +
                (fixture
                  ? " Open " +
                    fixture.url +
                    ". Exact fixture values: " +
                    JSON.stringify(fixture.values) +
                    (task.id === "browser-export"
                      ? ". Save the downloaded file to " +
                        join(cwd, "export.csv") +
                        "."
                      : ".")
                  : ""),
              workspace: cwd,
              policy:
                config.route === "ui"
                  ? "Use graphical controls only. No shell, direct HTTP, scripting or file writes to complete the task."
                  : "Use only task-authorized routes.",
            },
            config.deadlineMs,
            cwd,
            log,
          );
          let passed = result.ok;
          for (const expected of expectedFiles) {
            const path = resolve(cwd, expected.path);
            if (
              relative(cwd, path).startsWith("..") ||
              relative(cwd, path) === ""
            )
              throw new Error("Evaluator path outside fixture workspace.");
            try {
              passed &&=
                createHash("sha256")
                  .update(await readFile(path))
                  .digest("hex") === expected.sha256;
            } catch {
              passed = false;
            }
          }
          samples.push({
            ...base,
            status: passed ? "passed" : "failed",
            elapsedMs: result.elapsedMs,
          });
        } catch {
          samples.push({
            ...base,
            status: "infrastructure",
            elapsedMs: 0,
            reason:
              "Adapter, reset or prerequisite unavailable; inspect local logs.",
          });
        } finally {
          await fixture?.close();
        }
        await writeFile(
          join(output, "samples.json"),
          JSON.stringify(samples, null, 2),
          { mode: 0o600 },
        );
      }
  await writeFile(join(output, "report.html"), htmlReport(samples), {
    mode: 0o600,
  });
  return samples;
}
