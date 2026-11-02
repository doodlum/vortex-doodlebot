import { type ChildProcess } from "node:child_process";
import type { HarnessConfig } from "./config";
import {
  claimInstanceLease,
  forgetLaunchedPid,
  instanceLeaseResources,
  registerLaunchedProcess,
} from "./instance";
import type { LeaseEnv } from "./lease";
import { ChildRegistrationError, claimOperations } from "./operations";

export interface RealModeProcessResult {
  failure?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  forcedStop: boolean;
  exitedCleanly: boolean;
  stopped: boolean;
}

/** Hold the app's resources until its exact child exits, including failed startup/cleanup. */
export async function runRealModeProcess(
  config: HarnessConfig,
  launch: () => ChildProcess,
  exercise: () => Promise<void>,
  close: () => Promise<void>,
  options: {
    leaseEnv?: LeaseEnv;
    closeTimeoutMs?: number;
    terminateTimeoutMs?: number;
    onStopped?: () => void | Promise<void>;
  } = {},
): Promise<RealModeProcessResult> {
  const lease = claimInstanceLease(config, "ai:test:real-mode", options.leaseEnv);
  const resources = instanceLeaseResources(config);
  if (process.platform === "win32") resources.push("real-mode:nxm-protocol");
  let operation: ReturnType<typeof claimOperations> | undefined;
  let child: ChildProcess | undefined;
  let releaseChild: (() => void) | undefined;
  let spawnError: Error | undefined;
  let exited = false;
  const result: RealModeProcessResult = { forcedStop: false, exitedCleanly: false, stopped: false };
  const fail = (error: unknown) => {
    result.failure ??= error instanceof Error ? error.message : String(error);
  };
  const wait = async (milliseconds: number) => {
    const deadline = Date.now() + milliseconds;
    while (!exited && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, Math.min(50, deadline - Date.now())));
  };
  let cleanupPromise: Promise<void> | undefined;
  let deferredCleanup = false;
  const cleanup = () =>
    (cleanupPromise ??= (async () => {
      try {
        await options.onStopped?.();
      } catch (error) {
        fail(error);
      }
      try {
        if (child?.pid !== undefined)
          forgetLaunchedPid(lease.identities, child.pid, options.leaseEnv);
        releaseChild?.();
      } catch (error) {
        fail(error);
      } finally {
        try {
          operation?.release();
        } catch (error) {
          fail(error);
        }
        try {
          lease.release();
        } catch (error) {
          fail(error);
        }
      }
    })());
  try {
    operation = claimOperations(resources, config.owner!, { leaseEnv: options.leaseEnv });
    child = launch();
    child.on("error", (error) => {
      spawnError = error;
      fail(error);
      if (child?.pid === undefined) exited = true;
    });
    child.on("exit", (code, signal) => {
      exited = true;
      result.exitCode = code;
      result.signal = signal;
      if (deferredCleanup) void cleanup().catch(fail);
    });
    await new Promise<void>((resolve, reject) => {
      child!.once("spawn", resolve);
      child!.once("error", reject);
    });
    await registerLaunchedProcess(child, lease.identities, { leaseEnv: options.leaseEnv });
    try {
      releaseChild = operation.trackChild(child.pid!);
    } catch (error) {
      if (error instanceof ChildRegistrationError) releaseChild = error.release;
      throw error;
    }
    await exercise();
  } catch (error) {
    fail(error);
  } finally {
    try {
      if (child !== undefined && !exited) {
        try {
          await close();
        } catch (error) {
          fail(error);
        }
        await wait(options.closeTimeoutMs ?? 30_000);
        if (!exited) {
          result.forcedStop = true;
          child.kill("SIGTERM");
          await wait(options.terminateTimeoutMs ?? 30_000);
        }
      }
    } catch (error) {
      fail(error);
    } finally {
      result.stopped = child === undefined || exited;
      result.exitedCleanly =
        exited &&
        spawnError === undefined &&
        result.exitCode === 0 &&
        result.signal === null &&
        !result.forcedStop;
      if (result.stopped) await cleanup();
      else {
        // Keep controller holds as well as any child registrations after partial failure.
        // The referenced child keeps Node alive; its exact exit releases these holds.
        deferredCleanup = true;
      }
    }
  }
  return result;
}
