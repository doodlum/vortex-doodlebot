import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { assertRegularPath, hashGameFile } from "./gameFixtures";
import { holdLease } from "../src/lease";
import { withOperations, type OperationOptions } from "../src/operations";

export interface GameUserDirectories {
  documents: string;
  localAppData: string;
}
export interface GameSettingsResetOptions extends OperationOptions {
  gameId: string;
  owner: string;
  dedicatedWindowsAccount: true;
  /** Backups stay here, outside the disposable benchmark workspace. */
  backupDir: string;
  /** Omit on Windows to resolve the account's actual redirected Documents directory. */
  userDirectories?: GameUserDirectories;
}
export interface GameSettingsBackup {
  directory: string;
  gameId: string;
  files: Array<{ area: "documents" | "localAppData"; relative: string; sha256: string }>;
}
export function gameUserDirectories(): GameUserDirectories {
  if (process.platform !== "win32")
    throw new Error("Game settings reset requires Windows or explicit test userDirectories");
  const documents = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", "[Environment]::GetFolderPath('MyDocuments')"],
    { encoding: "utf8", windowsHide: true },
  ).trim();
  const localAppData = process.env.LOCALAPPDATA;
  if (!documents || !localAppData)
    throw new Error("Cannot resolve this account's game settings directories");
  return { documents, localAppData };
}
export function gameSettingsResource(gameId: string): string {
  return `game-settings:${os.userInfo().username.toLowerCase()}:${gameId}`;
}
function resetFiles(
  gameId: string,
): Array<{ area: "documents" | "localAppData"; relative: string }> {
  if (gameId === "skyrimse")
    return [
      ...["Skyrim.ini", "SkyrimPrefs.ini", "SkyrimCustom.ini"].flatMap((name) =>
        ["", ".baked", ".base"].map((suffix) => ({
          area: "documents" as const,
          relative: `My Games/Skyrim Special Edition/${name}${suffix}`,
        })),
      ),
      ...["Plugins.txt", "loadorder.txt"].map((name) => ({
        area: "localAppData" as const,
        relative: `Skyrim Special Edition/${name}`,
      })),
    ];
  if (gameId === "cyberpunk2077")
    return [{ area: "localAppData", relative: "CD Projekt Red/Cyberpunk 2077/UserSettings.json" }];
  throw new Error(`No game settings reset adapter for ${gameId}`);
}

/** Back up bounded settings files, verify all backups, then reset. Saves and purchased content are preserved. */
export async function resetGameSettings(
  options: GameSettingsResetOptions,
): Promise<GameSettingsBackup> {
  return withOperations([gameSettingsResource(options.gameId)], options.owner, options, () =>
    resetGameSettingsInside(options),
  );
}
async function resetGameSettingsInside(
  options: GameSettingsResetOptions,
): Promise<GameSettingsBackup> {
  if (options.dedicatedWindowsAccount !== true || !options.owner || options.owner === "anonymous")
    throw new Error("Game settings reset needs a named owner and dedicatedWindowsAccount:true");
  const files = resetFiles(options.gameId);
  const dirs = options.userDirectories ?? gameUserDirectories();
  const hold = holdLease(gameSettingsResource(options.gameId), options.owner, {
    ...options.leaseEnv,
    purpose: "backup and reset benchmark game settings",
  });
  try {
    if (hold.lease.instancePids.length > 0)
      throw new Error(
        "Cannot reset game settings while Vortex is running; close the owned session first",
      );
    const backupRoot = path.resolve(options.backupDir);
    assertRegularPath(backupRoot);
    for (const area of Object.values(dirs)) {
      const relation = path.relative(path.resolve(area), backupRoot);
      if (
        !relation ||
        (relation !== ".." && !relation.startsWith(`..${path.sep}`) && !path.isAbsolute(relation))
      )
        throw new Error("Game settings backup must be outside the account's settings folders");
    }
    const directory = path.join(backupRoot, `game-settings-${randomUUID()}`);
    fs.mkdirSync(directory, { recursive: true });
    const backup: GameSettingsBackup = { directory, gameId: options.gameId, files: [] };
    for (const entry of files) {
      const source = path.join(dirs[entry.area], entry.relative);
      assertRegularPath(source);
      if (!fs.existsSync(source)) continue;
      if (!fs.statSync(source).isFile())
        throw new Error("Game settings entry is not a regular file");
      const target = path.join(directory, entry.area, entry.relative);
      const sha256 = await hashGameFile(source);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
      if ((await hashGameFile(target)) !== sha256)
        throw new Error("Game settings backup verification failed; originals untouched");
      backup.files.push({ ...entry, sha256 });
    }
    // Check every original before removing any. A racing game launch invalidates the reset.
    for (const entry of backup.files) {
      const source = path.join(dirs[entry.area], entry.relative);
      assertRegularPath(source);
      if ((await hashGameFile(source)) !== entry.sha256)
        throw new Error("Game settings changed during backup; originals untouched");
    }
    fs.writeFileSync(
      path.join(directory, "backup.json"),
      JSON.stringify({ ...backup, userDirectories: dirs }, null, 2),
      { flag: "wx" },
    );
    const removed: typeof backup.files = [];
    try {
      for (const entry of backup.files) {
        fs.unlinkSync(path.join(dirs[entry.area], entry.relative));
        removed.push(entry);
      }
    } catch (error) {
      for (const entry of removed)
        fs.copyFileSync(
          path.join(directory, entry.area, entry.relative),
          path.join(dirs[entry.area], entry.relative),
          fs.constants.COPYFILE_EXCL,
        );
      throw error;
    }
    return backup;
  } finally {
    hold.release();
  }
}
