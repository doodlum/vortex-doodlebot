/**
 * Where this kit keeps things. A leaf module with no internal imports, so any module can
 * use it without import cycles.
 */
import fs from "node:fs";
import path from "node:path";

export const HARNESS_ROOT = path.resolve(import.meta.dirname, "..");
/** The doodlebot checkout — this repo. */
export const REPO_ROOT = path.resolve(HARNESS_ROOT, "..");
/** Profiles and login cache of the one instance a bare `doodlebot up` runs. */
export const DEFAULT_CACHE_DIR = path.join(HARNESS_ROOT, ".cache");
export const DEFAULT_ARTIFACT_DIR = path.join(HARNESS_ROOT, ".artifacts");

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
