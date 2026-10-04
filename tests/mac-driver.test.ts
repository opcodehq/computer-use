import assert from "node:assert/strict";
import { once } from "node:events";
import { connect, createServer, type Socket } from "node:net";
import { test } from "node:test";
import { socketMacDriver } from "../src/desktop/mac-driver.js";

async function pair() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const accepted = once(server, "connection");
  const address = server.address() as { port: number };
  const socket = connect(address.port, "127.0.0.1");
  await once(socket, "connect");
  const [peer] = (await accepted) as [Socket];
  const driver = socketMacDriver(socket);
  return {
    peer,
    driver,
    close: () => {
      driver.close?.();
      peer.destroy();
      server.close();
    },
  };
}
test("Mac transport serializes requests and never retries unknown delivery", async () => {
  const { peer, driver, close } = await pair();
  try {
    const received = once(peer, "data");
    const first = driver.request("desktopInput");
    const second = driver.request("desktopState");
    const [wire] = await received;
    const request = JSON.parse(wire.toString());
    assert.equal(request.method, "desktopInput");
    assert.equal(wire.toString().trim().split("\n").length, 1);
    const next = once(peer, "data");
    peer.write(
      JSON.stringify({ id: request.id, ok: true, data: { done: true } }) + "\n",
    );
    assert.deepEqual(await first, { done: true });
    await next;
    peer.destroy();
    await assert.rejects(
      second,
      (error: { delivery?: string }) => error.delivery === "unknown",
    );
    await assert.rejects(driver.request("desktopInput"), /disconnected/);
  } finally {
    close();
  }
});
test("Mac cancellation waits for in-flight native completion before fencing", async () => {
  const { peer, driver, close } = await pair();
  try {
    const abort = new AbortController();
    const received = once(peer, "data");
    let completed = false;
    const pending = driver.request("desktopInput", {}, abort.signal);
    pending.catch(() => {
      completed = true;
    });
    const [wire] = await received;
    abort.abort();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(completed, false);
    peer.write(
      JSON.stringify({
        id: JSON.parse(wire.toString()).id,
        ok: true,
        data: {},
      }) + "\n",
    );
    await assert.rejects(
      pending,
      (error: { code?: string; delivery?: string }) =>
        error.code === "cancelled" && error.delivery === "unknown",
    );
  } finally {
    close();
  }
});
test("Mac transport rejects malformed response and queued actions", async () => {
  const { peer, driver, close } = await pair();
  try {
    const received = once(peer, "data");
    const pending = driver.request("desktopState");
    await received;
    peer.write("not json\n");
    await assert.rejects(pending, /disconnected/);
    await assert.rejects(driver.request("desktopInput"), /disconnected/);
  } finally {
    close();
  }
});
test("Mac transport parses fragmented screenshot replies without replay", async () => {
  const { peer, driver, close } = await pair();
  try {
    const received = once(peer, "data");
    const pending = driver.request("desktopCapture");
    const [wire] = await received;
    const data = { base64: "x".repeat(200_000) };
    const response =
      JSON.stringify({ id: JSON.parse(wire.toString()).id, ok: true, data }) +
      "\n";
    for (let offset = 0; offset < response.length; offset += 4096)
      peer.write(response.slice(offset, offset + 4096));
    assert.deepEqual(await pending, data);
  } finally {
    close();
  }
});
