import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  desktopCall,
  readCredential,
  serviceURL,
  writeCredential,
} from "./client.js";
import {
  errorJSON,
  failure,
  methodArguments,
  methodSchema,
} from "./protocol.js";
import { openSSHTunnel } from "./remote.js";
import { Config, registryPath, startDesktop } from "./server.js";

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
    endpoint: { type: "string" },
    ssh: { type: "string" },
    "remote-credential-file": { type: "string" },
    "local-port": { type: "string" },
    output: { type: "string" },
    subject: { type: "string" },
    role: { type: "string" },
    "ttl-ms": { type: "string" },
  },
});
const command = positionals[0];
const display =
  values.display ??
  (process.platform === "darwin" ? "macos" : process.env.DISPLAY);
async function descriptor() {
  if (!display && !values["credential-file"])
    throw failure("invalid_request", "Supply --display or --credential-file.");
  const path = values["credential-file"] ?? registryPath(display!);
  return readCredential(path);
}
async function call(
  method: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const d = await descriptor();
  return desktopCall(
    { ...d, generation: values.generation ?? d.generation },
    method,
    args,
    { id: values.id, signal },
  );
}

try {
  if (values.help || !command) {
    console.log(`Opcode shared desktop service (macOS / Linux X11, protocol 1)
cu desktop-api attach --display :N --generation HOST_GENERATION [--authority PATH]
cu desktop-api serve --config PATH
cu desktop-api call --display :N --method observe --args '{"target":{"kind":"display"}}'
cu desktop-api mcp --display :N
cu desktop-api attach --display macos --generation HOST_GENERATION
cu desktop-api share --display macos --subject alice --role controller --output /private/alice.json [--endpoint https://mac.tailnet.ts.net]
cu desktop-api viewer --credential-file /private/alice.json
cu desktop-api tunnel --ssh user@mac --remote-credential-file /private/alice.json --output /private/local-alice.json [--local-port 4311]
Keep tunnel running; use its output credential for MCP or the viewer.
Roles: viewer (watch and cursor), controller (watch, cursor, input), agent (observe and input).
Remote credentials use HTTPS or an authenticated loopback SSH tunnel.
Use --credential-file PATH for a scoped client instead of local host authority.
Raw capture does not use models. attach preserves the provider display.
serve owns only the broker; exit never destroys an attached display.`);
  } else if (command === "serve") {
    if (values["credential-file"])
      throw failure("invalid_request", "serve cannot use a remote credential.");
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
    if (values["credential-file"])
      throw failure(
        "invalid_request",
        "attach is local; use a scoped credential with call, mcp, or viewer.",
      );
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
      const info = await lstat(folder);
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        info.uid !== process.getuid?.() ||
        info.mode & 0o077
      )
        throw failure("permission_denied", "Unsafe broker directory.");
      const configPath = path + ".config";
      const configFile = await open(
        configPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        const metadata = await configFile.stat();
        if (
          !metadata.isFile() ||
          metadata.uid !== process.getuid?.() ||
          metadata.mode & 0o077
        )
          throw failure("permission_denied", "Unsafe broker config.");
        await configFile.truncate(0);
        await configFile.writeFile(JSON.stringify(config));
      } finally {
        await configFile.close();
      }
      const log = await open(
        path + ".log",
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_APPEND |
          constants.O_NOFOLLOW,
        0o600,
      );
      const logInfo = await log.stat();
      if (
        !logInfo.isFile() ||
        logInfo.uid !== process.getuid?.() ||
        logInfo.mode & 0o077
      ) {
        await log.close();
        throw failure("permission_denied", "Unsafe broker log.");
      }
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
  } else if (command === "tunnel") {
    if (!values.ssh || !values["remote-credential-file"] || !values.output)
      throw failure(
        "invalid_request",
        "Supply --ssh, --remote-credential-file and --output.",
      );
    const tunnel = await openSSHTunnel({
      host: values.ssh,
      remoteCredentialFile: values["remote-credential-file"],
      output: values.output,
      port: Number(values["local-port"] ?? 4311),
    });
    console.log(
      JSON.stringify({
        ready: true,
        endpoint: tunnel.endpoint,
        credentialFile: resolve(values.output),
      }),
    );
    const stop = () => void tunnel.close();
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    await tunnel.done;
    await tunnel.close();
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
  } else if (command === "share") {
    if (!values.subject || !values.output)
      throw failure(
        "invalid_request",
        "Supply --subject and --output for a private scoped credential.",
      );
    const role = values.role ?? "viewer";
    const roles: Record<string, string[]> = {
      viewer: ["viewer-read", "presence"],
      controller: ["viewer-read", "observe", "presence", "input-control"],
      agent: ["observe", "viewer-read", "presence", "input-control"],
    };
    if (!Object.hasOwn(roles, role))
      throw failure(
        "invalid_request",
        "Role must be viewer, controller, or agent.",
      );
    const d = await descriptor();
    const endpoint = serviceURL(values.endpoint ?? d.endpoint).href.replace(
      /\/$/,
      "",
    );
    const ttlMs = Number(values["ttl-ms"] ?? 3600000);
    if (!Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > 3600000)
      throw failure(
        "invalid_request",
        "--ttl-ms must be between 1000 and 3600000.",
      );
    const grant = (await call("grant", {
      subject: values.subject,
      scopes: roles[role],
      ttlMs,
    })) as { id: string; token: string; generation: string; expiresAt: number };
    try {
      await writeCredential(values.output, {
        endpoint,
        token: grant.token,
        generation: grant.generation,
      });
    } catch (error) {
      await call("revoke", { id: grant.id }).catch(() => {});
      throw error;
    }
    console.log(
      JSON.stringify({
        credentialFile: resolve(values.output),
        grantId: grant.id,
        role,
        expiresAt: grant.expiresAt,
        endpoint,
      }),
    );
  } else if (command === "viewer") {
    if (!values["credential-file"])
      throw failure(
        "permission_denied",
        "Use a scoped --credential-file created by share, never the host descriptor.",
      );
    const d = await descriptor();
    const sessionResponse = await fetch(
      d.endpoint.replace(/\/$/, "") + "/session",
      {
        headers: { Authorization: "Bearer " + d.token },
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      },
    );
    const session = (await sessionResponse.json()) as {
      admin?: boolean;
      scopes?: string[];
    };
    if (
      !sessionResponse.ok ||
      session.admin ||
      !session.scopes?.includes("viewer-read")
    )
      throw failure(
        "permission_denied",
        "A scoped viewer credential is required.",
      );
    await desktopCall(d, "presence.list", {});
    console.log(
      d.endpoint.replace(/\/$/, "") + "/view#" + encodeURIComponent(d.token),
    );
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
      "presence.list",
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
      "presence.list",
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
    let participant: { id: string } | undefined;
    let presenceEnabled = true;
    let presenceBusy = false;
    let closing = false;
    const observations = new Map<
      string,
      { target: unknown; image: { width: number; height: number } }
    >();
    async function heartbeat() {
      if (closing || !presenceEnabled || presenceBusy) return;
      presenceBusy = true;
      try {
        if (!participant)
          participant = (await call("presence.join", { role: "agent" })) as {
            id: string;
          };
        else await call("presence.update", { participantId: participant.id });
      } catch (error) {
        if ((error as { code?: string }).code === "permission_denied")
          presenceEnabled = false;
        participant = undefined;
      } finally {
        presenceBusy = false;
      }
    }
    await heartbeat();
    const presenceTimer = setInterval(() => void heartbeat(), 4000);
    presenceTimer.unref();
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const method = methods.find(
        (m) => "computer_" + m.replaceAll(".", "_") === request.params.name,
      );
      try {
        if (!method) throw failure("unsupported", "Unknown tool.");
        const args = { ...request.params.arguments };
        if (
          (method === "acquire" || method === "takeover") &&
          participant &&
          !args.participantId
        )
          args.participantId = participant.id;
        if (
          method === "input" &&
          participant &&
          typeof args.observationId === "string"
        ) {
          const observation = observations.get(args.observationId);
          const action = args.action as { x?: number; y?: number } | undefined;
          if (
            observation &&
            typeof action?.x === "number" &&
            typeof action.y === "number"
          ) {
            await call("presence.update", {
              participantId: participant.id,
              cursor: {
                x: action.x / observation.image.width,
                y: action.y / observation.image.height,
                target: observation.target,
              },
            }).catch(() => {});
          }
        }
        const result = await call(method, args, extra.signal);
        if (method === "acquire" || method === "takeover")
          ownedLease = (result as { id: string }).id;
        if (method === "release" || method === "stop") ownedLease = undefined;
        if (method === "observe") {
          const observed = result as {
            observationId: string;
            target: unknown;
            image: { width: number; height: number };
          };
          observations.set(observed.observationId, {
            target: observed.target,
            image: observed.image,
          });
          if (observations.size > 32)
            observations.delete(observations.keys().next().value!);
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
      closing = true;
      clearInterval(presenceTimer);
      if (participant)
        void call("presence.leave", { participantId: participant.id }).catch(
          () => {},
        );
      if (ownedLease)
        void call("release", { leaseId: ownedLease }).catch(() => {});
    };
    await server.connect(new StdioServerTransport());
  } else throw failure("unsupported", "Unknown desktop-api command.");
} catch (e) {
  console.error(JSON.stringify({ error: errorJSON(e) }));
  process.exitCode = 1;
}
