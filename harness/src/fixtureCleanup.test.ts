import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FixtureCleanup, closeFixtureApp } from "./tests/fixtureCleanup";
import {
  acquireLease,
  addInstancePid,
  holdLease,
  readLease,
  type HoldResult,
  type LeaseEnv,
} from "./lease";
import { instanceResource } from "./slots";
import { registerLaunchedProcess } from "./instance";
import { claimOperations, operationResource } from "./operations";

let root: string;
let profile: string;
let sentinel: string;
let alive: Set<number>;
let env: LeaseEnv;
let lease: HoldResult;
let cleanup: FixtureCleanup;
const pid = 424242;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-cleanup-"));
  profile = path.join(root, "cache", "instance");
  sentinel = path.join(profile, "state");
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(sentinel, "retained profile");
  alive = new Set([process.pid, pid]);
  env = { dir: path.join(root, "leases"), isAlive: (candidate) => alive.has(candidate) };
  lease = holdLease(instanceResource(path.dirname(profile)), "fixture", env);
  addInstancePid(lease.lease, pid, env);
  cleanup = new FixtureCleanup();
});
afterEach(() => {
  lease.release();
  fs.rmSync(root, { recursive: true, force: true });
});
const app = (close: () => Promise<void>) => ({
  close,
  process: () => ({ pid, exitCode: null, signalCode: null }) as ChildProcess,
});
function expectRetained() {
  lease.release();
  expect(readLease(lease.lease.resource, env)).toMatchObject({
    live: true,
    lease: { instancePids: [pid] },
  });
  expect(() => acquireLease(lease.lease.resource, "other", env)).toThrow(/held by "fixture"/);
  expect(() => cleanup.remove(profile)).toThrow(/Preserved/);
  expect(() => cleanup.remove(path.dirname(profile))).toThrow(/Preserved/);
  expect(fs.readFileSync(sentinel, "utf8")).toBe("retained profile");
}
it("reports a failed app.close and preserves the live PID, profile and parent cache", async () => {
  const failure = new Error("Electron close failed");
  await expect(
    closeFixtureApp(app(vi.fn().mockRejectedValue(failure)), [lease.lease], cleanup, env),
  ).rejects.toBe(failure);
  expectRetained();
});
it("preserves the live app and directories when app.close rejects without a value", async () => {
  await expect(
    closeFixtureApp(
      app(() => Promise.reject()),
      [lease.lease],
      cleanup,
      env,
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
      [lease.lease],
      cleanup,
      env,
    ),
  ).rejects.toThrow(/still running/);
  expectRetained();
});
it("retains a surviving exact child and partial operation protection after registration fails", async () => {
  const missing = { ...lease.lease, resource: "instance:absent" };
  const operation = claimOperations([lease.lease.resource, missing.resource], "fixture", {
    leaseEnv: env,
  });
  const child = {
    pid,
    exitCode: null,
    signalCode: null,
    kill: () => {
      throw new Error("shutdown refused");
    },
  } as unknown as ChildProcess;
  try {
    await expect(
      cleanup.preserveOnFailure(() =>
        registerLaunchedProcess(child, [lease.lease, missing], {
          context: operation.context,
          leaseEnv: env,
        }),
      ),
    ).rejects.toThrow(/child shutdown failed/);
    operation.release();
    for (const resource of operation.context.resources)
      expect(readLease(operationResource(resource), env)).toMatchObject({
        live: true,
        lease: { holders: [pid] },
      });
    expectRetained();
  } finally {
    operation.release();
  }
});
it("forgets a confirmed exited app and permits profile and cache cleanup", async () => {
  await closeFixtureApp(
    app(async () => {
      alive.delete(pid);
    }),
    [lease.lease],
    cleanup,
    env,
  );
  lease.release();
  expect(readLease(lease.lease.resource, env)).toBeUndefined();
  cleanup.remove(profile);
  cleanup.remove(path.dirname(profile));
  expect(fs.existsSync(sentinel)).toBe(false);
});
