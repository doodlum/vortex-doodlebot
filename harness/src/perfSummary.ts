/**
 * `doodlebot perf-summary --check <check> --a <file> [--a <file> …] [--b <file> …] [--out <file>]
 * [--json]`: a deterministic summary of performance-check evidence for one build (A) or two
 * (A and B). Each metric comes from a fixed table, is in milliseconds (or per minute where
 * noted), and is better lower. The verdict is a non-overlap rule, not a significance test: with
 * n runs a side, two sets from the same distribution fail to overlap by chance in
 * 2 / C(2n, n) of cases per metric.
 */
import fs from "node:fs";
import path from "node:path";

import { ConfigError } from "./errors";
import { parseJson } from "./jsonFile";

export type Verdict = "Faster" | "Slower" | "No clear difference" | "Blocked";

interface Metric {
  path: string;
  unit: "ms" | "per minute";
}

const ms = (...paths: string[]): Metric[] => paths.map((p) => ({ path: p, unit: "ms" }));

export const METRICS: Record<string, Metric[]> = {
  "mods-scroll": ms(
    "wheel.maxFrameGapMs",
    "wheel.p95FrameMs",
    "wheel.blockedMs",
    "wheel.wallMs",
    "scrollThrough.clearAfter.elapsedMs",
  ),
  "large-library": ms(
    "filter.elapsedMs",
    "filter.blockedMs",
    "clear.elapsedMs",
    "clear.blockedMs",
    "installs.wallMs",
    "installs.longestMs",
    "deployMs.onMods",
  ),
  "collection-scale": ms(
    "phases.install.wallMs",
    "phases.install.longestFreezeMs",
    "phases.install.longTasks.totalMs",
    "phases.update.wallMs",
  ),
  "download-churn": [
    { path: "wallMs", unit: "ms" },
    { path: "persistDiffs.perMinute", unit: "per minute" },
    { path: "slowWrites.totalMs", unit: "ms" },
    { path: "dispatches.totalMs", unit: "ms" },
    { path: "longTasks.totalMs", unit: "ms" },
  ],
  "plugins-page": ms(
    "scroll.elapsedMs",
    "filter.elapsedMs",
    "clear.elapsedMs",
    "toggle.elapsedMs",
    "toggle.longestMs",
  ),
};

/** Fewer counted runs (or values of a metric) than this on a side blocks a verdict. */
export const MINIMUM_RUNS = 3;

export interface SideStats {
  count: number;
  median: number | null;
  min: number | null;
  max: number | null;
}

export interface MetricResult {
  path: string;
  unit: Metric["unit"];
  a: SideStats;
  b?: SideStats;
  /** (median B − median A) / median A × 100; absent with one side or when median A is 0. */
  differencePercent?: number;
  verdict?: Verdict;
}

export interface Evidence {
  file: string;
  /** Budget failures the check recorded (it exited 1 after writing this evidence). */
  failures: string[];
}

export interface PerfSummary {
  check: string;
  a: Evidence[];
  b?: Evidence[];
  metrics: MetricResult[];
  /** The overall verdict; absent with one side. */
  verdict?: Verdict;
  caveats: string[];
}

/** To one decimal place, as every number in the report. */
export const round1 = (value: number): number => Math.round(value * 10) / 10;

export function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function valueAt(document: unknown, dotted: string): number | undefined {
  let value: unknown = document;
  for (const key of dotted.split(".")) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stats(values: number[]): SideStats {
  if (values.length === 0) return { count: 0, median: null, min: null, max: null };
  return {
    count: values.length,
    median: round1(median(values)),
    min: round1(Math.min(...values)),
    max: round1(Math.max(...values)),
  };
}

/** The verdict for one metric: lower is better, and B is compared with A. */
export function metricVerdict(a: number[], b: number[]): Verdict {
  if (a.length < MINIMUM_RUNS || b.length < MINIMUM_RUNS) return "Blocked";
  if (Math.max(...b) < Math.min(...a)) return "Faster";
  if (Math.min(...b) > Math.max(...a)) return "Slower";
  return "No clear difference";
}

export function overallVerdict(runsA: number, runsB: number, verdicts: Verdict[]): Verdict {
  if (runsA < MINIMUM_RUNS || runsB < MINIMUM_RUNS) return "Blocked";
  if (verdicts.every((verdict) => verdict === "Blocked")) return "Blocked";
  if (verdicts.includes("Slower")) return "Slower";
  if (verdicts.includes("Faster")) return "Faster";
  return "No clear difference";
}

function binomial(n: number, k: number): number {
  let result = 1;
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
  return result;
}

/** The chance that two sets of these sizes from one distribution do not overlap at all. */
export function chanceNonOverlap(countA: number, countB: number): number {
  return 2 / binomial(countA + countB, countA);
}

function readEvidence(file: string): { document: unknown; failures: string[] } {
  let document: unknown;
  try {
    document = parseJson(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new ConfigError(
      `${file}: not readable evidence JSON (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  const raw =
    document !== null && typeof document === "object"
      ? (document as Record<string, unknown>).failures
      : undefined;
  const failures = Array.isArray(raw) ? raw.filter((f): f is string => typeof f === "string") : [];
  return { document, failures };
}

export function summarise(check: string, filesA: string[], filesB?: string[]): PerfSummary {
  const metrics = METRICS[check];
  if (metrics === undefined)
    throw new ConfigError(
      `Unknown check "${check}"; perf-summary knows ${Object.keys(METRICS).join(", ")}.`,
    );
  if (filesA.length === 0) throw new ConfigError("perf-summary needs at least one --a <file>.");
  const sideA = filesA.map((file) => ({ file, ...readEvidence(file) }));
  const sideB = filesB?.map((file) => ({ file, ...readEvidence(file) }));
  const values = (side: typeof sideA, metric: Metric) =>
    side
      .map((run) => valueAt(run.document, metric.path))
      .filter((v): v is number => v !== undefined);

  const results: MetricResult[] = metrics.map((metric) => {
    const a = values(sideA, metric);
    const result: MetricResult = { path: metric.path, unit: metric.unit, a: stats(a) };
    if (sideB === undefined) return result;
    const b = values(sideB, metric);
    result.b = stats(b);
    if (a.length > 0 && b.length > 0) {
      const medianA = median(a);
      if (medianA !== 0) result.differencePercent = round1(((median(b) - medianA) / medianA) * 100);
    }
    result.verdict = metricVerdict(a, b);
    return result;
  });

  const evidence = (side: typeof sideA): Evidence[] =>
    side.map(({ file, failures }) => ({ file, failures }));
  const summary: PerfSummary = { check, a: evidence(sideA), metrics: results, caveats: [] };
  if (sideB === undefined) {
    summary.caveats.push(
      `One build measured (${String(sideA.length)} runs): there is no comparison and no verdict. ` +
        "The range shows the spread between runs on this machine.",
    );
    return summary;
  }
  summary.b = evidence(sideB);
  summary.verdict = overallVerdict(
    sideA.length,
    sideB.length,
    results.map((r) => r.verdict!),
  );
  const decided = results.filter((r) => r.verdict !== "Blocked");
  if (sideA.length < MINIMUM_RUNS || sideB.length < MINIMUM_RUNS)
    summary.caveats.push(
      `Blocked: each build needs at least ${String(MINIMUM_RUNS)} counted runs (A ${String(sideA.length)}, B ${String(sideB.length)}).`,
    );
  if (decided.length > 0) {
    const perMetric = Math.max(...decided.map((r) => chanceNonOverlap(r.a.count, r.b!.count)));
    const across = 1 - (1 - perMetric) ** decided.length;
    summary.caveats.push(
      `A verdict means the two sets of runs do not overlap. Two sets of these sizes from the same ` +
        `distribution fail to overlap by chance in about ${percent(perMetric)} of cases per ` +
        `metric; across ${String(decided.length)} metrics, about ${percent(across)}.`,
    );
  }
  summary.caveats.push("Blocked metrics are listed but do not decide the overall verdict.");
  return summary;
}

function percent(probability: number): string {
  return `${round1(probability * 100).toFixed(1)}%`;
}

const number = (value: number | null) => (value === null ? "–" : value.toFixed(1));
const signed = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;

function unitLabel(metric: MetricResult): string {
  return metric.unit === "ms" ? "ms" : "per minute";
}

export function formatMarkdown(summary: PerfSummary): string {
  const twoSided = summary.b !== undefined;
  const lines: string[] = ["## Results", ""];
  lines.push(`Check: \`${summary.check}\`. Lower is better for every metric.`, "");
  for (const metric of summary.metrics) {
    lines.push(`### \`${metric.path}\` (${unitLabel(metric)})`, "");
    lines.push(
      twoSided
        ? "| Build | Median | Min | Max | Values | Difference | Verdict |"
        : "| Build | Median | Min | Max | Values |",
    );
    lines.push(
      twoSided ? "| --- | --- | --- | --- | --- | --- | --- |" : "| --- | --- | --- | --- | --- |",
    );
    const row = (name: string, side: SideStats, extra: string[]) =>
      `| ${[name, number(side.median), number(side.min), number(side.max), String(side.count), ...extra].join(" | ")} |`;
    if (twoSided) {
      lines.push(row("A", metric.a, ["", ""]));
      lines.push(
        row("B", metric.b!, [
          metric.differencePercent === undefined ? "–" : signed(metric.differencePercent),
          metric.verdict!,
        ]),
      );
    } else {
      lines.push(row("A", metric.a, []));
    }
    lines.push("");
  }
  if (twoSided) {
    lines.push("## Verdict", "", `**${summary.verdict!}**`, "");
    for (const metric of summary.metrics) lines.push(`- \`${metric.path}\`: ${metric.verdict!}`);
    lines.push("");
  }
  lines.push("## Evidence", "");
  const evidence = (name: string, side: Evidence[]) => {
    for (const run of side) {
      lines.push(`- ${name}: \`${run.file}\``);
      for (const failure of run.failures) lines.push(`  - budget failure: ${failure}`);
    }
  };
  evidence("A", summary.a);
  if (summary.b !== undefined) evidence("B", summary.b);
  lines.push("", "## Caveats", "");
  for (const caveat of summary.caveats) lines.push(`- ${caveat}`);
  return `${lines.join("\n")}\n`;
}

export function formatSummary(summary: PerfSummary): string {
  const lines: string[] = [];
  if (summary.verdict !== undefined) lines.push(`Verdict: ${summary.verdict}`);
  for (const metric of summary.metrics) {
    const side = (s: SideStats) =>
      s.median === null
        ? "no values"
        : `${number(s.median)} (${number(s.min)}–${number(s.max)}, n=${String(s.count)})`;
    lines.push(
      metric.b === undefined
        ? `${metric.path}: median ${side(metric.a)}`
        : `${metric.path}: ${metric.verdict!}; median A ${side(metric.a)}, B ${side(metric.b)}` +
            (metric.differencePercent === undefined ? "" : `, ${signed(metric.differencePercent)}`),
    );
  }
  return lines.join("\n");
}

/** The CLI: writes `--out` when given and returns what to print. */
export function perfSummaryCommand(
  flags: Record<string, string | boolean>,
  lists: Record<string, string[]>,
): string {
  if (typeof flags.check !== "string")
    throw new ConfigError(`perf-summary needs --check <${Object.keys(METRICS).join("|")}>.`);
  const summary = summarise(flags.check, lists.a ?? [], lists.b);
  if (typeof flags.out === "string") {
    fs.mkdirSync(path.dirname(flags.out), { recursive: true });
    fs.writeFileSync(flags.out, formatMarkdown(summary));
  }
  return flags.json === true ? JSON.stringify(summary, null, 2) : formatSummary(summary);
}
