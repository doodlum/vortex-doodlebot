# Benchmark report

This page describes the report that `/doodlebot:measure` and `/doodlebot:compare` write, and the
metrics each performance check reports.

## Where it is

The report is written to `<workspace>/harness/.artifacts/benchmarks/<UTC time>-<slug>/report.md`
and summarized in the chat.

## Sections

| Section     | Contents                                                                    | Written by               |
| ----------- | --------------------------------------------------------------------------- | ------------------------ |
| Question    | What you asked                                                              | The agent                |
| Builds      | Each build's path, its Vortex version (`vortexVersion`) and its mode        | The agent                |
| Measurement | The check's command and options                                             | The agent                |
| Conditions  | The machine, the date, and what else was running                            | The agent                |
| Results     | A table per metric                                                          | `doodlebot perf-summary` |
| Verdict     | The verdict per metric and overall. Comparisons only                        | `doodlebot perf-summary` |
| Evidence    | Every run's evidence file, and any budget failures                          | `doodlebot perf-summary` |
| Caveats     | The chance of a verdict by chance, and that a verdict needs a quiet machine | Both                     |

A report from `/doodlebot:measure` has one build, no Verdict section and no difference column.

## Results

For each metric and each build, the table gives the median, minimum, maximum and the number of
values. A comparison also gives the difference `(median B − median A) / median A × 100` in
percent, left out when median A is 0. The median of an even number of values is the mean of the
two middle values. Milliseconds and percentages are shown to one decimal place, and the
verdicts and the difference are worked out from those shown values, so what you read is what
was compared.

## Verdicts

| Verdict             | Per metric                                             | Overall                                                                    |
| ------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------- |
| Blocked             | Either build has fewer than three values. Tested first | Either build has fewer than three counted runs, or every metric is Blocked |
| Slower              | B's minimum is above A's maximum                       | Any metric is Slower                                                       |
| Faster              | B's maximum is below A's minimum                       | No metric is Slower, and any metric is Faster                              |
| No clear difference | Otherwise                                              | Otherwise                                                                  |

Blocked metrics are listed but do not decide the overall verdict. With five runs per build, two
sets of runs from the same build fail to overlap by chance in about 0.8% of cases per metric (2
in 252), about 4% across five metrics.

## Metrics

Every metric is in milliseconds, or per minute where noted, and lower is better. A metric missing
from an evidence file, for example `scrollThrough` when the check ran with
`--no-scroll-through`, is left out for that file.

| Check              | Metrics                                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `mods-scroll`      | `wheel.maxFrameGapMs`, `wheel.p95FrameMs`, `wheel.blockedMs`, `wheel.wallMs`, `scrollThrough.clearAfter.elapsedMs`                       |
| `large-library`    | `filter.elapsedMs`, `filter.blockedMs`, `clear.elapsedMs`, `clear.blockedMs`, `installs.wallMs`, `installs.longestMs`, `deployMs.onMods` |
| `collection-scale` | `phases.install.wallMs`, `phases.install.longestFreezeMs`, `phases.install.longTasks.totalMs`, `phases.update.wallMs`                    |
| `download-churn`   | `wallMs`, `persistDiffs.perMinute` (per minute), `slowWrites.totalMs`, `dispatches.totalMs`, `longTasks.totalMs`                         |
| `plugins-page`     | `scroll.elapsedMs`, `filter.elapsedMs`, `clear.elapsedMs`, `toggle.elapsedMs`, `toggle.longestMs`                                        |

## The summary command

The agent produces Results, Verdict and Evidence with:

```text
doodlebot perf-summary --check <check> --a <file> [--a <file> …] [--b <file> …] [--out <report.md>] [--json]
```

Each `--a` or `--b` names one evidence file. It writes Markdown to `--out` and prints the overall
verdict, then one line per metric with its verdict and medians. With `--json` it prints the
result as JSON.

## What's next

- [Measure and compare performance](../guides/benchmark.md).
