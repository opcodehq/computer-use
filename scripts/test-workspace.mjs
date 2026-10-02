import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const artifacts = await mkdtemp(
  join(process.cwd(), ".context/workspace-test-"),
);
const session = "workspace-" + process.pid;
let saved = "",
  uploaded = "",
  dragged = false;
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/saved") {
      saved = await req.text();
      return new Response("ok");
    }
    if (u.pathname === "/upload") {
      uploaded = await req.text();
      return new Response("ok");
    }
    if (u.pathname === "/dragged") {
      dragged = true;
      return new Response("ok");
    }
    if (u.pathname === "/download")
      return new Response("CU download verified", {
        headers: { "content-disposition": 'attachment; filename="result.txt"' },
      });
    if (u.pathname === "/frame")
      return new Response(
        "<button onclick=\"this.textContent='Frame complete'\">Frame action</button>",
        { headers: { "content-type": "text/html" } },
      );
    return new Response(
      `<!doctype html><html><title>Workspace test</title><style>body{font:20px Arial;padding:25px;background:#fafafa}button,input,a{font:18px Arial;margin:10px;padding:10px}#drag,#drop{width:130px;height:80px;background:#ddd;display:inline-block;margin:10px;padding:15px}iframe{display:block;margin:20px}</style><h1>Workspace test</h1><input placeholder="Project name"><button onclick="fetch('/saved',{method:'POST',body:document.querySelector('input').value});document.querySelector('h2').textContent='Saved successfully'">Save project</button><h2></h2><button ondblclick="this.textContent='Double complete'">Double action</button><button oncontextmenu="event.preventDefault();this.textContent='Right complete'">Right action</button><button onmouseover="this.textContent='Hover complete'">Hover action</button><div id="drag" role="button" onmousedown="window.dragging=true">Drag source</div><div id="drop" role="button" onmouseup="if(window.dragging){fetch('/dragged');this.textContent='Drop complete'}window.dragging=false">Drop target</div><button onclick="let v=prompt('Your label');this.textContent=v||'Dismissed'">Prompt action</button><input aria-label="Upload file" type="file" onchange="this.files[0].text().then(t=>fetch('/upload',{method:'POST',body:t}))"><a href="/download" download>Download result</a><a href="/second" target="_blank">Open popup</a><iframe src="/frame"></iframe></html>`,
      { headers: { "content-type": "text/html" } },
    );
  },
});
async function cli(command, input = {}) {
  const p = Bun.spawn(
    [
      ...(process.env.CU_TEST_CLI ? [process.env.CU_TEST_CLI] : ["bun", "dist/cli.mjs"]),
      command,
      "--session",
      session,
      "--no-preview",
      "--input-json",
      JSON.stringify(input),
    ],
    {
      env: { ...process.env, CU_BROWSER_NO_SANDBOX: "1" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  if (code) throw new Error(err);
  return JSON.parse(out);
}
let fixture;
try {
  execFileSync("cc", [
    "tests/fixtures/pointer-window.c",
    "-lX11",
    "-o",
    artifacts + "/pointer-window",
  ]);
  fixture = spawn(artifacts + "/pointer-window", [], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const events = [];
  createInterface({ input: fixture.stdout }).on("line", (line) =>
    events.push(JSON.parse(line)),
  );
  await Bun.sleep(500);
  const app = String(fixture.pid);
  let native = await cli("observe", { app });
  const state = () =>
    JSON.parse(
      execFileSync("native/linux/build/cu-x11", ["state"], {
        encoding: "utf8",
      }),
    );
  const baseline = state();
  for (const kind of ["hover", "rightClick", "doubleClick", "drag"]) {
    const result = await cli("input", {
      app,
      snapshotId: native.id,
      action: {
        kind,
        x: 100,
        y: 100,
        toX: 250,
        toY: 200,
        delivery: "background",
      },
    });
    native = result.snapshot;
  }
  assert.deepEqual(
    state(),
    baseline,
    "Background delivery preserves actual pointer and focus",
  );
  assert(
    events.some((e) => e.type === 4 && e.button === 3 && e.synthetic),
    "Background right click reached app",
  );
  assert(
    events.filter((e) => e.type === 4 && e.button === 1).length >= 3,
    "Double click and drag reached app",
  );
  assert(
    events.some((e) => e.type === 6 && e.x === 250 && e.y === 200),
    "Drag endpoint reached app",
  );
  console.log("PASS native gestures + background focus/pointer preservation");
  const nativeViewer=await cli("viewer",{app});
  const nativeURL=new URL(nativeViewer.shareUrl);
  const nativeFrame=await fetch(nativeURL.origin+"/api/frame",{headers:{Authorization:"Bearer "+nativeURL.hash.slice(1)}});
  assert.equal(nativeFrame.status,200);
  await writeFile(artifacts+"/native-frame.png",Buffer.from(await nativeFrame.arrayBuffer()));
  const open = await cli("browser", { operation: "open" });
  const pageId = open.tabs[0].id;
  const browserBaseline = state();
  const b = (operation, args = {}) =>
    cli("browser", { operation, pageId, ...args });
  await b("navigate", { url: server.url.href });
  let snapshot;
  async function observe() {
    snapshot = await b("observe");
    return snapshot;
  }
  function ref(label) {
    const n = snapshot.nodes.find((n) => n.name === label);
    assert(n, "Missing " + label);
    return n.ref;
  }
  async function action(operation, label, extra = {}) {
    await observe();
    return b(operation, {
      snapshotId: snapshot.snapshotId,
      ref: ref(label),
      ...extra,
    });
  }
  await action("fill", "Project name", { text: "Exact workspace value" });
  await action("click", "Save project");
  assert.equal(saved, "Exact workspace value");
  await action("doubleClick", "Double action");
  await observe();
  assert(ref("Double complete"));
  await action("rightClick", "Right action");
  await observe();
  assert(ref("Right complete"));
  await action("hover", "Hover action");
  await observe();
  assert(ref("Hover complete"));
  await observe();
  await b("drag", {
    snapshotId: snapshot.snapshotId,
    ref: ref("Drag source"),
    targetRef: ref("Drop target"),
  });
  assert.equal(dragged, true);
  const sibling = await b("newTab", { url: server.url.href + "temporary" });
  await cli("browser", { operation: "closeTab", pageId: sibling.pageId });
  assert.deepEqual(
    state(),
    browserBaseline,
    "Browser gestures do not move desktop pointer or focus",
  );
  await action("click", "Prompt action");
  const dialogs = await b("dialogs");
  assert.equal(dialogs.length, 1);
  await b("dialog", {
    dialogId: dialogs[0].id,
    accept: true,
    text: "Accepted label",
  });
  await observe();
  assert(ref("Accepted label"));
  const upload = artifacts + "/upload.txt";
  await writeFile(upload, "CU upload verified");
  await action("upload", "Upload file", { paths: [upload] });
  assert.equal(uploaded, "CU upload verified");
  await action("click", "Download result");
  await Bun.sleep(100);
  const downloads = await b("downloads");
  assert.equal(downloads.length, 1);
  await b("download", {
    downloadId: downloads[0].id,
    outputPath: artifacts + "/download.txt",
  });
  assert.equal(
    await readFile(artifacts + "/download.txt", "utf8"),
    "CU download verified",
  );
  const frames = await b("frames");
  const frame = frames.find((f) => !f.main);
  assert(frame);
  snapshot = await b("observe", { frameId: frame.id });
  await b("click", {
    snapshotId: snapshot.snapshotId,
    ref: ref("Frame action"),
  });
  snapshot = await b("observe", { frameId: frame.id });
  assert(ref("Frame complete"));
  await action("click", "Open popup");
  await Bun.sleep(100);
  let tabs = await b("tabs");
  assert.equal(tabs.length, 2);
  const second = tabs.find((t) => t.id !== pageId);
  await cli("browser", { operation: "closeTab", pageId: second.id });
  await observe();
  const stale = snapshot.snapshotId;
  await b("fill", {
    snapshotId: stale,
    ref: ref("Project name"),
    text: "New value",
  });
  await assert.rejects(
    b("click", { snapshotId: stale, ref: ref("Save project") }),
    /Stale/,
  );
  await observe();
  const viewer = await cli("viewer");
  const controlURL = new URL(viewer.url),
    viewURL = new URL(viewer.shareUrl);
  const auth = { Authorization: "Bearer " + controlURL.hash.slice(1) },
    viewAuth = { Authorization: "Bearer " + viewURL.hash.slice(1) };
  const origin = controlURL.origin;
  assert.equal((await fetch(origin + "/api/state")).status, 401);
  assert.equal(
    (
      await fetch(origin + "/api/takeover", {
        method: "POST",
        headers: viewAuth,
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(origin + "/api/frame", { headers: viewAuth })).status,
    200,
  );
  await writeFile(
    artifacts + "/viewer-frame.png",
    Buffer.from(
      await (
        await fetch(origin + "/api/frame", { headers: auth })
      ).arrayBuffer(),
    ),
  );
  assert.equal(
    (
      await fetch(origin + "/api/takeover", {
        method: "POST",
        headers: auth,
        body: "{}",
      })
    ).status,
    200,
  );
  await assert.rejects(b("navigate", { url: server.url.href }), /paused/);
  assert.equal(
    (
      await fetch(origin + "/api/input", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          kind: "key",
          text: "Tab",
          frameId: (
            await fetch(origin + "/api/frame", { headers: auth })
          ).headers.get("X-CU-Frame"),
        }),
      })
    ).status,
    200,
  );
  async function manual(action) {
    const frame = await fetch(origin + "/api/frame", { headers: auth });
    const r = await fetch(origin + "/api/input", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        ...action,
        frameId: frame.headers.get("X-CU-Frame"),
      }),
    });
    assert.equal(r.status, 200, await r.text());
  }
  const inputNode = snapshot.nodes.find((n) => n.name === "Project name");
  const saveNode = snapshot.nodes.find((n) => n.name === "Save project");
  await manual({
    kind: "click",
    x: inputNode.bounds.x + inputNode.bounds.width / 2,
    y: inputNode.bounds.y + inputNode.bounds.height / 2,
  });
  await manual({ kind: "key", text: "Control+A" });
  await manual({ kind: "type", text: "Human takeover verified" });
  await manual({
    kind: "click",
    x: saveNode.bounds.x + saveNode.bounds.width / 2,
    y: saveNode.bounds.y + saveNode.bounds.height / 2,
  });
  assert.equal(saved, "Human takeover verified");
  assert.equal(
    (
      await fetch(origin + "/api/resume", {
        method: "POST",
        headers: auth,
        body: "{}",
      })
    ).status,
    200,
  );
  await observe();
  console.log(
    "PASS browser tabs, frames, gestures, dialog, upload/download, stale refs, viewer auth/sharing/takeover",
  );
  console.log("ARTIFACTS " + artifacts);
  if (process.env.CU_KEEP_VIEWER === "1") {
    await writeFile(".context/viewer-live.json", JSON.stringify(viewer));
    console.log("Viewer retained for UI verification");
    await Bun.sleep(120000);
  }
} finally {
  await cli("stop").catch(() => {});
  fixture?.kill();
  server.stop();
}
