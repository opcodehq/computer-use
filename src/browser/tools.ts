import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { dirname } from "node:path";
import { compiled } from "../tool/runtime.js";
import {
  type BrowserContext,
  type Browser,
  type Page,
  type Frame,
  type ElementHandle,
  type Dialog,
  type Download,
} from "playwright-core";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  stat,
  copyFile,
  chmod,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { constants } from "node:fs";

type Binding = {
  page: Page;
  frame: Frame;
  element: ElementHandle;
  url: string;
};
const operations = [
  "open",
  "attach",
  "detach",
  "tabs",
  "newTab",
  "closeTab",
  "frames",
  "observe",
  "navigate",
  "back",
  "forward",
  "reload",
  "click",
  "doubleClick",
  "rightClick",
  "hover",
  "drag",
  "fill",
  "key",
  "scroll",
  "select",
  "upload",
  "dialogs",
  "dialog",
  "downloads",
  "download",
  "capture",
  "close",
] as const;
export const browserOperations = [...operations];
export const browserReads = new Set([
  "tabs",
  "frames",
  "observe",
  "dialogs",
  "downloads",
  "capture",
]);
function required(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value || value.length > 16000)
    throw new Error("Supply " + key);
  return value;
}
function url(value: string) {
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new Error("Only HTTP(S) navigation is supported.");
  return parsed.href;
}

/** Bind refs to exact pages in an owned context or explicitly connected local browser. */
export class BrowserTools {
  private context?: BrowserContext;
  private attached?: Browser;
  private pageListener?: (page: Page) => void;
  private listeners: Array<() => void> = [];
  private pages = new Map<string, Page>();
  private frames = new Map<string, Frame>();
  private refs = new Map<string, Binding>();
  private snapshotId = "";
  private observedPage?: Page;
  private active?: Page;
  private title = "";
  private dialogs = new Map<string, { page: Page; dialog: Dialog }>();
  private downloads = new Map<string, { page: Page; download: Download }>();
  private pending?: Promise<unknown>;
  private dialogWake?: () => void;
  private artifactDir = "";
  private busy = false;
  activity?: (message: string, pointer?: { x: number; y: number }) => void;
  constructor(
    private readonly launch: {
      executablePath?: string;
      headless?: boolean;
      args?: string[];
    } = {},
  ) {}
  private pageId(page: Page) {
    return [...this.pages].find(([, p]) => p === page)?.[0];
  }
  private register(page: Page) {
    if (this.pageId(page)) return;
    const id = randomUUID();
    this.pages.set(id, page);
    this.active ??= page;
    if (!this.attached) page.setDefaultTimeout(5000);
    const onClose = () => {
      this.pages.delete(id);
      if (this.active === page) this.active = [...this.pages.values()][0];
      this.invalidate();
    };
    const onNavigate = () => {
      if (this.observedPage === page) this.invalidate();
    };
    const onDialog = (dialog: Dialog) => {
      this.dialogs.set(randomUUID(), { page, dialog });
      this.dialogWake?.();
    };
    const onDownload = (download: Download) => { this.downloads.set(randomUUID(), { page, download }); };
    page.on("close", onClose); page.on("framenavigated", onNavigate);
    page.on("dialog", onDialog); page.on("download", onDownload);
    this.listeners.push(() => { page.off("close", onClose); page.off("framenavigated", onNavigate); page.off("dialog", onDialog); page.off("download", onDownload); });
  }
  private invalidate() {
    this.snapshotId = "";
    for (const b of this.refs.values())
      void b.element.dispose().catch(() => {});
    this.refs.clear();
  }
  private page(input: Record<string, unknown>) {
    const id = required(input, "pageId");
    const page = this.pages.get(id);
    if (!page || page.isClosed())
      throw new Error("Unknown or closed pageId. List tabs.");
    return page;
  }
  private async binding(
    input: Record<string, unknown>,
    page: Page,
    key = "ref",
  ) {
    if (
      input.snapshotId !== this.snapshotId ||
      !this.snapshotId ||
      this.observedPage !== page
    )
      throw new Error("Stale browser snapshot. Observe again.");
    const b = this.refs.get(required(input, key));
    if (
      !b ||
      b.page !== page ||
      b.frame.isDetached() ||
      b.frame.url() !== b.url ||
      !(await b.element.evaluate((el) => el.isConnected))
    )
      throw new Error("Stale browser ref.");
    return b;
  }
  private async snapshot(page: Page, frameId?: unknown) {
    this.invalidate();
    this.observedPage = page;
    this.active = page;
    const id = randomUUID(),
      frames =
        frameId === undefined
          ? page.frames()
          : [this.frames.get(String(frameId))];
    if (frames.some((f) => !f || f.page() !== page || f.isDetached()))
      throw new Error("Unknown frame in this page.");
    const nodes: unknown[] = [];
    let truncated = false;
    for (const frame of frames) {
      const fid =
        [...this.frames].find(([, f]) => f === frame)?.[0] ?? randomUUID();
      this.frames.set(fid, frame!);
      const handles = await frame!.$$(
        'button,a,input,textarea,select,[role="button"],[contenteditable="true"],h1,h2,h3,p,[role="status"],[role="alert"]',
      );
      for (const element of handles) {
        if (nodes.length >= 400) {
          truncated = true;
          await element.dispose();
          continue;
        }
        const data = await element
          .evaluate((el) => {
            const input =
              el instanceof HTMLInputElement ||
              el instanceof HTMLTextAreaElement;
            const secure =
              el instanceof HTMLInputElement && el.type === "password";
            const rect = el.getBoundingClientRect();
            return {
              role: el.getAttribute("role") ?? el.tagName.toLowerCase(),
              name: (
                el.getAttribute("aria-label") ??
                el.getAttribute("placeholder") ??
                el.textContent ??
                ""
              ).slice(0, 1500),
              value: secure ? "[secure]" : input ? el.value.slice(0, 2000) : "",
              secure,
              visible: rect.width > 0 && rect.height > 0,
              type: el.getAttribute("type"),
              enabled: !el.hasAttribute("disabled"),
              bounds: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
              },
            };
          })
          .catch(() => undefined);
        if (!data) {
          await element.dispose();
          continue;
        }
        const ref = id + ":" + nodes.length;
        this.refs.set(ref, { page, frame: frame!, element, url: frame!.url() });
        nodes.push({ ref, frameId: fid, ...data });
      }
    }
    this.snapshotId = id;
    this.title = await page.title();
    return {
      snapshotId: id,
      pageId: this.pageId(page),
      url: page.url(),
      title: this.title,
      nodes,
      truncated,
      dialogs: this.dialogList(),
      downloads: this.downloadList(),
      text: (await page.locator("body").innerText({ timeout: 5000 }).catch(() => "")).slice(0, 24000),
      deliveryMode: "browser-protocol-background",
    };
  }
  private dialogList() {
    return [...this.dialogs].map(([id, { page, dialog }]) => ({
      id,
      pageId: this.pageId(page),
      type: dialog.type(),
      message: dialog.message(),
      defaultValue: dialog.defaultValue(),
    }));
  }
  private downloadList() {
    return [...this.downloads].map(([id, { page, download }]) => ({
      id,
      pageId: this.pageId(page),
      filename: download.suggestedFilename(),
      url: download.url(),
    }));
  }
  async capture() {
    if (!this.active || this.active.isClosed())
      throw new Error("No active browser page.");
    return this.active.screenshot({ type: "png", timeout: 5000 });
  }
  async call(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!browserReads.has(String(input.operation))) await this.checkDisplayOwner();
    if (this.busy) throw new Error("Browser is busy.");
    this.busy = true;
    try {
      return await this.run(input, signal);
    } finally {
      this.busy = false;
    }
  }
  private async run(
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    signal?.throwIfAborted();
    const operation = required(input, "operation");
    if (!browserOperations.includes(operation as (typeof operations)[number]))
      throw new Error("Unsupported browser operation.");
    if (operation === "attach") {
      if (this.context) throw new Error("Close or detach the current browser connection first.");
      const endpoint = new URL(required(input, "endpoint"));
      if (!["http:", "ws:"].includes(endpoint.protocol) || !["127.0.0.1", "[::1]", "localhost"].includes(endpoint.hostname) || endpoint.username || endpoint.password)
        throw new Error("Attachment requires an explicit loopback HTTP or WebSocket debugging endpoint.");
      const runtimeRequire = createRequire(compiled ? join(dirname(dirname(realpathSync(process.execPath))), "libexec", "browser.cjs") : import.meta.url);
      const { chromium } = runtimeRequire("playwright-core") as typeof import("playwright-core");
      if (process.versions.bun) throw new Error('Existing-browser attachment requires the Node CLI runtime. Use the npm-installed cu command, or node dist/cli.mjs.');
      let websocket = endpoint;
      if (endpoint.protocol === "http:") {
        const response = await fetch(new URL('/json/version', endpoint), { redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]) });
        if (!response.ok) throw new Error('The supplied endpoint does not expose Chromium debugging.');
        const version = await response.json() as { webSocketDebuggerUrl?: string };
        websocket = new URL(version.webSocketDebuggerUrl ?? '');
        if (websocket.protocol !== 'ws:' || !['localhost','127.0.0.1','[::1]'].includes(websocket.hostname) || websocket.port !== endpoint.port || websocket.username || websocket.password)
          throw new Error('Debugging discovery returned an unrelated endpoint.');
      }
      const connection = await chromium.connectOverCDP(websocket.href, { noDefaults: true, timeout: 10000 });
      if (signal?.aborted) { await connection.close(); signal.throwIfAborted(); }
      const contexts = connection.contexts();
      if (contexts.length !== 1) { await connection.close(); throw new Error("Expected one existing browser context. Select a dedicated endpoint."); }
      this.artifactDir = await mkdtemp(join(tmpdir(), "cu-browser-"));
      await chmod(this.artifactDir, 0o700);
      this.attached = connection;
      this.context = contexts[0]!;
      this.pageListener = page => this.register(page);
      this.context.on("page", this.pageListener);
      for (const page of this.context.pages()) this.register(page);
      return { tabs: await this.run({ operation: "tabs" }), isolation: "attached-existing-browser", next: "Select an exact pageId. No tab is inferred from a native app name. Closing this connection detaches and preserves the browser." };
    }
    if (operation === "detach") { await this.close(); return { status: "detached" }; }
    if (operation === "open") {
      if (!this.context) {
        if (
          process.platform === "linux" &&
          this.launch.headless !== true &&
          process.env.CU_LINUX_DESKTOP !== "1"
        )
          throw new Error("Start an isolated Linux desktop first.");
        this.artifactDir = await mkdtemp(join(tmpdir(), "cu-browser-"));
        await chmod(this.artifactDir, 0o700);
        const runtimeRequire = createRequire(
          compiled
            ? join(
                dirname(dirname(realpathSync(process.execPath))),
                "libexec",
                "browser.cjs",
              )
            : import.meta.url,
        );
        const { chromium } = runtimeRequire(
          "playwright-core",
        ) as typeof import("playwright-core");
        const browser = await chromium.launch({
          channel: "chrome",
          headless: process.platform === "darwin",
          ...this.launch,
        });
        try {
          this.context = await browser.newContext({
            acceptDownloads: true,
            viewport: { width: 1200, height: 800 },
          });
        } catch (error) {
          await browser.close();
          throw error;
        }
        this.context.on("page", (page) => this.register(page));
        this.context.on("close", () => {
          void browser.close();
          this.context = undefined;
          this.invalidate();
        });
        await this.context.newPage();
      }
      return {
        tabs: await this.run({ operation: "tabs" }),
        isolation: this.attached ? "attached-existing-browser" : "owned-browser-context",
        background: true,
      };
    }
    if (operation === "close") {
      await this.close();
      return { status: "closed" };
    }
    if (!this.context) throw new Error("Open the session browser first.");
    if (operation === "tabs")
      return Promise.all(
        [...this.pages].map(async ([id, page]) => ({
          id,
          url: page.url(),
          title: await page.title().catch(() => ""),
          active: this.active === page,
        })),
      );
    if (operation === "dialogs") return this.dialogList();
    if (operation === "downloads") return this.downloadList();
    if (operation === "dialog") {
      const id = required(input, "dialogId"),
        entry = this.dialogs.get(id);
      if (!entry || this.page(input) !== entry.page)
        throw new Error("Unknown dialog for page.");
      if (typeof input.accept !== "boolean")
        throw new Error("Supply accept: true or false.");
      this.dialogs.delete(id);
      if (input.accept)
        await entry.dialog.accept(
          typeof input.text === "string" ? input.text : undefined,
        );
      else await entry.dialog.dismiss();
      if (this.pending) await this.pending;
      this.pending = undefined;
      return { status: "handled", pageId: this.pageId(entry.page) };
    }
    if (this.pending)
      throw new Error(
        "Handle the pending dialog before another browser operation.",
      );
    if (operation === "newTab") {
      const page = await this.context.newPage();
      this.active = page;
      if (input.url)
        await page.goto(url(required(input, "url")), {
          waitUntil: "domcontentloaded",
        });
      return { pageId: this.pageId(page), url: page.url() };
    }
    const page = this.page(input);
    this.active = page;
    if (operation === "frames")
      return page.frames().map((frame) => {
        const id =
          [...this.frames].find(([, f]) => f === frame)?.[0] ?? randomUUID();
        this.frames.set(id, frame);
        return {
          id,
          name: frame.name(),
          url: frame.url(),
          main: frame === page.mainFrame(),
        };
      });
    if (operation === "observe") return this.snapshot(page, input.frameId);
    if (operation === "capture")
      return {
        pageId: this.pageId(page),
        image: { base64: (await this.capture()).toString("base64") },
      };
    if (operation === "download") {
      const entry = this.downloads.get(required(input, "downloadId"));
      if (!entry || entry.page !== page)
        throw new Error("Unknown download for page.");
      const path = resolve(required(input, "outputPath"));
      await mkdir(this.artifactDir, { recursive: true });
      const temporary = join(this.artifactDir, randomUUID());
      await entry.download.saveAs(temporary);
      signal?.throwIfAborted();
      await chmod(temporary, 0o600);
      await copyFile(temporary, path, constants.COPYFILE_EXCL);
      await chmod(path, 0o600);
      return {
        status: "saved",
        path,
        filename: entry.download.suggestedFilename(),
      };
    }
    signal?.throwIfAborted();
    const attachedMac = Boolean(this.attached) && process.platform === 'darwin';
    if (attachedMac && ['key','doubleClick','rightClick','hover','drag'].includes(operation))
      throw new Error('This attached Mac gesture would require focus-sensitive browser input. Use a native semantic control or an isolated browser. No event sent.');
    let action: () => Promise<unknown>;
    if (operation === "navigate") {
      const destination = url(required(input, "url"));
      action = () =>
        page.goto(destination, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
    } else if (operation === "closeTab")
      action = () => page.close({ runBeforeUnload: false });
    else if (
      operation === "back" ||
      operation === "forward" ||
      operation === "reload"
    )
      action = () =>
        operation === "back"
          ? page.goBack({ waitUntil: "domcontentloaded" })
          : operation === "forward"
            ? page.goForward({ waitUntil: "domcontentloaded" })
            : page.reload({ waitUntil: "domcontentloaded" });
    else if (operation === "key") {
      const key = required(input, "key");
      if (key.length > 100) throw new Error("Key too long.");
      const receiver=await this.binding(input, page);
      action = async () => { await receiver.element.focus(); await page.keyboard.press(key); };
    } else if (operation === "scroll") {
      const b = await this.binding(input, page);
      const amount = input.amount;
      if (
        typeof amount !== "number" ||
        !Number.isFinite(amount) ||
        Math.abs(amount) > 5000
      )
        throw new Error("Scroll amount must be within 5000 pixels.");
      action = attachedMac ? () => b.element.evaluate((el, amount) => {
        const target = el as HTMLElement;
        if (target.scrollHeight > target.clientHeight) target.scrollBy(0, amount);
        else window.scrollBy(0, amount);
      }, amount) : async () => {
        await b.element.hover();
        await page.mouse.wheel(0, amount);
      };
    } else {
      const b = await this.binding(input, page);
      if (operation === "fill") {
        const text = required(input, "text");
        action = attachedMac ? () => b.element.evaluate((el, text) => {
          if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || el.disabled || el.readOnly || (el instanceof HTMLInputElement && el.type === 'password')) throw new Error('Unsupported DOM text field.');
          const prototype = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(el, text);
          el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
        }, text) : () => b.element.fill(text);
      } else if (operation === "upload") {
        if (
          !Array.isArray(input.paths) ||
          !input.paths.length ||
          input.paths.length > 20 ||
          input.paths.some((p) => typeof p !== "string")
        )
          throw new Error("Supply 1–20 file paths.");
        const paths = await Promise.all(
          input.paths.map(async (p) => {
            const path = await realpath(p);
            if (!(await stat(path)).isFile())
              throw new Error("Upload requires regular files.");
            return path;
          }),
        );
        action = () => b.element.setInputFiles(paths);
      } else if (operation === "select") {
        const value = required(input, "value");
        action = () => b.element.selectOption(value);
      } else if (operation === "drag") {
        const target = await this.binding(input, page, "targetRef");
        action = async () => {
          const a = await b.element.boundingBox(),
            z = await target.element.boundingBox();
          if (!a || !z) throw new Error("Drag endpoints are not visible.");
          await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
          await page.mouse.down();
          try {
            await page.mouse.move(z.x + z.width / 2, z.y + z.height / 2, {
              steps: 24,
            });
          } finally {
            await page.mouse.up();
          }
        };
      } else if (operation === "hover") action = () => b.element.hover();
      else if (["click", "doubleClick", "rightClick"].includes(operation))
        action = attachedMac ? () => b.element.evaluate(el => {
          if (!(el instanceof HTMLElement)) throw new Error('Unsupported DOM target.');
          el.click();
        }) : () => b.element.click({
            button: operation === "rightClick" ? "right" : "left",
            clickCount: operation === "doubleClick" ? 2 : 1,
            noWaitAfter: true,
          });
      else throw new Error("Unsupported browser action.");
    }
    const target = this.refs.get(String(input.ref));
    const bounds = target ? await target.element.boundingBox() : undefined;
    this.activity?.(
      operation,
      bounds
        ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
        : undefined,
    );
    // Consume before dispatch. A failed/aborted mutation is never replayed automatically.
    this.snapshotId = "";
    let wake!: () => void;
    const dialogEvent = new Promise<"dialog">((r) => {
      wake = () => r("dialog");
    });
    this.dialogWake = wake;
    const abort = () => {
      void this.close();
    };
    signal?.addEventListener("abort", abort, { once: true });
    const execution = Promise.resolve().then(() => {
      signal?.throwIfAborted();
      return action();
    });
    try {
      const outcome = await Promise.race([
        execution.then(() => "complete"),
        dialogEvent,
      ]);
      if (outcome === "dialog") {
        this.pending = execution;
        void execution.catch(() => {});
        return { status: "dialogPending", dialogs: this.dialogList() };
      }
      signal?.throwIfAborted();
      return {
        status: "dispatchedUnverified",
        inputRoute: attachedMac ? "dom-event-untrusted" : "browser-protocol",
        pageId: this.pageId(page),
        dialogs: this.dialogList(),
        downloads: this.downloadList(),
        next: "Observe the page to verify the result.",
      };
    } catch (error) {
      throw Object.assign(
        new Error(
          error instanceof Error ? error.message : "Browser action failed",
        ),
        { delivery: "unknown" },
      );
    } finally {
      this.dialogWake = undefined;
      signal?.removeEventListener("abort", abort);
    }
  }

  status() {
    return {
      title: this.title,
      dialogs: this.dialogList(),
      pageId: this.active ? this.pageId(this.active) : undefined,
    };
  }
  private async checkDisplayOwner() {
    if (process.platform === 'linux' && process.env.DISPLAY) {
      const { registryPath } = await import('../linux/display-registry.js');
      const { access } = await import('node:fs/promises');
      let broker = false;
      try { await access(registryPath(process.env.DISPLAY)); broker = true; } catch {}
      if (broker) throw Object.assign(new Error('This display has a shared controller. Use desktop-api input so browser and native actions share its lease.'), { code: 'LeaseConflict', delivery: 'notDispatched' });
    }
  }
  async humanInput(action: Record<string, unknown>) {
    await this.checkDisplayOwner();
    if (action.kind === "dialog") {
      const entry = this.dialogs.get(String(action.dialogId));
      if (!entry) throw new Error("Unknown dialog.");
      return this.call({
        operation: "dialog",
        pageId: this.pageId(entry.page),
        dialogId: action.dialogId,
        accept: action.accept,
        text: action.text,
      });
    }
    if (this.pending) throw new Error("Handle the pending dialog first.");
    let wake!: () => void;
    const dialogEvent = new Promise<"dialog">((resolve) => {
      wake = () => resolve("dialog");
    });
    this.dialogWake = wake;
    const execution = this.performHumanInput(action);
    try {
      const outcome = await Promise.race([execution, dialogEvent]);
      if (outcome === "dialog") {
        this.pending = execution;
        void execution.catch(() => {});
        return { status: "dialogPending", dialogs: this.dialogList() };
      }
      return outcome;
    } finally {
      this.dialogWake = undefined;
    }
  }
  private async performHumanInput(action: Record<string, unknown>) {
    const page = this.active;
    if (!page || page.isClosed()) throw new Error("No browser page.");
    this.invalidate();
    const x = action.x,
      y = action.y,
      size = page.viewportSize();
    const point = () => {
      if (
        typeof x !== "number" ||
        typeof y !== "number" ||
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        y < 0 ||
        !size ||
        x >= size.width ||
        y >= size.height
      )
        throw new Error("Pointer outside viewport.");
      return { x, y };
    };
    if (
      ["click", "rightClick", "doubleClick", "hover", "drag"].includes(
        String(action.kind),
      )
    ) {
      const p = point();
      if (action.kind === "hover") await page.mouse.move(p.x, p.y);
      else if (action.kind === "drag") {
        const tx = action.toX,
          ty = action.toY;
        if (
          typeof tx !== "number" ||
          typeof ty !== "number" ||
          !Number.isFinite(tx) ||
          !Number.isFinite(ty) ||
          tx < 0 ||
          ty < 0 ||
          tx >= size!.width ||
          ty >= size!.height
        )
          throw new Error("Drag outside viewport.");
        await page.mouse.move(p.x, p.y);
        await page.mouse.down();
        try {
          await page.mouse.move(tx, ty, { steps: 24 });
        } finally {
          await page.mouse.up();
        }
      } else
        await page.mouse.click(p.x, p.y, {
          button: action.kind === "rightClick" ? "right" : "left",
          clickCount: action.kind === "doubleClick" ? 2 : 1,
        });
    } else if (action.kind === "type") {
      const text = required(action, "text");
      await page.keyboard.insertText(text);
    } else if (action.kind === "key") {
      const key = required(action, "text");
      await page.keyboard.press(key === "Space" ? " " : key);
    } else if (action.kind === "scroll") {
      if (
        typeof action.amount !== "number" ||
        !Number.isFinite(action.amount) ||
        Math.abs(action.amount) > 30
      )
        throw new Error("Invalid scroll.");
      await page.mouse.wheel(0, action.amount * 80);
    } else throw new Error("Unsupported input");
    return { status: "dispatchedUnverified" };
  }
  async close() {
    this.invalidate();
    this.pending = undefined;
    if (!this.attached) for (const { dialog } of this.dialogs.values())
      void dialog.dismiss().catch(() => {});
    this.dialogs.clear();
    for (const remove of this.listeners.splice(0)) remove();
    if (this.pageListener) this.context?.off("page", this.pageListener);
    this.pageListener = undefined;
    if (this.attached) await this.attached.close(); // CDP disconnect preserves the external browser.
    else await this.context?.close();
    this.attached = undefined;
    this.context = undefined;
    this.pages.clear();
    this.frames.clear();
    this.downloads.clear();
    this.active = undefined;
    if (this.artifactDir) {
      await rm(this.artifactDir, { recursive: true, force: true });
      this.artifactDir = "";
    }
  }
}
