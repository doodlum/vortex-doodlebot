import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { BenchmarkSession } from "./session";
import type { HarnessConfig } from "../src/config";
import type { VortexInstance } from "../src/instance";
import type { RendererHandle } from "../src/cdp";
import type { HoldResult } from "../src/lease";

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
  const release = vi.fn();
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
    { release } as unknown as HoldResult,
  );
  return { session, finish, release };
}
it("retries retained cleanup after the previously live app exits", async () => {
  const child = { exitCode: null as number | null, signalCode: null };
  const { session, finish, release } = setup(child);
  await expect(session.close(true)).rejects.toThrow("Could not confirm Vortex exit");
  expect(finish).not.toHaveBeenCalled();
  expect(release).not.toHaveBeenCalled();
  child.exitCode = 0;
  await session.close(true);
  expect(finish).toHaveBeenCalledTimes(1);
  expect(release).toHaveBeenCalledTimes(1);
});
it.each([false, true])(
  "retains failed-replacement reservations until its exact child exits: stopped=%s",
  async (stopped) => {
    const child = { exitCode: null as number | null, signalCode: null };
    const { session, finish, release } = setup({ exitCode: 0, signalCode: null });
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
    expect(release).toHaveBeenCalledTimes(stopped ? 1 : 0);
  },
);
