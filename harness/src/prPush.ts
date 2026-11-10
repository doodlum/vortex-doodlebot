/**
 * `doodlebot pr-branch <topic>`: the branch a Vortex pull request is opened from, and the only
 * place the kit pushes Vortex work.
 *
 * - **pr/<topic>** is built from the merge-base with upstream by cherry-picking every commit of
 *   the work branch except its `docs(design)` commits, so the design never reaches the PR. A
 *   non-design commit that touches `docs/designs/` is refused: split it first.
 * - **design/<topic>** is a tag on the approved `docs(design)` commit (`--design-commit`), so the
 *   PR description can link the design at its commit on the person's fork. An unapproved
 *   revision is never tagged.
 * - **Pushes go only to the person's own fork.** Before any push, `gh api repos/<origin>` must show
 *   that `origin` is a fork of Nexus-Mods/Vortex owned by the person's GitHub login, or the
 *   repository `VORTEX_AI_VORTEX_REPO` names when it is such a fork the person can push to. An
 *   absent `origin`, Nexus-Mods/Vortex itself, or someone else's fork is refused, whatever rights
 *   the person has upstream.
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

/** A commit whose subject marks it as the design: `docs(design): ...` (or `docs(design)!:`). */
export const isDesignSubject = (subject: string): boolean => /^docs\(design\)!?:/.test(subject);

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

export interface PrBranchResult {
  branch: string;
  head: string;
  mergeBase: string;
  picked: string[];
  skipped: string[];
  /**
   * `design/<topic>` and the approved design commit it marks; `archived` names the tag that now
   * keeps the earlier approval when this run moved it.
   */
  tag?: { name: string; commit: string; archived?: string };
}

/** `upstream/<its default branch>`, the base work branches start from. */
export function defaultBase(dir: string, git: GitRunner = defaultGit): string {
  const head = git(dir, ["symbolic-ref", "--short", "refs/remotes/upstream/HEAD"]);
  return head.code === 0 && head.stdout.trim() !== "" ? head.stdout.trim() : "upstream/master";
}

/**
 * Build `pr/<topic>` from the merge-base of HEAD and `base` with every non-design commit, and tag
 * the last design commit `design/<topic>`. Works in a temporary worktree, so the checkout's own
 * files never change.
 */
export function buildPrBranch(
  dir: string,
  topic: string,
  options: {
    base?: string;
    /** The approved design commit, to tag `design/<topic>` (tagApprovedDesign). */
    designCommit?: string;
    git?: GitRunner;
    onProgress?: (message: string) => void;
  } = {},
): PrBranchResult {
  const git = options.git ?? defaultGit;
  const report = options.onProgress ?? ((): void => undefined);
  if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(topic) || topic.includes(".."))
    throw new ConfigError(
      `${topic} is not a usable topic; use letters, digits, ".", "_", "-" and "/".`,
    );
  const branch = `pr/${topic}`;
  const current = git(dir, ["symbolic-ref", "--short", "HEAD"]).stdout.trim();
  if (current === branch)
    throw new ConfigError(
      `${branch} is checked out; switch to the work branch and run this again.`,
    );
  const base = options.base ?? defaultBase(dir, git);
  const mergeBase = run(
    git,
    dir,
    ["merge-base", base, "HEAD"],
    `Finding the merge-base with ${base}`,
  );
  if (run(git, dir, ["rev-list", "--merges", `${mergeBase}..HEAD`], "Listing merges") !== "")
    throw new ConfigError(
      `The branch has merge commits since ${base}; rebase it onto ${base} first.`,
    );
  const commits = run(git, dir, ["rev-list", "--reverse", `${mergeBase}..HEAD`], "Listing commits")
    .split("\n")
    .filter(Boolean);
  const picked: string[] = [];
  const skipped: string[] = [];
  for (const commit of commits) {
    const subject = run(git, dir, ["log", "-1", "--format=%s", commit], "Reading a commit");
    const files = run(
      git,
      dir,
      ["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", commit],
      "Reading a commit's files",
    )
      .split("\n")
      .filter(Boolean);
    if (isDesignSubject(subject)) {
      skipped.push(commit);
      continue;
    }
    const design = files.filter((file) => file.startsWith(DESIGNS_DIR));
    if (design.length > 0)
      throw new ConfigError(
        `${commit.slice(0, 7)} "${subject}" is not a docs(design) commit but changes ${design.join(", ")}. ` +
          "Move the design change into a docs(design) commit, so it stays out of the PR.",
      );
    picked.push(commit);
  }
  if (picked.length === 0)
    throw new ConfigError(`The branch has no commits besides its design since ${base}.`);
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "doodlebot-pr-"));
  let head: string;
  try {
    run(git, dir, ["worktree", "add", "--detach", worktree, mergeBase], "Creating a worktree");
    report(`cherry-picking ${String(picked.length)} commit(s) onto ${mergeBase.slice(0, 7)}`);
    const pick = git(worktree, ["cherry-pick", "--allow-empty", ...picked]);
    if (pick.code !== 0) {
      git(worktree, ["cherry-pick", "--abort"]);
      throw new ConfigError(
        `A commit did not apply without the design commits: ${pick.stderr.trim().split("\n")[0] ?? ""}. ` +
          "Keep code and design in separate commits.",
      );
    }
    head = run(git, worktree, ["rev-parse", "HEAD"], "Reading the new head");
  } finally {
    git(dir, ["worktree", "remove", "--force", worktree]);
    fs.rmSync(worktree, { recursive: true, force: true });
    git(dir, ["worktree", "prune"]);
  }
  run(git, dir, ["branch", "-f", branch, head], `Setting ${branch}`);
  const result: PrBranchResult = { branch, head, mergeBase, picked, skipped };
  const tag = tagApprovedDesign(dir, topic, skipped, options.designCommit, git);
  if (tag !== undefined) result.tag = tag;
  return result;
}

const tagged = (git: GitRunner, dir: string, name: string): string | undefined => {
  const found = git(dir, ["rev-parse", "--verify", "--quiet", `refs/tags/${name}^{commit}`]);
  return found.code === 0 && found.stdout.trim() !== "" ? found.stdout.trim() : undefined;
};

/**
 * `design/<topic>` marks the approved design commit, and only that: it is set from
 * `--design-commit`, which the person's approval names, never from the branch's last design
 * commit. A later approved revision moves it, and the commit it marked is kept as
 * `design/<topic>-v<n>` (git cannot hold both `design/<topic>` and `design/<topic>/v<n>`).
 * Without `--design-commit` an existing tag is left where it is.
 */
function tagApprovedDesign(
  dir: string,
  topic: string,
  designCommits: string[],
  designCommit: string | undefined,
  git: GitRunner,
): PrBranchResult["tag"] {
  const name = `design/${topic}`;
  const current = tagged(git, dir, name);
  if (designCommit === undefined)
    return current === undefined ? undefined : { name, commit: current };
  const approved = run(
    git,
    dir,
    ["rev-parse", "--verify", `${designCommit}^{commit}`],
    `Reading ${designCommit}`,
  );
  if (!designCommits.includes(approved))
    throw new ConfigError(
      `${designCommit} is not one of this branch's docs(design) commits; --design-commit names the approved design commit.`,
    );
  if (current === approved) return { name, commit: approved };
  let archived: string | undefined;
  if (current !== undefined) {
    let n = 1;
    while (tagged(git, dir, `${name}-v${String(n)}`) !== undefined) n++;
    archived = `${name}-v${String(n)}`;
    run(git, dir, ["tag", archived, current], `Keeping the earlier approval as ${archived}`);
  }
  run(git, dir, ["tag", "-f", name, approved], `Tagging ${name}`);
  return { name, commit: approved, ...(archived === undefined ? {} : { archived }) };
}

/** Push `pr/<topic>` (and its design tag) to origin, after checkPushRemote. */
export function pushPrBranch(dir: string, built: PrBranchResult, deps: PushCheckDeps = {}): string {
  const git = deps.git ?? defaultGit;
  const fork = checkPushRemote(dir, deps);
  run(git, dir, ["push", "--force-with-lease", "origin", built.branch], `Pushing ${built.branch}`);
  if (built.tag?.archived !== undefined)
    run(
      git,
      dir,
      ["push", "origin", `refs/tags/${built.tag.archived}`],
      `Pushing ${built.tag.archived}`,
    );
  if (built.tag !== undefined)
    run(
      git,
      dir,
      ["push", "--force", "origin", `refs/tags/${built.tag.name}`],
      `Pushing ${built.tag.name}`,
    );
  return fork;
}

export function prBranchCommand(
  positional: string[],
  flags: Record<string, string | boolean>,
  deps: PushCheckDeps & { checkout: string; onProgress?: (message: string) => void },
): string {
  const topic = positional[0];
  if (topic === undefined)
    throw new ConfigError("pr-branch needs a topic: doodlebot pr-branch <topic> [--push].");
  const built = buildPrBranch(deps.checkout, topic, {
    base: typeof flags.base === "string" ? flags.base : undefined,
    ...(typeof flags["design-commit"] === "string" ? { designCommit: flags["design-commit"] } : {}),
    git: deps.git,
    onProgress: deps.onProgress,
  });
  const lines = [
    `${built.branch} at ${built.head.slice(0, 7)}: ${String(built.picked.length)} commit(s) from ${built.mergeBase.slice(0, 7)}, ` +
      `${String(built.skipped.length)} docs(design) commit(s) left out`,
    built.tag === undefined
      ? "no design tag (--design-commit <approved design commit> sets one)"
      : `${built.tag.name} -> ${built.tag.commit.slice(0, 7)}` +
        (built.tag.archived === undefined
          ? ""
          : `; the earlier approval is kept as ${built.tag.archived}`),
  ];
  if (flags.push === true) {
    const fork = pushPrBranch(deps.checkout, built, deps);
    lines.push(`pushed to ${fork}`);
  } else lines.push("not pushed (add --push to push to your fork)");
  return lines.join("\n");
}
