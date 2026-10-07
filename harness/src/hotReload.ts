/** Watch extension source; each build/copy/reload cycle owns resources only until it finishes. */
import path from "node:path";

import { extensionRoot, type HarnessConfig } from "./config";
import { ConfigError } from "./errors";
import {
  captureExtensionInputs,
  ExtensionInputsChangedError,
  type ExtensionInputs,
} from "./extensionGeneration";
import { expectedUserDataDir, ProfileMismatchError, readAutomationProfile } from "./runningProfile";
import {
  buildExtension,
  ExtensionBuildError,
  ExtensionBuildCancelledError,
  extensionOutputResource,
  type ExtensionBuildOptions,
} from "./extensionBuild";
import { installMcpExtension } from "./instance";
import { LeaseHeldError, normalizedPath, requireNamedOwner } from "./lease";
import { withLiveOperation } from "./liveOperation";
import type { VortexMcpClient } from "./mcpClient";
import { CONTEXT_ENV, withOperations, type OperationOptions } from "./operations";

function changed(before: ExtensionInputs, after: ExtensionInputs): string[] {
  if (before.digest === after.digest) return [];
  const edits = [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])].filter(
    (file) => {
      const a = before.files[file];
      const b = after.files[file];
      return a === null || a === undefined || b === null || b === undefined
        ? a !== b
        : !a.equals(b);
    },
  );
  return edits.length > 0 ? edits : ["build environment"];
}

/** A parent holding resources for the watcher's lifetime would defeat idle access. */
export function assertStandaloneWatch(options: OperationOptions = {}): void {
  if (options.context !== undefined || process.env[CONTEXT_ENV] !== undefined)
    throw new ConfigError("Run watch directly, outside script/lease/evidence execution contexts.");
}

export interface WatchOptions extends OperationOptions {
  liveDir: string;
  source?: string;
  pollMs?: number;
  debounceMs?: number;
  retryMs?: number;
  reloadTimeoutMs?: number;
  reloadPollMs?: number;
  buildRunner?: ExtensionBuildOptions["runner"];
  onEvent?: (event: HotReloadEvent) => void;
  signal?: AbortSignal;
}

export type HotReloadEvent =
  | { type: "watching"; files: string[] }
  | { type: "changed"; files: string[] }
  | { type: "building" }
  | { type: "waiting"; message: string }
  | { type: "reloaded"; elapsedMs: number }
  | { type: "error"; message: string };

type ReloadClient = Pick<VortexMcpClient, "call">;

function runtimeId(status: unknown): string | undefined {
  if (status === null || typeof status !== "object" || !("runtimeId" in status)) return undefined;
  return typeof status.runtimeId === "string" && status.runtimeId.length > 0
    ? status.runtimeId
    : undefined;
}

async function waitForReload(
  mcp: ReloadClient,
  before: string,
  options: WatchOptions,
  expected: string,
): Promise<void> {
  const deadline = Date.now() + (options.reloadTimeoutMs ?? 60_000);
  while (Date.now() < deadline) {
    const after = await readAutomationProfile(
      mcp,
      expected,
      Math.max(1, Math.min(3_000, deadline - Date.now())),
    ).catch((error: unknown) => {
      if (error instanceof ProfileMismatchError) throw error;
      return undefined;
    });
    const id = after === undefined ? undefined : runtimeId(after);
    if (id !== undefined && id !== before) return;
    // Once reload is requested, finish its bounded verification even after cancellation.
    // An aborted sleep here would spin and release protection before readiness is known.
    const remaining = deadline - Date.now();
    if (remaining > 0) await sleep(Math.min(options.reloadPollMs ?? 300, remaining));
  }
  throw new Error("The renderer did not establish a new runtime before the reload deadline.");
}

export async function watchAndReload(
  mcp: ReloadClient,
  config: HarnessConfig,
  options: WatchOptions,
): Promise<void> {
  assertStandaloneWatch(options);
  const owner = requireNamedOwner(config.owner);
  const source = options.source ?? extensionRoot();
  const expected = expectedUserDataDir(config);
  if (normalizedPath(path.join(options.liveDir, "userData")) !== normalizedPath(expected))
    throw new ConfigError("The watch destination must be this configured cache's live profile.");
  const pollMs = options.pollMs ?? 400;
  const emit = options.onEvent ?? ((): void => undefined);
  let observed = captureExtensionInputs(source);
  let stableSince = Date.now();
  let applied: ExtensionInputs | undefined;
  let failed: ExtensionInputs | undefined;
  let waitingFor: string | undefined;
  emit({ type: "watching", files: Object.keys(observed.files) });

  while (options.signal?.aborted !== true) {
    const next = captureExtensionInputs(source);
    const edits = changed(observed, next);
    if (edits.length > 0) {
      observed = next;
      stableSince = Date.now();
      failed = undefined;
      emit({ type: "changed", files: edits });
    }
    if (
      (applied !== undefined && changed(applied, observed).length === 0) ||
      (failed !== undefined && changed(failed, observed).length === 0) ||
      Date.now() - stableSince < (options.debounceMs ?? 600)
    ) {
      await sleep(pollMs, options.signal);
      continue;
    }

    const attempted = observed;
    const started = Date.now();
    try {
      const loaded = await withLiveOperation(
        config,
        "watch extension cycle",
        (context) =>
          withOperations(
            [extensionOutputResource(source)],
            owner,
            { context, leaseEnv: options.leaseEnv },
            async (nested) => {
              if (
                options.signal?.aborted ||
                changed(attempted, captureExtensionInputs(source)).length > 0
              )
                return false;
              if (runtimeId(await readAutomationProfile(mcp, expected)) === undefined)
                throw new Error("The running renderer has no runtime identity.");
              emit({ type: "building" });
              await buildExtension({
                source,
                owner,
                context: nested,
                leaseEnv: options.leaseEnv,
                signal: options.signal,
                runner: options.buildRunner,
              });
              // A bundler can read a mixture of files if the editor changes them mid-build.
              if (
                options.signal?.aborted ||
                changed(attempted, captureExtensionInputs(source)).length > 0
              )
                return false;
              let before = runtimeId(await readAutomationProfile(mcp, expected));
              if (before === undefined)
                throw new Error("The running renderer has no runtime identity.");
              if (
                options.signal?.aborted ||
                changed(attempted, captureExtensionInputs(source)).length > 0
              )
                return false;
              installMcpExtension(options.liveDir, source, {
                owner,
                context: nested,
                leaseEnv: options.leaseEnv,
              });
              before = runtimeId(await readAutomationProfile(mcp, expected));
              if (before === undefined)
                throw new Error("The running renderer has no runtime identity.");
              await mcp.call("ui_reload_renderer", {}, 3_000);
              await waitForReload(mcp, before, options, expected);
              return true;
            },
          ),
        { leaseEnv: options.leaseEnv },
      );
      waitingFor = undefined;
      if (loaded) {
        applied = attempted;
        emit({ type: "reloaded", elapsedMs: Date.now() - started });
      }
    } catch (error) {
      if (error instanceof ExtensionBuildCancelledError) return;
      if (error instanceof ExtensionInputsChangedError) {
        await sleep(pollMs, options.signal);
        continue;
      }
      if (error instanceof LeaseHeldError) {
        if (waitingFor !== error.message) emit({ type: "waiting", message: error.message });
        waitingFor = error.message;
        // Both wrappers have unwound: no partial acquisition is retained while waiting.
        await sleep(options.retryMs ?? 1_000, options.signal);
        continue;
      }
      if (!(error instanceof ExtensionBuildError)) throw error;
      failed = attempted;
      emit({
        type: "error",
        message: error.message + " Waiting for a source edit before rebuilding.",
      });
    }
    await sleep(pollMs, options.signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    if (signal?.aborted) finish();
    else signal?.addEventListener("abort", finish, { once: true });
  });
}
