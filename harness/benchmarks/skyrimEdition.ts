import fs from "node:fs";
import path from "node:path";
import { anniversaryCreationPlugins } from "./skyrimCreationPlugins";
import { assertRegularPath, createGameSnapshot, type GameSnapshot } from "./gameFixtures";
import { BenchmarkBlocked } from "./types";

export const freeSkyrimCreations = [
  "ccBGSSSE001-Fish",
  "ccBGSSSE025-AdvDSGS",
  "ccBGSSSE037-Curios",
  "ccQDRSSE001-SurvivalMode",
] as const;

/** Verify paid-content presence independently of the application's required-member count. */
export function verifySkyrimEdition(fixture: string, edition: "base" | "anniversary") {
  return inspectEdition(fixture, edition);
}
function isFreeCreationFile(name: string): boolean {
  const stem = name
    .replace(/\.(esm|esl|bsa)$/i, "")
    .replace(/ - textures$/i, "")
    .toLowerCase();
  return freeSkyrimCreations.some((free) => free.toLowerCase() === stem);
}
function inspectEdition(fixture: string, edition: "base" | "anniversary", allowPaid = false) {
  const data = path.join(fixture, "Data");
  assertRegularPath(data);
  if (!fs.existsSync(data)) throw new BenchmarkBlocked("Skyrim fixture has no Data directory");
  const files = fs.readdirSync(data);
  const free = new Set<string>(freeSkyrimCreations.map((stem) => stem.toLowerCase()));
  const paid = files.filter((name) => /^cc/i.test(name) && !isFreeCreationFile(name));
  const regularNonempty = (name: string) => {
    const found = files.find((file) => file.toLowerCase() === name.toLowerCase());
    if (!found) return false;
    const target = path.join(data, found);
    assertRegularPath(target);
    return fs.statSync(target).isFile() && fs.statSync(target).size > 0;
  };
  if (edition === "base" && paid.length && !allowPaid)
    throw new BenchmarkBlocked(
      `Base Skyrim fixture contains paid Creation files: ${paid.slice(0, 8).join(", ")}`,
    );
  const plugins =
    edition === "anniversary"
      ? anniversaryCreationPlugins
      : anniversaryCreationPlugins.filter((plugin) =>
          free.has(plugin.replace(/\.(esm|esl)$/i, "").toLowerCase()),
        );
  const needed = plugins.flatMap((plugin) => [plugin, plugin.replace(/\.(esm|esl)$/i, ".bsa")]);
  const missing = needed.filter((name) => !regularNonempty(name));
  if (missing.length)
    throw new BenchmarkBlocked(
      `${edition === "anniversary" ? "Paid Anniversary content download is incomplete" : "Base Skyrim free Creations are incomplete"}: ${missing.slice(0, 12).join(", ")}`,
    );
  return {
    edition,
    creationPlugins: plugins.length,
    creationArchives: plugins.length,
    paidContent: edition === "anniversary",
  };
}

export interface SkyrimSnapshotOptions {
  source: string;
  destination: string;
  edition: "base" | "anniversary";
}
/** Cache either edition from one clean Steam installation without changing the source. */
export async function createSkyrimSnapshot(options: SkyrimSnapshotOptions): Promise<GameSnapshot> {
  inspectEdition(options.source, options.edition, options.edition === "base");
  const data = path.join(options.source, "Data");
  const exclude =
    options.edition === "base"
      ? fs
          .readdirSync(data)
          .filter((name) => /^cc/i.test(name) && !isFreeCreationFile(name))
          .map((name) => {
            const file = path.join(data, name);
            assertRegularPath(file);
            if (!fs.statSync(file).isFile())
              throw new BenchmarkBlocked("Paid Creation entries must be regular files");
            return `Data/${name}`;
          })
      : [];
  const snapshot = await createGameSnapshot({
    source: options.source,
    destination: options.destination,
    exclude,
  });
  verifySkyrimEdition(options.destination, options.edition);
  return snapshot;
}
