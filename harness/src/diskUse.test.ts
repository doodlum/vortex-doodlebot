import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { markerFile } from "./bootstrap";
import { updateContent } from "./content";
import { MB, cleanCommand, planClean, type CleanDeps } from "./diskUse";
import type { InstanceRecord } from "./runningVortex";

let root: string;
let deps: CleanDeps & {
  artifactDir: string;
  cacheDir: string;
  releasesDir: string;
  contentFile: string;
  oldClone: string;
};
let running: InstanceRecord | undefined;
const NOW = new Date("2026-11-10T12:00:00.000Z");

function write(file: string, bytes: number | string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof bytes === "string" ? bytes : Buffer.alloc(bytes, 1));
  return file;
}

/** Make a file or folder, and everything in it, look last changed `days` ago. */
function age(target: string, days: number): void {
  const time = new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
  const visit = (current: string): void => {
    if (fs.statSync(current).isDirectory())
      for (const entry of fs.readdirSync(current)) visit(path.join(current, entry));
    fs.utimesSync(current, time, time);
  };
  visit(target);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "disk-use-"));
  running = undefined;
  deps = {
    artifactDir: path.join(root, "artifacts"),
    cacheDir: path.join(root, "cache"),
    releasesDir: path.join(root, "releases"),
    contentFile: path.join(root, "content.json"),
    // Never the workspace's own: a clean --yes here would delete it.
    oldClone: path.join(root, "workspace", ".vortex-src"),
    now: () => NOW,
    running: () => running,
  };
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("clean", () => {
  it("clean-keeps-reports: removes an old run's binaries, keeps its report, a registered copy and the login", () => {
    const oldRun = path.join(deps.artifactDir, "runs", "20260901T000000Z-old");
    const report = write(path.join(oldRun, "report.md"), "# Outcome\n");
    const log = write(path.join(oldRun, "vortex.log"), 2048);
    const screenshot = write(path.join(oldRun, "shot.png"), 200 * 1024);
    const binary = write(path.join(oldRun, "package.7z"), 2 * MB);
    const copy = path.join(oldRun, "game-copy");
    write(path.join(copy, "Fallout4.exe"), 3 * MB);
    updateContent((content) => {
      content.games.push({
        gameId: "fallout4",
        path: copy,
        sizeBytes: 3 * MB,
        registeredAt: "2026-09-01T00:00:00.000Z",
      });
    }, deps.contentFile);
    age(oldRun, 60);
    const newRun = path.join(deps.artifactDir, "runs", "20261109T000000Z-new");
    const recent = write(path.join(newRun, "trace.cpuprofile"), 2 * MB);
    age(newRun, 1);
    const qaRun = path.join(deps.artifactDir, "qa", "2.8.0", "plugins.page", "20260901T000000Z");
    const qaReport = write(path.join(qaRun, "report.md"), "# QA\n");
    const qaVideo = write(path.join(qaRun, "run.webm"), 5 * MB);
    age(qaRun, 45);

    const login = write(path.join(deps.cacheDir, "oauth-abc.json"), 2 * MB);
    age(deps.cacheDir, 90);

    const listing = cleanCommand({}, deps);
    expect(listing.text).toContain("Nothing was deleted. Run again with --yes");
    expect(fs.existsSync(binary)).toBe(true);
    expect(cleanCommand({ yes: true, "dry-run": true }, deps).text).not.toContain("Deleted");
    expect(fs.existsSync(binary)).toBe(true);

    const result = cleanCommand({ yes: true }, deps);
    expect(result.text).toContain("Deleted 2 item(s).");
    for (const kept of [
      report,
      log,
      screenshot,
      recent,
      qaReport,
      login,
      path.join(copy, "Fallout4.exe"),
    ])
      expect(fs.existsSync(kept), kept).toBe(true);
    for (const gone of [binary, qaVideo]) expect(fs.existsSync(gone), gone).toBe(false);
  });

  it("removes unused baselines and nested caches, keeping the working baseline and every login", () => {
    const cache = deps.cacheDir;
    const unused = path.join(cache, "snapshot-unused");
    write(markerFile(unused), "{}");
    write(path.join(unused, "userData", "state.db"), 1024);
    const working = path.join(cache, "snapshot-working");
    write(markerFile(working), "{}");
    write(
      markerFile(path.join(cache, "live")),
      JSON.stringify({ snapshotKey: "snapshot-working" }),
    );
    const loginProfile = write(path.join(cache, "login-1234", "marker.json"), "{}");
    const nested = path.join(cache, "nexus-smoke");
    write(path.join(nested, "live", "userData", "state.db"), 4096);
    const nestedLogin = write(path.join(nested, "oauth-def.json"), "{}");
    const pendingBackup = path.join(cache, "user-folder-backups", "fallout4-x");
    write(path.join(pendingBackup, "manifest.json"), "{}");
    updateContent((content) => {
      content.pendingRestores.push({
        gameId: "fallout4",
        backupDir: pendingBackup,
        startedAt: "2026-09-01T00:00:00.000Z",
      });
    }, deps.contentFile);
    age(cache, 90);
    // The working profile was launched yesterday.
    write(path.join(cache, "last-build.json"), "{}");
    age(path.join(cache, "last-build.json"), 1);

    const plan = planClean(30, deps);
    expect(plan.map((item) => item.path).sort()).toEqual([nested, unused].sort());
    cleanCommand({ yes: true }, deps);
    expect(fs.existsSync(unused)).toBe(false);
    expect(fs.existsSync(path.join(nested, "live"))).toBe(false);
    for (const kept of [working, loginProfile, nestedLogin, pendingBackup])
      expect(fs.existsSync(kept), kept).toBe(true);
  });

  it("never touches the running instance's cache", () => {
    write(markerFile(path.join(deps.cacheDir, "snapshot-old")), "{}");
    age(deps.cacheDir, 90);
    expect(planClean(30, deps)).toHaveLength(1);
    running = {
      pid: 1,
      startedAt: NOW.toISOString(),
      cacheDir: deps.cacheDir,
      userDataDir: path.join(deps.cacheDir, "live"),
      mcpPort: 3701,
    };
    expect(planClean(30, deps)).toEqual([]);
  });

  it("removes releases content.json no longer names, whatever their age", () => {
    const named = path.join(deps.releasesDir, "2.8.0");
    write(path.join(named, "app", "Vortex.exe"), 1024);
    const orphan = write(path.join(deps.releasesDir, "2.7.1", "app", "Vortex.exe"), 1024);
    updateContent((content) => {
      content.releases.push({
        version: "2.8.0",
        path: path.join(named, "app"),
        exe: path.join(named, "app", "Vortex.exe"),
        sha256: "0".repeat(64),
        registeredAt: NOW.toISOString(),
      });
    }, deps.contentFile);
    expect(planClean(30, deps)).toEqual([
      expect.objectContaining({ path: path.dirname(path.dirname(orphan)), kind: "release" }),
    ]);
  });

  it("lists the old managed clone whatever its age, and deletes it only with --yes", () => {
    const file = write(path.join(deps.oldClone, "src", "main", "package.json"), 2048);
    expect(planClean(30, deps)).toEqual([
      expect.objectContaining({
        path: deps.oldClone,
        kind: "old-clone",
        reason: expect.stringContaining("old managed clone (no longer used)"),
      }),
    ]);
    expect(cleanCommand({}, deps).text).toContain("Nothing was deleted.");
    expect(fs.existsSync(file)).toBe(true);
    // A harness Vortex running from it keeps it.
    running = {
      pid: 1,
      startedAt: NOW.toISOString(),
      cacheDir: path.join(root, "other-cache"),
      userDataDir: path.join(root, "other-cache", "live"),
      mcpPort: 3701,
      sourceDir: deps.oldClone,
    };
    expect(planClean(30, deps)).toEqual([]);
    running = undefined;
    expect(cleanCommand({ yes: true }, deps).text).toContain("Deleted 1 item(s).");
    expect(fs.existsSync(deps.oldClone)).toBe(false);
  });

  it("refuses a bad --older-than and reports nothing to clean", () => {
    expect(() => cleanCommand({ "older-than": "soon" }, deps)).toThrow(/--older-than/);
    expect(cleanCommand({ "older-than": "7" }, deps).text).toBe(
      "Nothing to clean (older than 7 days).",
    );
  });
});
