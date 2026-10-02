import { spawn } from "node:child_process";
import { once } from "node:events";
if (process.platform !== "linux")
  throw new Error("This command requires Linux.");
const args = process.argv
  .slice(2)
  .filter((arg, i) => !(i === 0 && arg === "--"));
if (!args.length)
  throw new Error(
    "Usage: bun run desktop:linux -- <agent or shell command> [args]",
  );
const display = spawn(
  "Xvfb",
  ["-displayfd", "3", "-screen", "0", "1280x900x24", "-nolisten", "tcp", "-ac"],
  { stdio: ["ignore", "ignore", "inherit", "pipe"] },
);
let child;
const cleanup = () => {
  child?.kill("SIGTERM");
  display.kill("SIGTERM");
};
process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);
try {
  const number = await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(
      () => reject(new Error("Xvfb startup timed out")),
      10000,
    );
    display.once("error", reject);
    display.once("exit", () =>
      reject(new Error("Xvfb exited before becoming ready")),
    );
    display.stdio[3].on("data", (chunk) => {
      output += chunk;
      if (/^\d+\n/.test(output)) {
        clearTimeout(timeout);
        resolve(output.trim());
      }
    });
  });
  // The display is dedicated to this child and descendants. Do not expose X11 over TCP.
  child = spawn(args[0], args.slice(1), {
    stdio: "inherit",
    env: { ...process.env, DISPLAY: ":" + number, CU_LINUX_DESKTOP: "1" },
  });
  child.once("error", (error) => {
    console.error(error.message);
    cleanup();
  });
  const [code] = await once(child, "exit");
  process.exitCode = code ?? 1;
} finally {
  cleanup();
}
