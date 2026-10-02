import { createServer, type Server } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Event } from "../shared/contracts.js";
import { viewerHTML } from "./ui.js";
export type ViewerCallbacks = {
  capture(): Promise<Buffer>;
  status?(): Record<string, unknown>;
  binding?(): string;
  pause(): void;
  resume(): Promise<unknown>;
  input(action: Record<string, unknown>): Promise<unknown>;
};
export class DesktopViewer {
  private server?: Server;
  private viewToken = randomBytes(32).toString("hex");
  private controlToken = randomBytes(32).toString("hex");
  private frame?: Buffer;
  private frameId = "";
  private frameBinding = "";
  private frames = new Map<string, { binding: string; at: number }>();
  private capturing?: Promise<Buffer>;
  private lastFrame = 0;
  private state: Record<string, unknown> = {
    state: "waiting",
    message: "Waiting for an observation.",
    owner: "agent",
  };
  private origin = "";
  private closed = false;
  constructor(private callbacks: ViewerCallbacks) {}
  activity(message: string, pointer?: { x: number; y: number }) {
    this.state = {
      ...this.state,
      message,
      state: "acting",
      pointer,
      pointerAt: Date.now(),
    };
  }
  event(event: Event) {
    const node = event.snapshot?.nodes.find(
      (n) => n.ref === event.candidate?.action.ref,
    );
    const frame = event.snapshot?.nodes.find(
      (n) => n.role === "AXWindow",
    )?.frame;
    this.state = {
      ...this.state,
      pointerAt: Date.now(),
      state: event.state,
      message: event.message,
      title: event.snapshot?.title ?? this.state.title,
      pointer: node?.frame
        ? {
            x: node.frame.x - (frame?.x ?? 0) + node.frame.width / 2,
            y: node.frame.y - (frame?.y ?? 0) + node.frame.height / 2,
            width: node.frame.width,
            height: node.frame.height,
          }
        : undefined,
    };
  }
  private matches(a: string, b: string) {
    return (
      Buffer.byteLength(a) === Buffer.byteLength(b) &&
      timingSafeEqual(Buffer.from(a), Buffer.from(b))
    );
  }
  async open() {
    if (this.server) return this.info();
    this.server = createServer(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      const route = req.url?.split("?")[0];
      if (route === "/" && req.method === "GET") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'self'; img-src 'self' blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self'",
        );
        res.end(viewerHTML);
        return;
      }
      const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      const control = this.matches(token, this.controlToken);
      if (!control && !this.matches(token, this.viewToken)) {
        res.writeHead(401);
        res.end("Viewer token required");
        return;
      }
      const origin = process.env.CU_VIEWER_ORIGIN ?? this.origin;
      if (req.headers.origin && req.headers.origin !== origin) {
        res.writeHead(403);
        res.end("Origin mismatch");
        return;
      }
      try {
        if (req.method === "GET" && route === "/api/state") {
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              ...this.state,
              ...this.callbacks.status?.(),
              canControl: control,
              frameAt: this.lastFrame,
            }),
          );
          return;
        }
        if (req.method === "GET" && route === "/api/frame") {
          if (
            !this.capturing &&
            (!this.frame ||
              Date.now() - this.lastFrame > 180 ||
              this.frameBinding !== (this.callbacks.binding?.() ?? "default"))
          ) {
            const binding = this.callbacks.binding?.() ?? "default";
            this.capturing = this.callbacks
              .capture()
              .then((frame) => {
                if (binding !== (this.callbacks.binding?.() ?? "default"))
                  throw new Error("Viewer target changed during capture.");
                this.frameBinding = binding;
                this.frameId = randomBytes(16).toString("hex");
                this.frames.set(this.frameId, { binding, at: Date.now() });
                if (this.frames.size > 32)
                  this.frames.delete(this.frames.keys().next().value!);
                this.frame = frame;
                this.lastFrame = Date.now();
                return frame;
              })
              .finally(() => (this.capturing = undefined));
          }
          const frame = await (this.capturing ?? Promise.resolve(this.frame!));
          res.setHeader("X-CU-Frame", this.frameId);
          res.setHeader(
            "Content-Type",
            frame[0] === 0x89 ? "image/png" : "image/jpeg",
          );
          res.end(frame);
          return;
        }
        if (req.method !== "POST" || !control) {
          res.writeHead(403);
          res.end("Control token required");
          return;
        }
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 24000) throw new Error("Request too large");
        }
        const input = body ? JSON.parse(body) : {};
        if (route === "/api/takeover") {
          this.callbacks.pause();
          this.state.owner = "human";
          this.state.state = "stopped";
          this.state.message = "Agent paused. You control this window.";
        } else if (route === "/api/resume") {
          await this.callbacks.resume();
          this.state.owner = "agent";
          this.state.state = "waiting";
          this.state.message =
            "Agent control restored. Waiting for fresh observation.";
        } else if (route === "/api/input") {
          if (this.state.owner !== "human")
            throw new Error("Take control before sending input.");
          const frame = this.frames.get(String(input.frameId));
          if (
            !frame ||
            Date.now() - frame.at > 5000 ||
            frame.binding !== (this.callbacks.binding?.() ?? "default")
          )
            throw new Error(
              "Stale viewer frame. Wait for the live view to refresh.",
            );
          await this.callbacks.input(input);
          this.frame = undefined;
          if (Number.isFinite(input.x) && Number.isFinite(input.y))
            this.state.pointer = {
              x: input.x,
              y: input.y,
              width: 0,
              height: 0,
            };
        } else {
          res.writeHead(404);
          res.end();
          return;
        }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, owner: this.state.owner }));
      } catch (error) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error:
              error instanceof Error
                ? error.message
                : "Viewer operation failed",
          }),
        );
      }
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing viewer address.");
    this.origin = "http://127.0.0.1:" + address.port;
    return this.info();
  }
  info() {
    return {
      url: this.origin + "/#" + this.controlToken,
      shareUrl: this.origin + "/#" + this.viewToken,
      transport: "http-frame-stream",
      binding: "loopback",
      sharing: "read-only bearer link",
    };
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
  }
}
