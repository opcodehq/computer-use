import { Schema } from 'effect';

export const NodeSchema = Schema.Struct({
  visualSource: Schema.optional(Schema.Literals(['yolo','ocr'])), detectionConfidence: Schema.optional(Schema.Number),
  focused: Schema.optional(Schema.Boolean),
  frame: Schema.optional(Schema.Struct({ x: Schema.Number, y: Schema.Number, width: Schema.Number, height: Schema.Number })),
  ref: Schema.String, role: Schema.String, name: Schema.String,
  value: Schema.String, enabled: Schema.Boolean,
  actions: Schema.Array(Schema.String), depth: Schema.Number,
});
export const SnapshotSchema = Schema.Struct({
  visual: Schema.optional(Schema.Struct({ model: Schema.String, durationMs: Schema.Number, regionCount: Schema.Number, warning: Schema.optional(Schema.String) })),
  windowOnScreen: Schema.optional(Schema.Boolean), observationErrors: Schema.optional(Schema.Number), windowId: Schema.optional(Schema.Number), windowListed: Schema.optional(Schema.Boolean), capturedAt: Schema.optional(Schema.String),
  id: Schema.String, source: Schema.Literals(['ax', 'dom']),
  pid: Schema.Number, title: Schema.String,
  nodes: Schema.Array(NodeSchema), truncated: Schema.Boolean,
});
export type Snapshot = typeof SnapshotSchema.Type;
export const ActionSchema = Schema.Struct({
  kind: Schema.Literals(['visualClick', 'press', 'focus', 'setValue', 'insertText', 'key', 'click', 'clickElement', 'backgroundClick', 'backgroundKey', 'backgroundText', 'navigate']),
  ref: Schema.optional(Schema.String), text: Schema.optional(Schema.String),
  x: Schema.optional(Schema.Number), y: Schema.optional(Schema.Number),
});
export type Action = typeof ActionSchema.Type;
export const CandidateSchema = Schema.Struct({
  id: Schema.String, description: Schema.String, action: ActionSchema,
});
export type Candidate = typeof CandidateSchema.Type;
export const ProposalSchema = Schema.Struct({
  status: Schema.Literals(['act', 'done', 'blocked', 'vision']),
  explanation: Schema.String,
  candidates: Schema.Array(CandidateSchema),
});
export type Proposal = typeof ProposalSchema.Type;
export const StartSchema = Schema.Struct({
  goal: Schema.String, mode: Schema.Literals(['desktop', 'browser', 'jev']),
  localVisual: Schema.optional(Schema.Boolean), overlay: Schema.optional(Schema.Boolean), modelPath: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String), pid: Schema.Number, vision: Schema.Boolean, autoActions: Schema.Boolean,
});
export type Start = typeof StartSchema.Type;
export const ConfigSchema = Schema.Struct({
  typesafeKey: Schema.String, anthropicKey: Schema.String, model: Schema.String,
});
export type Config = typeof ConfigSchema.Type;
export type Event = { state: string; message: string; snapshot?: Snapshot; image?: string; imageFrame?: { x: number; y: number; width: number; height: number }; candidate?: Candidate };
export type AppInfo = { pid: number; name: string };
export type Status = { visual?: { ocr: boolean; modelInstalled: boolean; modelPath: string }; accessibility: boolean; screenRecording: boolean; platform: string; error?: string };
export interface DesktopAPI {
  connection(): Promise<{ configured: boolean; saved: boolean; path: string; error?: string }>;
  forgetKey(): Promise<void>;
  status(): Promise<Status>;
  apps(): Promise<AppInfo[]>;
  popout(): Promise<void>;
  preview(input: { pid: number; modelPath?: string; overlay: boolean }): Promise<void>;
  permission(kind: 'accessibility' | 'screenRecording'): Promise<void>;
  configure(config: Config): Promise<void>;
  start(input: Start): Promise<void>;
  stop(): Promise<void>;
  approve(): Promise<void>;
  onEvent(listener: (event: Event) => void): () => void;
}
