import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DEFAULT_CACHE_DIR, DEFAULT_ARTIFACT_DIR } from "../harness/src/paths";
import { holdLease } from "../harness/src/lease";
import { claimOperations } from "../harness/src/operations";
import {
  createGameSnapshot,
  verifyGameSnapshot,
  assertRegularPath,
} from "../harness/benchmarks/gameFixtures";
import { createSkyrimSnapshot, verifySkyrimEdition } from "../harness/benchmarks/skyrimEdition";
import { KNOWN_GAMES, findGamePath } from "../harness/src/gameSetup";
import { realCollection, pinnedCollections } from "./collections";
import type { CollectionCode, RealCollection } from "./types";

const codeSchema = z.enum(["C1", "C2", "C2-AE", "C3", "C5"]);
const snapshotSchema = z
  .object({
    id: z.string(),
    gameId: z.string(),
    edition: z.enum(["base", "anniversary"]).optional(),
    directory: z.string(),
    createdAt: z.string(),
    verifiedAt: z.string(),
    bytes: z.number().nonnegative(),
  })
  .strict();
const setupSchema = z
  .object({
    version: z.literal(1),
    snapshots: z.array(snapshotSchema),
    collections: z.array(
      z
        .object({
          code: codeSchema,
          snapshotId: z.string(),
          authCache: z.string(),
          dedicatedWindowsAccount: z.literal(true),
          warningsAsErrors: z.boolean(),
        })
        .strict(),
    ),
    account: z.object({ checkedAt: z.string(), premium: z.boolean() }).strict().optional(),
  })
  .strict();
export type BenchmarkSetup = z.infer<typeof setupSchema>;
export const benchmarkSetupFile = path.join(DEFAULT_CACHE_DIR, "benchmark-setup.json");

/** Read local preparation choices. No account check, app launch or file copying. */
export function readBenchmarkSetup(file = benchmarkSetupFile): BenchmarkSetup {
  if (!fs.existsSync(file)) return { version: 1, snapshots: [], collections: [] };
  assertRegularPath(file);
  return setupSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}
export function writeBenchmarkSetup(setup: BenchmarkSetup, file = benchmarkSetupFile): void {
  const value = setupSchema.parse(setup);
  assertRegularPath(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
export function discoverBenchmarkGames(libraries?: string[]) {
  return ["skyrimse", "cyberpunk2077"].map((id) => {
    const game = KNOWN_GAMES[id]!;
    return { id, name: game.name, directory: findGamePath(game, libraries) };
  });
}
/** Presence is a local observation; it does not prove refresh or server access. */
export function cachedAccountStatus(
  file: string,
): "missing" | "signed-out" | "cached" | "unreadable" {
  if (!fs.existsSync(file)) return "missing";
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (value === null) return "signed-out";
    if (
      typeof value === "object" &&
      "token" in value! &&
      "refreshToken" in value! &&
      typeof value.token === "string" &&
      value.token.length &&
      typeof value.refreshToken === "string" &&
      value.refreshToken.length
    )
      return "cached";
  } catch {
    /* Status only; never print token data or a parser excerpt. */
  }
  return "unreadable";
}
/** Reuse a single saved kit login when no cache exists for the released target. */
export function findBenchmarkAccountCache(preferred: string): string {
  if (fs.existsSync(preferred)) return preferred;
  const directory = path.dirname(preferred);
  if (!fs.existsSync(directory)) return preferred;
  const candidates = fs
    .readdirSync(directory)
    .filter((name) => /^oauth-[a-f0-9]{16}\.json$/.test(name))
    .map((name) => path.join(directory, name))
    .filter((file) => cachedAccountStatus(file) === "cached");
  // Multiple accounts require explicit choice rather than whichever file was listed first.
  return candidates.length === 1 ? candidates[0]! : preferred;
}
function editionFor(code: CollectionCode) {
  return code === "C2"
    ? ("base" as const)
    : code === "C2-AE" || code === "C3"
      ? ("anniversary" as const)
      : undefined;
}
/** Verify a tracked copy in full, including the selected Skyrim content. */
export async function verifyPreparedSnapshot(
  snapshot: BenchmarkSetup["snapshots"][number],
): Promise<void> {
  await verifyGameSnapshot(snapshot.directory);
  if (snapshot.edition) verifySkyrimEdition(snapshot.directory, snapshot.edition);
  const game = KNOWN_GAMES[snapshot.gameId];
  if (!game || !fs.statSync(path.join(snapshot.directory, game.executable)).isFile())
    throw new Error("Snapshot is missing its game executable");
}
export interface PrepareCollectionOptions {
  code: CollectionCode;
  /** Required acknowledgement; setup never infers that a user's account is disposable. */
  dedicatedWindowsAccount: true;
  /** The operator confirms the source is clean and the game/launcher are closed. */
  cleanSource: true;
  authCache: string;
  owner: string;
  /** Copy this source into a new snapshot, even when an older snapshot is saved. */
  source?: string;
  /** Register an existing verified copy rather than copying the installed game. */
  snapshot?: string;
  warningsAsErrors?: boolean;
  setupFile?: string;
  snapshotRoot?: string;
}
/** Find the installed game and create/reuse a verified copy; never deploy into the source. */
export async function prepareCollection(
  options: PrepareCollectionOptions,
): Promise<RealCollection> {
  if (options.dedicatedWindowsAccount !== true || options.cleanSource !== true)
    throw new Error(
      "Confirm a QA-only Windows account/test machine and a clean, closed game first",
    );
  if (options.source && options.snapshot)
    throw new Error("Choose a new source or an existing snapshot, not both");
  const file = options.setupFile ?? benchmarkSetupFile;
  const lock = holdLease(`benchmark-setup:${path.resolve(file).toLowerCase()}`, options.owner, {
    purpose: "prepare collection prerequisites",
  });
  let operation: ReturnType<typeof claimOperations> | undefined;
  try {
    operation = claimOperations(
      [`benchmark-setup:${path.resolve(file).toLowerCase()}`],
      options.owner,
    );
    const setup = readBenchmarkSetup(file);
    const code = codeSchema.parse(options.code);
    const gameId = pinnedCollections[code].gameId;
    const edition = editionFor(code);
    const selectedSnapshot = setup.collections.find((item) => item.code === code)?.snapshotId;
    let snapshot = options.snapshot
      ? setup.snapshots.find(
          (item) => path.resolve(item.directory) === path.resolve(options.snapshot!),
        )
      : options.source
        ? undefined
        : (setup.snapshots.find((item) => item.id === selectedSnapshot) ??
          setup.snapshots.findLast((item) => item.gameId === gameId && item.edition === edition));
    if (snapshot && (snapshot.gameId !== gameId || snapshot.edition !== edition))
      throw new Error("Snapshot game/content does not match the selected collection");
    if (snapshot) {
      await verifyPreparedSnapshot(snapshot);
      snapshot.verifiedAt = new Date().toISOString();
    } else {
      const now = new Date().toISOString();
      const id = `${gameId}-${edition ?? "game"}-${randomUUID()}`;
      const directory = options.snapshot
        ? path.resolve(options.snapshot)
        : path.join(options.snapshotRoot ?? path.join(DEFAULT_ARTIFACT_DIR, "game-fixtures"), id);
      let manifest;
      if (options.snapshot) manifest = await verifyGameSnapshot(directory);
      else {
        const source = options.source ?? findGamePath(KNOWN_GAMES[gameId]!);
        if (!source)
          throw new Error(
            `${KNOWN_GAMES[gameId]!.name} was not found. Install it in Steam or provide its directory.`,
          );
        if (!fs.statSync(path.join(source, KNOWN_GAMES[gameId]!.executable)).isFile())
          throw new Error("Selected source has no matching game executable");
        manifest = edition
          ? await createSkyrimSnapshot({ source, destination: directory, edition })
          : await createGameSnapshot({ source, destination: directory });
      }
      snapshot = {
        id,
        directory,
        gameId,
        edition,
        createdAt: manifest.createdAt,
        verifiedAt: now,
        bytes: manifest.files.reduce((sum, item) => sum + item.size, 0),
      };
      await verifyPreparedSnapshot(snapshot);
      setup.snapshots.push(snapshot);
    }
    setup.collections = setup.collections.filter((item) => item.code !== code);
    setup.collections.push({
      code,
      snapshotId: snapshot.id,
      authCache: path.resolve(options.authCache),
      dedicatedWindowsAccount: true,
      warningsAsErrors: options.warningsAsErrors ?? false,
    });
    writeBenchmarkSetup(setup, file);
    return preparedCollection(code, file);
  } finally {
    operation?.release();
    lock.release();
  }
}
/** Use a setup choice from TypeScript without copying local paths into source. */
export function preparedCollection(
  code: CollectionCode,
  file = benchmarkSetupFile,
): RealCollection {
  const setup = readBenchmarkSetup(file);
  const configured = setup.collections.find((item) => item.code === code);
  const snapshot = setup.snapshots.find((item) => item.id === configured?.snapshotId);
  if (!configured || !snapshot)
    throw new Error(`${code} has not been prepared. Run pnpm run setup.`);
  if (snapshot.gameId !== pinnedCollections[code].gameId || snapshot.edition !== editionFor(code))
    throw new Error("Saved collection and snapshot disagree; run setup again");
  return realCollection(code, {
    authCache: configured.authCache,
    gameFixture: snapshot.directory,
    allowGameFixtureCopy: true,
    dedicatedWindowsAccount: true,
    warningsAsErrors: configured.warningsAsErrors,
    ready: {
      gameFiles:
        snapshot.gameId === "skyrimse"
          ? ["SkyrimSE.exe", "Data/Skyrim.esm", "skse64_loader.exe"]
          : [
              "bin/x64/Cyberpunk2077.exe",
              "bin/x64/plugins/cyber_engine_tweaks.asi",
              "red4ext/RED4ext.dll",
            ],
      equals: true,
    },
  });
}
export function preparedCollections(
  file = benchmarkSetupFile,
): Partial<Record<CollectionCode, RealCollection>> {
  return Object.fromEntries(
    readBenchmarkSetup(file).collections.map((item) => [
      item.code,
      preparedCollection(item.code, file),
    ]),
  );
}
