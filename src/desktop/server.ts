import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createServer as httpServer, type Server } from "node:http";
import { createServer as socketServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { X11Backend } from "./backend.js";
import { DesktopController } from "./controller.js";
import { MacBackend, type MacDriver } from "./mac-backend.js";
import { connectMacDriver } from "./mac-driver.js";
import { errorJSON, failure, Request, scopes, Target } from "./protocol.js";
import { desktopHTML } from "./view.js";
export const Config = z.object({
  display: z.string().regex(/^(?:macos|(?:unix)?:(\d+)(?:\.(\d+))?)$/),
  authority: z.string().optional(),
  uid: z.number().int().nonnegative(),
  generation: z.string().min(1).max(128),
  helper: z.string().default(""),
  directory: z.string().optional(),
  origin: z.string().url().optional(),
  basePath: z
    .string()
    .regex(/^(?:\/[a-zA-Z0-9_-]+)*$/)
    .default(""),
});
export type Config = z.infer<typeof Config>;
export { registryPath } from "./registry.js";

import { canonical, displayKey, registryPath } from "./registry.js";
export async function startDesktop(input: z.input<typeof Config>) {
  const config = Config.parse(input);
  const mac = config.display === "macos";
  if (mac ? process.platform !== "darwin" : process.platform !== "linux")
    throw failure(
      "unsupported",
      "Use display macos on macOS, or a local X11 display on Linux.",
    );
  if (!mac && !config.helper)
    throw failure("invalid_request", "Linux requires an X11 helper path.");
  if (config.uid !== process.getuid?.())
    throw failure(
      "permission_denied",
      "Configured display user differs from the service user.",
    );
  if (!mac && config.authority)
    await stat(config.authority).catch(() => {
      throw failure("permission_denied", "Xauthority file is unavailable.");
    });
  const display = canonical(config.display),
    path = registryPath(display),
    lock = socketServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    lock.once("error", () =>
      reject(
        failure(
          "lease_conflict",
          "A broker already owns this display. Reuse its endpoint.",
        ),
      ),
    );
    // Linux keeps its namespace-wide abstract X11 reservation. Mac ownership is
    // acquired below through the persistent native helper connection and flock.
    if (mac) resolve();
    else
      lock.listen(
        "\0opcode-desktop-" +
          createHash("sha256").update(display).digest("hex").slice(0, 24),
        resolve,
      );
  });
  let startupController: DesktopController | undefined;
  let startupDriver: MacDriver | undefined;
  let startupServer: Server | undefined;
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const directoryInfo = await lstat(dirname(path));
    if (
      !directoryInfo.isDirectory() ||
      directoryInfo.isSymbolicLink() ||
      directoryInfo.uid !== process.getuid?.() ||
      directoryInfo.mode & 0o077
    ) {
      lock.close();
      throw failure("permission_denied", "Unsafe broker directory.");
    }
    const directory =
      config.directory ??
      join(homedir(), ".local/state/opcode/recordings", displayKey(display));
    const macDriver = mac ? await connectMacDriver() : undefined;
    startupDriver = macDriver;
    if (macDriver) {
      z.object({ locked: z.literal(true) }).parse(
        await macDriver.request("desktopLock"),
      );
      const status = z
        .object({ accessibility: z.boolean(), screenRecording: z.boolean() })
        .parse(await macDriver.request("status"));
      if (!status.accessibility || !status.screenRecording)
        throw failure(
          "permission_denied",
          "Enable Accessibility and Screen Recording for the installed Opcode helper, then attach again.",
        );
    }
    const backend = macDriver
      ? new MacBackend(macDriver)
      : new X11Backend(config.helper, {
          ...process.env,
          DISPLAY: display,
          ...(config.authority ? { XAUTHORITY: config.authority } : {}),
        });
    const controller = new DesktopController(
      backend,
      config.generation,
      directory,
    );
    startupController = controller;
    let closed = false;
    await controller.init();
    const master = randomBytes(32).toString("hex");
    let host = controller.authority.issue("host", [...scopes], 3600000);
    let inFlight = 0;
    const base = config.basePath;
    const authenticate = (
      header: string | undefined,
      scope?: (typeof scopes)[number],
    ) => {
      const token = header?.replace(/^Bearer /, "") ?? "";
      const admin =
        token.length === master.length &&
        timingSafeEqual(Buffer.from(token), Buffer.from(master));
      if (admin) {
        try {
          controller.authority.verify(host.token);
        } catch {
          host = controller.authority.issue("host", [...scopes], 3600000);
        }
        return { grant: controller.authority.verify(host.token, scope), admin };
      }
      return { grant: controller.authority.verify(token, scope), admin: false };
    };
    const server = httpServer(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Content-Type-Options", "nosniff");
      const send = (status: number, value: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(value));
      };
      let counted = false;
      const finished = () => {
        if (counted) {
          counted = false;
          inFlight--;
        }
      };
      res.once("finish", finished);
      res.once("close", finished);
      try {
        const expected = req.headers.origin;
        const allowed =
          !expected || expected === origin || expected === config.origin;
        if (!allowed)
          throw failure("permission_denied", "Origin is not allowed.");
        if (expected && allowed) {
          res.setHeader("Access-Control-Allow-Origin", expected);
          res.setHeader("Vary", "Origin");
        }
        const url = new URL(req.url ?? "/", origin);
        const route = url.pathname;
        if (route === base + "/view" && req.method === "GET") {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader(
            "Content-Security-Policy",
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; frame-ancestors " +
              (config.origin ?? "'self'"),
          );
          res.end(desktopHTML(base));
          return;
        }
        if (req.method === "OPTIONS") {
          res.writeHead(204, {
            "Access-Control-Allow-Headers": "Authorization, Content-Type",
            "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          });
          res.end();
          return;
        }
        const { grant, admin } = authenticate(req.headers.authorization);
        if (route === base + "/session") {
          send(200, {
            generation: controller.generation,
            protocol: 1,
            scopes: grant.scopes,
            admin,
            subject: grant.subject,
          });
          return;
        }
        if (route === base + "/frame" && req.method === "GET") {
          authenticate(req.headers.authorization, "viewer-read");
          if (inFlight >= 32)
            throw failure("overloaded", "Too many concurrent requests.");
          inFlight++;
          counted = true;
          const windowId = url.searchParams.get("windowId");
          const target = Target.parse(
            windowId === null
              ? { kind: "display" }
              : { kind: "window", id: Number(windowId) },
          );
          const frame = await controller.observe(grant, target);
          authenticate(req.headers.authorization, "viewer-read");
          send(200, {
            ...frame,
            ...controller.multiplayerState(),
            recording: controller.recorder
              .list()
              .filter((r) => r.state === "recording" || r.state === "paused")
              .map(({ id, state }) => ({ id, state })),
          });
          return;
        }
        if (route.startsWith(base + "/artifacts/") && req.method === "GET") {
          authenticate(req.headers.authorization, "recording-read");
          const id = route.slice((base + "/artifacts/").length);
          if (!/^[a-f0-9-]{36}$/.test(id))
            throw failure("not_found", "Artifact not found.");
          const file = controller.recorder.path(id),
            info = await stat(file);
          let start = 0,
            end = info.size - 1;
          if (req.headers.range) {
            const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
            if (!match)
              throw failure("invalid_range", "Use one explicit byte range.");
            start = +match[1];
            end = match[2] ? +match[2] : end;
            if (start > end || end >= info.size) {
              res.writeHead(416, { "Content-Range": `bytes */${info.size}` });
              res.end();
              return;
            }
          }
          res.writeHead(req.headers.range ? 206 : 200, {
            "Content-Type": "video/mp4",
            "Accept-Ranges": "bytes",
            "Content-Length": end - start + 1,
            "Content-Disposition": `attachment; filename="${id}.mp4"`,
            ...(req.headers.range
              ? { "Content-Range": `bytes ${start}-${end}/${info.size}` }
              : {}),
          });
          const stream = createReadStream(file, { start, end });
          const timer = setInterval(() => {
            try {
              authenticate(req.headers.authorization, "recording-read");
            } catch {
              stream.destroy();
              res.destroy();
            }
          }, 100);
          stream.on("error", () => res.destroy());
          res.on("close", () => {
            clearInterval(timer);
            stream.destroy();
          });
          stream.pipe(res);
          return;
        }
        if (route !== base + "/rpc" || req.method !== "POST")
          throw failure("not_found", "Route not found.");
        let body = "";
        for await (const chunk of req) {
          body += chunk.toString();
          if (Buffer.byteLength(body) > 128000)
            throw failure("invalid_request", "Request exceeds 128 KB.");
        }
        const request = Request.parse(JSON.parse(body));
        if (request.method === "shutdown") {
          if (!admin)
            throw failure("permission_denied", "Host authority required.");
          if (request.generation !== controller.generation)
            throw failure("generation_mismatch", "Lifecycle mismatch.");
          send(200, {
            ok: true,
            protocol: 1,
            generation: controller.generation,
            result: { stopping: true },
          });
          setImmediate(() => void close());
          return;
        }
        const priority = [
          "stop",
          "takeover",
          "release",
          "rebind",
          "revoke",
        ].includes(request.method);
        if (inFlight >= 32 && !priority)
          throw failure("overloaded", "Request limit reached.");
        inFlight++;
        counted = true;
        res.once("close", () => {
          if (!res.writableEnded && request.method === "input")
            void controller.cancelGrantInput(grant.id).catch(() => {});
        });
        const result = await controller.call(request, grant, admin);
        if (
          request.method !== "rebind" &&
          request.generation !== controller.generation
        )
          throw failure(
            "generation_mismatch",
            "Lifecycle changed during the operation.",
            [
              "health",
              "state",
              "apps",
              "windows",
              "observe",
              "presence.list",
              "recording.list",
            ].includes(request.method)
              ? "notDispatched"
              : "unknown",
          );
        if (request.method === "rebind") {
          descriptor.generation = controller.generation;
          await writeFile(path, JSON.stringify(descriptor), { mode: 0o600 });
        }
        send(200, {
          ok: true,
          protocol: 1,
          generation: controller.generation,
          result,
        });
      } catch (e) {
        if (!res.headersSent)
          send(
            (e as { code?: string }).code === "permission_denied" ? 403 : 400,
            { ok: false, error: errorJSON(e) },
          );
        else res.destroy();
      } finally {
        if (res.writableFinished || res.destroyed) finished();
      }
    });
    startupServer = server;
    server.maxConnections = 64;

    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw Error("No listener");
    const origin = `http://127.0.0.1:${address.port}`;
    const descriptor = {
      protocol: 1,
      display,
      generation: controller.generation,
      endpoint: origin + base,
      token: master,
      pid: process.pid,
    };
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const dirInfo = await lstat(dirname(path));
    if (
      !dirInfo.isDirectory() ||
      dirInfo.isSymbolicLink() ||
      dirInfo.uid !== process.getuid?.() ||
      dirInfo.mode & 0o077
    )
      throw failure("permission_denied", "Unsafe broker directory.");
    await writeFile(path, JSON.stringify(descriptor), { mode: 0o600 });
    await chmod(path, 0o600);
    const close = async () => {
      if (closed) return;
      closed = true;
      await controller.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      // A lost Mac helper connection can release flock before HTTP teardown.
      // Never unlink its descriptor here: a successor may already have replaced
      // it. A stale private descriptor is probed on attach and replaced by the
      // next owner, exactly as after an abrupt process exit.
      if (!mac) await unlink(path).catch(() => {});
      macDriver?.close?.();
      lock.close();
    };
    return { controller, endpoint: descriptor.endpoint, path, close };
  } catch (error) {
    await startupController?.close().catch(() => {});
    startupServer?.closeAllConnections();
    if (startupServer?.listening)
      await new Promise<void>((resolve) =>
        startupServer!.close(() => resolve()),
      );
    startupDriver?.close?.();
    lock.close();
    throw error;
  }
}
