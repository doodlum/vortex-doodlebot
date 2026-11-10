import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runPreflight } from "./prPreflight";
import {
  type GitRunner,
  type RunResult,
  buildPrBranch,
  checkPushRemote,
  parseGitHubRepo,
  prBranchCommand,
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
// pr/<topic> and design/<topic> in a real temporary repository
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
function featureRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pr-branch-"));
  dirs.push(repo);
  run(repo, "init", "-q", "-b", "master");
  run(repo, "config", "user.email", "t@example.test");
  run(repo, "config", "user.name", "T");
  run(repo, "config", "core.autocrlf", "false");
  commit(repo, "base", { "src/a.ts": "export const a = 1;\n" });
  run(repo, "checkout", "-q", "-b", "feat/zoom");
  commit(repo, "docs(design): zoom", { "docs/designs/zoom.md": "# Zoom\n" });
  commit(repo, "feat: zoom", { "src/a.ts": "export const a = 2;\n" });
  commit(repo, "docs(design): zoom, approved", { "docs/designs/zoom.md": "# Zoom\n\nApproved\n" });
  commit(repo, "test: zoom", { "src/a.test.ts": "a\n" });
  return repo;
}

describe("pr-branch", { timeout: 60_000 }, () => {
  it("cherry-picks every non-design commit onto the merge-base and tags the design", () => {
    const repo = featureRepo();
    const lastDesign = run(repo, "rev-parse", "HEAD~1");
    const built = buildPrBranch(repo, "zoom", { base: "master", designCommit: lastDesign });
    expect(built.branch).toBe("pr/zoom");
    expect(built.picked).toHaveLength(2);
    expect(built.skipped).toHaveLength(2);
    expect(built.tag).toEqual({ name: "design/zoom", commit: lastDesign });
    expect(run(repo, "rev-parse", "design/zoom")).toBe(lastDesign);
    expect(run(repo, "log", "--format=%s", "master..pr/zoom").split("\n")).toEqual([
      "test: zoom",
      "feat: zoom",
    ]);
    expect(run(repo, "diff", "--name-only", "master", "pr/zoom").split("\n")).toEqual([
      "src/a.test.ts",
      "src/a.ts",
    ]);
    // The checkout itself was not touched, and no worktree is left behind.
    expect(run(repo, "symbolic-ref", "--short", "HEAD")).toBe("feat/zoom");
    expect(run(repo, "status", "--porcelain")).toBe("");
    expect(run(repo, "worktree", "list").split("\n")).toHaveLength(1);
  });

  it("tags only the approved design commit, and keeps an earlier approval when it moves", () => {
    const repo = featureRepo();
    const first = run(repo, "rev-parse", "HEAD~3");
    const approved = run(repo, "rev-parse", "HEAD~1");
    // No approval named: no tag, even though the branch has design commits.
    expect(buildPrBranch(repo, "zoom", { base: "master" }).tag).toBeUndefined();
    expect(run(repo, "tag", "--list", "design/*")).toBe("");
    expect(() =>
      buildPrBranch(repo, "zoom", { base: "master", designCommit: run(repo, "rev-parse", "HEAD") }),
    ).toThrow(/not one of this branch's docs\(design\) commits/);
    expect(buildPrBranch(repo, "zoom", { base: "master", designCommit: first }).tag).toEqual({
      name: "design/zoom",
      commit: first,
    });
    // A later approved revision moves the tag; the first approval is kept.
    expect(buildPrBranch(repo, "zoom", { base: "master", designCommit: approved }).tag).toEqual({
      name: "design/zoom",
      commit: approved,
      archived: "design/zoom-v1",
    });
    expect(run(repo, "rev-parse", "design/zoom")).toBe(approved);
    expect(run(repo, "rev-parse", "design/zoom-v1^{commit}")).toBe(first);
    // Without a new approval the tag stays where it is.
    expect(buildPrBranch(repo, "zoom", { base: "master" }).tag).toEqual({
      name: "design/zoom",
      commit: approved,
    });
  });

  it("refuses a non-design commit that touches docs/designs/", () => {
    const repo = featureRepo();
    commit(repo, "fix: tweak", { "docs/designs/zoom.md": "# Zoom v2\n", "src/a.ts": "x\n" });
    expect(() => buildPrBranch(repo, "zoom", { base: "master" })).toThrow(
      /not a docs\(design\) commit but changes docs\/designs\/zoom.md/,
    );
    expect(() => run(repo, "rev-parse", "--verify", "--quiet", "pr/zoom")).toThrow();
  });

  it("does not push without --push, and pushes only after the fork check", () => {
    const repo = featureRepo();
    expect(prBranchCommand(["zoom"], { base: "master" }, { checkout: repo })).toContain(
      "not pushed",
    );
    const pushes: string[][] = [];
    const real: GitRunner = (dir, args) => {
      if (args[0] === "push") {
        pushes.push(args);
        return ok();
      }
      if (args.join(" ") === "remote get-url origin")
        return ok("https://github.com/doodlum/Vortex\n");
      try {
        return ok(run(dir, ...args));
      } catch {
        return { code: 1, stdout: "", stderr: "failed" };
      }
    };
    const { gh } = ghFor(fork("doodlum"));
    expect(
      prBranchCommand(
        ["zoom"],
        { base: "master", push: true, "design-commit": run(repo, "rev-parse", "HEAD~1") },
        { checkout: repo, git: real, gh },
      ),
    ).toContain("pushed to doodlum/Vortex");
    expect(pushes).toEqual([
      ["push", "--force-with-lease", "origin", "pr/zoom"],
      ["push", "--force", "origin", "refs/tags/design/zoom"],
    ]);
    const someoneElse = ghFor(fork("someone"));
    pushes.length = 0;
    expect(() =>
      prBranchCommand(
        ["zoom"],
        { base: "master", push: true },
        { checkout: repo, git: real, gh: someoneElse.gh, configuredRepo: "" },
      ),
    ).toThrow(/not by doodlum/);
    expect(pushes).toEqual([]);
  });

  it("pr-preflight FAILs on the design file in the diff or a commit, and passes on pr/<topic>", async () => {
    const repo = featureRepo();
    const onBranch = await runPreflight({ checkout: repo, base: "master", skipRevert: true });
    const design = onBranch.checks.find((check) => check.id === "design")!;
    expect(design.status).toBe("fail");
    expect(design.details).toContain("in the diff: docs/designs/zoom.md");
    expect(design.details.some((d) => d.includes("docs(design): zoom: docs/designs/zoom.md"))).toBe(
      true,
    );
    expect(onBranch.passed).toBe(false);

    buildPrBranch(repo, "zoom", { base: "master", designCommit: run(repo, "rev-parse", "HEAD~1") });
    run(repo, "checkout", "-q", "pr/zoom");
    const clean = await runPreflight({ checkout: repo, base: "master", skipRevert: true });
    expect(clean.checks.find((check) => check.id === "design")?.status).toBe("pass");

    // A later commit on pr/<topic> that brings the design back is caught through the tag.
    commit(repo, "chore: oops", { "docs/designs/zoom.md": "# Zoom\n" });
    const planted = await runPreflight({ checkout: repo, base: "master", skipRevert: true });
    expect(planted.checks.find((check) => check.id === "design")).toMatchObject({
      status: "fail",
      details: expect.arrayContaining(["in the diff: docs/designs/zoom.md"]),
    });
  });
});
