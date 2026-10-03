import { spawn, execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const installed =
  process.env.CU_TEST_INSTALL ??
  (await readFile(".context/core-install-path", "utf8")).trim();
const bin = join(installed, "node_modules/@opcodehq/cu/bin/cu.mjs");
const xvfb = spawn(
  "Xvfb",
  ["-displayfd", "3", "-screen", "0", "840x640x24", "-nolisten", "tcp", "-ac"],
  { stdio: ["ignore", "ignore", "ignore", "pipe"] },
);
const n = await new Promise((resolve) => {
  let s = "";
  xvfb.stdio[3].on("data", (b) => {
    s += b;
    if (s.includes("\n")) resolve(s.trim());
  });
});
const display = ":" + n,
  env = { ...process.env, CU_NATIVE_DIR: join(installed, "runtime") };
const cli = (...args) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [bin, "desktop-api", ...args, "--display", display],
      { env, encoding: "utf8", timeout: 15000, maxBuffer: 8000000 },
    ),
  );
let mcp,
  other,
  shutdown = false;
try {
  const attached = cli("attach", "--generation", "packed-test");
  assert.equal(attached.health.geometry.width, 840);
  assert.equal(cli("attach", "--generation", "packed-test").reused, true);
  const raw = cli("call", "--method", "observe");
  assert.equal(raw.image.height, 640);
  assert.equal(
    Buffer.from(raw.image.base64, "base64").subarray(1, 4).toString(),
    "PNG",
  );
  mcp = new Client({ name: "packed-test", version: "1" }, { capabilities: {} });
  await mcp.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [bin, "desktop-api", "mcp", "--display", display],
      env,
      stderr: "pipe",
    }),
  );
  const tools = await mcp.listTools();
  assert(
    tools.tools.find((t) => t.name === "computer_input").inputSchema.properties
      .action,
  );
  const observed = await mcp.callTool({
    name: "computer_observe",
    arguments: {},
  });
  assert(
    observed.content.some(
      (c) => c.type === "image" && c.mimeType === "image/png",
    ),
  );
  const acquired = await mcp.callTool({
    name: "computer_acquire",
    arguments: {},
  });
  assert(!acquired.isError);
  other = new Client(
    { name: "second-client", version: "1" },
    { capabilities: {} },
  );
  await other.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [bin, "desktop-api", "mcp", "--display", display],
      env,
      stderr: "pipe",
    }),
  );
  assert.equal(
    (await other.callTool({ name: "computer_acquire", arguments: {} })).isError,
    true,
  );
  await mcp.close();
  await other.close();
  cli("call", "--method", "shutdown");
  shutdown = true;
  const existing = JSON.parse(
    execFileSync(join(installed, "runtime/cu-x11"), ["display"], {
      env: { ...env, DISPLAY: display },
      encoding: "utf8",
    }),
  );
  assert.equal(existing.width, 840);
  console.log(
    "PASS packed minimal Node CLI, same-display attach/reuse, PNG, MCP image, shared ownership across two MCP clients, shutdown preserves X server",
  );
} finally {
  await mcp?.close().catch(() => {});
  await other?.close().catch(() => {});
  try {
    if (!shutdown) cli("call", "--method", "shutdown");
  } catch {}
  xvfb.kill();
}
