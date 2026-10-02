import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
await mkdir("native/linux/build", { recursive: true });
execFileSync(
  "cc",
  [
    "-O2",
    "-Wall",
    "native/linux/x11.c",
    "-lX11",
    "-lXtst",
    "-o",
    "native/linux/build/cu-x11",
  ],
  { stdio: "inherit" },
);
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
await writeFile(
  "native/linux/build/desktop-driver",
  `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(resolve("src/linux/driver.ts"))}\n`,
  { mode: 0o755 },
);
