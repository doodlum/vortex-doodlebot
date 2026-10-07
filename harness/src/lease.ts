/**
 * Machine-wide leases: who may start, stop or drive Vortex, and who may patch a checkout.
 *
 * Several agent sessions (and their fix and QA subagents) may use this kit at once. Before
 * leases, `up` quietly quit whatever harness instance was running, so a second agent ended
 * the first one's session. Each cache runs one Vortex; agents that need one each take a slot
 * of their own (slots.ts), whose cache has its own instance lease.
 *
 * A lease is a JSON file in a directory shared by every kit checkout on the machine
 * (`~/.vortex-ai/leases`, or `VORTEX_AI_LEASE_DIR`). Its resource key says what it guards:
 * `instance` for the default cache's Vortex, `instance:<cache dir>` for any other cache's,
 * `checkout:<path>` for a Vortex checkout a command rewrites.
 *
 * Two kinds:
 *   - **implicit**: taken by a command for as long as it runs. It is live while any holder
 *     process, or any Vortex that command launched, is alive. `up` ends with only the
 *     Vortex left holding it, so the lease lasts until `down`.
 *   - **explicit**: taken with `doodlebot lease acquire`. It is live until its TTL passes
 *     (re-acquiring renews it) or, with `--pid`, while that process lives.
 *
 * A lease whose holder is gone is stale and is reclaimed by the next acquirer, which says
 * so. Acquisition runs under an exclusive-create mutex so two agents cannot both win.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

import { ConfigError } from "./errors";
import { parseJson } from "./jsonFile";

export const ANONYMOUS_OWNER = "anonymous";
export const INSTANCE_RESOURCE = "instance";

export type LeaseMode = "implicit" | "explicit";

export interface Lease {
  acquisitionId: string;
  resource: string;
  owner: string;
  mode: LeaseMode;
  purpose?: string;
  acquiredAt: string;
  /** Last acquire or renewal by the owner. */
  heartbeatAt: string;
  /** Explicit leases only: when the lease lapses unless renewed. */
  expiresAt?: string;
  /** Explicit leases only: the process whose life the lease is bound to (`--pid`). */
  boundPid?: number;
  /** Processes currently holding the lease: the acquirer and same-owner joiners. */
  holders: number[];
  /** Vortex processes launched under this lease. */
  instancePids: number[];
  host: string;
}

export interface LeaseEnv {
  /** Directory holding the lease files. Default: leaseDir(). */
  dir?: string;
  isAlive?: (pid: number) => boolean;
  now?: () => number;
}

export interface LeaseState {
  lease: Lease;
  live: boolean;
  /** Why a lease is stale, or what keeps it live. */
  reason: string;
}

export function leaseDir(): string {
  const explicit = process.env.VORTEX_AI_LEASE_DIR;
  return explicit !== undefined && explicit !== ""
    ? path.resolve(explicit)
    : path.join(os.homedir(), ".vortex-ai", "leases");
}

/** `--owner`, else VORTEX_AI_OWNER, else "anonymous". */
export function resolveOwner(flag?: string): string {
  const value = flag ?? process.env.VORTEX_AI_OWNER;
  return value === undefined || value.trim() === "" ? ANONYMOUS_OWNER : value.trim();
}

/** Supported live operations never infer an anonymous worker. */
export function requireNamedOwner(flag?: string): string {
  const owner = resolveOwner(flag);
  if (owner === ANONYMOUS_OWNER)
    throw new ConfigError("A named owner is required: pass --owner <worker> or VORTEX_AI_OWNER.");
  return owner;
}

/** The resource key for a Vortex checkout, the same however the path is spelled. */
export function checkoutResource(dir: string): string {
  return `checkout:${normalizedPath(dir)}`;
}

/** `instance` or `instance:<cache dir>`: a lease on a running Vortex rather than a checkout. */
export function isInstanceResource(resource: string): boolean {
  return resource === INSTANCE_RESOURCE || resource.startsWith(`${INSTANCE_RESOURCE}:`);
}

/** A path spelled the same however it was given: resolved, real, forward slashes. */
export function normalizedPath(dir: string): string {
  let resolved = path.resolve(dir);
  let ancestor = resolved;
  const missing: string[] = [];
  for (;;) {
    try {
      resolved = path.join(fs.realpathSync.native(ancestor), ...missing);
      break;
    } catch {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) break;
      missing.unshift(path.basename(ancestor));
      ancestor = parent;
    }
  }
  resolved = resolved.replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function fileFor(dir: string, resource: string): string {
  const safe = resource === INSTANCE_RESOURCE ? resource : (resource.split(":")[0] ?? "resource");
  const suffix =
    resource === INSTANCE_RESOURCE
      ? ""
      : `-${createHash("sha256").update(resource).digest("hex").slice(0, 12)}`;
  return path.join(dir, `${safe}${suffix}.json`);
}

export function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // Signal 0 performs the permission/existence check without delivering one.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists, but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function resolveEnv(env: LeaseEnv = {}): Required<LeaseEnv> {
  return {
    dir: env.dir ?? leaseDir(),
    isAlive: env.isAlive ?? processAlive,
    now: env.now ?? Date.now,
  };
}

export function evaluateLease(lease: Lease, env: LeaseEnv = {}): LeaseState {
  const { isAlive, now } = resolveEnv(env);
  const holders = lease.holders.filter(isAlive);
  const instances = lease.instancePids.filter(isAlive);
  if (lease.mode === "explicit") {
    // An idle reservation may expire; a running application must remain protected.
    if (instances.length > 0)
      return { lease, live: true, reason: `Vortex pid ${instances.join(", ")} still running` };
    if (holders.length > 0)
      return { lease, live: true, reason: `command pid ${holders.join(", ")} still running` };
    if (lease.expiresAt !== undefined && Date.parse(lease.expiresAt) <= now()) {
      return { lease, live: false, reason: `expired at ${lease.expiresAt}` };
    }
    if (lease.boundPid !== undefined && !isAlive(lease.boundPid)) {
      return { lease, live: false, reason: `bound process ${String(lease.boundPid)} exited` };
    }
    const until = lease.expiresAt === undefined ? "no expiry" : `until ${lease.expiresAt}`;
    const bound = lease.boundPid === undefined ? "" : `, while pid ${String(lease.boundPid)} runs`;
    return { lease, live: true, reason: `explicit, ${until}${bound}` };
  }
  if (holders.length === 0 && instances.length === 0) {
    const was = [...lease.holders, ...lease.instancePids];
    return {
      lease,
      live: false,
      reason: was.length === 0 ? "no holder recorded" : `holder process ${was.join(", ")} exited`,
    };
  }
  const parts = [
    holders.length > 0 ? `command pid ${holders.join(", ")}` : undefined,
    instances.length > 0 ? `Vortex pid ${instances.join(", ")}` : undefined,
  ].filter((p) => p !== undefined);
  return { lease, live: true, reason: `held by ${parts.join(" and ")}` };
}

const leaseSchema = z.strictObject({
  acquisitionId: z.uuid(),
  resource: z.string().min(1),
  owner: z.string().min(1),
  mode: z.enum(["implicit", "explicit"]),
  purpose: z.string().optional(),
  acquiredAt: z.iso.datetime(),
  heartbeatAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().optional(),
  boundPid: z.number().int().positive().optional(),
  holders: z.array(z.number().int().positive()),
  instancePids: z.array(z.number().int().positive()),
  host: z.string().min(1),
});

function readFile(file: string): Lease | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new ConfigError(`Cannot read lease ${file}; inspect ownership before recovery.`, {
      cause: error,
    });
  }
  try {
    const lease = leaseSchema.parse(parseJson<unknown>(raw));
    if (fileFor(path.dirname(file), lease.resource) !== file)
      throw new Error("resource does not match its lease filename");
    return lease;
  } catch (error) {
    throw new ConfigError(
      `Invalid lease ${file}; preserve it and inspect ownership before recovery.`,
      {
        cause: error,
      },
    );
  }
}

function writeFile(file: string, lease: Lease): void {
  const tmp = `${file}.${String(process.pid)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(lease, null, 2)}\n`);
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      // A reader holding the file open makes Windows refuse the replace for a moment.
      if (attempt >= 20) {
        fs.rmSync(tmp, { force: true });
        throw err;
      }
      sleepSync(25);
    }
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Run `fn` holding the lease directory's mutex, so read-modify-write is atomic. */
export function withLeaseMutex<T>(dir: string, fn: () => T): T {
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, ".mutex");
  const identity = JSON.stringify({ pid: process.pid, id: randomUUID() });
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      const fd = fs.openSync(lock, "wx");
      try {
        fs.writeFileSync(fd, identity);
      } catch (error) {
        fs.rmSync(lock, { force: true });
        throw error;
      } finally {
        fs.closeSync(fd);
      }
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      // Age cannot distinguish a dead owner from a paused process. Ambiguous mutexes
      // require explicit recovery; competing reclaimers must not unlink a successor.
      if (Date.now() > deadline) {
        throw new ConfigError(
          `Timed out waiting for ${lock}; inspect its recorded process and lease state before explicit recovery.`,
          { cause: err },
        );
      }
      sleepSync(20);
    }
  }
  let result!: T;
  const failures: unknown[] = [];
  try {
    result = fn();
  } catch (error) {
    failures.push(error);
  }
  try {
    if (!fs.existsSync(lock) || fs.readFileSync(lock, "utf8") !== identity)
      throw new ConfigError(`Lost mutex acquisition ${lock}; a replacement was left untouched.`);
    fs.rmSync(lock);
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(
      failures,
      "Lease update and mutex cleanup failed; inspect recovery state.",
    );
  return result;
}

export class LeaseHeldError extends ConfigError {
  constructor(
    readonly state: LeaseState,
    readonly requestedBy: string,
  ) {
    super(describeHeld(state, requestedBy));
  }
}

function describeHeld(state: LeaseState, requestedBy: string): string {
  const { lease } = state;
  if (lease.resource.startsWith("operation:"))
    return (
      `An independent operation is still running for ${lease.resource.slice("operation:".length)}` +
      `${lease.purpose === undefined ? "" : ` (${lease.purpose})`}; refusing overlapping work.\n` +
      `Independent commands are excluded even when they use the same named owner. ` +
      `Wait for the known operation to finish; after interruption inspect its recorded child processes. ` +
      `Retry the root operation after releasing partial holds. Execution contexts are only for intentional nested commands.`
    );
  const instance = isInstanceResource(lease.resource);
  const what =
    lease.resource === INSTANCE_RESOURCE
      ? "The Vortex instance lease"
      : instance
        ? `The Vortex instance lease for ${lease.resource.slice(INSTANCE_RESOURCE.length + 1)}`
        : `The lease on ${lease.resource.slice("checkout:".length)}`;
  const purpose = lease.purpose === undefined ? "" : ` for "${lease.purpose}"`;
  return (
    `${what} is held by "${lease.owner}"${purpose} since ${lease.acquiredAt} ` +
    `(${state.reason}); refusing to act as "${requestedBy}".\n\n` +
    `  See who holds it:   pnpm run ai -- lease status\n` +
    `  Wait for it:        pnpm run ai -- lease run --owner ${requestedBy} --wait 60 -- <command>\n` +
    `  Holder releases:    pnpm run ai -- lease release --owner ${lease.owner}` +
    (instance ? `   (or down --owner ${lease.owner})` : "") +
    `\n\n` +
    `Use the same --owner (or VORTEX_AI_OWNER) for every command in one session.` +
    (instance
      ? `\nFor a Vortex of your own alongside it, add --slot auto (harness/AGENTS.md, ` +
        `"Parallel sessions").`
      : "")
  );
}

export interface AcquireOptions extends LeaseEnv {
  mode?: LeaseMode;
  purpose?: string;
  /** Holder process to record. Implicit leases default to this process. */
  pid?: number;
  /** Explicit leases: minutes until the lease lapses. 0 or undefined: no expiry. */
  ttlMinutes?: number;
  /** Explicit leases: stay live only while this process runs. */
  boundPid?: number;
}

export interface AcquireResult {
  lease: Lease;
  /** Same owner already held it; this call joined (or renewed) that lease. */
  joined: boolean;
  /** A stale lease that this call replaced, with why it was stale. */
  reclaimed?: LeaseState;
}

export function acquireLease(
  resource: string,
  owner: string,
  options: AcquireOptions = {},
): AcquireResult {
  const env = resolveEnv(options);
  const mode = options.mode ?? "implicit";
  const pid = options.pid ?? (mode === "implicit" ? process.pid : undefined);
  const file = fileFor(env.dir, resource);
  return withLeaseMutex(env.dir, () => {
    const nowIso = new Date(env.now()).toISOString();
    const expiresAt =
      mode === "explicit" && options.ttlMinutes !== undefined && options.ttlMinutes > 0
        ? new Date(env.now() + options.ttlMinutes * 60_000).toISOString()
        : undefined;
    const existing = readFile(file);
    let reclaimed: LeaseState | undefined;
    if (existing !== undefined) {
      const state = evaluateLease(existing, env);
      if (state.live) {
        if (existing.owner !== owner) throw new LeaseHeldError(state, owner);
        const joined: Lease = {
          ...existing,
          acquisitionId: existing.acquisitionId,
          holders: [
            ...new Set([
              ...existing.holders.filter(env.isAlive),
              ...(pid === undefined ? [] : [pid]),
            ]),
          ],
          instancePids: existing.instancePids.filter(env.isAlive),
          heartbeatAt: nowIso,
        };
        if (mode === "explicit") {
          // Re-acquiring renews: the heartbeat of an explicit lease.
          joined.mode = "explicit";
          joined.expiresAt = expiresAt;
          joined.boundPid = options.boundPid;
          if (options.purpose !== undefined) joined.purpose = options.purpose;
        }
        writeFile(file, joined);
        return { lease: joined, joined: true };
      }
      reclaimed = state;
    }
    const lease: Lease = {
      acquisitionId: randomUUID(),
      resource,
      owner,
      mode,
      purpose: options.purpose,
      acquiredAt: nowIso,
      heartbeatAt: nowIso,
      expiresAt,
      boundPid: options.boundPid,
      holders: pid === undefined ? [] : [pid],
      instancePids: [],
      host: os.hostname(),
    };
    writeFile(file, lease);
    return { lease, joined: false, reclaimed };
  });
}

/** Read one lease, evaluated; undefined when nobody holds it. */
export function readLease(resource: string, env: LeaseEnv = {}): LeaseState | undefined {
  const resolved = resolveEnv(env);
  const lease = readFile(fileFor(resolved.dir, resource));
  return lease === undefined ? undefined : evaluateLease(lease, resolved);
}

/** Every lease file, evaluated. */
export function listLeases(env: LeaseEnv = {}): LeaseState[] {
  const resolved = resolveEnv(env);
  let names: string[];
  try {
    names = fs.readdirSync(resolved.dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".json") && name !== "slots.json")
    .map((name) => readFile(path.join(resolved.dir, name)))
    .filter((lease): lease is Lease => lease !== undefined)
    .map((lease) => evaluateLease(lease, resolved));
}

/** Change a lease in place under the mutex; `update` returning undefined deletes it. */
function updateLease(
  resource: string,
  env: LeaseEnv,
  update: (lease: Lease) => Lease | undefined,
): Lease | undefined {
  const resolved = resolveEnv(env);
  const file = fileFor(resolved.dir, resource);
  return withLeaseMutex(resolved.dir, () => {
    const lease = readFile(file);
    if (lease === undefined) return undefined;
    const next = update(lease);
    if (next === lease) return lease;
    if (next === undefined) fs.rmSync(file, { force: true });
    else writeFile(file, next);
    return next;
  });
}

/** An implicit lease nothing holds any more is garbage. */
function pruned(lease: Lease, env: Required<LeaseEnv>): Lease | undefined {
  const next = {
    ...lease,
    holders: lease.holders.filter(env.isAlive),
    instancePids: lease.instancePids.filter(env.isAlive),
  };
  return next.mode === "implicit" && next.holders.length === 0 && next.instancePids.length === 0
    ? undefined
    : next;
}

/**
 * Give up `pid`'s hold. An implicit lease with nothing else holding it is deleted; one
 * that still has a running Vortex stays, held by that Vortex, until `down`.
 */
export function dropHolder(
  resource: string,
  pid: number,
  env: LeaseEnv = {},
  acquisitionId?: string,
): void {
  const resolved = resolveEnv(env);
  updateLease(resource, resolved, (lease) =>
    acquisitionId !== undefined && lease.acquisitionId !== acquisitionId
      ? lease
      : pruned({ ...lease, holders: lease.holders.filter((p) => p !== pid) }, resolved),
  );
}

/** Register a known child so interruption of its wrapper does not expose its resources. */
export interface LeaseIdentity {
  resource: string;
  owner: string;
  acquisitionId: string;
}

export function addHolder(identity: LeaseIdentity, pid: number, env: LeaseEnv = {}): void {
  let registered = false;
  updateLease(identity.resource, env, (lease) => {
    if (
      lease.owner !== identity.owner ||
      lease.acquisitionId !== identity.acquisitionId ||
      !evaluateLease(lease, env).live
    )
      throw new ConfigError(
        `Lost ${identity.resource} acquisition while registering child ${pid}.`,
      );
    registered = true;
    return { ...lease, holders: [...new Set([...lease.holders, pid])] };
  });
  if (!registered)
    throw new ConfigError(`Cannot register child ${pid} on absent ${identity.resource}.`);
}

/** Conditional renewal: expiry/replacement is an error, never a new acquisition. */
export function renewLease(
  resource: string,
  owner: string,
  acquisitionId: string,
  ttlMinutes: number,
  env: LeaseEnv = {},
): Lease {
  const resolved = resolveEnv(env);
  let renewed: Lease | undefined;
  updateLease(resource, resolved, (lease) => {
    if (
      lease.owner !== owner ||
      lease.acquisitionId !== acquisitionId ||
      (lease.expiresAt !== undefined && Date.parse(lease.expiresAt) <= resolved.now()) ||
      !evaluateLease(lease, resolved).live
    )
      throw new ConfigError(
        `Lost ${resource} acquisition ${acquisitionId}; stop mutations and inspect leases and subprocesses before recovery.`,
      );
    const now = resolved.now();
    renewed = {
      ...lease,
      heartbeatAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMinutes * 60_000).toISOString(),
    };
    return renewed;
  });
  if (renewed === undefined)
    throw new ConfigError(
      `Lost ${resource} acquisition ${acquisitionId}; no automatic reacquisition.`,
    );
  return renewed;
}

export function addInstancePid(identity: LeaseIdentity, pid: number, env: LeaseEnv = {}): void {
  let registered = false;
  updateLease(identity.resource, env, (lease) => {
    if (
      lease.owner !== identity.owner ||
      lease.acquisitionId !== identity.acquisitionId ||
      !evaluateLease(lease, env).live
    )
      throw new ConfigError(
        `Lost ${identity.resource} acquisition while registering Vortex ${pid}.`,
      );
    registered = true;
    return { ...lease, instancePids: [...new Set([...lease.instancePids, pid])] };
  });
  if (!registered)
    throw new ConfigError(`Cannot register Vortex ${pid} on absent ${identity.resource}.`);
}

export function removeInstancePid(identity: LeaseIdentity, pid: number, env: LeaseEnv = {}): void {
  const resolved = resolveEnv(env);
  updateLease(identity.resource, resolved, (lease) =>
    lease.owner !== identity.owner || lease.acquisitionId !== identity.acquisitionId
      ? lease
      : pruned({ ...lease, instancePids: lease.instancePids.filter((p) => p !== pid) }, resolved),
  );
}

export interface ReleaseResult {
  released: boolean;
  /** Why nothing was released. */
  reason?: string;
  /** The Vortex processes still running under the released lease. */
  stillRunning: number[];
  /**
   * A lease was not deleted because a Vortex still depends on it: the explicit hold
   * ended, and the lease stays, held by that Vortex, until it exits.
   */
  keptForRunning?: boolean;
}

/**
 * Release a lease outright. Only its owner may, unless `force` (for a human clearing a
 * lease whose owner is known to be gone but whose recorded process is somehow alive).
 */
export function releaseLease(
  resource: string,
  owner: string,
  options: LeaseEnv & { force?: boolean; acquisitionId?: string } = {},
): ReleaseResult {
  const resolved = resolveEnv(options);
  const file = fileFor(resolved.dir, resource);
  return withLeaseMutex(resolved.dir, () => {
    const lease = readFile(file);
    if (lease === undefined) {
      return { released: false, reason: "not held", stillRunning: [] };
    }
    const state = evaluateLease(lease, resolved);
    if (
      options.force !== true &&
      options.acquisitionId !== undefined &&
      (lease.acquisitionId !== options.acquisitionId ||
        lease.owner !== owner ||
        (lease.expiresAt !== undefined && Date.parse(lease.expiresAt) <= resolved.now()) ||
        !state.live)
    )
      return {
        released: false,
        reason: `lost ${resource} acquisition ${options.acquisitionId}; inspect ownership before recovery`,
        stillRunning: [],
      };
    if (lease.owner !== owner && options.force !== true && state.live) {
      return {
        released: false,
        reason: `held by "${lease.owner}", not "${owner}" (pass --force to clear it anyway)`,
        stillRunning: [],
      };
    }
    const running = lease.instancePids.filter(resolved.isAlive);
    if (options.force !== true && running.length > 0) {
      // Ending a reservation must neither expose a live app to another controller nor
      // allow its checkout to be rewritten underneath it.
      writeFile(file, {
        ...lease,
        mode: "implicit",
        expiresAt: undefined,
        boundPid: undefined,
        holders: lease.holders.filter(resolved.isAlive),
        instancePids: running,
      });
      return { released: true, stillRunning: running, keptForRunning: true };
    }
    fs.rmSync(file, { force: true });
    return { released: true, stillRunning: running };
  });
}

/**
 * Acquire several leases for one owner, all or nothing: when one is refused, the ones this
 * call newly took are released again (a lease it only joined or renewed is left as it was),
 * and the refusal is rethrown. `lease acquire --checkout` takes the instance and the checkout
 * this way, the instance first, so a caller refused the instance has touched nothing.
 */
export function acquireLeases(
  resources: string[],
  owner: string,
  options: AcquireOptions = {},
): AcquireResult[] {
  const done: AcquireResult[] = [];
  try {
    for (const resource of resources) done.push(acquireLease(resource, owner, options));
    return done;
  } catch (err) {
    for (const result of done.toReversed()) {
      if (!result.joined) releaseLease(result.lease.resource, owner, options);
    }
    throw err;
  }
}

export interface OwnerRelease extends ReleaseResult {
  resource: string;
}

/**
 * Release every lease `owner` holds: the instance and every checkout, explicit or implicit,
 * live or stale. Each is released as `releaseLease` would, so a checkout a Vortex still runs
 * from stays locked by that Vortex.
 */
export function releaseOwnerLeases(
  owner: string,
  options: LeaseEnv & { force?: boolean } = {},
): OwnerRelease[] {
  return listLeases(options)
    .filter(({ lease }) => lease.owner === owner)
    .map(({ lease }) => lease.resource)
    .toSorted((a, b) => Number(isInstanceResource(a)) - Number(isInstanceResource(b)))
    .map((resource) => ({ resource, ...releaseLease(resource, owner, options) }));
}

// ---------------------------------------------------------------------------
// Holding a lease for the rest of this process
// ---------------------------------------------------------------------------

/** Leases this process holds, with how many nested holds each has. */
const heldHere = new Map<
  string,
  { resource: string; env: LeaseEnv; count: number; acquisitionId?: string }
>();
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once("exit", () => {
    for (const { resource, env, acquisitionId } of heldHere.values()) {
      try {
        dropHolder(resource, process.pid, env, acquisitionId);
      } catch {
        // Best effort at exit; a dead holder makes the lease stale anyway.
      }
    }
  });
}

export interface HoldResult extends AcquireResult {
  /** Stop holding: drop this process as a holder (the lease stays if a Vortex holds it). */
  release: () => void;
}

/**
 * Acquire (or join, for the same owner) an implicit lease held by this process until it
 * exits or `release` is called. Throws LeaseHeldError when another live owner holds it.
 */
export function holdLease(
  resource: string,
  owner: string,
  options: LeaseEnv & { purpose?: string; onReclaim?: (state: LeaseState) => void } = {},
): HoldResult {
  const result = acquireLease(resource, owner, { ...options, mode: "implicit", pid: process.pid });
  if (result.reclaimed !== undefined) options.onReclaim?.(result.reclaimed);
  const key = `${resolveEnv(options).dir}|${resource}|${result.lease.acquisitionId}`;
  const entry = heldHere.get(key) ?? {
    resource,
    env: options,
    count: 0,
    acquisitionId: result.lease.acquisitionId,
  };
  entry.count++;
  heldHere.set(key, entry);
  installExitHook();
  let released = false;
  return {
    ...result,
    release: () => {
      if (released) return;
      released = true;
      // A nested hold (a launch inside a runner that already holds it) must not end the
      // outer one.
      entry.count--;
      if (entry.count > 0) return;
      heldHere.delete(key);
      dropHolder(resource, process.pid, entry.env, entry.acquisitionId);
    },
  };
}

/** Hold several leases for the duration of `fn`, releasing them however it ends. */
export async function withLeases<T>(
  resources: string[],
  owner: string,
  options: LeaseEnv & { purpose?: string; onReclaim?: (state: LeaseState) => void },
  fn: () => Promise<T>,
): Promise<T> {
  const held: HoldResult[] = [];
  try {
    for (const resource of resources) held.push(holdLease(resource, owner, options));
    return await fn();
  } finally {
    for (const hold of held.toReversed()) hold.release();
  }
}

/** Poll until the lease can be acquired or `waitMs` passes; rethrows the last refusal. */
export async function waitForLease<T>(
  attempt: () => T,
  waitMs: number,
  onWaiting?: (error: LeaseHeldError) => void,
  pollMs = 5_000,
): Promise<T> {
  const deadline = Date.now() + waitMs;
  let reported = false;
  for (;;) {
    try {
      return attempt();
    } catch (err) {
      if (!(err instanceof LeaseHeldError) || Date.now() + pollMs > deadline) throw err;
      if (!reported) onWaiting?.(err);
      reported = true;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}

export function formatLeaseStates(states: LeaseState[]): string {
  if (states.length === 0) return "No leases held.";
  return states
    .map(({ lease, live, reason }) => {
      const lines = [
        `${lease.resource}: ${live ? "HELD" : "STALE"} by "${lease.owner}" (${lease.mode})`,
        `  ${live ? "live" : "stale"}: ${reason}`,
        `  since ${lease.acquiredAt}, heartbeat ${lease.heartbeatAt}`,
      ];
      if (lease.purpose !== undefined) lines.push(`  purpose: ${lease.purpose}`);
      if (!live) lines.push("  the next acquirer reclaims it");
      return lines.join("\n");
    })
    .join("\n");
}
