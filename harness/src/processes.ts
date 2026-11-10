/** Process facts the kit needs about the one Vortex it runs. Imports nothing internal. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

/** Whether a process with this pid exists. EPERM counts as alive: it exists, owned by someone else. */
export function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // Signal 0 performs the permission/existence check without delivering one.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * The executable name of a running process, lower-cased, or undefined when it is not found.
 * A lookup that fails (tasklist missing or blocked) throws rather than reporting "not found",
 * so a live Vortex's record is never cleared because the check itself could not run.
 */
export function processImageName(pid: number): string | undefined {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  if (process.platform === "win32") {
    const line = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
      encoding: "utf8",
      windowsHide: true,
    }).trim();
    // "INFO: No tasks are running..." when absent; otherwise "Vortex.exe","1234",...
    const match = /^"([^"]+)","(\d+)"/.exec(line);
    return match !== null && Number(match[2]) === pid ? match[1]!.toLowerCase() : undefined;
  }
  try {
    return fs.readFileSync(`/proc/${pid}/comm`, "utf8").trim().toLowerCase() || undefined;
  } catch (err) {
    // The process exited since it was checked.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}
