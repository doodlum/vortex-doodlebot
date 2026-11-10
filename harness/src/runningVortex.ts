/**
 * The one harness Vortex. doodlebot runs a single instance per machine at a time; every
 * launcher, in every workspace, records it in one per-user file (`~/.doodlebot/instance.json`),
 * whatever cache it uses, so any command can tell whether it is running. The refusals here
 * protect data, not ownership: they stop a second launch, a rebuild of the checkout Vortex runs
 * from, and similar damage.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ConfigError } from "./errors";
import { restoreNxmHandlerOrWarn, type NxmHandler } from "./nxmHandler";
import { USER_STATE_DIR, normalizedPath } from "./paths";
import { processAlive, processImageName } from "./processes";

export const INSTANCE_RECORD = path.join(USER_STATE_DIR, "instance.json");

export interface InstanceRecord {
  pid: number;
  startedAt: string;
  /** The cache whose profile this Vortex uses. */
  cacheDir: string;
  userDataDir: string;
  mcpPort: number;
  /** The Vortex checkout it runs from, for a source build. */
  sourceDir?: string;
  /** The executable it runs, for a released build. */
  exe?: string;
  /** The nxm link handler before the launch, written back when this Vortex is gone. */
  nxmHandler?: NxmHandler;
}

const VORTEX_IMAGES = new Set(["vortex.exe", "electron.exe", "vortex", "electron"]);

/** Write the record; throws so a launcher can stop the child it could not record. */
export function writeInstanceRecord(record: InstanceRecord): void {
  fs.mkdirSync(path.dirname(INSTANCE_RECORD), { recursive: true });
  // Written beside it and renamed over it: a reader never sees half a record (and deletes it).
  const temporary = `${INSTANCE_RECORD}.${String(process.pid)}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(record, null, 2));
    fs.renameSync(temporary, INSTANCE_RECORD);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function readInstanceRecord(): InstanceRecord | undefined {
  return readInstanceRecordFile(INSTANCE_RECORD);
}

/** A record file in the current format, or undefined when it is missing or unreadable. */
export function readInstanceRecordFile(file: string): InstanceRecord | undefined {
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const r = value as Record<string, unknown>;
  if (
    !Number.isInteger(r.pid) ||
    typeof r.cacheDir !== "string" ||
    typeof r.userDataDir !== "string" ||
    typeof r.startedAt !== "string" ||
    !Number.isInteger(r.mcpPort)
  )
    return undefined;
  return {
    pid: r.pid as number,
    startedAt: r.startedAt,
    cacheDir: r.cacheDir,
    userDataDir: r.userDataDir,
    mcpPort: r.mcpPort as number,
    ...(typeof r.sourceDir === "string" ? { sourceDir: r.sourceDir } : {}),
    ...(typeof r.exe === "string" ? { exe: r.exe } : {}),
    ...nxmHandlerOf(r.nxmHandler),
  };
}

function nxmHandlerOf(value: unknown): { nxmHandler?: NxmHandler } {
  if (typeof value !== "object" || value === null) return {};
  const v = value as Record<string, unknown>;
  if (v.absent === true) return { nxmHandler: { absent: true } };
  return typeof v.command === "string" ? { nxmHandler: { command: v.command } } : {};
}

/**
 * Delete the record; with a pid, only when the record names that pid. Called once that Vortex is
 * known to be gone, so the nxm link handler it recorded is written back first.
 */
export function clearInstanceRecord(pid?: number): void {
  const record = readInstanceRecord();
  if (pid !== undefined && record?.pid !== pid) return;
  if (record?.nxmHandler !== undefined) restoreNxmHandlerOrWarn(record.nxmHandler);
  fs.rmSync(INSTANCE_RECORD, { force: true });
}

/**
 * The running harness Vortex, or undefined. A record whose pid is dead, or now belongs to a
 * process that is not Vortex or Electron (pid reuse after a crash), is stale and is cleared.
 */
export function runningVortex(): InstanceRecord | undefined {
  const record = readInstanceRecord();
  if (record === undefined) {
    if (fs.existsSync(INSTANCE_RECORD)) fs.rmSync(INSTANCE_RECORD, { force: true });
    return undefined;
  }
  if (!isVortexProcess(record.pid)) {
    clearInstanceRecord(record.pid);
    return undefined;
  }
  return record;
}

/** The running rule: the pid is alive and its image is Vortex or Electron. */
export function isVortexProcess(pid: number): boolean {
  const image = processAlive(pid) ? processImageName(pid) : undefined;
  return image !== undefined && VORTEX_IMAGES.has(image);
}

export function assertNoHarnessVortex(action: string): void {
  const running = runningVortex();
  if (running !== undefined)
    throw new ConfigError(
      `A harness Vortex is running (pid ${running.pid}, cache ${running.cacheDir}); run \`doodlebot down\` before ${action}.`,
    );
}

export function assertNoVortexRunningFrom(checkout: string, action: string): void {
  const running = runningVortex();
  if (
    running?.sourceDir !== undefined &&
    normalizedPath(running.sourceDir) === normalizedPath(checkout)
  )
    throw new ConfigError(
      `A harness Vortex is running from ${checkout} (pid ${running.pid}); run \`doodlebot down\` before ${action}.`,
    );
}

/** What a launch runs: the checkout of a source build, or the executable of a released one. */
export function buildOf(target: {
  kind: string;
  executable: string;
  sourceDir?: string | undefined;
}): string {
  return target.kind === "dev" && target.sourceDir !== undefined
    ? target.sourceDir
    : target.executable;
}

/** The build a record's Vortex runs, when the record says. */
export function recordedBuild(record: InstanceRecord): string | undefined {
  return record.sourceDir ?? record.exe;
}

export function sameBuild(a: string | undefined, b: string | undefined): boolean {
  return a !== undefined && b !== undefined && normalizedPath(a) === normalizedPath(b);
}

/** The checked-out branch of a git checkout, or undefined. */
export function gitBranch(dir: string): string | undefined {
  try {
    const branch = execFileSync("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return branch === "" ? undefined : branch === "HEAD" ? "detached HEAD" : branch;
  } catch {
    return undefined;
  }
}

/** "from <checkout> (branch <b>)", "from <exe>", or "from an unrecorded build". */
export function describeRecordedBuild(
  record: InstanceRecord,
  branchOf: (dir: string) => string | undefined = gitBranch,
): string {
  if (record.sourceDir !== undefined) {
    const branch = branchOf(record.sourceDir);
    return `from ${record.sourceDir}${branch === undefined ? "" : ` (branch ${branch})`}`;
  }
  return record.exe !== undefined ? `from ${record.exe}` : "from an unrecorded build";
}

/**
 * `up` and `bootstrap` restart this cache's leftover only when it runs the build they launch.
 * Another build's Vortex belongs to another session (another worktree, another release): the
 * launch refuses, naming it, and leaves it running. Undefined means the restart may go on.
 */
export function leftoverRefusal(
  record: InstanceRecord,
  build: string,
  branchOf: (dir: string) => string | undefined = gitBranch,
): string | undefined {
  if (sameBuild(recordedBuild(record), build)) return undefined;
  return (
    `A harness Vortex of another build is running ${describeRecordedBuild(record, branchOf)} ` +
    `(pid ${String(record.pid)}); run \`doodlebot down\` before starting Vortex.`
  );
}
