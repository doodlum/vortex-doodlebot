/**
 * A game's per-user folders, backed up before a launch and restored after it.
 *
 * Vortex writes outside the game folder: plugins.txt under `%LOCALAPPDATA%\<game>`, INI files and
 * their backups under `Documents\My Games\<game>`, and some games keep saves and settings under
 * `%APPDATA%\<game>` (Roaming). A released Vortex cannot be redirected away from them, so every
 * launch that manages a game listed in `USER_FOLDERS` (gameSetup.ts) copies its folders into the
 * cache first, records each file's size, modification time and SHA-256, and
 * writes a pending restore to content.json. `down` puts them back once Vortex has exited.
 *
 * The restore decides by modification time whose a change is. After a clean stop the run lasted
 * from its recorded start until the kit confirmed the exit: a change inside that window is the
 * run's and is restored; one outside it is the owner's, and blocks the whole restore. After an
 * unclean end (a crash, a kill, a missed `down`) the end is unknown, so nothing is restored until
 * the owner chooses with `doodlebot game restore`. A pending restore blocks every later launch, so
 * a second backup can never replace the good one.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ConfigError } from "./errors";
import { gameRunning as realGameRunning, KNOWN_GAMES, USER_FOLDERS } from "./gameSetup";
import {
  addPendingRestore,
  readContent,
  removePendingRestore,
  type PendingRestore,
} from "./content";
import { CONTENT_FILE, normalizedPath } from "./paths";

export interface UserFolderRoots {
  /** The user's Documents folder (possibly moved, for example into OneDrive). */
  documents: string;
  localAppData: string;
  /** `%APPDATA%` (Roaming). */
  roamingAppData: string;
}

function expandVariables(value: string): string {
  return value.replace(/%([^%]+)%/g, (whole, name: string) => process.env[name] ?? whole);
}

/** Documents as Windows resolves it (`User Shell Folders\Personal`), else `~\Documents`. */
export function documentsFolder(): string {
  if (process.platform === "win32") {
    try {
      const output = execFileSync(
        "reg",
        [
          "query",
          "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders",
          "/v",
          "Personal",
        ],
        { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
      );
      const value = /Personal\s+REG_(?:EXPAND_)?SZ\s+(.+)/i.exec(output)?.[1]?.trim();
      if (value !== undefined && value !== "") return expandVariables(value);
    } catch {
      /* Fall back to the usual place. */
    }
  }
  return path.join(os.homedir(), "Documents");
}

export function userFolderRoots(): UserFolderRoots {
  return {
    documents: documentsFolder(),
    localAppData: process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
    roamingAppData: process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"),
  };
}

/** The game's user folders, `[]` for a game that has none, undefined for one not in the table. */
export function userFoldersOf(gameId: string, roots: UserFolderRoots): string[] | undefined {
  const names = USER_FOLDERS[gameId];
  if (names === undefined) return undefined;
  return [
    ...(names.myGames === undefined ? [] : [path.join(roots.documents, "My Games", names.myGames)]),
    ...(names.localAppData === undefined
      ? []
      : [path.join(roots.localAppData, names.localAppData)]),
    ...(names.roamingAppData === undefined
      ? []
      : [path.join(roots.roamingAppData, names.roamingAppData)]),
  ];
}

// ---------------------------------------------------------------------------
// Backup, changes and restore
// ---------------------------------------------------------------------------

export interface ManifestFile {
  /** Index into `folders`. */
  folder: number;
  /** Path inside that folder, with `/` separators. */
  relative: string;
  size: number;
  mtimeMs: number;
  sha256: string;
}

export interface BackupManifest {
  gameId: string;
  startedAt: string;
  /** The real folders; folder `i` is copied to `<backup>/folder-<i>`. */
  folders: { path: string; existed: boolean }[];
  files: ManifestFile[];
}

const MANIFEST = "manifest.json";
const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const backupFolder = (backupDir: string, index: number): string =>
  path.join(backupDir, `folder-${String(index)}`);
const key = (folder: number, relative: string): string =>
  `${String(folder)}:${relative.toLowerCase()}`;

/** Every file under `root`, as `/`-separated paths relative to it. */
function walkFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  const visit = (dir: string, prefix: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) visit(path.join(dir, entry.name), relative);
      else if (entry.isFile()) files.push(relative);
    }
  };
  visit(root, "");
  return files;
}

/** Copy the folders into `backupDir` and write its manifest. Throws when it cannot. */
export function backupUserFolders(
  folders: string[],
  backupDir: string,
  gameId: string,
  startedAt: Date,
): BackupManifest {
  fs.mkdirSync(backupDir, { recursive: true });
  const manifest: BackupManifest = {
    gameId,
    startedAt: startedAt.toISOString(),
    folders: folders.map((folder) => ({ path: folder, existed: fs.existsSync(folder) })),
    files: [],
  };
  folders.forEach((folder, index) => {
    for (const relative of walkFiles(folder)) {
      const source = path.join(folder, ...relative.split("/"));
      const stat = fs.statSync(source);
      const bytes = fs.readFileSync(source);
      const target = path.join(backupFolder(backupDir, index), ...relative.split("/"));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
      if (sha256(fs.readFileSync(target)) !== sha256(bytes))
        throw new Error(`the copy of ${source} does not match it`);
      manifest.files.push({
        folder: index,
        relative,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        sha256: sha256(bytes),
      });
    }
  });
  fs.writeFileSync(path.join(backupDir, MANIFEST), JSON.stringify(manifest, null, 2));
  return manifest;
}

export function readManifest(backupDir: string): BackupManifest {
  return JSON.parse(fs.readFileSync(path.join(backupDir, MANIFEST), "utf8")) as BackupManifest;
}

export interface FileChange {
  folder: number;
  relative: string;
  /** The real file. */
  path: string;
  /** modified or deleted since the backup, or added by someone. */
  kind: "modified" | "added" | "deleted";
  /** The file's modification time now; absent for a deleted file. */
  mtimeMs?: number;
}

/** What differs in the real folders from the backup. Size and time first, then the hash. */
export function findChanges(manifest: BackupManifest): FileChange[] {
  const changes: FileChange[] = [];
  const known = new Map(manifest.files.map((f) => [key(f.folder, f.relative), f]));
  manifest.folders.forEach((folder, index) => {
    const seen = new Set<string>();
    for (const relative of walkFiles(folder.path)) {
      const file = path.join(folder.path, ...relative.split("/"));
      const entry = known.get(key(index, relative));
      seen.add(key(index, relative));
      const stat = fs.statSync(file);
      if (entry === undefined) {
        changes.push({ folder: index, relative, path: file, kind: "added", mtimeMs: stat.mtimeMs });
        continue;
      }
      if (stat.size === entry.size && stat.mtimeMs === entry.mtimeMs) continue;
      if (stat.size === entry.size && sha256(fs.readFileSync(file)) === entry.sha256) continue;
      changes.push({
        folder: index,
        relative,
        path: file,
        kind: "modified",
        mtimeMs: stat.mtimeMs,
      });
    }
    for (const entry of manifest.files)
      if (entry.folder === index && !seen.has(key(index, entry.relative)))
        changes.push({
          folder: index,
          relative: entry.relative,
          path: path.join(folder.path, ...entry.relative.split("/")),
          kind: "deleted",
        });
  });
  return changes;
}

/**
 * Which changes a restore may undo. With an `end` (a clean stop) a change inside
 * [start, end] is the run's; a deletion carries no time and counts as the run's. Without an end
 * (an unclean one) every change is left for the owner to decide.
 */
export function planRestore(
  changes: FileChange[],
  window: { start: number; end?: number },
): { restore: FileChange[]; blocked: FileChange[] } {
  if (window.end === undefined) return { restore: [], blocked: changes };
  const end = window.end;
  const inside = (c: FileChange): boolean =>
    c.mtimeMs === undefined || (c.mtimeMs >= window.start && c.mtimeMs <= end);
  return { restore: changes.filter(inside), blocked: changes.filter((c) => !inside(c)) };
}

function removeIfNoFiles(dir: string): void {
  if (fs.existsSync(dir) && walkFiles(dir).length === 0)
    fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Undo `changes` byte for byte: a modified or deleted file is copied back from the backup with
 * its original time, an added one is deleted. Each restored file is then checked against its
 * recorded hash; a mismatch throws. A folder that did not exist before is removed when it holds
 * no files any more.
 */
export function applyRestore(
  backupDir: string,
  manifest: BackupManifest,
  changes: FileChange[],
): void {
  const known = new Map(manifest.files.map((f) => [key(f.folder, f.relative), f]));
  for (const change of changes) {
    if (change.kind === "added") {
      fs.rmSync(change.path, { force: true });
      continue;
    }
    const entry = known.get(key(change.folder, change.relative));
    if (entry === undefined) throw new Error(`${change.path} is not in the backup`);
    const source = path.join(backupFolder(backupDir, entry.folder), ...entry.relative.split("/"));
    fs.mkdirSync(path.dirname(change.path), { recursive: true });
    fs.writeFileSync(change.path, fs.readFileSync(source));
    const time = new Date(entry.mtimeMs);
    fs.utimesSync(change.path, time, time);
  }
  for (const change of changes) {
    if (change.kind === "added") {
      if (fs.existsSync(change.path)) throw new Error(`${change.path} could not be removed`);
      continue;
    }
    const entry = known.get(key(change.folder, change.relative))!;
    if (sha256(fs.readFileSync(change.path)) !== entry.sha256)
      throw new Error(`${change.path} does not match its backup after the restore`);
  }
  manifest.folders.forEach((folder) => {
    if (!folder.existed) removeIfNoFiles(folder.path);
  });
}

export function formatChanges(changes: FileChange[]): string {
  return changes
    .map(
      (c) =>
        `  ${c.kind.padEnd(8)}  ${c.mtimeMs === undefined ? "-".padEnd(24) : new Date(c.mtimeMs).toISOString()}  ${c.path}`,
    )
    .join("\n");
}

// ---------------------------------------------------------------------------
// Around a launch
// ---------------------------------------------------------------------------

export interface UserFolderDeps {
  contentFile?: string;
  roots?: () => UserFolderRoots;
  gameRunning?: (gameId: string) => Promise<boolean>;
  now?: () => Date;
}

const gameName = (gameId: string): string => KNOWN_GAMES[gameId]?.name ?? gameId;

async function refuseWhileGameRuns(gameId: string, deps: UserFolderDeps, action: string) {
  if (await (deps.gameRunning ?? realGameRunning)(gameId))
    throw new ConfigError(`${gameName(gameId)} is running; close it before ${action}.`);
}

/** Refuse while any restore is pending: its backup must not be replaced by a new one. */
export function assertNoPendingRestore(deps: UserFolderDeps = {}): void {
  const pending = readContent(deps.contentFile ?? CONTENT_FILE).pendingRestores[0];
  if (pending !== undefined)
    throw new ConfigError(
      `The user folders of ${gameName(pending.gameId)} from the run started ${pending.startedAt} ` +
        `were never restored. Run \`doodlebot game restore ${pending.gameId}\` first.`,
    );
}

/**
 * Before Vortex starts: back up the user folders of the game this launch manages and record the
 * pending restore. Returns it, or undefined when the game has no user folders. Refuses while the
 * game runs, while a restore is pending, and when the backup cannot be made.
 */
export async function protectUserFolders(
  gameId: string,
  cacheDir: string,
  deps: UserFolderDeps = {},
): Promise<PendingRestore | undefined> {
  const folders = userFoldersOf(gameId, (deps.roots ?? userFolderRoots)());
  if (folders === undefined || folders.length === 0) return undefined;
  assertNoPendingRestore(deps);
  await refuseWhileGameRuns(gameId, deps, "starting Vortex");
  const startedAt = (deps.now ?? (() => new Date()))();
  const backupDir = path.join(
    cacheDir,
    "user-folder-backups",
    `${gameId}-${startedAt.toISOString().replace(/[:.]/g, "-")}`,
  );
  try {
    backupUserFolders(folders, backupDir, gameId, startedAt);
  } catch (error) {
    fs.rmSync(backupDir, { recursive: true, force: true });
    throw new ConfigError(
      `Could not back up the user folders of ${gameName(gameId)} (${folders.join(", ")}): ` +
        `${error instanceof Error ? error.message : String(error)}. Vortex was not started.`,
    );
  }
  const pending = { gameId, backupDir, startedAt: startedAt.toISOString() };
  addPendingRestore(pending, deps.contentFile ?? CONTENT_FILE);
  return pending;
}

function finish(pending: PendingRestore, deps: UserFolderDeps): void {
  removePendingRestore(pending.backupDir, deps.contentFile ?? CONTENT_FILE);
  fs.rmSync(pending.backupDir, { recursive: true, force: true });
}

function restoreOrKeep(pending: PendingRestore, manifest: BackupManifest, changes: FileChange[]) {
  try {
    applyRestore(pending.backupDir, manifest, changes);
  } catch (error) {
    throw new ConfigError(
      `Restoring the user folders of ${gameName(pending.gameId)} failed: ` +
        `${error instanceof Error ? error.message : String(error)}. The backup is kept at ${pending.backupDir}.`,
    );
  }
}

const choiceHint = (gameId: string): string =>
  `Run \`doodlebot game restore ${gameId} --all\` to restore them, \`--keep\` to keep them, ` +
  `or \`--file <path>\` (repeatable) to restore some.`;

/**
 * After a stop: settle every pending restore. `clean` means the kit confirmed the exit of the
 * Vortex that ran, at `end`; otherwise nothing is restored and the changed files are listed.
 * Throws a ConfigError naming the files whenever it did not restore.
 */
export async function settlePendingRestores(
  options: { clean: boolean; end?: Date; write?: (message: string) => void },
  deps: UserFolderDeps = {},
): Promise<void> {
  const write = options.write ?? ((message: string) => process.stdout.write(`${message}\n`));
  for (const pending of readContent(deps.contentFile ?? CONTENT_FILE).pendingRestores) {
    const manifest = readManifest(pending.backupDir);
    const changes = findChanges(manifest);
    const name = gameName(pending.gameId);
    if (!options.clean) {
      if (changes.length === 0) {
        finish(pending, deps);
        continue;
      }
      throw new ConfigError(
        `The run of ${name} started ${pending.startedAt} ended without a clean stop, so its user ` +
          `folders were not restored. Changed since the backup:\n${formatChanges(changes)}\n` +
          choiceHint(pending.gameId),
      );
    }
    await refuseWhileGameRuns(pending.gameId, deps, "its user folders are restored");
    const end = (options.end ?? (deps.now ?? (() => new Date()))()).getTime();
    const plan = planRestore(changes, { start: Date.parse(pending.startedAt), end });
    if (plan.blocked.length > 0)
      throw new ConfigError(
        `Not restored: these files in the user folders of ${name} changed outside the run ` +
          `(${pending.startedAt} to ${new Date(end).toISOString()}):\n${formatChanges(plan.blocked)}\n` +
          `Nothing was restored; the backup is kept at ${pending.backupDir}. ${choiceHint(pending.gameId)}`,
      );
    restoreOrKeep(pending, manifest, plan.restore);
    finish(pending, deps);
    if (plan.restore.length > 0)
      write(`Restored the user folders of ${name} (${String(plan.restore.length)} file(s)).`);
  }
}

/**
 * `doodlebot game restore <gameId>`: list what changed since the backup, then restore all of it
 * (`all`), keep all of it (`keep`) or restore the named files (`files`). Returns the text to print
 * and the exit code: 1 when only a listing was printed.
 */
export async function gameRestore(
  gameId: string,
  choice: { all?: boolean; keep?: boolean; files?: string[] },
  deps: UserFolderDeps = {},
): Promise<{ text: string; code: number }> {
  const pending = readContent(deps.contentFile ?? CONTENT_FILE).pendingRestores.find(
    (p) => p.gameId === gameId,
  );
  if (pending === undefined) return { text: `No pending restore for ${gameId}.`, code: 0 };
  const chosen = [choice.all === true, choice.keep === true, (choice.files ?? []).length > 0];
  if (chosen.filter(Boolean).length > 1)
    throw new ConfigError("Choose one of --all, --keep and --file.");
  await refuseWhileGameRuns(gameId, deps, "its user folders are restored");
  const manifest = readManifest(pending.backupDir);
  const changes = findChanges(manifest);
  const listing = `Changed since the backup of ${pending.startedAt}:\n${formatChanges(changes)}`;
  if (changes.length === 0) {
    finish(pending, deps);
    return { text: `Nothing changed since the backup; the pending restore is cleared.`, code: 0 };
  }
  if (!chosen.some(Boolean)) return { text: `${listing}\n${choiceHint(gameId)}`, code: 1 };
  let restore: FileChange[] = [];
  if (choice.all === true) restore = changes;
  if ((choice.files ?? []).length > 0) {
    const wanted = new Set((choice.files ?? []).map((f) => normalizedPath(f)));
    restore = changes.filter((c) => wanted.has(normalizedPath(c.path)));
    const unknown = [...wanted].filter((w) => !restore.some((c) => normalizedPath(c.path) === w));
    if (unknown.length > 0)
      throw new ConfigError(`Not among the changed files: ${unknown.join(", ")}\n${listing}`);
  }
  restoreOrKeep(pending, manifest, restore);
  finish(pending, deps);
  const kept = changes.length - restore.length;
  return {
    text: `Restored ${String(restore.length)} file(s), kept ${String(kept)}; the pending restore is cleared.`,
    code: 0,
  };
}
