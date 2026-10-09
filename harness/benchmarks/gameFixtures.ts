import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

const snapshotSchema = z
  .object({
    version: z.literal(1),
    createdAt: z.string(),
    excluded: z.array(z.string()),
    files: z.array(
      z.object({
        relative: z.string(),
        size: z.number().int().nonnegative(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    ),
  })
  .strict();
export type GameSnapshot = z.infer<typeof snapshotSchema>;
export interface GameSnapshotOptions {
  /** A known clean installed game. Hashes prove integrity, not Steam provenance. */
  source: string;
  /** New directory, outside source. Neither existing snapshots nor sources are overwritten. */
  destination: string;
  /** Exact relative files to leave out, for example incomplete paid Creation downloads. */
  exclude?: readonly string[];
}

export function gameSnapshotManifest(snapshot: string): string {
  return `${path.resolve(snapshot)}.doodlebot-snapshot.json`;
}

/** Reject junctions/symlinks, including linked ancestors of a supplied root. */
export function assertRegularPath(target: string): void {
  let current = path.resolve(target);
  for (;;) {
    try {
      if (fs.lstatSync(current).isSymbolicLink())
        throw new Error(`Refusing linked game path: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
function relativeFile(relative: string): string {
  if (
    !relative ||
    path.isAbsolute(relative) ||
    path.win32.isAbsolute(relative) ||
    relative.includes(":") ||
    relative.split(/[\\/]/).some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Snapshot files must be contained relative paths without traversal");
  return relative.replace(/\\/g, "/");
}
export async function hashGameFile(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 1024 * 1024 }))
    hash.update(chunk);
  return hash.digest("hex");
}
function inventory(root: string): string[] {
  assertRegularPath(root);
  if (!fs.statSync(root).isDirectory()) throw new Error("Game snapshot must be a directory");
  const files: string[] = [];
  const visit = (folder: string): void => {
    for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, item.name);
      if (item.isSymbolicLink()) throw new Error("Game snapshot contains linked files");
      if (/^vortex\.deployment(?:\..+)?\.json$/i.test(item.name))
        throw new Error("Game snapshot contains a Vortex deployment manifest; supply a clean game");
      if (item.isDirectory()) visit(file);
      else if (item.isFile()) files.push(path.relative(root, file).replace(/\\/g, "/"));
      else throw new Error("Game snapshot contains a non-regular file");
    }
  };
  visit(root);
  if (!files.length) throw new Error("Game snapshot cannot be empty");
  return files.sort();
}

/** Copy and hash every file. Only a fully verified copy receives a snapshot manifest. */
export async function createGameSnapshot(options: GameSnapshotOptions): Promise<GameSnapshot> {
  const source = path.resolve(options.source);
  const destination = path.resolve(options.destination);
  const relation = path.relative(source, destination);
  if (
    !relation ||
    (relation !== ".." && !relation.startsWith(`..${path.sep}`) && !path.isAbsolute(relation))
  )
    throw new Error("Snapshot destination must be outside source");
  assertRegularPath(destination);
  const marker = gameSnapshotManifest(destination);
  if (fs.existsSync(destination) || fs.existsSync(marker))
    throw new Error("Snapshot destination already exists");
  const allFiles = inventory(source);
  const excluded = [...new Set((options.exclude ?? []).map(relativeFile))].sort();
  for (const file of excluded)
    if (!allFiles.includes(file)) throw new Error(`Excluded file is absent: ${file}`);
  const files = allFiles.filter((file) => !excluded.includes(file));
  if (!files.length) throw new Error("Game snapshot cannot be empty");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.mkdirSync(destination);
  const snapshot: GameSnapshot = {
    version: 1,
    createdAt: new Date().toISOString(),
    excluded,
    files: [],
  };
  for (const relative of files) {
    const from = path.join(source, relative);
    const to = path.join(destination, relative);
    assertRegularPath(from);
    const sha256 = await hashGameFile(from);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    if ((await hashGameFile(to)) !== sha256 || (await hashGameFile(from)) !== sha256)
      throw new Error(`Game changed during snapshot: ${relative}; incomplete copy retained`);
    snapshot.files.push({ relative, size: fs.statSync(to).size, sha256 });
  }
  if (JSON.stringify(inventory(source)) !== JSON.stringify(allFiles))
    throw new Error("Game inventory changed during snapshot; incomplete copy retained");
  const temporary = `${marker}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(snapshot, null, 2), { flag: "wx" });
  fs.renameSync(temporary, marker);
  await verifyGameSnapshot(destination);
  return snapshot;
}

/** Check exact file inventory and bytes before cloning a benchmark game. */
export async function verifyGameSnapshot(
  snapshot: string,
  manifestFile = gameSnapshotManifest(snapshot),
): Promise<GameSnapshot> {
  const marker = manifestFile;
  assertRegularPath(marker);
  const manifest = snapshotSchema.parse(JSON.parse(fs.readFileSync(marker, "utf8")));
  const expected = manifest.files.map((file) => relativeFile(file.relative));
  if (new Set(expected.map((file) => file.toLowerCase())).size !== expected.length)
    throw new Error("Duplicate snapshot paths");
  const actual = inventory(path.resolve(snapshot));
  if (JSON.stringify([...expected].sort()) !== JSON.stringify(actual))
    throw new Error("Game snapshot inventory differs: missing or extra files");
  for (const file of manifest.files) {
    const target = path.join(snapshot, relativeFile(file.relative));
    if (fs.statSync(target).size !== file.size || (await hashGameFile(target)) !== file.sha256)
      throw new Error(`Game snapshot bytes differ: ${file.relative}`);
  }
  return manifest;
}
