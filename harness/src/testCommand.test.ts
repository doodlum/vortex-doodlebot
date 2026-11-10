import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

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
    "zoom",
    "panels",
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
      "zoom",
      "panels",
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
