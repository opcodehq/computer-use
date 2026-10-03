import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ppmToPNG } from "../linux/capture.js";
import { failure, type Target, type Action } from "./protocol.js";
const exec = promisify(execFile);
export interface Geometry {
  id: number;
  width: number;
  height: number;
  x: number;
  y: number;
  pid?: number;
  title?: string;
}
export class X11Backend {
  constructor(
    readonly helper: string,
    readonly env: NodeJS.ProcessEnv,
  ) {}
  async run(args: string[], signal?: AbortSignal): Promise<Buffer> {
    signal?.throwIfAborted();
    return new Promise<Buffer>((resolve, reject) => {
      let result: Buffer | undefined;
      let failed = false;
      const child = execFile(
        this.helper,
        args,
        {
          env: this.env,
          signal,
          killSignal: "SIGTERM",
          timeout: 10000,
          encoding: "buffer",
          maxBuffer: 110 * 1024 * 1024,
        },
        (error, stdout) => {
          failed = Boolean(error);
          result = stdout;
        },
      );
      const hardTimeout = setTimeout(() => child.kill("SIGKILL"), 11000);
      let abortTimeout: ReturnType<typeof setTimeout> | undefined;
      const abort = () => {
        abortTimeout = setTimeout(() => child.kill("SIGKILL"), 500);
      };
      signal?.addEventListener("abort", abort, { once: true });
      child.once("error", () => {
        failed = true;
      });
      child.once("close", (code) => {
        clearTimeout(hardTimeout);
        clearTimeout(abortTimeout);
        signal?.removeEventListener("abort", abort);
        if (failed || code !== 0 || !result)
          reject(
            failure(
              signal?.aborted ? "cancelled" : "display_unavailable",
              "X11 operation failed. Check DISPLAY, Xauthority, user and display health.",
            ),
          );
        else resolve(result);
      });
    });
  }
  async geometry(target: Target): Promise<Geometry> {
    if (target.kind === "display") {
      const value = JSON.parse((await this.run(["display"])).toString());
      return { ...value, x: 0, y: 0 };
    }
    const window = (await this.windows()).find(
      (w: Geometry) => w.id === target.id,
    );
    if (!window)
      throw failure("stale_observation", "Window is no longer mapped.");
    return window;
  }
  async windows(): Promise<Geometry[]> {
    return JSON.parse((await this.run(["list"])).toString());
  }
  async apps() {
    const entries = new Map<
      string,
      { id: string; name: string; path: string }
    >();
    for (const directory of [
      "/usr/share/applications",
      join(homedir(), ".local/share/applications"),
    ])
      for (const id of await readdir(directory).catch(() => [])) {
        if (!/^[a-zA-Z0-9_.-]+\.desktop$/.test(id)) continue;
        const path = join(directory, id),
          text = await readFile(path, "utf8").catch(() => "");
        if (/^Hidden=true$/m.test(text) || !/^Type=Application$/m.test(text))
          continue;
        entries.set(id, {
          id,
          name: /^Name=(.+)$/m.exec(text)?.[1] ?? id,
          path,
        });
      }
    return [...entries.values()];
  }
  async state() {
    return JSON.parse((await this.run(["state"])).toString()) as {
      focus: number;
      appClass?: string;
      x: number;
      y: number;
    };
  }
  async capture(target: Target) {
    const geometry = await this.geometry(target);
    const ppm = await this.run([
      "capture",
      target.kind === "display" ? "root" : String(target.id),
    ]);
    const match = /^P6\n(\d+) (\d+)\n255\n/.exec(ppm.toString("ascii", 0, 80));
    if (!match || +match[1] !== geometry.width || +match[2] !== geometry.height)
      throw failure("stale_observation", "Display resized during capture.");
    const offset = match[0].length,
      sample = Buffer.alloc(64 * 48 * 3);
    for (let y = 0; y < 48; y++)
      for (let x = 0; x < 64; x++) {
        const p =
          offset +
          (Math.floor((y * geometry.height) / 48) * geometry.width +
            Math.floor((x * geometry.width) / 64)) *
            3;
        ppm.copy(sample, (y * 64 + x) * 3, p, p + 3);
      }
    return { geometry, ppm, png: ppmToPNG(ppm), sample };
  }
  async prepareAction(action: Action): Promise<Action> {
    if (action.kind !== "text" || action.pasteKey) return action;
    const name = (await this.state()).appClass?.toLowerCase() ?? "";
    return {
      ...action,
      pasteKey: name.includes("xterm")
        ? "Shift+Insert"
        : /terminal|kitty|alacritty|tilix/.test(name)
          ? "Control+Shift+v"
          : "Control+v",
    };
  }
  async input(target: Target, action: Action, signal: AbortSignal) {
    if (action.kind === "launch") {
      const app = (await this.apps()).find((a) => a.id === action.appId);
      if (!app) throw failure("not_found", "Unknown installed app ID.");
      await exec("gio", ["launch", app.path], {
        env: this.env,
        signal,
        timeout: 10000,
      });
      return;
    }
    const window = target.kind === "display" ? "root" : String(target.id);
    let args: string[];
    if ("x" in action)
      args = [
        action.kind,
        window,
        String(Math.floor(action.x)),
        String(Math.floor(action.y)),
        ...(action.kind === "drag"
          ? [String(Math.floor(action.toX)), String(Math.floor(action.toY))]
          : []),
      ];
    else if (action.kind === "text")
      args = [
        "type",
        window,
        action.text,
        action.pasteKey === "Shift+Insert"
          ? "Shift_L+Insert"
          : action.pasteKey === "Control+Shift+v"
            ? "Control_L+Shift_L+v"
            : "Control_L+v",
      ];
    else if (action.kind === "scroll")
      args = [
        action.axis === "x" ? "scrollX" : "scroll",
        window,
        String(action.amount),
      ];
    else if (action.kind === "focus") args = ["focus", String(action.windowId)];
    else if ("key" in action) {
      const names: Record<string, string> = {
        Enter: "Return",
        Space: "space",
        Backspace: "BackSpace",
        ArrowLeft: "Left",
        ArrowRight: "Right",
        ArrowUp: "Up",
        ArrowDown: "Down",
        Control: "Control_L",
        Shift: "Shift_L",
        Alt: "Alt_L",
        Meta: "Super_L",
      };
      args = [
        action.kind,
        window,
        action.key
          .split("+")
          .map((k) => names[k] ?? k)
          .join("+"),
      ];
    } else args = [action.kind, window, String(action.button)];
    signal.throwIfAborted();
    await this.run(args, signal);
  }
  async resize(width: number, height: number) {
    try {
      await exec("xrandr", ["--fb", `${width}x${height}`], {
        env: this.env,
        timeout: 5000,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw failure(
          "unsupported",
          "Install xrandr to enable display resize requests.",
        );
      throw failure(
        "unsupported",
        "This display does not support the requested RandR size.",
      );
    }
    return this.geometry({ kind: "display" });
  }
}
