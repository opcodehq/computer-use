import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer as httpServer } from "node:http";
import { createServer as netServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { readCredential } from "../src/desktop/client.js";
import {
  openSSHTunnel,
  remoteCredentialCommand,
  sshTarget,
} from "../src/desktop/remote.js";

const exec = promisify(execFile);

const fakeSSH = `#!/usr/bin/env node
const net = require('node:net');
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CU_TEST_SSH_LOG, JSON.stringify(args)+'\\n');
if (!args.includes('-N')) { process.stdout.write(process.env.CU_TEST_REMOTE_CREDENTIAL); process.exit(0); }
const spec = args[args.indexOf('-L') + 1].split(':');
const server = net.createServer(socket => {
  const remote = net.connect(Number(spec[3]), spec[2]);
  remote.on('error', () => socket.destroy()); socket.on('error', () => remote.destroy());
  socket.on('close', () => remote.destroy()); remote.on('close', () => socket.destroy());
  socket.pipe(remote); remote.pipe(socket);
});
server.once('error', () => process.exit(1));
server.listen(Number(spec[1]), spec[0], () => {
  setTimeout(() => {
    fs.writeFileSync(process.env.CU_TEST_SSH_MARKER, 'ready');
    process.stdout.write('OPCODE_TUNNEL_READY');
  }, 100);
});
`;
async function freePort() {
  const server = netServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
async function fixture(denied = false) {
  const directory = await mkdtemp(join(tmpdir(), "cu-ssh-test-"));
  const marker = join(directory, "ready");
  const log = join(directory, "ssh.log");
  await writeFile(join(directory, "ssh"), fakeSSH);
  await chmod(join(directory, "ssh"), 0o700);
  const token = "viewer-only-private-token";
  const requests: { method: string; authorization?: string; ready: boolean }[] =
    [];
  const server = httpServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    const ready = await stat(marker).then(
      () => true,
      () => false,
    );
    requests.push({
      method: request.method,
      authorization: req.headers.authorization,
      ready,
    });
    res.setHeader("Content-Type", "application/json");
    // This grant intentionally has no observe scope: readiness must use presence.list.
    if (
      denied ||
      request.method !== "presence.list" ||
      req.headers.authorization !== `Bearer ${token}`
    ) {
      res.statusCode = 403;
      res.end(
        JSON.stringify({
          ok: false,
          error: { code: "permission_denied", message: "Viewer scope only." },
        }),
      );
    } else
      res.end(
        JSON.stringify({
          ok: true,
          protocol: 1,
          generation: "test-generation",
          result: { participants: [] },
        }),
      );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const original = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries({
    PATH: directory + ":" + process.env.PATH,
    CU_TEST_SSH_LOG: log,
    CU_TEST_SSH_MARKER: marker,
    CU_TEST_REMOTE_CREDENTIAL: JSON.stringify({
      endpoint: `http://127.0.0.1:${port}/desktop`,
      token,
      generation: "test-generation",
    }),
  })) {
    original.set(key, process.env[key]);
    process.env[key] = value;
  }
  return {
    directory,
    requests,
    log,
    token,
    async close() {
      for (const [key, value] of original)
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("SSH target validation rejects option injection and shell metacharacters", () => {
  for (const input of [
    "-oProxyCommand=evil",
    "user@-host",
    "host;touch",
    "host\n",
    "user@host:22",
    "a b",
    "$(evil)",
    "",
  ])
    assert.throws(() => sshTarget(input));
  for (const input of [
    "my-tailnet-mac",
    "alice@mac.example.ts.net",
    "my_alias",
  ])
    assert.equal(sshTarget(input), input);
});
test("Remote credential command treats malicious path content literally", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cu-path-test-"));
  try {
    const path = join(
      directory,
      "quote' $(printf exploited) `printf bad` ; $HOME.json",
    );
    await writeFile(path, "literal-only");
    const { stdout } = await exec("/bin/sh", [
      "-c",
      remoteCredentialCommand(path),
    ]);
    assert.equal(stdout, "literal-only");
    for (const input of [
      "relative.json",
      "/tmp/new\nline",
      "/tmp/null\0byte",
      "/tmp/cr\rfile",
    ])
      assert.throws(() => remoteCredentialCommand(input));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// Tests run sequentially because they temporarily select a fake ssh via PATH.
test("waits for forwarding readiness, supports viewer credentials, and deletes credentials on close", async () => {
  const f = await fixture();
  let tunnel: Awaited<ReturnType<typeof openSSHTunnel>> | undefined;
  try {
    const output = join(f.directory, "local.json");
    tunnel = await openSSHTunnel({
      host: "alice@mac",
      remoteCredentialFile: "/Users/alice/viewer.json",
      output,
      port: await freePort(),
    });
    assert.deepEqual(f.requests, [
      {
        method: "presence.list",
        authorization: `Bearer ${f.token}`,
        ready: true,
      },
    ]);
    const credential = await readCredential(output);
    assert.equal(credential.token, f.token);
    assert.match(credential.endpoint, /^http:\/\/127\.0\.0\.1:\d+\/desktop$/);
    const invocations = (await readFile(f.log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    assert.equal(invocations.length, 2);
    for (const args of invocations) {
      assert.ok(args.includes("StrictHostKeyChecking=yes"));
      assert.ok(args.includes("BatchMode=yes"));
      assert.ok(!args.some((arg) => arg.includes(f.token)));
    }
    assert.ok(invocations[1]!.includes("ExitOnForwardFailure=yes"));
    await tunnel.close();
    await assert.rejects(
      readFile(output),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );
    await tunnel.close();
  } finally {
    await tunnel?.close();
    await f.close();
  }
});
test("occupied local port receives no credential or readiness request", async () => {
  const f = await fixture();
  let received = 0;
  const occupied = httpServer((_req, res) => {
    received++;
    res.end("unrelated");
  });
  occupied.listen(0, "127.0.0.1");
  await once(occupied, "listening");
  try {
    const output = join(f.directory, "must-not-exist.json");
    await assert.rejects(
      openSSHTunnel({
        host: "mac",
        remoteCredentialFile: "/private/viewer.json",
        output,
        port: (occupied.address() as { port: number }).port,
      }),
      /SSH closed before forwarding/,
    );
    assert.equal(received, 0);
    assert.equal(f.requests.length, 0);
    await assert.rejects(
      readFile(output),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );
  } finally {
    occupied.closeAllConnections();
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
    await f.close();
  }
});
test("authorization failure closes forwarding and leaves no credential", async () => {
  const f = await fixture(true);
  try {
    const output = join(f.directory, "denied.json");
    const port = await freePort();
    await assert.rejects(
      openSSHTunnel({
        host: "mac",
        remoteCredentialFile: "/private/viewer.json",
        output,
        port,
      }),
      /Viewer scope only/,
    );
    await assert.rejects(
      readFile(output),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );
    const probe = netServer();
    probe.listen(port, "127.0.0.1");
    await once(probe, "listening");
    await new Promise<void>((resolve) => probe.close(() => resolve()));
  } finally {
    await f.close();
  }
});
test("pre-existing output credentials are preserved on setup failure", async () => {
  const f = await fixture();
  try {
    const output = join(f.directory, "existing.json");
    await writeFile(output, "do not overwrite", { mode: 0o600 });
    await assert.rejects(
      openSSHTunnel({
        host: "mac",
        remoteCredentialFile: "/private/viewer.json",
        output,
        port: await freePort(),
      }),
    );
    assert.equal(await readFile(output, "utf8"), "do not overwrite");
  } finally {
    await f.close();
  }
});
