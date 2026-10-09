import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createSession, type BenchmarkSession } from "./session";
import {
  BenchmarkBlocked,
  type Benchmark,
  type BenchmarkResult,
  type RunManifest,
  type RepeatResult,
} from "./types";
import { regression, summarise } from "./timing";
import { vortexCollectionGameId } from "../src/collectionIdentity";

export function defineBenchmark(benchmark: Benchmark): Benchmark {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(benchmark.id))
    throw new Error("Benchmark id must contain letters, digits, dots, hyphens or underscores");
  if (!benchmark.name.trim()) throw new Error("Benchmark name required");
  return benchmark;
}
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
export function validateManifest(manifest: RunManifest, dataset: "real" | "synthetic"): void {
  if (!manifest.profile)
    throw new BenchmarkBlocked(
      "Declare hardware, storage, bandwidth, account, OS/security and installer Vortex build in manifest.profile",
    );
  for (const [field, value] of Object.entries(manifest.profile))
    if (
      typeof value !== "string" ||
      !value.trim() ||
      /\bTBD\b|unclassified|unspecified/i.test(value)
    )
      throw new BenchmarkBlocked(
        `manifest.profile.${field} is undecided; record the actual run profile before publishing benchmark comparisons`,
      );
  if (dataset === "real") {
    const collection = manifest.collection;
    if (!collection)
      throw new BenchmarkBlocked(
        "No pinned real collection configured; proposal candidates still require agreement",
      );
    const match =
      /^(?:https:\/\/(?:next\.|www\.)?nexusmods\.com\/(?:games\/)?|nxm:\/\/)([a-z0-9]+)\/collections\/[a-z0-9_-]+\/revisions\/([1-9]\d*)\/?(?:[?#].*)?$/i.exec(
        collection.url,
      );
    if (!match || vortexCollectionGameId(match[1]!) !== collection.gameId)
      throw new BenchmarkBlocked(
        "Real collection URL must pin a positive revision for the configured gameId",
      );
    if (
      !collection.engine.trim() ||
      /\bTBD\b/i.test(collection.engine) ||
      !Number.isInteger(collection.expectedMods) ||
      collection.expectedMods < 1
    )
      throw new BenchmarkBlocked(
        "Confirm collection engine and mod count; no proposal placeholders accepted",
      );
    if (
      collection.allowGameFixtureCopy !== true ||
      !collection.gameFixture ||
      !collection.authCache ||
      !collection.ready
    )
      throw new BenchmarkBlocked(
        "Configure private game fixture, copy opt-in, OAuth cache and game-specific ready observable",
      );
    if (collection.dedicatedWindowsAccount !== true)
      throw new BenchmarkBlocked(
        "Declare collection.dedicatedWindowsAccount:true only when using a QA-only Windows account/test machine; stock per-user game folder isolation cannot be guaranteed",
      );
    if (manifest.profile.account !== "premium")
      throw new BenchmarkBlocked(
        "Unattended real collection baseline requires an authenticated Premium account",
      );
  }
  for (const budget of Object.values(manifest.budgets ?? {})) regression(0, budget);
}

/** Separate export permits meaningful runner tests without launching Vortex. */
export async function executeBenchmarks(
  options: RunOptions,
  sessionFactory: typeof createSession,
): Promise<BenchmarkResult[]> {
  const repeats = options.repeats ?? 3;
  if (!Number.isInteger(repeats) || repeats < 1)
    throw new Error("repeats must be a positive integer");
  const ids = options.benchmarks.map((b) => b.id);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate benchmark ids");
  for (const id of options.select ?? [])
    if (!ids.includes(id)) throw new Error(`Unknown selected benchmark: ${id}`);
  if (options.benchmarks.length === 0 || options.select?.length === 0)
    throw new Error("Select at least one benchmark; an empty run is not verification");
  const results: BenchmarkResult[] = [];
  for (const benchmark of options.benchmarks.filter(
    (b) => !options.select || options.select.includes(b.id),
  )) {
    const result: BenchmarkResult = {
      id: benchmark.id,
      name: benchmark.name,
      dataset: benchmark.dataset,
      status: "passed",
      repeats: [],
      summary: {},
      regressions: [],
    };
    for (let repeat = 1; repeat <= repeats; repeat++) {
      const row: RepeatResult = {
        warnings: [],
        repeat,
        status: "passed",
        measurements: [],
        phases: [],
        exclusions: [],
        evidence: [],
      };
      let session: BenchmarkSession | undefined;
      try {
        validateManifest(options.manifest, benchmark.dataset);
        session = await sessionFactory({
          manifest: options.manifest,
          dataset: benchmark.dataset,
          outputDir: options.outputDir,
          cleanStart: benchmark.dataset === "real" ? options.cleanStart : undefined,
        });
        await benchmark.run(session);
        if (session.measurements.length === 0)
          throw new Error("Benchmark produced no verified measurements");
      } catch (error) {
        row.status = error instanceof BenchmarkBlocked ? "blocked" : "failed";
        row.reason = error instanceof Error ? error.message : String(error);
      } finally {
        if (session) {
          row.measurements = [...session.measurements];
          row.phases = [...session.phases];
          row.exclusions = [...session.exclusions];
          row.evidence = [...session.evidence];
          row.warnings = [...(session.warnings ?? [])];
          try {
            await session.close(row.status !== "passed");
          } catch (error) {
            row.status = "failed";
            row.reason = `${row.reason ?? ""} Cleanup: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
      }
      result.repeats.push(row);
      // Repeats collect successful samples; they must never retry a failed case.
      if (row.status !== "passed") break;
    }
    result.status = result.repeats.some((r) => r.status === "failed")
      ? "failed"
      : result.repeats.some((r) => r.status === "blocked")
        ? "blocked"
        : "passed";
    if (result.status === "passed") {
      try {
        const names = result.repeats[0]!.measurements.map((m) => m.name);
        const signature = JSON.stringify([...names].sort());
        if (
          result.repeats.some(
            (row) => JSON.stringify(row.measurements.map((m) => m.name).sort()) !== signature,
          )
        )
          throw new Error(`Inconsistent repeat measurement names for ${benchmark.id}`);
        for (const name of names) {
          const samples = result.repeats.map(
            (row) => row.measurements.find((m) => m.name === name)?.activeMs,
          );
          if (samples.some((value) => value === undefined))
            throw new Error(`Inconsistent repeat measurements for ${benchmark.id}.${name}`);
          result.summary[name] = summarise(samples as number[]);
          const budget = options.manifest.budgets?.[`${benchmark.id}.${name}`];
          if (budget && regression(result.summary[name]!.medianMs, budget))
            result.regressions.push(`${benchmark.id}.${name}`);
          for (const metric of [
            "inputDelayMs",
            "blockedMs",
            "worstTaskMs",
            "worstFrameMs",
          ] as const) {
            const values = result.repeats.map(
              (row) => row.measurements.find((m) => m.name === name)?.[metric],
            );
            if (values.every((value) => typeof value === "number")) {
              const key = `${name}.${metric}`;
              result.summary[key] = summarise(values as number[]);
              const limit = options.manifest.budgets?.[`${benchmark.id}.${key}`];
              if (limit && regression(result.summary[key]!.medianMs, limit))
                result.regressions.push(`${benchmark.id}.${key}`);
            }
          }
        }
        for (const key of Object.keys(options.manifest.budgets ?? {}))
          if (
            key.startsWith(`${benchmark.id}.`) &&
            !result.summary[key.slice(benchmark.id.length + 1)]
          )
            throw new BenchmarkBlocked(
              `Budgeted metric ${key} was not captured in every repeat; no passing comparison can be made`,
            );
        if (result.regressions.length) result.status = "failed";
      } catch (error) {
        result.status = error instanceof BenchmarkBlocked ? "blocked" : "failed";
        result.summary = {};
        const last = result.repeats.at(-1)!;
        last.status = result.status;
        last.reason = error instanceof Error ? error.message : String(error);
      }
    }
    results.push(result);
  }
  fs.mkdirSync(options.outputDir, { recursive: true });
  // Credentials and private fixture paths never enter the serialised manifest.
  const {
    authCache: _auth,
    gameFixture: _fixture,
    ...collection
  } = options.manifest.collection ?? {};
  const report = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    kind:
      repeats === 3 ? "three-repeat benchmark" : "exploratory smoke (not a three-repeat baseline)",
    host: {
      platform: os.platform(),
      release: os.release(),
      cpu: os.cpus()[0]?.model,
      memoryBytes: os.totalmem(),
    },
    manifest: {
      ...options.manifest,
      collection: options.manifest.collection ? collection : undefined,
    },
    results,
  };
  fs.writeFileSync(
    path.join(options.outputDir, "results.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return results;
}
export async function runBenchmarks(options: RunOptions): Promise<BenchmarkResult[]> {
  const results = await executeBenchmarks(options, createSession);
  if (results.some((result) => result.status !== "passed"))
    throw new Error(
      `Benchmark run contains failed or blocked results; inspect ${path.resolve(options.outputDir, "results.json")}`,
    );
  return results;
}
