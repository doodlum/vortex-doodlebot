import type { Exclusion } from "./types";

/** Clip, sort and merge exclusions: concurrent prompts and pauses count only once. */
export function excludedDuration(
  start: number,
  end: number,
  intervals: readonly Exclusion[],
): number {
  if (![start, end].every(Number.isFinite) || end < start) throw new Error("Invalid timing window");
  const clipped = intervals
    .map((i) => {
      if (![i.start, i.end].every(Number.isFinite) || i.end < i.start)
        throw new Error("Invalid exclusion");
      return { start: Math.max(start, i.start), end: Math.min(end, i.end) };
    })
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  let total = 0;
  let cursor = start;
  for (const i of clipped) {
    total += Math.max(0, i.end - Math.max(cursor, i.start));
    cursor = Math.max(cursor, i.end);
  }
  return total;
}

export function summarise(samples: readonly number[]) {
  if (samples.length === 0 || samples.some((n) => !Number.isFinite(n) || n < 0))
    throw new Error("Expected finite nonnegative samples");
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const medianMs =
    sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  return {
    samples: samples.length,
    medianMs,
    minMs: sorted[0]!,
    maxMs: sorted.at(-1)!,
    spreadMs: sorted.at(-1)! - sorted[0]!,
  };
}

export function regression(
  medianMs: number,
  budget: { maxMs?: number; baselineMs?: number; maxSlowdownPercent?: number },
): boolean {
  for (const value of Object.values(budget))
    if (!Number.isFinite(value) || value < 0)
      throw new Error("Budgets must be nonnegative finite values");
  if (budget.maxSlowdownPercent !== undefined && budget.baselineMs === undefined)
    throw new Error("A slowdown budget requires a baseline");
  return (
    (budget.maxMs !== undefined && medianMs > budget.maxMs) ||
    (budget.baselineMs !== undefined &&
      budget.maxSlowdownPercent !== undefined &&
      medianMs > budget.baselineMs * (1 + budget.maxSlowdownPercent / 100))
  );
}
