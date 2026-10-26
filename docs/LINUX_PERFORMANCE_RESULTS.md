# Firefox native-control results · 2026-10-26

The optimized Linux CLI completed the synthetic Firefox console/release-navigation
workflow **3.03× faster** using bounded text entry. This measures the native
control portion of the earlier Firefox task, not an agent's complete answer.

| Path | Verified runs | Mean | Median | p95 |
| --- | ---: | ---: | ---: | ---: |
| Previous CLI, separate actions | 20/20 | 3,482 ms | 3,456 ms | 3,705 ms |
| Optimized CLI, separate actions | 20/20 | 2,947 ms | 2,921 ms | 3,118 ms |
| Optimized CLI, bounded text entry | 20/20 | 1,150 ms | 1,140 ms | 1,211 ms |

Paired bootstrap over 20 matched trials, 2,000 deterministic resamples:

- Separate-action speedup: **1.18×**, 95% interval **1.16–1.20×**.
- Text-entry sequence speedup: **3.03×**, 95% interval **2.98–3.08×**.
- Mean time reduction with sequences: approximately **67%**.

The previous CLI is frozen at commit
`7c1a96f56ff675fff796f7df0eaa5a4bbf3ce8b3`. The candidate is the uncommitted native
performance implementation, identified by per-file hashes in the raw artifact.
Runtime: Linux X11/Xvfb, 1920×1080×24, Firefox 158.0, Node 24.18.1, same machine,
profile and fixture for all arms. Arm order reverses on alternating trials.

## What was timed and verified

Each trial opens two local pages mirroring the dashboard and release inspection.
It uses actual `node bin/cu.mjs desktop-api call` subprocesses, scoped broker
requests, native shortcuts/clipboard input, page readiness, screenshots, screenshot
file writes and independent native title checks. A nonce callback after rendering
and the native title must match each navigation. Unknown-delivery input is never
retried; only certified `notDispatched` stale observations may be refreshed.
All 60 recorded trials passed. Early fixture/debug attempts are excluded; their
failures prompted capture-target, title-reading and dispatch-cadence fixes.

Firefox, display and broker startup are outside the timer. No model reasoning,
OCR, popup, viewer/recording contention, Google network time or account mutation
is timed. The fixture is a static local release dashboard, not Google's real app.
The full Play Console task additionally requires reading/interpreting pages and
handling variable site behavior; this benchmark does not measure those costs.
There is one task template, so these confidence intervals do not generalize across
applications. Stage samples cover completed timed operations; total latency also
includes any certified stale-observation retry overhead.

The final 20-pair measurement precedes two unmeasured-path changes: MCP tool
exposure for sequences and explicit refusal of non-TrueColor visuals. The final
build received a separate three-arm Firefox smoke check; its timings are not
pooled into the 20-pair result. Source hashes make this distinction reviewable.

## Live Firefox verification

The updated broker also controlled the user's existing signed-in Firefox on the
3840×2160 desktop. Window activation succeeded. The bounded address-entry command
completed its three steps in **236 ms** in one live sample; the preceding full
observation took **416 ms**. These are command timings, not page-load or total
live-task latency, and have no paired live baseline.

A subsequent native screenshot verified the actual Play Console release list:
Zuse **1.1.0 (3)** remained the latest release, available to closed Alpha and
internal testers, updated October 25. No release settings were changed. Control
was released. Signed-in screenshots remain local and are excluded from committed
benchmark artifacts.

## Checks and boundaries

- Typecheck, production build and whitespace checks: passed.
- Full behavior suite: **209 passed, 1 skipped** (Mac-only broker lock test).
- Real X11 test: passed frame/sample parity, Unicode clipboard insertion,
  held-key release on disconnect and refusal to replay a failed session.
- Pixel-layout test: passed 16/24/32-bit layouts, both byte orders and padded rows.
- GTK/AT-SPI workflow: passed independent file save verification, raw fallback,
  popup/cancel and capture exclusion.
- Remaining limits: no live Mac or Wayland test, no real terminal application
  clipboard matrix, no viewer/recording stress measurements, no MIT-SHM capture,
  and no repeated model-driven end-to-end live account benchmark. The legacy
  driver's 180 ms settling policy remains.

See [implementation and reproduction](LINUX_PERFORMANCE.md). Numeric samples,
source hashes, per-operation timings and paired comparisons are in
[benchmarks/results/2026-10-26-firefox.json](../benchmarks/results/2026-10-26-firefox.json).
Local screenshots and HTML report are under `.context/benchmark-firefox-reviewed`;
the live check is under `.context/firefox-live`.
