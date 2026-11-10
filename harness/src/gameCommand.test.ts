import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readContent } from "./content";
import {
  assertGamePathAllowed,
  copyGame,
  gameCommand,
  isStorePath,
  registerCopy,
  type GameCommandDeps,
} from "./gameCommand";

let root: string;
let deps: GameCommandDeps & { contentFile: string };
let store: string;

function fakeGame(dir: string): string {
  fs.mkdirSync(path.join(dir, "Data"), { recursive: true });
  fs.writeFileSync(path.join(dir, "Fallout4.exe"), "exe bytes");
  fs.writeFileSync(path.join(dir, "Data", "Fallout4.esm"), "master bytes");
  return dir;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "game-command-"));
  store = fakeGame(path.join(root, "SteamLibrary", "steamapps", "common", "Fallout 4"));
  deps = {
    contentFile: path.join(root, "content.json"),
    storePath: (gameId) => (gameId === "fallout4" ? store : undefined),
    fileVersion: () => "1.10.984.0",
    now: () => new Date("2026-11-10T10:00:00.000Z"),
  };
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("game copies", () => {
  it("recognises a store install", () => {
    expect(isStorePath(store, store)).toBe(true);
    expect(isStorePath("D:\\Games\\SteamLibrary\\steamapps\\common\\Skyrim", undefined)).toBe(true);
    expect(isStorePath(path.join(root, "copies", "fallout4"), store)).toBe(false);
  });

  it("register refuses a store path and records an existing copy", async () => {
    expect(() => registerCopy("fallout4", store, deps)).toThrow(/is a store install, not a copy/);
    expect(() => registerCopy("fallout4", path.join(root, "empty"), deps)).toThrow(
      /does not hold Fallout4.exe/,
    );
    const copy = fakeGame(path.join(root, "copies", "fallout4"));
    expect(registerCopy("fallout4", copy, deps)).toEqual({
      gameId: "fallout4",
      path: copy,
      sizeBytes: 21,
      gameVersion: "1.10.984.0",
      registeredAt: "2026-11-10T10:00:00.000Z",
    });
    expect(readContent(deps.contentFile).games).toHaveLength(1);
    // Registering it again replaces the entry.
    registerCopy("fallout4", copy, deps);
    expect(readContent(deps.contentFile).games).toHaveLength(1);
  });

  it("refuses a game whose user folders the kit does not know", () => {
    expect(() => registerCopy("cyberpunk2077", root, deps)).toThrow(
      /not a game the kit can protect/,
    );
  });

  it("copy copies the store install into the folder given and registers it", async () => {
    await expect(copyGame("fallout4", undefined, deps)).rejects.toThrow(/No copy folder/);
    const result = await gameCommand(
      ["copy", "fallout4"],
      { to: path.join(root, "copies") },
      {},
      deps,
    );
    const copy = path.join(root, "copies", "fallout4");
    expect(result.code).toBe(0);
    expect(fs.readFileSync(path.join(copy, "Data", "Fallout4.esm"), "utf8")).toBe("master bytes");
    expect(readContent(deps.contentFile).games).toEqual([
      expect.objectContaining({ gameId: "fallout4", path: copy, sourcePath: store, sizeBytes: 21 }),
    ]);
    await expect(copyGame("fallout4", path.join(root, "copies"), deps)).rejects.toThrow(
      /already exists/,
    );
  });

  it("a launch manages only a registered copy or the kit's own folders", () => {
    const cacheDir = path.join(root, "cache");
    const config = (gamePath: string | undefined) => ({ gameId: "fallout4", gamePath, cacheDir });
    expect(() => assertGamePathAllowed(config(store), deps.contentFile)).toThrow(
      /is not a registered copy of fallout4/,
    );
    expect(() => assertGamePathAllowed(config(undefined), deps.contentFile)).toThrow(
      /needs --game-path <a registered copy>/,
    );
    // The fake Fallout 4 lives under the cache.
    expect(() =>
      assertGamePathAllowed(
        config(path.join(cacheDir, "bethesda-sandbox", "fallout4", "game")),
        deps.contentFile,
      ),
    ).not.toThrow();
    const copy = fakeGame(path.join(root, "copies", "fallout4"));
    registerCopy("fallout4", copy, deps);
    expect(() => assertGamePathAllowed(config(copy), deps.contentFile)).not.toThrow();
    expect(() => assertGamePathAllowed(config(store), deps.contentFile)).toThrow(
      `Registered copies: ${copy}.`,
    );
  });
});
