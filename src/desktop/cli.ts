import { parseArgs } from "node:util";
import { readFile, writeFile, mkdir, lstat, open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Config, startDesktop, registryPath } from "./server.js";
import {
  errorJSON,
  failure,
  methodSchema,
  methodArguments,
} from "./protocol.js";
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: "string" },
    display: { type: "string" },
    authority: { type: "string" },
    generation: { type: "string" },
    helper: { type: "string" },
    directory: { type: "string" },
    origin: { type: "string" },
    "base-path": { type: "string" },
    "credential-file": { type: "string" },
    method: { type: "string" },
    args: { type: "string" },
    id: { type: "string" },
    help: { type: "boolean" },
  },
});
const command = positionals[0];
const display = values.display ?? process.env.DISPLAY;
async function descriptor() {
  if (!display && !values["credential-file"])
    throw failure("invalid_request", "Supply --display or --credential-file.");
  const path = values["credential-file"] ?? registryPath(display!);
  const info = await lstat(path);
  if (
    info.isSymbolicLink() ||
    !info.isFile() ||
    info.uid !== process.getuid?.() ||
    info.mode & 0o077
  )
    throw failure(
      "permission_denied",
      "Credential file must be private and owned by this user.",
    );
  return JSON.parse(await readFile(path, "utf8")) as {
    endpoint: string;
    token: string;
    generation: string;
  };
}
async function call(
  method: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const d = await descriptor();
  const endpoint = new URL(d.endpoint);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname))
    throw failure(
      "permission_denied",
      "Use a trusted local proxy for remote service access.",
    );
  const request = {
    id: values.id ?? randomUUID(),
    generation: values.generation ?? d.generation,
    method,
    args,
  };
  const response = await fetch(d.endpoint + "/rpc", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + d.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    signal: signal ?? AbortSignal.timeout(20000),
  });
  const result = (await response.json()) as {
    ok: boolean;
    result: unknown;
    error?: { code: string; message: string; delivery: string };
  };
  if (!result.ok)
    throw Object.assign(new Error(result.error?.message), result.error);
  return result.result;
}
try {
  if (values.help || !command) {
    console.log(`Opcode display service (Linux X11, protocol 1)
cu desktop-api attach --display :N --generation HOST_GENERATION [--authority PATH]
cu desktop-api serve --config PATH
cu desktop-api call --display :N --method observe --args '{"target":{"kind":"display"}}'
cu desktop-api mcp --display :N
Use --credential-file PATH for a scoped client instead of local host authority.
Raw capture does not use models. attach preserves the provider display.
serve owns only the broker; exit never destroys an attached display.`);
  } else if (command === "serve") {
    if (!values.config) throw failure("invalid_request", "Supply --config.");
    const config = Config.parse(
      JSON.parse(await readFile(values.config, "utf8")),
    );
    const service = await startDesktop(config);
    console.log(
      JSON.stringify({
        ready: true,
        endpoint: service.endpoint,
        display: config.display,
        protocol: 1,
      }),
    );
    for (const sig of ["SIGTERM", "SIGINT"] as const)
      process.once(sig, () => void service.close().then(() => process.exit(0)));
  } else if (command === "attach") {
    if (!display || !values.generation)
      throw failure(
        "invalid_request",
        "Supply --display and a host lifecycle --generation.",
      );
    try {
      const d = await descriptor();
      const result = await call("health", {});
      console.log(
        JSON.stringify({ reused: true, endpoint: d.endpoint, health: result }),
      );
    } catch (e) {
      if ((e as { code?: string }).code === "generation_mismatch") throw e;
      const config = Config.parse({
        display,
        uid: process.getuid?.(),
        generation: values.generation,
        authority: values.authority ?? process.env.XAUTHORITY,
        helper:
          values.helper ??
          process.env.CU_X11_HELPER ??
          resolve(
            dirname(fileURLToPath(import.meta.url)),
            "../native/linux/build/cu-x11",
          ),
        directory: values.directory,
        origin: values.origin,
        basePath: values["base-path"] ?? "",
      });
      const path = registryPath(display),
        folder = dirname(path);
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const configPath = path + ".config";
      await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
      const log = await open(path + ".log", "a", 0o600);
      const child = spawn(
        process.execPath,
        [fileURLToPath(import.meta.url), "serve", "--config", configPath],
        { detached: true, stdio: ["ignore", log.fd, log.fd] },
      );
      child.on("error", () => {});
      child.unref();
      await log.close();
      let connected = false;
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 100));
        try {
          const health = await call("health", {});
          console.log(JSON.stringify({ attached: true, health }));
          connected = true;
          break;
        } catch {}
      }
      if (!connected)
        throw failure(
          "display_unavailable",
          "Broker did not become ready. Check the private broker log, display, user, authority and helper path.",
        );
    }
  } else if (command === "call") {
    if (!values.method) throw failure("invalid_request", "Supply --method.");
    console.log(
      JSON.stringify(
        await call(values.method, JSON.parse(values.args ?? "{}")),
      ),
    );
  } else if (command === "mcp") {
    const [
      { Server },
      { StdioServerTransport },
      { ListToolsRequestSchema, CallToolRequestSchema },
    ] = await Promise.all([
      import("@modelcontextprotocol/sdk/server/index.js"),
      import("@modelcontextprotocol/sdk/server/stdio.js"),
      import("@modelcontextprotocol/sdk/types.js"),
    ]);
    const methods = [
      "health",
      "apps",
      "windows",
      "observe",
      "state",
      "acquire",
      "renew",
      "release",
      "takeover",
      "input",
      "resize",
      "stop",
      "recording.start",
      "recording.pause",
      "recording.resume",
      "recording.stop",
      "recording.list",
      "recording.delete",
    ];
    const reads = new Set([
      "health",
      "apps",
      "windows",
      "observe",
      "state",
      "recording.list",
    ]);
    const server = new Server(
      { name: "opcode-desktop", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: methods.map((method) => ({
        name: "computer_" + method.replaceAll(".", "_"),
        description: reads.has(method)
          ? `Read ${method} from the shared display. Observe returns actual pixels and metadata.`
          : `${method} through the shared display controller. Input may change apps, files or send data; host authorization is required. Mutations require current lease and observation where applicable.`,
        inputSchema: methodSchema(method) as {
          type: "object";
          properties?: Record<string, unknown>;
        },
        annotations: {
          readOnlyHint: reads.has(method),
          destructiveHint: !reads.has(method),
          idempotentHint: reads.has(method),
        },
      })),
    }));
    let ownedLease: string | undefined;
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const method = methods.find(
        (m) => "computer_" + m.replaceAll(".", "_") === request.params.name,
      );
      try {
        if (!method) throw failure("unsupported", "Unknown tool.");
        const result = await call(
          method,
          request.params.arguments ?? {},
          extra.signal,
        );
        if (method === "acquire" || method === "takeover")
          ownedLease = (result as { id: string }).id;
        if (method === "release" || method === "stop") ownedLease = undefined;
        if (method === "observe") {
          const r = result as {
            image: { base64: string; mimeType: string };
            [key: string]: unknown;
          };
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ...r,
                  image: { ...r.image, base64: undefined },
                }),
              },
              {
                type: "image",
                data: r.image.base64,
                mimeType: r.image.mimeType,
              },
            ],
          };
        }
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (e) {
        if (extra.signal.aborted && ownedLease && !reads.has(method ?? "")) {
          await call("release", { leaseId: ownedLease }).catch(() => {});
          ownedLease = undefined;
        }
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify(errorJSON(e)) }],
        };
      }
    });
    server.onclose = () => {
      if (ownedLease)
        void call("release", { leaseId: ownedLease }).catch(() => {});
    };
    await server.connect(new StdioServerTransport());
  } else throw failure("unsupported", "Unknown desktop-api command.");
} catch (e) {
  console.error(JSON.stringify({ error: errorJSON(e) }));
  process.exitCode = 1;
}
