/**
 * Pushing Vortex work, and `doodlebot design-branch <topic> --file <draft>`.
 *
 * - **Pushes go only to the person's own fork.** Before any push, `gh api repos/<origin>` must show
 *   that `origin` is a fork of Nexus-Mods/Vortex owned by the person's GitHub login, or the
 *   repository `VORTEX_AI_VORTEX_REPO` names when it is such a fork the person can push to. An
 *   absent `origin`, Nexus-Mods/Vortex itself, or someone else's fork is refused, whatever rights
 *   the person has upstream. `doodlebot push-branch` pushes the session's branch, the one
 *   `/doodlebot:pr` opens the pull request from, after this check; it refuses a `proto/*` branch.
 * - **designs/<topic>** is the sibling branch a Vortex design lives on, never the feature branch.
 *   `design-branch` commits the draft there as `docs/designs/<topic>.md` in a temporary worktree,
 *   so the session's checkout never switches branch and its files never change, pushes it to the
 *   fork and prints the design's link at that commit, the revision the person approves.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

/** Where Vortex keeps designs; a pull request's diff never holds a file here (pr-preflight). */
export const DESIGNS_DIR = "docs/designs/";

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
 * Runs `work` in a temporary detached worktree of `dir` at `start`, and removes the worktree
 * afterwards whatever happens. The checkout's own branch and files never change.
 */
export function withTempWorktree<T>(
  git: GitRunner,
  dir: string,
  start: string,
  work: (worktree: string) => T,
): T {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "doodlebot-worktree-"));
  try {
    run(git, dir, ["worktree", "add", "--detach", worktree, start], "Creating a worktree");
    return work(worktree);
  } finally {
    git(dir, ["worktree", "remove", "--force", worktree]);
    fs.rmSync(worktree, { recursive: true, force: true });
  }
}

/** The worktree of `dir`'s repository that has `branch` checked out, if any. */
function worktreeHolding(git: GitRunner, dir: string, branch: string): string | undefined {
  let worktree: string | undefined;
  for (const line of git(dir, ["worktree", "list", "--porcelain"]).stdout.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) worktree = line.slice("worktree ".length);
    else if (line === `branch refs/heads/${branch}`) return worktree;
  }
  return undefined;
}

const TOPIC = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

function checkTopic(topic: string): void {
  if (!TOPIC.test(topic) || topic.includes("..") || topic.endsWith(".lock"))
    throw new ConfigError(
      `${topic} is not a usable topic; use letters, digits, ".", "_", "-" and "/".`,
    );
}

const resolved = (git: GitRunner, dir: string, ref: string): string | undefined => {
  const found = git(dir, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  return found.code === 0 && found.stdout.trim() !== "" ? found.stdout.trim() : undefined;
};

/**
 * `doodlebot push-branch`: push the session's branch to the person's fork, the branch
 * `/doodlebot:pr` opens the pull request from. Refuses a detached HEAD, a `proto/*` prototype
 * (never shipped), a `designs/*` branch (`design-branch` pushes those) and the upstream default
 * branch, then pushes only after checkPushRemote.
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
  if (branch.startsWith("designs/"))
    throw new ConfigError(
      `${branch} holds a design; \`doodlebot design-branch\` pushes it. Run push-branch on the work branch.`,
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

export interface DesignBranchResult {
  branch: string;
  /** The commit holding this revision of the design. */
  commit: string;
  /** What the branch started from: the existing branch, the fork's copy, or the upstream base. */
  from: string;
  /** False when the draft was identical to the branch's design, so no commit was made. */
  committed: boolean;
  fork: string;
  /** `https://github.com/<fork>/blob/<commit>/docs/designs/<topic>.md`. */
  link: string;
}

/**
 * Commits `file` as `docs/designs/<topic>.md` on `designs/<topic>` and pushes the branch to the
 * person's fork. It fetches the fork's copy first and continues from the newer of the local branch
 * and `origin/designs/<topic>` (refusing when they have diverged), or else starts at the
 * merge-base of the session's HEAD and `base` (default `upstream/<default branch>`). It refuses
 * while another worktree has the branch checked out. The commit is made in a temporary worktree,
 * so the session's branch and `git status` are unchanged, and the local branch moves only after
 * the push succeeded.
 */
export function designBranch(
  dir: string,
  topic: string,
  file: string,
  options: PushCheckDeps & { base?: string; onProgress?: (message: string) => void } = {},
): DesignBranchResult {
  const git = options.git ?? defaultGit;
  const report = options.onProgress ?? ((): void => undefined);
  checkTopic(topic);
  const branch = `designs/${topic}`;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile())
    throw new ConfigError(`${file} is not a file; --file names the design draft.`);
  const current = git(dir, ["symbolic-ref", "--short", "-q", "HEAD"]).stdout.trim();
  if (current === branch)
    throw new ConfigError(
      `${branch} is checked out here; run design-branch from the session's work branch.`,
    );
  // A worktree on the branch would be left behind its own branch: refuse rather than move it.
  const holder = worktreeHolding(git, dir, branch);
  if (holder !== undefined)
    throw new ConfigError(
      `${branch} is checked out in ${holder}. Switch that worktree to another branch (or remove ` +
        "it), then run design-branch again.",
    );
  // The fork check comes first, so nothing is committed that could not be pushed.
  const fork = checkPushRemote(dir, options);
  // Build on the newest revision: another session may have pushed one.
  const fetched = git(dir, [
    "fetch",
    "origin",
    `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
  ]);
  if (fetched.code !== 0 && !/couldn't find remote ref/i.test(fetched.stderr))
    throw new ConfigError(
      `Fetching ${branch} from origin failed, so the newest revision is unknown and nothing was ` +
        `committed: ${fetched.stderr.trim().split("\n")[0] ?? ""}`,
    );
  const local = resolved(git, dir, `refs/heads/${branch}`);
  const remote = resolved(git, dir, `refs/remotes/origin/${branch}`);
  const isAncestor = (a: string, b: string): boolean =>
    git(dir, ["merge-base", "--is-ancestor", a, b]).code === 0;
  let start: string;
  let from: string;
  if (local !== undefined && remote !== undefined && !isAncestor(remote, local)) {
    if (!isAncestor(local, remote))
      throw new ConfigError(
        `${branch} and origin/${branch} have diverged. Reconcile them (keep the revision the ` +
          "person approved), then run design-branch again.",
      );
    start = remote;
    from = `origin/${branch}`;
  } else if (local !== undefined) {
    start = local;
    from = branch;
  } else if (remote !== undefined) {
    start = remote;
    from = `origin/${branch}`;
  } else {
    const base = options.base ?? defaultBase(dir, git);
    start = run(git, dir, ["merge-base", base, "HEAD"], `Finding the merge-base with ${base}`);
    from = `${base} (merge-base ${start.slice(0, 7)})`;
  }
  const target = `${DESIGNS_DIR}${topic}.md`;
  report(`committing ${target} on ${branch} from ${from}`);
  const { commit, committed } = withTempWorktree(git, dir, start, (worktree) => {
    const dest = path.join(worktree, ...target.split("/"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest);
    run(git, worktree, ["add", "--", target], `Staging ${target}`);
    const unchanged = git(worktree, ["diff", "--cached", "--quiet"]).code === 0;
    if (!unchanged)
      run(git, worktree, ["commit", "-q", "-m", `docs(design): ${topic}`], "Committing the design");
    return {
      commit: run(git, worktree, ["rev-parse", "HEAD"], "Reading the design commit"),
      committed: !unchanged,
    };
  });
  // Push the commit first and move the local branch only once the push succeeded, so the branch
  // is never left moved but not pushed.
  report(`pushing ${branch} to ${fork}`);
  run(git, dir, ["push", "origin", `${commit}:refs/heads/${branch}`], `Pushing ${branch}`);
  run(git, dir, ["branch", "-f", branch, commit], `Setting ${branch}`);
  return {
    branch,
    commit,
    from,
    committed,
    fork,
    link: `https://github.com/${fork}/blob/${commit}/${target}`,
  };
}

export function designBranchCommand(
  positional: string[],
  flags: Record<string, string | boolean>,
  deps: PushCheckDeps & { checkout: string; onProgress?: (message: string) => void },
): string {
  const topic = positional[0];
  const file = typeof flags.file === "string" ? flags.file : undefined;
  if (topic === undefined || file === undefined)
    throw new ConfigError(
      "design-branch needs a topic and the draft: doodlebot design-branch <topic> --file <draft>.",
    );
  const result = designBranch(deps.checkout, topic, file, {
    ...deps,
    ...(typeof flags.base === "string" ? { base: flags.base } : {}),
  });
  return [
    `${result.branch} at ${result.commit.slice(0, 7)} (from ${result.from})` +
      (result.committed ? "" : "; the draft matches this commit, nothing new to commit"),
    `pushed to ${result.fork}`,
    `design: ${result.link}`,
  ].join("\n");
}
