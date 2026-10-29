import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
test("workflow CLI separates transport flags from strict requests in one-shot and persistent sessions", { timeout: 30000 }, async () => {
  await mkdir(".context", { recursive: true });
  const directory = await mkdtemp(
      join(process.cwd(), ".context/workflow-cli-"),
    ),
    cli = join(directory, "cli.mjs"),
    session = "wfl-" + Date.now();
  const env = { ...process.env, CU_WORKFLOW_DIR: join(directory, "store") };
  try {
    await build({
      entryPoints: ["src/tool/cli.ts"],
      outfile: cli,
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
    });
    const run = (args: string[]) =>
      JSON.parse(
        execFileSync("node", [cli, ...args], { env, encoding: "utf8" }),
      );
    const schema = run([
      "workflow",
      "--no-preview",
      "--input-json",
      '{"operation":"schema"}',
    ]);
    assert.equal(schema.properties.version.const, 1);
    const found = run([
      "workflow",
      "--session",
      session,
      "--no-preview",
      "--input-json",
      '{"operation":"find"}',
    ]);
    assert.deepEqual(found, []);
    run(["stop", "--session", session]);
  } finally {
    try {
      execFileSync("node", [cli, "stop", "--session", session], {
        env,
        stdio: "ignore",
      });
    } catch {}
    await rm(directory, { recursive: true, force: true });
  }
});
