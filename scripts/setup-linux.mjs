import { execFileSync } from "node:child_process";
if (process.platform !== "linux") throw new Error("Linux required.");
// System packages are installed by the image owner; no implicit sudo or shell script downloads.
execFileSync("Xvfb", ["-help"], { stdio: "ignore" });
execFileSync(process.execPath, ["scripts/build-linux.mjs"], {
  stdio: "inherit",
});
const { installModel } = await import('./setup-model.mjs');
await installModel(process.env.CU_NATIVE_DIR ?? '.models');
console.log('Linux driver and pinned YOLO model ready. Start: cu desktop -- <agent command>');
