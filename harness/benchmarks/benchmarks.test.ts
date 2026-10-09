import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { excludedDuration, regression, summarise } from "./timing";
import { defineBenchmark, executeBenchmarks, validateManifest } from "./runner";
import { BenchmarkBlocked, type RunManifest } from "./types";
import { CollectionRecorder } from "./collectionEvents";
import { assertInside, type BenchmarkSession, type createSession } from "./session";
import { BenchmarkSession as Session } from "./session";
import { runInSession } from "./lifecycle";
import type { HarnessConfig } from "../src/config";
import type { VortexInstance } from "../src/instance";
import type { RendererHandle } from "../src/cdp";
import { BenchmarkTable } from "./tables";

const manifest: RunManifest = {
  profile: {
    hardware: "test supplied CPU",
    storage: "test supplied disk",
    bandwidth: "local-only",
    account: "anonymous",
    osSecurity: "test supplied OS",
    vortexBuild: "test supplied installer",
  },
  synthetic: { count: 8 },
};
const outputRoot = path.resolve("harness/.artifacts/benchmark-unit-fixtures/benchmark-controls");
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("measurement arithmetic", () => {
  it("clips and unions overlapping pauses and user waits without adding overlapping phases", () => {
    const exclusions = [
      { reason: "pause" as const, start: -10, end: 20 },
      { reason: "user-wait" as const, start: 10, end: 50 },
      { reason: "pause" as const, start: 40, end: 60 },
      { reason: "pause" as const, start: 90, end: 150 },
    ];
    expect(excludedDuration(0, 100, exclusions)).toBe(70);
    expect(excludedDuration(25, 75, exclusions)).toBe(35);
    expect(excludedDuration(100, 120, exclusions)).toBe(20);
  });
  it("reports median and complete spread for three noisy repeats", () => {
    expect(summarise([10, 40, 20])).toEqual({
      samples: 3,
      medianMs: 20,
      minMs: 10,
      maxMs: 40,
      spreadMs: 30,
    });
  });
  it("has no implicit regression target and validates explicit budget inputs", () => {
    expect(regression(50_000, {})).toBe(false);
    expect(regression(121, { baselineMs: 100, maxSlowdownPercent: 20 })).toBe(true);
    expect(regression(120, { baselineMs: 100, maxSlowdownPercent: 20 })).toBe(false);
    expect(() => regression(1, { maxSlowdownPercent: 20 })).toThrow("baseline");
    expect(() => regression(1, { maxMs: NaN })).toThrow("finite");
  });
  it("refuses invalid clocks and traversal/linked fixture boundaries", () => {
    expect(() => excludedDuration(4, 1, [])).toThrow("timing window");
    expect(() => assertInside(outputRoot, path.dirname(outputRoot))).toThrow("outside");
    expect(() => assertInside(outputRoot, outputRoot)).toThrow("outside");
  });
});
describe("runner evidence contract", () => {
  function factory(samples: number[], close = vi.fn(async () => undefined)) {
    let index = 0;
    return {
      close,
      create: vi.fn(
        async () =>
          ({
            measurements: [
              {
                name: "action",
                wallMs: samples[index]!,
                excludedMs: 0,
                activeMs: samples[index++]!,
              },
            ],
            phases: [],
            exclusions: [],
            evidence: [],
            close,
          }) as unknown as BenchmarkSession,
      ) as typeof createSession,
    };
  }
  const benchmark = defineBenchmark({
    id: "smoke",
    name: "Meaningful input",
    dataset: "synthetic",
    run: async () => undefined,
  });
  it("runs three fresh sessions, verifies cleanup and publishes median/min/max/spread", async () => {
    const fake = factory([40, 10, 20]);
    const results = await executeBenchmarks(
      { benchmarks: [benchmark], manifest, outputDir: path.join(outputRoot, "three") },
      fake.create,
    );
    expect(fake.create).toHaveBeenCalledTimes(3);
    expect(fake.close).toHaveBeenCalledTimes(3);
    expect(results[0]!.summary.action!.medianMs).toBe(20);
    expect(results[0]!.summary.action!.spreadMs).toBe(30);
    expect(results[0]!.status).toBe("passed");
  });
  it("blocks undecided profiles before launching and never aggregates partial measurements", async () => {
    const fake = factory([1]);
    const results = await executeBenchmarks(
      {
        benchmarks: [benchmark],
        manifest: { ...manifest, profile: { ...manifest.profile, hardware: "TBD" } },
        outputDir: path.join(outputRoot, "blocked"),
      },
      fake.create,
    );
    expect(fake.create).not.toHaveBeenCalled();
    expect(results[0]!.status).toBe("blocked");
    expect(results[0]!.summary).toEqual({});
    expect(results[0]!.repeats).toHaveLength(1);
  });
  it("a correctness failure preserves fixtures and suppresses an apparently fast summary", async () => {
    const fake = factory([1]);
    const broken = defineBenchmark({
      ...benchmark,
      run: async () => {
        throw new Error("Toggle did not change enabled state");
      },
    });
    const results = await executeBenchmarks(
      { benchmarks: [broken], manifest, outputDir: path.join(outputRoot, "failed"), repeats: 3 },
      fake.create,
    );
    expect(fake.close).toHaveBeenCalledWith(true);
    expect(results[0]!.status).toBe("failed");
    expect(results[0]!.summary).toEqual({});
    expect(results[0]!.repeats).toHaveLength(1);
    expect(fake.create).toHaveBeenCalledOnce();
  });
  it("a failed shutdown cannot return a passing result", async () => {
    const fake = factory(
      [1],
      vi.fn(async () => {
        throw new Error("process alive");
      }),
    );
    const results = await executeBenchmarks(
      {
        benchmarks: [benchmark],
        manifest,
        outputDir: path.join(outputRoot, "cleanup"),
        repeats: 1,
      },
      fake.create,
    );
    expect(results[0]!.status).toBe("failed");
    expect(results[0]!.repeats[0]!.reason).toContain("process alive");
  });
  it("rejects empty selections and excludes credentials from saved reports", async () => {
    const fake = factory([1]);
    await expect(
      executeBenchmarks(
        { benchmarks: [benchmark], manifest, outputDir: outputRoot, select: [] },
        fake.create,
      ),
    ).rejects.toThrow("at least one");
    const withSecrets = {
      ...manifest,
      collection: {
        url: "not used by synthetic",
        engine: "unassigned",
        gameId: "unused",
        expectedMods: 1,
        authCache: "secret-auth-file",
        gameFixture: "secret-game-path",
        allowGameFixtureCopy: true as const,
        ready: { selector: "body", equals: "ready" },
      },
    };
    await executeBenchmarks(
      {
        benchmarks: [benchmark],
        manifest: withSecrets,
        outputDir: path.join(outputRoot, "secrets"),
        repeats: 1,
      },
      fake.create,
    );
    const report = fs.readFileSync(path.join(outputRoot, "secrets/results.json"), "utf8");
    expect(report).not.toContain("secret-auth-file");
    expect(report).not.toContain("secret-game-path");
    expect(report).toContain("exploratory smoke");
  });
  it("requires a fixed real revision and refuses synthetic provenance to stand in for a real fixture", () => {
    expect(() => validateManifest(manifest, "real")).toThrow(BenchmarkBlocked);
    expect(() =>
      validateManifest(
        {
          ...manifest,
          collection: {
            url: "https://www.nexusmods.com/games/skyrimse/collections/abc",
            gameId: "skyrimse",
            engine: "Creation",
            expectedMods: 150,
            authCache: "private",
            gameFixture: "private",
            allowGameFixtureCopy: true,
            ready: { selector: "body", equals: "ready" },
          },
        },
        "real",
      ),
    ).toThrow("pin");
  });
});
describe("collection event recorder", () => {
  function recorder(warm = false) {
    const session = {
      gameId: "test",
      evidence: [],
      call: vi.fn(async () => ({ entries: [], lastSeq: 0 })),
    } as unknown as BenchmarkSession;
    const recorder = new CollectionRecorder(session, warm);
    const consume = (kind: string, at: number, previous: unknown, current: unknown) =>
      (recorder as unknown as { consume(kind: string, entry: unknown): void }).consume(kind, {
        seq: 1,
        receivedAt: at,
        args: [previous, current],
      });
    return { recorder, consume };
  }
  it("keeps download and install overlapping and timestamped at emission, not poll receipt", async () => {
    const { recorder: r, consume } = recorder();
    vi.spyOn(Date, "now").mockReturnValue(0);
    r.markAdd();
    consume("mods", 10, {}, { collection: { type: "collection", state: "installed" } });
    consume("downloads", 15, {}, { a: { state: "started" } });
    consume("mods", 20, {}, { a: { state: "installing" } });
    consume("downloads", 40, { a: { state: "started" } }, { a: { state: "finished" } });
    consume("mods", 50, { a: { state: "installing" } }, { a: { state: "installed" } });
    consume("will-deploy", 55, null, null);
    consume("did-deploy", 80, null, null);
    await r.stop();
    expect(r.phases.find((e) => e.phase === "download" && e.edge === "end")!.at).toBe(40);
    expect(r.phases.find((e) => e.phase === "install" && e.edge === "start")!.at).toBe(20);
    vi.restoreAllMocks();
  });
  it("never fabricates missing phase completion and detects violated warm preconditions", async () => {
    const cold = recorder();
    await expect(cold.recorder.stop()).rejects.toThrow("Missing valid add");
    const warm = recorder(true);
    vi.spyOn(Date, "now").mockReturnValue(0);
    warm.recorder.markAdd();
    warm.consume("mods", 1, {}, { collection: { type: "collection", state: "installed" } });
    warm.consume("mods", 2, {}, { a: { state: "installing" } });
    warm.consume("mods", 3, { a: { state: "installing" } }, { a: { state: "installed" } });
    warm.consume("will-deploy", 4, null, null);
    warm.consume("did-deploy", 5, null, null);
    warm.consume("downloads", 2, {}, { a: { state: "started" } });
    warm.consume("downloads", 3, { a: { state: "started" } }, { a: { state: "finished" } });
    await expect(warm.recorder.stop()).rejects.toThrow("Warm run downloaded");
    vi.restoreAllMocks();
  });
});

describe("session lifecycle", () => {
  const fake = (close = vi.fn(async () => undefined)) =>
    ({
      config: { cacheDir: path.join(outputRoot, "retained") },
      close,
    }) as unknown as BenchmarkSession;
  it("returns the callback result only after successful cleanup", async () => {
    const close = vi.fn(async () => undefined);
    expect(await runInSession(fake(close), async () => 42)).toBe(42);
    expect(close).toHaveBeenCalledWith(false);
  });
  it("names the retained fixture and keeps the exact callback exception as cause", async () => {
    const original = new Error("Mods control missing");
    const close = vi.fn(async () => undefined);
    try {
      await runInSession(fake(close), async () => {
        throw original;
      });
      throw new Error("Expected rejection");
    } catch (error) {
      expect((error as Error).message).toContain(path.join(outputRoot, "retained"));
      expect((error as Error).cause).toBe(original);
      expect(close).toHaveBeenCalledWith(true);
    }
  });
  it("keeps callback and teardown errors together without masking the callback", async () => {
    const original = new BenchmarkBlocked("Missing plugin table");
    const cleanup = new Error("Vortex still running");
    try {
      await runInSession(
        fake(
          vi.fn(async () => {
            throw cleanup;
          }),
        ),
        async () => {
          throw original;
        },
      );
      throw new Error("Expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toEqual([original, cleanup]);
      expect((error as Error).cause).toBe(original);
      expect((error as Error).message).toContain("Fixture preserved");
    }
  });
  it("preserves blocked classification when teardown succeeds", async () => {
    await expect(
      runInSession(fake(), async () => {
        throw new BenchmarkBlocked("Data unavailable");
      }),
    ).rejects.toBeInstanceOf(BenchmarkBlocked);
  });
  it("preserves a fatal-log fixture even after Vortex exits successfully", async () => {
    const cacheDir = path.join(outputRoot, `doodlebot-benchmark-fatal-${Date.now()}`);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      path.join(cacheDir, "vortex.log"),
      '2026-10-08T12:00:00.000Z [ERRO] [main] unrecoverable error {"error":{"message":"Test fatal failure"}}\n',
    );
    const stop = vi.fn(async () => undefined);
    const handle = { close: vi.fn(async () => undefined) } as unknown as RendererHandle;
    const session = new Session(
      { cacheDir } as HarnessConfig,
      { process: { exitCode: 0, signalCode: null }, stop } as unknown as VortexInstance,
      handle,
      undefined,
      "synthetic",
    );
    await expect(session.close()).rejects.toThrow("Test fatal failure");
    expect(stop).toHaveBeenCalledOnce();
    expect(fs.existsSync(cacheDir)).toBe(true);
  });
  it("still stops the owned process when the renderer connection fails to close", async () => {
    const cacheDir = path.join(outputRoot, `doodlebot-benchmark-close-${Date.now()}`);
    fs.mkdirSync(cacheDir, { recursive: true });
    const stop = vi.fn(async () => undefined);
    const failure = new Error("CDP close failed");
    const handle = {
      close: vi.fn(async () => {
        throw failure;
      }),
    } as unknown as RendererHandle;
    const session = new Session(
      { cacheDir } as HarnessConfig,
      { process: { exitCode: 0, signalCode: null }, stop } as unknown as VortexInstance,
      handle,
      undefined,
      "synthetic",
    );
    await expect(session.close()).rejects.toThrow("CDP close failed");
    expect(stop).toHaveBeenCalledOnce();
    expect(fs.existsSync(cacheDir)).toBe(true);
  });
});

describe("independent review regressions", () => {
  const benchmark = defineBenchmark({
    id: "review",
    name: "Review control",
    dataset: "synthetic",
    run: async () => undefined,
  });
  const fake = (measurements: unknown[]) =>
    ({
      measurements,
      phases: [],
      exclusions: [],
      evidence: [],
      close: vi.fn(async () => undefined),
    }) as unknown as BenchmarkSession;
  it("blocks a requested input-delay budget when the measurement is unavailable", async () => {
    const create = vi.fn(async () =>
      fake([{ name: "input", wallMs: 1, activeMs: 1, excludedMs: 0, inputDelayMs: null }]),
    ) as typeof createSession;
    const result = await executeBenchmarks(
      {
        benchmarks: [benchmark],
        manifest: { ...manifest, budgets: { "review.input.inputDelayMs": { maxMs: 200 } } },
        outputDir: path.join(outputRoot, "missing-budget"),
        repeats: 1,
      },
      create,
    );
    expect(result[0]!.status).toBe("blocked");
    expect(result[0]!.summary).toEqual({});
    expect(result[0]!.repeats[0]!.reason).toContain("not captured");
  });
  it("writes raw evidence when repeat measurement names differ", async () => {
    let repeat = 0;
    const create = vi.fn(async () =>
      fake([{ name: ++repeat === 1 ? "first" : "changed", wallMs: 1, activeMs: 1, excludedMs: 0 }]),
    ) as typeof createSession;
    const outputDir = path.join(outputRoot, "inconsistent");
    const result = await executeBenchmarks(
      { benchmarks: [benchmark], manifest, outputDir, repeats: 2 },
      create,
    );
    expect(result[0]!.status).toBe("failed");
    expect(result[0]!.summary).toEqual({});
    expect(fs.existsSync(path.join(outputDir, "results.json"))).toBe(true);
    expect(result[0]!.repeats).toHaveLength(2);
  });
  it("rejects a final split while another observed member is still downloading", async () => {
    const session = {
      gameId: "test",
      evidence: [],
      call: vi.fn(async () => ({ entries: [], lastSeq: 0 })),
    } as unknown as BenchmarkSession;
    const recorder = new CollectionRecorder(session, false);
    const consume = (kind: string, at: number, previous: unknown, current: unknown) =>
      (recorder as unknown as { consume(kind: string, entry: unknown): void }).consume(kind, {
        seq: 1,
        receivedAt: at,
        args: [previous, current],
      });
    recorder.markAdd();
    consume("downloads", 1, {}, { a: { state: "started" }, b: { state: "started" } });
    consume(
      "downloads",
      2,
      { a: { state: "started" }, b: { state: "started" } },
      { a: { state: "finished" }, b: { state: "started" } },
    );
    await expect(recorder.stop()).rejects.toThrow("remains incomplete");
  });
  it("times the whole callback after deployment while excluding expensive integrity verification", async () => {
    const cacheDir = path.join(outputRoot, `doodlebot-benchmark-timing-${Date.now()}`);
    const gamePath = path.join(cacheDir, "game");
    const staging = path.join(cacheDir, "staging");
    fs.mkdirSync(gamePath, { recursive: true });
    fs.mkdirSync(path.join(staging, "mod"), { recursive: true });
    fs.writeFileSync(path.join(gamePath, "test.txt"), "same bytes");
    fs.writeFileSync(path.join(staging, "mod/test.txt"), "same bytes");
    fs.writeFileSync(
      path.join(gamePath, "vortex.deployment.json"),
      JSON.stringify({
        targetPath: gamePath,
        stagingPath: staging,
        files: [{ relPath: "test.txt", source: "mod" }],
      }),
    );
    let clock = 100;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    vi.doMock("../src/deployment", () => ({
      deployMods: async (
        _mcp: unknown,
        _game: string,
        options: { onProgress?: (message: string) => void },
      ) => {
        clock = 120;
        options.onProgress?.("deploy finished");
      },
      needsDeployment: async () => false,
    }));
    const read = fs.readFileSync.bind(fs);
    vi.spyOn(fs, "readFileSync").mockImplementation(((
      ...args: Parameters<typeof fs.readFileSync>
    ) => {
      if (String(args[0]).includes(cacheDir)) clock = 10_000;
      return read(...args);
    }) as typeof fs.readFileSync);
    const page = {
      evaluate: vi.fn(async (source: unknown) =>
        typeof source === "string" && source.includes("return {tasks:data.tasks")
          ? { tasks: [], frames: [], inputs: [] }
          : undefined,
      ),
    };
    const session = new Session(
      { cacheDir, gamePath, gameId: "fake" } as HarnessConfig,
      { mcp: {} } as VortexInstance,
      { page } as unknown as RendererHandle,
      undefined,
      "synthetic",
    );
    await session.measure("deploy", () => session.deploy());
    expect(session.measurements[0]!.wallMs).toBe(20);
    expect(clock).toBe(10_000);
    expect(session.evidence).toContainEqual({
      operation: "deploy",
      deployedFilesVerified: 1,
      integrityValidation: "outside timed action window",
    });
    clock = 100;
    await session.measure("deploy-and-ready", async () => {
      await session.deploy();
      clock = 5020;
    });
    expect(session.measurements[1]!.wallMs).toBe(4920);
    expect(clock).toBe(10_000);
    expect(regression(session.measurements[1]!.activeMs, { maxMs: 1000 })).toBe(true);
    fs.writeFileSync(path.join(gamePath, "test.txt"), "different deployed bytes");
    clock = 100;
    await expect(session.measure("corrupt-deploy", () => session.deploy())).rejects.toThrow(
      "Deployment bytes differ",
    );
    expect(session.measurements).toHaveLength(2);
    fs.unlinkSync(path.join(staging, "mod/test.txt"));
    await expect(session.deploy()).rejects.toThrow("ENOENT");
    vi.restoreAllMocks();
    vi.doUnmock("../src/deployment");
  });
  it("allows reopening a populated table while a filter has narrowed it to one or zero rows", async () => {
    let count = 2;
    const page = {
      locator: (selector: string) => ({
        count: async () => (selector === "#table" ? 1 : count),
        waitFor: async () => undefined,
        nth: () => ({ waitFor: async () => undefined }),
      }),
    };
    const session = {
      page,
      openPage: vi.fn(async () => undefined),
      timeoutMs: 100,
    } as unknown as BenchmarkSession;
    const table = new BenchmarkTable(
      session,
      { page: "Mods", root: "#table", rows: "#rows", scroller: "#scroller" },
      "mods",
    );
    await table.open();
    count = 1;
    await table.open();
    count = 0;
    await expect(table.open()).resolves.toBeUndefined();
  });
  it("waits for navigation to render the table before checking uniqueness and population", async () => {
    let rendered = false;
    let populated = false;
    const page = {
      locator: (selector: string) => ({
        count: async () => (selector === "#table" ? Number(rendered) : populated ? 2 : 0),
        waitFor: async () => {
          rendered = true;
        },
        nth: () => ({
          waitFor: async () => {
            populated = true;
          },
        }),
      }),
    };
    const session = {
      page,
      openPage: vi.fn(async () => undefined),
      timeoutMs: 100,
    } as unknown as BenchmarkSession;
    const table = new BenchmarkTable(
      session,
      { page: "Mods", root: "#table", rows: "#rows", scroller: "#scroller" },
      "mods",
    );
    await expect(table.open()).resolves.toBeUndefined();
    expect(rendered && populated).toBe(true);
  });
  it("reserves 150 Downloads with exact watcher paths before writes, tolerating dropped create events", async () => {
    const cacheDir = path.join(outputRoot, `doodlebot-benchmark-downloads-${Date.now()}`);
    const folder = path.join(cacheDir, "downloads");
    const records: Record<string, { localPath: string; state: string; size: number }> = {};
    let clock = Date.now();
    const now = vi.spyOn(Date, "now").mockImplementation(() => clock);
    let writes = 0;
    const nativeWrite = fs.writeFileSync.bind(fs);
    const write = vi.spyOn(fs, "writeFileSync").mockImplementation(((
      ...args: Parameters<typeof fs.writeFileSync>
    ) => {
      nativeWrite(...args);
      if (path.dirname(String(args[0])) !== folder) return;
      expect(Object.keys(records)).toHaveLength(150);
      const name = path.basename(String(args[0]));
      // Model actual released events: some are lost; others check exact localPath.
      if (++writes <= 50) return;
      if (!Object.values(records).some((record) => record.localPath === `${path.sep}${name}`))
        records[`watcher-${name}`] = {
          localPath: `${path.sep}${name}`,
          state: "finished",
          size: fs.statSync(String(args[0])).size,
        };
    }) as typeof fs.writeFileSync);
    const call = vi.fn(async (tool: string, args: Record<string, unknown>) => {
      if (tool === "vortex_dispatch") {
        const [id, , name, size] = args.args as [string, string, string, number];
        records[id] = { localPath: name, state: "finished", size };
        return;
      }
      return args.selector ? folder : records;
    });
    const wait = vi.fn(async () => {
      clock += 100;
    });
    const session = new Session(
      { cacheDir, gameId: "fake" } as HarnessConfig,
      { mcp: { call } } as unknown as VortexInstance,
      { page: { waitForTimeout: wait } } as unknown as RendererHandle,
      undefined,
      "synthetic",
    );
    try {
      await session.seedDownloads(150);
      expect(Object.keys(records)).toHaveLength(150);
      expect(fs.readdirSync(folder)).toHaveLength(150);
      expect(wait).toHaveBeenCalledTimes(10);
      expect(call.mock.calls.filter(([tool]) => tool === "vortex_dispatch")).toHaveLength(150);
    } finally {
      write.mockRestore();
      now.mockRestore();
    }
  });
  it("uses explicit status menu choices and waits for visible state when primary cycling would stay stale", async () => {
    const profile = { id: "profile", modState: { mod: { enabled: true } } };
    let label = "Enabled";
    let menuOpen = false;
    const clicks: string[] = [];
    const locator = (kind: string): unknown => {
      const result = {
        count: async () => 1,
        nth: () => result,
        isVisible: async () => !kind.startsWith("option-") || menuOpen,
        scrollIntoViewIfNeeded: async () => undefined,
        textContent: async () => label,
        locator: (selector: string) =>
          locator(selector.includes("dropdown-toggle") ? "dropdown" : "primary"),
        click: async () => {
          clicks.push(kind);
          if (kind === "dropdown") menuOpen = true;
          else if (kind.startsWith("option-")) {
            profile.modState.mod.enabled = kind === "option-enabled";
            menuOpen = false;
          } else if (kind === "primary") profile.modState.mod.enabled = false;
        },
      };
      return result;
    };
    const wait = vi.fn(async () => {
      label = profile.modState.mod.enabled ? "Enabled" : "Disabled";
    });
    const page = {
      locator: (selector: string) =>
        locator(
          selector.includes(".option-mods-enabled-enabled")
            ? "option-enabled"
            : selector.includes(".option-mods-enabled-disabled")
              ? "option-disabled"
              : "row",
        ),
      waitForTimeout: wait,
    };
    const session = {
      page,
      timeoutMs: 100,
      call: vi.fn(async () => profile),
      measure: async (_name: string, action: () => Promise<void>) => action(),
      evidence: [],
    } as unknown as BenchmarkSession;
    const table = new BenchmarkTable(
      session,
      { page: "Mods", root: "#table", rows: "#rows", scroller: "#scroller" },
      "mods",
    );
    vi.spyOn(table, "open").mockResolvedValue(undefined);
    await table.disable(["mod"]);
    expect(profile.modState.mod.enabled).toBe(false);
    expect(label).toBe("Disabled");
    await table.enable(["mod"]);
    expect(profile.modState.mod.enabled).toBe(true);
    expect(label).toBe("Enabled");
    expect(clicks).toEqual(["dropdown", "option-disabled", "dropdown", "option-enabled"]);
    expect(wait).toHaveBeenCalledTimes(2);
  });
  it.each([
    { initialAscending: false, prime: ["a", "b", "c"], reverse: ["c", "b", "a"], fails: false },
    { initialAscending: true, prime: ["a", "b", "c"], reverse: ["c", "b", "a"], fails: false },
    { initialAscending: false, prime: ["a", "b", "c"], reverse: ["a", "c", "b"], fails: true },
    { initialAscending: false, prime: ["a", "b", "c"], reverse: ["c", "b"], fails: true },
    { initialAscending: false, prime: ["a", "b", "c"], reverse: ["d", "b", "a"], fails: true },
    { initialAscending: false, prime: ["a", "c", "b"], reverse: ["c", "b", "a"], fails: true },
    {
      initialAscending: false,
      prime: ["a", "b", "c"],
      reverse: ["a", "c", "b"],
      fails: true,
      relabel: true,
    },
    {
      initialAscending: false,
      prime: ["a", "b", "c"],
      reverse: ["c", "b", "a"],
      fails: true,
      paint: ["a", "c", "b"],
    },
  ])("validates complete directional sort and retained IDs: %j", async (scenario) => {
    const { initialAscending, prime, reverse, fails } = scenario;
    let clock = Date.now();
    const now = vi.spyOn(Date, "now").mockImplementation(() => clock);
    let direction = "none";
    let order = initialAscending ? ["a", "b", "c"] : ["c", "b", "a"];
    let pending: string[] | undefined;
    const sortIcon = {
      count: async () => 1,
      nth: () => sortIcon,
      isVisible: async () => true,
      click: async () => {
        direction = direction === "none" ? "ascending" : "descending";
        pending = direction === "ascending" ? prime : reverse;
      },
    };
    const header = {
      count: async () => 1,
      nth: () => header,
      isVisible: async () => true,
      locator: (selector: string) =>
        selector.includes(".cell-controls")
          ? sortIcon
          : {
              count: async () =>
                Number(
                  selector === ".icon-sort-none"
                    ? direction === "none"
                    : selector === ".icon-sort-up"
                      ? direction === "ascending"
                      : direction === "descending",
                ),
            },
      click: async () => {
        throw new Error("Header center hits the filter instead of sorting");
      },
    };
    const rows = {
      evaluateAll: async (read: (rows: Element[], column: string) => unknown, column: string) =>
        read(
          order.map((id, index) => ({
            getAttribute: () => id,
            ownerDocument: { defaultView: { innerHeight: 1000 } },
            parentElement: null,
            getBoundingClientRect: () => ({ top: 1, bottom: 10, width: 100, height: 9 }),
            querySelector: () => ({
              textContent:
                direction === "descending" && "relabel" in scenario && scenario.relabel
                  ? ["c", "b", "a"][index]
                  : id,
            }),
          })) as unknown as Element[],
          column,
        ),
    };
    const wait = vi.fn(async () => {
      clock += 25;
      if (pending) order = pending;
      pending = undefined;
    });
    const page = {
      locator: (selector: string) => (selector.includes(".header-") ? header : rows),
      waitForTimeout: wait,
      evaluate: async () => {
        if (pending) order = pending;
        pending = undefined;
      },
    };
    const measuredStarts: string[][] = [];
    const session = {
      page,
      timeoutMs: 100,
      evidence: [],
      measure: async (_name: string, action: () => Promise<void>) => {
        measuredStarts.push([...order]);
        await action();
        if ("paint" in scenario && scenario.paint) order = scenario.paint;
      },
    } as unknown as BenchmarkSession;
    const table = new BenchmarkTable(
      session,
      { page: "Downloads", root: "#table", rows: "#rows", scroller: "#scroller" },
      "downloads",
    );
    vi.spyOn(table, "open").mockResolvedValue(undefined);
    try {
      if (fails) {
        await expect(table.sort("filename")).rejects.toThrow("original row IDs");
        expect(session.evidence).toEqual([]);
        return;
      }
      await table.sort("filename");
      expect(measuredStarts).toEqual([["a", "b", "c"]]);
      expect(order).toEqual(["c", "b", "a"]);
      expect(session.evidence).toContainEqual({
        action: "downloads.sort",
        column: "filename",
        direction: "descending",
        before: ["a", "b", "c"],
        after: ["c", "b", "a"],
        beforeValues: ["a", "b", "c"],
        afterValues: ["c", "b", "a"],
        nameCapture:
          "actual populated DOM cells collected before timing; hidden virtual placeholders checked through original ID mapping",
      });
    } finally {
      now.mockRestore();
    }
  });
  it("blocks unknown simple sort comparators before interacting with the table", async () => {
    const table = new BenchmarkTable(
      {} as BenchmarkSession,
      { page: "Downloads", root: "#table", rows: "#rows", scroller: "#scroller" },
      "downloads",
    );
    const open = vi.spyOn(table, "open").mockResolvedValue(undefined);
    await expect(table.sort("filetime")).rejects.toThrow("use ActionOptions");
    expect(open).not.toHaveBeenCalled();
  });
  it.each([
    "passed",
    "hidden-shuffle",
    "visible-blank",
    "relabeled",
    "missing-name",
    "nested-clips",
    "nested-visible-blank",
  ])("validates virtualized complete sort: %s", async (failure) => {
    let clock = Date.now();
    const now = vi.spyOn(Date, "now").mockImplementation(() => clock);
    const names = new Map([
      ["r1", "Alpha"],
      ["r2", "Beta"],
      ["r3", "Charlie"],
      ["r4", "Delta"],
      ["r5", "Echo"],
      ["r6", "Foxtrot"],
    ]);
    let order = ["r6", "r5", "r4", "r3", "r2", "r1"];
    let direction = "none";
    let first = 0;
    let corrupt = false;
    const visited: string[] = [];
    const nested = failure.startsWith("nested");
    type Ancestor = {
      overflowY: string;
      parentElement: Ancestor | null;
      getBoundingClientRect: () => { top: number; bottom: number };
    };
    const styles = new Map<Ancestor, number>();
    const boxes = new Map<Ancestor, number>();
    const ancestor = (
      overflowY: string,
      top: number,
      bottom: number,
      parentElement: Ancestor | null,
    ): Ancestor => {
      const node = {
        overflowY,
        parentElement,
        getBoundingClientRect: () => {
          boxes.set(node, (boxes.get(node) ?? 0) + 1);
          return { top, bottom };
        },
      };
      return node;
    };
    const outer = ancestor("hidden", 20, 90, null);
    const middle = ancestor("visible", 500, 600, outer);
    const inner = ancestor("auto", 10, 150, middle);
    const view = {
      innerHeight: 300,
      getComputedStyle: (node: Ancestor) => {
        styles.set(node, (styles.get(node) ?? 0) + 1);
        return { overflowY: node.overflowY };
      },
    };
    const readRows = () =>
      order.map((id, index) => {
        const visible = index >= first && index < first + 2;
        const value =
          visible &&
          !(failure === "missing-name" && id === "r2") &&
          !(corrupt && failure.endsWith("visible-blank") && index === first)
            ? corrupt && failure === "relabeled" && index === first
              ? "Corrupted display label"
              : names.get(id)
            : undefined;
        return {
          getAttribute: () => id,
          querySelector: () => (value ? { textContent: value } : null),
          ownerDocument: { defaultView: nested ? view : { innerHeight: 100 } },
          parentElement: nested ? inner : null,
          getBoundingClientRect: () => ({
            top: visible ? (nested ? 40 : 10) : nested ? 120 : 200,
            bottom: visible ? (nested ? 60 : 30) : nested ? 140 : 220,
            width: 100,
            height: 20,
          }),
        };
      });
    const rowList = {
      evaluateAll: async (
        callback: (rows: Element[], column: string) => unknown,
        column: string,
      ) => {
        styles.clear();
        boxes.clear();
        const result = callback(readRows() as unknown as Element[], column);
        if (nested) {
          expect(styles.get(inner)).toBe(1);
          expect(styles.get(middle)).toBe(1);
          expect(styles.get(outer)).toBe(1);
          expect(boxes.get(inner)).toBe(1);
          expect(boxes.get(outer)).toBe(1);
          expect(boxes.has(middle)).toBe(false);
        }
        return result;
      },
    };
    const icon = {
      count: async () => 1,
      nth: () => icon,
      isVisible: async () => true,
      click: async () => {
        direction = direction === "none" ? "ascending" : "descending";
        order =
          direction === "ascending"
            ? ["r1", "r2", "r3", "r4", "r5", "r6"]
            : ["r6", "r5", "r4", "r3", "r2", "r1"];
        first = 0;
      },
    };
    const header = {
      count: async () => 1,
      nth: () => header,
      isVisible: async () => true,
      locator: (selector: string) =>
        selector.includes(".cell-controls")
          ? icon
          : {
              count: async () =>
                Number(
                  selector === ".icon-sort-none"
                    ? direction === "none"
                    : selector === ".icon-sort-up"
                      ? direction === "ascending"
                      : direction === "descending",
                ),
            },
    };
    const page = {
      locator: (selector: string) => {
        if (selector.includes(".header-")) return header;
        if (selector.includes("data-rowid="))
          return {
            scrollIntoViewIfNeeded: async () => {
              const id = JSON.parse(
                selector.slice(selector.indexOf("data-rowid=") + 11, -1),
              ) as string;
              visited.push(id);
              first = order.indexOf(id);
            },
          };
        return rowList;
      },
      waitForTimeout: async () => {
        clock += 25;
      },
      evaluate: async () => undefined,
    };
    let measurementStarted = false;
    const session = {
      page,
      timeoutMs: 100,
      evidence: [],
      measure: async (_name: string, action: () => Promise<void>) => {
        measurementStarted = true;
        expect(first).toBe(0);
        expect(visited).toEqual(["r4", "r2", "r6"]);
        await action();
        corrupt = true;
        if (failure === "hidden-shuffle") order = ["r6", "r5", "r3", "r4", "r2", "r1"];
      },
    } as unknown as BenchmarkSession;
    const table = new BenchmarkTable(
      session,
      { page: "Downloads", root: "#table", rows: "#rows", scroller: "#scroller" },
      "downloads",
    );
    vi.spyOn(table, "open").mockResolvedValue(undefined);
    try {
      if (failure === "passed" || failure === "nested-clips") {
        await table.sort("filename");
        expect(session.evidence).toContainEqual(
          expect.objectContaining({
            before: ["r1", "r2", "r3", "r4", "r5", "r6"],
            after: ["r6", "r5", "r4", "r3", "r2", "r1"],
            beforeValues: ["Alpha", "Beta", "Charlie", "Delta", "Echo", "Foxtrot"],
            afterValues: ["Foxtrot", "Echo", "Delta", "Charlie", "Beta", "Alpha"],
          }),
        );
      } else {
        await expect(table.sort("filename")).rejects.toThrow(
          failure === "missing-name" ? "collect every row" : "final paint",
        );
        expect(session.evidence).toEqual([]);
        expect(measurementStarted).toBe(failure !== "missing-name");
      }
    } finally {
      now.mockRestore();
    }
  });
  it("does not add event-drain time to a collection's ready boundary", async () => {
    let clock = 100;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    vi.spyOn(CollectionRecorder.prototype, "start").mockResolvedValue(undefined);
    vi.spyOn(CollectionRecorder.prototype, "stop").mockImplementation(async () => {
      clock = 10_000;
    });
    const page = { evaluate: vi.fn(async () => []) };
    const session = new Session(
      { gameId: "fake" } as HarnessConfig,
      {} as VortexInstance,
      { page } as unknown as RendererHandle,
      undefined,
      "synthetic",
    );
    (session as unknown as { prepared: boolean }).prepared = true;
    vi.spyOn(session, "verifyReady").mockImplementation(async () => {
      clock = 250;
    });
    await session.collectionMeasure(async () => {
      clock = 200;
    });
    expect(session.measurements[0]!.wallMs).toBe(150);
    expect(clock).toBe(10_000);
    vi.restoreAllMocks();
  });
});
