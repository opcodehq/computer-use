import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Snapshot } from "../shared/contracts.js";
/** Serial private JSONL bridge. Only the parent driver may expose input. */
export class LinuxAccessibility {
  private child;
  private pending?: {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  };
  constructor(binary: string) {
    this.child = spawn(binary, [], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    this.child.stderr.resume();
    const fail = () => {
      this.pending?.reject(new Error("AT-SPI helper unavailable."));
      this.pending = undefined;
    };
    this.child.on("error", fail);
    this.child.on("exit", fail);
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      const pending = this.pending;
      this.pending = undefined;
      if (!pending) return;
      try {
        const value = JSON.parse(line);
        if (value.error) throw new Error(value.error);
        pending.resolve(value);
      } catch {
        pending.reject(new Error("AT-SPI operation failed."));
      }
    });
  }
  async call(method: string, args: Record<string, unknown> = {}): Promise<any> {
    if (this.pending) throw new Error("AT-SPI helper busy.");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise((resolve, reject) => {
        this.pending = { resolve, reject };
        timer = setTimeout(() => {
          this.pending = undefined;
          this.child.kill();
          reject(new Error("AT-SPI helper timed out."));
        }, 10000);
        this.child.stdin.write(
          JSON.stringify({ method, ...args }) + "\n",
          (error) => {
            if (error) {
              this.pending = undefined;
              reject(new Error("AT-SPI pipe closed."));
            }
          },
        );
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  snapshot(pid: number, title: string, windowId: number): Promise<Snapshot> {
    return this.call("snapshot", { pid, title, windowId });
  }
  close() {
    this.child.kill();
  }
}
