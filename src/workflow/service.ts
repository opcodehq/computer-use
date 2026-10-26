import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { WorkflowStore, select } from "./runtime.js";
import { Workflow, type WorkflowDriver, type Surface } from "./contracts.js";

type Call = (
  method: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<unknown>;
const identity = { id: z.string(), revision: z.string() };
export const WorkflowRequest = z.discriminatedUnion("operation", [
  z
    .object({ operation: z.literal("register"), workflow: z.unknown() })
    .strict(),
  z.object({ operation: z.literal("find") }).strict(),
  z.object({ operation: z.literal("schema") }).strict(),
  z.object({ operation: z.literal("get"), ...identity }).strict(),
  z.object({ operation: z.literal("retire"), ...identity }).strict(),
  z.object({ operation: z.literal("recover"), ...identity }).strict(),
  z.object({ operation: z.literal("receipt"), runId: z.string() }).strict(),
  z
    .object({
      operation: z.enum(["run", "validate", "reconcile"]),
      ...identity,
      runId: z.string().optional(),
      input: z.record(z.string(), z.string()).default({}),
      pageId: z.string().optional(),
      windowId: z.number().int().positive().optional(),
      effect: z.enum(["read", "write"]),
      execution: z.enum(["ui", "best"]).default("ui"),
      noMatch: z.boolean().default(false),
    })
    .strict(),
]);
export function workflowService(
  native: Call,
  browser: Call,
  event: (state: string, message: string) => void,
  directory = process.env.CU_WORKFLOW_DIR ??
    join(homedir(), ".local/share/opcode-cu/workflows"),
) {
  const store = new WorkflowStore(directory);
  return async (
    args: Record<string, unknown>,
    signal = new AbortController().signal,
  ) => {
    const request = WorkflowRequest.parse(args);
    if (
      process.env.CU_BENCH_ROUTE === "ui" &&
      "execution" in request &&
      request.execution === "best"
    )
      throw new Error(
        "Best-route execution is disabled in UI-only benchmarks.",
      );
    if (request.operation === "register")
      return store.register(request.workflow);
    if (request.operation === "schema") return z.toJSONSchema(Workflow);
    if (request.operation === "find") return store.find();
    if (request.operation === "get")
      return store.get(request.id, request.revision);
    if (request.operation === "recover")
      return store.recover(request.id, request.revision);
    if (request.operation === "retire")
      return store.retire(request.id, request.revision);
    if (request.operation === "receipt") return store.receipt(request.runId);
    const { workflow } = await store.get(request.id, request.revision);
    const scope = workflow.scope;
    if (scope.route === "browser" && !request.pageId)
      throw new Error("Select the exact browser pageId for this invocation.");
    const driver: WorkflowDriver = {
      navigate:
        scope.route === "browser"
          ? async (url, signal) => {
              await browser(
                "browser",
                { operation: "navigate", pageId: request.pageId, url },
                signal,
              );
            }
          : undefined,
      download:
        scope.route === "browser"
          ? async (outputPath, signal) => {
              const downloads = (await browser(
                "browser",
                { operation: "downloads" },
                signal,
              )) as { id: string; pageId: string }[];
              const candidates = downloads.filter(
                (d) => d.pageId === request.pageId,
              );
              if (candidates.length !== 1)
                throw new Error("Download is missing or ambiguous.");
              await browser(
                "browser",
                {
                  operation: "download",
                  pageId: request.pageId,
                  downloadId: candidates[0]!.id,
                  outputPath,
                },
                signal,
              );
            }
          : undefined,
      upload:
        scope.route === "browser"
          ? async (surface, node, paths, signal) => {
              await browser(
                "browser",
                {
                  operation: "upload",
                  pageId: request.pageId,
                  snapshotId: surface.id,
                  ref: node.ref,
                  paths,
                },
                signal,
              );
            }
          : undefined,
      http:
        scope.route === "browser"
          ? (url, signal) =>
              browser(
                "browser",
                { operation: "readJson", pageId: request.pageId, url },
                signal,
              )
          : undefined,
      observe: async (signal) => {
        if (scope.route === "browser") {
          const result = (await browser(
            "browser",
            { operation: "observe", pageId: request.pageId },
            signal,
          )) as {
            snapshotId: string;
            url: string;
            nodes: Surface["nodes"];
            truncated: boolean;
          };
          return {
            id: result.snapshotId,
            url: result.url,
            nodes: result.nodes.filter((node: any) => node.visible !== false),
            truncated: result.truncated,
          };
        }
        return native(
          "observe",
          { app: scope.app, windowId: request.windowId },
          signal,
        ) as Promise<Surface>;
      },
      action: async (surface, node, step, value, signal) => {
        if (node.value === "[secure]")
          throw new Error(
            "Secret fields require host-mediated entry outside a saved workflow.",
          );
        if (scope.route === "browser") {
          await browser(
            "browser",
            {
              operation:
                step.operation === "press"
                  ? "click"
                  : step.operation === "setValue"
                    ? "fill"
                    : step.operation,
              pageId: request.pageId,
              snapshotId: surface.id,
              ref: node.ref,
              targetRef: step.secondaryTarget
                ? select(surface, step.secondaryTarget).ref
                : undefined,
              text: value,
              key: value,
              value,
            },
            signal,
          );
        } else {
          if (
            ["doubleClick", "rightClick", "hover", "drag"].includes(
              step.operation,
            )
          ) {
            await native(
              "pointer",
              {
                app: scope.app,
                windowId: request.windowId,
                snapshotId: surface.id,
                ref: node.ref,
                targetRef: step.secondaryTarget
                  ? select(surface, step.secondaryTarget).ref
                  : undefined,
                gesture: step.operation,
              },
              signal,
            );
            return;
          }
          if (step.operation === "select")
            throw new Error(
              "Native selection needs a recipe using the app’s actual menu controls.",
            );
          await native(
            step.operation === "key" ? "key" : "execute",
            {
              app: scope.app,
              windowId: request.windowId,
              snapshotId: surface.id,
              ref: node.ref,
              operation: step.operation,
              text: value,
              key: value,
            },
            signal,
          );
        }
      },
    };
    if (request.operation === "reconcile") {
      if (!request.runId) throw new Error("Supply the original runId.");
      const receipt = await store.receipt(request.runId);
      if (
        receipt.workflowId !== request.id ||
        receipt.revision !== request.revision
      )
        throw new Error("Run revision mismatch.");
      return store.reconcile(request.runId, request.input, driver, signal);
    }
    return store.run(request.id, request.revision, request.input, driver, {
      signal,
      effect: request.effect,
      validate: request.operation === "validate",
      noMatch: request.noMatch,
      execution: request.execution,
      event: (receipt) =>
        event(
          receipt.status === "running" ? "acting" : receipt.status,
          `Workflow ${workflow.id}: ${receipt.completed}/${workflow.steps.length} steps; ${receipt.status}`,
        ),
    });
  };
}
