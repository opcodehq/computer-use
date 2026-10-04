import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

if (process.platform !== "darwin")
  throw new Error("This native smoke test requires macOS.");
if (!process.env.CU_NATIVE_DIR)
  throw new Error(
    "Set CU_NATIVE_DIR to the temporary compiled native output directory.",
  );
const binary = join(resolve(process.env.CU_NATIVE_DIR), "desktop-driver");

// Run only the temporary standalone binary. Never install, launch, stop, or
// reconnect the user's installed permission-owning helper.
function run(requests) {
  const child = spawnSync(binary, [], {
    input: requests.map((request) => JSON.stringify(request)).join("\n") + "\n",
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 1_000_000,
    env: { ...process.env, JEV_INTERACTION_MODE: "background" },
  });
  if (child.error) throw child.error;
  assert.equal(
    child.signal,
    null,
    "Native driver unexpectedly terminated by a signal.",
  );
  assert.equal(
    child.status,
    0,
    `Native driver exited unsuccessfully: ${child.stderr}`,
  );
  const replies = child.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(
    replies.length,
    requests.length,
    "Expected exactly one JSONL response per request.",
  );
  for (let index = 0; index < replies.length; index++) {
    assert.equal(
      replies[index].id,
      requests[index].id,
      "Native response ID mismatch.",
    );
    assert.equal(typeof replies[index].ok, "boolean");
  }
  return replies;
}
function denied(reply, codes) {
  assert.equal(reply.ok, false, `${reply.id} must fail closed.`);
  assert.ok(
    codes.includes(reply.error?.code),
    `${reply.id}: unexpected error code ${reply.error?.code}`,
  );
  assert.equal(typeof reply.error.message, "string");
  assert.equal(reply.error.delivery, "notDispatched");
  assert.equal(reply.data, undefined);
}
const [statusReply, geometryReply, stateReply, keysReply] = run([
  { id: "status", method: "status" },
  { id: "geometry", method: "desktopGeometry", target: { kind: "display" } },
  { id: "state", method: "desktopState" },
  { id: "keys", method: "desktopKeys" },
]);
assert.equal(statusReply.ok, true);
const status = statusReply.data;
assert.equal(status.platform, "macOS");
assert.equal(typeof status.accessibility, "boolean");
assert.equal(typeof status.screenRecording, "boolean");
assert.equal(geometryReply.ok, true);
const geometry = geometryReply.data;
for (const key of ["id", "width", "height"]) {
  assert.ok(
    Number.isInteger(geometry[key]) && geometry[key] > 0,
    `Invalid desktop geometry ${key}.`,
  );
}
for (const key of ["x", "y"])
  assert.ok(Number.isFinite(geometry[key]), `Invalid desktop geometry ${key}.`);
assert.equal(stateReply.ok, true);
assert.ok(
  Number.isInteger(stateReply.data.focus) && stateReply.data.focus >= 0,
);
for (const key of ["x", "y"]) assert.ok(Number.isFinite(stateReply.data[key]));

assert.equal(keysReply.ok, true);
assert.ok(Array.isArray(keysReply.data));
assert.ok(
  keysReply.data.every((key) => typeof key === "string" && key.length > 0),
);
assert.equal(new Set(keysReply.data).size, keysReply.data.length);
for (const key of ["a", "Enter", "Meta", "Control", "Shift", "Alt"])
  assert.ok(keysReply.data.includes(key));

const requests = [
  { id: "missing-target", method: "desktopGeometry" },
  {
    id: "unknown-target",
    method: "desktopGeometry",
    target: { kind: "not-a-desktop" },
  },
  { id: "malformed-target", method: "desktopGeometry", target: "display" },
  {
    id: "malformed-window",
    method: "desktopGeometry",
    target: { kind: "window", id: "not-an-id" },
  },
  {
    id: "unknown-selector",
    method: "desktopDoesNotExist",
    target: { kind: "display" },
  },
  // With AX granted, explicit foreground approval still has to be present.
  // This request can never produce valid input, even if permissions change.
  {
    id: "unapproved-input",
    method: "desktopInput",
    foregroundApproved: false,
    target: { kind: "not-a-desktop" },
    action: { kind: "not-an-action" },
  },
];
// Capture with an invalid target cannot read private pixels even if permission
// becomes granted between status and this request. Never request valid capture.
if (!status.screenRecording)
  requests.push({
    id: "capture-without-permission",
    method: "desktopCapture",
    target: { kind: "not-a-desktop" },
  });
if (!status.accessibility)
  requests.push({
    id: "input-without-permission",
    method: "desktopInput",
    foregroundApproved: false,
    target: { kind: "not-a-desktop" },
    action: { kind: "not-an-action" },
  });
const replies = run(requests);
for (const reply of replies) {
  if (reply.id === "capture-without-permission")
    denied(reply, ["permission_denied"]);
  else if (reply.id === "input-without-permission")
    denied(reply, ["AccessibilityDenied"]);
  else if (reply.id === "unapproved-input")
    denied(reply, ["AccessibilityDenied", "permission_denied"]);
  else if (reply.id === "unknown-target" || reply.id === "malformed-window")
    denied(reply, ["stale_observation"]);
  else denied(reply, ["InvalidRequest"]);
}
console.log(
  `PASS native Mac desktop selectors, geometry/state shapes, malformed targets, and permission/input approval gates (${4 + requests.length} requests; no screenshots or input dispatched).`,
);
console.log(
  `Permission-dependent denial checks: Screen Recording ${status.screenRecording ? "skipped (already granted)" : "verified"}, Accessibility ${status.accessibility ? "skipped (already granted)" : "verified"}.`,
);
