# Benchmark runner

Import from `./harness/benchmarks/index`. Use this for repeated measurements; use [withVortex](sessions.md#withvortex) for one functional script.

## defineBenchmark

<!-- contract:benchmarks.runner:defineBenchmark -->

```typescript
export function defineBenchmark(benchmark: Benchmark): Benchmark;
```

<!-- /contract -->

Checks and returns a case definition. Supply a readable `name`, an `id` containing letters, digits, dots, hyphens or underscores, `dataset: "synthetic"` or `"real"`, and an async `run(vortex)` callback. Validation does not run the case.

```typescript
const scroll = defineBenchmark({
  id: "mods-scroll-150",
  name: "Scroll 150 generated mods",
  dataset: "synthetic",
  async run(vortex) {
    await vortex.seedMods(150);
    await vortex.table("mods").scroll();
  },
});
```

## runBenchmarks

<!-- contract:benchmarks.runner:runBenchmarks -->

```typescript
export async function runBenchmarks(options: RunOptions): Promise<BenchmarkResult[]>;
```

<!-- /contract -->

Runs cases sequentially, with a fresh session per repeat. Returns results and writes `results.json` under `outputDir`. If any case fails or is blocked, it writes the report first, then throws. Read the report even when the command exits unsuccessfully.

Successful cases repeat; failed or blocked cases stop repeating. Later attempts cannot replace the first failure. Doodlebot does not retry failed collection operations. A dedicated retry test must make each attempt explicit and retain failures.

## RunOptions

<!-- contract:benchmarks.runner:RunOptions -->

```typescript
export interface RunOptions {
  benchmarks: readonly Benchmark[];
  manifest: RunManifest;
  outputDir: string;
  select?: readonly string[];
  /** Three repeats for a baseline; one is useful for smoke verification, never labeled a baseline. */
  repeats?: number;
  /** Back up/reset supported game settings and require verified snapshots for real cases. */
  cleanStart?: true;
}
```

<!-- /contract -->

| Field        | Meaning                                                          |
| ------------ | ---------------------------------------------------------------- |
| `benchmarks` | Cases to run; empty selection is not verification.               |
| `manifest`   | [Run conditions and data](results.md#runmanifest).               |
| `outputDir`  | Report directory; choose a fresh one for each comparison.        |
| `select`     | Optional case IDs within the supplied array.                     |
| `repeats`    | Defaults to three. One is a smoke check, not a baseline.         |
| `cleanStart` | Verify real snapshots and reset supported settings after backup. |

See [a complete custom case](../testing/adding-benchmarks.md#a-small-custom-case) and [reading reports](../testing/results.md).

## Supplied catalog commands

| Command                                                          | Result                                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| `pnpm run benchmark:list`                                        | Lists the 117 named cases; no app launch.                            |
| `pnpm run benchmark:check`                                       | Checks IDs and coverage structure, not app behavior.                 |
| `pnpm run benchmark:smoke`                                       | One anonymous synthetic Mods scroll case.                            |
| `pnpm run benchmark -- --exploratory --repeats=1 --select=B1-C2` | One real cold-install case using prepared C2.                        |
| `pnpm run benchmark -- --select=T1-scroll-150`                   | Formal run using `benchmarks/config.ts`; undecided conditions block. |

`--exploratory` records CPU/RAM/OS metadata, labels unmeasured conditions and supplies no budgets. It does not approve a baseline. Real games still need [setup](../getting-started/setup.md).
