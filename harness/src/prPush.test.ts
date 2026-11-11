import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  type GitRunner,
  type RunResult,
  checkPushRemote,
  designBranch,
  designBranchCommand,
  parseGitHubRepo,
  pushSessionBranch,
} from "./prPush";

const ok = (stdout = ""): RunResult => ({ code: 0, stdout, stderr: "" });

/** A checkout whose origin is `url` (absent when undefined). */
const gitWithOrigin =
  (url: string | undefined): GitRunner =>
  (_dir, args) =>
    args.join(" ") === "remote get-url origin"
      ? url === undefined
        ? { code: 2, stdout: "", stderr: "error: No such remote 'origin'" }
        : ok(`${url}\n`)
      : ok();

function ghFor(repo: Record<string, unknown>, login = "doodlum") {
  const calls: string[][] = [];
  const gh = (args: string[]): RunResult => {
    calls.push(args);
    if (args[1] === "user") return ok(`${login}\n`);
    return ok(JSON.stringify(repo));
  };
  return { gh, calls };
}

const fork = (owner: string, extra: Record<string, unknown> = {}) => ({
  full_name: `${owner}/Vortex`,
  fork: true,
  owner: { login: owner },
  parent: { full_name: "Nexus-Mods/Vortex" },
  ...extra,
});

describe("the push check", () => {
  it("reads GitHub remotes in https, ssh and scp form", () => {
    expect(parseGitHubRepo("https://github.com/doodlum/Vortex.git")).toBe("doodlum/Vortex");
    expect(parseGitHubRepo("git@github.com:doodlum/Vortex.git")).toBe("doodlum/Vortex");
    expect(parseGitHubRepo("ssh://git@github.com/doodlum/Vortex")).toBe("doodlum/Vortex");
    expect(parseGitHubRepo("https://gitlab.com/doodlum/Vortex.git")).toBeUndefined();
  });

  it("refuses an absent origin, before asking GitHub", () => {
    const { gh, calls } = ghFor(fork("doodlum"));
    expect(() => checkPushRemote("x", { git: gitWithOrigin(undefined), gh })).toThrow(
      /no origin remote.*gh repo fork Nexus-Mods\/Vortex --remote/,
    );
    expect(calls).toEqual([]);
  });

  it("refuses Nexus-Mods/Vortex itself, even for someone with push rights there", () => {
    const { gh, calls } = ghFor({
      full_name: "Nexus-Mods/Vortex",
      fork: false,
      owner: { login: "Nexus-Mods" },
      permissions: { push: true },
    });
    expect(() =>
      checkPushRemote("x", { git: gitWithOrigin("https://github.com/nexus-mods/vortex.git"), gh }),
    ).toThrow(/origin is Nexus-Mods\/Vortex itself/);
    expect(calls).toEqual([]);
  });

  it("refuses someone else's fork, even one the person can push to", () => {
    const { gh } = ghFor(fork("someone", { permissions: { push: true } }));
    expect(() =>
      checkPushRemote("x", {
        git: gitWithOrigin("https://github.com/someone/Vortex.git"),
        gh,
        configuredRepo: "",
      }),
    ).toThrow(/owned by someone, not by doodlum.*Nothing was pushed/);
  });

  it("refuses a repository that is not a fork of Nexus-Mods/Vortex", () => {
    const { gh } = ghFor({ full_name: "doodlum/Vortex", fork: false, owner: { login: "doodlum" } });
    expect(() =>
      checkPushRemote("x", { git: gitWithOrigin("git@github.com:doodlum/Vortex.git"), gh }),
    ).toThrow(/not a fork of Nexus-Mods\/Vortex/);
  });

  it("accepts the person's own fork", () => {
    const { gh, calls } = ghFor(fork("doodlum"));
    expect(
      checkPushRemote("x", { git: gitWithOrigin("https://github.com/doodlum/Vortex.git"), gh }),
    ).toBe("doodlum/Vortex");
    expect(calls[0]).toEqual(["api", "repos/doodlum/Vortex"]);
  });

  it("refuses when origin's push URL is not the fork it fetches from", () => {
    const { gh, calls } = ghFor(fork("doodlum"));
    const git: GitRunner = (_dir, args) => {
      const command = args.join(" ");
      if (command === "remote get-url origin") return ok("https://github.com/doodlum/Vortex.git\n");
      if (command === "remote get-url --push --all origin")
        return ok(
          "https://github.com/doodlum/Vortex.git\nhttps://github.com/Nexus-Mods/Vortex.git\n",
        );
      return ok();
    };
    expect(() => checkPushRemote("x", { git, gh })).toThrow(
      /pushes to https:\/\/github\.com\/Nexus-Mods\/Vortex\.git.*Nothing was pushed/,
    );
    expect(calls).toEqual([]);
  });

  it("accepts a configured VORTEX_AI_VORTEX_REPO fork only when the person can push to it", () => {
    const origin = gitWithOrigin("https://github.com/acme/Vortex.git");
    const pushable = ghFor(fork("acme", { permissions: { push: true } }));
    expect(
      checkPushRemote("x", { git: origin, gh: pushable.gh, configuredRepo: "acme/Vortex" }),
    ).toBe("acme/Vortex");
    const readOnly = ghFor(fork("acme", { permissions: { push: false } }));
    expect(() =>
      checkPushRemote("x", { git: origin, gh: readOnly.gh, configuredRepo: "acme/Vortex" }),
    ).toThrow(/cannot push to it/);
  });
});

// ---------------------------------------------------------------------------
// designs/<topic> in a real temporary repository, from a worktree session
// ---------------------------------------------------------------------------

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function run(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}
function commit(repo: string, message: string, files: Record<string, string>): string {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), content);
  }
  run(repo, "add", "-A");
  run(repo, "commit", "-q", "-m", message);
  return run(repo, "rev-parse", "HEAD");
}
const tempDir = (prefix: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

/**
 * A clone whose session is a worktree on `feat/zoom`, one commit past `master`, with an
 * uncommitted edit and an untracked file, and a draft outside it.
 */
function worktreeSession(): { main: string; session: string; draft: string; base: string } {
  const main = tempDir("design-branch-");
  run(main, "init", "-q", "-b", "master");
  run(main, "config", "user.email", "t@example.test");
  run(main, "config", "user.name", "T");
  run(main, "config", "core.autocrlf", "false");
  const base = commit(main, "base", { "src/a.ts": "export const a = 1;\n" });
  const session = path.join(tempDir("design-session-"), "wt");
  run(main, "worktree", "add", "-q", "-b", "feat/zoom", session, "master");
  commit(session, "feat: zoom", { "src/a.ts": "export const a = 2;\n" });
  fs.writeFileSync(path.join(session, "src/a.ts"), "export const a = 3;\n");
  fs.writeFileSync(path.join(session, "notes.txt"), "untracked\n");
  const draft = path.join(tempDir("design-draft-"), "design_draft.md");
  fs.writeFileSync(draft, "# Zoom\n\nDraft 1\n");
  return { main, session, draft, base };
}

/** Real git, except that pushes are recorded and origin is the person's fork. */
function forkGit(pushes: string[][]): GitRunner {
  return (dir, args) => {
    if (args[0] === "push") {
      pushes.push(args);
      return ok();
    }
    if (args.join(" ") === "remote get-url origin")
      return ok("https://github.com/doodlum/Vortex\n");
    try {
      return ok(execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }));
    } catch {
      return { code: 1, stdout: "", stderr: "failed" };
    }
  };
}

describe("design-branch", { timeout: 60_000 }, () => {
  it("commits the draft on designs/<topic> from the upstream base, without touching the session", () => {
    const { main, session, draft, base } = worktreeSession();
    const status = run(session, "status", "--porcelain");
    const head = run(session, "rev-parse", "HEAD");
    const pushes: string[][] = [];
    const { gh } = ghFor(fork("doodlum"));
    const result = designBranch(session, "zoom", draft, {
      base: "master",
      git: forkGit(pushes),
      gh,
    });

    expect(result).toMatchObject({
      branch: "designs/zoom",
      committed: true,
      fork: "doodlum/Vortex",
    });
    expect(result.link).toBe(
      `https://github.com/doodlum/Vortex/blob/${result.commit}/docs/designs/zoom.md`,
    );
    expect(run(main, "show", "designs/zoom:docs/designs/zoom.md")).toBe("# Zoom\n\nDraft 1");
    expect(run(main, "log", "-1", "--format=%s", "designs/zoom")).toBe("docs(design): zoom");
    // Built on the session branch's upstream base, so it holds only the design.
    expect(run(main, "rev-parse", "designs/zoom~1")).toBe(base);
    expect(run(main, "diff", "--name-only", base, "designs/zoom")).toBe("docs/designs/zoom.md");
    expect(pushes).toEqual([["push", "origin", "refs/heads/designs/zoom:refs/heads/designs/zoom"]]);

    // The session's branch, head and status are unchanged, and no worktree is left behind.
    expect(run(session, "symbolic-ref", "--short", "HEAD")).toBe("feat/zoom");
    expect(run(session, "rev-parse", "HEAD")).toBe(head);
    expect(run(session, "status", "--porcelain")).toBe(status);
    expect(run(main, "worktree", "list").split("\n")).toHaveLength(2);
    expect(run(main, "diff", "--name-only", "master", "feat/zoom")).toBe("src/a.ts");
  });

  it("adds each revision on top of the last, and commits nothing for an unchanged draft", () => {
    const { main, session, draft } = worktreeSession();
    const pushes: string[][] = [];
    const deps = { base: "master", git: forkGit(pushes), gh: ghFor(fork("doodlum")).gh };
    const first = designBranch(session, "zoom", draft, deps);
    fs.writeFileSync(draft, "# Zoom\n\nDraft 2, approved\n");
    const second = designBranch(session, "zoom", draft, deps);
    expect(second).toMatchObject({ committed: true, from: "designs/zoom" });
    expect(run(main, "rev-parse", "designs/zoom~1")).toBe(first.commit);
    const again = designBranch(session, "zoom", draft, deps);
    expect(again).toMatchObject({ committed: false, commit: second.commit });
    // Each revision's link names its own commit, so the approved one stays readable.
    expect(first.link).not.toBe(second.link);
  });

  it("refuses before committing anything when origin is not the person's fork", () => {
    const { main, session, draft } = worktreeSession();
    const pushes: string[][] = [];
    expect(() =>
      designBranch(session, "zoom", draft, {
        base: "master",
        git: forkGit(pushes),
        gh: ghFor(fork("someone")).gh,
        configuredRepo: "",
      }),
    ).toThrow(/not by doodlum/);
    expect(pushes).toEqual([]);
    expect(() => run(main, "rev-parse", "--verify", "--quiet", "designs/zoom")).toThrow();
  });

  it("refuses a missing draft, a bad topic, and running on designs/<topic> itself", () => {
    const { main, session, draft } = worktreeSession();
    const deps = { base: "master", git: forkGit([]), gh: ghFor(fork("doodlum")).gh };
    expect(() => designBranch(session, "zoom", `${draft}.missing`, deps)).toThrow(/is not a file/);
    expect(() => designBranch(session, "../zoom", draft, deps)).toThrow(/not a usable topic/);
    run(main, "switch", "-q", "-c", "designs/zoom");
    expect(() => designBranch(main, "zoom", draft, deps)).toThrow(/designs\/zoom is checked out/);
    expect(() => designBranchCommand(["zoom"], {}, { checkout: session })).toThrow(
      /--file <draft>/,
    );
  });

  it("prints the branch, the fork and the link", () => {
    const { session, draft } = worktreeSession();
    const text = designBranchCommand(
      ["zoom"],
      { base: "master", file: draft },
      { checkout: session, git: forkGit([]), gh: ghFor(fork("doodlum")).gh },
    );
    expect(text).toMatch(
      /^designs\/zoom at [0-9a-f]{7} \(from master \(merge-base [0-9a-f]{7}\)\)$/m,
    );
    expect(text).toContain("pushed to doodlum/Vortex");
    expect(text).toMatch(
      /^design: https:\/\/github\.com\/doodlum\/Vortex\/blob\/[0-9a-f]{40}\/docs\/designs\/zoom\.md$/m,
    );
  });
});
describe("push-branch", { timeout: 60_000 }, () => {
  it("pushes the session's branch after the fork check, and refuses what is never shipped", () => {
    const { main, session } = worktreeSession();
    const pushes: string[][] = [];
    const deps = { git: forkGit(pushes), gh: ghFor(fork("doodlum")).gh };
    expect(pushSessionBranch(session, deps)).toEqual({
      branch: "feat/zoom",
      fork: "doodlum/Vortex",
    });
    expect(pushes).toEqual([["push", "-u", "origin", "feat/zoom"]]);

    pushes.length = 0;
    expect(() =>
      pushSessionBranch(session, { ...deps, gh: ghFor(fork("someone")).gh, configuredRepo: "" }),
    ).toThrow(/not by doodlum/);
    run(session, "stash", "-q", "-u");
    run(session, "switch", "-q", "-c", "proto/zoom");
    expect(() => pushSessionBranch(session, deps)).toThrow(/prototype is never shipped/);
    run(session, "switch", "-q", "-c", "designs/zoom");
    expect(() => pushSessionBranch(session, deps)).toThrow(/design-branch/);
    expect(() => pushSessionBranch(main, deps)).toThrow(/master is the default branch/);
    run(session, "switch", "-q", "--detach");
    expect(() => pushSessionBranch(session, deps)).toThrow(/HEAD is detached/);
    expect(pushes).toEqual([]);
  });
});
