/**
 * `doodlebot link [--bin-dir <dir>]`: put `doodlebot` on the PATH, as npm does for its own global
 * commands, without npm. It writes two shims into a folder on the PATH:
 *
 * - `doodlebot.cmd` (Windows only), which PowerShell and cmd run through PATHEXT;
 * - `doodlebot`, an extensionless `#!/bin/sh` script, which Git Bash (it ignores PATHEXT) and
 *   every other shell run. PowerShell and cmd never treat it as a command.
 *
 * Both run this workspace's `bin/doodlebot.cjs` with the Node that ran `link`. No npm process,
 * no `.ps1` (so no execution policy), and pnpm's node_modules is never touched.
 *
 * It also records the workspace in `~/.doodlebot/workspace.json`, which the plugin's SessionStart
 * hook reads to find it without starting a process (designs/vortex-session-context.md).
 */
import fs from "node:fs";
import path from "node:path";

import { ConfigError } from "./errors";
import { REPO_ROOT, USER_STATE_DIR } from "./paths";

/** The record of the linked workspace, read by `plugins/doodlebot/hooks/session-note.cjs`. */
export const WORKSPACE_RECORD = "workspace.json";

export interface LinkEnvironment {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** The Node the shims run. */
  execPath: string;
  /** Whether a folder exists and this user can create files in it. */
  writable: (dir: string) => boolean;
  /** The real path of an existing path; throws for a missing one. */
  realpath: (file: string) => string;
  /** Where `workspace.json` goes (`~/.doodlebot`); without it no record is written. */
  stateDir?: string;
}

export const NO_BIN_DIR =
  "No writable folder on the PATH for the doodlebot shim; pass --bin-dir <folder>.";

function canWrite(dir: string): boolean {
  try {
    if (!fs.statSync(dir).isDirectory()) return false;
    // A probe file, because Windows' access() ignores folder permissions.
    const probe = path.join(dir, `.doodlebot-link-${String(process.pid)}.tmp`);
    fs.writeFileSync(probe, "");
    fs.rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

export function defaultLinkEnvironment(): LinkEnvironment {
  return {
    platform: process.platform,
    env: process.env,
    execPath: process.execPath,
    writable: canWrite,
    realpath: (file) => fs.realpathSync.native(file),
    stateDir: USER_STATE_DIR,
  };
}

const pathModule = (platform: NodeJS.Platform) => (platform === "win32" ? path.win32 : path.posix);

/** An environment variable, case-insensitively on Windows as Windows itself reads them. */
function envValue(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string {
  if (platform !== "win32") return env[name] ?? "";
  const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? "" : (env[key] ?? "");
}

/**
 * A folder spelled the same however it was given: its real path when it exists, without
 * trailing separators, case-insensitive on Windows.
 */
export function comparablePath(dir: string, environment: LinkEnvironment): string {
  const p = pathModule(environment.platform);
  let resolved = p.resolve(dir);
  try {
    resolved = environment.realpath(resolved);
  } catch {
    // A folder that does not exist yet is compared as written.
  }
  const root = p.parse(resolved).root;
  while (resolved.length > root.length && /[\\/]$/.test(resolved)) resolved = resolved.slice(0, -1);
  return environment.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function onPath(dir: string, environment: LinkEnvironment): boolean {
  const delimiter = environment.platform === "win32" ? ";" : ":";
  const wanted = comparablePath(dir, environment);
  return envValue(environment.env, "PATH", environment.platform)
    .split(delimiter)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
    .filter((entry) => entry !== "")
    .some((entry) => comparablePath(entry, environment) === wanted);
}

/** The folders `link` considers without `--bin-dir`, in order. */
export function binDirCandidates(environment: LinkEnvironment): string[] {
  const { platform, env, execPath } = environment;
  const p = pathModule(platform);
  const candidates: string[] = [];
  const prefix = envValue(env, "npm_config_prefix", platform);
  if (prefix !== "") candidates.push(platform === "win32" ? prefix : p.join(prefix, "bin"));
  if (platform === "win32") {
    const appData = envValue(env, "APPDATA", platform);
    if (appData !== "") candidates.push(p.join(appData, "npm"));
    // nvm-windows keeps its global shims beside node.exe.
    candidates.push(p.dirname(execPath));
  } else {
    candidates.push(p.join(p.dirname(p.dirname(execPath)), "bin"));
  }
  return candidates;
}

/** The first candidate that is on the PATH and writable. */
export function chooseBinDir(environment: LinkEnvironment): string {
  const chosen = binDirCandidates(environment).find(
    (dir) => onPath(dir, environment) && environment.writable(dir),
  );
  if (chosen === undefined) throw new ConfigError(NO_BIN_DIR);
  return chosen;
}

export function shimContents(root: string, node: string): { cmd: string; sh: string } {
  const forward = (file: string) => file.replace(/\\/g, "/");
  const winRoot = root.replace(/\//g, "\\");
  return {
    cmd: `@"${node}" "${winRoot}\\bin\\doodlebot.cjs" %*\r\n`,
    sh: `#!/bin/sh\nexec "${forward(node)}" "${forward(root)}/bin/doodlebot.cjs" "$@"\n`,
  };
}

export interface LinkResult {
  /** The shim a shell on this platform runs: the `.cmd` on Windows, else the script. */
  shim: string;
  files: string[];
  onPath: boolean;
  /** The `workspace.json` written, when the environment has a state folder. */
  record?: string;
}

export function link(
  options: { binDir?: string; root?: string } = {},
  environment: LinkEnvironment = defaultLinkEnvironment(),
): LinkResult {
  const p = pathModule(environment.platform);
  const root = options.root ?? REPO_ROOT;
  // --bin-dir is already absolute: the CLI resolves it against the caller's directory.
  const binDir = options.binDir ?? chooseBinDir(environment);
  fs.mkdirSync(binDir, { recursive: true });
  const contents = shimContents(root, environment.execPath);
  const script = p.join(binDir, "doodlebot");
  const files: string[] = [];
  if (environment.platform === "win32") {
    const cmd = p.join(binDir, "doodlebot.cmd");
    fs.writeFileSync(cmd, contents.cmd);
    files.push(cmd);
  }
  fs.writeFileSync(script, contents.sh, { mode: 0o755 });
  if (environment.platform !== "win32") fs.chmodSync(script, 0o755);
  files.push(script);
  let record: string | undefined;
  if (environment.stateDir !== undefined) {
    fs.mkdirSync(environment.stateDir, { recursive: true });
    record = p.join(environment.stateDir, WORKSPACE_RECORD);
    fs.writeFileSync(record, `${JSON.stringify({ workspace: root, shim: files[0]! }, null, 2)}\n`);
  }
  return {
    shim: files[0]!,
    files,
    onPath: onPath(binDir, environment),
    ...(record === undefined ? {} : { record }),
  };
}

export function formatLink(result: LinkResult): string {
  return (
    `shim: ${result.shim}\non PATH: ${result.onPath ? "yes" : "no"}` +
    (result.record === undefined ? "" : `\nworkspace record: ${result.record}`)
  );
}
