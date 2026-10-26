#!/usr/bin/env node
// Prepare the exact frozen browser baseline without changing the active checkout.
import { execFileSync } from "node:child_process";
import { mkdir, symlink, access, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
const revision = "d6e271bfbf4a1899b809c27c5530896ef1296aa7";
const directory = resolve(process.argv[2] ?? ".context/cu-baseline");
try {
  await access(directory);
  throw Error(
    "Baseline directory already exists; choose a new directory to avoid mixed sources.",
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await mkdir(directory, { recursive: true });
const archive = execFileSync("git", ["archive", revision], {
  maxBuffer: 64 * 1024 * 1024,
});
execFileSync("tar", ["-x", "-C", directory], { input: archive });
await symlink(resolve("node_modules"), join(directory, "node_modules"), "dir");
execFileSync(process.execPath, [join(directory, "scripts/build.mjs")], {
  cwd: directory,
  stdio: "inherit",
});
await writeFile(
  join(directory, "baseline-manifest.json"),
  JSON.stringify(
    {
      revision,
      dependencies:
        "Shared locked install; CU changes add no runtime dependencies.",
      purpose:
        "Frozen browser CLI baseline; native baseline needs its own original native build.",
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ revision, cli: join(directory, "dist/cli.mjs") }));
