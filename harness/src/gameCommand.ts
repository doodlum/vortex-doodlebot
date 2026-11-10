/**
 * `doodlebot game copy|register|restore`, and the rule they serve: a launch manages a real game
 * folder only when it is a registered copy (content.json). A store install is never a copy, so
 * a test can never deploy into, purge or rewrite the owner's game. The kit's own fake games live
 * under its cache and are exempt.
 */
import fs from "node:fs";
import path from "node:path";

import { ConfigError } from "./errors";
import {
  findGameCopy,
  readContent,
  registerGameCopy,
  updateContent,
  type GameCopy,
} from "./content";
import { folderBytes, inside, storePathOf } from "./fsWalk";
import { KNOWN_GAMES, USER_FOLDERS } from "./gameSetup";
import { CONTENT_FILE, REPO_ROOT, normalizedPath } from "./paths";
import { normalizeVersionResource } from "./releaseFetch";
import { gameRestore, type UserFolderDeps } from "./userFolders";

export interface GameCommandDeps extends UserFolderDeps {
  /** The store install of a game (findGamePath), injected in tests. */
  storePath?: (gameId: string) => string | undefined;
  /** A file's version resource (`ProductVersion`), when it has one. */
  fileVersion?: (file: string) => string | undefined;
  now?: () => Date;
}

/** Whether `dir` is a store install: the one findGamePath finds, or anything in steamapps\common. */
export function isStorePath(dir: string, store: string | undefined): boolean {
  if (store !== undefined && normalizedPath(dir) === normalizedPath(store)) return true;
  return /(?:^|\/)steamapps\/common(?:\/|$)/.test(normalizedPath(dir).toLowerCase());
}

function requireKnownGame(gameId: string) {
  const game = KNOWN_GAMES[gameId];
  if (game === undefined || USER_FOLDERS[gameId] === undefined)
    throw new ConfigError(
      `${gameId} is not a game the kit can protect (no entry in USER_FOLDERS, gameSetup.ts). ` +
        `Known: ${Object.keys(USER_FOLDERS)
          .filter((id) => KNOWN_GAMES[id]?.steamDir !== undefined)
          .join(", ")}.`,
    );
  return game;
}

const folderSize = (dir: string): number => folderBytes(dir) ?? 0;

function versionOf(
  dir: string,
  executable: string,
  fileVersion: GameCommandDeps["fileVersion"],
): string | undefined {
  try {
    return normalizeVersionResource(fileVersion?.(path.join(dir, executable)));
  } catch {
    return undefined;
  }
}

/**
 * The rule every launch applies before it manages a game:
 * 1. a path is required: without one the store install would be found, which is never allowed;
 * 2. a store install is refused wherever it is;
 * 3. the game must be in USER_FOLDERS, so its user folders are backed up (a game folder inside
 *    the cache still writes the real user folders: the Nexus collection check's placeholder);
 * 4. the path must be a registered copy, except for a folder the kit made under its cache (the
 *    fake game, the fake Fallout 4, a check's disposable game folder).
 */
export function assertGamePathAllowed(
  config: { gameId: string; gamePath: string | undefined; cacheDir: string },
  file = CONTENT_FILE,
  storePath: (gameId: string) => string | undefined = storePathOf,
): void {
  const { gameId, gamePath, cacheDir } = config;
  const copies = readContent(file).games.filter((g) => g.gameId === gameId);
  const hint =
    copies.length > 0
      ? `Registered copies: ${copies.map((c) => c.path).join(", ")}.`
      : `Make one with \`doodlebot game copy ${gameId}\`, or register an existing copy with \`doodlebot game register ${gameId} <dir>\`.`;
  if (gamePath === undefined)
    throw new ConfigError(
      `--game ${gameId} needs --game-path <a registered copy>; the store install is never managed. ${hint}`,
    );
  if (isStorePath(gamePath, storePath(gameId)))
    throw new ConfigError(`${gamePath} is a store install; the kit never manages one. ${hint}`);
  if (USER_FOLDERS[gameId] === undefined)
    throw new ConfigError(
      `${gameId} has no entry in USER_FOLDERS (gameSetup.ts), so its user folders cannot be protected.`,
    );
  if (inside(gamePath, cacheDir)) return;
  if (findGameCopy(gameId, gamePath, file) === undefined)
    throw new ConfigError(
      `${gamePath} is not a registered copy of ${gameId}, so the kit will not manage it. ${hint}`,
    );
}

/** `game register <gameId> <dir>`: record an existing copy. Refuses a store install. */
export function registerCopy(gameId: string, dir: string, deps: GameCommandDeps = {}): GameCopy {
  const game = requireKnownGame(gameId);
  const store = (deps.storePath ?? storePathOf)(gameId);
  if (isStorePath(dir, store))
    throw new ConfigError(
      `${dir} is a store install, not a copy. Copy it with \`doodlebot game copy ${gameId}\`.`,
    );
  if (!fs.existsSync(path.join(dir, game.executable)))
    throw new ConfigError(
      `${dir} does not hold ${game.executable}; it is not a ${game.name} copy.`,
    );
  const gameVersion = versionOf(dir, game.executable, deps.fileVersion);
  const copy: GameCopy = {
    gameId,
    path: path.resolve(dir),
    sizeBytes: folderSize(dir),
    ...(gameVersion === undefined ? {} : { gameVersion }),
    registeredAt: (deps.now ?? (() => new Date()))().toISOString(),
  };
  registerGameCopy(copy, deps.contentFile ?? CONTENT_FILE);
  return copy;
}

const occupied = (dir: string): boolean => fs.existsSync(dir) && fs.readdirSync(dir).length > 0;

/**
 * `game copy <gameId> [--to <folder>] [--new]`: copy the store install into `<folder>/<gameId>`,
 * where the folder is `--to` or the stored copy folder, and register it.
 *
 * One copy per game version: when a registered copy of the same game and version is still on
 * disk, it is reused instead (`reused: true`) and nothing is copied. `fresh` (`--new`) makes
 * another copy anyway, in `<folder>/<gameId>-<n>`.
 */
export async function copyGame(
  gameId: string,
  to: string | undefined,
  deps: GameCommandDeps = {},
  options: { fresh?: boolean } = {},
): Promise<{ copy: GameCopy; reused: boolean }> {
  const game = requireKnownGame(gameId);
  const file = deps.contentFile ?? CONTENT_FILE;
  const source = (deps.storePath ?? storePathOf)(gameId);
  if (source === undefined)
    throw new ConfigError(`${game.name} is not installed through Steam on this machine.`);
  const content = readContent(file);
  if (options.fresh !== true) {
    const sourceVersion = versionOf(source, game.executable, deps.fileVersion);
    const same = content.games.find(
      (copy) =>
        copy.gameId === gameId &&
        sourceVersion !== undefined &&
        // A copy registered before the version was normalized holds the raw resource text.
        normalizeVersionResource(copy.gameVersion) === sourceVersion &&
        fs.existsSync(path.join(copy.path, game.executable)),
    );
    if (same !== undefined) return { copy: same, reused: true };
  }
  const folder = to ?? content.copyFolder;
  if (folder === undefined)
    throw new ConfigError(
      "No copy folder is stored yet. Pass --to <folder> (a drive with room for the game).",
    );
  let destination = path.join(folder, gameId);
  // Another copy goes beside a registered one; an unregistered folder is never written over.
  const registered = (dir: string) => findGameCopy(gameId, dir, file) !== undefined;
  for (let n = 2; occupied(destination) && registered(destination); n++)
    destination = path.join(folder, `${gameId}-${String(n)}`);
  if (isStorePath(destination, source) || inside(destination, source))
    throw new ConfigError(`${destination} is inside a store library; choose another folder.`);
  if (occupied(destination))
    throw new ConfigError(
      `${destination} already exists. Register it with \`doodlebot game register ${gameId} ${destination}\`, or remove it.`,
    );
  await fs.promises.cp(source, destination, { recursive: true, preserveTimestamps: true });
  const gameVersion = versionOf(destination, game.executable, deps.fileVersion);
  const copy: GameCopy = {
    gameId,
    path: path.resolve(destination),
    sourcePath: source,
    sizeBytes: folderSize(destination),
    ...(gameVersion === undefined ? {} : { gameVersion }),
    registeredAt: (deps.now ?? (() => new Date()))().toISOString(),
  };
  registerGameCopy(copy, file);
  return { copy, reused: false };
}

const describeCopy = (copy: GameCopy): string => {
  const version = normalizeVersionResource(copy.gameVersion);
  return (
    `${copy.gameId} copy at ${copy.path} (${(copy.sizeBytes / 1024 ** 3).toFixed(1)} GB` +
    `${version === undefined ? "" : `, version ${version}`})`
  );
};

/**
 * `game folder [<dir>]`: the folder `game copy` puts new copies in, stored in content.json so it
 * is asked only once. Without a folder, prints the stored one. A store library or a folder inside
 * the workspace is refused: copies are large and belong on a drive with room for them.
 */
export function setCopyFolder(
  dir: string | undefined,
  deps: { contentFile?: string; workspace?: string } = {},
): string {
  const file = deps.contentFile ?? CONTENT_FILE;
  if (dir === undefined) {
    const stored = readContent(file).copyFolder;
    return stored === undefined
      ? "No copy folder is stored. Set one with `doodlebot game folder <dir>`."
      : `Copy folder: ${stored}`;
  }
  const folder = path.resolve(dir);
  if (isStorePath(folder, undefined))
    throw new ConfigError(`${folder} is inside a store library; choose another folder.`);
  if (inside(folder, deps.workspace ?? REPO_ROOT))
    throw new ConfigError(
      `${folder} is inside the doodlebot workspace; game copies are large, so choose a folder outside it.`,
    );
  if (fs.existsSync(folder) && !fs.statSync(folder).isDirectory())
    throw new ConfigError(`${folder} is a file, not a folder.`);
  fs.mkdirSync(folder, { recursive: true });
  updateContent((content) => {
    content.copyFolder = folder;
  }, file);
  return `Copy folder set to ${folder}; \`doodlebot game copy <gameId>\` now copies into it.`;
}

/** The `game` command. Returns the text to print and the exit code. */
export async function gameCommand(
  positional: string[],
  flags: Record<string, string | boolean>,
  lists: Record<string, string[]>,
  deps: GameCommandDeps = {},
): Promise<{ text: string; code: number }> {
  const [sub, gameId, dir] = positional;
  const usage =
    "Use game copy <gameId> [--to <folder>] [--new], game register <gameId> <dir>, " +
    "game restore <gameId> [--all | --keep | --file <path>...], or game folder [<dir>].";
  if (sub === "folder") return { text: setCopyFolder(gameId, deps), code: 0 };
  if (gameId === undefined) throw new ConfigError(usage);
  switch (sub) {
    case "copy": {
      const { copy, reused } = await copyGame(
        gameId,
        typeof flags.to === "string" ? flags.to : undefined,
        deps,
        { fresh: flags.new === true },
      );
      return {
        text: reused
          ? `Reused the registered ${describeCopy(copy)}: it is the same version as the Steam install. ` +
            `Pass --new for another copy.`
          : `Copied and registered the ${describeCopy(copy)}.`,
        code: 0,
      };
    }
    case "register": {
      if (dir === undefined) throw new ConfigError(usage);
      return { text: `Registered the ${describeCopy(registerCopy(gameId, dir, deps))}.`, code: 0 };
    }
    case "restore":
      return gameRestore(
        gameId,
        { all: flags.all === true, keep: flags.keep === true, files: lists.file ?? [] },
        deps,
      );
    default:
      throw new ConfigError(usage);
  }
}
