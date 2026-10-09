import fs from "node:fs/promises";
import path from "node:path";
import { runBenchmarks } from "../harness/benchmarks/index";
import type { BenchmarkResult, RunManifest } from "../harness/benchmarks/index";
import type { BenchmarkGroup } from "./types";

export interface SuiteOptions {
  groups: readonly BenchmarkGroup[];
  outputDir: string;
  repeats: number;
  label: string;
}

function publicManifest(manifest: RunManifest): unknown {
  if (!manifest.collection) return manifest;
  const { authCache: _authCache, gameFixture: _gameFixture, ...collection } = manifest.collection;
  return { ...manifest, collection };
}

function redactReason(reason: string, manifest: RunManifest): string {
  let result = reason;
  for (const privatePath of [manifest.collection?.authCache, manifest.collection?.gameFixture]) {
    if (privatePath) result = result.split(privatePath).join("[private prerequisite path]");
  }
  return result;
}

function incompleteResults(
  group: BenchmarkGroup,
  repeats: number,
  status: "blocked" | "failed",
  reason: string,
): BenchmarkResult[] {
  return group.cases.map((item) => ({
    id: item.id,
    name: item.name,
    dataset: item.dataset,
    status,
    repeats: Array.from({ length: repeats }, (_, index) => ({
      repeat: index + 1,
      status,
      reason,
      measurements: [],
      phases: [],
      exclusions: [],
      evidence: [],
      warnings: [],
    })),
    summary: {},
    regressions: [],
  }));
}

/** Run groups sequentially and preserve every group's report before marking failure. */
export async function runSuite(options: SuiteOptions): Promise<boolean> {
  if (options.groups.length === 0 || options.groups.every((group) => group.cases.length === 0))
    throw new Error("Select at least one benchmark; an empty suite is not verification");
  if (!Number.isInteger(options.repeats) || options.repeats < 1)
    throw new Error("Repeats must be a positive integer");
  await fs.mkdir(options.outputDir, { recursive: true });
  const seen = new Set<string>();
  const groups = options.groups.map((group) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(group.id) || seen.has(group.id))
      throw new Error("Group IDs must be unique simple names");
    seen.add(group.id);
    return {
      id: group.id,
      report: `${group.id}/results.json`,
      incomplete: true,
      status: "pending",
    };
  });
  const indexPath = path.join(options.outputDir, "suite.json");
  await fs.writeFile(
    indexPath,
    JSON.stringify(
      {
        label: options.label,
        repeats: options.repeats,
        inProgress: true,
        incomplete: true,
        groups,
      },
      null,
      2,
    ),
  );
  let incomplete = false;
  for (const group of options.groups) {
    const outputDir = path.join(options.outputDir, group.id);
    const reportPath = path.join(outputDir, "results.json");
    await fs.mkdir(outputDir, { recursive: true });
    let groupIncomplete = false;
    if (group.missing) {
      groupIncomplete = true;
      await fs.writeFile(
        reportPath,
        JSON.stringify(
          {
            label: options.label,
            manifest: publicManifest(group.manifest),
            results: incompleteResults(group, options.repeats, "blocked", group.missing),
          },
          null,
          2,
        ),
      );
      console.error(`${group.id}: blocked: ${group.missing}`);
    } else {
      // Replace an older report before launch; an interrupted new run must not
      // accidentally present a stale success from the same output directory.
      await fs.writeFile(
        reportPath,
        JSON.stringify(
          {
            label: options.label,
            inProgress: true,
            manifest: publicManifest(group.manifest),
            results: incompleteResults(
              group,
              options.repeats,
              "failed",
              "Run started but did not finish reporting",
            ),
          },
          null,
          2,
        ),
      );
      try {
        const results = await runBenchmarks({
          benchmarks: group.cases,
          manifest: group.manifest,
          repeats: options.repeats,
          outputDir,
        });
        groupIncomplete = results.some((item) => item.status !== "passed");
      } catch (error) {
        groupIncomplete = true;
        const reason = redactReason(
          error instanceof Error ? error.message : String(error),
          group.manifest,
        );
        console.error(`${group.id}: ${reason}`);
        // The SDK normally writes before throwing. Retain it unchanged. If it did
        // not reach reporting, preserve an explicit failed operation report too.
        try {
          const report = JSON.parse(await fs.readFile(reportPath, "utf8")) as {
            results?: unknown;
            inProgress?: boolean;
          };
          if (report.inProgress || !Array.isArray(report.results))
            throw new Error("No completed result array");
        } catch {
          await fs.writeFile(
            reportPath,
            JSON.stringify(
              {
                label: options.label,
                manifest: publicManifest(group.manifest),
                results: incompleteResults(group, options.repeats, "failed", reason),
              },
              null,
              2,
            ),
          );
        }
      }
    }
    await fs.writeFile(
      path.join(outputDir, "run-info.json"),
      JSON.stringify(
        {
          label: options.label,
          repeats: options.repeats,
          selected: group.cases.map((item) => item.id),
        },
        null,
        2,
      ),
    );
    Object.assign(
      groups.find((item) => item.id === group.id)!,
      {
        incomplete: groupIncomplete,
        status: "completed",
      },
    );
    incomplete ||= groupIncomplete;
    // Keep a usable index even if a later group is interrupted externally.
    const inProgress = groups.some((item) => item.status === "pending");
    await fs.writeFile(
      indexPath,
      JSON.stringify(
        {
          label: options.label,
          repeats: options.repeats,
          inProgress,
          incomplete: incomplete || inProgress,
          groups,
        },
        null,
        2,
      ),
    );
  }
  console.log(`Reports: ${options.outputDir}`);
  return !incomplete;
}
