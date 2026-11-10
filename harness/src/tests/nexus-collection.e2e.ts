/** Opt-in live-service test: doodlebot test nexus after setup --oauth. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadConfig, ConfigError, resolveTarget } from "../config";
import { readJsonFile } from "../jsonFile";
import { bootstrap } from "../bootstrap";
import { authCacheFile, stopStaleInstance } from "../instance";
import { installCollection } from "../collections";
import { deployMods, purgeGame } from "../deployment";
import { captureScreenshot } from "../cdp";
import { readContent, recordCollection } from "../content";
import { KNOWN_GAMES } from "../gameSetup";
import { resolveNexusCollection } from "../nexusCollection";

const parent = loadConfig(
  process.argv.includes("--installed") ? { target: resolveTarget({ preferInstalled: true }) } : {},
);
// The collection is the --collection argument, or the newest one content.json records; nothing
// is pinned (design 4.5).
const target = resolveNexusCollection(process.argv.slice(2), readContent());
const game = KNOWN_GAMES[target.gameId]!;
const collection = target.url;
console.log(`collection: ${target.gameId}/${target.slug} (from ${target.source})`);
const cacheDir = path.join(parent.cacheDir, "nexus-smoke");
const gamePath = path.join(cacheDir, "game", target.gameId);
// Its own profile, so your working profile is not replaced, but the one shared login
// (~/.doodlebot/login), used directly: Vortex writes its token rotations straight into it, so
// nothing is copied in or back (login.ts).
const config = {
  ...parent,
  cacheDir,
  gamePath,
  gameId: target.gameId,
  apiKey: undefined,
  sharedLogin: true,
};
if (!fs.existsSync(authCacheFile(config)))
  throw new ConfigError(
    "Run doodlebot setup --oauth for this target first. This opt-in test requires a cached Nexus login and unattended downloads require a Premium account.",
  );
await stopStaleInstance(parent);
fs.mkdirSync(path.dirname(path.join(gamePath, game.executable)), { recursive: true });
fs.writeFileSync(
  path.join(gamePath, game.executable),
  "Automation path marker; not a playable game.",
);

/** Vortex's deployment manifests in the game folder and the folders one level down. */
function deploymentManifests(dir: string): string[] {
  const found: string[] = [];
  const scan = (folder: string, depth: number): void => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isFile() && /^vortex\.deployment.*\.json$/i.test(entry.name)) found.push(full);
      else if (entry.isDirectory() && depth > 0) scan(full, depth - 1);
    }
  };
  scan(dir, 1);
  return found;
}
try {
  const { instance, tier } = await bootstrap(config, { fresh: true, onProgress: console.log });
  await purgeGame(instance.mcp, { allowForeignPurge: true, onProgress: console.log });
  const result = await installCollection(instance.mcp, collection, {
    timeoutMs: 300_000,
    onProgress: console.log,
  });
  await deployMods(instance.mcp, config.gameId, {
    allowForeignPurge: true,
    onProgress: console.log,
  });
  const deployed: string[] = [];
  const hash = (file: string): string =>
    crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  for (const file of deploymentManifests(gamePath)) {
    const manifest = readJsonFile<{
      targetPath: string;
      stagingPath: string;
      files: { target?: string; relPath: string; source: string }[];
    }>(file);
    for (const entry of manifest.files) {
      const target = path.join(manifest.targetPath, entry.target ?? "", entry.relPath);
      const source = path.join(manifest.stagingPath, entry.source, entry.relPath);
      if (hash(target) !== hash(source))
        throw new Error(`Deployment bytes differ for ${entry.relPath}`);
      deployed.push(target);
    }
  }
  if (deployed.length === 0) throw new Error("No deployed files were validated.");
  if (result.complete) recordCollection(result.ref);
  const screenshot = await captureScreenshot(config, { label: "nexus-smoke" });
  await purgeGame(instance.mcp, { onProgress: console.log });
  if (deployed.some((file) => fs.existsSync(file)))
    throw new Error("Purge left deployed files behind.");
  fs.mkdirSync(config.artifactDir, { recursive: true });
  const evidence = path.join(config.artifactDir, `nexus-smoke-${Date.now()}.json`);
  fs.writeFileSync(
    evidence,
    JSON.stringify(
      {
        collection,
        tier,
        ...result,
        deployedFilesVerified: deployed.length,
        purgeVerified: true,
        gameLaunch: "not tested: disposable executable marker",
        screenshot,
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS: ${result.modCount}/${result.expectedModCount} required mods; ${deployed.length} file hashes and purge verified. ${evidence}`,
  );
} finally {
  await stopStaleInstance(config);
}
