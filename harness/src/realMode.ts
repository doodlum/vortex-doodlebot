/**
 * Real-mode launches: Vortex without VORTEX_E2E, so game detection, discovery and Add game run as
 * they do for users. Electron's --user-data-dir moves the whole profile (state, log, single-instance
 * lock) into the run's folder. Linux also sets XDG_CONFIG_HOME and XDG_DATA_HOME, keeping the nxm handler
 * registration private; on Windows that registration is in the registry, so the run backs up and
 * restores HKCU\Software\Classes\nxm.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const harnessOnly = new Set([
  "VORTEX_E2E",
  "VORTEX_E2E_HEADLESS",
  "ELECTRON_RUN_AS_NODE",
  "ELECTRON_USERDATA",
  "ELECTRON_APPDATA",
  "VORTEX_MCP_TOKEN",
  "VORTEX_MCP_PORT",
  "VORTEX_AI_AUTH_CACHE",
  "VORTEX_AI_OPERATION_CONTEXT",
]);

/** The environment a desktop launch would have, with Vortex's whole profile under configHome. */
export function realModeEnv(
  base: NodeJS.ProcessEnv,
  configHome: string,
  nodeEnv: string | undefined,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base))
    if (value !== undefined && !harnessOnly.has(key)) env[key] = value;
  env.XDG_CONFIG_HOME = configHome;
  env.XDG_DATA_HOME = path.join(configHome, "data");
  if (nodeEnv === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = nodeEnv;
  return env;
}

/**
 * Electron arguments that keep the profile inside the run's folder. Linux needs none:
 * XDG_CONFIG_HOME already moves it, and a source build there rejects a separate --user-data-dir.
 */
export function realModeArgs(
  configHome: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  return platform === "win32" ? [`--user-data-dir=${path.join(configHome, "Vortex")}`] : [];
}

export function assertRealModeSupported(platform: NodeJS.Platform = process.platform): void {
  if (platform !== "linux" && platform !== "win32")
    throw new Error(
      "Real-mode checks support Linux and Windows, where Vortex's profile and link registration " +
        "can be kept away from the operator's.",
    );
}

/** A Windows source build sets its own data path and ignores --user-data-dir. */
export function assertRealModeTarget(
  kind: "dev" | "installed",
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === "win32" && kind === "dev")
    throw new Error(
      "On Windows, real-mode needs a packaged or installed Vortex (--installed or VORTEX_AI_EXE): " +
        "a source build chooses its own data folder and would use the operator's.",
    );
}

const nxmKey = "HKCU\\Software\\Classes\\nxm";

function keyExists(key: string): boolean {
  try {
    execFileSync("reg.exe", ["query", key], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Windows: Vortex registers itself for nxm links on its first normal start. Export the current
 * registration and return a function that puts back exactly that (or removes a new one).
 */
export function protectProtocolRegistration(
  backupDirectory: string,
  platform: NodeJS.Platform = process.platform,
): () => void {
  if (platform !== "win32") return () => undefined;
  const backup = path.join(backupDirectory, "nxm-registration.reg");
  const existed = keyExists(nxmKey);
  if (existed) execFileSync("reg.exe", ["export", nxmKey, backup, "/y"], { stdio: "ignore" });
  return () => {
    if (keyExists(nxmKey)) execFileSync("reg.exe", ["delete", nxmKey, "/f"], { stdio: "ignore" });
    if (existed) {
      if (!fs.existsSync(backup)) throw new Error(`Missing nxm registration backup ${backup}`);
      execFileSync("reg.exe", ["import", backup], { stdio: "ignore" });
    }
  };
}

export interface RendererCrash {
  line: number;
  text: string;
}

/** Renderer crashes Vortex's main process logged (exit code 139, V8 aborts, OOM and so on). */
export function rendererCrashes(log: string): RendererCrash[] {
  return log
    .split(/\r?\n/)
    .map((text, index) => ({ line: index + 1, text }))
    .filter(({ text }) => /render(?:-| )process(?:-| )gone/.test(text));
}

/** Error notifications Vortex logged, by message. */
export function errorNotifications(log: string): string[] {
  const result: string[] = [];
  for (const line of log.split(/\r?\n/)) {
    const match = /\berror notification \{"message":"((?:[^"\\]|\\.)*)"/.exec(line);
    if (match !== null) result.push(JSON.parse(`"${match[1]}"`) as string);
  }
  return result;
}
