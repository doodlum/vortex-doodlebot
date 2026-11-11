/**
 * Where this kit keeps things. A leaf module with no internal imports, so any module can
 * use it without import cycles.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const HARNESS_ROOT = path.resolve(import.meta.dirname, "..");
/** The doodlebot checkout — this repo. */
export const REPO_ROOT = path.resolve(HARNESS_ROOT, "..");
/**
 * Per-user doodlebot state shared by every workspace on the machine: the one instance record
 * lives here, so the "one doodlebot Vortex" guard spans all of them.
 */
export const USER_STATE_DIR = path.join(os.homedir(), ".doodlebot");
/** What the kit created and may write to: game copies, releases, pending restores (content.ts). */
export const CONTENT_FILE = path.join(USER_STATE_DIR, "content.json");
/** Official Vortex releases, extracted outside every workspace (releaseFetch.ts). */
export const RELEASES_DIR = path.join(USER_STATE_DIR, "releases");
/** Profiles and login cache of the one instance a bare `doodlebot up` runs. */
export const DEFAULT_CACHE_DIR = path.join(HARNESS_ROOT, ".cache");
export const DEFAULT_ARTIFACT_DIR = path.join(HARNESS_ROOT, ".artifacts");
/**
 * The Vortex clone older doodlebots kept in the workspace. `check` reports it; nothing deletes it
 * (`clean` refuses it), since it can hold worktrees and unpushed work.
 */
export const OLD_CLONE_DIR = path.join(REPO_ROOT, ".vortex-src");

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
