/**
 * Pushing Vortex work. Pushes go only to the person's own fork: before any push,
 * `gh api repos/<origin>` must show that `origin` is a fork of Nexus-Mods/Vortex owned by the
 * person's GitHub login, or the repository `VORTEX_AI_VORTEX_REPO` names when it is such a fork
 * the person can push to. An absent `origin`, Nexus-Mods/Vortex itself, or someone else's fork is
 * refused, whatever rights the person has upstream. `doodlebot push-branch` pushes the session's
 * branch, the one `/doodlebot:pr` opens the pull request from, after this check; it refuses a
 * `proto/*` branch. A Vortex design is committed on that branch as `docs/designs/<topic>.md`, as
 * EGM intends, and travels in the pull request.
 */
import { spawnSync } from "node:child_process";

import { ConfigError } from "./errors";
import { type GhRunner, defaultGh } from "./share";
import { UPSTREAM } from "./source";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}
/** Runs `git -C <dir> <args>`. */
export type GitRunner = (dir: string, args: string[]) => RunResult;

export const defaultGit: GitRunner = (dir, args) => {
  const result = spawnSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) return { code: 127, stdout: "", stderr: result.error.message };
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

/** `owner/repo` of a GitHub remote URL (https, ssh or scp form), or undefined. */
export function parseGitHubRepo(url: string): string | undefined {
  const match =
    /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(
      url.trim(),
    );
  return match ? `${match[1]!}/${match[2]!}` : undefined;
}

const same = (a: string | undefined, b: string | undefined): boolean =>
  a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase();

interface RepoInfo {
  full_name: string;
  fork?: boolean;
  owner?: { login?: string };
  parent?: { full_name?: string };
  source?: { full_name?: string };
  permissions?: { push?: boolean };
}

export interface PushCheckDeps {
  git?: GitRunner;
  gh?: GhRunner;
  /** `VORTEX_AI_VORTEX_REPO` (default: the environment). */
  configuredRepo?: string;
}

/**
 * Refuses unless `origin` is the person's own fork of Nexus-Mods/Vortex (or the configured
 * `VORTEX_AI_VORTEX_REPO` fork they can push to). Returns the fork's `owner/repo`.
 */
export function checkPushRemote(dir: string, deps: PushCheckDeps = {}): string {
  const git = deps.git ?? defaultGit;
  const gh = deps.gh ?? defaultGh;
  const fork = `gh repo fork ${UPSTREAM} --remote`;
  const origin = git(dir, ["remote", "get-url", "origin"]);
  if (origin.code !== 0 || origin.stdout.trim() === "")
    throw new ConfigError(
      `${dir} has no origin remote, so there is nowhere of yours to push. Fork Vortex first: \`${fork}\` adds your fork as origin.`,
    );
  const repo = parseGitHubRepo(origin.stdout);
  if (repo === undefined)
    throw new ConfigError(
      `origin (${origin.stdout.trim()}) is not a GitHub repository; doodlebot pushes only to your GitHub fork of ${UPSTREAM}.`,
    );
  if (same(repo, UPSTREAM))
    throw new ConfigError(
      `origin is ${UPSTREAM} itself. doodlebot never pushes there, even with push rights: fork it (\`${fork}\`) and push to your fork.`,
    );
  // `git push origin` goes to the push URLs (remote.origin.pushurl, url.*.pushInsteadOf), not to
  // the fetch URL read above. Every one of them must be the same repository.
  const pushed = git(dir, ["remote", "get-url", "--push", "--all", "origin"]);
  const pushUrls = pushed.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  for (const url of pushUrls)
    if (!same(parseGitHubRepo(url), repo))
      throw new ConfigError(
        `origin fetches from ${repo} but pushes to ${url}. doodlebot pushes only to the fork it ` +
          `checked; remove the push URL (\`git remote set-url --delete --push origin ${url}\`) or ` +
          `the pushInsteadOf rule. Nothing was pushed.`,
      );
  const looked = gh(["api", `repos/${repo}`]);
  if (looked.code !== 0)
    throw new ConfigError(
      `Could not check origin (${repo}) with \`gh api repos/${repo}\` (exit ${String(looked.code)}): ` +
        `${looked.stderr.trim().split("\n")[0] ?? ""}. Install gh and run \`gh auth login\`; nothing was pushed.`,
    );
  const info = JSON.parse(looked.stdout) as RepoInfo;
  const forkOfVortex =
    info.fork === true &&
    (same(info.parent?.full_name, UPSTREAM) || same(info.source?.full_name, UPSTREAM));
  if (!forkOfVortex)
    throw new ConfigError(
      `origin (${info.full_name}) is not a fork of ${UPSTREAM}; nothing was pushed.`,
    );
  const user = gh(["api", "user", "--jq", ".login"]);
  if (user.code !== 0 || user.stdout.trim() === "")
    throw new ConfigError(
      "Could not read your GitHub login with `gh api user`; run `gh auth login`. Nothing was pushed.",
    );
  const login = user.stdout.trim();
  if (same(info.owner?.login, login)) return info.full_name;
  const configured = deps.configuredRepo ?? process.env.VORTEX_AI_VORTEX_REPO;
  const configuredRepo =
    configured === undefined || configured === ""
      ? undefined
      : (parseGitHubRepo(configured) ?? configured.replace(/\.git$/, ""));
  if (same(configuredRepo, info.full_name)) {
    if (info.permissions?.push === true) return info.full_name;
    throw new ConfigError(
      `origin is ${info.full_name}, the VORTEX_AI_VORTEX_REPO fork, but ${login} cannot push to it; nothing was pushed.`,
    );
  }
  throw new ConfigError(
    `origin is ${info.full_name}, a fork owned by ${info.owner?.login ?? "someone else"}, not by ${login}. ` +
      `doodlebot pushes only to your own fork: \`${fork}\`, or set VORTEX_AI_VORTEX_REPO to an ` +
      "organisation's fork you can push to. Nothing was pushed.",
  );
}

function run(git: GitRunner, dir: string, args: string[], what: string): string {
  const result = git(dir, args);
  if (result.code !== 0)
    throw new ConfigError(
      `${what} failed (git ${args.join(" ")}): ${result.stderr.trim().split("\n")[0] ?? ""}`,
    );
  return result.stdout.trim();
}

/** `upstream/<its default branch>`, the base work branches start from. */
export function defaultBase(dir: string, git: GitRunner = defaultGit): string {
  const head = git(dir, ["symbolic-ref", "--short", "refs/remotes/upstream/HEAD"]);
  return head.code === 0 && head.stdout.trim() !== "" ? head.stdout.trim() : "upstream/master";
}
/**
 * `doodlebot push-branch`: push the session's branch to the person's fork, the branch
 * `/doodlebot:pr` opens the pull request from. Refuses a detached HEAD, a `proto/*` prototype
 * (never shipped) and the upstream default branch, then pushes only after checkPushRemote.
 */
export function pushSessionBranch(
  dir: string,
  deps: PushCheckDeps = {},
): { branch: string; fork: string } {
  const git = deps.git ?? defaultGit;
  const branch = git(dir, ["symbolic-ref", "--short", "-q", "HEAD"]).stdout.trim();
  if (branch === "")
    throw new ConfigError("HEAD is detached; switch to the branch that holds the change.");
  if (branch.startsWith("proto/"))
    throw new ConfigError(
      `${branch} is a prototype branch, and a prototype is never shipped. Start feat/<topic> from ` +
        "upstream after an approved design, port the prototype's diff, and open the PR from it.",
    );
  const defaultBranch = defaultBase(dir, git).replace(/^upstream\//, "");
  if (branch === defaultBranch || branch === "master" || branch === "main")
    throw new ConfigError(
      `${branch} is the default branch; a pull request comes from a work branch cut from upstream.`,
    );
  const fork = checkPushRemote(dir, deps);
  run(git, dir, ["push", "-u", "origin", branch], `Pushing ${branch}`);
  return { branch, fork };
}
