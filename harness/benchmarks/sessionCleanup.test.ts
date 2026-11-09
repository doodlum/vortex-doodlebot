import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { BenchmarkSession } from "./session";
import type { HarnessConfig } from "../src/config";
import type { VortexInstance } from "../src/instance";
import type { RendererHandle } from "../src/cdp";

const roots: string[] = [];
afterEach(() => {
  vi.doUnmock("../src/instance");
  vi.doUnmock("../src/tests/appHealth");
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function setup(child: { exitCode: number | null; signalCode: null }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "doodlebot-benchmark-cleanup-test-"));
  roots.push(root);
  vi.doMock("../src/tests/appHealth", () => ({ assertNoUnrecoverableErrors: vi.fn() }));
  const finish = vi.fn();
  const session = new BenchmarkSession(
    { cacheDir: root, gameId: "skyrimse" } as HarnessConfig,
    {
      process: child,
      userDataDir: path.join(root, "live"),
      stop: vi.fn(async () => undefined),
    } as unknown as VortexInstance,
    { close: vi.fn(async () => undefined) } as unknown as RendererHandle,
    undefined,
    "real",
    { finish },
  );
  return { session, finish };
}
it("retries retained cleanup after the previously live app exits", async () => {
  const child = { exitCode: null as number | null, signalCode: null };
  const { session, finish } = setup(child);
  await expect(session.close(true)).rejects.toThrow("Could not confirm Vortex exit");
  expect(finish).not.toHaveBeenCalled();
  child.exitCode = 0;
  await session.close(true);
  expect(finish).toHaveBeenCalledTimes(1);
});
it.each([false, true])(
  "keeps the OAuth rotation unsaved until a failed replacement's exact child exits: stopped=%s",
  async (stopped) => {
    const child = { exitCode: null as number | null, signalCode: null };
    const { session, finish } = setup({ exitCode: 0, signalCode: null });
    vi.doMock("../src/instance", () => ({
      launchVortex: async (options: { onProcessSpawn: (child: ChildProcess) => void }) => {
        options.onProcessSpawn(child as unknown as ChildProcess);
        throw new Error("replacement readiness timeout");
      },
      stopStaleInstance: async () => {
        if (stopped) child.exitCode = 0;
        return true;
      },
    }));
    vi.spyOn(session, "openPage").mockResolvedValue(undefined);
    await expect(session.restartToMods()).rejects.toThrow("replacement readiness timeout");
    if (stopped) await session.close(true);
    else await expect(session.close(true)).rejects.toThrow("Could not confirm Vortex exit");
    expect(finish).toHaveBeenCalledTimes(stopped ? 1 : 0);
  },
);

it("refuses a benchmark session while a harness Vortex runs, before launching anything", async () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "doodlebot-benchmark-refusal-test-"));
  roots.push(cache);
  vi.resetModules();
  vi.doMock("../src/paths", async (original) => ({
    ...(await original<typeof import("../src/paths")>()),
    DEFAULT_CACHE_DIR: cache,
  }));
  vi.doMock("../src/processes", async (original) => ({
    ...(await original<typeof import("../src/processes")>()),
    processImageName: () => "electron.exe",
  }));
  try {
    const running = await import("../src/runningVortex");
    const { createSession } = await import("./session");
    running.writeInstanceRecord({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      cacheDir: cache,
      userDataDir: path.join(cache, "live"),
      mcpPort: 3701,
    });
    const temporaryBefore = fs
      .readdirSync(os.tmpdir())
      .filter((name) => name.startsWith("doodlebot-benchmark-") && !name.includes("test"));
    await expect(createSession({} as Parameters<typeof createSession>[0])).rejects.toThrow(
      `A harness Vortex is running (pid ${String(process.pid)}, cache ${cache}); run \`pnpm run ai -- down\` before a benchmark session.`,
    );
    // Refused before creating its private cache workspace.
    expect(
      fs
        .readdirSync(os.tmpdir())
        .filter((name) => name.startsWith("doodlebot-benchmark-") && !name.includes("test")),
    ).toEqual(temporaryBefore);
  } finally {
    vi.doUnmock("../src/paths");
    vi.doUnmock("../src/processes");
    vi.resetModules();
  }
});
