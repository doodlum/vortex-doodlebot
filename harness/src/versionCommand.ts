/**
 * `doodlebot version [--json]`: which companion this workspace is, so a plugin skill can compare
 * it with its own manifest version and find the workspace it runs in.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { REPO_ROOT } from "./paths";

export interface VersionInfo {
  version: string;
  /** HEAD of the workspace, or "unknown" outside a git checkout. */
  commit: string;
  /** Whether the workspace has local changes. */
  dirty: boolean;
  /** The real path of the workspace root. */
  workspace: string;
}

export type GitRunner = (root: string, args: string[]) => string;

const defaultGit: GitRunner = (root, args) =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"],
  });

export function versionInfo(root: string = REPO_ROOT, git: GitRunner = defaultGit): VersionInfo {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
    version?: unknown;
  };
  let commit = "unknown";
  let dirty = false;
  try {
    commit = git(root, ["rev-parse", "HEAD"]).trim();
    dirty = git(root, ["status", "--porcelain"]).trim() !== "";
  } catch {
    // Not a git checkout (or git is missing): the version still identifies the companion.
  }
  return {
    version: typeof pkg.version === "string" ? pkg.version : "unknown",
    commit,
    dirty,
    workspace: fs.realpathSync.native(root),
  };
}

export function formatVersion(info: VersionInfo): string {
  return `doodlebot ${info.version} (${info.commit}${info.dirty ? ", modified" : ""}) at ${info.workspace}`;
}

export function versionCommand(
  flags: Record<string, string | boolean>,
  root: string = REPO_ROOT,
  git: GitRunner = defaultGit,
): string {
  const info = versionInfo(root, git);
  return flags.json === true ? JSON.stringify(info, null, 2) : formatVersion(info);
}
