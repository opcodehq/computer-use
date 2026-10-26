import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { performance } from "node:perf_hooks";
import { failure } from "../desktop/protocol.js";

/** One private framed pipe owned by the existing broker. A failed session stays
 * fenced until the broker is restarted; mutations are never replayed. */
export class X11Session {
  private child?: ChildProcessWithoutNullStreams;
  private poisoned?: Error;
  private serial = 0;
  private queued = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private buffered = Buffer.alloc(0);
  private chunks: Buffer[] = [];
  private received = 0;
  private expected?: { size: number; status: number };
  private pending?: {
    id: number;
    resolve: (b: Buffer) => void;
    reject: (e: Error) => void;
  };
  readonly timings: { operation: string; durationMs: number; bytes: number }[] =
    [];
  constructor(
    readonly helper: string,
    readonly env: NodeJS.ProcessEnv,
  ) {}
  private die(error: Error) {
    this.poisoned ??= error;
    this.pending?.reject(error);
    this.pending = undefined;
    this.child?.kill("SIGTERM");
    const child = this.child;
    const timer = setTimeout(() => child?.kill("SIGKILL"), 500);
    timer.unref();
  }
  close() {
    this.die(failure("service_closed", "X11 helper session closed."));
  }
  private start() {
    if (this.poisoned) throw this.poisoned;
    if (this.child) return;
    const child = (this.child = spawn(this.helper, ["serve"], {
      env: this.env,
      stdio: "pipe",
    }));
    child.stderr.resume(); // Never forward native errors or user text into traces.
    child.on("error", () =>
      this.die(
        failure(
          "display_unavailable",
          "X11 helper failed; restart the broker.",
        ),
      ),
    );
    child.on("exit", () =>
      this.die(
        failure(
          "display_unavailable",
          "X11 helper exited; restart the broker before continuing.",
        ),
      ),
    );
    child.stdout.on("data", (data: Buffer) => {
      let remaining = data;
      if (!this.expected) {
        const needed = 12 - this.buffered.length;
        this.buffered = Buffer.concat([
          this.buffered,
          data.subarray(0, needed),
        ]);
        remaining = data.subarray(Math.min(needed, data.length));
        if (this.buffered.length < 12) return;
        const id = this.buffered.readUInt32BE(0),
          status = this.buffered.readUInt32BE(4),
          size = this.buffered.readUInt32BE(8);
        if (size > 80_000_000 || !this.pending || this.pending.id !== id)
          return this.die(
            failure(
              "invalid_frame",
              "Invalid native response identity or size.",
            ),
          );
        this.expected = { size, status };
      }
      this.chunks.push(remaining);
      this.received += remaining.length;
      if (this.received > this.expected.size)
        return this.die(
          failure("invalid_frame", "Unexpected native response data."),
        );
      if (this.received < this.expected.size) return;
      const pending = this.pending!,
        status = this.expected.status,
        payload = Buffer.concat(this.chunks, this.received);
      this.buffered = Buffer.alloc(0);
      this.expected = undefined;
      this.chunks = [];
      this.received = 0;
      this.pending = undefined;
      if (status)
        pending.reject(
          failure(
            "display_unavailable",
            "Native operation failed. Observe before deciding whether to retry.",
            "unknown",
          ),
        );
      else pending.resolve(payload);
    });
  }
  request(args: string[], signal?: AbortSignal): Promise<Buffer> {
    if (
      !args.length ||
      args.length > 15 ||
      args.some((a) => Buffer.byteLength(a) > 32000 || a.includes("\0"))
    )
      return Promise.reject(
        failure("invalid_request", "Invalid native request."),
      );
    if (this.queued >= 32)
      return Promise.reject(
        failure("overloaded", "Native helper queue is full."),
      );
    this.queued++;
    const task = this.tail
      .catch(() => {})
      .then(async () => {
        signal?.throwIfAborted();
        this.start();
        const id = ++this.serial,
          parts = args.map((a) => {
            const b = Buffer.from(a),
              h = Buffer.alloc(4);
            h.writeUInt32BE(b.length);
            return Buffer.concat([h, b]);
          });
        const body = Buffer.concat(parts),
          header = Buffer.alloc(12);
        header.writeUInt32BE(body.length + 8, 0);
        header.writeUInt32BE(id, 4);
        header.writeUInt32BE(args.length, 8);
        const started = performance.now();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const abort = () =>
          this.die(
            failure(
              "cancelled",
              "Native operation interrupted; restart the broker.",
              "unknown",
            ),
          );
        signal?.addEventListener("abort", abort, { once: true });
        try {
          return await new Promise<Buffer>((resolve, reject) => {
            this.pending = { id, resolve, reject };
            timer = setTimeout(
              () =>
                this.die(
                  failure(
                    "timeout",
                    "Native operation timed out; restart the broker.",
                    "unknown",
                  ),
                ),
              10000,
            );
            this.child!.stdin.write(Buffer.concat([header, body]), (error) => {
              if (error)
                this.die(
                  failure(
                    "display_unavailable",
                    "Native request pipe closed.",
                    "unknown",
                  ),
                );
            });
          }).then((result) => {
            this.timings.push({
              operation: args[0]!,
              durationMs: performance.now() - started,
              bytes: result.length,
            });
            if (this.timings.length > 256) this.timings.shift();
            return result;
          });
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
        }
      });
    const result = task.finally(() => this.queued--);
    this.tail = result;
    return result;
  }
}
