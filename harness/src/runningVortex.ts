/**
 * The one harness Vortex. doodlebot runs a single instance at a time; every launcher records
 * it in one fixed file, whatever cache it uses, so any command can tell whether it is running.
 * The refusals here protect data, not ownership: they stop a second launch, a rebuild of the
 * checkout Vortex runs from, and similar damage.
 */
import fs from "node:fs";
import path from "node:path";
import { ConfigError } from "./errors";
import { DEFAULT_CACHE_DIR, normalizedPath } from "./paths";
import { processAlive, processImageName } from "./processes";

export const INSTANCE_RECORD = path.join(DEFAULT_CACHE_DIR, "instance.json");

export interface InstanceRecord {
  pid: number;
  startedAt: string;
  /** The cache whose profile this Vortex uses. */
  cacheDir: string;
  userDataDir: string;
  mcpPort: number;
  /** The Vortex checkout it runs from, for a source build. */
  sourceDir?: string;
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
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(INSTANCE_RECORD, "utf8"));
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
  };
}

/** Delete the record; with a pid, only when the record names that pid. */
export function clearInstanceRecord(pid?: number): void {
  if (pid !== undefined && readInstanceRecord()?.pid !== pid) return;
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
  const image = processAlive(record.pid) ? processImageName(record.pid) : undefined;
  if (image === undefined || !VORTEX_IMAGES.has(image)) {
    clearInstanceRecord(record.pid);
    return undefined;
  }
  return record;
}

export function assertNoHarnessVortex(action: string): void {
  const running = runningVortex();
  if (running !== undefined)
    throw new ConfigError(
      `A harness Vortex is running (pid ${running.pid}, cache ${running.cacheDir}); run \`pnpm run ai -- down\` before ${action}.`,
    );
}

export function assertNoVortexRunningFrom(checkout: string, action: string): void {
  const running = runningVortex();
  if (
    running?.sourceDir !== undefined &&
    normalizedPath(running.sourceDir) === normalizedPath(checkout)
  )
    throw new ConfigError(
      `A harness Vortex is running from ${checkout} (pid ${running.pid}); run \`pnpm run ai -- down\` before ${action}.`,
    );
}
