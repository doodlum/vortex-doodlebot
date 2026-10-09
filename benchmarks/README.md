# Performance benchmarks

The catalog contains 117 cases: the four named collections, including separate base and paid-AE GTS workloads and T1–T4. Undecided collection choices are excluded. Cases and configuration are ordinary TypeScript modules; the SDK starts and closes Vortex and saves each repeat's measurements.

Start with a local run:

```powershell
pnpm run benchmark:check
pnpm run benchmark:smoke
```

`benchmark:check` checks the catalog. `benchmark:smoke` runs one scroll case against released Vortex with generated mods and actual machine metadata.

Run `pnpm run setup` to discover a Steam game, sign in and prepare a reusable game copy. Saved choices load into the catalog automatically. Use `pnpm run setup -- --status` to inspect them. Edit `config.ts` for custom run conditions and fixtures. Use `workloads.ts` for game-specific controls, with a fixture for each table and row count. Real Steam installations can supply the source game files once installation and updates finish.

The [benchmark guide](https://doodlum.github.io/vortex-doodlebot/testing/benchmarks/) covers selection and repeats. [Adding a case](https://doodlum.github.io/vortex-doodlebot/testing/adding-benchmarks/) shows TypeScript examples for custom tests, collection setup, Downloads, and game tables. [Results](https://doodlum.github.io/vortex-doodlebot/testing/results/) explains reports and missing coverage.

Real collection revisions, engine data, account access, and release budgets still need configuring. Missing prerequisites produce blocked results; they do not become synthetic substitutes or successful timing samples.
