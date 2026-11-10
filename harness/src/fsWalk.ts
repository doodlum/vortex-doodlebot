/**
 * Small file-system helpers shared by the commands that size, back up or clean folders, and by
 * the rules that keep a store install out of the kit's hands.
 */
import fs from "node:fs";
import path from "node:path";

import { KNOWN_GAMES, findGamePath } from "./gameSetup";

export interface WalkedFile {
  /** The absolute path. */
  path: string;
  /** Inside the walked folder, with `/` separators. */
  relative: string;
  size: number;
  mtimeMs: number;
}

/**
 * Every file under `root` (none when it does not exist). `strict` throws on a folder or file that
 * cannot be read, for a walk whose result must be complete (a backup); otherwise those are
 * skipped, for a walk that only counts.
 */
export function walkFiles(root: string, options: { strict?: boolean } = {}): WalkedFile[] {
  if (!fs.existsSync(root)) return [];
  const files: WalkedFile[] = [];
  const attempt = <T>(read: () => T): T | undefined => {
    if (options.strict === true) return read();
    try {
      return read();
    } catch {
      return undefined;
    }
  };
  const visit = (dir: string, prefix: string): void => {
    const entries = attempt(() => fs.readdirSync(dir, { withFileTypes: true }));
    for (const entry of entries ?? []) {
      const full = path.join(dir, entry.name);
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) visit(full, relative);
      else if (entry.isFile()) {
        const stat = attempt(() => fs.statSync(full));
        if (stat !== undefined)
          files.push({ path: full, relative, size: stat.size, mtimeMs: stat.mtimeMs });
      }
    }
  };
  visit(root, "");
  return files;
}

/** The bytes of every readable file under `dir`, or undefined when it does not exist. */
export function folderBytes(dir: string): number | undefined {
  if (!fs.existsSync(dir)) return undefined;
  return walkFiles(dir).reduce((sum, file) => sum + file.size, 0);
}

/** `child` is `parent` or inside it. */
export function inside(child: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** A game's store install (findGamePath), or undefined for an unknown or uninstalled game. */
export function storePathOf(gameId: string): string | undefined {
  const game = KNOWN_GAMES[gameId];
  return game === undefined ? undefined : findGamePath(game);
}
