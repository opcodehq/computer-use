import { z } from "zod";

const label = z.string().min(1).max(2000);
export const Target = z
  .object({
    role: label.optional(),
    name: label,
    match: z.enum(["exact", "contains"]).default("exact"),
  })
  .strict();
export type Target = z.infer<typeof Target>;
const ValuePart = z.union([
  z.object({ input: z.string().min(1) }).strict(),
  z.object({ literal: z.string().max(8000) }).strict(),
]);
export const Value = z.union([
  z.object({ input: z.string().min(1) }).strict(),
  z.object({ literal: z.string().max(8000) }).strict(),
  z.object({ parts: z.array(ValuePart).min(1).max(50) }).strict(),
]);
export type Value = z.infer<typeof Value>;
export const condition = z
  .object({
    target: Target,
    value: Value.optional(),
    absent: z.boolean().default(false),
    nonEmpty: z.boolean().default(false),
  })
  .strict();
const PrimitiveStep = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("action"),
      target: Target,
      operation: z.enum([
        "press",
        "setValue",
        "insertText",
        "key",
        "select",
        "doubleClick",
        "rightClick",
        "hover",
        "drag",
      ]),
      secondaryTarget: Target.optional(),
      value: Value.optional(),
      commit: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      kind: z.literal("wait"),
      condition,
      timeoutMs: z.number().int().min(0).max(30000).default(5000),
    })
    .strict(),
  z.object({ kind: z.literal("assert"), condition }).strict(),
  z
    .object({
      kind: z.literal("extract"),
      target: Target,
      output: z.string().regex(/^[a-z][a-zA-Z0-9_]*$/),
      field: z.enum(["name", "value"]).default("value"),
    })
    .strict(),
  z.object({ kind: z.literal("navigate"), url: Value }).strict(),
  z.object({ kind: z.literal("download"), outputPath: Value }).strict(),
  z
    .object({
      kind: z.literal("upload"),
      target: Target,
      paths: z.array(Value).min(1).max(10),
    })
    .strict(),
  z.object({ kind: z.literal("checkpoint"), reason: label }).strict(),
]);
export type Step =
  | z.infer<typeof PrimitiveStep>
  | {
      kind: "branch";
      condition: z.infer<typeof condition>;
      then: Step[];
      otherwise: Step[];
    }
  | {
      kind: "repeat";
      condition: z.infer<typeof condition>;
      steps: Step[];
      maxIterations: number;
    };
export const Step: z.ZodType<Step> = z.lazy(() =>
  z.union([
    PrimitiveStep,
    z
      .object({
        kind: z.literal("branch"),
        condition,
        then: z.array(Step).max(100),
        otherwise: z.array(Step).max(100),
      })
      .strict(),
    z
      .object({
        kind: z.literal("repeat"),
        condition,
        steps: z.array(Step).min(1).max(100),
        maxIterations: z.number().int().min(1).max(100),
      })
      .strict(),
  ]),
);
export function allSteps(steps: Step[]): Step[] {
  return steps.flatMap((s) => [
    s,
    ...("then" in s
      ? [...allSteps(s.then), ...allSteps(s.otherwise)]
      : "steps" in s
        ? allSteps(s.steps)
        : []),
  ]);
}
export const Workflow = z
  .object({
    version: z.literal(1),
    id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
    description: label,
    scope: z.discriminatedUnion("route", [
      z
        .object({
          route: z.literal("browser"),
          origin: z.url(),
          account: condition.optional(),
        })
        .strict(),
      z
        .object({
          route: z.literal("native"),
          app: label,
          account: condition.optional(),
        })
        .strict(),
    ]),
    effect: z.enum(["read", "write"]),
    notCommitted: condition.optional(),
    http: z
      .object({
        path: z.string().regex(/^\/(?!\/)[^?#]*$/),
        query: z.record(z.string(), Value).default({}),
        fields: z.record(z.string(), z.array(z.string()).max(10)),
      })
      .strict()
      .optional(),
    inputs: z.record(
      z.string().regex(/^[a-z][a-zA-Z0-9_]*$/),
      z
        .object({
          required: z.boolean().default(true),
          maxLength: z.number().int().min(1).max(8000).default(8000),
        })
        .strict(),
    ),
    outputs: z.array(z.string().regex(/^[a-z][a-zA-Z0-9_]*$/)).max(100),
    steps: z.array(Step).min(1).max(200),
  })
  .strict()
  .superRefine((workflow, ctx) => {
    if (
      workflow.scope.route === "browser" &&
      (!/^https?:\/\//.test(workflow.scope.origin) ||
        new URL(workflow.scope.origin).username ||
        new URL(workflow.scope.origin).password ||
        new URL(workflow.scope.origin).hash)
    )
      ctx.addIssue({
        code: "custom",
        message: "Browser scope requires HTTP(S).",
      });
    if (
      workflow.http &&
      (workflow.effect !== "read" || workflow.scope.route !== "browser")
    )
      ctx.addIssue({
        code: "custom",
        message: "HTTP acceleration is only for browser reads.",
      });
    const flat = allSteps(workflow.steps);
    if (flat.length > 200)
      ctx.addIssue({ code: "custom", message: "At most 200 authored steps." });
    const extracts = flat
      .filter((s) => s.kind === "extract")
      .map((s) => s.output);
    if (
      new Set(extracts).size !== extracts.length ||
      workflow.outputs.some((k) => !extracts.includes(k))
    )
      ctx.addIssue({
        code: "custom",
        message: "Outputs require unique extraction steps.",
      });
    if (workflow.steps.at(-1)?.kind !== "assert")
      ctx.addIssue({
        code: "custom",
        message: "The final step must assert the outcome.",
      });
    if (
      workflow.effect === "read" &&
      flat.some((s) => s.kind === "action" && s.commit)
    )
      ctx.addIssue({
        code: "custom",
        message: "Read workflow cannot declare a commit.",
      });
    if (
      workflow.effect === "write" &&
      !flat.some((s) => s.kind === "action" && s.commit)
    )
      ctx.addIssue({
        code: "custom",
        message: "Write workflow requires a declared commit.",
      });
    const values: (Value | undefined)[] = [
      workflow.scope.account?.value,
      workflow.notCommitted?.value,
      ...Object.values(workflow.http?.query ?? {}),
      ...flat.flatMap((step) =>
        "value" in step
          ? [step.value]
          : "condition" in step
            ? [step.condition.value]
            : step.kind === "navigate"
              ? [step.url]
              : step.kind === "download"
                ? [step.outputPath]
                : step.kind === "upload"
                  ? step.paths
                  : [],
      ),
    ];
    for (const value of values)
      for (const part of value && "parts" in value
        ? value.parts
        : value
          ? [value]
          : [])
        if ("input" in part && !Object.hasOwn(workflow.inputs, part.input))
          ctx.addIssue({
            code: "custom",
            message: "Undeclared input: " + part.input,
          });
  });
export type Workflow = z.infer<typeof Workflow>;
export type SurfaceNode = {
  ref: string;
  role: string;
  name: string;
  value: string;
  enabled: boolean;
};
export type Surface = {
  id: string;
  nodes: SurfaceNode[];
  truncated?: boolean;
  url?: string;
};
export interface WorkflowDriver {
  navigate?(url: string, signal: AbortSignal): Promise<void>;
  download?(path: string, signal: AbortSignal): Promise<void>;
  upload?(
    surface: Surface,
    node: SurfaceNode,
    paths: string[],
    signal: AbortSignal,
  ): Promise<void>;
  http?(url: string, signal: AbortSignal): Promise<unknown>;
  observe(signal: AbortSignal): Promise<Surface>;
  action(
    surface: Surface,
    node: SurfaceNode,
    step: Extract<Step, { kind: "action" }>,
    value: string | undefined,
    signal: AbortSignal,
  ): Promise<void>;
}
