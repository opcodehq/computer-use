import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { LinuxVision } from "./vision.js";
import type { Snapshot } from "../shared/contracts.js";
const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const helper =
  process.env.CU_X11_HELPER ?? resolve(root, "native/linux/build/cu-x11");
const model =
  process.env.CU_YOLO_MODEL_PATH ?? resolve(root, ".models/ui-detector.onnx");
const vision = new LinuxVision();
type WindowInfo = {
  id: number;
  pid: number;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
let current:
  | {
      snapshot: Snapshot;
      window: WindowInfo;
      png: Buffer;
      at: number;
      regions: Awaited<ReturnType<LinuxVision["analyze"]>>;
    }
  | undefined;
const error = (
  message: string,
  code = "InvalidRequest",
  delivery = "notDispatched",
) => Object.assign(new Error(message), { code, delivery });
async function command(args: string[], delivery = "isolated") {
  return (
    await exec(helper, args, {
      encoding: "buffer",
      env: { ...process.env, CU_INPUT_DELIVERY: delivery },
      maxBuffer: 128 * 1024 * 1024,
      timeout: 15000,
    })
  ).stdout;
}
function isolated() {
  if (process.env.CU_LINUX_DESKTOP !== "1" || !process.env.DISPLAY)
    throw error(
      "Start an isolated desktop with bun run desktop:linux -- <agent command>.",
      "DesktopUnavailable",
    );
}
async function windows(): Promise<WindowInfo[]> {
  isolated();
  return JSON.parse((await command(["list"])).toString());
}
async function capture(w: WindowInfo) {
  const raw = await command(["capture", String(w.id)]);
  const match = /^P6\n(\d+) (\d+)\n255\n/.exec(raw.toString("ascii", 0, 80));
  if (!match) throw error("Invalid capture.");
  return sharp(raw.subarray(match[0].length), {
    raw: { width: Number(match[1]), height: Number(match[2]), channels: 3 },
  })
    .png()
    .toBuffer();
}
async function fresh(id: unknown) {
  if (!current || id !== current.snapshot.id || Date.now() - current.at > 30000)
    throw error("Stale snapshot. Observe again.", "StaleTarget");
  const w = (await windows()).find(
    (w) => w.id === current!.window.id && w.pid === current!.window.pid,
  );
  if (!w || JSON.stringify(w) !== JSON.stringify(current.window))
    throw error("Window changed. Observe again.", "StaleTarget");
  return current;
}
const keyNames: Record<string, string> = {
  Enter: "Return",
  Escape: "Escape",
  Tab: "Tab",
  "Shift+Tab": "Shift_L+Tab",
  Space: "space",
  Backspace: "BackSpace",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  ArrowDown: "Down",
  Home: "Home",
  End: "End",
  PageUp: "Prior",
  PageDown: "Next",
  "Meta+A": "Control_L+a",
  "Control+A": "Control_L+a",
  "Control+L": "Control_L+l",
  "Control+C": "Control_L+c",
  "Control+V": "Control_L+v",
  "Control+W": "Control_L+w",
  "Control+T": "Control_L+t",
  "Control+Z": "Control_L+z",
};
async function dispatch(r: Record<string, any>) {
  if (r.method === "status") {
    let available = false,
      installed = false;
    try {
      await windows();
      available = true;
    } catch {}
    try {
      await access(model);
      installed = true;
    } catch {}
    return {
      platform: "linux",
      accessibility: false,
      screenRecording: available,
      isolated: process.env.CU_LINUX_DESKTOP === "1",
      displayReady: available,
      visual: { ocr: true, modelInstalled: installed, modelPath: model },
    };
  }
  if (
    r.method === "requestAccessibility" ||
    r.method === "requestScreenRecording"
  )
    return { granted: process.env.CU_LINUX_DESKTOP === "1" };
  if (r.method === "apps") {
    const list = await windows();
    return Promise.all(
      [...new Set(list.map((w) => w.pid))].map(async (pid) => ({
        pid,
        name: (
          await readFile(`/proc/${pid}/comm`, "utf8").catch(() => String(pid))
        ).trim(),
      })),
    );
  }
  if (r.method === "windows")
    return (await windows())
      .filter((w) => w.pid === r.pid)
      .map((w) => ({ id: w.id, windowId: w.id, title: w.title }));
  if (r.method === "snapshot") {
    current = undefined;
    const list = (await windows()).filter(
      (w) =>
        w.pid === r.pid && (r.windowId === undefined || w.id === r.windowId),
    );
    if (list.length !== 1)
      throw error(
        "Select exactly one visible window with windowId.",
        "WindowAmbiguous",
      );
    const started = performance.now();
    const window = list[0]!,
      png = await capture(window),
      id = randomUUID(),
      regions = await vision.analyze(png, id, model);
    const snapshot: Snapshot = {
      id,
      source: "visual",
      pid: window.pid,
      title: window.title,
      windowId: window.id,
      windowOnScreen: true,
      capturedAt: new Date().toISOString(),
      truncated: false,
      visual: {
        model: "yolo-onnx+ocr",
        durationMs: Math.round(performance.now() - started),
        regionCount: regions.regions.length,
      },
      nodes: [
        {
          ref: `${id}:window`,
          role: "AXWindow",
          name: window.title,
          value: "",
          enabled: true,
          depth: 0,
          actions: [],
          frame: {
            x: window.x,
            y: window.y,
            width: window.width,
            height: window.height,
          },
        },
        {
          ref: `${id}:keyboard`,
          role: "VisualKeyboard",
          name: "Active window keyboard receiver; inspect screenshot to establish focus",
          value: "",
          enabled: true,
          focused: true,
          depth: 1,
          actions: ["insertText"],
        },
        ...regions.regions.map((region) => ({
          ref: region.ref,
          role: region.source === "yolo" ? "VisualControl" : "VisualText",
          name: region.label,
          value: "",
          enabled: true,
          depth: 1,
          actions: ["visualClick"],
          frame: {
            x: region.bounds.x + window.x,
            y: region.bounds.y + window.y,
            width: region.bounds.width,
            height: region.bounds.height,
          },
          visualSource: region.source,
          detectionConfidence: region.confidence,
        })),
      ],
    };
    current = { snapshot, window, png, at: Date.now(), regions };
    return snapshot;
  }
  if (r.method === "detect") {
    const c = await fresh(r.snapshotId);
    return {
      snapshotId: c.snapshot.id,
      ...c.regions,
      pointSize: { width: c.window.width, height: c.window.height },
      origin: { x: c.window.x, y: c.window.y },
      actionable: true,
      model: "yolo-onnx+ocr",
      durationMs: c.snapshot.visual?.durationMs ?? 0,
      image: c.png.toString("base64"),
    };
  }
  if (r.method === "screenshot") {
    const c = await fresh(r.snapshotId);
    const png = await capture(c.window);
    return {
      base64: png.toString("base64"),
      width: c.window.width,
      height: c.window.height,
    };
  }
  if (r.method === "execute" || r.method === "linuxInput") {
    const c = await fresh(r.snapshotId);
    const a = r.action;
    if (!a || typeof a !== "object") throw error("Supply an action.");
    let kind = a.kind,
      x = a.x,
      y = a.y,
      text = a.text;
    if (r.method === "execute") {
      const node = c.snapshot.nodes.find((n) => n.ref === a.ref);
      if (!node) throw error("Unknown ref.", "StaleTarget");
      if (["visualClick","doubleClick","rightClick","hover","drag"].includes(kind) && node.frame) {
        x = node.frame.x - c.window.x + node.frame.width / 2;
        y = node.frame.y - c.window.y + node.frame.height / 2;
        if(kind === "visualClick") kind = "click";
        if(kind === "drag") {
          const destination=c.snapshot.nodes.find(n=>n.ref===a.targetRef&&n.enabled&&n.value!=="[secure]"&&n.frame);
          if(!destination?.frame) throw error("Unknown drag target.","StaleTarget");
          a.toX=destination.frame.x-c.window.x+destination.frame.width/2;
          a.toY=destination.frame.y-c.window.y+destination.frame.height/2;
        }
      } else if (kind === "insertText" && node.role === "VisualKeyboard")
        kind = "type";
      else if (kind === "backgroundKey" && node.role === "VisualKeyboard")
        kind = "key";
      else throw error("Unsupported Linux ref action.");
    }
    let args: string[];
    if (["click", "doubleClick", "rightClick", "hover", "drag"].includes(kind)) {
      if (
        ![x, y].every(Number.isFinite) ||
        x < 0 ||
        y < 0 ||
        x >= c.window.width ||
        y >= c.window.height
      )
        throw error("Click outside captured window.");
      args = [
        kind,
        String(c.window.id),
        String(Math.floor(x)),
        String(Math.floor(y)),
      ];
      if (kind === "drag") {
        if (![a.toX,a.toY].every(Number.isFinite) || a.toX<0 || a.toY<0 || a.toX>=c.window.width || a.toY>=c.window.height) throw error("Drag endpoint outside captured window.");
        args.push(String(Math.floor(a.toX)),String(Math.floor(a.toY)));
      }
    } else if (kind === "type") {
      if (
        typeof text !== "string" ||
        !text ||
        text.length > 8000 ||
        text.includes("\0")
      )
        throw error("Supply 1–8000 characters of text.");
      args = ["type", String(c.window.id), text];
    } else if (kind === "key") {
      if (typeof text !== "string" || !Object.hasOwn(keyNames, text)) throw error("Unsupported key.");
      args = ["key", String(c.window.id), keyNames[text]!];
    } else if (kind === "scroll") {
      if (
        !Number.isInteger(a.amount) ||
        a.amount === 0 ||
        Math.abs(a.amount) > 30
      )
        throw error(
          "Scroll amount must be a nonzero integer between -30 and 30.",
        );
      args = ["scroll", String(c.window.id), String(a.amount)];
    } else throw error("Supported input: click, type, key, scroll.");
    const delivery = a.delivery ?? "isolated";
    if (!["isolated","background"].includes(delivery)) throw error("Unknown input delivery.");
    if (delivery === "background" && !["click","doubleClick","rightClick","hover","drag"].includes(kind)) throw error("Background keyboard and scroll require a semantic browser route.", "Unsupported");
    // Bind input to the image the agent inspected, allowing only small cursor/caret changes.
    const before = await sharp(c.png)
      .resize(96, 64)
      .removeAlpha()
      .raw()
      .toBuffer();
    const now = await sharp(await capture(c.window))
      .resize(96, 64)
      .removeAlpha()
      .raw()
      .toBuffer();
    let difference = 0;
    for (let i = 0; i < before.length; i++)
      difference += Math.abs(before[i]! - now[i]!);
    if (difference / before.length > 3)
      throw error(
        "Screen changed since observation. Observe again.",
        "StaleTarget",
      );
    current = undefined;
    try {
      await command(args, delivery);
    } catch {
      throw error(
        "Input delivery is unknown; observe before retrying.",
        "InputFailed",
        "unknown",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 180));
    return { delivery: "dispatchedUnverified", inputRoute: delivery === "background" ? "x11-send-event" : "isolated-xtest", acceptedByApp: "unverified" };
  }
  if (r.method === "installedApps") return [];
  throw error("Unsupported Linux driver method: " + r.method, "Unsupported");
}
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  let id: unknown = null;
  try {
    if (line.length > 120000) throw error("Request too large.");
    const r = JSON.parse(line);
    id = r.id;
    const data = await dispatch(r);
    process.stdout.write(JSON.stringify({ id, ok: true, data }) + "\n");
  } catch (e) {
    const failure = e as Error & { code?: string; delivery?: string };
    process.stdout.write(
      JSON.stringify({
        id,
        ok: false,
        error: {
          code: failure.code ?? "DriverError",
          message: failure.message,
          delivery: failure.delivery ?? "notDispatched",
        },
      }) + "\n",
    );
  }
}
await vision.close();
