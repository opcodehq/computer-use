import { execFile, spawn } from "node:child_process";
import { unlink } from "node:fs/promises";
import { promisify } from "node:util";
import {
  Credential,
  desktopCall,
  serviceURL,
  writeCredential,
} from "./client.js";
import { failure } from "./protocol.js";

const exec = promisify(execFile);

export function sshTarget(value: string) {
  if (!/^(?:[a-zA-Z0-9_.-]+@)?[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value))
    throw failure(
      "invalid_request",
      "Use an SSH config alias or user@hostname.",
    );
  return value;
}
export function remoteCredentialCommand(path: string) {
  if (!path.startsWith("/") || path.length > 4096 || /[\0\r\n]/.test(path))
    throw failure(
      "invalid_request",
      "Remote credential path must be absolute.",
    );
  return "cat -- '" + path.replaceAll("'", "'\\''") + "'";
}

/** OpenSSH retains ownership of keys, host verification, proxies and Tailnet routing. */
export async function openSSHTunnel(options: {
  host: string;
  remoteCredentialFile: string;
  output: string;
  port: number;
}) {
  const host = sshTarget(options.host);
  if (
    !Number.isInteger(options.port) ||
    options.port < 1024 ||
    options.port > 65535
  )
    throw failure(
      "invalid_request",
      "Local port must be between 1024 and 65535.",
    );
  const common = [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "StrictHostKeyChecking=yes",
  ];
  let remote: Credential;
  try {
    const { stdout } = await exec(
      "ssh",
      [
        ...common,
        "--",
        host,
        remoteCredentialCommand(options.remoteCredentialFile),
      ],
      { timeout: 15000, maxBuffer: 16384 },
    );
    remote = Credential.parse(JSON.parse(stdout));
  } catch {
    throw failure(
      "connection_failed",
      "Could not read the scoped remote credential. Check the SSH alias, accepted host key, non-interactive authentication and absolute credential path.",
    );
  }
  const endpoint = serviceURL(remote.endpoint);
  if (
    endpoint.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(endpoint.hostname)
  )
    throw failure(
      "invalid_request",
      "SSH sharing requires a remote loopback HTTP credential. For HTTPS, use the credential directly.",
    );
  const port = endpoint.port || "80";
  const local: Credential = {
    ...remote,
    endpoint: `http://127.0.0.1:${options.port}${endpoint.pathname.replace(/\/$/, "")}`,
  };
  const child = spawn(
    "ssh",
    [
      ...common,
      "-N",
      "-o",
      "PermitLocalCommand=yes",
      "-o",
      "LocalCommand=printf OPCODE_TUNNEL_READY",
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "ServerAliveInterval=10",
      "-o",
      "ServerAliveCountMax=3",
      "-L",
      `127.0.0.1:${options.port}:127.0.0.1:${port}`,
      "--",
      host,
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  let exited = false;
  const readySignal = new Promise<void>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(
      () =>
        reject(
          failure(
            "connection_failed",
            "SSH did not confirm forwarding readiness.",
          ),
        ),
      15000,
    );
    const finish = () => {
      clearTimeout(timer);
    };
    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes("OPCODE_TUNNEL_READY")) {
        finish();
        resolve();
      } else if (output.length > 4096) {
        finish();
        reject(failure("connection_failed", "Unexpected SSH startup output."));
      }
    });
    child.once("error", () => {
      finish();
      reject(failure("connection_failed", "SSH could not start."));
    });
    child.once("exit", () => {
      finish();
      reject(
        failure(
          "connection_failed",
          "SSH closed before forwarding became ready.",
        ),
      );
    });
  });
  let written = false;
  let cleaned = false;
  const done = new Promise<void>((resolve) => {
    child.once("error", () => {
      exited = true;
      resolve();
    });
    child.once("exit", () => {
      exited = true;
      resolve();
    });
  });
  const close = async () => {
    if (cleaned) return;
    cleaned = true;
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 1000);
    timer.unref();
    await done;
    clearTimeout(timer);
    if (written) await unlink(options.output).catch(() => {});
  };
  try {
    await readySignal;
    let ready = false;
    for (let i = 0; i < 50 && !exited; i++) {
      try {
        await desktopCall(
          local,
          "presence.list",
          {},
          { signal: AbortSignal.timeout(1000) },
        );
        ready = true;
        break;
      } catch (error) {
        if ((error as { code?: string }).code !== "connection_lost")
          throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready || exited)
      throw failure(
        "connection_failed",
        "SSH tunnel did not become ready. Verify the desktop broker, grant expiry, and local port availability.",
      );
    await writeCredential(options.output, local);
    written = true;
    if (exited)
      throw failure("connection_lost", "SSH tunnel closed during setup.");
    return { endpoint: local.endpoint, close, done };
  } catch (error) {
    await close();
    throw error;
  }
}
