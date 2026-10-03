import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import {
  mkdir,
  writeFile,
  rename,
  readdir,
  readFile,
  stat,
  unlink,
  lstat,
  open,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { failure, type Target } from "./protocol.js";
export type Recording = {
  id: string;
  generation: string;
  target: Target;
  state: "recording" | "paused" | "completed" | "failed" | "interrupted";
  createdAt: string;
  fps: number;
  frames: number;
  dropped: number;
  maxBytes: number;
  maxSeconds: number;
  bytes: number;
  error?: string;
  durationSeconds: number;
};
type Frame = { png: Buffer; geometry: { width: number; height: number } };
export class Recorder {
  private active?: {
    info: Recording;
    process: ChildProcessWithoutNullStreams;
    timer?: ReturnType<typeof setTimeout>;
    started: number;
    busy: boolean;
    exit: Promise<void>;
    stopping: boolean;
  };
  private saving: Promise<void> = Promise.resolve();
  private starting = false;
  private startingTask?: Promise<Recording>;
  private encoderCheck?: Promise<boolean>;
  available() {
    return (this.encoderCheck ??= new Promise<boolean>((resolve) =>
      execFile(
        this.encoder,
        ["-encoders"],
        { timeout: 3000 },
        (error, stdout) => resolve(!error && stdout.includes("libx264")),
      ),
    ));
  }
  private items = new Map<string, Recording>();
  constructor(
    readonly directory: string,
    private capture: (target: Target) => Promise<Frame>,
    private encoder = process.env.CU_FFMPEG ?? "ffmpeg",
  ) {}
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const dir = await lstat(this.directory);
    if (
      !dir.isDirectory() ||
      dir.isSymbolicLink() ||
      dir.uid !== process.getuid?.() ||
      dir.mode & 0o077
    )
      throw failure(
        "permission_denied",
        "Recording directory must be private and owned by this user.",
      );
    for (const name of await readdir(this.directory)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      try {
        const file = join(this.directory, name);
        if ((await stat(file)).size > 64000) continue;
        const r: Recording = JSON.parse(await readFile(file, "utf8"));
        if (r.id + ".json" !== name) continue;
        if (!["completed", "failed", "interrupted"].includes(r.state)) {
          r.state = "interrupted";
          r.error = "Daemon stopped before finalization.";
          await this.save(r);
        }
        this.items.set(r.id, r);
      } catch {}
    }
  }
  private save(r: Recording) {
    const path = join(this.directory, r.id + ".json"),
      data = JSON.stringify(r);
    const task = this.saving
      .catch(() => {})
      .then(async () => {
        await writeFile(path + ".tmp", data, { mode: 0o600 });
        await rename(path + ".tmp", path);
      });
    this.saving = task;
    return task;
  }
  list() {
    return [...this.items.values()].map((r) => ({ ...r }));
  }
  get(id: string) {
    const r = this.items.get(id);
    if (!r) throw failure("not_found", "Recording not found.");
    return r;
  }
  path(id: string) {
    this.get(id);
    return join(this.directory, id + ".mp4");
  }
  async start(
    generation: string,
    target: Target,
    opts: { fps: number; maxBytes: number; maxSeconds: number },
  ) {
    if (this.active || this.starting)
      throw failure("lease_conflict", "A recorder is already active.");
    this.starting = true;
    try {
      this.startingTask = this.begin(generation, target, opts);
      return await this.startingTask;
    } finally {
      this.starting = false;
      this.startingTask = undefined;
    }
  }
  private async begin(
    generation: string,
    target: Target,
    opts: { fps: number; maxBytes: number; maxSeconds: number },
  ) {
    if (!(await this.available()))
      throw failure(
        "encoder_unavailable",
        "Install ffmpeg with libx264 or set CU_FFMPEG.",
      );
    const first = await this.capture(target);
    const width = Math.ceil(first.geometry.width / 2) * 2,
      height = Math.ceil(first.geometry.height / 2) * 2;
    const info: Recording = {
      id: randomUUID(),
      generation,
      target,
      state: "recording",
      createdAt: new Date().toISOString(),
      fps: opts.fps,
      maxBytes: opts.maxBytes,
      maxSeconds: opts.maxSeconds,
      frames: 0,
      dropped: 0,
      bytes: 0,
      durationSeconds: 0,
    };
    const output = await open(
      join(this.directory, info.id + ".mp4"),
      "wx",
      0o600,
    );
    const process = spawn(
      this.encoder,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "image2pipe",
        "-framerate",
        String(info.fps),
        "-vcodec",
        "png",
        "-i",
        "pipe:0",
        "-an",
        "-vf",
        `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-tune",
        "zerolatency",
        "-g",
        String(info.fps),
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "frag_keyframe+empty_moov+default_base_moof",
        "-f",
        "mp4",
        "pipe:1",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    await new Promise<void>((resolve, reject) => {
      process.once("spawn", resolve);
      process.once("error", () =>
        reject(
          failure("encoder_unavailable", "Install ffmpeg or set CU_FFMPEG."),
        ),
      );
    }).catch(async (error) => {
      await output.close();
      throw error;
    });
    const writing = (async () => {
      let bytes = 0;
      try {
        for await (const chunk of process.stdout) {
          const remaining = info.maxBytes - bytes;
          const data = chunk.subarray(0, Math.max(0, remaining));
          let offset = 0;
          while (offset < data.length) {
            const written = await output.write(
              data,
              offset,
              data.length - offset,
            );
            if (!written.bytesWritten) throw new Error("Output write stalled");
            offset += written.bytesWritten;
          }
          bytes += data.length;
          info.bytes = bytes;
          if (chunk.length > remaining) {
            info.state = "failed";
            info.error =
              "Recording size limit reached; final fragment may be incomplete.";
            process.kill("SIGTERM");
            break;
          }
        }
      } catch {
        info.state = "failed";
        info.error ??= "Recording output failed.";
        process.kill("SIGTERM");
      } finally {
        await output.close();
      }
    })();
    process.stderr.resume();
    process.stdin.on("error", () => {});
    let exited!: () => void;
    const exit = new Promise<void>((resolve) => (exited = resolve));
    const active = {
      info,
      process,
      started: Date.now(),
      busy: false,
      exit,
      stopping: false,
      timer: undefined as ReturnType<typeof setTimeout> | undefined,
    };
    this.active = active;
    this.items.set(info.id, info);
    process.once("exit", (code) => {
      clearTimeout(active.timer);
      if (info.state !== "failed")
        info.state = active.stopping && code === 0 ? "completed" : "failed";
      if (info.state === "failed")
        info.error ??=
          "Encoder exited or output limit reached. Partial fragmented MP4 may be recoverable.";
      if (this.active === active) this.active = undefined;
      void writing
        .then(() => this.finishMetadata(info))
        .catch(() => {
          info.state = "failed";
          info.error = "Cannot persist recording metadata.";
        })
        .finally(exited);
    });
    try {
      await this.save(info);
    } catch {
      info.state = "failed";
      info.error = "Cannot create recording metadata.";
      process.kill("SIGTERM");
      await exit;
      throw failure("quota_exceeded", "Cannot create recording metadata.");
    }
    let nextTick = performance.now();
    const tick = async (initial?: Frame) => {
      if (this.active !== active || active.stopping) return;
      if (Date.now() - active.started >= info.maxSeconds * 1000) {
        void this.stop(info.id);
        return;
      }
      try {
        if (info.state === "recording") {
          active.busy = true;
          const frame = initial ?? (await this.capture(target));
          if (
            this.active === active &&
            !active.stopping &&
            info.state === "recording"
          ) {
            if (process.stdin.writableLength > frame.png.length * 2)
              info.dropped++;
            else {
              process.stdin.write(frame.png);
              info.frames++;
              info.durationSeconds = info.frames / info.fps;
            }
          }
        }
        const file = await stat(this.path(info.id)).catch(() => undefined);
        info.bytes = file?.size ?? 0;
        if (info.bytes >= info.maxBytes) {
          info.error = "Recording size limit reached.";
          void this.stop(info.id);
          return;
        }
      } catch {
        info.state = "failed";
        info.error = "Capture or storage failed.";
        void this.stop(info.id);
        return;
      } finally {
        active.busy = false;
      }
      nextTick += 1000 / info.fps;
      if (nextTick < performance.now() - 1000 / info.fps) {
        info.dropped++;
        nextTick = performance.now();
      }
      if (!active.stopping)
        active.timer = setTimeout(
          () => void tick(),
          Math.max(0, nextTick - performance.now()),
        );
    };
    void tick(first);
    return { ...info };
  }
  private async finishMetadata(info: Recording) {
    info.bytes =
      (await stat(this.path(info.id)).catch(() => undefined))?.size ?? 0;
    await this.save(info);
  }
  async pause(id: string) {
    const r = this.get(id);
    if (r.state === "recording") r.state = "paused";
    await this.save(r);
    return { ...r };
  }
  async resume(id: string) {
    const r = this.get(id);
    if (r.state === "paused") r.state = "recording";
    await this.save(r);
    return { ...r };
  }
  async stop(id: string) {
    const r = this.get(id),
      active = this.active;
    if (!active || active.info.id !== id) return { ...r };
    if (!active.stopping) {
      active.stopping = true;
      clearTimeout(active.timer);
      active.process.stdin.end();
      const timer = setTimeout(() => active.process.kill("SIGKILL"), 5000);
      active.exit.finally(() => clearTimeout(timer));
    }
    await active.exit;
    return { ...r };
  }
  async fence() {
    await this.startingTask?.catch(() => {});
    if (this.active) await this.stop(this.active.info.id);
  }
  async delete(id: string) {
    const r = this.get(id);
    if (this.active?.info.id === id)
      throw failure("lease_conflict", "Stop the recording before deleting it.");
    await unlink(this.path(id)).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
    await unlink(join(this.directory, id + ".json"));
    this.items.delete(id);
    return { deleted: true };
  }
}
