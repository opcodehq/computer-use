import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  desktopCall,
  readCredential,
  serviceURL,
  writeCredential,
} from "../src/desktop/client.js";

const credential = {
  endpoint: "https://mac.example.test/desktop",
  token: "a".repeat(64),
  generation: "boot-one",
};
test("remote endpoints require TLS; loopback tunnels are allowed without URL credentials", () => {
  for (const value of [
    credential.endpoint,
    "http://127.0.0.1:4311",
    "http://[::1]:4311/desktop",
  ])
    assert.ok(serviceURL(value));
  for (const value of [
    "http://mac.example.test",
    "http://100.64.0.1",
    "https://user:secret@mac.example.test",
    "https://mac.example.test?token=x",
    "https://mac.example.test#secret",
    "file:///tmp/socket",
    "http://127.0.0.1.evil.test",
  ])
    assert.throws(() => serviceURL(value), /HTTPS/);
});
test("credentials are private, never overwritten, and symlinks are rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cu-credentials-"));
  try {
    const path = join(dir, "user.json");
    await writeCredential(path, credential);
    assert.deepEqual(await readCredential(path), credential);
    await assert.rejects(
      writeCredential(path, { ...credential, token: "b".repeat(64) }),
    );
    assert.equal(
      JSON.parse(await readFile(path, "utf8")).token,
      credential.token,
    );
    await symlink(path, join(dir, "link.json"));
    await assert.rejects(readCredential(join(dir, "link.json")));
    await chmod(path, 0o644);
    await assert.rejects(readCredential(path), /private/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("remote calls bind generation, disable redirects and never retry uncertain input", async () => {
  let count = 0;
  const transport = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    count++;
    assert.ok(init);
    assert.equal(url, credential.endpoint + "/rpc");
    assert.equal(init?.redirect, "error");
    assert.equal(
      (init.headers as Record<string, string>).Authorization,
      "Bearer " + credential.token,
    );
    assert.equal(JSON.parse(init?.body as string).generation, "boot-one");
    throw new Error("socket lost");
  }) as typeof fetch;
  await assert.rejects(
    desktopCall(credential, "input", {}, { fetch: transport }),
    (error: any) =>
      error.delivery === "unknown" && error.code === "connection_lost",
  );
  assert.equal(count, 1);
  const result = (async () =>
    Response.json({
      ok: true,
      protocol: 1,
      generation: "boot-two",
      result: {},
    })) as typeof fetch;
  await assert.rejects(
    desktopCall(credential, "state", {}, { fetch: result }),
    /lifecycle changed/,
  );
  const wrong = (async () => Response.json(null)) as typeof fetch;
  await assert.rejects(
    desktopCall(credential, "input", {}, { fetch: wrong }),
    (error: any) => error.delivery === "unknown",
  );
});
