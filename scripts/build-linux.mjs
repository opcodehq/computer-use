import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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
  `#!/bin/sh\nexec ${quote(process.versions.bun ? process.execPath : process.env.CU_BUN_PATH ?? 'bun')} ${quote(existsSync(resolve("dist/linux-driver.mjs")) ? resolve("dist/linux-driver.mjs") : resolve("src/linux/driver.ts"))}\n`,
  { mode: 0o755 },
);

// Optional desktop semantics and local popup. Raw X11 remains installable without them.
for (const [source, binary, packages] of [
  ['accessibility.c', 'cu-atspi', ['atspi-2', 'json-glib-1.0']],
  ['preview.c', 'task-preview', ['gtk+-3.0', 'json-glib-1.0']],
]) {
  const flags = spawnSync('pkg-config', ['--cflags', '--libs', ...packages], { encoding: 'utf8' });
  if (flags.status !== 0) {
    if (process.argv.includes('--require-desktop-features')) throw new Error('Missing development packages: ' + packages.join(', '));
    console.warn('Optional ' + binary + ' not built: install development packages for ' + packages.join(', '));
    continue;
  }
  execFileSync('cc', ['-O2','-Wall', 'native/linux/' + source, ...flags.stdout.trim().split(/\s+/), '-o', resolve(output, binary)], { stdio: 'inherit' });
}
