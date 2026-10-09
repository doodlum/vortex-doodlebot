# Write a benchmark

A benchmark is a test with measurements, repeats and a saved report. Start after [your first test](../getting-started/first-session.md). To run the supplied performance plan, use [run benchmarks](benchmarks.md).

## Write and run one case

Save this as `search-benchmark.mts` at the repository root:

```typescript title="search-benchmark.mts"
import { defineBenchmark, runBenchmarks } from "./harness/benchmarks/index";
import { exploratoryManifest } from "./benchmarks/config";

const search = defineBenchmark({
  id: "mods-search-150",
  name: "Search 150 generated mods",
  dataset: "synthetic",
  async run(vortex) {
    await vortex.seedMods(150);
    await vortex.table("mods").search("no-matching-mod");
  },
});

await runBenchmarks({
  benchmarks: [search],
  manifest: exploratoryManifest(),
  repeats: 1,
  outputDir: "harness/.artifacts/my-search-benchmark",
});
```

```powershell
pnpm exec tsx search-benchmark.mts
```

The case creates generated mods, searches the visible table and checks that its rows change. The table helper records the action's timing. A successful run exits with code `0` and saves `results.json` in the output directory. Failed or blocked cases also save a report before the runner throws. Read the [case status](results.md) before interpreting timings.

This is a one-repeat exploratory check on your current machine. It supplies no performance budget and downloads no Nexus files. Use a new output directory for each run you want to keep.

## Adapt the case

Give each case a stable ID, a useful name and the correct dataset label. Set up its starting state before timing the action. The proposal's table counts are **150, 570, 1,594 and 2,685**; use the same count and files per mod when comparing builds.

Table helpers such as `search()`, `sort()` and `scroll()` measure themselves. For a custom Playwright action, use `vortex.measure(name, async () => { ... })` around the action and its result check. Do not wrap a table helper in another measurement. See [table actions](../reference/tables.md) for required starting states and explicit controls.

To run more cases, add them to `benchmarks: [search, anotherCase]`. Each case and repeat gets a fresh app session. Set `repeats: 3` for a three-sample comparison and keep the run conditions fixed; a failed or blocked repeat stops that case. [Results and budgets](results.md) explains comparisons and pass/fail limits.

## Use real data

For a real collection case, first [prepare the collection](../getting-started/setup.md). Load its saved choice with `preparedCollection("C2")` from `./benchmarks/setup`, put it in `manifest.collection`, and label the case `dataset: "real"`. Use the collection's actual install/deploy/readiness checks. The supplied catalog already defines B1–B5; you do not need to recreate them to run the plan.

Generated Mods and Downloads rows test those UIs. Plugins and Load Order require actual installed engine data. When extending the catalog's workloads, use [table fixtures](table-fixtures.md); that guide covers the game controls, row counts and Downloads/background recipes. A missing real fixture is blocked coverage, not an invitation to substitute generated names.
