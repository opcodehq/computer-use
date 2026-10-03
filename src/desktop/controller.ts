import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { Authority, type Grant } from "./authority.js";
import type { DesktopBackend, Geometry } from "./backend.js";
import { Presence } from "./presence.js";
import {
  Action,
  failure,
  methodArguments,
  type Observation,
  type Request,
  scopes,
  Target,
} from "./protocol.js";
import { Recorder } from "./recording.js";

type Lease = {
  id: string;
  grantId: string;
  participantId?: string;
  subject: string;
  owner: "human" | "agent";
  epoch: number;
  expiresAt: number;
};
type Frame = Awaited<ReturnType<DesktopBackend["capture"]>>;
export class DesktopController {
  readonly authority: Authority;
  readonly recorder: Recorder;
  readonly presence: Presence;
  private epoch = 1;
  private geometryKey = "";
  private lease?: Lease;
  private fenced = false;
  private closed = false;
  private retryFenceAt = 0;
  private observations = new Map<
    string,
    {
      value: Observation;
      geometry: Geometry;
      focus: number;
      grantId: string;
      at: number;
      epoch: number;
      sample: Buffer;
    }
  >();
  private frame?: { key: string; value: Frame; at: number };
  private captureFlight?: Promise<Frame>;
  private captureKey = "";
  private tail: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private active?: { abort: AbortController; done: Promise<unknown> };
  private heldKeys = new Set<string>();
  private heldButtons = new Set<number>();
  private cache = new Map<string, { hash: string; result: Promise<unknown> }>();
  private timer: ReturnType<typeof setInterval>;
  private recorderGrant?: string;
  constructor(
    readonly backend: DesktopBackend,
    generation: string,
    private directory: string,
  ) {
    this.authority = new Authority(generation);
    this.presence = new Presence(this.authority);
    this.recorder = new Recorder(directory, (t) => this.capture(t));
    this.timer = setInterval(() => {
      this.presence.sweep();
      if (this.fenced && !this.fenceTask && Date.now() >= this.retryFenceAt)
        void this.fence().catch(() => {});
      if (
        this.lease &&
        (this.lease.expiresAt <= Date.now() ||
          !this.authority.valid(this.lease.grantId) ||
          (this.lease.participantId !== undefined &&
            !this.presence.has(this.lease.participantId)))
      )
        void this.fence().catch(() => {});
      if (this.recorderGrant && !this.authority.valid(this.recorderGrant)) {
        this.recorderGrant = undefined;
        void this.recorder.fence().catch(() => {});
      }
    }, 100);
    this.timer.unref();
  }
  get generation() {
    return this.authority.generation;
  }
  async init() {
    await this.recorder.init();
    try {
      const held = JSON.parse(
        await readFile(join(this.directory, "held-input.json"), "utf8"),
      );
      for (const key of z
        .array(
          z
            .string()
            .regex(/^[a-zA-Z0-9_]+$/)
            .max(100),
        )
        .max(256)
        .parse(held.keys))
        this.heldKeys.add(key);
      for (const button of z
        .array(z.number().int().min(1).max(3))
        .max(3)
        .parse(held.buttons))
        this.heldButtons.add(button);
      await this.fence();
    } catch (e) {
      if ((e as { code?: string }).code !== "ENOENT") throw e;
    }
    await this.capture({ kind: "display" });
  }
  private async persistHeld() {
    const path = join(this.directory, "held-input.json");
    await writeFile(
      path + ".tmp",
      JSON.stringify({
        keys: [...this.heldKeys],
        buttons: [...this.heldButtons],
      }),
      { mode: 0o600 },
    );
    await rename(path + ".tmp", path);
  }

  async capture(target: Target): Promise<Frame> {
    const key = JSON.stringify(target);
    if (this.frame?.key === key && performance.now() - this.frame.at < 100)
      return this.frame.value;
    if (this.captureFlight) {
      if (this.captureKey === key) return this.captureFlight;
      await this.captureFlight;
      return this.capture(target);
    }
    this.captureKey = key;
    const task = this.backend.capture(target);
    this.captureFlight = task;
    try {
      const value = await task;
      const geometryKey = JSON.stringify(
        await this.backend.geometry({ kind: "display" }),
      );
      if (this.geometryKey && geometryKey !== this.geometryKey) {
        this.epoch++;
        this.observations.clear();
      }
      this.geometryKey = geometryKey;
      this.frame = { key, value, at: performance.now() };
      return value;
    } finally {
      if (this.captureFlight === task) this.captureFlight = undefined;
    }
  }
  async observe(grant: Grant, target: Target): Promise<Observation> {
    const { png, geometry, sample } = await this.capture(target);
    const focus = (await this.backend.state()).focus;
    const value: Observation = {
      observationId: randomUUID(),
      runtimeGeneration: this.generation,
      displayId: this.backend.env.DISPLAY ?? "unknown",
      displayEpoch: this.epoch,
      target,
      capturedAt: new Date().toISOString(),
      capturedMonotonicMs: performance.now(),
      image: {
        mimeType: "image/png",
        width: geometry.width,
        height: geometry.height,
        base64: png.toString("base64"),
      },
      desktopBounds: {
        x: geometry.x,
        y: geometry.y,
        width: geometry.width,
        height: geometry.height,
      },
      imageToDesktop: {
        scaleX: 1,
        scaleY: 1,
        offsetX: geometry.x,
        offsetY: geometry.y,
      },
      warnings: ["Raw pixels; no detector or accessibility enrichment."],
    };
    this.observations.set(value.observationId, {
      value: { ...value, image: { ...value.image, base64: "" } },
      geometry,
      focus,
      grantId: grant.id,
      at: performance.now(),
      epoch: this.epoch,
      sample,
    });
    // Bound each credential independently so one fast viewer cannot evict every
    // other participant's observation before their input reaches the broker.
    let grantCount = 0;
    for (const record of this.observations.values())
      if (record.grantId === grant.id) grantCount++;
    for (const [id, record] of this.observations) {
      if (
        performance.now() - record.at > 30000 ||
        (record.grantId === grant.id && grantCount > 8)
      ) {
        this.observations.delete(id);
        if (record.grantId === grant.id) grantCount--;
      }
    }
    while (this.observations.size > 512)
      this.observations.delete(this.observations.keys().next().value!);
    return value;
  }
  private fenceTask?: Promise<void>;
  async fence() {
    if (this.fenceTask) return this.fenceTask;
    this.fenced = true;
    this.retryFenceAt = Date.now() + 1000;
    this.epoch++;
    this.lease = undefined;
    this.observations.clear();
    this.active?.abort.abort();
    const task = (async () => {
      await this.active?.done.catch(() => {});
      const abort = new AbortController();
      const deadline = setTimeout(() => abort.abort(), 10000);
      try {
        for (const key of this.heldKeys) {
          if (abort.signal.aborted) break;
          try {
            await this.backend.input(
              { kind: "display" },
              { kind: "keyUp", key },
              abort.signal,
            );
            this.heldKeys.delete(key);
          } catch {
            /* Preserve failed releases in the recovery journal. */
          }
        }
        for (const button of this.heldButtons) {
          if (abort.signal.aborted) break;
          try {
            await this.backend.input(
              { kind: "display" },
              { kind: "buttonUp", button },
              abort.signal,
            );
            this.heldButtons.delete(button);
          } catch {
            /* Preserve failed releases in the recovery journal. */
          }
        }
        await this.persistHeld();
        if (this.heldKeys.size || this.heldButtons.size)
          throw failure(
            "input_cleanup_failed",
            "Held input could not be released. Control remains blocked until cleanup or service recovery succeeds.",
            "unknown",
          );
        this.fenced = false;
      } finally {
        clearTimeout(deadline);
      }
    })();
    this.fenceTask = task;
    try {
      await task;
    } finally {
      this.fenceTask = undefined;
    }
  }
  private requireLease(grant: Grant, id: unknown) {
    if (
      this.closed ||
      this.fenced ||
      !this.lease ||
      this.lease.id !== id ||
      this.lease.grantId !== grant.id ||
      !this.authority.valid(grant.id) ||
      this.lease.expiresAt <= Date.now() ||
      (this.lease.participantId !== undefined &&
        !this.presence.has(this.lease.participantId))
    )
      throw failure(
        "lease_revoked",
        "Acquire control and observe fresh state.",
      );
    return this.lease;
  }
  async action(grant: Grant, args: Record<string, unknown>) {
    const lease = this.requireLease(grant, args.leaseId);
    const admitted = lease.epoch;
    let action = Action.parse(args.action);
    const observationId = z.string().parse(args.observationId);
    if (this.queued >= 16) throw failure("overloaded", "Input queue is full.");
    this.queued++;
    const job = this.tail
      .catch(() => {})
      .then(async () => {
        this.authority.valid(grant.id) ||
          (() => {
            throw failure(
              "permission_denied",
              "Credential expired or revoked.",
            );
          })();
        const currentLease = this.requireLease(grant, args.leaseId);
        if (currentLease.epoch !== admitted)
          throw failure("lease_revoked", "Control changed before delivery.");
        const record = this.observations.get(observationId);
        if (
          !record ||
          record.grantId !== grant.id ||
          record.epoch !== this.epoch ||
          performance.now() - record.at > 30000
        )
          throw failure(
            "stale_observation",
            "Observe again with the current grant and lease.",
          );
        const geometry = await this.backend.geometry(record.value.target);
        if (JSON.stringify(geometry) !== JSON.stringify(record.geometry))
          throw failure("stale_observation", "Target geometry changed.");
        this.frame = undefined;
        const fresh = await this.capture(record.value.target);
        let difference = 0;
        for (let i = 0; i < record.sample.length; i++)
          difference += Math.abs(record.sample[i]! - fresh.sample[i]!);
        if (difference / record.sample.length > 8)
          throw failure(
            "stale_observation",
            "Screen changed substantially. Observe again.",
          );
        if ((await this.backend.state()).focus !== record.focus)
          throw failure(
            "stale_observation",
            "Keyboard focus changed. Observe again.",
          );
        if ("x" in action) {
          for (const [x, y] of [
            [action.x, action.y],
            ...(action.kind === "drag" ? [[action.toX, action.toY]] : []),
          ])
            if (
              x! < 0 ||
              y! < 0 ||
              x! >= geometry.width ||
              y! >= geometry.height
            )
              throw failure(
                "invalid_coordinates",
                "Coordinates must be inside the delivered image.",
              );
        }
        action = await this.backend.prepareAction(action);
        // Recheck after asynchronous preparation: takeover may have fenced this call.
        this.requireLease(grant, args.leaseId);
        if (admitted !== this.epoch)
          throw failure(
            "lease_revoked",
            "Input was cancelled before dispatch.",
          );
        this.observations.delete(observationId);
        const abort = new AbortController();
        let finish!: () => void;
        const done = new Promise<void>((resolve) => (finish = resolve));
        this.active = { abort, done };
        const deadline = setTimeout(
          () => abort.abort(),
          Math.max(1, Math.min(10000, currentLease.expiresAt - Date.now())),
        );
        if (action.kind === "keyDown") this.heldKeys.add(action.key);
        if (action.kind === "buttonDown") this.heldButtons.add(action.button);
        const transientButtons = ["click", "doubleClick", "drag"].includes(
          action.kind,
        )
          ? [1]
          : action.kind === "rightClick"
            ? [3]
            : [];
        const transientKeys =
          action.kind === "key"
            ? action.key.split("+")
            : action.kind === "text"
              ? (action.pasteKey ?? "Control+v").split("+")
              : [];
        for (const button of transientButtons) this.heldButtons.add(button);
        for (const key of transientKeys) this.heldKeys.add(key);
        let failed = false;
        try {
          await this.persistHeld();
          await this.backend.input(record.value.target, action, abort.signal);
          for (const button of transientButtons)
            this.heldButtons.delete(button);
          for (const key of transientKeys) this.heldKeys.delete(key);
          if (action.kind === "keyUp") this.heldKeys.delete(action.key);
          if (action.kind === "buttonUp")
            this.heldButtons.delete(action.button);
          await this.persistHeld();
          return {
            delivery: "dispatchedUnverified",
            next: "Observe to verify application outcome.",
          };
        } catch {
          failed = true;
          throw failure(
            "outcome_unknown",
            "Input may have been delivered. Observe before deciding what to do; do not replay automatically.",
            "unknown",
          );
        } finally {
          clearTimeout(deadline);
          finish();
          this.active = undefined;
          this.frame = undefined;
          if (failed) await this.fence().catch(() => {});
        }
      })
      .finally(() => this.queued--);
    this.tail = job;
    return job;
  }
  async call(request: Request, grant: Grant, admin = false): Promise<unknown> {
    if (this.closed)
      throw failure("service_closed", "Desktop service is closing.");
    if (request.generation !== this.generation)
      throw failure("generation_mismatch", "Host rebind required.");
    if (!admin && !this.authority.valid(grant.id))
      throw failure("permission_denied", "Credential expired or revoked.");
    const methods: Record<string, (typeof scopes)[number]> = {
      health: "observe",
      apps: "observe",
      windows: "observe",
      observe: "observe",
      state: "viewer-read",
      "presence.list": "viewer-read",
      "presence.join": "presence",
      "presence.update": "presence",
      "presence.leave": "presence",
      acquire: "input-control",
      renew: "input-control",
      release: "input-control",
      takeover: "input-control",
      input: "input-control",
      resize: "input-control",
      stop: "input-control",
      "recording.start": "recording-start",
      "recording.pause": "recording-start",
      "recording.resume": "recording-start",
      "recording.stop": "recording-start",
      "recording.list": "recording-read",
      "recording.delete": "recording-delete",
    };
    const scope = methods[request.method];
    if (scope && !grant.scopes.includes(scope))
      throw failure("permission_denied", "Required scope: " + scope);
    if (!scope && !admin)
      throw failure("permission_denied", "Host authority required.");
    if (
      [
        "observe",
        "health",
        "state",
        "presence.list",
        "presence.update",
        "windows",
        "apps",
        "recording.list",
      ].includes(request.method)
    )
      return this.run(request, grant, admin);
    const key = grant.id + ":" + request.id,
      hash = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    const previous = this.cache.get(key);
    if (previous) {
      if (previous.hash !== hash)
        throw failure(
          "invalid_request",
          "Request ID reused with different content.",
        );
      return previous.result;
    }
    const result = this.run(request, grant, admin);
    this.cache.set(key, { hash, result });
    while (this.cache.size > 512)
      this.cache.delete(this.cache.keys().next().value!);
    return result;
  }
  private async run(r: Request, g: Grant, admin: boolean): Promise<unknown> {
    const schema = methodArguments[r.method as keyof typeof methodArguments];
    const a: Record<string, unknown> = schema ? schema.parse(r.args) : r.args;
    switch (r.method) {
      case "health": {
        const frame = await this.capture({ kind: "display" });
        return {
          protocol: 1,
          displayId: this.backend.env.DISPLAY ?? "unknown",
          generation: this.generation,
          displayEpoch: this.epoch,
          backend: this.backend.capabilities?.backend ?? "x11",
          mode: "attach",
          geometry: frame.geometry,
          rawCapture: true,
          perception: false,
          recording: await this.recorder.available(),
          input: true,
          multiplayer: {
            presence: true,
            cursorSpace: "normalized-target",
            maxParticipants: 64,
            heartbeatMs: 5000,
            participantTtlMs: 15000,
            inputOwners: 1,
          },
          resize: this.backend.capabilities?.resize ?? "randr-dependent",
          coordinateSpace: "image-pixels",
          limitations: this.backend.capabilities?.limitations ?? [
            "No Wayland, audio or synchronized multi-monitor.",
            "External X clients bypass application arbitration.",
          ],
        };
      }
      case "apps":
        return (await this.backend.apps()).map(({ id, name }) => ({
          id,
          name,
        }));
      case "windows":
        return this.backend.windows();
      case "observe":
        return this.observe(g, Target.parse(a.target ?? { kind: "display" }));
      case "presence.join":
        return this.presence.join(
          g,
          a.name as string | undefined,
          a.role as "human" | "agent",
        );
      case "presence.update":
        return this.presence.update(
          g,
          a.participantId as string,
          a.cursor as { x: number; y: number } | null | undefined,
        );
      case "presence.leave": {
        const id = a.participantId as string;
        this.presence.leave(g, id);
        if (this.lease?.participantId === id) await this.fence();
        return { left: true };
      }
      case "presence.list":
        return this.multiplayerState();
      case "state":
        return {
          ...this.multiplayerState(),
          lease: this.controllerState(),
          displayEpoch: this.epoch,
          recordings: this.recorder
            .list()
            .map(({ id, state }) => ({ id, state })),
        };
      case "acquire":
      case "takeover": {
        const participantId = a.participantId as string | undefined;
        if (participantId) this.presence.require(g, participantId);
        if (this.fenced)
          throw failure("lease_conflict", "Control transition is in progress.");
        if (
          this.lease &&
          r.method === "acquire" &&
          this.lease.expiresAt > Date.now()
        )
          throw failure("lease_conflict", "Display already has a controller.");
        await this.fence();
        if (this.closed || (!this.authority.valid(g.id) && !admin))
          throw failure(
            "permission_denied",
            "Credential expired during takeover.",
          );
        if (participantId) this.presence.require(g, participantId);
        this.lease = {
          participantId,
          id: randomUUID(),
          grantId: g.id,
          subject: g.subject,
          owner: r.method === "takeover" ? "human" : "agent",
          epoch: this.epoch,
          expiresAt: Math.min(
            g.expiresAt,
            Date.now() +
              z
                .number()
                .int()
                .min(1000)
                .max(60000)
                .parse(a.ttlMs ?? 30000),
          ),
        };
        return { ...this.lease };
      }
      case "renew": {
        const lease = this.requireLease(g, a.leaseId);
        lease.expiresAt = Math.min(g.expiresAt, Date.now() + 30000);
        return { ...lease };
      }
      case "release":
        this.requireLease(g, a.leaseId);
        await this.fence();
        return { released: true };
      case "stop":
        await this.fence();
        return { stopped: true };
      case "input":
        return this.action(g, a);
      case "resize": {
        this.requireLease(g, a.leaseId);
        await this.fence();
        const geometry = await this.backend.resize(
          z.number().int().min(320).max(4096).parse(a.width),
          z.number().int().min(240).max(4096).parse(a.height),
        );
        this.frame = undefined;
        return { geometry, next: "Acquire a new lease and observation." };
      }
      case "grant":
        if (!admin) break;
        return this.authority.issue(
          z.string().min(1).max(128).parse(a.subject),
          z.array(z.enum(scopes)).min(1).parse(a.scopes),
          z
            .number()
            .int()
            .min(1000)
            .max(3600000)
            .parse(a.ttlMs ?? 300000),
        );
      case "revoke":
        if (!admin) break;
        {
          const id = z.string().parse(a.id);
          this.authority.revoke(id);
          if (this.lease?.grantId === id) await this.fence();
          if (this.recorderGrant === id) await this.recorder.fence();
          return { revoked: true };
        }
      case "rebind":
        if (!admin) break;
        {
          const next = z.string().min(1).max(128).parse(a.generation);
          if (next === this.generation)
            throw failure(
              "generation_mismatch",
              "Rebind must use a new host lifecycle generation.",
            );
          await this.fence();
          await this.recorder.fence();
          this.authority.rebind(next);
          this.presence.clear();
          this.frame = undefined;
          this.cache.clear();
          return { generation: next };
        }
      case "recording.start": {
        const recording = await this.recorder.start(
          this.generation,
          Target.parse(a.target ?? { kind: "display" }),
          {
            fps: z
              .number()
              .int()
              .min(1)
              .max(30)
              .parse(a.fps ?? 10),
            maxBytes: z
              .number()
              .int()
              .min(1000000)
              .max(1073741824)
              .parse(a.maxBytes ?? 100000000),
            maxSeconds: z
              .number()
              .int()
              .min(1)
              .max(3600)
              .parse(a.maxSeconds ?? 300),
          },
        );
        if (!this.authority.valid(g.id) || g.generation !== this.generation) {
          await this.recorder.stop(recording.id);
          throw failure(
            "permission_denied",
            "Recording authority changed during startup.",
          );
        }
        this.recorderGrant = g.id;
        return recording;
      }
      case "recording.pause":
        return this.recorder.pause(z.string().parse(a.id));
      case "recording.resume":
        return this.recorder.resume(z.string().parse(a.id));
      case "recording.stop":
        return this.recorder.stop(z.string().parse(a.id));
      case "recording.list":
        return this.recorder.list();
      case "recording.delete":
        return this.recorder.delete(z.string().parse(a.id));
    }
    throw failure("unsupported", "Unsupported desktop operation.");
  }
  private controllerState() {
    if (
      !this.lease ||
      this.lease.expiresAt <= Date.now() ||
      !this.authority.valid(this.lease.grantId) ||
      (this.lease.participantId !== undefined &&
        !this.presence.has(this.lease.participantId))
    )
      return null;
    const { owner, subject, participantId, expiresAt } = this.lease;
    return { owner, subject, participantId, expiresAt };
  }
  multiplayerState() {
    return {
      participants: this.presence.list(),
      controller: this.controllerState(),
    };
  }
  async cancelGrantInput(grantId: string) {
    if (this.lease?.grantId === grantId) await this.fence();
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.presence.clear();
    await Promise.allSettled([this.fence(), this.recorder.fence()]);
  }
}
