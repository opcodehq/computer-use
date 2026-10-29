#!/usr/bin/env node
// JSONL benchmark competitor. In UI mode only the selected CU MCP is available.
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { chromium } from "playwright-core";
let browser, profile;
let endpoint;

const request = JSON.parse(readFileSync(0, "utf8"));
const cli = process.env.CU_BENCH_CLI;
if (!cli)
  throw Error("Set CU_BENCH_CLI to the exact baseline/candidate dist/cli.mjs.");
if (request.task?.startsWith("browser-")) {
  profile = await mkdtemp(join(tmpdir(), "cu-benchmark-browser-"));
  browser = spawn(
    process.env.TEST_CHROME_PATH ?? chromium.executablePath(),
    [
      "--headless=new",
      "--no-sandbox",
      "--remote-debugging-port=0",
      "--user-data-dir=" + profile,
      "--no-first-run",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let failed = false;
  browser.once("error", () => {
    failed = true;
  });
  for (let i = 0; i < 100 && !endpoint && !failed; i++) {
    const port = (
      await readFile(join(profile, "DevToolsActivePort"), "utf8").catch(
        () => "",
      )
    ).split("\n")[0];
    if (port) endpoint = "http://127.0.0.1:" + port;
    else await new Promise((r) => setTimeout(r, 100));
  }
  if (!endpoint) {
    browser.kill();
    await rm(profile, { recursive: true, force: true });
    throw Error("Benchmark browser could not start. Set TEST_CHROME_PATH.");
  }
}
const model = process.env.CU_BENCH_MODEL ?? "gpt-6.1-sol";
const args = [
  "exec",
  "--ignore-user-config",
  "--ignore-rules",
  "--ephemeral",
  "--skip-git-repo-check",
  "--sandbox",
  "read-only",
  "--model",
  model,
  "-c",
  'model_reasoning_effort="medium"',
  "-c",
  'approval_policy="never"',
  "-c",
  "features.shell_tool=false",
  "-c",
  "-c",
  "mcp_servers.cu.command=" + JSON.stringify(process.execPath),
  "-c",
  "mcp_servers.cu.args=" + JSON.stringify([resolve(cli), "mcp"]),
  "-c",
  "mcp_servers.cu.env_vars=" +
    JSON.stringify([
      "DISPLAY",
      "DBUS_SESSION_BUS_ADDRESS",
      "CU_LINUX_DESKTOP",
      "CU_NATIVE_DIR",
      "CU_WORKFLOWS",
      "CU_WORKFLOW_DIR",
      "CU_X11_HELPER",
      "CU_BROWSER_NO_SANDBOX",
      "CU_BENCH_ROUTE",
    ]),
  "-c",
  "mcp_servers.cu.required=true",
  "-c",
  'mcp_servers.cu.tools.desktop_browser.approval_mode="approve"',
  "-c",
  'mcp_servers.cu.tools.desktop_workflow.approval_mode="approve"',
  "--json",
  JSON.stringify({
    instruction: request.instruction,
    policy: request.policy,
    mode: request.mode,
    seed: request.seed,
    workspace: request.workspace,
    browser: endpoint
      ? {
          instruction:
            "Attach desktop_browser to this explicit local endpoint, select its returned pageId, then navigate to the task URL. Use this browser only; do not open another.",
          endpoint,
        }
      : undefined,
    completion:
      "Complete the requested task and verify its persisted result. Use only the provided CU MCP tools. No shell, built-in browser, plugins, file-edit tools or outside helpers.",
  }),
];
const child = spawn("codex", args, {
  cwd: request.workspace,
  stdio: "inherit",
  env: {
    ...process.env,
    CU_BENCH_ROUTE: request.route,
    CU_WORKFLOW_DIR: join(
      request.workspace,
      ".workflows",
      request.competitor,
      request.mode === "first" ? String(request.sample) : "repeat",
    ),
  },
  shell: false,
});
child.once("error", () => {
  process.exitCode = 1;
  browser?.kill();
});
child.once("exit", async (code) => {
  process.exitCode = code ?? 1;
  browser?.kill();
  if (profile) {
    await new Promise((r) => setTimeout(r, 200));
    await rm(profile, { recursive: true, force: true });
  }
});
for (const s of ["SIGTERM", "SIGINT"])
  process.on(s, () => {
    child.kill(s);
    browser?.kill(s);
  });
