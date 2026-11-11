import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { parseArgs } from "./cliArgs";
import { REPO_ROOT } from "./paths";
import { tsxCli } from "./processRunner";
import { SUITES, UnknownSuiteError, suiteCommand, testCommand } from "./testCommand";

const playwrightCli = createRequire(import.meta.url).resolve("@playwright/test/cli");

describe("doodlebot test", () => {
  it.each([
    ["core", "harness/playwright.config.ts"],
    ["oauth", "harness/oauth.playwright.config.ts"],
  ])("runs %s through Playwright's CLI with its config", (suite, config) => {
    expect(suiteCommand(suite, ["--reporter=json", "--grep", "x"])).toEqual({
      executable: process.execPath,
      args: [playwrightCli, "test", "--config", config, "--reporter=json", "--grep", "x"],
      cwd: REPO_ROOT,
    });
    expect(fs.existsSync(path.join(REPO_ROOT, config))).toBe(true);
  });

  it.each([
    "large-library",
    "bethesda",
    "collection-download-retry",
    "collection-scale",
    "plugins-mod-link",
    "plugins-page",
    "download-churn",
    "mods-scroll",
  ])("runs %s's check script through tsx", (suite) => {
    const script = `harness/src/tests/${suite}.e2e.ts`;
    expect(suiteCommand(suite, ["--mods", "300"])).toEqual({
      executable: process.execPath,
      args: [tsxCli(), script, "--mods", "300"],
      cwd: REPO_ROOT,
    });
    expect(fs.existsSync(path.join(REPO_ROOT, script))).toBe(true);
  });

  it("runs nexus from nexus-collection.e2e.ts", () => {
    expect(suiteCommand("nexus", []).args).toEqual([
      tsxCli(),
      "harness/src/tests/nexus-collection.e2e.ts",
    ]);
  });

  it("knows exactly the designed suites", () => {
    expect(SUITES.map((suite) => suite.name)).toEqual([
      "core",
      "oauth",
      "large-library",
      "bethesda",
      "collection-download-retry",
      "collection-scale",
      "plugins-mod-link",
      "plugins-page",
      "download-churn",
      "mods-scroll",
      "nexus",
    ]);
    expect(() => suiteCommand("nope", [])).toThrow(UnknownSuiteError);
  });

  // Criterion no-source-only-checks: testing that cannot run on a released Vortex is removed.
  it("lists no suite that needs a source build", async () => {
    const names = SUITES.map((suite) => suite.name);
    for (const removed of ["zoom", "panels"]) expect(names).not.toContain(removed);
    const lines: string[] = [];
    await testCommand([], { list: true }, [], { write: (l) => lines.push(l) });
    expect(lines.join("\n")).not.toMatch(/source build|--dev-dir|source only|source-only/i);
    for (const suite of SUITES) {
      const script = suite.argv([]).find((arg) => arg.endsWith(".e2e.ts"));
      if (script === undefined) continue;
      const text = fs.readFileSync(path.join(REPO_ROOT, script), "utf8");
      expect(text, script).not.toMatch(/needs a source build|--dev-dir <checkout>/i);
    }
    // No suite script or spec branches on a source build or needs its checkout. (fixtures.ts
    // launches either kind of build, so it is not a suite.)
    const testsDir = path.join(REPO_ROOT, "harness", "src", "tests");
    const suiteFiles = fs.readdirSync(testsDir).filter((name) => /\.(?:e2e|spec)\.ts$/.test(name));
    expect(suiteFiles.length).toBeGreaterThan(5);
    for (const name of suiteFiles) {
      const text = fs.readFileSync(path.join(testsDir, name), "utf8");
      expect(text, name).not.toMatch(/kind\s*[!=]==\s*["']dev["']|\bsourceDir\b/);
    }
  });

  it("--release <version> runs the suite on that registered release, and is not passed on", async () => {
    const run = vi.fn(async () => 0);
    const exe = path.join(REPO_ROOT, "nowhere", "Vortex.exe");
    const release = {
      version: "2.8.0",
      path: path.dirname(exe),
      exe,
      sha256: "x",
      registeredAt: "t",
    };
    await testCommand(["core"], {}, ["--grep", "x", "--release", "2.8.0"], {
      run,
      findRelease: (version) => (version === "2.8.0" ? release : undefined),
      exists: () => true,
    });
    expect(run).toHaveBeenCalledWith(
      process.execPath,
      [playwrightCli, "test", "--config", "harness/playwright.config.ts", "--grep", "x"],
      { cwd: REPO_ROOT, env: { ...process.env, VORTEX_AI_EXE: exe, VORTEX_AI_INSTALLED: "1" } },
    );
    await expect(
      testCommand(["core"], {}, ["--release=2.9.0"], { run, findRelease: () => undefined }),
    ).rejects.toThrow(/Release 2\.9\.0 is not registered; run `doodlebot release get 2\.9\.0`/);
  });

  it("--dev-dir before the suite makes that checkout the suite's session checkout", async () => {
    const run = vi.fn(async () => 0);
    const checkout = path.resolve("/vortex/worktree");
    await testCommand(["core"], { "dev-dir": checkout }, [], { run });
    expect(run).toHaveBeenCalledWith(
      process.execPath,
      [playwrightCli, "test", "--config", "harness/playwright.config.ts"],
      { cwd: REPO_ROOT, env: { ...process.env, INIT_CWD: checkout } },
    );
  });

  it("runs the suite from the workspace root with this process's environment", async () => {
    const run = vi.fn(async () => 7);
    await expect(testCommand(["core"], {}, ["--reporter=json"], { run })).resolves.toBe(7);
    expect(run).toHaveBeenCalledWith(
      process.execPath,
      [playwrightCli, "test", "--config", "harness/playwright.config.ts", "--reporter=json"],
      { cwd: REPO_ROOT, env: process.env },
    );
  });

  it("lists the suites with --list", async () => {
    const lines: string[] = [];
    const run = vi.fn(async () => 0);
    await expect(
      testCommand([], { list: true }, [], { run, write: (l) => lines.push(l) }),
    ).resolves.toBe(0);
    for (const suite of SUITES) expect(lines.join("\n")).toContain(`  ${suite.name} `);
    expect(run).not.toHaveBeenCalled();
  });

  it.each([["--help"], ["-h"]])("lists the suites with %s and exits 0", async (arg) => {
    const { positional, flags, passthrough } = parseArgs(["test", arg], REPO_ROOT);
    const lines: string[] = [];
    const run = vi.fn(async () => 0);
    await expect(
      testCommand(positional, flags, passthrough, { run, write: (l) => lines.push(l) }),
    ).resolves.toBe(0);
    expect(lines.join("\n")).toContain("Suites (doodlebot test <suite> [args...]):");
    for (const suite of SUITES) expect(lines.join("\n")).toContain(`  ${suite.name} `);
    expect(run).not.toHaveBeenCalled();
  });

  it("exits 2 and lists the suites for an unknown or missing suite", async () => {
    for (const positional of [["nope"], []]) {
      const lines: string[] = [];
      const run = vi.fn(async () => 0);
      await expect(
        testCommand(positional, {}, [], { run, write: (l) => lines.push(l) }),
      ).resolves.toBe(2);
      expect(lines.join("\n")).toContain("mods-scroll");
      expect(run).not.toHaveBeenCalled();
    }
  });
});
