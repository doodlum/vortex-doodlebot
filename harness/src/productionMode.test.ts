import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  BUILD_RECORD_NAME,
  buildRecordFile,
  bundleModeFromText,
  bundleModeOf,
  checkBuildRecord,
  checkSourceBuild,
  sourceBuildIsCurrent,
  checkoutBuildIdentity,
  productionErrorMessage,
  productionProblem,
  readBuildRecord,
  writeBuildRecord,
} from "./productionMode";

describe("productionProblem", () => {
  it("accepts only production NODE_ENV with React's production build loaded", () => {
    expect(
      productionProblem({
        nodeEnv: "production",
        react: { build: "production", files: ["react/cjs/react.production.min.js"] },
      }),
    ).toBeUndefined();
  });

  it("rejects what QA saw: NODE_ENV unset and React's development build", () => {
    const problem = productionProblem({
      nodeEnv: null,
      react: {
        build: "development",
        files: ["react-dom/cjs/react-dom.development.js", "react/cjs/react.development.js"],
      },
    });
    expect(problem).toContain(`NODE_ENV is null`);
    expect(problem).toContain("react.development.js");
    expect(productionErrorMessage(problem!)).toMatch(/--production was requested/);
  });

  it("rejects production NODE_ENV when React still loaded its development build", () => {
    expect(
      productionProblem({ nodeEnv: "production", react: { build: "development", files: [] } }),
    ).toBe("React's development build is loaded");
  });

  it("rejects an unknown React build and an extension too old to report one", () => {
    expect(productionProblem({ nodeEnv: "production", react: { build: "unknown" } })).toContain(
      "unknown build",
    );
    expect(productionProblem({ nodeEnv: "production" })).toContain("predates");
  });
});

describe("bundleModeOf", () => {
  it("recognises a development bundle by its unfolded NODE_ENV comparisons", () => {
    expect(bundleModeFromText(`const debugMissingIcons = "development" === "development";`)).toBe(
      "development",
    );
    expect(bundleModeFromText(`if ("development"!=="development")x()`)).toBe("development");
    expect(bundleModeFromText(`!function(){var e=1}();`)).toBe("production");
    expect(bundleModeFromText("")).toBe("unknown");
  });

  it("reads the checkout's renderer bundle, and is unknown without one", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-bundle-test-"));
    try {
      expect(bundleModeOf(dir)).toBe("unknown");
      fs.mkdirSync(path.join(dir, "src", "main", "build"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, "src", "main", "build", "renderer.js"),
        `const x = "development" === "development";`,
      );
      expect(bundleModeOf(dir)).toBe("development");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the build record (stale-build-refused)", { timeout: 60_000 }, () => {
  let root: string;
  let checkout: string;
  const git = (...args: string[]): string =>
    execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8", windowsHide: true }).trim();
  const write = (file: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(checkout, file)), { recursive: true });
    fs.writeFileSync(path.join(checkout, file), text);
  };
  /** What `doodlebot build` does around the build itself. */
  const recordBuild = (): void => {
    const identity = checkoutBuildIdentity(checkout)!;
    write("src/main/build/renderer.js", "bundle\n");
    writeBuildRecord(checkout, identity, "development");
  };
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "build-record-"));
    checkout = path.join(root, "vortex");
    fs.mkdirSync(checkout);
    git("init", "-q", "-b", "master");
    git("config", "core.autocrlf", "false");
    git("config", "user.email", "t@example.test");
    git("config", "user.name", "T");
    write(".gitignore", "src/main/build/\n");
    write("src/renderer/a.ts", "export const a = 1;\n");
    write("src/renderer/b.ts", "export const b = 1;\n");
    git("add", "-A");
    git("commit", "-qm", "base");
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("lives in the worktree's git folder, so git status never shows it", () => {
    recordBuild();
    expect(buildRecordFile(checkout)).toBe(
      path.join(git("rev-parse", "--absolute-git-dir"), BUILD_RECORD_NAME),
    );
    expect(readBuildRecord(checkout)).toMatchObject({
      head: git("rev-parse", "HEAD"),
      mode: "development",
      changes: {},
    });
    expect(git("status", "--porcelain")).toBe("");
    expect(checkBuildRecord(checkout).status).toBe("match");
  });

  it("refuses an edit after the build, naming the file and the build command", () => {
    recordBuild();
    write("src/renderer/a.ts", "export const a = 2;\n");
    const check = checkBuildRecord(checkout);
    expect(check).toMatchObject({ status: "stale", files: ["src/renderer/a.ts"] });
    expect(check.status === "stale" && check.message).toBe(
      `The build is from ${git("rev-parse", "HEAD").slice(0, 10)} and the checkout has changed since ` +
        `(1 file, for example src/renderer/a.ts). Run \`doodlebot build --checkout ${checkout}\`, ` +
        "or pass --stale-ok to launch it anyway.",
    );
    // Put back, it matches again: contents are compared, not file times.
    write("src/renderer/a.ts", "export const a = 1;\n");
    expect(checkBuildRecord(checkout).status).toBe("match");
    // A new untracked file is a change too; an ignored one is not.
    write("src/renderer/c.ts", "new\n");
    expect(checkBuildRecord(checkout)).toMatchObject({
      status: "stale",
      files: ["src/renderer/c.ts"],
    });
  });

  it("refuses after a git switch that changed files, and matches again after switching back", () => {
    git("switch", "-q", "-c", "other");
    write("src/renderer/b.ts", "export const b = 2;\n");
    git("commit", "-qam", "other");
    git("switch", "-q", "master");
    recordBuild();
    git("switch", "-q", "other");
    expect(checkBuildRecord(checkout)).toMatchObject({
      status: "stale",
      files: ["src/renderer/b.ts"],
    });
    // git switch rewrote the file and its time; the contents are what was built.
    git("switch", "-q", "master");
    expect(checkBuildRecord(checkout).status).toBe("match");
  });

  it("matches when the very changes that were built are committed afterwards", () => {
    write("src/renderer/a.ts", "export const a = 3;\n");
    recordBuild();
    expect(readBuildRecord(checkout)?.changes).toHaveProperty("src/renderer/a.ts");
    git("commit", "-qam", "the built change");
    expect(checkBuildRecord(checkout).status).toBe("match");
  });

  it("T4: a build of the right tree in the other mode is stale, with the reason", () => {
    recordBuild();
    write("src/main/build/main.cjs", "main\n");
    expect(checkBuildRecord(checkout, "development").status).toBe("match");
    const check = checkBuildRecord(checkout, "production");
    expect(check).toMatchObject({ status: "stale", files: [] });
    expect(check.status === "stale" && check.message).toBe(
      `The build of ${git("rev-parse", "HEAD").slice(0, 10)} is a development build, and a ` +
        `production one is wanted. Run \`doodlebot build --checkout ${checkout} --production\`, ` +
        "or pass --stale-ok to launch it anyway.",
    );
    expect(() => checkSourceBuild(checkout, { mode: "production" })).toThrow(/development build/);
    const warnings: string[] = [];
    checkSourceBuild(checkout, {
      mode: "production",
      staleOk: true,
      report: (m) => warnings.push(m),
    });
    expect(warnings).toEqual([
      expect.stringMatching(/^warning: launching a stale build \(--stale-ok\)/),
    ]);
  });

  it("T3: source skips install and build only for a current development build with every output", () => {
    // What `doodlebot source` passes prepareCheckout as upToDate.
    recordBuild();
    expect(sourceBuildIsCurrent(checkout)).toBe(false); // main.cjs is missing
    write("src/main/build/main.cjs", "main\n");
    expect(sourceBuildIsCurrent(checkout)).toBe(true);
    write("src/renderer/a.ts", "export const a = 9;\n");
    expect(sourceBuildIsCurrent(checkout)).toBe(false);
    write("src/renderer/a.ts", "export const a = 1;\n");
    writeBuildRecord(checkout, checkoutBuildIdentity(checkout)!, "production");
    expect(sourceBuildIsCurrent(checkout)).toBe(false);
  });

  it("has no record for a build made some other way, and says so without refusing", () => {
    expect(checkBuildRecord(checkout)).toMatchObject({
      status: "none",
      message: expect.stringContaining("has no doodlebot build record"),
    });
    recordBuild();
    // A raw `pnpm run build` afterwards replaces the bundle the record describes.
    write("src/main/build/renderer.js", "another bundle\n");
    expect(checkBuildRecord(checkout)).toMatchObject({
      status: "none",
      message: expect.stringContaining("rebuilt outside doodlebot build"),
    });
  });
});
