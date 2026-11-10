import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readContent } from "./content";
import { USER_FOLDERS, VORTEX_WRITES, vortexWrites } from "./gameSetup";
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
      roamingAppData: path.join(root, "Roaming"),
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
    expect(userFoldersOf("stardewvalley", deps.roots!())).toEqual([
      path.join(root, "Roaming", "StardewValley"),
    ]);
    expect(userFoldersOf("vortexaisandbox", deps.roots!())).toEqual([]);
    expect(userFoldersOf("not-a-game", deps.roots!())).toBeUndefined();
  });

  it("back up a Roaming AppData folder (Stardew Valley); Vortex writes none of its files, so every change is listed", async () => {
    const roaming = path.join(root, "Roaming", "StardewValley");
    const save = path.join(roaming, "Saves", "Farm_1", "Farm_1");
    const options = path.join(roaming, "startup_preferences");
    write(save, "owner farm", at(-86_400_000));
    write(options, "<StartupPreferences/>", at(-86_400_000));
    const hashOf = (file: string) =>
      createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    const before = [hashOf(save), hashOf(options)];

    const pending = await protectUserFolders("stardewvalley", cache(), deps);
    expect(pending).toMatchObject({ gameId: "stardewvalley" });
    write(save, "a farm saved during the run", at(2_000));
    write(path.join(roaming, "ErrorLogs", "run.txt"), "log", at(3_000));
    fs.rmSync(options);
    fs.utimesSync(roaming, at(4_000), at(4_000));

    const failure = await settlePendingRestores(
      { clean: true, end: at(10_000), write: () => undefined },
      deps,
    ).catch((error: unknown) => error as Error);
    expect(failure?.message).toContain(save);
    expect(failure?.message).toContain(options);
    expect(fs.readFileSync(save, "utf8")).toBe("a farm saved during the run");
    expect(readContent(deps.contentFile).pendingRestores).toHaveLength(1);
    // The owner chooses: --all puts back every byte and time.
    await gameRestore("stardewvalley", { all: true }, deps);
    expect([hashOf(save), hashOf(options)]).toEqual(before);
    expect(fs.existsSync(path.join(roaming, "ErrorLogs", "run.txt"))).toBe(false);
    expect(fs.statSync(save).mtimeMs).toBe(at(-86_400_000).getTime());
    expect(readContent(deps.contentFile).pendingRestores).toEqual([]);
  });

  it("restore the files Vortex writes byte for byte after a clean run", async () => {
    const before = hashes();
    const pending = await protectUserFolders("fallout4", cache(), deps);
    expect(pending).toMatchObject({ gameId: "fallout4", startedAt: at(0).toISOString() });
    expect(readContent(deps.contentFile).pendingRestores).toEqual([pending]);

    // What the run did: plugins.txt changed, an INI added, another deleted (its folder's time
    // dates the deletion).
    write(path.join(local(), "plugins.txt"), "*Owner.esp\r\n*Harness.esp\r\n", at(2_000));
    write(path.join(myGames(), "Fallout4Custom.ini"), "[Archive]\r\n", at(3_000));
    fs.rmSync(path.join(myGames(), "Fallout4.ini"));
    fs.utimesSync(myGames(), at(4_000), at(4_000));

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

  it("keeps and lists an owner's save added during a long run, restoring only Vortex's files", async () => {
    await protectUserFolders("fallout4", cache(), deps);
    write(path.join(local(), "plugins.txt"), "*Harness.esp\r\n", at(2_000));
    // The owner played their own copy while the run lasted: inside the window.
    const ownerSave = path.join(myGames(), "Saves", "save2.fos");
    write(ownerSave, "a new owner save", at(5_000));
    const failure = await settlePendingRestores({ clean: true, end: at(10_000) }, deps).catch(
      (error: unknown) => error as Error,
    );
    expect(failure?.message).toMatch(
      /^Restored the user folders of Fallout 4 \(1 file\(s\)\)\. Not restored: /,
    );
    expect(failure?.message).toContain(ownerSave);
    expect(failure?.message).toContain("doodlebot game restore fallout4 --all");
    expect(fs.readFileSync(ownerSave, "utf8")).toBe("a new owner save");
    expect(fs.readFileSync(path.join(local(), "plugins.txt"), "utf8")).toBe("*Owner.esp\r\n");
    // The save keeps the pending restore, for the owner to decide.
    expect(readContent(deps.contentFile).pendingRestores).toHaveLength(1);
    const listing = await gameRestore("fallout4", {}, deps);
    expect(listing.text).toContain(ownerSave);
    expect(listing.text).not.toContain("plugins.txt");
  });

  it("lists, not restores, a file Vortex writes that changed after the run", async () => {
    await protectUserFolders("fallout4", cache(), deps);
    write(path.join(myGames(), "Fallout4.ini"), "[General]\r\nowner=2\r\n", at(60_000));
    const failure = await settlePendingRestores({ clean: true, end: at(10_000) }, deps).catch(
      (error: unknown) => error as Error,
    );
    expect(failure?.message).toMatch(/^Not restored: /);
    expect(failure?.message).toContain(path.join(myGames(), "Fallout4.ini"));
    expect(fs.readFileSync(path.join(myGames(), "Fallout4.ini"), "utf8")).toBe(
      "[General]\r\nowner=2\r\n",
    );
  });

  it("restores a deleted file Vortex writes only when its folder dates the deletion inside the run", async () => {
    await protectUserFolders("fallout4", cache(), deps);
    fs.rmSync(path.join(local(), "plugins.txt"));
    // The folder last changed after the run ended: the deletion may be the owner's.
    fs.utimesSync(local(), at(60_000), at(60_000));
    const failure = await settlePendingRestores({ clean: true, end: at(10_000) }, deps).catch(
      (error: unknown) => error as Error,
    );
    expect(failure?.message).toContain(path.join(local(), "plugins.txt"));
    expect(fs.existsSync(path.join(local(), "plugins.txt"))).toBe(false);
  });

  it("says a pending restore's backup is missing, and --keep clears it", async () => {
    const pending = await protectUserFolders("fallout4", cache(), deps);
    fs.rmSync(pending!.backupDir, { recursive: true, force: true });
    const missing =
      /backup of the user folders of Fallout 4 .* is missing.*game restore fallout4 --keep/s;
    await expect(settlePendingRestores({ clean: true }, deps)).rejects.toThrow(missing);
    expect(() => assertNoPendingRestore(deps)).toThrow(missing);
    await expect(gameRestore("fallout4", { all: true }, deps)).rejects.toThrow(missing);
    expect((await gameRestore("fallout4", { keep: true }, deps)).text).toMatch(
      /is missing; the user folders were kept as they are and the pending restore is cleared/,
    );
    expect(readContent(deps.contentFile).pendingRestores).toEqual([]);
    expect(() => assertNoPendingRestore(deps)).not.toThrow();
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

  it("needs no backup for a game without user folders, and refuses a game not in the table", async () => {
    await expect(protectUserFolders("vortexaisandbox", cache(), deps)).resolves.toBeUndefined();
    await expect(protectUserFolders("fallout3", cache(), deps)).rejects.toThrow(
      /fallout3 has no entry in USER_FOLDERS/,
    );
    expect(readContent(deps.contentFile).pendingRestores).toEqual([]);
  });
});

describe("planRestore", () => {
  const change = (name: string, kind: "modified" | "added" | "deleted", time?: number) => ({
    folder: 0,
    relative: name,
    path: path.join(root, name),
    kind,
    ...(time === undefined ? {} : kind === "deleted" ? { folderMtimeMs: time } : { mtimeMs: time }),
  });
  const writes = (name: string) => vortexWrites("fallout4", name);

  it("restores only the files Vortex writes changed inside the run; decides nothing without an end", () => {
    const inside = change("plugins.txt", "modified", T0 + 5);
    const ini = change("Fallout4Custom.ini", "added", T0 + 6);
    const before = change("loadorder.txt", "modified", T0 - 5);
    const after = change("DLCList.txt", "modified", T0 + 50);
    const save = change("Saves/save2.fos", "added", T0 + 5);
    const deletedInside = change("Fallout4Prefs.ini", "deleted", T0 + 5);
    const deletedAfter = change("plugins.txt", "deleted", T0 + 50);
    const undated = change("Fallout4.ini", "deleted");
    expect(
      planRestore(
        [inside, ini, before, after, save, deletedInside, deletedAfter, undated],
        { start: T0, end: T0 + 10 },
        writes,
      ),
    ).toEqual({
      restore: [inside, ini, deletedInside],
      blocked: [before, after, save, deletedAfter, undated],
    });
    expect(planRestore([inside], { start: T0 }, writes)).toEqual({
      restore: [],
      blocked: [inside],
    });
  });

  it("knows the files Vortex writes per game", () => {
    for (const name of [
      "plugins.txt",
      "Plugins.TXT",
      "loadorder.txt",
      "DLCList.txt",
      "Fallout4.ini",
    ])
      expect(vortexWrites("fallout4", name), name).toBe(true);
    for (const name of ["save1.fos", "plugins.txt.bak", "Fallout4.ini.baked", "ini"])
      expect(vortexWrites("fallout4", name), name).toBe(false);
    expect(vortexWrites("stardewvalley", "startup_preferences")).toBe(false);
    for (const gameId of Object.keys(USER_FOLDERS))
      expect(VORTEX_WRITES[gameId], gameId).toBeDefined();
  });
});
