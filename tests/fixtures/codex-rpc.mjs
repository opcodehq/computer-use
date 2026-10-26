import { createInterface } from "node:readline";
const send = (x) => process.stdout.write(JSON.stringify(x) + "\n");
for await (const line of createInterface({ input: process.stdin })) {
  const r = JSON.parse(line);
  if (r.method === "initialize") send({ id: r.id, result: {} });
  if (r.method === "thread/start")
    send({ id: r.id, result: { thread: { id: "fixture-thread" } } });
  if (r.method === "turn/start") {
    send({ id: r.id, result: { turn: { id: "turn" } } });
    send({
      id: 99,
      method: "item/tool/call",
      params: {
        threadId: "fixture-thread",
        callId: "call-one",
        tool: "read_fixture",
        arguments: { id: 1 },
      },
    });
  }
  if (r.id === 99 && !r.method) {
    send({
      method: "item/completed",
      params: {
        threadId: "fixture-thread",
        item: { type: "agentMessage", text: "verified result" },
      },
    });
    send({
      method: "turn/completed",
      params: { threadId: "fixture-thread", turn: { status: "completed" } },
    });
  }
}
