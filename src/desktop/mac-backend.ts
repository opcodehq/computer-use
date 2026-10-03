import { z } from "zod";
import type { DesktopBackend, Geometry } from "./backend.js";
import { type Action, failure, type Target } from "./protocol.js";

export interface MacDriver {
  request(
    method: string,
    args?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown>;
  close?(): void;
}
const GeometrySchema = z.object({
  id: z.number().int().positive(),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().int().positive().max(8192),
  height: z.number().int().positive().max(8192),
  pid: z.number().int().positive().optional(),
  title: z.string().optional(),
});
export class MacBackend implements DesktopBackend {
  readonly env = { DISPLAY: "macos" };
  readonly capabilities = {
    backend: "macos",
    resize: false as const,
    limitations: [
      "Requires macOS 14+, Screen Recording and Accessibility permissions for Opcode.",
      "Primary display only; physical input is serialized, participant cursors are overlays.",
      "Local applications and physical input bypass broker arbitration.",
    ],
  };
  private supportedKeys?: Promise<Set<string>>;
  constructor(readonly driver: MacDriver) {}
  async geometry(target: Target): Promise<Geometry> {
    return GeometrySchema.parse(
      await this.driver.request("desktopGeometry", { target }),
    );
  }
  async windows(): Promise<Geometry[]> {
    return z
      .array(GeometrySchema)
      .parse(await this.driver.request("desktopWindows"));
  }
  async apps() {
    return z
      .array(z.object({ id: z.string(), name: z.string() }))
      .parse(await this.driver.request("installedApps"));
  }
  async state() {
    return z
      .object({
        focus: z.number().int(),
        x: z.number().finite(),
        y: z.number().finite(),
      })
      .parse(await this.driver.request("desktopState"));
  }
  async capture(target: Target) {
    const result = z
      .object({
        geometry: GeometrySchema,
        base64: z.string().max(16_000_000),
        sample: z.string().max(16_384),
      })
      .parse(await this.driver.request("desktopCapture", { target }));
    const png = Buffer.from(result.base64, "base64");
    const sample = Buffer.from(result.sample, "base64");
    if (
      png.length < 24 ||
      !png
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      png.readUInt32BE(16) !== result.geometry.width ||
      png.readUInt32BE(20) !== result.geometry.height ||
      sample.length !== 64 * 48 * 4
    )
      throw failure(
        "display_unavailable",
        "Mac helper returned an invalid desktop frame.",
      );
    return { geometry: result.geometry, png, ppm: Buffer.alloc(0), sample };
  }
  async prepareAction(action: Action) {
    if (
      action.kind === "key" ||
      action.kind === "keyDown" ||
      action.kind === "keyUp"
    ) {
      // Query the native source of truth before the controller journals held input.
      this.supportedKeys ??= this.driver
        .request("desktopKeys")
        .then(
          (value) =>
            new Set(
              z.array(z.string().min(1).max(100)).min(1).max(256).parse(value),
            ),
        );
      const supported = await this.supportedKeys;
      const parts = action.key.split("+");
      const modifiers = new Set(["Meta", "Control", "Alt", "Shift"]);
      if (
        parts.some(
          (key) =>
            !supported.has(key) &&
            !(key.length === 1 && supported.has(key.toLowerCase())),
        ) ||
        (action.kind !== "key" && parts.length !== 1) ||
        parts.slice(0, -1).some((key) => !modifiers.has(key))
      )
        throw failure(
          "unsupported",
          "Unsupported Mac key or modifier combination.",
        );
    }
    return action;
  }
  async input(target: Target, action: Action, signal: AbortSignal) {
    signal.throwIfAborted();
    if (action.kind === "launch") {
      if (!(await this.apps()).some((app) => app.id === action.appId))
        throw failure("not_found", "Unknown installed app ID.");
      signal.throwIfAborted();
      await this.driver.request("launchApp", { appId: action.appId }, signal);
      return;
    }
    // Releases must remain possible after the originally observed window disappears.
    if (action.kind === "keyUp" || action.kind === "buttonUp")
      target = { kind: "display" };
    const geometry = await this.geometry(target);
    signal.throwIfAborted();
    await this.driver.request(
      "desktopInput",
      { target, action, expectedGeometry: geometry, foregroundApproved: true },
      signal,
    );
  }
  async resize(_width: number, _height: number): Promise<Geometry> {
    throw failure(
      "unsupported",
      "Resizing a physical Mac display is not supported.",
    );
  }
}
