import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const artifactDir = process.cwd() + "/.context/linux-smoke-" + Date.now();
await mkdir(artifactDir, { recursive: true });
let saved = "";
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    if (new URL(req.url).pathname === "/save") {
      saved = await req.text();
      return new Response("ok");
    }
    return new Response(
      `<html><title>CU desktop test</title><style>body{font:24px Arial;padding:70px;background:#f6f6f6}input,button{font:24px Arial;padding:14px;margin:12px;display:block}h1{font-size:36px}</style><h1>Cloud desktop test</h1><label>Project name</label><input id="name" placeholder="Enter project name"><button onclick="localStorage.setItem('project',document.querySelector('input').value);fetch('/save',{method:'POST',body:document.querySelector('input').value});document.querySelector('h2').textContent='Saved: '+localStorage.getItem('project')">Save project</button><h2></h2><script>document.querySelector('h2').textContent=localStorage.getItem('project')?'Saved: '+localStorage.getItem('project'):''</script></html>`,
      { headers: { "content-type": "text/html" } },
    );
  },
});
const chrome = spawn(
  "google-chrome",
  [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--password-store=basic",
    "--user-data-dir=/tmp/cu-linux-test-" + process.pid,
    "--window-size=1200,850",
    server.url.href,
  ],
  { stdio: "ignore" },
);
const session = "linux-live-" + process.pid;
async function cli(command, input = {}) {
  const p = Bun.spawn(
    [
      "bun",
      "dist/cli.mjs",
      command,
      "--session",
      session,
      "--no-preview",
      "--input-json",
      JSON.stringify(input),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  if (code) throw new Error(command + ": " + err);
  return JSON.parse(out);
}
try {
  await Bun.sleep(2500);
  const apps = await cli("apps");
  console.log("APPS", apps);
  const app = String(apps[0].pid);
  let s = await cli("observe", { app });
  console.log("OBSERVED", s.visual, s.nodes.map((n) => n.name).join("|"));
  assert(s.nodes.some((n) => n.visualSource === "yolo"));
  assert(s.nodes.some((n) => n.name === "Project"));
  const capture = await cli("capture", {
    app,
    outputPath: artifactDir + "/before.png",
  });
  s = capture.snapshot;
  // Use the screenshot's input box, then keyboard delivery; no DOM evaluation.
  async function action(action) {
    const r = await cli("input", { app, snapshotId: s.id, action });
    s = r.snapshot;
    console.log("ACTION", action.kind, s.nodes.map((n) => n.name).join("|"));
  }
  await cli('pause');
  await assert.rejects(cli('input', { app, snapshotId: s.id, action: { kind: 'key', text: 'Tab' } }), /paused/);
  await cli('resume');
  await assert.rejects(cli('input', { app, snapshotId: s.id, action: { kind: 'key', text: 'Tab' } }), /Observe fresh/);
  s = await cli('observe', { app });
  const staleId = s.id;
  const box = s.nodes.find(
    (n) => n.visualSource === "yolo" && n.name.includes("Enter"),
  );
  assert(box, "YOLO input box labeled from OCR");
  await action({
    kind: "click",
    x: box.frame.x + box.frame.width / 2,
    y: box.frame.y + box.frame.height / 2,
  });
  await assert.rejects(cli('input', { app, snapshotId: staleId, action: { kind: 'key', text: 'Tab' } }), /Stale/);
  await action({ kind: "type", text: "Cloud success 42" });
  await action({ kind: "key", text: "Tab" });
  await action({ kind: "key", text: "Enter" });
  assert(
    s.nodes.some((n) => n.name === "Saved:"),
    "Save result visible",
  );
  assert.equal(
    saved,
    "Cloud success 42",
    "Exact saved text matches caller input",
  );
  await action({ kind: "key", text: "Control+L" });
  await action({ kind: "type", text: server.url.href });
  await action({ kind: "key", text: "Enter" });
  assert(
    s.nodes.some((n) => n.name === "Saved:"),
    "Saved result persisted after navigation",
  );
  const result = await cli("capture", {
    app,
    outputPath: artifactDir + "/after.png",
  });
  await writeFile(
    artifactDir + "/result.json",
    JSON.stringify(result.snapshot, null, 2),
  );
  console.log("LIVE TEST PASSED; evidence: " + artifactDir);
} finally {
  await cli("stop").catch(() => {});
  chrome.kill();
  server.stop();
}
