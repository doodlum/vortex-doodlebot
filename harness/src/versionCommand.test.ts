import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { REPO_ROOT } from "./paths";
import { formatVersion, versionCommand, versionInfo } from "./versionCommand";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "doodlebot-version-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "9.8.7" }));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const git = (...args: string[]) =>
  execFileSync(
    "git",
    ["-c", "user.name=test", "-c", "user.email=test@example.test", "-C", root, ...args],
    { encoding: "utf8", windowsHide: true },
  ).trim();

describe("doodlebot version", () => {
  it("reports the package version, HEAD, local changes and the real workspace path", () => {
    git("init", "-q");
    git("add", ".");
    git("commit", "-qm", "init");
    const head = git("rev-parse", "HEAD");
    const clean = versionInfo(root);
    expect(clean).toEqual({
      version: "9.8.7",
      commit: head,
      dirty: false,
      workspace: fs.realpathSync.native(root),
    });
    expect(formatVersion(clean)).toBe(`doodlebot 9.8.7 (${head}) at ${clean.workspace}`);
    fs.writeFileSync(path.join(root, "new.txt"), "x");
    const dirty = versionInfo(root);
    expect(dirty.dirty).toBe(true);
    expect(formatVersion(dirty)).toBe(`doodlebot 9.8.7 (${head}, modified) at ${dirty.workspace}`);
  });

  it("prints JSON with --json", () => {
    const fakeGit = (_root: string, args: string[]) => (args[0] === "rev-parse" ? "abc123\n" : "");
    expect(JSON.parse(versionCommand({ json: true }, root, fakeGit))).toEqual({
      version: "9.8.7",
      commit: "abc123",
      dirty: false,
      workspace: fs.realpathSync.native(root),
    });
    expect(versionCommand({}, root, fakeGit)).toMatch(/^doodlebot 9\.8\.7 \(abc123\) at /);
  });

  it("still reports the version outside a git checkout", () => {
    const info = versionInfo(root, () => {
      throw new Error("not a git repository");
    });
    expect(info).toMatchObject({ version: "9.8.7", commit: "unknown", dirty: false });
  });

  it("is this workspace's package version by default", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
    expect(versionInfo(REPO_ROOT, () => "").version).toBe(pkg.version);
    expect(pkg.version).toBe("2.0.0");
  });
});
