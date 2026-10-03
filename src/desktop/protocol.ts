import { z } from "zod";
export const VERSION = 1;
export const scopes = [
  "observe",
  "viewer-read",
  "presence",
  "input-control",
  "recording-start",
  "recording-read",
  "recording-delete",
] as const;
export type Scope = (typeof scopes)[number];
export const Target = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("display") }),
  z.object({ kind: z.literal("window"), id: z.number().int().positive() }),
]);
export type Target = z.infer<typeof Target>;
export const Action = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["click", "doubleClick", "rightClick", "hover"]),
    x: z.number().finite(),
    y: z.number().finite(),
  }),
  z.object({
    kind: z.literal("drag"),
    x: z.number().finite(),
    y: z.number().finite(),
    toX: z.number().finite(),
    toY: z.number().finite(),
  }),
  z.object({
    kind: z.literal("scroll"),
    amount: z.number().int().min(-30).max(30),
    axis: z.enum(["x", "y"]).default("y"),
  }),
  z
    .object({
      kind: z.enum(["key", "keyDown", "keyUp"]),
      key: z
        .string()
        .regex(/^[a-zA-Z0-9_+]+$/)
        .max(100),
    })
    .refine(
      (a) => a.kind === "key" || !a.key.includes("+"),
      "Held keys must be single keys.",
    ),
  z.object({
    kind: z.enum(["buttonDown", "buttonUp"]),
    button: z.number().int().min(1).max(3),
  }),
  z.object({
    kind: z.literal("text"),
    pasteKey: z
      .enum(["Control+v", "Control+Shift+v", "Shift+Insert"])
      .optional(),
    text: z
      .string()
      .min(1)
      .max(8000)
      .refine((s) => !s.includes("\0")),
  }),
  z.object({
    kind: z.literal("launch"),
    appId: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[a-zA-Z0-9_.-]+$/),
  }),
  z.object({ kind: z.literal("focus"), windowId: z.number().int().positive() }),
]);
export type Action = z.infer<typeof Action>;
export const Request = z.object({
  id: z.string().min(1).max(128),
  method: z.string().min(1).max(64),
  generation: z.string().min(1).max(128),
  args: z.record(z.string(), z.unknown()).default({}),
});
export type Request = z.infer<typeof Request>;
export function failure(
  code: string,
  message: string,
  delivery = "notDispatched",
) {
  return Object.assign(new Error(message), { code, delivery });
}
export function errorJSON(e: unknown) {
  const error = e as Error & { code?: string; delivery?: string };
  return {
    code: error.code ?? "invalid_request",
    message: error.message ?? "Request failed",
    delivery: error.delivery ?? "notDispatched",
  };
}
export interface Observation {
  observationId: string;
  runtimeGeneration: string;
  displayId: string;
  displayEpoch: number;
  target: Target;
  capturedAt: string;
  capturedMonotonicMs: number;
  image: {
    mimeType: "image/png";
    width: number;
    height: number;
    base64: string;
  };
  desktopBounds: { x: number; y: number; width: number; height: number };
  imageToDesktop: { scaleX: 1; scaleY: 1; offsetX: number; offsetY: number };
  warnings: string[];
}

const leaseId = z.string().min(1);
export const Cursor = z.object({
  target: Target.optional(),
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
});
export interface Participant {
  id: string;
  subject: string;
  name: string;
  role: "human" | "agent";
  color: string;
  cursor: z.infer<typeof Cursor> | null;
  expiresAt: number;
}
const participantId = z.string().uuid();
const recordingId = z.object({ id: z.string().uuid() });
/** Tool metadata and runtime argument validation share these definitions. */
export const methodArguments = {
  health: z.object({}),
  apps: z.object({}),
  windows: z.object({}),
  state: z.object({}),
  observe: z.object({ target: Target.default({ kind: "display" }) }),
  "presence.join": z.object({
    name: z.string().trim().min(1).max(64).optional(),
    role: z.enum(["human", "agent"]).default("human"),
  }),
  "presence.update": z.object({
    participantId,
    cursor: Cursor.nullable().optional(),
  }),
  "presence.leave": z.object({ participantId }),
  "presence.list": z.object({}),
  acquire: z.object({
    participantId: participantId.optional(),
    ttlMs: z.number().int().min(1000).max(60000).default(30000),
  }),
  takeover: z.object({
    participantId: participantId.optional(),
    ttlMs: z.number().int().min(1000).max(60000).default(30000),
  }),
  renew: z.object({ leaseId }),
  release: z.object({ leaseId }),
  stop: z.object({}),
  input: z.object({
    leaseId,
    observationId: z.string().min(1),
    action: Action,
  }),
  resize: z.object({
    leaseId,
    width: z.number().int().min(320).max(4096),
    height: z.number().int().min(240).max(4096),
  }),
  "recording.start": z.object({
    target: Target.default({ kind: "display" }),
    fps: z.number().int().min(1).max(30).default(10),
    maxBytes: z.number().int().min(1000000).max(1073741824).default(100000000),
    maxSeconds: z.number().int().min(1).max(3600).default(300),
  }),
  "recording.pause": recordingId,
  "recording.resume": recordingId,
  "recording.stop": recordingId,
  "recording.delete": recordingId,
  "recording.list": z.object({}),
};
export function methodSchema(method: string) {
  const schema = methodArguments[method as keyof typeof methodArguments];
  return schema
    ? z.toJSONSchema(schema)
    : { type: "object", additionalProperties: true };
}
