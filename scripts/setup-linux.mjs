import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
if (process.platform !== "linux") throw new Error("Linux required.");
// System packages are installed by the image owner; no implicit sudo or shell script downloads.
execFileSync("Xvfb", ["-help"], { stdio: "ignore" });
execFileSync(process.execPath, ["scripts/build-linux.mjs"], {
  stdio: "inherit",
});
const models=process.env.CU_NATIVE_DIR??".models";
await mkdir(models, { recursive: true });
const target = resolve(models,"ui-detector.onnx");
const expected =
  "199626646b896fc40be49f30185f8c03a7ad066c24cb9ab73c17d0c6f3521f2c";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (hash(await readFile(target).catch(() => Buffer.alloc(0))) !== expected) {
  const response = await fetch(
    "https://huggingface.co/onnx-community/OmniParser-icon_detect/resolve/c85c12777c40d51f22246579d37eef1126f3c311/onnx/model.onnx",
  );
  if (!response.ok)
    throw new Error("Model download failed: " + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== expected) throw new Error("Model checksum mismatch.");
  await writeFile(target + ".tmp", bytes);
  await rename(target + ".tmp", target);
}
console.log(
  "Linux driver and pinned YOLO model ready. Start: bun run desktop:linux -- <agent command>",
);
