import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCatalog } from "./catalog";
import { configuration, exploratoryManifest } from "./config";
import { realCollection } from "./collections";
import { runSuite } from "./runner";
import type { BenchmarkGroup, Session } from "./types";

const { runBenchmarks } = vi.hoisted(() => ({ runBenchmarks: vi.fn() }));
vi.mock("../harness/benchmarks/index", async (original) => ({
  ...(await original<object>()),
  runBenchmarks,
}));
const owned: string[] = [];
async function workspace() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "doodlebot-suite-control-"));
  owned.push(directory);
  return directory;
}
const manifest = exploratoryManifest();
function group(id: string): BenchmarkGroup {
  return {
    id,
    manifest,
    cases: [{ id: `${id}-case`, name: id, dataset: "synthetic", run: async () => {} }],
  };
}
afterEach(async () => {
  runBenchmarks.mockReset();
  for (const directory of owned.splice(0)) {
    if (
      path.dirname(directory) !== os.tmpdir() ||
      !path.basename(directory).startsWith("doodlebot-suite-control-")
    )
      throw new Error("Unexpected control workspace");
    await fs.rm(directory, { recursive: true, force: true });
  }
});
describe("proposal suite evidence", () => {
  it.each(["before", "after"])(
    "fails collection startup when functional readiness is lost %s restart",
    async (boundary) => {
      const collection = realCollection("C1", {
        authCache: "unit-auth-path",
        gameFixture: "unit-game-path",
        allowGameFixtureCopy: true,
        dedicatedWindowsAccount: true,
        ready: { gameFiles: ["SkyrimSE.exe"], equals: true },
      });
      const catalog = buildCatalog({
        ...configuration,
        collections: { C1: collection },
      });
      const startup = catalog
        .flatMap((entry) => entry.cases)
        .find((entry) => entry.id === "B5-C1")!;
      const restartToMods = vi.fn(async () => undefined);
      const verifyReady = vi.fn(async () => undefined);
      const failure = new Error("Required game file missing");
      if (boundary === "before") verifyReady.mockRejectedValueOnce(failure);
      else verifyReady.mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure);
      const session = {
        addCollection: vi.fn(async () => undefined),
        deploy: vi.fn(async () => undefined),
        restartToMods,
        verifyReady,
      } as unknown as Session;
      await expect(startup.run(session)).rejects.toThrow("Required game file missing");
      expect(restartToMods).toHaveBeenCalledTimes(boundary === "before" ? 0 : 1);
    },
  );
  it("rejects empty work instead of reporting success", async () => {
    await expect(
      runSuite({ groups: [], repeats: 3, outputDir: await workspace(), label: "empty" }),
    ).rejects.toThrow("empty suite");
    expect(runBenchmarks).not.toHaveBeenCalled();
  });
  it("retains missing T4 coverage as named blocked cases", async () => {
    const catalog = buildCatalog({
      ...configuration,
      localManifest: manifest,
      background: { workloads: [] },
    });
    const missing = catalog.filter(({ id }) => id.startsWith("T4-"));
    expect(missing.flatMap(({ cases }) => cases.map(({ id }) => id))).toEqual([
      "T4-background-150",
      "T4-background-570",
      "T4-background-1594",
      "T4-background-2685",
    ]);
    const outputDir = await workspace();
    expect(
      await runSuite({ groups: missing, outputDir, repeats: 3, label: "missing fixture" }),
    ).toBe(false);
    const report = JSON.parse(
      await fs.readFile(path.join(outputDir, "T4-150/results.json"), "utf8"),
    );
    expect(report.results[0].status).toBe("blocked");
    expect(report.results[0].summary).toEqual({});
    expect(runBenchmarks).not.toHaveBeenCalled();
  });
  it("replaces old success before launch and stays incomplete until every group finishes", async () => {
    const outputDir = await workspace();
    const index = path.join(outputDir, "suite.json");
    await fs.writeFile(index, JSON.stringify({ label: "old", incomplete: false }));
    runBenchmarks
      .mockImplementationOnce(async () => {
        const current = JSON.parse(await fs.readFile(index, "utf8"));
        expect(current).toMatchObject({ label: "new", inProgress: true, incomplete: true });
        expect(current.groups.map((item: { status: string }) => item.status)).toEqual([
          "pending",
          "pending",
        ]);
        return [];
      })
      .mockImplementationOnce(async () => {
        const current = JSON.parse(await fs.readFile(index, "utf8"));
        expect(current).toMatchObject({ inProgress: true, incomplete: true });
        expect(current.groups.map((item: { status: string }) => item.status)).toEqual([
          "completed",
          "pending",
        ]);
        throw new Error("Operation interrupted before reporting");
      });
    expect(
      await runSuite({
        groups: [group("first"), group("second")],
        outputDir,
        repeats: 1,
        label: "new",
      }),
    ).toBe(false);
    const current = JSON.parse(await fs.readFile(index, "utf8"));
    expect(current).toMatchObject({ inProgress: false, incomplete: true });
    const report = JSON.parse(
      await fs.readFile(path.join(outputDir, "second/results.json"), "utf8"),
    );
    expect(report.results[0].status).toBe("failed");
    expect(report.results[0].repeats[0].reason).toContain("interrupted");
  });
});
