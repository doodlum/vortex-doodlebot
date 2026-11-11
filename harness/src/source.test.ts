import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ForkError,
  NO_FORK_NOTE,
  commandEnv,
  cloneVortex,
  cutWorkBranch,
  fetchRemotes,
  missingBuildOutputs,
  nestedPath,
  needsShell,
  parsePnpmVersion,
  runStreaming,
  selectPnpmCommand,
} from "./source";

it("preserves source paths containing spaces when invoking git", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vortex source "));
  try {
    await runStreaming("git", ["init", "--bare", path.join(dir, "source repo")], {
      label: "Initialize source fixture",
    });
    expect(fs.existsSync(path.join(dir, "source repo", "HEAD"))).toBe(true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("Vortex source package manager", () => {
  it("reads the exact version while ignoring a Corepack integrity suffix", () => {
    expect(parsePnpmVersion("pnpm@11.10.0+sha512.deadbeef")).toBe("11.10.0");
    expect(parsePnpmVersion("pnpm@11.10.0")).toBe("11.10.0");
  });

  it("rejects an absent or floating package-manager declaration", () => {
    expect(() => parsePnpmVersion(undefined)).toThrow(ForkError);
    expect(() => parsePnpmVersion("pnpm@latest")).toThrow("exact pnpm version");
  });

  it("uses pnpm directly only when its version matches the source checkout", () => {
    expect(selectPnpmCommand("11.10.0", "11.10.0")).toEqual({
      cmd: "pnpm",
      args: [],
      version: "11.10.0",
      exact: true,
    });
  });

  it("uses VORTEX_AI_PNPM instead of pnpm dlx when PATH has another pnpm", () => {
    expect(selectPnpmCommand("11.10.0", "9.15.0", "J:/tools/node22/pnpm.cmd")).toEqual({
      cmd: "J:/tools/node22/pnpm.cmd",
      args: [],
      version: "11.10.0",
      exact: true,
    });
    // a matching pnpm on PATH still wins, and an empty override is no override
    expect(selectPnpmCommand("11.10.0", "11.10.0", "C:/x/pnpm.cmd").cmd).toBe("pnpm");
    expect(selectPnpmCommand("11.10.0", "9.15.0", " ").args).toEqual(["dlx", "pnpm@11.10.0"]);
  });

  it.runIf(process.platform === "win32")("runs pnpm and .cmd shims through a shell", () => {
    expect(needsShell("pnpm")).toBe(true);
    expect(needsShell("J:/tools/node22/pnpm.CMD")).toBe(true);
    expect(needsShell("git")).toBe(false);
  });

  it("bootstraps the checkout's exact version when PATH has another pnpm", () => {
    expect(selectPnpmCommand("11.10.0", "9.15.0", undefined)).toEqual({
      cmd: "pnpm",
      args: ["dlx", "pnpm@11.10.0"],
      version: "11.10.0",
      exact: false,
    });
  });
});

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

describe("cloning Vortex with and without a fork", { timeout: 120_000 }, () => {
  let root: string;
  let upstream: string;
  let fork: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-clone-"));
    const work = path.join(root, "work");
    fs.mkdirSync(path.join(work, "src", "main"), { recursive: true });
    git(work, "init", "-q", "-b", "master");
    git(work, "config", "user.email", "t@example.test");
    git(work, "config", "user.name", "T");
    fs.writeFileSync(path.join(work, "src", "main", "package.json"), "{}\n");
    git(work, "add", "-A");
    git(work, "commit", "-q", "-m", "upstream");
    upstream = path.join(root, "upstream.git");
    git(root, "clone", "-q", "--bare", work, upstream);
    // The fork's default branch carries its own work, as doodlum's `linux` does.
    git(work, "checkout", "-q", "-b", "linux");
    fs.writeFileSync(path.join(work, "fork-only.txt"), "fork\n");
    git(work, "add", "-A");
    git(work, "commit", "-q", "-m", "fork work");
    fork = path.join(root, "fork.git");
    git(root, "clone", "-q", "--bare", work, fork);
    git(fork, "symbolic-ref", "HEAD", "refs/heads/linux");
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const remotes = (dir: string): string[] =>
    git(dir, "remote").split("\n").filter(Boolean).toSorted();

  it("clones upstream alone, as `upstream` with no origin, when there is no fork", async () => {
    const dir = path.join(root, "src-nofork");
    const messages: string[] = [];
    const source = await cloneVortex(dir, {
      upstreamUrl: upstream,
      resolveRepo: async () => undefined,
      onProgress: (m) => messages.push(m),
    });
    expect(source).toMatchObject({ hasFork: false, defaultBranch: "master" });
    expect(remotes(dir)).toEqual(["upstream"]);
    expect(git(dir, "remote", "get-url", "upstream")).toBe(upstream);
    expect(messages.join("\n")).toContain("no origin");
    expect(NO_FORK_NOTE).toContain("the checkout is a clone of Nexus-Mods/Vortex");

    // source --update on an upstream-only clone fetches upstream and reports it.
    const work = path.join(root, "work");
    git(work, "checkout", "-q", "master");
    fs.writeFileSync(path.join(work, "later.txt"), "later\n");
    git(work, "add", "-A");
    git(work, "commit", "-q", "-m", "later upstream");
    git(work, "push", "-q", upstream, "master");
    await fetchRemotes(dir);
    expect(git(dir, "rev-parse", "upstream/master")).toBe(git(work, "rev-parse", "master"));
    expect(remotes(dir)).toEqual(["upstream"]);

    // Work branches start from upstream's default branch.
    const cut = await cutWorkBranch(dir, "fix/thing");
    expect(cut).toEqual({ branch: "fix/thing", from: "upstream/master" });
    expect(git(dir, "rev-parse", "HEAD")).toBe(git(dir, "rev-parse", "upstream/master"));
  });

  it("clones the fork as origin beside upstream, and cuts branches from upstream", async () => {
    const dir = path.join(root, "src-fork");
    const source = await cloneVortex(dir, {
      upstreamUrl: upstream,
      resolveRepo: async () => ({
        fullName: "me/Vortex",
        cloneUrl: fork,
        defaultBranch: "linux",
        isFork: true,
        parent: "Nexus-Mods/Vortex",
      }),
    });
    expect(source).toMatchObject({ hasFork: true, repo: "me/Vortex" });
    expect(remotes(dir)).toEqual(["origin", "upstream"]);
    expect(git(dir, "remote", "get-url", "origin")).toBe(fork);
    expect(git(dir, "remote", "get-url", "upstream")).toBe(upstream);
    expect(git(dir, "symbolic-ref", "--short", "HEAD")).toBe("linux");

    await cutWorkBranch(dir, "feat/zoom");
    expect(git(dir, "rev-parse", "HEAD")).toBe(git(dir, "rev-parse", "upstream/master"));
    expect(fs.existsSync(path.join(dir, "fork-only.txt"))).toBe(false);
    await expect(cutWorkBranch(dir, "feat/zoom")).rejects.toThrow(/already exists/);
    await expect(cutWorkBranch(dir, "bad..name")).rejects.toThrow(/not a valid branch name/);
  });

  it("clones only into a new folder outside the workspace, and has no default folder", async () => {
    const resolveRepo = async () => {
      throw new Error("no lookup before the refusal");
    };
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(workspace);
    await expect(
      cloneVortex(path.join(workspace, "vortex"), { workspace, resolveRepo }),
    ).rejects.toThrow(/is in the doodlebot workspace/);
    await expect(cloneVortex(path.join(root, "work"), { workspace, resolveRepo })).rejects.toThrow(
      /already exists and is not empty/,
    );
    expect(fs.readdirSync(workspace)).toEqual([]);
  });
});

it("finds every worker main's build script bundles that a build left out", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-build-"));
  try {
    const main = path.join(dir, "src", "main");
    fs.mkdirSync(path.join(main, "build"), { recursive: true });
    fs.writeFileSync(
      path.join(main, "build.mjs"),
      `await bundleWorker("./src/bsdiff/worker.ts", "bsdiff-worker.cjs");\n` +
        `await bundleWorker('./src/hash/worker.ts', 'hash-worker.cjs');\n`,
    );
    for (const name of ["main.cjs", "renderer.js", "bsdiff-worker.cjs"])
      fs.writeFileSync(path.join(main, "build", name), "");
    // An nx cache hit restored everything @vortex/main declares, and it didn't declare this.
    expect(missingBuildOutputs(dir)).toEqual(["hash-worker.cjs"]);
    fs.writeFileSync(path.join(main, "build", "hash-worker.cjs"), "");
    expect(missingBuildOutputs(dir)).toEqual([]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it("gives a checkout's own scripts its pnpm, not the kit's", () => {
  const sep = path.delimiter;
  const repo = path.resolve("/kit");
  const PATH = [
    path.join(repo, "node_modules", ".bin"),
    path.resolve("/Users/me/AppData/Local/npm-cache/_npx/abc/node_modules/.bin"),
    path.resolve("/Windows/system32"),
  ].join(sep);
  expect(nestedPath(PATH, undefined, repo)).toBe(path.resolve("/Windows/system32"));
  expect(nestedPath(PATH, path.resolve("/tools/node22/pnpm.cmd"), repo)).toBe(
    [path.resolve("/tools/node22"), path.resolve("/Windows/system32")].join(sep),
  );
});

it("leaves a kit command's environment alone, and cleans a Vortex command's", () => {
  const repo = path.resolve("/kit");
  const PATH = [path.join(repo, "node_modules", ".bin"), path.resolve("/Windows")].join(
    path.delimiter,
  );
  const base = {
    PATH,
    npm_config_user_agent: "pnpm/9.15.0",
    VORTEX_AI_PNPM: path.resolve("/node22/pnpm.cmd"),
  };
  expect(commandEnv(path.join(repo, "harness"), base, repo)).toEqual(base);
  const vortex = commandEnv(path.resolve("/vortex/worktree/src"), base, repo);
  expect(vortex.npm_config_user_agent).toBeUndefined();
  expect(vortex.PATH).toBe(
    [path.resolve("/node22"), path.resolve("/Windows")].join(path.delimiter),
  );
  expect(commandEnv(path.resolve("/elsewhere"), base, repo).npm_config_user_agent).toBeUndefined();
});

it.runIf(process.platform === "win32")(
  "runs the selected manager with the intended Node and without parent pnpm overrides",
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vortex manager "));
    const shim = path.join(dir, "pnpm.cmd");
    const output = path.join(dir, "observed.json");
    fs.writeFileSync(shim, '@echo off\r\nnode "%~dp0probe.cjs" %*\r\n');
    fs.writeFileSync(
      path.join(dir, "probe.cjs"),
      `
require('fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify({
  executable: process.execPath, version: process.version, args: process.argv.slice(2),
  parentManager: process.env.npm_config_user_agent, parentOverride: process.env.PNPM_TEST_OVERRIDE
}));
`,
    );
    const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
    vi.stubEnv(
      pathKey,
      `${path.dirname(process.execPath)}${path.delimiter}${process.env[pathKey] ?? ""}`,
    );
    vi.stubEnv("VORTEX_AI_PNPM", shim);
    vi.stubEnv("npm_config_user_agent", "pnpm/9.15.0");
    vi.stubEnv("PNPM_TEST_OVERRIDE", "wrong-parent");
    try {
      const manager = selectPnpmCommand("11.10.0", "9.15.0");
      await runStreaming(manager.cmd, [...manager.args, "install"], {
        cwd: dir,
        label: "Runtime probe",
      });
      expect(JSON.parse(fs.readFileSync(output, "utf8"))).toEqual({
        executable: process.execPath,
        version: process.version,
        args: ["install"],
      });
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
