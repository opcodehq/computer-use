import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import type { MacDriver } from "./mac-backend.js";
import { failure } from "./protocol.js";

/** Connect only to the installed LaunchServices helper; never spawn an untrusted binary. */
export async function connectMacDriver(): Promise<MacDriver> {
  const uid = process.getuid?.();
  if (uid === undefined)
    throw failure("unsupported", "Mac helper requires a Unix user.");
  const directory = `/tmp/opcode-cu-${uid}`;
  for (const path of [directory, `${directory}/driver.sock`]) {
    const stat = await lstat(path).catch(() => {
      throw failure(
        "display_unavailable",
        "Start the installed Opcode helper with cu install, then grant its permissions.",
      );
    });
    if (
      stat.isSymbolicLink() ||
      stat.uid !== uid ||
      stat.mode & 0o077 ||
      (path === directory ? !stat.isDirectory() : !stat.isSocket())
    )
      throw failure(
        "permission_denied",
        "Unsafe Mac helper socket permissions.",
      );
  }
  const socket = await new Promise<Socket>((resolve, reject) => {
    const socket = connect(`${directory}/driver.sock`);
    const timeout = setTimeout(
      () => socket.destroy(new Error("Mac helper connection timed out.")),
      3000,
    );
    socket.once("error", reject);
    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.off("error", reject);
      resolve(socket);
    });
    socket.once("close", () => clearTimeout(timeout));
  });
  return socketMacDriver(socket);
}

/** Exported for transport tests. A disconnected session never reconnects or replays input. */
export function socketMacDriver(socket: Socket): MacDriver {
  let chunks: Buffer[] = [];
  let bufferedBytes = 0;
  let closed = false;
  let tail: Promise<unknown> = Promise.resolve();
  let pending:
    | {
        id: string;
        resolve(value: unknown): void;
        reject(error: Error): void;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  const disconnect = () => {
    closed = true;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(
        failure(
          "driver_disconnected",
          "Mac helper disconnected. Observe before retrying; input delivery is unknown.",
          "unknown",
        ),
      );
      pending = undefined;
    }
    socket.destroy();
  };
  socket.on("error", disconnect);
  socket.on("close", disconnect);
  socket.on("data", (chunk: Buffer) => {
    let offset = 0;
    while (offset < chunk.length) {
      const index = chunk.indexOf(10, offset);
      const part = chunk.subarray(offset, index < 0 ? chunk.length : index);
      chunks.push(part);
      bufferedBytes += part.length;
      if (bufferedBytes > 17_000_000) {
        disconnect();
        return;
      }
      if (index < 0) return;
      const line = Buffer.concat(chunks, bufferedBytes);
      chunks = [];
      bufferedBytes = 0;
      offset = index + 1;
      try {
        const reply = JSON.parse(line.toString());
        if (
          !pending ||
          reply.id !== pending.id ||
          typeof reply.ok !== "boolean"
        ) {
          disconnect();
          return;
        }
        const task = pending;
        pending = undefined;
        clearTimeout(task.timer);
        if (reply.ok) task.resolve(reply.data);
        else
          task.reject(
            failure(
              reply.error?.code ?? "driver_error",
              reply.error?.message ?? "Mac helper request failed.",
              reply.error?.delivery ?? "unknown",
            ),
          );
      } catch {
        disconnect();
        return;
      }
    }
  });
  return {
    close: disconnect,
    request(method, args = {}, signal) {
      const task = tail
        .catch(() => {})
        .then(async () => {
          signal?.throwIfAborted();
          if (closed)
            throw failure(
              "driver_disconnected",
              "Mac helper is disconnected. Restart the desktop service.",
            );
          const id = randomUUID();
          const wire = JSON.stringify({ ...args, id, method }) + "\n";
          if (Buffer.byteLength(wire) > 128_000)
            throw failure(
              "invalid_request",
              "Mac helper request exceeds limit.",
            );
          const result = await new Promise<unknown>((resolve, reject) => {
            pending = {
              id,
              resolve,
              reject,
              timer: setTimeout(disconnect, 12_000),
            };
            socket.write(wire);
          });
          // Wait for completion before fencing a cancelled in-flight action. Never retry it.
          if (signal?.aborted)
            throw failure(
              "cancelled",
              "Mac operation finished after cancellation; verify fresh state.",
              "unknown",
            );
          return result;
        });
      tail = task;
      return task;
    },
  };
}
