import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  open,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  Workflow,
  type WorkflowDriver,
  type Surface,
  type SurfaceNode,
  type Target,
  type Value,
  type Step,
  allSteps,
} from "./contracts.js";
import { Trace } from "./trace.js";

type RecordFile = {
  workflow: Workflow;
  revision: string;
  state: "draft" | "validated" | "retired";
  validations: {
    inputDigest: string;
    noMatch: boolean;
    httpMatched?: boolean;
  }[];
};
export type Receipt = {
  id: string;
  workflowId: string;
  revision: string;
  inputDigest: string;
  scopeKey: string;
  status: "running" | "passed" | "failed" | "checkpoint" | "uncertain";
  completed: number;
  dispatch: "not_sent" | "possible" | "verified";
  outputs: Record<string, string>;
  trace: Trace;
  reason?: string;
};
const canonical = (data: unknown): unknown =>
  Array.isArray(data)
    ? data.map(canonical)
    : data && typeof data === "object"
      ? Object.fromEntries(
          Object.entries(data)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : data;
const digest = (data: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(data)))
    .digest("hex");
export function select(surface: Surface, target: Target): SurfaceNode {
  const nodes = surface.nodes.filter(
    (n) =>
      (n as SurfaceNode & { visible?: boolean }).visible !== false &&
      (!target.role || n.role === target.role) &&
      (target.match === "contains"
        ? n.name.includes(target.name)
        : n.name === target.name),
  );
  if (nodes.length !== 1)
    throw new Error(
      nodes.length
        ? "Ambiguous workflow target."
        : "Workflow target not observed.",
    );
  return nodes[0]!;
}
function resolve(
  value: Value | undefined,
  input: Record<string, string>,
): string | undefined {
  if (value === undefined) return undefined;
  const part = (p: { literal: string } | { input: string }) => {
    if ("literal" in p) return p.literal;
    if (!Object.hasOwn(input, p.input))
      throw new Error("Value input missing: " + p.input);
    return input[p.input]!;
  };
  return "parts" in value ? value.parts.map(part).join("") : part(value);
}
function matches(
  surface: Surface,
  condition: {
    target: Target;
    value?: Value;
    absent: boolean;
    nonEmpty?: boolean;
  },
  input: Record<string, string>,
) {
  const nodes = surface.nodes.filter(
    (n) =>
      (n as SurfaceNode & { visible?: boolean }).visible !== false &&
      (!condition.target.role || n.role === condition.target.role) &&
      (condition.target.match === "contains"
        ? n.name.includes(condition.target.name)
        : n.name === condition.target.name),
  );
  if (condition.absent) return !surface.truncated && nodes.length === 0;
  const expected = resolve(condition.value, input);
  return (
    nodes.length === 1 &&
    (!condition.nonEmpty || nodes[0]!.value.trim().length > 0) &&
    (expected === undefined || nodes[0]!.value === expected)
  );
}
export class WorkflowStore {
  constructor(readonly directory: string) {}
  private path(id: string, revision: string) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(id) || !/^[a-f0-9]{64}$/.test(revision))
      throw new Error("Invalid workflow identity.");
    return join(this.directory, id + "-" + revision + ".json");
  }
  private async save(path: string, value: unknown, durable = false) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temp = path + "." + randomUUID();
    try {
      const file = await open(temp, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(value, null, 2));
        if (durable) await file.sync();
      } finally {
        await file.close();
      }
      await rename(temp, path);
      if (durable) {
        const directory = await open(this.directory, "r");
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }
    } catch (error) {
      await unlink(temp).catch(() => {});
      throw error;
    }
  }
  async register(value: unknown) {
    const workflow = Workflow.parse(value),
      revision = digest(workflow),
      path = this.path(workflow.id, revision);
    try {
      return await this.get(workflow.id, revision);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const record: RecordFile = {
      workflow,
      revision,
      state: "draft",
      validations: [],
    };
    await this.save(path, record);
    return record;
  }
  async get(id: string, revision: string): Promise<RecordFile> {
    const record = JSON.parse(
      await readFile(this.path(id, revision), "utf8"),
    ) as RecordFile;
    record.workflow = Workflow.parse(record.workflow);
    if (record.workflow.id !== id || digest(record.workflow) !== revision)
      throw new Error("Workflow revision digest mismatch.");
    return record;
  }
  async find() {
    const files = await readdir(this.directory).catch(
      (e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return [];
        throw e;
      },
    );
    const records = await Promise.all(
      files
        .filter((f) => /^[a-z][a-z0-9_-]*-[a-f0-9]{64}\.json$/.test(f))
        .map(async (f) => {
          const match = /^(.*)-([a-f0-9]{64})\.json$/.exec(f)!;
          return this.get(match[1]!, match[2]!);
        }),
    );
    return records
      .filter((r) => r.state === "validated")
      .map(({ workflow, revision }) => ({
        id: workflow.id,
        revision,
        description: workflow.description,
        scope: workflow.scope,
        effect: workflow.effect,
        inputs: workflow.inputs,
      }));
  }
  async retire(id: string, revision: string) {
    const record = await this.get(id, revision);
    record.state = "retired";
    await this.save(this.path(id, revision), record);
    return { state: record.state };
  }
  async receipt(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid run ID.");
    return JSON.parse(
      await readFile(join(this.directory, "run-" + id + ".json"), "utf8"),
    ) as Receipt;
  }
  async recover(id: string, revision: string) {
    const { workflow } = await this.get(id, revision),
      scopeKey = digest(workflow.scope),
      lock = join(this.directory, "scope-" + scopeKey + ".lock");
    const recovery = await open(lock + ".recovery", "wx", 0o600).catch(() => {
      throw new Error("Scope recovery already in progress.");
    });
    try {
      const owner = JSON.parse(await readFile(lock, "utf8")) as { pid: number };
      if (!Number.isInteger(owner.pid) || owner.pid <= 0)
        throw new Error("Malformed lock requires manual inspection.");
      try {
        process.kill(owner.pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        await unlink(lock);
        return {
          status: "recovered",
          next: "Inspect uncertain receipts and reconcile before another write.",
        };
      }
      throw new Error("Scope owner is still running. Do not steal its lock.");
    } finally {
      await recovery.close();
      await unlink(lock + ".recovery");
    }
  }
  async reconcile(
    runId: string,
    input: Record<string, string>,
    driver: WorkflowDriver,
    signal: AbortSignal,
  ) {
    const receipt = await this.receipt(runId);
    if (
      receipt.dispatch !== "possible" ||
      receipt.inputDigest !== digest(input)
    )
      throw new Error(
        "Reconciliation requires the original uncertain run inputs.",
      );
    const { workflow } = await this.get(receipt.workflowId, receipt.revision);
    const final = workflow.steps.at(-1);
    const surface = await driver.observe(signal);
    if (
      workflow.scope.route === "browser" &&
      (!surface.url ||
        new URL(surface.url).origin !== new URL(workflow.scope.origin).origin)
    )
      throw new Error("Reconciliation origin mismatch.");
    if (
      workflow.scope.account &&
      !matches(surface, workflow.scope.account, input)
    )
      throw new Error("Reconciliation account mismatch.");
    const confirmed =
      final?.kind === "assert" && matches(surface, final.condition, input);
    const notCommitted = Boolean(
      workflow.notCommitted && matches(surface, workflow.notCommitted, input),
    );
    if (confirmed === notCommitted)
      throw new Error(
        "Original write outcome is still unconfirmed or conflicting.",
      );
    receipt.dispatch = confirmed ? "verified" : "not_sent";
    receipt.status = "failed";
    receipt.reason = confirmed
      ? "Original write confirmed by fresh read-back. Outputs may be incomplete; no action was repeated."
      : "Declared no-commit evidence verified. No action was repeated.";
    await this.save(join(this.directory, "run-" + runId + ".json"), receipt);
    return receipt;
  }
  async run(
    id: string,
    revision: string,
    input: Record<string, string>,
    driver: WorkflowDriver,
    options: {
      signal: AbortSignal;
      validate?: boolean;
      noMatch?: boolean;
      effect: "read" | "write";
      execution?: "ui" | "best";
      event?: (receipt: Receipt) => void;
    },
  ) {
    const record = await this.get(id, revision),
      workflow = record.workflow;
    if (
      record.state === "retired" ||
      (!options.validate && record.state !== "validated")
    )
      throw new Error("Workflow is not validated for reuse.");
    if (workflow.effect !== options.effect)
      throw new Error("Invocation effect does not match reviewed workflow.");
    if (
      !input ||
      Object.keys(input).some((k) => !Object.hasOwn(workflow.inputs, k))
    )
      throw new Error("Unknown workflow input.");
    for (const [key, field] of Object.entries(workflow.inputs))
      if (
        (field.required && input[key] === undefined) ||
        (input[key] !== undefined &&
          (typeof input[key] !== "string" ||
            input[key]!.length > field.maxLength))
      )
        throw new Error("Invalid workflow input: " + key);
    if (
      options.noMatch &&
      !allSteps(workflow.steps).some(
        (s) => s.kind === "assert" && s.condition.absent,
      )
    )
      throw new Error("No-match validation requires an asserted absence.");
    const signal = AbortSignal.any([
      options.signal,
      AbortSignal.timeout(300000),
    ]);
    const scopeKey = digest(workflow.scope);
    const receipt: Receipt = {
      scopeKey,
      inputDigest: digest(input),
      id: randomUUID(),
      workflowId: id,
      revision,
      status: "running",
      completed: 0,
      dispatch: "not_sent",
      outputs: {},
      trace: new Trace(),
    };
    const persist = async () => {
      await this.save(
        join(this.directory, "run-" + receipt.id + ".json"),
        receipt,
        workflow.effect === "write" && receipt.dispatch === "possible",
      );
      try {
        options.event?.(receipt);
      } catch {
        /* Display-only consumers cannot change execution outcomes. */
      }
    };
    const observe = () =>
      receipt.trace.measure("observation", async () => {
        signal.throwIfAborted();
        const surface = await driver.observe(signal);
        if (
          workflow.scope.route === "browser" &&
          (!surface.url ||
            new URL(surface.url).origin !==
              new URL(workflow.scope.origin).origin)
        )
          throw new Error("Workflow left its reviewed origin.");
        if (
          workflow.scope.account &&
          !matches(surface, workflow.scope.account, input)
        )
          throw new Error("Workflow account evidence does not match.");
        return surface;
      });
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lock = join(this.directory, "scope-" + scopeKey + ".lock");
    const owner = await open(lock, "wx", 0o600).catch(() => {
      throw new Error("Workflow scope is busy or needs crash recovery.");
    });
    await owner.writeFile(JSON.stringify({ pid: process.pid }));
    try {
      if (workflow.effect === "write") {
        for (const file of (await readdir(this.directory)).filter((f) =>
          /^run-[a-f0-9-]{36}\.json$/.test(f),
        )) {
          const previous = JSON.parse(
            await readFile(join(this.directory, file), "utf8"),
          ) as Receipt;
          if (
            previous.scopeKey === scopeKey &&
            previous.dispatch === "possible"
          )
            throw new Error(
              "Uncertain write in this scope requires reconciliation before another write.",
            );
        }
      }
      await persist();
      const httpRead = async () => {
        if (
          !workflow.http ||
          !driver.http ||
          workflow.scope.route !== "browser"
        )
          throw new Error("HTTP adapter unavailable.");
        await observe();
        const url = new URL(
          workflow.http.path,
          new URL(workflow.scope.origin).origin,
        );
        for (const [key, value] of Object.entries(workflow.http.query)) {
          const text = resolve(value, input);
          if (text !== undefined) url.searchParams.set(key, text);
        }
        const result = await receipt.trace.measure("http", () =>
          driver.http!(url.href, signal),
        );
        const outputs: Record<string, string> = {};
        for (const [key, path] of Object.entries(workflow.http.fields)) {
          let value: any = result;
          for (const part of path) {
            if (!value || !Object.hasOwn(Object(value), part))
              throw new Error("HTTP output field missing.");
            value = value[part];
          }
          if (typeof value !== "string")
            throw new Error("HTTP output must match declared string outputs.");
          outputs[key] = value;
        }
        if (workflow.outputs.some((key) => !Object.hasOwn(outputs, key)))
          throw new Error("HTTP output incomplete.");
        return outputs;
      };
      try {
        if (
          !options.validate &&
          options.execution === "best" &&
          record.validations.length &&
          record.validations.every((v) => v.httpMatched)
        ) {
          try {
            receipt.outputs = await httpRead();
            receipt.status = "passed";
            receipt.dispatch = "verified";
            await persist();
            return receipt;
          } catch {
            signal.throwIfAborted(); /* UI fallback is safe only for a reviewed read. */
          }
        }
        let executed = 0;
        const execute = async (steps: Step[]): Promise<void> => {
          for (const step of steps) {
            signal.throwIfAborted();
            if (++executed > 1000)
              throw new Error("Workflow execution budget exceeded.");
            if (receipt.status !== "running") return;
            if (step.kind === "checkpoint") {
              receipt.status = "checkpoint";
              receipt.reason = step.reason;
              break;
            }
            let surface = await observe();
            if (step.kind === "branch") {
              await execute(
                matches(surface, step.condition, input)
                  ? step.then
                  : step.otherwise,
              );
              continue;
            }
            if (step.kind === "repeat") {
              let iteration = 0;
              while (matches(surface, step.condition, input)) {
                if (iteration++ >= step.maxIterations)
                  throw new Error("Workflow iteration budget exceeded.");
                await execute(step.steps);
                if (receipt.status !== "running") return;
                surface = await observe();
              }
              continue;
            }
            if (step.kind === "navigate") {
              const url = new URL(resolve(step.url, input)!);
              if (
                workflow.scope.route !== "browser" ||
                url.origin !== new URL(workflow.scope.origin).origin ||
                url.username ||
                url.password ||
                !driver.navigate
              )
                throw new Error("Navigation outside reviewed browser scope.");
              await driver.navigate(url.href, signal);
              receipt.completed++;
              await persist();
              continue;
            }
            if (step.kind === "download") {
              if (!driver.download) throw new Error("Download unavailable.");
              await driver.download(resolve(step.outputPath, input)!, signal);
              receipt.completed++;
              await persist();
              continue;
            }
            if (step.kind === "upload") {
              if (!driver.upload) throw new Error("Upload unavailable.");
              if (workflow.effect === "write") {
                receipt.dispatch = "possible";
                await persist();
              }
              await driver.upload(
                surface,
                select(surface, step.target),
                step.paths.map((p) => resolve(p, input)!),
                signal,
              );
              receipt.completed++;
              await persist();
              continue;
            }
            if (step.kind === "action") {
              const node = select(surface, step.target);
              if (!node.enabled)
                throw new Error("Workflow target is disabled.");
              if (workflow.effect === "write") {
                receipt.dispatch = "possible";
                await persist();
              }
              await receipt.trace.measure("dispatch", () =>
                driver.action(
                  surface,
                  node,
                  step,
                  resolve(step.value, input),
                  signal,
                ),
              );
            } else if (step.kind === "extract") {
              receipt.outputs[step.output] = select(surface, step.target)[
                step.field
              ];
            } else {
              const until =
                performance.now() + (step.kind === "wait" ? step.timeoutMs : 0);
              while (!matches(surface, step.condition, input)) {
                if (performance.now() >= until)
                  throw new Error("Workflow outcome not observed.");
                await delay(
                  Math.min(100, Math.max(0, until - performance.now())),
                  undefined,
                  { signal },
                );
                surface = await observe();
              }
            }
            receipt.completed++;
            await persist();
          }
        };
        await execute(workflow.steps);
        if (receipt.status === "running") {
          if (workflow.steps.at(-1)?.kind !== "assert")
            throw new Error("The final step must verify the outcome.");
          if (workflow.outputs.some((k) => !(k in receipt.outputs)))
            throw new Error("Declared output missing.");
          receipt.status = "passed";
          receipt.dispatch = "verified";
        }
        if (options.validate && receipt.status === "passed") {
          let httpMatched = false;
          if (workflow.http) {
            try {
              httpMatched =
                digest(await httpRead()) === digest(receipt.outputs);
            } catch {
              signal.throwIfAborted();
            }
          }
          const inputDigest = digest(input);
          if (!record.validations.some((v) => v.inputDigest === inputDigest))
            record.validations.push({
              inputDigest,
              noMatch: Boolean(options.noMatch),
              httpMatched,
            });
          if (
            workflow.effect === "write" ||
            Object.keys(workflow.inputs).length === 0 ||
            (record.validations.length >= 3 &&
              record.validations.some((v) => v.noMatch))
          )
            record.state = "validated";
          await this.save(this.path(id, revision), record);
        }
      } catch {
        receipt.status =
          receipt.dispatch === "possible" ? "uncertain" : "failed";
        receipt.reason = signal.aborted
          ? "Execution cancelled or timed out; inspect dispatch before retry."
          : "Execution failed; inspect current state before repair. No automatic replay.";
      }
      await persist();
      return receipt;
    } finally {
      await owner.close();
      await unlink(lock);
    }
  }
}
