/**
 * The kit lock: one agent at a time changes doodlebot itself.
 *
 * Any number of agent sessions can work on Vortex at once, each in its own worktree and slot,
 * each looking after its own issue, review and PR. What they share is this repo: KNOWLEDGE.md,
 * the skills, the harness and the docs, in one working tree. Two sessions editing it at once
 * overwrite each other, and two pushing at once race. So a session that wants to change the kit
 * takes the `kit` lease first, pulls the latest main, edits, runs `pnpm run ci`, commits, pushes
 * with `kit push`, and releases. Everyone else waits (`kit lock --wait <minutes>`).
 *
 * The reservation expires unless its exact live acquisition is conditionally renewed.
 * Expiry or replacement stops further mutations; known running children retain protection.
 */
import { execFileSync } from "node:child_process";

import { ConfigError } from "./errors";
import {
  ANONYMOUS_OWNER,
  acquireLease,
  readLease,
  releaseLease,
  renewLease,
  type AcquireResult,
  type LeaseEnv,
  type ReleaseResult,
  type Lease,
  LeaseHeldError,
} from "./lease";
import { REPO_ROOT } from "./paths";
import { withOperations, operationResource, type OperationContext } from "./operations";

import { abortOnSignals, runEvidenceProcess } from "./processRunner";

export const KIT_RESOURCE = "kit";
/** Renew the exact live acquisition before this reservation expires. */
export const DEFAULT_KIT_LOCK_MINUTES = 30;

export function kitLockHolder(env: LeaseEnv = {}): string | undefined {
  const state = readLease(KIT_RESOURCE, env);
  return state?.live === true ? state.lease.owner : undefined;
}

export function lockKit(
  owner: string,
  options: LeaseEnv & { ttlMinutes?: number; purpose?: string } = {},
): AcquireResult {
  if (owner === ANONYMOUS_OWNER)
    throw new ConfigError("The kit lock needs a name: pass --owner (or VORTEX_AI_OWNER).");
  const existing = readLease(KIT_RESOURCE, options);
  const operation = readLease(operationResource(KIT_RESOURCE), options);
  if (operation?.live === true && (existing?.live !== true || existing.lease.owner !== owner))
    throw new LeaseHeldError(operation, owner);
  if (existing?.lease.owner === owner && existing.lease.acquisitionId !== undefined) {
    const lease = renewLease(
      KIT_RESOURCE,
      owner,
      existing.lease.acquisitionId,
      options.ttlMinutes ?? DEFAULT_KIT_LOCK_MINUTES,
      options,
    );
    return { lease, joined: true };
  }
  return acquireLease(KIT_RESOURCE, owner, {
    ...options,
    mode: "explicit",
    ttlMinutes: options.ttlMinutes ?? DEFAULT_KIT_LOCK_MINUTES,
    purpose: options.purpose ?? "changing the doodlebot kit",
  });
}

export function unlockKit(
  owner: string,
  options: LeaseEnv & { force?: boolean; acquisitionId?: string; repo?: string } = {},
): ReleaseResult {
  if (options.force !== true && !options.acquisitionId)
    throw new ConfigError(
      "kit unlock requires --acquisition from the original kit lock; use --force only for inspected recovery.",
    );
  const existing = readLease(KIT_RESOURCE, options);
  if (existing !== undefined && existing.lease.owner !== owner && options.force !== true)
    return {
      released: false,
      reason: `held by ${existing.lease.owner}; cannot release another acquisition`,
      stillRunning: [],
    };
  if (readLease(operationResource(KIT_RESOURCE), options)?.live === true)
    throw new ConfigError(
      "A kit operation or recorded child is still running; inspect subprocesses before releasing its lock.",
    );
  if (
    options.repo !== undefined &&
    execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: options.repo,
      encoding: "utf8",
    }).trim() !== ""
  )
    throw new ConfigError(
      "Cannot unlock a kit with uncommitted or untracked changes. Preserve and commit the work first.",
    );
  return releaseLease(KIT_RESOURCE, owner, options);
}

/** Refuse unless `owner` holds the kit lock right now. */
export function requireKitLock(owner: string, env: LeaseEnv = {}): Lease {
  const holder = kitLockHolder(env);
  if (holder === owner) return readLease(KIT_RESOURCE, env)!.lease;
  throw new ConfigError(
    holder === undefined
      ? `Take the kit lock first: pnpm run ai -- kit lock --owner ${owner}`
      : `The kit lock is held by "${holder}". Wait for it: pnpm run ai -- kit lock --owner ${owner} --wait 30`,
  );
}

export type GitRunner = (
  args: string[],
  cwd: string,
  context?: OperationContext,
  env?: LeaseEnv,
) => Promise<string>;

const runGit: GitRunner = async (args, cwd, context, env) => {
  const cancellation = abortOnSignals();
  try {
    const result = await runEvidenceProcess({
      executable: "git",
      args,
      cwd,
      context,
      leaseEnv: env,
      persistentResources: [KIT_RESOURCE],
      signal: cancellation.signal,
    });
    if (result.aborted) throw new Error("Git was interrupted; child exit confirmed.");
    if (result.code !== 0) throw new Error(result.output.trim() || `exit ${result.code}`);
    return result.stdout.trim();
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.trim();
    throw new ConfigError(`git ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`, {
      cause: err,
    });
  } finally {
    cancellation.dispose();
  }
};

export interface KitPushOptions extends LeaseEnv {
  owner: string;
  /** The branch the kit lives on. Default main. */
  branch?: string;
  remote?: string;
  repo?: string;
  git?: GitRunner;
  onProgress?: (message: string) => void;
}

/**
 * Push the kit's committed changes, under the lock: refuses without it, and with uncommitted
 * changes (commit them, or they'd be someone else's to find). Rebases the local branch onto
 * the remote's first, so a push never overwrites another session's, then pushes. Returns the
 * pushed sha.
 */
export async function pushKit(options: KitPushOptions): Promise<string> {
  return withKitOperation(options, (git) => pushInside({ ...options, git }));
}

async function pushInside(options: KitPushOptions): Promise<string> {
  const report = options.onProgress ?? ((): void => undefined);
  const git = options.git ?? runGit;
  const repo = options.repo ?? REPO_ROOT;
  const remote = options.remote ?? "origin";
  const branch = options.branch ?? "main";
  requireKitLock(options.owner, options);

  const dirty = (await git(["status", "--porcelain", "--untracked-files=all"], repo))
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");
  if (dirty.length > 0)
    throw new ConfigError(
      `The kit has uncommitted changes; commit them first:\n${dirty.slice(0, 20).join("\n")}`,
    );
  const current = await git(["rev-parse", "--abbrev-ref", "HEAD"], repo);
  if (current !== branch)
    throw new ConfigError(
      `The kit is on "${current}", not "${branch}". Merge your work into ${branch} first ` +
        `(git switch ${branch} && git merge --ff-only ${current}).`,
    );
  const proposedHead = await git(["rev-parse", "HEAD"], repo);
  report(`fetching ${remote}`);
  await git(["fetch", remote, branch], repo);
  report(`rebasing ${branch} onto ${remote}/${branch}`);
  await git(["rebase", `${remote}/${branch}`], repo);
  const rebasedHead = await git(["rev-parse", "HEAD"], repo);
  if (rebasedHead !== proposedHead)
    throw new ConfigError(
      `Rebase changed HEAD from ${proposedHead} to ${rebasedHead}. Nothing was pushed. ` +
        `The rebased work is intact; rerun checks and review on this HEAD, then call kit push again.`,
    );
  report(`pushing ${branch}`);
  await git(["push", remote, `${branch}:${branch}`], repo);
  return git(["rev-parse", "HEAD"], repo);
}

/**
 * Bring the kit up to date before editing, under the lock: fast-forward the branch to the
 * remote's. Refuses with uncommitted changes, or a branch that has diverged (rebase it yourself).
 */
export async function syncKit(options: KitPushOptions): Promise<string> {
  return withKitOperation(options, (git) => syncInside({ ...options, git }));
}

async function syncInside(options: KitPushOptions): Promise<string> {
  const report = options.onProgress ?? ((): void => undefined);
  const git = options.git ?? runGit;
  const repo = options.repo ?? REPO_ROOT;
  const remote = options.remote ?? "origin";
  const branch = options.branch ?? "main";
  requireKitLock(options.owner, options);
  const dirty = (await git(["status", "--porcelain", "--untracked-files=all"], repo)).trim();
  if (dirty !== "")
    throw new ConfigError(
      `The kit has uncommitted changes; commit or discard them first:\n${dirty}`,
    );
  const current = await git(["rev-parse", "--abbrev-ref", "HEAD"], repo);
  if (current !== branch) {
    report(`switching to ${branch}`);
    await git(["switch", branch], repo);
  }
  report(`fetching ${remote}`);
  await git(["fetch", remote, branch], repo);
  await git(["merge", "--ff-only", `${remote}/${branch}`], repo);
  return git(["rev-parse", "HEAD"], repo);
}

/** Lost ownership prevents subsequent Git operations; already-running Git is not fenced. */
async function withKitOperation<T>(
  options: KitPushOptions,
  fn: (git: GitRunner) => Promise<T>,
): Promise<T> {
  const lease = requireKitLock(options.owner, options);
  if (lease.acquisitionId === undefined)
    throw new ConfigError(
      "Renew the kit lock to initialize its acquisition identity before Git operations.",
    );
  const id = lease.acquisitionId;
  return withOperations([KIT_RESOURCE], options.owner, { leaseEnv: options }, async (context) => {
    let lost: unknown;
    const renew = (): void => {
      renewLease(KIT_RESOURCE, options.owner, id, DEFAULT_KIT_LOCK_MINUTES, options);
    };
    const timer = setInterval(() => {
      try {
        renew();
      } catch (error) {
        lost = error;
      }
    }, 10_000);
    timer.unref();
    try {
      const result = await fn(async (args, cwd) => {
        if (lost !== undefined) throw lost;
        renew();
        return (options.git ?? runGit)(args, cwd, context, options);
      });
      if (lost !== undefined) throw lost;
      renew();
      return result;
    } finally {
      clearInterval(timer);
    }
  });
}
