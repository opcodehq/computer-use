import { createHash } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";
export function canonical(display: string) {
  const m = /^(?:unix)?:(\d+)(?:\.(\d+))?$/.exec(display);
  if (!m)
    throw Object.assign(
      new Error("Only local X11 display addresses are supported."),
      { code: "unsupported", delivery: "notDispatched" },
    );
  return ":" + Number(m[1]) + "." + Number(m[2] ?? 0);
}
export function displayKey(display: string) {
  return createHash("sha256")
    .update(`${process.getuid?.()}:${canonical(display)}`)
    .digest("hex")
    .slice(0, 24);
}
export function registryPath(display: string) {
  return join(
    homedir(),
    ".local/state/opcode/displays",
    displayKey(display) + ".json",
  );
}
