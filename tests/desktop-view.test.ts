import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { desktopHTML } from "../src/desktop/view.js";

class Element {
  textContent = "";
  value = "";
  hidden = false;
  disabled = false;
  className = "";
  style: Record<string, string> = {};
  children: Element[] = [];
  parent?: Element;
  src?: string;
  append(...nodes: Element[]) {
    this.children.push(...nodes);
    for (const node of nodes) node.parent = this;
  }
  replaceChildren(...nodes: Element[]) {
    this.children = [];
    this.append(...nodes);
  }
  get lastChild() {
    const child = this.children.at(-1);
    assert.ok(child);
    return child;
  }
  remove() {
    if (this.parent)
      this.parent.children = this.parent.children.filter((n) => n !== this);
  }
  removeAttribute(key: string) {
    if (key === "src") this.src = undefined;
  }
  focus() {}
  blur() {}
  setPointerCapture() {}
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 100, height: 100 };
  }
}
function nextTimer(timers: Array<() => Promise<void> | void>) {
  const timer = timers.shift();
  assert.ok(timer);
  return timer();
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
async function harness(admin = false) {
  const elements = new Map<string, Element>();
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, new Element());
    const node = elements.get(id);
    assert.ok(node);
    return node;
  };
  const calls: { method: string; args: Record<string, unknown> }[] = [];
  const timeouts: Array<() => Promise<void> | void> = [];
  const intervals: Array<() => Promise<void> | void> = [];
  let fail = false;
  let controller: { participantId: string; subject?: string } | null = null;
  const members: Array<{
    id: string;
    name: string;
    color: string;
    cursor: {
      x: number;
      y: number;
      target?: { kind: string; id?: number };
    } | null;
  }> = [];
  const document = {
    onvisibilitychange: () => {},
    hidden: false,
    getElementById: element,
    createElement: () => new Element(),
  };
  const listeners = new Map<string, () => void>();
  const window = {
    addEventListener: (name: string, callback: () => void) =>
      listeners.set(name, callback),
  };
  const context = vm.createContext({
    AbortSignal,
    document,
    window,
    location: { hash: "#token", pathname: "/view", search: "" },
    sessionStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    history: { replaceState: () => {} },
    crypto: { randomUUID: () => "request" },
    setTimeout: (f: () => Promise<void> | void) => timeouts.push(f),
    setInterval: (f: () => Promise<void> | void) => intervals.push(f),
    fetch: async (url: string, init: { body: string }) => {
      if (fail) throw Error("Network lost");
      let data: unknown;
      if (url.endsWith("/session"))
        data = {
          generation: "generation",
          admin,
          scopes: ["input-control", "viewer-read", "presence"],
        };
      else if (url.endsWith("/frame"))
        data = {
          participants: members,
          controller,
          image: { width: 100, height: 100, base64: "png" },
          observationId: "observation",
        };
      else {
        const body = JSON.parse(init.body);
        calls.push(body);
        const response: { ok: boolean; result: unknown } = {
          ok: true,
          result: {},
        };
        data = response;
        if (body.method === "presence.join") {
          response.result = {
            id: "self",
            name: body.args.name,
            color: "#fff",
            cursor: null,
          };
          members.push({
            id: "self",
            name: body.args.name,
            color: "#fff",
            cursor: null,
          });
        }
        if (body.method === "takeover") {
          response.result = { id: "lease" };
          controller = { participantId: "self" };
        }
        if (body.method === "release") controller = null;
      }
      return { ok: true, json: async () => data };
    },
  });
  const match = desktopHTML("/api").match(/<script>([\s\S]*)<\/script>/);
  assert.ok(match);
  const script = match[1];
  vm.runInContext(script, context);
  await settle();
  return {
    element,
    calls,
    timeouts,
    intervals,
    document,
    window,
    context,
    members,
    setController: (value: typeof controller) => (controller = value),
    fail: () => (fail = true),
  };
}

test("viewer renders untrusted names as text and removes stale cursors", async () => {
  const h = await harness();
  h.members.push({
    id: "other",
    name: "<img src=x onerror=alert(1)>",
    color: "#abc",
    cursor: { x: 0.25, y: 0.75 },
  });
  await nextTimer(h.timeouts);
  const cursor = h.element("cursors").children[0];
  assert.equal(cursor.lastChild.textContent, "<img src=x onerror=alert(1)>");
  assert.equal(cursor.style.left, "25%");
  assert.equal(cursor.style.top, "75%");
  h.members.pop();
  await nextTimer(h.timeouts);
  assert.equal(h.element("cursors").children.length, 0);
});

test("viewer identifies each participant during takeover and clears control on remote handoff", async () => {
  const h = await harness();
  await vm.runInContext("document.getElementById('take').onclick()", h.context);
  assert.equal(
    h.calls.find((c) => c.method === "takeover")?.args.participantId,
    "self",
  );
  assert.equal(h.element("release").disabled, false);
  h.setController({ participantId: "other", subject: "Second person" });
  await nextTimer(h.timeouts);
  assert.equal(h.element("release").disabled, true);
  assert.equal(h.element("status").textContent, "Second person has control");
});

test("viewer bounds pointer updates, clears overlays on disconnect and leaves when hidden", async () => {
  const h = await harness();
  for (let i = 0; i < 100; i++)
    vm.runInContext("screen.onpointermove({clientX:50,clientY:25})", h.context);
  assert.equal(h.calls.filter((c) => c.method === "presence.update").length, 0);
  await h.intervals[0]();
  assert.deepEqual(h.calls.find((c) => c.method === "presence.update")?.args, {
    participantId: "self",
    cursor: { x: 0.5, y: 0.25, target: { kind: "display" } },
  });
  await vm.runInContext("document.getElementById('take').onclick()", h.context);
  h.document.hidden = true;
  h.document.onvisibilitychange();
  await settle();
  assert.ok(h.calls.some((c) => c.method === "release"));
  assert.ok(
    h.calls.some(
      (c) => c.method === "presence.leave" && c.args.participantId === "self",
    ),
  );
  assert.equal(h.element("screen").src, undefined);
  assert.equal(h.element("take").disabled, true);
});

test("viewer drops frame, participants, and input authority after a network failure", async () => {
  const h = await harness();
  h.fail();
  await nextTimer(h.timeouts);
  assert.equal(h.element("screen").src, undefined);
  assert.equal(h.element("people").children.length, 0);
  assert.equal(h.element("take").disabled, true);
  assert.equal(h.element("status").textContent, "Network lost");
});

test("viewer escapes script delimiters in the API base", () => {
  assert.equal(
    desktopHTML("</script><script>evil()").match(/<script>/g)?.length,
    1,
  );
});

test("viewer keeps polling when an in-flight frame is superseded by a takeover", async () => {
  const h = await harness();
  const pending = nextTimer(h.timeouts);
  vm.runInContext("epoch++", h.context);
  await pending;
  assert.equal(h.timeouts.length, 1);
  await nextTimer(h.timeouts);
  assert.ok(h.element("screen").src);
});

test("viewer refuses host credentials before joining or streaming", async () => {
  const h = await harness(true);
  assert.match(h.element("status").textContent, /scoped share credential/);
  assert.equal(h.calls.length, 0);
  assert.equal(h.timeouts.length, 0);
  assert.equal(h.element("screen").src, undefined);
  assert.equal(h.element("take").disabled, true);
});

test("viewer hides cursors that refer to a different window or display", async () => {
  const h = await harness();
  h.members.push({
    id: "window-user",
    name: "Window user",
    color: "#abc",
    cursor: { x: 0.5, y: 0.5, target: { kind: "window", id: 99 } },
  });
  await nextTimer(h.timeouts);
  assert.equal(h.element("cursors").children.length, 0);
  assert.equal(h.element("people").children.length, 2);
});

test("viewer sends shifted punctuation as text, not an invalid shortcut", async () => {
  const h = await harness();
  await vm.runInContext("document.getElementById('take').onclick()", h.context);
  await nextTimer(h.timeouts);
  vm.runInContext(
    "screen.onkeydown({key:'!',shiftKey:true,ctrlKey:false,altKey:false,metaKey:false,preventDefault(){}})",
    h.context,
  );
  await settle();
  assert.deepEqual(
    h.calls.find((call) => call.method === "input")?.args.action,
    { kind: "text", text: "!" },
  );
});
