import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";

// The instance record lives in DEFAULT_CACHE_DIR; keep it in a temporary folder.
vi.mock("./paths", async (importOriginal) => {
  const original = await importOriginal<typeof import("./paths")>();
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  return {
    ...original,
    DEFAULT_CACHE_DIR: mkdtempSync(join(tmpdir(), "fixture-cleanup-cache-")),
  };
});

import { DEFAULT_CACHE_DIR } from "./paths";
import { FixtureCleanup, closeFixtureApp } from "./tests/fixtureCleanup";
import { INSTANCE_RECORD, readInstanceRecord, writeInstanceRecord } from "./runningVortex";

const defaultCache = DEFAULT_CACHE_DIR;
// Never touch the operator's harness/.cache if the mock did not apply.
if (!path.basename(defaultCache).startsWith("fixture-cleanup-cache-"))
  throw new Error(`DEFAULT_CACHE_DIR was not mocked: ${defaultCache}`);

let root: string;
let profile: string;
let sentinel: string;
let alive: Set<number>;
let isAlive: (pid: number) => boolean;
let cleanup: FixtureCleanup;
const pid = 424242;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-cleanup-"));
  profile = path.join(root, "cache", "instance");
  sentinel = path.join(profile, "state");
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(sentinel, "retained profile");
  alive = new Set([process.pid, pid]);
  isAlive = (candidate) => alive.has(candidate);
  writeInstanceRecord({
    pid,
    startedAt: new Date().toISOString(),
    cacheDir: path.dirname(profile),
    userDataDir: profile,
    mcpPort: 3701,
  });
  cleanup = new FixtureCleanup();
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(INSTANCE_RECORD, { force: true });
});
afterAll(() => fs.rmSync(defaultCache, { recursive: true, force: true }));

const app = (close: () => Promise<void>, child: { pid?: number } = { pid }) => ({
  close,
  process: () => ({ pid: child.pid, exitCode: null, signalCode: null }) as ChildProcess,
});
function expectRetained() {
  expect(readInstanceRecord()?.pid).toBe(pid);
  expect(() => cleanup.remove(profile)).toThrow(/Preserved/);
  expect(() => cleanup.remove(path.dirname(profile))).toThrow(/Preserved/);
  expect(fs.readFileSync(sentinel, "utf8")).toBe("retained profile");
}
it("records the fixture app under the fixed instance record", () => {
  expect(INSTANCE_RECORD).toBe(path.join(defaultCache, "instance.json"));
  expect(readInstanceRecord()).toMatchObject({ pid, userDataDir: profile });
});
it("reports a failed app.close and preserves the record, profile and parent cache", async () => {
  const failure = new Error("Electron close failed");
  await expect(
    closeFixtureApp(app(vi.fn().mockRejectedValue(failure)), cleanup, isAlive),
  ).rejects.toBe(failure);
  expectRetained();
});
it("preserves the live app and directories when app.close rejects without a value", async () => {
  await expect(
    closeFixtureApp(
      app(() => Promise.reject()),
      cleanup,
      isAlive,
    ),
  ).rejects.toBeUndefined();
  expectRetained();
  try {
    cleanup.remove(profile);
    throw new Error("cleanup unexpectedly succeeded");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect(Object.hasOwn(error as Error, "cause")).toBe(true);
    expect((error as Error).cause).toBeUndefined();
  }
});
it("reports a lifecycle stop failure and prevents parent cache cleanup", async () => {
  const failure = new Error("Vortex did not exit cleanly");
  await expect(cleanup.preserveOnFailure(vi.fn().mockRejectedValue(failure))).rejects.toBe(failure);
  expectRetained();
});
it("does not treat a resolved close as proof that a live PID exited", async () => {
  await expect(
    closeFixtureApp(
      app(async () => {}),
      cleanup,
      isAlive,
    ),
  ).rejects.toThrow(`Vortex ${pid} is still running after fixture close; profile retained.`);
  expectRetained();
});
it("refuses an app without a pid whose exit is unconfirmed", async () => {
  await expect(
    closeFixtureApp(
      app(async () => {}, {}),
      cleanup,
      isAlive,
    ),
  ).rejects.toThrow(/did not confirm Vortex exit/);
  expectRetained();
});
it("clears the record after a confirmed exit and permits profile and cache cleanup", async () => {
  await closeFixtureApp(
    app(async () => {
      alive.delete(pid);
    }),
    cleanup,
    isAlive,
  );
  expect(readInstanceRecord()).toBeUndefined();
  expect(fs.existsSync(INSTANCE_RECORD)).toBe(false);
  cleanup.remove(profile);
  cleanup.remove(path.dirname(profile));
  expect(fs.existsSync(sentinel)).toBe(false);
});
it("leaves a record naming another process after a confirmed exit", async () => {
  writeInstanceRecord({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    cacheDir: path.dirname(profile),
    userDataDir: profile,
    mcpPort: 3701,
  });
  await closeFixtureApp(
    app(async () => {
      alive.delete(pid);
    }),
    cleanup,
    isAlive,
  );
  expect(readInstanceRecord()?.pid).toBe(process.pid);
});
