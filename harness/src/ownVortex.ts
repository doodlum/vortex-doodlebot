/**
 * The owner's own Vortex. A harness Vortex beside it would share the nxm link handler, the
 * game's user folders and possibly its deployment, so every kit launcher refuses while it runs.
 * The kit never closes it, and there is no override.
 *
 * Which processes count: any `Vortex.exe`, or an `electron.exe` whose command line names a Vortex
 * folder (a dev build), that is not in the recorded harness Vortex's process tree. The path does
 * not matter: a checkout or worktree build the owner started by hand is the owner's too. Electron's
 * renderer, GPU, utility and crash-handler processes (`--type=...`) are part of some Vortex's
 * tree; they never count on their own, so a harness Vortex's helpers still exiting after its main
 * process are not mistaken for the owner's.
 */
import { execFileSync } from "node:child_process";

import { ConfigError } from "./errors";

export interface ProcessInfo {
  pid: number;
  ppid: number;
  /** The image name, such as `Vortex.exe`. */
  name: string;
  exe?: string;
  commandLine?: string;
}

/** The pid and every process descended from it. */
function processTree(list: ProcessInfo[], root: number | undefined): Set<number> {
  const tree = new Set<number>();
  if (root === undefined) return tree;
  tree.add(root);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of list)
      if (!tree.has(p.pid) && tree.has(p.ppid)) {
        tree.add(p.pid);
        grew = true;
      }
  }
  return tree;
}

function isVortexMainProcess(p: ProcessInfo): boolean {
  const name = p.name.toLowerCase();
  const commandLine = p.commandLine ?? "";
  if (/(?:^|\s)"?--type=/.test(commandLine)) return false;
  if (name === "vortex.exe" || name === "vortex") return true;
  return (
    (name === "electron.exe" || name === "electron") &&
    /vortex/i.test(`${p.exe ?? ""} ${commandLine}`)
  );
}

/** The owner's Vortex processes in `list`: Vortex main processes outside the recorded tree. */
export function ownVortexProcesses(list: ProcessInfo[], recordedPid?: number): ProcessInfo[] {
  const harness = processTree(list, recordedPid);
  return list.filter((p) => !harness.has(p.pid) && isVortexMainProcess(p));
}

export function ownVortexMessage(p: ProcessInfo): string {
  return `Your own Vortex is running (pid ${String(p.pid)}). Close it, then retry.`;
}

const LIST_SCRIPT =
  "ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process " +
  `-Filter "Name='Vortex.exe' OR Name='electron.exe'" | ` +
  "Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine)";

/** Every `Vortex.exe` and `electron.exe` on the machine, through Win32_Process. */
export function listVortexProcesses(): ProcessInfo[] {
  if (process.platform !== "win32") return [];
  let output: string;
  try {
    output = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", LIST_SCRIPT],
      { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 },
    );
  } catch (error) {
    throw new ConfigError(
      `Could not list running processes to check for your own Vortex: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseProcessList(output);
}

/** The JSON `listVortexProcesses` reads, as ProcessInfo. */
export function parseProcessList(json: string): ProcessInfo[] {
  const trimmed = json.trim();
  if (trimmed === "") return [];
  const value = JSON.parse(trimmed) as unknown;
  const rows = (Array.isArray(value) ? value : [value]) as Record<string, unknown>[];
  return rows.flatMap((row) =>
    typeof row.ProcessId === "number" && typeof row.Name === "string"
      ? [
          {
            pid: row.ProcessId,
            ppid: typeof row.ParentProcessId === "number" ? row.ParentProcessId : 0,
            name: row.Name,
            ...(typeof row.ExecutablePath === "string" ? { exe: row.ExecutablePath } : {}),
            ...(typeof row.CommandLine === "string" ? { commandLine: row.CommandLine } : {}),
          },
        ]
      : [],
  );
}

/**
 * Off Windows the kit cannot see the owner's Vortex, a running game or the nxm link handler
 * (`listVortexProcesses`, `gameRunning` and nxmHandler.ts read Windows-only sources and find
 * nothing). A launch does not refuse; it prints this, so the person knows nothing checked.
 */
export function windowsOnlyWarning(
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (platform === "win32") return undefined;
  return (
    `warning: on ${platform} doodlebot cannot see your own Vortex, a running game or the nxm:// ` +
    "link handler; these protections are Windows-only. Close your own Vortex and the game " +
    "yourself before a run."
  );
}

/** Refuse while the owner's Vortex runs. `recordedPid` is the harness Vortex, when one runs. */
export function assertNoOwnVortex(
  recordedPid?: number,
  list: () => ProcessInfo[] = listVortexProcesses,
): void {
  const own = ownVortexProcesses(list(), recordedPid)[0];
  if (own !== undefined) throw new ConfigError(ownVortexMessage(own));
}
