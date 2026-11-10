/**
 * The one Nexus login: `~/.doodlebot/login/oauth-<target>.json`, outside every workspace, so it
 * survives `setup --update`, re-setup and a new workspace, and every workspace on the machine uses
 * it.
 *
 * A cache either **uses that file directly** (the default cache, and a cache whose config sets
 * `sharedLogin: true`) or **has no login** (every other cache: `<cacheDir>/oauth-<target>.json`).
 * Only one Vortex runs at a time, so the shared file is never refreshed by two at once, and no
 * copies are made: Nexus rotates the refresh token, so a copy that refreshed first would spend the
 * shared login. Only `setup --oauth` creates it. Never print its content.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { HarnessConfig } from "./config";
import { DEFAULT_CACHE_DIR, USER_STATE_DIR, normalizedPath } from "./paths";
import { runningVortex } from "./runningVortex";

/** The folder of the shared login. */
export function sharedLoginDir(stateDir: string = USER_STATE_DIR): string {
  return path.join(stateDir, "login");
}

/** Whether this cache uses the shared login directly (otherwise it has no login of its own). */
export function usesSharedLogin(config: Pick<HarnessConfig, "cacheDir" | "sharedLogin">): boolean {
  return (
    config.sharedLogin === true ||
    normalizedPath(config.cacheDir) === normalizedPath(DEFAULT_CACHE_DIR)
  );
}

/** Where a cache's OAuth file is: the shared login, or its own folder. */
export function loginFileFor(
  config: Pick<HarnessConfig, "cacheDir" | "sharedLogin">,
  name: string,
  stateDir: string = USER_STATE_DIR,
): string {
  return path.join(usesSharedLogin(config) ? sharedLoginDir(stateDir) : config.cacheDir, name);
}

/** What an OAuth file holds: a login (token and refresh token), the signed-out `null`, or junk. */
export function loginState(file: string): "missing" | "signed-out" | "invalid" | "login" {
  if (!fs.existsSync(file)) return "missing";
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (value === null) return "signed-out";
    if (typeof value !== "object") return "invalid";
    const { token, refreshToken } = value as { token?: unknown; refreshToken?: unknown };
    return typeof token === "string" && token !== "" && typeof refreshToken === "string"
      ? "login"
      : "invalid";
  } catch {
    return "invalid";
  }
}

export interface MigrationDeps {
  /** The workspace's default cache, where older kits kept the login. */
  fromDir?: string;
  stateDir?: string;
  /** A running harness Vortex, if any (default: the instance record). */
  running?: () => { pid: number } | undefined;
}

export interface MigrationResult {
  moved: string[];
  /** Old files left in place: a shared login already exists, or the file holds no login. */
  left: { file: string; reason: string }[];
  /** Why nothing was moved at all. */
  refused?: string;
}

/**
 * The one-time move of the default cache's `oauth-*.json` logins to `~/.doodlebot/login`. Only a
 * file holding a login moves. It refuses while a harness Vortex runs (that Vortex still writes
 * rotations to the old file) and never overwrites an existing shared login: the first workspace to
 * move wins, and a later workspace's old file stays for `setup --check` to report.
 */
export function migrateDefaultLogin(deps: MigrationDeps = {}): MigrationResult {
  const fromDir = deps.fromDir ?? DEFAULT_CACHE_DIR;
  const target = sharedLoginDir(deps.stateDir);
  const result: MigrationResult = { moved: [], left: [] };
  let names: string[];
  try {
    names = fs.readdirSync(fromDir).filter((name) => /^oauth-[0-9a-f]+\.json$/i.test(name));
  } catch {
    return result;
  }
  const candidates = names.filter((name) => loginState(path.join(fromDir, name)) === "login");
  for (const other of names.filter((name) => !candidates.includes(name)))
    result.left.push({ file: path.join(fromDir, other), reason: "holds no login (unused now)" });
  if (candidates.length === 0) return result;
  const running = (deps.running ?? runningVortex)();
  if (running !== undefined) {
    result.refused =
      `the login in ${fromDir} moves to ${target} on the first run after the harness Vortex ` +
      `(pid ${String(running.pid)}) has stopped; run \`doodlebot down\` first`;
    return result;
  }
  fs.mkdirSync(target, { recursive: true });
  for (const name of candidates) {
    const source = path.join(fromDir, name);
    const destination = path.join(target, name);
    if (fs.existsSync(destination)) {
      result.left.push({
        file: source,
        reason: `${destination} already holds the shared login; this older copy is not used`,
      });
      continue;
    }
    const temporary = `${destination}.${String(process.pid)}.tmp`;
    fs.copyFileSync(source, temporary);
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, destination);
    fs.rmSync(source);
    result.moved.push(destination);
  }
  return result;
}

/** One line for a progress report, or undefined when there is nothing to say. */
export function describeMigration(result: MigrationResult): string | undefined {
  if (result.refused !== undefined) return `login not moved yet: ${result.refused}`;
  if (result.moved.length > 0)
    return `moved the Nexus login to ${path.dirname(result.moved[0]!)} (shared by every workspace)`;
  return undefined;
}

export interface AclReport {
  ok: boolean;
  /** Principals other than the user, SYSTEM and Administrators that have access. */
  others: string[];
  detail: string;
  fix?: string;
}

/** Principals of `icacls <dir>` output, one per access entry. */
export function aclPrincipals(icaclsOutput: string, dir: string): string[] {
  const principals: string[] = [];
  for (const raw of icaclsOutput.replace(/\r\n/g, "\n").split("\n")) {
    let line = raw;
    if (line.toLowerCase().startsWith(dir.toLowerCase())) line = line.slice(dir.length);
    line = line.trim();
    if (line === "" || /^Successfully processed/i.test(line)) continue;
    const at = line.indexOf(":(");
    if (at > 0) principals.push(line.slice(0, at).trim());
  }
  return principals;
}

/**
 * The shared login's folder must be readable only by the user, SYSTEM and Administrators. On
 * Windows the ACL is read with `icacls`; elsewhere the folder's mode must give nothing to group or
 * others. Reports the fix; never changes the ACL itself.
 */
export function checkLoginAcl(
  dir: string = sharedLoginDir(),
  deps: { platform?: NodeJS.Platform; icacls?: (dir: string) => string; user?: string } = {},
): AclReport {
  if (!fs.existsSync(dir)) return { ok: true, others: [], detail: "no shared login folder yet" };
  const platform = deps.platform ?? process.platform;
  const user = deps.user ?? os.userInfo().username;
  if (platform !== "win32") {
    const mode = fs.statSync(dir).mode & 0o777;
    const ok = (mode & 0o077) === 0;
    return {
      ok,
      others: ok ? [] : ["group or others"],
      detail: `mode ${mode.toString(8)}`,
      ...(ok ? {} : { fix: `chmod 700 "${dir}"` }),
    };
  }
  const output = (
    deps.icacls ??
    ((folder: string): string =>
      execFileSync("icacls", [folder], { encoding: "utf8", windowsHide: true }))
  )(dir);
  const allowed = (principal: string): boolean => {
    const name = principal.toLowerCase();
    const bare = name.includes("\\") ? name.slice(name.lastIndexOf("\\") + 1) : name;
    return (
      bare === user.toLowerCase() ||
      name === "nt authority\\system" ||
      name === "builtin\\administrators" ||
      name === "s-1-5-18" ||
      name === "s-1-5-32-544"
    );
  };
  const others = [...new Set(aclPrincipals(output, dir).filter((p) => !allowed(p)))];
  return {
    ok: others.length === 0,
    others,
    detail:
      others.length === 0
        ? "readable only by you, SYSTEM and Administrators"
        : `also readable by ${others.join(", ")}`,
    ...(others.length === 0
      ? {}
      : {
          fix:
            `icacls "${dir}" /inheritance:r /grant:r "${user}:(OI)(CI)F" ` +
            '"*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F"',
        }),
  };
}
