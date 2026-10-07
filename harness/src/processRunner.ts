import { spawn } from "node:child_process";
import {
  CONTEXT_ENV,
  ChildRegistrationError,
  trackOperationChild,
  type OperationOptions,
} from "./operations";

export interface ProcessEvidenceOptions extends OperationOptions {
  executable: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  persistentResources?: string[];
  onOutput?: (chunk: Buffer) => void;
  /** Executable is an already quoted command line when true; args must be empty. */
  shell?: boolean;
  stdin?: "ignore" | "inherit";
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
      env: {
        ...(options.env ?? process.env),
        ...(options.context === undefined
          ? {}
          : {
              VORTEX_AI_OWNER: options.context.owner,
              [CONTEXT_ENV]: JSON.stringify(options.context),
            }),
        ...(options.leaseEnv?.dir === undefined
          ? {}
          : { VORTEX_AI_LEASE_DIR: options.leaseEnv.dir }),
      },
      stdio: [options.stdin ?? "ignore", "pipe", "pipe"],
    });
    let release: (() => void) | undefined;
    let registrationError: unknown;
    let output = "";
    let stdout = "";
    let spawnError: Error | undefined;
    let processError: unknown;
    let termination: Promise<void> = Promise.resolve();
    const abort = (): void => {
      if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
      if (process.platform === "win32") {
        // Bound to the exact known child tree, never a process-name kill.
        termination = new Promise((done) => {
          const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore",
          });
          const fallback = (): void => {
            try {
              child.kill();
            } catch (error) {
              processError = error;
            }
          };
          killer.once("error", (error) => {
            processError = error;
            fallback();
            done();
          });
          killer.once("close", (code) => {
            if (code !== 0 && child.exitCode === null && child.signalCode === null) fallback();
            done();
          });
        });
      } else {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          try {
            child.kill();
          } catch (error) {
            processError = error;
          }
        }
      }
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
          const failures: unknown[] = [registrationError, spawnError, processError].filter(
            (error) => error !== undefined,
          );
          try {
            release?.();
          } catch (error) {
            failures.push(error);
          }
          if (failures.length === 1) throw failures[0];
          if (failures.length > 1)
            throw new AggregateError(
              failures,
              "Child exited with process or lease cleanup errors; inspect recovery state.",
            );
          resolve({ code, signal, output, stdout, aborted: options.signal?.aborted === true });
        })
        .catch(reject);
    });
    if (child.pid !== undefined && options.context !== undefined) {
      try {
        release = trackOperationChild(
          options.context,
          child.pid,
          options.persistentResources ??
            options.context.resources.filter((r) => r.startsWith("checkout:")),
          options.leaseEnv,
        );
      } catch (error) {
        registrationError = error;
        if (error instanceof ChildRegistrationError) release = error.release;
        abort();
      }
    }
  });
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
