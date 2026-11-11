import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SUITE_CHECKOUT_ENV } from "./config";

import { parseArgs } from "./cliArgs";
import { REPO_ROOT } from "./paths";
import { tsxCli } from "./processRunner";
import { STALE_OK_ENV, checkoutBuildIdentity, writeBuildRecord } from "./productionMode";
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

  describe(
    "S2: a source checkout is resolved and checked before the suite starts",
    { timeout: 60_000 },
    () => {
      let root: string;
      const git = (cwd: string, ...args: string[]): string =>
        execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true }).trim();
      /** A Vortex checkout; built means electron resolves, the outputs exist and a record matches. */
      const vortexRepo = (dir: string, built: boolean): string => {
        fs.mkdirSync(path.join(dir, "src", "main"), { recursive: true });
        git(dir, "init", "-q", "-b", "master");
        fs.writeFileSync(path.join(dir, "package.json"), '{"name":"@vortex/monorepo"}');
        fs.writeFileSync(path.join(dir, "src", "main", "package.json"), '{"name":"@vortex/main"}');
        fs.writeFileSync(path.join(dir, ".gitignore"), "node_modules/\nsrc/main/build/\n");
        git(dir, "add", "-A");
        git(dir, "-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-qm", "init");
        if (!built) return dir;
        const electron = path.join(dir, "node_modules", "electron");
        fs.mkdirSync(electron, { recursive: true });
        fs.writeFileSync(
          path.join(electron, "package.json"),
          '{"name":"electron","main":"index.js"}',
        );
        fs.writeFileSync(path.join(electron, "index.js"), "module.exports = 'electron.exe';\n");
        fs.mkdirSync(path.join(dir, "src", "main", "build"), { recursive: true });
        for (const file of ["main.cjs", "renderer.js"])
          fs.writeFileSync(path.join(dir, "src", "main", "build", file), "built");
        writeBuildRecord(dir, checkoutBuildIdentity(dir)!, "development");
        return dir;
      };
      const suiteArgs = [playwrightCli, "test", "--config", "harness/playwright.config.ts"];
      beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "test-command-"));
        vi.stubEnv("VORTEX_AI_INSTALLED", "");
        vi.stubEnv("VORTEX_AI_PRODUCTION", "");
      });
      afterEach(() => {
        vi.unstubAllEnvs();
        fs.rmSync(root, { recursive: true, force: true });
      });

      it("names a built --dev-dir to the suite explicitly", async () => {
        const run = vi.fn(async () => 0);
        const checkout = vortexRepo(path.join(root, "vortex"), true);
        await testCommand(["core"], { "dev-dir": checkout }, [], { run, cwd: root });
        expect(run).toHaveBeenCalledWith(process.execPath, suiteArgs, {
          cwd: REPO_ROOT,
          env: { ...process.env, [SUITE_CHECKOUT_ENV]: checkout },
        });
      });

      it("refuses a --dev-dir that is not a checkout, and an unbuilt session checkout", async () => {
        const run = vi.fn(async () => 0);
        const plain = path.join(root, "plain");
        fs.mkdirSync(plain);
        await expect(
          testCommand(["core"], { "dev-dir": plain }, [], { run, cwd: root }),
        ).rejects.toThrow(`--dev-dir ${plain} is not a built Vortex checkout`);
        const unbuilt = vortexRepo(path.join(root, "unbuilt"), false);
        await expect(testCommand(["core"], {}, [], { run, cwd: unbuilt })).rejects.toThrow(
          /This session's checkout .* is not built/,
        );
        expect(run).not.toHaveBeenCalled();
      });

      it("refuses a stale build unless --stale-ok, which is the kit's and passes on as a variable", async () => {
        const run = vi.fn(async () => 0);
        const checkout = vortexRepo(path.join(root, "vortex"), true);
        fs.writeFileSync(path.join(checkout, "src", "main", "package.json"), '{"changed":1}');
        await expect(testCommand(["core"], {}, [], { run, cwd: checkout })).rejects.toThrow(
          /The build is from .* and the checkout has changed since/,
        );
        expect(run).not.toHaveBeenCalled();
        const lines: string[] = [];
        await testCommand(["core"], {}, ["--stale-ok", "--grep", "x"], {
          run,
          cwd: checkout,
          write: (line) => lines.push(line),
        });
        expect(lines.join("\n")).toMatch(/^warning: launching a stale build \(--stale-ok\)/);
        expect(run).toHaveBeenCalledWith(process.execPath, [...suiteArgs, "--grep", "x"], {
          cwd: REPO_ROOT,
          env: expect.objectContaining({
            [SUITE_CHECKOUT_ENV]: expect.any(String),
            [STALE_OK_ENV]: "1",
          }),
        });
      });

      it("refuses a build missing an output before the suite starts", async () => {
        const run = vi.fn(async () => 0);
        const checkout = vortexRepo(path.join(root, "vortex"), true);
        fs.rmSync(path.join(checkout, "src", "main", "build", "renderer.js"));
        await expect(
          testCommand(["core"], { "dev-dir": checkout }, [], { run, cwd: root }),
        ).rejects.toThrow(/is not fully built: src\/main\/build lacks renderer\.js/);
        expect(run).not.toHaveBeenCalled();
      });
    },
  );

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
