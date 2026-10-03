import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const output=process.env.CU_NATIVE_DIR??resolve("native/linux/build");
await mkdir(output, { recursive: true });
execFileSync(
  "cc",
  [
    "-O2",
    "-Wall",
    "native/linux/x11.c",
    "-lX11",
    "-lXtst",
    "-o",
    resolve(output,"cu-x11"),
  ],
  { stdio: "inherit" },
);
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
await writeFile(
  resolve(output,"desktop-driver"),
  `#!/bin/sh\nexec ${quote(process.versions.bun ? process.execPath : process.env.CU_BUN_PATH ?? 'bun')} ${quote(resolve("src/linux/driver.ts"))}\n`,
  { mode: 0o755 },
);
