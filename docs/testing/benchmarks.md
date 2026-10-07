# Write and compare benchmarks

Use a benchmark to investigate a slow mod table, collection install or download workload.
Measure how long it takes, find where time is spent, then compare a candidate with the
baseline. Doodlebot provides reproducible fixtures, timing probes, CPU profiles and
log/Redux instrumentation.

## Choose a workload

| Workload                      | Existing entry point       | What it measures                                                                         |
| ----------------------------- | -------------------------- | ---------------------------------------------------------------------------------------- |
| Large mod list                | `ai:test:large-library`    | Visible rows, filtering, installs and deployment comparisons                             |
| Mod-table scrolling           | `ai:test:mods-scroll`      | Frame gaps, long tasks, row accumulation, dropdown clipping and optional conflict editor |
| Offline collection resolution | `ai:test:collection-scale` | Wall time, freeze budget, CPU, Redux work and Vortex stage timings                       |
| Concurrent downloads          | `ai:test:download-churn`   | Persistence, dispatches, long tasks and database writes; measurement only                |

These scenarios attach to a sandbox under your owner and can seed, install, deploy or purge
their disposable fixtures. Read the scenario header before choosing sizes. They run separately
from the core gate because they investigate specific Vortex behavior or performance budgets.

## Run a reproducible scenario

```powershell
$env:VORTEX_AI_OWNER = 'benchmark'
$env:VORTEX_AI_SLOT = 'auto'
$env:VORTEX_AI_INSTALLED = '1'
pnpm run ai -- setup --installed --sandbox
pnpm run ai:test:large-library -- --mods 3000 --layout modern --installs 10 --no-deploy
pnpm run ai:test:mods-scroll -- --mods 3000 --layout modern --max-frame-gap 300 --no-scroll-through
pnpm run ai:test:collection-scale -- --members 2000 --optional 0.1 --rules 100
pnpm run ai:test:download-churn -- --downloads 4 --seconds 60
pnpm run ai -- down --installed --sandbox
```

Choose one scenario per experiment; the block shows the available commands. Printed report
paths and artifacts belong to that workload. Some scenarios have
assertion budgets; `download-churn` has no automatic performance pass/fail threshold.

Released Vortex uses production React. For a source target, build and launch with
`--production`, and inspect `automation_status.react.build`. Development React timings are
not representative of released-user performance.

## Add your own measured action

In a `.mts` script run with `pnpm run ai -- script`, reuse the profiling helper:

```typescript title="Runnable profiling script"
const kit = await import(process.env.VORTEX_AI_KIT!);
const config = kit.loadConfig();
const mcp = kit.clientFor(config);
const handle = await kit.attachToRenderer(config);
try {
  const result = await kit.profiling.profileRenderer(
    handle.page,
    async () => {
      // Replace this cheap diagnostic with the exact action you want to measure.
      return await mcp.call("list_mods");
    },
    { artifactDir: config.artifactDir, label: "my-workload" },
  );
  console.log(JSON.stringify({ summary: result.summary, cpuProfile: result.file }, null, 2));
} finally {
  await handle.close();
}
```

The callback is the measured region. `profileRenderer` returns the callback result, a raw
CPU profile, self/inclusive summaries and optional `.cpuprofile` path. Open the raw file in
Chrome/Edge DevTools. Profiling adds overhead, so compare runs with the same profiling setup.
The example measures an inventory call; replace it with the installation action if that is
the workflow you need to measure.

For UI responsiveness, `largeLibrary.measureBlocked(page, actionSource, settleMs)` observes
frame gaps and long tasks around a controlled renderer action. `tableProbes` adds native
wheel, visible-row and dropdown observations. `perf_trace_start/stop` measure Redux/action
and heap behavior; `vortexLog` can correlate persistence and stage timings. Read the
[helper reference](../reference/script-api.md) for full signatures.

## Compare baseline and candidate

1. Record actual source revision and runtime hashes for both sides.
2. Match production mode, game/profile, fixture size/shape, layout, viewport, hardware and service conditions.
3. Define cold/warm behavior and recreate the fixture consistently; a fresh profile alone does not clear every OS cache.
4. Run baseline and candidate sequentially on an idle machine, at least three times per side. Report every run and spread, not only the best result.
5. Save raw measurements, CPU evidence and enough output to repeat the experiment.
6. Compare the relevant user-visible metric and confirm correctness/recovery still holds.

Set a budget from representative behavior and product requirements before evaluating the
result. Use the original workload to assess whether the issue improved, and report timeouts,
missing members and skipped stages. Keep outliers and investigate them. Use
[evidence reports](../guides/evidence.md) when preparing the change for production review.
