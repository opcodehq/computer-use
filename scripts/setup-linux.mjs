import { execFileSync } from "node:child_process";
if (process.platform !== "linux") throw new Error("Linux required.");
// System packages are installed by the image owner; no implicit sudo or shell script downloads.
// Attach-only hosts do not need Xvfb.
execFileSync(process.execPath, ["scripts/build-linux.mjs"], {
  stdio: "inherit",
});
if (process.argv.includes('--with-model')) {
 const { installModel } = await import('./setup-model.mjs');
 await installModel(process.env.CU_NATIVE_DIR ?? '.models');
}
console.log('Linux runtime ready. Raw desktop service needs no model. Use --with-model to install optional perception.');
