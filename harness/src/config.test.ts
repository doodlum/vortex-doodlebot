import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { execFileSync } from "node:child_process";

import {
  ConfigError,
  DEFAULT_CDP_PORT,
  DEFAULT_MCP_PORT,
  NEEDS_CHECKOUT,
  SUITE_CHECKOUT_ENV,
  TARGET_EXE_ENV,
  UnbuiltCheckoutError,
  loadConfig,
  requireCheckout,
  resolveTarget,
  resolveTargetSafely,
  vortexCheckoutOf,
} from "./config";
import { DEFAULT_ARTIFACT_DIR, DEFAULT_CACHE_DIR } from "./paths";

/** A checkout with src/main/package.json and a resolvable fake electron module. */
function fakeCheckout(dir: string): string {
  fs.mkdirSync(path.join(dir, "src", "main"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "main", "package.json"), '{"name":"@vortex/main"}');
  const electron = path.join(dir, "node_modules", "electron");
  fs.mkdirSync(electron, { recursive: true });
  fs.writeFileSync(path.join(electron, "package.json"), '{"name":"electron","main":"index.js"}');
  fs.writeFileSync(path.join(electron, "index.js"), "module.exports = 'electron.exe';\n");
  return dir;
}

function clearTargetVariables(): void {
  for (const name of [
    "VORTEX_AI_INSTALLED",
    "VORTEX_AI_EXE",
    "VORTEX_AI_SOURCE_DIR",
    "VORTEX_AI_DEV_DIR",
  ])
    vi.stubEnv(name, undefined);
}

const VARIABLES = [
  "VORTEX_AI_CACHE_DIR",
  "VORTEX_AI_ARTIFACT_DIR",
  "VORTEX_MCP_PORT",
  "VORTEX_AI_CDP_PORT",
] as const;

let saved: Partial<Record<(typeof VARIABLES)[number], string>>;

beforeEach(() => {
  saved = {};
  for (const name of VARIABLES) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of VARIABLES) {
    const value = saved[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("loadConfig", () => {
  it("defaults to the one cache, artifacts folder and ports", () => {
    expect(DEFAULT_MCP_PORT).toBe(3701);
    expect(DEFAULT_CDP_PORT).toBe(9222);
    const config = loadConfig();
    expect(config.cacheDir).toBe(path.resolve(DEFAULT_CACHE_DIR));
    expect(config.artifactDir).toBe(path.resolve(DEFAULT_ARTIFACT_DIR));
    expect(config.mcpPort).toBe(3701);
    expect(config.cdpPort).toBe(9222);
    expect(config).not.toHaveProperty("owner");
    expect(config).not.toHaveProperty("slot");
  });

  it("treats an empty variable as unset", () => {
    for (const name of VARIABLES) process.env[name] = "";
    const config = loadConfig();
    expect(config.cacheDir).toBe(path.resolve(DEFAULT_CACHE_DIR));
    expect(config.mcpPort).toBe(DEFAULT_MCP_PORT);
    expect(config.cdpPort).toBe(DEFAULT_CDP_PORT);
  });

  it("takes the cache, artifacts folder and ports from their variables", () => {
    process.env.VORTEX_AI_CACHE_DIR = path.join("some", "cache");
    process.env.VORTEX_AI_ARTIFACT_DIR = path.join("some", "artifacts");
    process.env.VORTEX_MCP_PORT = "4701";
    process.env.VORTEX_AI_CDP_PORT = "10222";
    const config = loadConfig();
    expect(config.cacheDir).toBe(path.resolve("some", "cache"));
    expect(config.artifactDir).toBe(path.resolve("some", "artifacts"));
    expect(config.mcpPort).toBe(4701);
    expect(config.cdpPort).toBe(10222);
  });

  it("lets --cache-dir, --port and --cdp-port win over their variables", () => {
    process.env.VORTEX_AI_CACHE_DIR = path.join("from", "env");
    process.env.VORTEX_MCP_PORT = "4701";
    process.env.VORTEX_AI_CDP_PORT = "10222";
    const config = loadConfig({
      cacheDir: path.join("from", "flag"),
      mcpPort: 5701,
      cdpPort: 11222,
    });
    expect(config.cacheDir).toBe(path.resolve("from", "flag"));
    expect(config.mcpPort).toBe(5701);
    expect(config.cdpPort).toBe(11222);
  });

  it("refuses an explicit --dev-dir that is not a built checkout, even through the safe resolver", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "not-built-"));
    clearTargetVariables();
    try {
      fs.mkdirSync(path.join(dir, "src", "main"), { recursive: true });
      fs.writeFileSync(path.join(dir, "src", "main", "package.json"), "{}");
      const expected = `--dev-dir ${dir} is not a built Vortex checkout: `;
      expect(() => resolveTarget({ devDir: dir })).toThrow(ConfigError);
      expect(() => resolveTarget({ devDir: dir })).toThrow(expected);
      expect(() => resolveTargetSafely({ devDir: dir })).toThrow(expected);
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores a leftover VORTEX_AI_DEV_DIR or VORTEX_AI_SOURCE_DIR", () => {
    const dir = fakeCheckout(fs.mkdtempSync(path.join(os.tmpdir(), "leftover-")));
    clearTargetVariables();
    try {
      vi.stubEnv("VORTEX_AI_DEV_DIR", dir);
      vi.stubEnv("VORTEX_AI_SOURCE_DIR", dir);
      expect(resolveTargetSafely().kind).toBe("installed");
      expect(resolveTargetSafely({ cwd: os.tmpdir() }).kind).toBe("installed");
      expect(() => loadConfig()).not.toThrow();
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses invalid or shared ports", () => {
    expect(() => loadConfig({ mcpPort: 0 })).toThrow(/integers from 1 to 65535/);
    process.env.VORTEX_AI_CDP_PORT = "not a port";
    expect(() => loadConfig()).toThrow(/integers from 1 to 65535/);
    delete process.env.VORTEX_AI_CDP_PORT;
    expect(() => loadConfig({ mcpPort: 9222 })).toThrow(/different ports/);
  });
});

describe("the session's checkout", { timeout: 60_000 }, () => {
  let root: string;
  let repo: string;
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true }).trim();
  const real = (dir: string): string => fs.realpathSync.native(dir);
  /** A Vortex checkout: the root package.json is @vortex/monorepo; built when `electron` resolves. */
  const vortexRepo = (dir: string, built: boolean): string => {
    fs.mkdirSync(path.join(dir, "src", "main"), { recursive: true });
    git(dir, "init", "-q", "-b", "master");
    fs.writeFileSync(path.join(dir, "package.json"), '{"name":"@vortex/monorepo"}');
    fs.writeFileSync(path.join(dir, "src", "main", "package.json"), '{"name":"@vortex/main"}');
    fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules/\n");
    git(dir, "add", "-A");
    git(dir, "-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-qm", "init");
    if (built) fakeCheckout(dir);
    return dir;
  };
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "session-checkout-"));
    repo = vortexRepo(path.join(root, "vortex"), true);
    clearTargetVariables();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("checkout-from-cwd: finds the checkout from a folder inside it, and from a worktree", () => {
    const nested = path.join(repo, "src", "main");
    expect(real(vortexCheckoutOf(nested)!)).toBe(real(repo));
    const target = resolveTarget({ cwd: nested });
    expect(target.kind).toBe("dev");
    expect(real(target.sourceDir!)).toBe(real(repo));
    expect(real(requireCheckout(undefined, nested))).toBe(real(repo));

    const worktree = path.join(root, "vortex-fix");
    git(repo, "worktree", "add", "-q", "-b", "fix", worktree);
    fakeCheckout(worktree);
    expect(real(vortexCheckoutOf(path.join(worktree, "src"))!)).toBe(real(worktree));
    expect(real(resolveTarget({ cwd: worktree }).sourceDir!)).toBe(real(worktree));
  });

  it("checkout-from-cwd: refuses a command that needs source outside a checkout", () => {
    const plain = path.join(root, "plain");
    fs.mkdirSync(plain);
    git(plain, "init", "-q");
    fs.writeFileSync(path.join(plain, "package.json"), '{"name":"not-vortex"}');
    expect(vortexCheckoutOf(plain)).toBeUndefined();
    expect(vortexCheckoutOf(os.tmpdir())).toBeUndefined();
    expect(() => requireCheckout(undefined, plain)).toThrow(NEEDS_CHECKOUT);
    expect(NEEDS_CHECKOUT).toBe(
      "Open Claude in a Vortex checkout or worktree (or clone one with `doodlebot source --clone <dir>`).",
    );
    // An explicit checkout is used as given.
    expect(requireCheckout(repo, plain)).toBe(path.resolve(repo));
  });

  it("dev-dir-env-ignored: a leftover VORTEX_AI_DEV_DIR does not redirect a session; --dev-dir does", () => {
    const other = vortexRepo(path.join(root, "other"), true);
    vi.stubEnv("VORTEX_AI_DEV_DIR", other);
    expect(real(resolveTarget({ cwd: repo }).sourceDir!)).toBe(real(repo));
    expect(real(resolveTarget({ devDir: other, cwd: repo }).sourceDir!)).toBe(real(other));
  });

  it("puts a target flag in front of the session's checkout", () => {
    const exe = path.join(root, "Vortex.exe");
    fs.writeFileSync(exe, "");
    expect(resolveTarget({ exe, cwd: repo })).toMatchObject({ kind: "installed", executable: exe });
    vi.stubEnv("VORTEX_AI_EXE", exe);
    expect(resolveTarget({ preferInstalled: true, cwd: repo })).toMatchObject({
      kind: "installed",
      executable: exe,
    });
  });

  it("refuses an unbuilt session checkout with the build command, through the safe resolver too", () => {
    const unbuilt = vortexRepo(path.join(root, "unbuilt"), false);
    const message = `This session's checkout ${path.resolve(git(unbuilt, "rev-parse", "--show-toplevel"))} is not built`;
    expect(() => resolveTarget({ cwd: unbuilt })).toThrow(message);
    expect(() => resolveTarget({ cwd: unbuilt })).toThrow("doodlebot build --checkout");
    // S2: before, the safe resolver quietly fell back to the installed Vortex here.
    expect(() => resolveTargetSafely({ cwd: unbuilt })).toThrow(UnbuiltCheckoutError);
    expect(() => resolveTargetSafely({ cwd: unbuilt })).toThrow(message);
    // Outside a checkout it still falls back rather than throwing.
    vi.stubEnv("VORTEX_AI_EXE", path.join(root, "none.exe"));
    vi.stubEnv("ProgramFiles", path.join(root, "pf"));
    vi.stubEnv("LOCALAPPDATA", path.join(root, "lad"));
    expect(resolveTargetSafely({ cwd: os.tmpdir() })).toMatchObject({ kind: "installed" });
  });

  it("S2: a suite's loadConfig uses the checkout DOODLEBOT_SUITE_CHECKOUT names, as an explicit --dev-dir", () => {
    vi.stubEnv(SUITE_CHECKOUT_ENV, repo);
    expect(real(loadConfig().target.sourceDir!)).toBe(real(repo));
    // An unbuilt or non-Vortex folder refuses instead of falling back to the installed Vortex.
    const plain = path.join(root, "plain");
    fs.mkdirSync(plain);
    vi.stubEnv(SUITE_CHECKOUT_ENV, plain);
    expect(() => loadConfig()).toThrow(`--dev-dir ${plain} is not a built Vortex checkout`);
  });

  it("a script started in an unbuilt worktree uses the executable DOODLEBOT_TARGET_EXE names", () => {
    const unbuilt = vortexRepo(path.join(root, "unbuilt"), false);
    vi.stubEnv("INIT_CWD", unbuilt);
    // Without the explicit target, the caller's unbuilt checkout refuses.
    expect(() => loadConfig()).toThrow(UnbuiltCheckoutError);
    const exe = path.join(root, "Vortex.exe");
    fs.writeFileSync(exe, "");
    vi.stubEnv(TARGET_EXE_ENV, exe);
    expect(loadConfig().target).toMatchObject({ kind: "installed", executable: exe });
  });
});
