import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { REPO_ROOT } from "./paths";

/** tsx's CLI in this workspace's node_modules, to run with this Node. */
export function tsxCli(): string {
  try {
    return createRequire(import.meta.url).resolve("tsx/cli");
  } catch {
    return path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  }
}

export interface ProcessEvidenceOptions {
  executable: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onOutput?: (chunk: Buffer) => void;
  /** Executable is an already quoted command line when true; args must be empty. */
  shell?: boolean;
  stdin?: "ignore" | "inherit";
}

/**
 * Kill the exact child tree: `taskkill /T` on Windows, its process group elsewhere. Never a
 * process-name kill. Resolves once the kill attempt has finished; errors go to `onError`.
 */
function killTree(child: ChildProcess, onError: (error: unknown) => void): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve();
  if (process.platform === "win32") {
    return new Promise((done) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      const fallback = (): void => {
        try {
          child.kill();
        } catch (error) {
          onError(error);
        }
      };
      killer.once("error", (error) => {
        onError(error);
        fallback();
        done();
      });
      killer.once("close", (code) => {
        if (code !== 0 && child.exitCode === null && child.signalCode === null) fallback();
        done();
      });
    });
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill();
    } catch (error) {
      onError(error);
    }
  }
  return Promise.resolve();
}

/** Resolves only after close, including cancellation: callers may then restore source safely. */
export async function runEvidenceProcess(options: ProcessEvidenceOptions): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
  output: string;
  stdout: string;
  aborted: boolean;
}> {
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(options.executable, options.args, {
      cwd: options.cwd,
      windowsHide: true,
      detached: process.platform !== "win32",
      shell: options.shell ?? false,
      env: options.env ?? process.env,
      stdio: [options.stdin ?? "ignore", "pipe", "pipe"],
    });
    let output = "";
    let stdout = "";
    let spawnError: Error | undefined;
    let processError: unknown;
    let termination: Promise<void> = Promise.resolve();
    const abort = (): void => {
      termination = killTree(child, (error) => {
        processError = error;
      });
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const receive = (chunk: Buffer): void => {
      output += chunk.toString();
      try {
        options.onOutput?.(chunk);
      } catch (error) {
        processError = error;
        abort();
      }
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      receive(chunk);
    });
    child.stderr.on("data", receive);
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (code, signal) => {
      void termination
        .then(() => {
          options.signal?.removeEventListener("abort", abort);
          const failures: unknown[] = [spawnError, processError].filter(
            (error) => error !== undefined,
          );
          if (failures.length === 1) throw failures[0];
          if (failures.length > 1)
            throw new AggregateError(failures, "Child exited with process errors; inspect state.");
          resolve({ code, signal, output, stdout, aborted: options.signal?.aborted === true });
        })
        .catch(reject);
    });
  });
}

/**
 * Where the caller ran the command from. The `doodlebot` shim (bin/doodlebot.cjs) starts the CLI
 * in the workspace root, whatever directory the caller was in, so `process.cwd()` is always the
 * kit; it keeps the caller's directory in INIT_CWD, as pnpm and npm do. Without this, `script`
 * or a command run from a Vortex checkout ran in the kit instead, under the kit's pnpm.
 */
export function callerCwd(explicit?: string, env: NodeJS.ProcessEnv = process.env): string {
  if (explicit !== undefined) return explicit;
  const init = env.INIT_CWD;
  return init !== undefined && init !== "" ? init : process.cwd();
}

/**
 * Run a command with inherited stdio until it exits; resolves to a shell-style exit code. Ctrl+C
 * (or SIGTERM/SIGHUP) kills the exact child tree and waits for it: 130 after such an abort,
 * 128 + the signal number when the child died from a signal, otherwise its exit code (1 when
 * none is reported).
 */
export function runInteractive(
  executable: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<number> {
  const cancellation = abortOnSignals();
  return new Promise<number>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(executable, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: "inherit",
        shell: false,
        // As runEvidenceProcess: its own process group on POSIX so the tree can be killed.
        detached: process.platform !== "win32",
      });
    } catch (error) {
      reject(error);
      return;
    }
    let spawnError: Error | undefined;
    let killError: unknown;
    let termination: Promise<void> = Promise.resolve();
    const abort = (): void => {
      termination = killTree(child, (error) => {
        killError = error;
      });
    };
    cancellation.signal.addEventListener("abort", abort, { once: true });
    if (cancellation.signal.aborted) abort();
    child.once("error", (error) => {
      spawnError = error;
      // It never started; settle now rather than rely on a close event.
      if (child.pid === undefined) reject(error);
    });
    child.once("close", (code, signal) => {
      void termination.then(() => {
        cancellation.signal.removeEventListener("abort", abort);
        if (cancellation.signal.aborted) return resolve(130);
        if (spawnError !== undefined) return reject(spawnError);
        if (killError !== undefined) return reject(killError);
        if (signal !== null) return resolve(128 + os.constants.signals[signal]);
        resolve(code ?? 1);
      });
    });
  }).finally(() => cancellation.dispose());
}

export function abortOnSignals(
  external?: AbortSignal,
  enabled = true,
): {
  signal: AbortSignal;
  dispose(): void;
} {
  const controller = new AbortController();
  const abort = (): void =>
    controller.abort(new Error("operation interrupted; child exit awaited"));
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
  if (enabled) signals.forEach((signal) => process.on(signal, abort));
  external?.addEventListener("abort", abort, { once: true });
  if (external?.aborted) abort();
  return {
    signal: controller.signal,
    dispose: () => {
      if (enabled) signals.forEach((signal) => process.removeListener(signal, abort));
      external?.removeEventListener("abort", abort);
    },
  };
}
