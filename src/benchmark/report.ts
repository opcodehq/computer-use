export type Sample = {
  task: string;
  competitor: string;
  platform: string;
  route: string;
  mode: string;
  seed: number;
  sample: number;
  status: "passed" | "failed" | "not_run" | "unsupported" | "infrastructure";
  elapsedMs: number;
  deadlineMs: number;
  reason?: string;
};
export function summarize(samples: Sample[]) {
  const groups = new Map<string, Sample[]>();
  for (const s of samples) {
    const key = [s.platform, s.route, s.mode, s.competitor, s.task].join("/");
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups].map(([key, all]) => {
    const runs = all.filter(
        (s) => s.status === "passed" || s.status === "failed",
      ),
      times = runs.map((s) => s.elapsedMs).sort((a, b) => a - b);
    return {
      key,
      attempts: runs.length,
      passed: runs.filter((s) => s.status === "passed").length,
      notRun: all.length - runs.length,
      meanPenalizedMs: runs.length
        ? runs.reduce(
            (n, s) =>
              n +
              (s.status === "passed"
                ? Math.min(s.elapsedMs, s.deadlineMs)
                : s.deadlineMs),
            0,
          ) / runs.length
        : null,
      medianMs: times.length
        ? (times[Math.floor((times.length - 1) / 2)]! +
            times[Math.floor(times.length / 2)]!) /
          2
        : null,
      p95Ms: times.length ? times[Math.ceil(times.length * 0.95) - 1]! : null,
    };
  });
}
export function pairedSpeedup(
  samples: Sample[],
  baseline: string,
  candidate: string,
) {
  const rows = summarize(samples),
    pairs = rows
      .filter((r) => r.key.split("/")[3] === baseline)
      .flatMap((before) => {
        const parts = before.key.split("/");
        parts[3] = candidate;
        const after = rows.find((r) => r.key === parts.join("/"));
        return after &&
          before.meanPenalizedMs &&
          after.meanPenalizedMs &&
          before.attempts === after.attempts
          ? [
              {
                task: before.key,
                ratio: before.meanPenalizedMs / after.meanPenalizedMs,
              },
            ]
          : [];
      });
  return {
    tasks: pairs.length,
    speedup: pairs.length
      ? Math.exp(
          pairs.reduce((n, p) => n + Math.log(p.ratio), 0) / pairs.length,
        )
      : null,
  };
}
/** Paired bootstrap over task-level penalized means; deterministic RNG for reproducibility. */
export function bootstrapSpeedup(
  samples: Sample[],
  baseline: string,
  candidate: string,
  iterations = 2000,
) {
  if (
    new Set(samples.map((s) => [s.platform, s.route, s.mode].join("/"))).size >
    1
  )
    throw new Error("Bootstrap one platform/route/mode stratum at a time.");
  const runs = samples.filter(
    (s) => s.status === "passed" || s.status === "failed",
  );
  const key = (s: Sample) =>
    [s.task, s.platform, s.route, s.mode, s.seed, s.sample].join("/");
  const pairs = runs
    .filter((s) => s.competitor === baseline)
    .flatMap((before) => {
      const after = runs.find(
        (s) => s.competitor === candidate && key(s) === key(before),
      );
      return after ? [{ before, after }] : [];
    });
  if (!pairs.length)
    return { pairs: 0, estimate: null, lower95: null, upper95: null };
  const tasks = [...new Set(pairs.map((p) => p.before.task))];
  let state = 42;
  const random = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const time = (s: Sample) =>
    s.status === "passed" ? Math.min(s.elapsedMs, s.deadlineMs) : s.deadlineMs;
  const estimate = (resample: boolean) =>
    Math.exp(
      tasks.reduce((sum, task) => {
        const group = pairs.filter((p) => p.before.task === task);
        let before = 0,
          after = 0;
        for (let i = 0; i < group.length; i++) {
          const pair =
            group[resample ? Math.floor(random() * group.length) : i]!;
          before += time(pair.before);
          after += time(pair.after);
        }
        return sum + Math.log(before / Math.max(after, 0.001));
      }, 0) / tasks.length,
    );
  const distribution = Array.from({ length: iterations }, () =>
    estimate(true),
  ).sort((a, b) => a - b);
  return {
    pairs: pairs.length,
    estimate: estimate(false),
    lower95: distribution[Math.floor(iterations * 0.025)]!,
    upper95:
      distribution[Math.min(iterations - 1, Math.floor(iterations * 0.975))]!,
  };
}
export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function htmlReport(samples: Sample[]) {
  return (
    '<!doctype html><meta charset="utf-8"><title>CU benchmark</title><style>body{font:16px system-ui;max-width:1200px;margin:40px auto}td,th{padding:8px;text-align:left;border-bottom:1px solid #ddd}</style><h1>CU benchmark</h1><p>Failures charged the full task deadline. Unsupported and not-run tasks are excluded. Subscription dollar costs unavailable. Native Pomerado entries are unsupported. Modified Pomerado uses the Codex provider adapter.</p><table><tr><th>Platform/route/mode/competitor/task</th><th>Pass/attempts</th><th>Not run</th><th>Penalized mean (ms)</th><th>Median (ms)</th><th>p95 (ms)</th></tr>' +
    summarize(samples)
      .map(
        (r) =>
          "<tr><td>" +
          escapeHtml(r.key) +
          "</td><td>" +
          r.passed +
          "/" +
          r.attempts +
          "</td><td>" +
          r.notRun +
          "</td><td>" +
          (r.meanPenalizedMs?.toFixed(1) ?? "—") +
          "</td><td>" +
          (r.medianMs?.toFixed(1) ?? "—") +
          "</td><td>" +
          (r.p95Ms?.toFixed(1) ?? "—") +
          "</td></tr>",
      )
      .join("") +
    "</table>"
  );
}
