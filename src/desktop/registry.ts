import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  canonical as canonicalX11,
  displayKey as x11Key,
  registryPath as x11Path,
} from "../linux/display-registry.js";
export const canonical = (display: string) =>
  display === "macos" ? display : canonicalX11(display);
export const displayKey = (display: string) =>
  display === "macos"
    ? createHash("sha256")
        .update(`${process.getuid?.()}:macos`)
        .digest("hex")
        .slice(0, 24)
    : x11Key(display);
export const registryPath = (display: string) =>
  display === "macos"
    ? join(
        homedir(),
        ".local/state/opcode/displays",
        displayKey(display) + ".json",
      )
    : x11Path(display);
