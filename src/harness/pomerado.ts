import { CodexClient, CodexConversation, type HarnessTool } from "./codex.js";

/** Structural @openai/agents ModelProvider. No dependency on a second copy of the SDK.
 * Deliberately refuses unsupported provider semantics instead of silently approximating them.
 * Benchmarks using this provider MUST be labeled modified Pomerado.
 */
export function codexPomeradoProvider(
  diagnostics?: (event: {
    model: string;
    status: string;
    toolTypes?: string[];
    reason?: string;
  }) => void,
  makeConversation: (
    model: string,
  ) => Pick<CodexConversation, "next" | "close"> = (model) =>
    new CodexConversation(new CodexClient(), model),
) {
  const delivered = new Set<string>();
  const conversations = new Map<
    string,
    Pick<CodexConversation, "next" | "close">
  >();
  return {
    getModel(model: string): any {
      if (!model) throw new Error("Pomerado must specify an exact model.");
      let conversation = conversations.get(model);
      return {
        getResponse: async (request: any) => {
          try {
            diagnostics?.({
              model,
              status: "request",
              toolTypes: (request.tools ?? []).map((t: any) => t.type),
            });
            const settings = request.modelSettings ?? {};
            if (settings.providerData?.prompt_cache_options?.prewarm)
              throw new Error(
                "Harness compatibility: API cache prewarming is unavailable through Codex.",
              );
            const items: any[] =
              typeof request.input === "string"
                ? [{ role: "user", content: request.input }]
                : (request.input ?? []);
            if (items.some((i) => i.type === "compaction"))
              throw new Error(
                "Harness compatibility: API compaction items cannot be imported.",
              );
            const tools: HarnessTool[] = (request.tools ?? []).map((t: any) => {
              if (t.type === "apply_patch")
                return {
                  name: "cu_pomerado_patch",
                  description:
                    "Request an SDK-managed workspace patch: create_file, update_file, or delete_file. Paths are relative to the managed workspace, not the local harness checkout. For create_file, diff contains the new lines with a leading + on each line; update_file uses patch hunks. The SDK validates and applies the operation under its existing workspace policy and returns the result. This is an offered authoring capability even when local filesystem access is read-only; it does not grant local filesystem access or authorize unrelated writes.",
                  inputSchema: {
                    type: "object",
                    properties: {
                      operation: {
                        anyOf: [
                          {
                            type: "object",
                            properties: {
                              type: { const: "create_file" },
                              path: { type: "string" },
                              diff: { type: "string" },
                            },
                            required: ["type", "path", "diff"],
                            additionalProperties: false,
                          },
                          {
                            type: "object",
                            properties: {
                              type: { const: "update_file" },
                              path: { type: "string" },
                              diff: { type: "string" },
                              moveTo: { type: "string" },
                            },
                            required: ["type", "path", "diff"],
                            additionalProperties: false,
                          },
                          {
                            type: "object",
                            properties: {
                              type: { const: "delete_file" },
                              path: { type: "string" },
                            },
                            required: ["type", "path"],
                            additionalProperties: false,
                          },
                        ],
                      },
                    },
                    required: ["operation"],
                    additionalProperties: false,
                  },
                };
              if (t.type !== "function")
                throw new Error(
                  "Harness compatibility: only SDK function tools are supported.",
                );
              return {
                name: "cu_pomerado_" + t.name,
                description: t.description ?? "",
                inputSchema: t.parameters,
              };
            });
            const results = items
              .filter(
                (i) =>
                  (i.type === "function_call_result" ||
                    i.type === "function_call_output" ||
                    i.type === "apply_patch_call_output") &&
                  !delivered.has(i.callId ?? i.call_id),
              )
              .map((i) => ({
                id: i.callId ?? i.call_id,
                output:
                  typeof i.output === "string"
                    ? i.output
                    : JSON.stringify(i.output),
              }));
            for (const result of results) delivered.add(result.id);
            const developer = items
              .map((i) => (i.type === "unknown" ? i.providerData : i))
              .filter((i) => i?.role === "developer")
              .map((i) =>
                typeof i.content === "string"
                  ? i.content
                  : i.content?.map((p: any) => p.text ?? "").join("\n"),
              );
            if (!conversation) {
              conversation = makeConversation(model);
              conversations.set(model, conversation);
            }
            const result = await conversation.next({
              instructions: [
                "The local harness filesystem is read-only. Offered SDK tools operate through their own managed workspace and existing permission checks. An offered workspace patch tool is the supported way to author source for this task; request its operation and wait for the SDK result. This does not grant local filesystem access, authorize extra effects, override a tool refusal, or bypass review. Do not infer that SDK managed workspace authoring is unavailable solely from the local read-only sandbox; report a blocker only when the relevant offered tool actually refuses or required authorization is missing.",
                request.systemInstructions,
                ...developer,
              ]
                .filter(Boolean)
                .join("\n"),
              input: JSON.stringify(
                items.filter(
                  (i) => i.role !== "developer" && i.type !== "reasoning",
                ),
              ),
              tools,
              effort: settings.reasoning?.effort,
              results: results.length ? results : undefined,
              signal: request.signal,
              outputSchema:
                request.outputType?.type === "json_schema"
                  ? request.outputType.schema
                  : undefined,
              allowedTools: (() => {
                const choice =
                  settings.providerData?.tool_choice ?? settings.toolChoice;
                if (choice?.type === "allowed_tools")
                  return choice.tools.map((t: any) =>
                    t.type === "apply_patch"
                      ? "cu_pomerado_patch"
                      : "cu_pomerado_" + t.name,
                  );
                if (
                  typeof choice === "string" &&
                  !["auto", "required", "none"].includes(choice)
                )
                  return ["cu_pomerado_" + choice];
                if (choice === "none") return [];
                return undefined;
              })(),
            });
            const output =
              result.type === "tool"
                ? result.name === "cu_pomerado_patch"
                  ? [
                      {
                        type: "apply_patch_call",
                        callId: result.id,
                        status: "completed",
                        operation: JSON.parse(result.arguments).operation,
                      },
                    ]
                  : [
                      {
                        type: "function_call",
                        callId: result.id,
                        name: result.name.replace(/^cu_pomerado_/, ""),
                        arguments: result.arguments,
                        status: "completed",
                      },
                    ]
                : [
                    {
                      type: "message",
                      role: "assistant",
                      status: "completed",
                      content: [{ type: "output_text", text: result.text }],
                    },
                  ];
            return {
              usage: {
                requests: 1,
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
                inputTokensDetails: [],
                outputTokensDetails: [],
                requestUsageEntries: [],
              },
              providerData: {
                adapter: "codex-app-server",
                usageUnavailable: true,
              },
              output,
            };
          } catch (error) {
            diagnostics?.({
              model,
              status: "failed",
              reason: error instanceof Error ? error.message : "Adapter failed",
            });
            throw error;
          }
        },
        getStreamedResponse: () => {
          throw new Error(
            "Harness compatibility: streaming SDK responses are not supported.",
          );
        },
      };
    },
    close() {
      for (const c of conversations.values()) c.close();
      conversations.clear();
    },
  };
}
