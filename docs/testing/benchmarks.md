# Run benchmarks

The supplied catalog contains the [collection and table performance plan](proposal.md): **117 named cases**, including both GTS content variants. Run these cases directly; [write a benchmark](adding-benchmarks.md) only when you need a new measurement.

## Check one local case

From the repository root:

```powershell
pnpm run benchmark:smoke
```

This scrolls 150 generated Mods rows in released Vortex, with one exploratory repeat. It needs no Nexus account or installed game and makes no Nexus downloads. Open `harness/.artifacts/proposal-smoke/results.json`; success means the scroll and its checks completed, not that a performance target was met.

For real downloads and installation, follow [run a collection](../getting-started/setup.md). That guide owns game preparation, login, snapshots and the first real run.

## Select cases

```powershell
pnpm run benchmark:list
pnpm run benchmark:check
```

The list shows IDs and dataset labels. The check verifies the catalog's structure; it does not launch Vortex or prove that real fixtures are available. Undecided collection choices are excluded. The counts are 25 collection cases, 36 Mods actions, 40 game-table actions, 12 Downloads actions and four background cases.

For an exploratory run of selected local cases:

```powershell
pnpm run benchmark -- --exploratory --repeats=1 --select=T1-scroll-150,T3-filter-150
```

Reports go into a new timestamped directory under `harness/.artifacts/proposal-benchmarks`. Each group has `results.json`; the suite index records pending and completed groups. A nonzero exit can still have useful reports. Missing fixtures or controls produce blocked results.

## Compare releases

Before treating a run as a baseline, edit `benchmarks/config.ts` to record the agreed hardware, storage, bandwidth, account profile, Windows/security settings, released Vortex version and budgets. Those decisions remain **TBD** until agreed. `--exploratory` records available machine facts for a trial; it does not approve these conditions or audit drive/security settings.

Prepare the real collections you will select using setup. Saved choices load into the catalog automatically. For Plugins and Load Order, supply the [real table fixtures](table-fixtures.md) for each requested count. Missing setup remains blocked coverage.

Run the same case IDs and conditions for each build. For example, after preparing C2:

```powershell
pnpm run benchmark -- --timeout-minutes=360 --select=B1-C2,B2-C2,B3-C2,B4-C2,B5-C2
```

The default is three repeats, with fresh app sessions and sequential execution. The six-hour timeout is an operation deadline, not a performance budget; choose it for your workload. Run the full configured plan with `pnpm run benchmark`. Hardware and game prerequisites still apply, so this command does not guarantee all cases can run.

Keep reports from both builds and [compare their results](results.md). Check status, warnings, cache mode, measurements and repeat spread. A generated-data pass does not cover a real collection, and a passed case without a supplied budget is a functional result.
