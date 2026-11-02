import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadConfig, type HarnessConfig } from "./config";
import { instanceLeaseResources } from "./instance";
import * as instance from "./instance";
import { processAlive, readLease, type LeaseEnv } from "./lease";
import { claimOperations, operationResource } from "./operations";
import * as operations from "./operations";
import { runRealModeProcess } from "./realModeProcess";

let dir: string;
let config: HarnessConfig;
let leaseEnv: LeaseEnv;
let child: ChildProcess | undefined;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "real-mode-process-"));
  leaseEnv = { dir: path.join(dir, "leases"), isAlive: processAlive };
  config = loadConfig({
    cacheDir: path.join(dir, "cache"),
    owner: "real-mode-test",
    target: {
      kind: "dev",
      executable: process.execPath,
      args: [],
      appName: "fixture",
      sourceDir: dir,
    },
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (child?.pid !== undefined && processAlive(child.pid)) {
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
  }
  child = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
});
const launch = () =>
  (child = spawn(
    process.execPath,
    ["-e", "process.on('message', code => process.exit(code)); process.send('ready');"],
    { stdio: ["ignore", "ignore", "ignore", "ipc"], windowsHide: true },
  ));
const ready = async () => {
  await once(child!, "message");
};
const close = async () => {
  child!.send(0);
};
const options = () => ({ leaseEnv, closeTimeoutMs: 1000, terminateTimeoutMs: 1000 });

it("holds every operation and child lease during exercise, then releases after normal exit", async () => {
  const result = await runRealModeProcess(
    config,
    launch,
    async () => {
      await ready();
      for (const resource of instanceLeaseResources(config)) {
        expect(readLease(resource, leaseEnv)!.lease.instancePids).toContain(child!.pid);
        expect(() => claimOperations([resource], config.owner!, { leaseEnv })).toThrow();
      }
    },
    close,
    options(),
  );
  expect(result).toMatchObject({
    exitedCleanly: true,
    stopped: true,
    exitCode: 0,
    signal: null,
    forcedStop: false,
  });
  for (const resource of instanceLeaseResources(config)) {
    expect(readLease(resource, leaseEnv)).toBeUndefined();
    expect(readLease(operationResource(resource), leaseEnv)).toBeUndefined();
  }
});

it("rejects a nonzero exit after otherwise successful exercise", async () => {
  const result = await runRealModeProcess(
    config,
    launch,
    async () => {
      await ready();
      const exited = once(child!, "exit");
      child!.send(7);
      await exited;
    },
    close,
    options(),
  );
  expect(result).toMatchObject({ exitedCleanly: false, stopped: true, exitCode: 7 });
});

it("restores shared state while operations are still held and reports restoration failures", async () => {
  const result = await runRealModeProcess(config, launch, ready, close, {
    ...options(),
    onStopped: () => {
      for (const resource of instanceLeaseResources(config))
        expect(() => claimOperations([resource], config.owner!, { leaseEnv })).toThrow();
      expect(processAlive(child!.pid!)).toBe(false);
      throw new Error("protocol restore failed");
    },
  });
  expect(result.failure).toBe("protocol restore failed");
  for (const resource of instanceLeaseResources(config))
    expect(readLease(operationResource(resource), leaseEnv)).toBeUndefined();
});

it("records a failed spawn and releases resources without calling the UI", async () => {
  const exercise = vi.fn();
  const result = await runRealModeProcess(
    config,
    () => spawn(path.join(dir, "missing-executable")),
    exercise,
    close,
    options(),
  );
  expect(result).toMatchObject({ exitedCleanly: false, stopped: true });
  expect(result.failure).toMatch(/ENOENT/);
  expect(exercise).not.toHaveBeenCalled();
  for (const resource of instanceLeaseResources(config))
    expect(readLease(resource, leaseEnv)).toBeUndefined();
});

it("fails forced termination and retains the original exercise error", async () => {
  const result = await runRealModeProcess(
    config,
    launch,
    async () => {
      await ready();
      throw new Error("renderer failed");
    },
    async () => undefined,
    { ...options(), closeTimeoutMs: 1 },
  );
  expect(result).toMatchObject({
    exitedCleanly: false,
    stopped: true,
    forcedStop: true,
    failure: "renderer failed",
  });
});

it("retains ownership and operation protection when the exact child survives cleanup", async () => {
  const result = await runRealModeProcess(
    config,
    launch,
    async () => {
      await ready();
      vi.spyOn(child!, "kill").mockReturnValue(false);
    },
    async () => undefined,
    { ...options(), closeTimeoutMs: 1, terminateTimeoutMs: 1 },
  );
  expect(result).toMatchObject({ exitedCleanly: false, stopped: false, forcedStop: true });
  for (const resource of instanceLeaseResources(config)) {
    expect(readLease(resource, leaseEnv)!.lease.instancePids).toContain(child!.pid);
    expect(readLease(operationResource(resource), leaseEnv)!.lease.holders).toContain(child!.pid);
    expect(() => claimOperations([resource], config.owner!, { leaseEnv })).toThrow();
  }
});

it.each(["persistent", "operation"])(
  "keeps every controller hold after failed %s registration and failed shutdown",
  async (stage) => {
    if (stage === "persistent")
      vi.spyOn(instance, "registerLaunchedProcess").mockRejectedValue(
        new Error("registration failed"),
      );
    else {
      const actualClaim = operations.claimOperations;
      vi.spyOn(operations, "claimOperations").mockImplementation((...args) => {
        const hold = actualClaim(...args);
        return {
          ...hold,
          trackChild: () => {
            throw new operations.ChildRegistrationError(
              new Error("registration failed"),
              () => undefined,
            );
          },
        };
      });
    }
    const restored = vi.fn();
    const result = await runRealModeProcess(
      config,
      () => {
        const launched = launch();
        vi.spyOn(launched, "kill").mockReturnValue(false);
        return launched;
      },
      ready,
      async () => undefined,
      { ...options(), closeTimeoutMs: 1, terminateTimeoutMs: 1, onStopped: restored },
    );
    expect(result.stopped).toBe(false);
    expect(result.failure).toMatch(/registration failed/);
    expect(restored).not.toHaveBeenCalled();
    for (const resource of instanceLeaseResources(config)) {
      expect(readLease(resource, leaseEnv)!.lease.holders).toContain(process.pid);
      expect(readLease(operationResource(resource), leaseEnv)!.lease.holders).toContain(
        process.pid,
      );
      expect(() => claimOperations([resource], config.owner!, { leaseEnv })).toThrow();
    }
    vi.restoreAllMocks();
    const exited = once(child!, "exit");
    child!.kill("SIGKILL");
    await exited;
    await vi.waitFor(() => expect(restored).toHaveBeenCalledTimes(1));
    for (const resource of instanceLeaseResources(config)) {
      expect(readLease(resource, leaseEnv)).toBeUndefined();
      expect(readLease(operationResource(resource), leaseEnv)).toBeUndefined();
    }
  },
);
