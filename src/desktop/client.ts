import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { failure } from "./protocol.js";

export const Credential = z.object({
  endpoint: z.string().url(),
  token: z.string().min(16).max(4096),
  generation: z.string().min(1).max(128),
});
export type Credential = z.infer<typeof Credential>;

export function serviceURL(endpoint: string) {
  const url = new URL(endpoint);
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^(?:\/[a-zA-Z0-9_-]+)*\/?$/.test(url.pathname)
  )
    throw failure(
      "permission_denied",
      "Use HTTPS for remote desktops or HTTP through a loopback SSH tunnel; credentials cannot be embedded in the endpoint.",
    );
  return url;
}

export async function readCredential(path: string): Promise<Credential> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.uid !== process.getuid?.() ||
      info.mode & 0o077 ||
      info.size > 16384
    )
      throw failure(
        "permission_denied",
        "Credential file must be private, bounded, and owned by this user.",
      );
    const value = Credential.parse(JSON.parse(await file.readFile("utf8")));
    serviceURL(value.endpoint);
    return value;
  } finally {
    await file.close();
  }
}

export async function writeCredential(path: string, value: Credential) {
  Credential.parse(value);
  serviceURL(value.endpoint);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const file = await open(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await file.writeFile(JSON.stringify(value) + "\n");
  } catch (error) {
    await unlink(path).catch(() => {});
    throw error;
  } finally {
    await file.close();
  }
}

const reads = new Set([
  "health",
  "apps",
  "windows",
  "state",
  "observe",
  "recording.list",
  "presence.list",
]);
export async function desktopCall(
  credential: Credential,
  method: string,
  args: Record<string, unknown>,
  options: { id?: string; signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<unknown> {
  const endpoint = serviceURL(credential.endpoint).href.replace(/\/$/, "");
  options.signal?.throwIfAborted();
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(endpoint + "/rpc", {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: "Bearer " + credential.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: options.id ?? randomUUID(),
        generation: credential.generation,
        method,
        args,
      }),
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000),
    });
  } catch {
    throw failure(
      "connection_lost",
      reads.has(method)
        ? "Desktop connection failed."
        : "Desktop connection failed; the action may have been delivered. Observe before deciding whether to retry.",
      reads.has(method) ? "notDispatched" : "unknown",
    );
  }
  let result: {
    ok: boolean;
    protocol?: number;
    generation?: string;
    result?: unknown;
    error?: { code?: string; message?: string; delivery?: string };
  };
  try {
    result = (await response.json()) as typeof result;
  } catch {
    throw failure(
      "connection_lost",
      "Desktop returned an incomplete response. Do not automatically repeat input.",
      reads.has(method) ? "notDispatched" : "unknown",
    );
  }
  if (!result || typeof result !== "object")
    throw failure(
      "invalid_response",
      "Invalid desktop response.",
      reads.has(method) ? "notDispatched" : "unknown",
    );
  if (!result.ok || !response.ok)
    throw failure(
      result.error?.code ?? "connection_failed",
      result.error?.message ?? "Desktop request failed.",
      result.error?.delivery ??
        (reads.has(method) ? "notDispatched" : "unknown"),
    );
  if (
    result.protocol !== 1 ||
    (result.generation !== credential.generation && method !== "rebind")
  )
    throw failure(
      "generation_mismatch",
      "Desktop protocol or lifecycle changed. Reconnect with a fresh credential.",
      reads.has(method) ? "notDispatched" : "unknown",
    );
  return result.result;
}
