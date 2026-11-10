import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  METRICS,
  chanceNonOverlap,
  formatMarkdown,
  formatSummary,
  median,
  metricVerdict,
  overallVerdict,
  perfSummaryCommand,
  round1,
  summarise,
} from "./perfSummary";

let temp: string;
let count = 0;
beforeEach(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "doodlebot-perf-"));
});
afterEach(() => fs.rmSync(temp, { recursive: true, force: true }));

function save(document: unknown): string {
  const file = path.join(temp, `run-${String(count++)}.json`);
  fs.writeFileSync(file, JSON.stringify(document));
  return file;
}

/** Evidence shaped as mods-scroll.e2e.ts writes it, every metric `value` (or as given). */
function modsScroll(value: number, overrides: Record<string, number | undefined> = {}) {
  const v = (name: string) => (name in overrides ? overrides[name] : value);
  const through = v("clear");
  return {
    count: 3000,
    layout: "modern",
    nodeEnv: "production",
    wheel: {
      maxFrameGapMs: v("gap"),
      p95FrameMs: v("p95"),
      blockedMs: v("blocked"),
      wallMs: v("wall"),
      longestMs: 1,
    },
    ...(through === undefined
      ? {}
      : {
          scrollThrough: {
            wallMs: 1,
            blockedMs: 1,
            clearAfter: { elapsedMs: through, blockedMs: 1 },
          },
        }),
    failures: [],
  };
}

const files = (values: number[], make: (v: number) => unknown = modsScroll) =>
  values.map((v) => save(make(v)));

describe("statistics", () => {
  it("takes the mean of the two middle values for an even count", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([5, 1, 3])).toBe(3);
  });

  it("rounds to one decimal place", () => {
    expect(round1(12.345)).toBe(12.3);
    expect(round1(12.35)).toBe(12.4);
    expect(round1(-3.04)).toBe(-3);
  });

  it("states the chance two sets of five from one distribution do not overlap", () => {
    expect(chanceNonOverlap(5, 5)).toBeCloseTo(2 / 252, 10);
    expect(chanceNonOverlap(3, 3)).toBeCloseTo(0.1, 10);
  });
});

describe("verdicts", () => {
  it("is Faster when every B value is below every A value, Slower when above", () => {
    expect(metricVerdict([10, 11, 12], [7, 8, 9])).toBe("Faster");
    expect(metricVerdict([10, 11, 12], [13, 14, 15])).toBe("Slower");
    expect(metricVerdict([10, 11, 12], [9, 11, 13])).toBe("No clear difference");
    // Touching ranges overlap.
    expect(metricVerdict([10, 11, 12], [8, 9, 10])).toBe("No clear difference");
  });

  it("is Blocked first when a side has fewer than three values", () => {
    expect(metricVerdict([10, 11], [1, 2, 3])).toBe("Blocked");
    expect(metricVerdict([10, 11, 12], [1, 2])).toBe("Blocked");
  });

  it("decides overall: Blocked, then Slower, then Faster", () => {
    expect(overallVerdict(5, 2, ["Faster"])).toBe("Blocked");
    expect(overallVerdict(5, 5, ["Blocked", "Blocked"])).toBe("Blocked");
    expect(overallVerdict(5, 5, ["Faster", "Slower", "Blocked"])).toBe("Slower");
    expect(overallVerdict(5, 5, ["Faster", "No clear difference", "Blocked"])).toBe("Faster");
    expect(overallVerdict(5, 5, ["No clear difference", "Blocked"])).toBe("No clear difference");
  });
});

describe("perf-summary with fixed numbers", () => {
  it("reports Faster with medians, ranges and the percent difference", () => {
    const summary = summarise(
      "mods-scroll",
      files([100, 110, 120, 105, 115]),
      files([50, 60, 55, 52, 58]),
    );
    expect(summary.verdict).toBe("Faster");
    expect(summary.metrics[0]).toEqual({
      path: "wheel.maxFrameGapMs",
      unit: "ms",
      a: { count: 5, median: 110, min: 100, max: 120 },
      b: { count: 5, median: 55, min: 50, max: 60 },
      differencePercent: -50,
      verdict: "Faster",
    });
    expect(summary.metrics.every((m) => m.verdict === "Faster")).toBe(true);
  });

  it("reports Slower when any metric is slower", () => {
    const b = [130, 140, 150, 135, 145].map((v) => save(modsScroll(50, { gap: v })));
    const summary = summarise("mods-scroll", files([100, 110, 120, 105, 115]), b);
    expect(summary.metrics.map((m) => m.verdict)).toEqual([
      "Slower",
      "Faster",
      "Faster",
      "Faster",
      "Faster",
    ]);
    expect(summary.verdict).toBe("Slower");
  });

  it("reports No clear difference for overlapping runs, with an even count and the percent formula", () => {
    const summary = summarise(
      "mods-scroll",
      files([100, 104, 108, 112]),
      files([101, 103, 117, 121]),
    );
    const gap = summary.metrics[0]!;
    expect(gap.a.median).toBe(106);
    expect(gap.b!.median).toBe(110);
    // (110 − 106) / 106 × 100 = 3.7735… → 3.8
    expect(gap.differencePercent).toBe(3.8);
    expect(summary.verdict).toBe("No clear difference");
  });

  it("omits the difference when median A is 0", () => {
    const summary = summarise("mods-scroll", files([0, 0, 0]), files([1, 2, 3]));
    expect(summary.metrics[0]!.differencePercent).toBeUndefined();
    expect(summary.metrics[0]!.verdict).toBe("Slower");
  });

  it("blocks a metric missing from enough files, without blocking the rest", () => {
    const b = [50, 51, 52, 53, 54].map((v, i) =>
      save(modsScroll(v, i < 3 ? { clear: undefined } : {})),
    );
    const summary = summarise("mods-scroll", files([100, 110, 120, 105, 115]), b);
    const clear = summary.metrics.find((m) => m.path === "scrollThrough.clearAfter.elapsedMs")!;
    expect(clear.b!.count).toBe(2);
    expect(clear.verdict).toBe("Blocked");
    expect(summary.verdict).toBe("Faster");
    expect(formatMarkdown(summary)).toContain("Blocked metrics are listed but do not decide");
  });

  it("is Blocked overall with fewer than three counted runs on a side", () => {
    const summary = summarise("mods-scroll", files([100, 110, 120]), files([50, 60]));
    expect(summary.verdict).toBe("Blocked");
    expect(summary.metrics.every((m) => m.verdict === "Blocked")).toBe(true);
    expect(summary.caveats.join(" ")).toMatch(/at least 3 counted runs/);
  });

  it("is Blocked overall when every metric is Blocked", () => {
    const empty = () => save({ count: 3000 });
    const summary = summarise(
      "mods-scroll",
      [empty(), empty(), empty()],
      [empty(), empty(), empty()],
    );
    expect(summary.verdict).toBe("Blocked");
  });

  it("rounds medians, ranges and percentages to one decimal place", () => {
    const summary = summarise(
      "mods-scroll",
      files([100.04, 100.06, 100.14]),
      files([200.26, 200.31, 200.44]),
    );
    expect(summary.metrics[0]!.a).toEqual({ count: 3, median: 100.1, min: 100, max: 100.1 });
    expect(summary.metrics[0]!.b).toEqual({ count: 3, median: 200.3, min: 200.3, max: 200.4 });
    // From the shown medians: (200.3 − 100.1) / 100.1 × 100 = 100.0999… → 100.1 (the raw
    // medians 100.06 and 200.31 would give 100.2, which the table could not reproduce).
    expect(summary.metrics[0]!.differencePercent).toBe(100.1);
    expect(formatMarkdown(summary)).toContain("| A | 100.1 | 100.0 | 100.1 | 3 |  |  |");
    expect(formatMarkdown(summary)).toContain(
      "| B | 200.3 | 200.3 | 200.4 | 3 | +100.1% | Slower |",
    );
  });

  it("decides verdicts from the rounded minimum and maximum the table shows", () => {
    // Raw values do not overlap (B's 9.96 is below A's 10.04), but both show as 10.0.
    expect(metricVerdict([10.04, 10.1, 10.2], [9.96, 9.9, 9.8])).toBe("No clear difference");
    expect(metricVerdict([9.8, 9.9, 9.96], [10.04, 10.1, 10.2])).toBe("No clear difference");
    const summary = summarise("mods-scroll", files([10.04, 10.1, 10.2]), files([9.96, 9.9, 9.8]));
    const gap = summary.metrics[0]!;
    expect(gap.a.min).toBe(10);
    expect(gap.b!.max).toBe(10);
    expect(gap.verdict).toBe("No clear difference");
    expect(summary.verdict).toBe("No clear difference");
  });

  it("lists every run's evidence and its budget failures", () => {
    const failing = save({ ...modsScroll(130), failures: ["wheel scrolling froze for 400ms"] });
    const summary = summarise("mods-scroll", files([100, 110, 120]), [
      failing,
      ...files([140, 150]),
    ]);
    expect(summary.b![0]).toEqual({ file: failing, failures: ["wheel scrolling froze for 400ms"] });
    const markdown = formatMarkdown(summary);
    expect(markdown).toContain(
      `- B: \`${failing}\`\n  - budget failure: wheel scrolling froze for 400ms`,
    );
    for (const heading of ["## Results", "## Verdict", "## Evidence", "## Caveats"])
      expect(markdown).toContain(heading);
    expect(summary.caveats.join(" ")).toMatch(/about 10\.0% of cases per metric/);
  });

  it("prints the overall verdict, then a line per metric", () => {
    const summary = summarise("mods-scroll", files([100, 110, 120]), files([50, 60, 70]));
    const lines = formatSummary(summary).split("\n");
    expect(lines[0]).toBe("Verdict: Faster");
    expect(lines[1]).toBe(
      "wheel.maxFrameGapMs: Faster; median A 110.0 (100.0–120.0, n=3), B 60.0 (50.0–70.0, n=3), -45.5%",
    );
    expect(lines).toHaveLength(1 + METRICS["mods-scroll"]!.length);
  });
});

describe("one-sided perf-summary (measure)", () => {
  it("has no verdict, no difference column and no overall verdict line", () => {
    const summary = summarise("mods-scroll", files([100, 110, 120]));
    expect(summary.verdict).toBeUndefined();
    expect(summary.b).toBeUndefined();
    expect(summary.metrics[0]).toEqual({
      path: "wheel.maxFrameGapMs",
      unit: "ms",
      a: { count: 3, median: 110, min: 100, max: 120 },
    });
    const markdown = formatMarkdown(summary);
    expect(markdown).not.toContain("## Verdict");
    expect(markdown).not.toContain("Difference");
    expect(markdown).toContain("| Build | Median | Min | Max | Values |");
    expect(formatSummary(summary)).not.toMatch(/Verdict/);
    expect(formatSummary(summary).split("\n")[0]).toBe(
      "wheel.maxFrameGapMs: median 110.0 (100.0–120.0, n=3)",
    );
  });
});

describe("every check's metric paths", () => {
  // Shapes the five e2e scripts write (harness/src/tests/<check>.e2e.ts).
  const shapes: Record<string, (v: number) => unknown> = {
    "mods-scroll": (v) => modsScroll(v),
    "large-library": (v) => ({
      count: 3000,
      layout: "modern",
      rows: { total: 3000 },
      filter: { elapsedMs: v, blockedMs: v, longestMs: v },
      clear: { elapsedMs: v, blockedMs: v, longestMs: v },
      installs: { count: 10, wallMs: v, longTasks: 2, longestMs: v },
      deployMs: { onMods: v, classicBaseline: v, ratio: 1 },
      failures: [],
    }),
    "collection-scale": (v) => {
      const phase = {
        wallMs: v,
        longestFreezeMs: v,
        longTasks: { count: 1, totalMs: v, maxMs: v },
      };
      return { members: 2000, wallMs: v, phases: { install: phase, update: phase }, failures: [] };
    },
    "download-churn": (v) => ({
      downloads: 4,
      seconds: 30,
      wallMs: v,
      persistDiffs: { count: 10, operations: 20, byHive: {}, perMinute: v },
      slowWrites: { count: 1, totalMs: v, maxMs: v },
      dispatches: { count: 100, totalMs: v },
      longTasks: { count: 1, totalMs: v, maxMs: v },
    }),
    "plugins-page": (v) => ({
      plugins: 500,
      scroll: { elapsedMs: v, blockedMs: v, longestMs: v },
      filter: { elapsedMs: v, blockedMs: v, longestMs: v },
      clear: { elapsedMs: v, blockedMs: v, longestMs: v },
      toggle: { elapsedMs: v, blockedMs: v, longestMs: v },
      failures: [],
    }),
  };

  it("covers exactly the five checks", () => {
    expect(Object.keys(METRICS).sort()).toEqual(Object.keys(shapes).sort());
  });

  it.each(Object.keys(shapes))("reads every %s metric", (check) => {
    const make = shapes[check]!;
    const summary = summarise(check, files([10, 20, 30], make), files([40, 50, 60], make));
    for (const metric of summary.metrics) {
      expect(metric.a, metric.path).toEqual({ count: 3, median: 20, min: 10, max: 30 });
      expect(metric.verdict, metric.path).toBe("Slower");
    }
    expect(summary.verdict).toBe("Slower");
  });

  it("names download-churn's persistDiffs.perMinute per minute", () => {
    const perMinute = METRICS["download-churn"]!.find((m) => m.path === "persistDiffs.perMinute");
    expect(perMinute?.unit).toBe("per minute");
  });
});

describe("the command", () => {
  it("writes the report to --out and prints the summary, or JSON with --json", () => {
    const out = path.join(temp, "reports", "report.md");
    const a = files([100, 110, 120]);
    const b = files([50, 60, 70]);
    const printed = perfSummaryCommand({ check: "mods-scroll", out }, { a, b });
    expect(printed.split("\n")[0]).toBe("Verdict: Faster");
    expect(fs.readFileSync(out, "utf8")).toBe(formatMarkdown(summarise("mods-scroll", a, b)));
    const json = JSON.parse(perfSummaryCommand({ check: "mods-scroll", json: true }, { a, b }));
    expect(json.verdict).toBe("Faster");
  });

  it("refuses a missing or unknown check, no A files and unreadable evidence", () => {
    expect(() => perfSummaryCommand({}, { a: files([1]) })).toThrow(/needs --check/);
    expect(() => summarise("startup", files([1]))).toThrow(/Unknown check "startup"/);
    expect(() => summarise("mods-scroll", [])).toThrow(/at least one --a/);
    const bad = path.join(temp, "bad.json");
    fs.writeFileSync(bad, "{ nope");
    expect(() => summarise("mods-scroll", [bad])).toThrow(/bad\.json: not readable evidence JSON/);
  });
});
