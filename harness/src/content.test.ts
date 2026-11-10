import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveTarget } from "./config";
import {
  addPendingRestore,
  findGameCopy,
  findRelease,
  readContent,
  registerGameCopy,
  registerRelease,
  removePendingRestore,
} from "./content";
import { CONTENT_FILE, RELEASES_DIR, USER_STATE_DIR } from "./paths";

let root: string;
let file: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "content-"));
  file = path.join(root, "content.json");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("content.json", () => {
  it("lives next to the instance record, with the releases", () => {
    expect(CONTENT_FILE).toBe(path.join(USER_STATE_DIR, "content.json"));
    expect(RELEASES_DIR).toBe(path.join(USER_STATE_DIR, "releases"));
  });

  it("starts empty and keeps what is registered", () => {
    expect(readContent(file)).toEqual({
      games: [],
      releases: [],
      pendingRestores: [],
      collections: [],
    });
    const copy = {
      gameId: "fallout4",
      path: path.join(root, "copies", "fallout4"),
      sizeBytes: 10,
      registeredAt: "2026-11-10T10:00:00.000Z",
    };
    registerGameCopy(copy, file);
    expect(findGameCopy("fallout4", `${copy.path}${path.sep}`, file)).toEqual(copy);
    expect(findGameCopy("skyrimse", copy.path, file)).toBeUndefined();
    const release = {
      version: "2.8.0",
      path: "C:/r/2.8.0/app",
      exe: "C:/r/2.8.0/app/Vortex.exe",
      sha256: "a".repeat(64),
      registeredAt: "2026-11-10T10:00:00.000Z",
    };
    registerRelease(release, file);
    registerRelease(release, file);
    expect(readContent(file).releases).toEqual([release]);
    expect(findRelease("2.8.0", file)).toEqual(release);
    const pending = { gameId: "fallout4", backupDir: path.join(root, "b"), startedAt: "x" };
    addPendingRestore(pending, file);
    expect(readContent(file).pendingRestores).toEqual([pending]);
    removePendingRestore(pending.backupDir, file);
    expect(readContent(file).pendingRestores).toEqual([]);
    // Written through a temporary file that does not stay behind.
    expect(fs.readdirSync(root).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("refuses a malformed file rather than overwriting it", () => {
    fs.writeFileSync(file, JSON.stringify({ games: [{ gameId: 1 }] }));
    expect(() => readContent(file)).toThrow(/is malformed/);
    expect(() => registerRelease({} as never, file)).toThrow(/is malformed/);
  });

  it("--release names the command that registers a missing release", () => {
    expect(() => resolveTarget({ release: "0.0.0-not-registered" })).toThrow(
      "Release 0.0.0-not-registered is not registered. Get it with `doodlebot release get 0.0.0-not-registered`.",
    );
    expect(() => resolveTarget({ release: "2.8.0", exe: "C:/Vortex.exe" })).toThrow(
      "Choose one of --release, --exe and --dev-dir.",
    );
  });
});
