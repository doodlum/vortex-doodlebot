import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { REPO_ROOT } from "./paths";

interface RunOptions {
  cwd: string;
  shell?: boolean;
}
type Run = (cmd: string, args: string[], opts: RunOptions) => { status: number; stdout: string };
/** bin/update.cjs, typed here so the harness needs no .d.cts and no allowJs. */
interface UpdateModule {
  update(
    root: string,
    ref: string | undefined,
    run?: Run,
    deps?: {
      stateDir?: string;
      imageName?: (pid: number) => string | undefined;
      log?: (message: string) => void;
    },
  ): void;
  parseUpdateArgs(args: string[]): string | undefined;
  defaultRun: Run;
}

const { update, parseUpdateArgs, defaultRun } = createRequire(import.meta.url)(
  path.join(REPO_ROOT, "bin", "update.cjs"),
) as UpdateModule;

let temp: string;
let stateDir: string;
let root: string;
const quiet = { log: () => undefined };

beforeEach(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "doodlebot-update-"));
  stateDir = path.join(temp, "state");
  root = path.join(temp, "workspace");
  fs.mkdirSync(stateDir);
  fs.mkdirSync(root);
});
afterEach(() => fs.rmSync(temp, { recursive: true, force: true }));

function record(pid: number) {
  return JSON.stringify({
    pid,
    startedAt: "2026-01-01T00:00:00.000Z",
    cacheDir: "C:/cache",
    userDataDir: "C:/cache/live",
    mcpPort: 3701,
  });
}

/** A run that records every call and answers from `answers` (default: success, no output). */
function recorder(answers: (cmd: string, args: string[]) => number = () => 0) {
  const calls: { cmd: string; args: string[]; opts: RunOptions }[] = [];
  const run: Run = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { status: answers(cmd, args), stdout: "" };
  };
  return { run, calls };
}

const git = (cwd: string, ...args: string[]): string =>
  execFileSync(
    "git",
    ["-c", "user.name=test", "-c", "user.email=test@example.test", "-C", cwd, ...args],
    { encoding: "utf8", windowsHide: true },
  ).trim();

describe("update arguments", () => {
  it("accepts --ref <ref> and --ref=<ref>, and nothing else", () => {
    expect(parseUpdateArgs(["--ref", "v2.0.0"])).toBe("v2.0.0");
    expect(parseUpdateArgs(["--ref=main"])).toBe("main");
    expect(parseUpdateArgs([])).toBeUndefined();
    for (const args of [["--ref"], ["v2"], ["--ref", "a", "b"], ["--force"], ["--reff=x"]])
      expect(() => parseUpdateArgs(args)).toThrow("update takes only --ref <tag or branch>.");
  });

  it("needs a ref", () => {
    const { run, calls } = recorder();
    expect(() => update(root, undefined, run, { stateDir, ...quiet })).toThrow(
      "update needs --ref <tag or branch>.",
    );
    expect(calls).toEqual([]);
  });

  it.each(["v1;rm -rf", "a b", "$(x)", "main&&calc", "ref|x", "-h"])(
    "refuses the ref %j",
    (ref) => {
      const { run, calls } = recorder();
      expect(() => update(root, ref, run, { stateDir, ...quiet })).toThrow(/Invalid ref/);
      expect(calls).toEqual([]);
    },
  );
});

describe("update refusals", () => {
  it("refuses while the per-user record names a running Vortex", () => {
    fs.writeFileSync(path.join(stateDir, "instance.json"), record(process.pid));
    const { run, calls } = recorder();
    expect(() =>
      update(root, "v2.0.0", run, {
        stateDir,
        imageName: (pid) => (pid === process.pid ? "vortex.exe" : undefined),
        ...quiet,
      }),
    ).toThrow("A harness Vortex is running; run doodlebot down before updating.");
    expect(calls).toEqual([]);
  });

  it("refuses while an older doodlebot's record in the workspace names a running Vortex", () => {
    fs.mkdirSync(path.join(root, "harness", ".cache"), { recursive: true });
    fs.writeFileSync(path.join(root, "harness", ".cache", "instance.json"), record(process.pid));
    const { run, calls } = recorder();
    expect(() =>
      update(root, "v2.0.0", run, { stateDir, imageName: () => "electron.exe", ...quiet }),
    ).toThrow("A harness Vortex is running; run doodlebot down before updating.");
    expect(calls).toEqual([]);
  });

  it("goes on when the recorded pid now belongs to another program", () => {
    fs.writeFileSync(path.join(stateDir, "instance.json"), record(process.pid));
    const { run, calls } = recorder();
    update(root, "v2.0.0", run, { stateDir, imageName: () => "node.exe", ...quiet });
    expect(calls.length).toBeGreaterThan(0);
  });

  it("refuses a workspace with local changes", () => {
    git(root, "init", "-q");
    fs.writeFileSync(path.join(root, "README.md"), "untracked\n");
    expect(() => update(root, "v2.0.0", defaultRun, { stateDir, ...quiet })).toThrow(
      "The workspace has local changes; commit or remove them before updating.",
    );
  });
});

describe("update command sequence", () => {
  const sequence = (calls: { cmd: string; args: string[]; opts: RunOptions }[]) =>
    calls.map(({ cmd, args, opts }) => [cmd, ...args, ...(opts.shell === true ? ["(shell)"] : [])]);

  it("resolves a tag, then installs and builds", () => {
    const { run, calls } = recorder();
    update(root, "v2.0.0", run, { stateDir, ...quiet });
    expect(sequence(calls)).toEqual([
      ["git", "status", "--porcelain"],
      ["git", "ls-remote", "--exit-code", "--tags", "origin", "refs/tags/v2.0.0"],
      ["git", "fetch", "origin", "tag", "v2.0.0"],
      ["git", "checkout", "--detach", "refs/tags/v2.0.0"],
      ["pnpm", "install", "--frozen-lockfile", "(shell)"],
      ["pnpm", "run", "build", "(shell)"],
    ]);
    expect(calls.every((call) => call.opts.cwd === root)).toBe(true);
  });

  it("falls back to a branch when there is no such tag", () => {
    const { run, calls } = recorder((_cmd, args) => (args.includes("--tags") ? 2 : 0));
    update(root, "main", run, { stateDir, ...quiet });
    expect(sequence(calls)).toEqual([
      ["git", "status", "--porcelain"],
      ["git", "ls-remote", "--exit-code", "--tags", "origin", "refs/tags/main"],
      ["git", "ls-remote", "--exit-code", "--heads", "origin", "main"],
      ["git", "fetch", "origin", "main"],
      ["git", "checkout", "--detach", "FETCH_HEAD"],
      ["pnpm", "install", "--frozen-lockfile", "(shell)"],
      ["pnpm", "run", "build", "(shell)"],
    ]);
  });

  it("fails on a ref that is neither, and stops on a failed step", () => {
    const missing = recorder((_cmd, args) => (args[0] === "ls-remote" ? 2 : 0));
    expect(() => update(root, "nope", missing.run, { stateDir, ...quiet })).toThrow(
      "No tag or branch nope on origin.",
    );
    expect(missing.calls.some((call) => call.cmd === "pnpm")).toBe(false);
    const failing = recorder((cmd, args) => (cmd === "git" && args[0] === "fetch" ? 1 : 0));
    expect(() => update(root, "v2.0.0", failing.run, { stateDir, ...quiet })).toThrow(
      /git fetch origin tag v2.0.0 failed/,
    );
    expect(failing.calls.some((call) => call.cmd === "pnpm")).toBe(false);
  });
});

describe("update against a synthetic remote", () => {
  let remote: string;
  let tagCommit: string;
  let branchCommit: string;
  beforeEach(() => {
    const seed = path.join(temp, "seed");
    remote = path.join(temp, "remote.git");
    fs.mkdirSync(seed);
    git(seed, "init", "-q", "-b", "main");
    fs.writeFileSync(path.join(seed, "a.txt"), "one\n");
    git(seed, "add", ".");
    git(seed, "commit", "-qm", "one");
    git(seed, "tag", "v9.9.9");
    tagCommit = git(seed, "rev-parse", "HEAD");
    git(seed, "checkout", "-qb", "feature/x");
    fs.writeFileSync(path.join(seed, "a.txt"), "two\n");
    git(seed, "commit", "-qam", "two");
    branchCommit = git(seed, "rev-parse", "HEAD");
    git(seed, "checkout", "-q", "main");
    fs.writeFileSync(path.join(seed, "a.txt"), "three\n");
    git(seed, "commit", "-qam", "three");
    execFileSync("git", ["clone", "-q", "--bare", seed, remote], { windowsHide: true });
    fs.rmSync(root, { recursive: true, force: true });
    execFileSync("git", ["clone", "-q", remote, root], { windowsHide: true });
  });

  /** Real git; pnpm is recorded, never run. */
  function realGit() {
    const pnpm: string[][] = [];
    const run: Run = (cmd, args, opts) => {
      if (cmd === "pnpm") {
        pnpm.push(args);
        return { status: 0, stdout: "" };
      }
      return defaultRun(cmd, args, opts);
    };
    return { run, pnpm };
  }

  it("checks out a tag detached", () => {
    const { run, pnpm } = realGit();
    update(root, "v9.9.9", run, { stateDir, ...quiet });
    expect(git(root, "rev-parse", "HEAD")).toBe(tagCommit);
    expect(git(root, "status", "--porcelain", "--branch")).toMatch(/HEAD \(no branch\)/);
    expect(pnpm).toEqual([
      ["install", "--frozen-lockfile"],
      ["run", "build"],
    ]);
  });

  it("checks out a branch's head detached", () => {
    const { run } = realGit();
    update(root, "feature/x", run, { stateDir, ...quiet });
    expect(git(root, "rev-parse", "HEAD")).toBe(branchCommit);
  });

  it("reports a ref origin does not have", () => {
    const { run, pnpm } = realGit();
    const before = git(root, "rev-parse", "HEAD");
    expect(() => update(root, "v0.0.1", run, { stateDir, ...quiet })).toThrow(
      "No tag or branch v0.0.1 on origin.",
    );
    expect(git(root, "rev-parse", "HEAD")).toBe(before);
    expect(pnpm).toEqual([]);
  });
});
