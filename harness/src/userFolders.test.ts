import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readContent } from "./content";
import {
  assertNoPendingRestore,
  gameRestore,
  planRestore,
  protectUserFolders,
  settlePendingRestores,
  userFoldersOf,
  type UserFolderDeps,
} from "./userFolders";

let root: string;
let deps: UserFolderDeps & { contentFile: string };
let running: boolean;
const T0 = Date.parse("2026-11-10T10:00:00.000Z");
const at = (ms: number) => new Date(T0 + ms);

const myGames = () => path.join(root, "Documents", "My Games", "Fallout4");
const local = () => path.join(root, "Local", "Fallout4");
const cache = () => path.join(root, "cache");

function write(file: string, text: string, mtime: Date): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  fs.utimesSync(file, mtime, mtime);
}

/** Every file of both folders with its SHA-256. */
function hashes(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const folder of [myGames(), local()]) {
    if (!fs.existsSync(folder)) continue;
    for (const entry of fs.readdirSync(folder, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = path.join(entry.parentPath, entry.name);
      result[file] = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    }
  }
  return result;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "user-folders-"));
  running = false;
  deps = {
    contentFile: path.join(root, "content.json"),
    roots: () => ({
      documents: path.join(root, "Documents"),
      localAppData: path.join(root, "Local"),
    }),
    gameRunning: async () => running,
    now: () => at(0),
  };
  // The owner's real files, from before the run.
  write(path.join(myGames(), "Fallout4.ini"), "[General]\r\nowner=1\r\n", at(-86_400_000));
  write(path.join(myGames(), "Saves", "save1.fos"), "owner save", at(-86_400_000));
  write(path.join(local(), "plugins.txt"), "*Owner.esp\r\n", at(-86_400_000));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("user folders", () => {
  it("are the game's Documents\\My Games and LocalAppData folders from the table", () => {
    expect(userFoldersOf("fallout4", deps.roots!())).toEqual([myGames(), local()]);
    expect(userFoldersOf("stardewvalley", deps.roots!())).toEqual([]);
    expect(userFoldersOf("not-a-game", deps.roots!())).toBeUndefined();
  });

  it("are backed up before the launch and restored byte for byte after a clean run", async () => {
    const before = hashes();
    const pending = await protectUserFolders("fallout4", cache(), deps);
    expect(pending).toMatchObject({ gameId: "fallout4", startedAt: at(0).toISOString() });
    expect(readContent(deps.contentFile).pendingRestores).toEqual([pending]);

    // What the run did.
    write(path.join(local(), "plugins.txt"), "*Owner.esp\r\n*Harness.esp\r\n", at(2_000));
    write(path.join(myGames(), "Fallout4Custom.ini"), "[Archive]\r\n", at(3_000));
    fs.rmSync(path.join(myGames(), "Saves", "save1.fos"));

    const messages: string[] = [];
    await settlePendingRestores(
      { clean: true, end: at(10_000), write: (m) => messages.push(m) },
      deps,
    );
    expect(hashes()).toEqual(before);
    expect(messages).toEqual(["Restored the user folders of Fallout 4 (3 file(s))."]);
    expect(readContent(deps.contentFile).pendingRestores).toEqual([]);
    expect(fs.existsSync(pending!.backupDir)).toBe(false);
  });

  it("refuses to restore when an owner's file changed after the run, listing it", async () => {
    await protectUserFolders("fallout4", cache(), deps);
    write(path.join(local(), "plugins.txt"), "*Harness.esp\r\n", at(2_000));
    const ownerSave = path.join(myGames(), "Saves", "save1.fos");
    write(ownerSave, "a new owner save", at(60_000));
    const failure = await settlePendingRestores({ clean: true, end: at(10_000) }, deps).catch(
      (error: unknown) => error as Error,
    );
    expect(failure?.message).toMatch(/^Not restored: these files/);
    expect(failure?.message).toContain(ownerSave);
    expect(failure?.message).not.toContain("plugins.txt");
    // Nothing at all was restored, and the pending restore stays.
    expect(fs.readFileSync(path.join(local(), "plugins.txt"), "utf8")).toBe("*Harness.esp\r\n");
    expect(readContent(deps.contentFile).pendingRestores).toHaveLength(1);
  });

  it("after a crash, restores nothing, refuses the next launch and lists every change", async () => {
    await protectUserFolders("fallout4", cache(), deps);
    write(path.join(local(), "plugins.txt"), "*Harness.esp\r\n", at(2_000));
    const failure = await settlePendingRestores({ clean: false }, deps).catch(
      (error: unknown) => error as Error,
    );
    expect(failure?.message).toContain("ended without a clean stop");
    expect(failure?.message).toContain(path.join(local(), "plugins.txt"));
    expect(failure?.message).toContain("doodlebot game restore fallout4 --all");
    expect(fs.readFileSync(path.join(local(), "plugins.txt"), "utf8")).toBe("*Harness.esp\r\n");
    expect(() => assertNoPendingRestore(deps)).toThrow(/doodlebot game restore fallout4/);
    await expect(protectUserFolders("fallout4", cache(), deps)).rejects.toThrow(
      /were never restored/,
    );
  });

  it("game restore lists the changes, then --all restores them and the hashes match", async () => {
    const before = hashes();
    await protectUserFolders("fallout4", cache(), deps);
    write(path.join(local(), "plugins.txt"), "*Harness.esp\r\n", at(2_000));
    write(path.join(myGames(), "Saves", "save2.fos"), "made later", at(99_000));
    const listing = await gameRestore("fallout4", {}, deps);
    expect(listing.code).toBe(1);
    expect(listing.text).toContain("modified");
    expect(listing.text).toContain(at(2_000).toISOString());
    expect(listing.text).toContain(path.join(myGames(), "Saves", "save2.fos"));
    const result = await gameRestore("fallout4", { all: true }, deps);
    expect(result).toEqual({
      text: "Restored 2 file(s), kept 0; the pending restore is cleared.",
      code: 0,
    });
    expect(hashes()).toEqual(before);
    expect(readContent(deps.contentFile).pendingRestores).toEqual([]);
  });

  it("game restore --file restores the named files and keeps the rest; --keep keeps all", async () => {
    await protectUserFolders("fallout4", cache(), deps);
    write(path.join(local(), "plugins.txt"), "*Harness.esp\r\n", at(2_000));
    const save = path.join(myGames(), "Saves", "save2.fos");
    write(save, "owner's", at(99_000));
    await expect(gameRestore("fallout4", { files: [path.join(root, "x")] }, deps)).rejects.toThrow(
      /Not among the changed files/,
    );
    const picked = await gameRestore(
      "fallout4",
      { files: [path.join(local(), "plugins.txt")] },
      deps,
    );
    expect(picked.text).toBe("Restored 1 file(s), kept 1; the pending restore is cleared.");
    expect(fs.readFileSync(path.join(local(), "plugins.txt"), "utf8")).toBe("*Owner.esp\r\n");
    expect(fs.readFileSync(save, "utf8")).toBe("owner's");

    await protectUserFolders("fallout4", cache(), deps);
    write(path.join(local(), "plugins.txt"), "*Harness.esp\r\n", at(2_000));
    expect((await gameRestore("fallout4", { keep: true }, deps)).text).toBe(
      "Restored 0 file(s), kept 1; the pending restore is cleared.",
    );
    expect(fs.readFileSync(path.join(local(), "plugins.txt"), "utf8")).toBe("*Harness.esp\r\n");
  });

  it("removes a folder the run created when it did not exist before", async () => {
    fs.rmSync(local(), { recursive: true });
    await protectUserFolders("fallout4", cache(), deps);
    write(path.join(local(), "plugins.txt"), "*Harness.esp\r\n", at(2_000));
    await settlePendingRestores({ clean: true, end: at(10_000), write: () => undefined }, deps);
    expect(fs.existsSync(local())).toBe(false);
  });

  it("refuses the launch while the game runs or when the backup cannot be made", async () => {
    running = true;
    await expect(protectUserFolders("fallout4", cache(), deps)).rejects.toThrow(
      "Fallout 4 is running; close it before starting Vortex.",
    );
    running = false;
    // A file where the folder should be cannot be walked.
    fs.rmSync(local(), { recursive: true });
    fs.writeFileSync(local(), "not a folder");
    await expect(protectUserFolders("fallout4", cache(), deps)).rejects.toThrow(
      /Could not back up the user folders of Fallout 4/,
    );
    expect(readContent(deps.contentFile).pendingRestores).toEqual([]);
  });

  it("refuses a restore while the game runs, keeping the backup", async () => {
    const pending = await protectUserFolders("fallout4", cache(), deps);
    running = true;
    await expect(settlePendingRestores({ clean: true }, deps)).rejects.toThrow(/is running/);
    await expect(gameRestore("fallout4", { all: true }, deps)).rejects.toThrow(/is running/);
    expect(fs.existsSync(pending!.backupDir)).toBe(true);
  });

  it("needs no backup for a game without user folders", async () => {
    await expect(protectUserFolders("vortexaisandbox", cache(), deps)).resolves.toBeUndefined();
    expect(readContent(deps.contentFile).pendingRestores).toEqual([]);
  });
});

describe("planRestore", () => {
  const change = (mtimeMs?: number) => ({
    folder: 0,
    relative: "a",
    path: "a",
    kind: mtimeMs === undefined ? ("deleted" as const) : ("modified" as const),
    ...(mtimeMs === undefined ? {} : { mtimeMs }),
  });

  it("restores changes inside the run, blocks those outside, and decides nothing without an end", () => {
    const inside = change(T0 + 5);
    const before = change(T0 - 5);
    const after = change(T0 + 50);
    const deleted = change();
    expect(planRestore([inside, before, after, deleted], { start: T0, end: T0 + 10 })).toEqual({
      restore: [inside, deleted],
      blocked: [before, after],
    });
    expect(planRestore([inside], { start: T0 })).toEqual({ restore: [], blocked: [inside] });
  });
});
