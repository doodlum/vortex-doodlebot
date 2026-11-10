/**
 * `~/.doodlebot/content.json`: what the kit created and may write to. Game copies (the only real
 * game folders a launch may manage), the folder new copies go to, official releases extracted by
 * `release get`, pending user-folder restores, and Nexus collections the kit installed.
 *
 * One small file per user, shared by every workspace. It is rewritten through a temporary file and
 * a rename, so a reader never sees half of it.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { ConfigError } from "./errors";
import { readJsonFile } from "./jsonFile";
import { CONTENT_FILE, normalizedPath } from "./paths";

const gameCopySchema = z.object({
  gameId: z.string(),
  path: z.string(),
  /** The store install it was copied from; absent for a copy registered by hand. */
  sourcePath: z.string().optional(),
  sizeBytes: z.number(),
  gameVersion: z.string().optional(),
  registeredAt: z.string(),
});

const releaseSchema = z.object({
  version: z.string(),
  /** The extracted app folder. */
  path: z.string(),
  exe: z.string(),
  /** SHA-256 of the installer it was extracted from, as GitHub publishes it. */
  sha256: z.string(),
  registeredAt: z.string(),
});

const pendingRestoreSchema = z.object({
  gameId: z.string(),
  /** The backup in the cache: the copied folders and `manifest.json` (userFolders.ts). */
  backupDir: z.string(),
  /** When the run started: just before the backup, before Vortex was launched. */
  startedAt: z.string(),
});

const collectionSchema = z.object({
  gameId: z.string(),
  slug: z.string(),
  revision: z.number().optional(),
  installedAt: z.string(),
});

const contentSchema = z.object({
  copyFolder: z.string().optional(),
  games: z.array(gameCopySchema).default([]),
  releases: z.array(releaseSchema).default([]),
  pendingRestores: z.array(pendingRestoreSchema).default([]),
  collections: z.array(collectionSchema).default([]),
});

export type GameCopy = z.infer<typeof gameCopySchema>;
export type RegisteredRelease = z.infer<typeof releaseSchema>;
export type PendingRestore = z.infer<typeof pendingRestoreSchema>;
export type InstalledCollection = z.infer<typeof collectionSchema>;
export type Content = z.infer<typeof contentSchema>;

/** The registry, or an empty one when the file does not exist. A malformed file throws. */
export function readContent(file = CONTENT_FILE): Content {
  if (!fs.existsSync(file)) return contentSchema.parse({});
  let value: unknown;
  try {
    value = readJsonFile(file);
  } catch (error) {
    throw new ConfigError(`${file} is not valid JSON; fix or remove it.`, { cause: error });
  }
  const parsed = contentSchema.safeParse(value);
  if (!parsed.success)
    throw new ConfigError(`${file} is malformed (${parsed.error.issues[0]?.message ?? "?"}).`);
  return parsed.data;
}

function writeContent(content: Content, file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${String(process.pid)}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(content, null, 2)}\n`);
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

/** Read, change and write back the registry. */
export function updateContent(change: (content: Content) => void, file = CONTENT_FILE): Content {
  const content = readContent(file);
  change(content);
  writeContent(contentSchema.parse(content), file);
  return content;
}

const samePath = (a: string, b: string): boolean => normalizedPath(a) === normalizedPath(b);

/** Add or replace (same path) a game copy. */
export function registerGameCopy(copy: GameCopy, file = CONTENT_FILE): void {
  updateContent((content) => {
    content.games = [...content.games.filter((g) => !samePath(g.path, copy.path)), copy];
  }, file);
}

/** The registered copy of `gameId` at `dir`, or undefined. */
export function findGameCopy(
  gameId: string,
  dir: string,
  file = CONTENT_FILE,
): GameCopy | undefined {
  return readContent(file).games.find((g) => g.gameId === gameId && samePath(g.path, dir));
}

/** Add or replace (same version) a release. */
export function registerRelease(release: RegisteredRelease, file = CONTENT_FILE): void {
  updateContent((content) => {
    content.releases = [...content.releases.filter((r) => r.version !== release.version), release];
  }, file);
}

export function findRelease(version: string, file = CONTENT_FILE): RegisteredRelease | undefined {
  return readContent(file).releases.find((r) => r.version === version);
}

export function addPendingRestore(pending: PendingRestore, file = CONTENT_FILE): void {
  updateContent((content) => {
    content.pendingRestores = [...content.pendingRestores, pending];
  }, file);
}

export function removePendingRestore(backupDir: string, file = CONTENT_FILE): void {
  updateContent((content) => {
    content.pendingRestores = content.pendingRestores.filter(
      (p) => !samePath(p.backupDir, backupDir),
    );
  }, file);
}
