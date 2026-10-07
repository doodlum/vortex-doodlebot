/**
 * `doodlebot lease run --owner X -- <command...>`: run any command holding the leases.
 *
 * This is how things the kit does not launch itself (`pnpm run verify`, an ad-hoc script,
 * Vortex's E2E suite by hand) are serialized with everything that does. The child gets
 * VORTEX_AI_OWNER, so kit commands inside it join the lease rather than refusing.
 */
import { commandEnv } from "./source";
import { abortOnSignals, runEvidenceProcess } from "./processRunner";
import { claimOperations, inheritedOperation, type OperationContext } from "./operations";

/**
 * Where the caller ran the command from. `pnpm run ai -- lease run …` starts the CLI in this
 * repo's root, whatever directory the caller was in, so `process.cwd()` is always the kit. pnpm
 * (and npm) keep the caller's directory in INIT_CWD. Without this, `lease run pnpm run verify`
 * from a worktree ran the kit's scripts instead, under the kit's pnpm.
 */
export function callerCwd(explicit?: string, env: NodeJS.ProcessEnv = process.env): string {
  if (explicit !== undefined) return explicit;
  const init = env.INIT_CWD;
  return init !== undefined && init !== "" ? init : process.cwd();
}

import {
  holdLease,
  waitForLease,
  type HoldResult,
  type LeaseEnv,
  type LeaseHeldError,
  type LeaseState,
  requireNamedOwner,
} from "./lease";

export interface RunUnderLeaseOptions {
  context?: OperationContext;
  command: string;
  args: string[];
  owner: string;
  resources: string[];
  purpose?: string;
  /** How long to wait for another owner's lease to end. 0: refuse at once. */
  waitMs?: number;
  leaseEnv?: LeaseEnv;
  cwd?: string;
  /** Run through the shell (default on Windows, where pnpm and friends are .cmd files). */
  shell?: boolean;
  /** Extra environment for the command, on top of this process's and VORTEX_AI_OWNER. */
  env?: NodeJS.ProcessEnv;
  onWaiting?: (error: LeaseHeldError) => void;
  onReclaim?: (state: LeaseState) => void;
}

function quoteForShell(arg: string): string {
  return /^[\w@%+=:,./\\-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`;
}

/** Acquire, run with inherited stdio, release however it ends; resolves to its exit code. */
export async function runUnderLease(options: RunUnderLeaseOptions): Promise<number> {
  requireNamedOwner(options.owner);
  const held: HoldResult[] = [];
  const context =
    options.context ?? inheritedOperation(options.owner, process.env, options.leaseEnv);
  let operation: ReturnType<typeof claimOperations> | undefined;
  const releaseAll = (): void => {
    operation?.release();
    operation = undefined;
    for (const hold of held.splice(0).toReversed()) hold.release();
  };
  const holdAll = (): void => {
    try {
      for (const resource of [...new Set(options.resources)].toSorted()) {
        held.push(
          holdLease(resource, options.owner, {
            ...options.leaseEnv,
            purpose: options.purpose ?? `lease run: ${options.command} ${options.args.join(" ")}`,
            onReclaim: options.onReclaim,
          }),
        );
      }
      operation = claimOperations(options.resources, options.owner, {
        context,
        leaseEnv: options.leaseEnv,
      });
    } catch (error) {
      releaseAll();
      throw error;
    }
  };
  let cancellation: ReturnType<typeof abortOnSignals> | undefined;
  try {
    await waitForLease(
      holdAll,
      context === undefined ? (options.waitMs ?? 0) : 0,
      options.onWaiting,
    );
    cancellation = abortOnSignals();
    const shell = options.shell ?? process.platform === "win32";
    const result = await runEvidenceProcess({
      executable: shell
        ? [options.command, ...options.args].map(quoteForShell).join(" ")
        : options.command,
      args: shell ? [] : options.args,
      cwd: callerCwd(options.cwd),
      shell,
      stdin: "inherit",
      env: { ...commandEnv(callerCwd(options.cwd)), ...options.env },
      context: operation!.context,
      leaseEnv: options.leaseEnv,
      persistentResources: options.resources,
      signal: cancellation.signal,
      onOutput: (chunk) => process.stdout.write(chunk),
    });
    return result.aborted ? 130 : (result.code ?? (result.signal === null ? 1 : 128));
  } finally {
    cancellation?.dispose();
    releaseAll();
  }
}
