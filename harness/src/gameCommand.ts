/**
 * `doodlebot game copy|register|restore`, and the rule they serve: a launch manages a real game
 * folder only when it is a registered copy (content.json). A store install is never a copy, so
 * a test can never deploy into, purge or rewrite the owner's game. The kit's own fake games live
 * under its cache and are exempt.
 */
import fs from "node:fs";
import path from "node:path";

import { ConfigError } from "./errors";
import { findGameCopy, readContent, registerGameCopy, type GameCopy } from "./content";
import { KNOWN_GAMES, USER_FOLDERS, findGamePath } from "./gameSetup";
import { CONTENT_FILE, normalizedPath } from "./paths";
import { gameRestore, type UserFolderDeps } from "./userFolders";

export interface GameCommandDeps extends UserFolderDeps {
  /** The store install of a game (findGamePath), injected in tests. */
  storePath?: (gameId: string) => string | undefined;
  /** A file's version resource (`ProductVersion`), when it has one. */
  fileVersion?: (file: string) => string | undefined;
  now?: () => Date;
}

const storePathOf = (gameId: string): string | undefined => {
  const game = KNOWN_GAMES[gameId];
  return game === undefined ? undefined : findGamePath(game);
};

const inside = (child: string, parent: string): boolean => {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

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

function folderSize(dir: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += folderSize(full);
    else if (entry.isFile()) total += fs.statSync(full).size;
  }
  return total;
}

function versionOf(
  dir: string,
  executable: string,
  fileVersion: GameCommandDeps["fileVersion"],
): string | undefined {
  try {
    return fileVersion?.(path.join(dir, executable));
  } catch {
    return undefined;
  }
}

/**
 * The rule every launch applies before it manages a game. A path under the cache is the kit's own
 * (the fake game, the fake Fallout 4, a test's disposable folder). Any other path must be a
 * registered copy of that game; without a path, the Steam install would be found, which is never
 * allowed.
 */
export function assertGamePathAllowed(
  config: { gameId: string; gamePath: string | undefined; cacheDir: string },
  file = CONTENT_FILE,
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
  if (inside(gamePath, cacheDir)) return;
  if (findGameCopy(gameId, gamePath, file) === undefined)
    throw new ConfigError(
      `${gamePath} is not a registered copy of ${gameId}, so the kit will not manage it. ${hint}`,
    );
  if (USER_FOLDERS[gameId] === undefined)
    throw new ConfigError(
      `${gameId} has no entry in USER_FOLDERS (gameSetup.ts), so its user folders cannot be protected.`,
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

/**
 * `game copy <gameId> [--to <folder>]`: copy the store install into `<folder>/<gameId>`, where
 * the folder is `--to` or the stored copy folder, and register it.
 */
export async function copyGame(
  gameId: string,
  to: string | undefined,
  deps: GameCommandDeps = {},
): Promise<GameCopy> {
  const game = requireKnownGame(gameId);
  const file = deps.contentFile ?? CONTENT_FILE;
  const source = (deps.storePath ?? storePathOf)(gameId);
  if (source === undefined)
    throw new ConfigError(`${game.name} is not installed through Steam on this machine.`);
  const folder = to ?? readContent(file).copyFolder;
  if (folder === undefined)
    throw new ConfigError(
      "No copy folder is stored yet. Pass --to <folder> (a drive with room for the game).",
    );
  const destination = path.join(folder, gameId);
  if (isStorePath(destination, source) || inside(destination, source))
    throw new ConfigError(`${destination} is inside a store library; choose another folder.`);
  if (fs.existsSync(destination) && fs.readdirSync(destination).length > 0)
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
  return copy;
}

const describeCopy = (copy: GameCopy): string =>
  `${copy.gameId} copy at ${copy.path} (${(copy.sizeBytes / 1024 ** 3).toFixed(1)} GB` +
  `${copy.gameVersion === undefined ? "" : `, version ${copy.gameVersion}`})`;

/** The `game` command. Returns the text to print and the exit code. */
export async function gameCommand(
  positional: string[],
  flags: Record<string, string | boolean>,
  lists: Record<string, string[]>,
  deps: GameCommandDeps = {},
): Promise<{ text: string; code: number }> {
  const [sub, gameId, dir] = positional;
  const usage =
    "Use game copy <gameId> [--to <folder>], game register <gameId> <dir>, or " +
    "game restore <gameId> [--all | --keep | --file <path>...].";
  if (gameId === undefined) throw new ConfigError(usage);
  switch (sub) {
    case "copy": {
      const copy = await copyGame(
        gameId,
        typeof flags.to === "string" ? flags.to : undefined,
        deps,
      );
      return { text: `Copied and registered the ${describeCopy(copy)}.`, code: 0 };
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
