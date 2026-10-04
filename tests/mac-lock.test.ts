import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { MacDriver } from "../src/desktop/mac-backend.js";
import { connectMacDriver } from "../src/desktop/mac-driver.js";

// This starts our native helper only on disposable Mac CI; no screen/input
// permissions are needed. Normal developer test runs never touch their helper.
const native = process.env.CU_NATIVE_DIR;
const enabled =
  process.platform === "darwin" &&
  process.env.CI === "true" &&
  process.env.GITHUB_ACTIONS === "true" &&
  Boolean(native);
(enabled ? test : test.skip)(
  "native broker flock excludes concurrent connections and recovers from disconnect/crash on a stable inode",
  {
    timeout: 30000,
  },
  async () => {
    let helper: ReturnType<typeof spawn> | undefined;
    const connections: MacDriver[] = [];
    const start = async () => {
      helper = spawn(join(native!, "cu-helper"), [], { stdio: "ignore" });
      helper.on("error", () => {});
      for (let i = 0; i < 100; i++) {
        if (helper.exitCode !== null || helper.signalCode !== null)
          throw Error("Temporary native helper exited before startup.");
        try {
          const driver = await connectMacDriver();
          connections.push(driver);
          return driver;
        } catch {
          await delay(50);
        }
      }
      throw Error("Temporary native helper failed to start.");
    };
    const acquire = async (driver: MacDriver) => {
      for (let i = 0; i < 30; i++) {
        try {
          return await driver.request("desktopLock");
        } catch (error) {
          if ((error as { code?: string }).code !== "DriverBusy") throw error;
          await delay(10);
        }
      }
      throw Error("Native lock remained busy.");
    };
    try {
      const first = await start();
      for (let i = 0; i < 7; i++) connections.push(await connectMacDriver());
      const results = await Promise.allSettled(connections.map(acquire));
      const winners = results.flatMap((result, index) =>
        result.status === "fulfilled" ? [index] : [],
      );
      assert.equal(winners.length, 1);
      for (const result of results)
        if (result.status === "rejected")
          assert.equal(result.reason.code, "lease_conflict");
      const winner = connections[winners[0]!]!;
      assert.deepEqual(await acquire(winner), { locked: true });
      const path = `/tmp/opcode-cu-${process.getuid!()}/desktop-broker.lock`;
      const original = await stat(path);
      assert.equal(original.mode & 0o077, 0);
      assert.equal(original.uid, process.getuid!());
      winner.close?.();
      const successor = connections.find((driver) => driver !== winner)!;
      let recovered = false;
      for (let i = 0; i < 100; i++) {
        try {
          assert.deepEqual(await acquire(successor), { locked: true });
          recovered = true;
          break;
        } catch (error) {
          if ((error as { code?: string }).code !== "lease_conflict")
            throw error;
          await delay(20);
        }
      }
      assert.equal(
        recovered,
        true,
        "Disconnect must dispose the Driver's lock descriptor.",
      );
      assert.equal((await stat(path)).ino, original.ino);
      const exited = once(helper!, "exit");
      helper!.kill("SIGKILL");
      await exited;
      for (const driver of connections) driver.close?.();
      connections.length = 0;
      const restarted = await start();
      assert.deepEqual(await acquire(restarted), { locked: true });
      assert.equal(
        (await stat(path)).ino,
        original.ino,
        "Crash recovery must reuse the stable lock file, never unlink it.",
      );
      assert.ok(first);
    } finally {
      for (const driver of connections) driver.close?.();
      if (helper && helper.exitCode === null && helper.signalCode === null) {
        const exited = once(helper, "exit");
        helper.kill("SIGTERM");
        await exited;
      }
    }
  },
);
