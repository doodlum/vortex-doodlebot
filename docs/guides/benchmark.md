# Measure and compare performance

This page shows how to have the agent measure a Vortex flow on one build, or compare two
builds, with `/doodlebot:measure --a <build> [--b <build>] --check <check>`.

## Before you begin

- [Set up doodlebot](../get-started/set-up.md).
- Know each build you want to measure. A build is one of:
  - an official release by version, such as `2.8.0`, which the agent fetches with
    `doodlebot release get 2.8.0` (checked against the published SHA-256 and extracted without
    running the installer);
  - an executable (`--exe <path>`);
  - a source checkout (`--dev-dir <path>`), such as a worktree of your Vortex checkout.
- Make sure no test Vortex is running; the agent asks before stopping one.
- Keep the machine quiet while it measures: close CPU-heavy programs and do not use the machine.
  A verdict is only as good as these conditions.

## What can be measured

The agent measures with one of doodlebot's five performance checks. It maps your question to a
check and its options, and tells you its choice. A request outside them is answered with the
nearest check, or declined.

| Check              | What it measures                                                        | Needs                |
| ------------------ | ----------------------------------------------------------------------- | -------------------- |
| `mods-scroll`      | Scrolling the Mods table with many mods (`--mods <n>`, default 3,000)   | The sandbox          |
| `large-library`    | Filtering, clearing, installing and deploying with a large mod library  | The sandbox          |
| `collection-scale` | Installing and updating a large generated collection (`--members <n>`)  | The sandbox          |
| `download-churn`   | State writes and long tasks while many downloads run                    | Any game             |
| `plugins-page`     | Scrolling, filtering and toggling on the Plugins page (`--plugins <n>`) | The Bethesda sandbox |

For example, "the Mods table with 3,000 mods" is `doodlebot test mods-scroll --mods 3000`.

## Measure one build

1. Run:

   ```text
   /doodlebot:measure --a 2.8.0 --check mods-scroll --mods 3000
   ```

   Plain words work too: "measure the Mods table with 3,000 mods on 2.8.0".

2. The agent picks the check, states it, and runs it five times by default (three at least).

3. The agent summarizes the runs with `doodlebot perf-summary`.

The expected result: a [benchmark report](../reference/benchmark-report.md) with each metric's
median, minimum, maximum and count. A measurement of one build has no verdict.

## Compare two builds

1. Run:

   ```text
   /doodlebot:measure --a 2.8.0 --b my branch --check mods-scroll --mods 3000
   ```

   Name both builds: a release version, a path to an executable, or a source checkout (your
   session's Vortex checkout, or a worktree of it on another branch).

2. The agent fixes the builds. A source checkout is built in production mode with
   `doodlebot build --checkout <dir> --production` and launched with `--production`, so it runs
   like a release. Each build gets its own new, signed-out profile cache.

3. The agent runs the check on A and B alternately (A, B, A, B, …), five times each by default
   and three at least. Each run is:

   1. `doodlebot up <build flags> <game flags> --fresh`;
   2. `doodlebot call automation_status`, to record the Vortex version and mode;
   3. `doodlebot test <check> <options>`, which writes one evidence file;
   4. `doodlebot down`.

4. The agent runs `doodlebot perf-summary` on the evidence files and returns the report.

The expected result: a [benchmark report](../reference/benchmark-report.md) with each metric's
median and range per build, the difference, a verdict per metric and an overall verdict.

### How runs count

- A run whose check fails a budget after writing its evidence counts, and its failures are
  listed.
- A run with no evidence is failed and not counted.
- A side with fewer than three counted runs makes the report _Blocked_.

### How the verdict is decided

Every metric is a time in milliseconds, or a rate per minute, and lower is better. For each
metric:

1. **Blocked** if either build has fewer than three values.
2. **Faster** if B's slowest value is below A's fastest.
3. **Slower** if B's fastest value is above A's slowest.
4. Otherwise **No clear difference**.

The overall verdict is _Blocked_ if either build has fewer than three counted runs or every
metric is Blocked; otherwise _Slower_ if any metric is Slower; otherwise _Faster_ if any metric
is Faster; otherwise _No clear difference_.

With five runs each, two sets of runs from the same build fail to overlap by chance in about
0.8% of cases per metric, about 4% across five metrics. When a comparison of a build with itself,
or a surprising result, gives a verdict other than No clear difference, the agent reruns the
whole comparison once and reports both.

## What's next

- [Benchmark report](../reference/benchmark-report.md) describes each section and metric.
- [Work on Vortex source](source-development.md) to build the branch you want to compare.
