import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export type Rpc = {
  id?: number | string;
  method?: string;
  params?: any;
  result?: any;
  error?: { message: string };
};
/** Local stdio only; authentication and permissions stay with the installed harness. */
export class CodexClient {
  private child;
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  onEvent: (event: Rpc) => void = () => {};
  onClose: () => void = () => {};
  private closed = false;
  constructor(
    command = "codex",
    args = ["app-server", "--listen", "stdio://"],
  ) {
    this.child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    this.child.stderr.resume();
    this.child.stdin.on("error", () => this.close());
    this.child.on("error", () => this.close());
    this.child.on("exit", () => this.close());
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => {
      try {
        if (line.length > 16_000_000)
          throw new Error("Harness response too large.");
        const event = JSON.parse(line) as Rpc;
        if (
          !event.method &&
          typeof event.id === "number" &&
          this.pending.has(event.id)
        ) {
          const pending = this.pending.get(event.id)!;
          this.pending.delete(event.id);
          clearTimeout(pending.timer);
          event.error
            ? pending.reject(
                new Error("Codex RPC failed: " + event.error.message),
              )
            : pending.resolve(event.result);
        } else this.onEvent(event);
      } catch {
        this.close();
      }
    });
  }
  private send(value: Rpc) {
    if (this.child.stdin.destroyed) throw new Error("Codex connection closed.");
    this.child.stdin.write(JSON.stringify(value) + "\n");
  }
  reply(id: number | string, result: unknown) {
    this.send({ id, result });
  }
  request(method: string, params: unknown, timeoutMs = 120000): Promise<any> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Codex RPC timed out."));
        this.close();
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  async initialize() {
    await this.request("initialize", {
      clientInfo: { name: "opcode-cu", version: "0.3.0" },
      capabilities: { experimentalApi: true },
    });
    this.send({ method: "initialized", params: {} });
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.onClose();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Codex connection closed."));
    }
    this.pending.clear();
    this.child.kill();
  }
}

export type HarnessTool = {
  name: string;
  description: string;
  inputSchema: unknown;
};
export type HarnessResult =
  | { type: "tool"; id: string; name: string; arguments: string }
  | { type: "message"; text: string };
/** One model conversation. Tool RPCs remain pending until the upstream SDK returns results. */
export class CodexConversation {
  private thread?: string;
  private toolSignature?: string;
  private waiting = new Map<string, number | string>();
  private results: HarnessResult[] = [];
  private consumer?: {
    resolve: (result: HarnessResult) => void;
    reject: (e: Error) => void;
  };
  private failed?: Error;
  private allowed?: Set<string>;
  constructor(
    private client: CodexClient,
    private model: string,
  ) {
    client.onClose = () => this.fail(new Error("Codex connection closed."));
    client.onEvent = (event) => {
      if (event.method === "item/tool/call" && event.id !== undefined) {
        const p = event.params;
        if (this.allowed && !this.allowed.has(p.tool)) {
          this.client.reply(event.id, {
            success: false,
            contentItems: [
              {
                type: "inputText",
                text: "Tool is not offered in this request.",
              },
            ],
          });
          this.fail(
            new Error("Harness called a tool outside the current allowed set."),
          );
          return;
        }
        if (p.threadId !== this.thread) {
          this.client.reply(event.id, { success: false, contentItems: [] });
          return;
        }
        this.waiting.set(p.callId, event.id);
        this.push({
          type: "tool",
          id: p.callId,
          name: p.tool,
          arguments: JSON.stringify(p.arguments),
        });
      } else if (
        event.method === "item/completed" &&
        event.params?.threadId === this.thread &&
        event.params.item?.type === "agentMessage" &&
        !["commentary", "partial_answer"].includes(event.params.item.phase)
      ) {
        this.push({ type: "message", text: event.params.item.text });
      } else if (
        event.method === "turn/completed" &&
        event.params?.threadId === this.thread &&
        event.params.turn?.status !== "completed"
      ) {
        this.fail(new Error("Codex turn failed or was interrupted."));
      } else if (event.method && event.id !== undefined) {
        // This bridge cannot grant permissions, run built-in commands, or answer user questions.
        this.fail(new Error("Unsupported harness request: " + event.method));
        this.client.close();
      }
    };
  }
  private fail(error: Error) {
    this.failed = error;
    this.consumer?.reject(error);
    this.consumer = undefined;
  }
  private push(result: HarnessResult) {
    if (this.consumer) {
      const c = this.consumer;
      this.consumer = undefined;
      c.resolve(result);
    } else this.results.push(result);
  }
  async next(request: {
    instructions: string;
    input: string;
    tools: HarnessTool[];
    effort?: string;
    outputSchema?: unknown;
    allowedTools?: string[];
    results?: { id: string; output: string }[];
    signal?: AbortSignal;
  }) {
    request.signal?.throwIfAborted();
    this.allowed = request.allowedTools
      ? new Set(request.allowedTools)
      : undefined;
    const signature = JSON.stringify(request.tools);
    if (this.thread && signature !== this.toolSignature)
      throw new Error(
        "Harness compatibility: tool catalog changed within conversation.",
      );
    if (!this.thread) {
      await this.client.initialize();
      const result = await this.client.request("thread/start", {
        model: this.model,
        ephemeral: true,
        approvalPolicy: "never",
        sandbox: "read-only",
        baseInstructions: request.instructions,
        config: {
          "features.shell_tool": false,
          "features.apply_patch_tool": false,
        },
        dynamicTools: request.tools.map((t) => ({
          type: "function",
          ...t,
          deferLoading: false,
        })),
      });
      this.thread = result.thread.id;
      this.toolSignature = signature;
    }
    if (request.signal?.aborted) {
      this.client.close();
      request.signal.throwIfAborted();
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => {
      this.fail(new Error("Harness request cancelled."));
      this.client.close();
    };
    request.signal?.addEventListener("abort", abort, { once: true });
    try {
      for (const result of request.results ?? []) {
        const rpcId = this.waiting.get(result.id);
        if (rpcId === undefined)
          throw new Error("Harness compatibility: unknown tool result ID.");
        this.client.reply(rpcId, {
          success: true,
          contentItems: [{ type: "inputText", text: result.output }],
        });
        this.waiting.delete(result.id);
      }
      if (!request.results?.length) {
        if (this.waiting.size)
          throw new Error(
            "Harness compatibility: unresolved upstream tool calls.",
          );
        await this.client.request("turn/start", {
          threadId: this.thread,
          input: [{ type: "text", text: request.input, text_elements: [] }],
          effort: request.effort ?? "medium",
          outputSchema: request.outputSchema,
        });
      }
      if (this.failed) throw this.failed;
      const queued = this.results.shift();
      if (queued) return queued;
      return await new Promise<HarnessResult>((resolve, reject) => {
        this.consumer = { resolve, reject };
        timer = setTimeout(() => {
          this.fail(new Error("Harness generation timed out."));
          this.client.close();
        }, 300000);
      });
    } finally {
      if (timer) clearTimeout(timer);
      request.signal?.removeEventListener("abort", abort);
    }
  }
  close() {
    this.fail(new Error("Harness conversation closed."));
    this.client.close();
  }
}
