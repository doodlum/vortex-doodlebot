import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { findGamePath, KNOWN_GAMES } from "../harness/src/gameSetup";
import {
  cachedAccountStatus,
  discoverBenchmarkGames,
  findBenchmarkAccountCache,
  prepareCollection,
  preparedCollection,
  preparedCollections,
  readBenchmarkSetup,
} from "./setup";

const base = path.resolve("harness/.artifacts/human-setup-unit-fixtures");
const roots: string[] = [];
function fixture() {
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, "setup-"));
  roots.push(root);
  return root;
}
function write(root: string, file: string, bytes = "test bytes") {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  return target;
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    const relative = path.relative(base, path.resolve(root));
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Unsafe test cleanup path");
    fs.rmSync(root, { recursive: true, force: true });
  }
});
it("finds renamed Steam installations from manifests in any supplied library", () => {
  const root = fixture();
  const skyrim = path.join(root, "steamapps/common/Skyrim test installation");
  write(
    root,
    "steamapps/appmanifest_489830.acf",
    '"AppState" { "installdir" "Skyrim test installation" }',
  );
  write(skyrim, "SkyrimSE.exe");
  expect(findGamePath(KNOWN_GAMES.skyrimse!, [root])).toBe(skyrim);
  expect(discoverBenchmarkGames([root])).toContainEqual({
    id: "skyrimse",
    name: "Skyrim Special Edition",
    directory: skyrim,
  });
  fs.unlinkSync(path.join(root, "steamapps/appmanifest_489830.acf"));
  expect(findGamePath(KNOWN_GAMES.skyrimse!, [root])).toBeUndefined();
});
it("rejects a traversal installdir even when the executable exists outside common", () => {
  const root = fixture();
  write(root, "steamapps/appmanifest_489830.acf", '"installdir" "../outside"');
  write(root, "steamapps/outside/SkyrimSE.exe");
  expect(findGamePath(KNOWN_GAMES.skyrimse!, [root])).toBeUndefined();
});
it("distinguishes cache presence, logout and corruption without exposing values", () => {
  const root = fixture();
  const file = path.join(root, "oauth-aaee9e68c56f8889.json");
  expect(cachedAccountStatus(file)).toBe("missing");
  fs.writeFileSync(file, "null");
  expect(cachedAccountStatus(file)).toBe("signed-out");
  fs.writeFileSync(file, '{"token":"private-test-token","refreshToken":"private-test-refresh"}');
  expect(cachedAccountStatus(file)).toBe("cached");
  fs.writeFileSync(file, "broken private-test-token");
  expect(cachedAccountStatus(file)).toBe("unreadable");
});
it("reuses one saved login, respects logout and never chooses among ambiguous accounts", () => {
  const root = fixture();
  const preferred = path.join(root, "oauth-aaee9e68c56f8889.json");
  const other = write(
    root,
    "oauth-4c9b755d71cd631f.json",
    '{"token":"one","refreshToken":"refresh-one"}',
  );
  expect(findBenchmarkAccountCache(preferred)).toBe(other);
  fs.writeFileSync(preferred, "null");
  expect(findBenchmarkAccountCache(preferred)).toBe(preferred);
  fs.unlinkSync(preferred);
  write(root, "oauth-1111111111111111.json", '{"token":"two","refreshToken":"refresh-two"}');
  expect(findBenchmarkAccountCache(preferred)).toBe(preferred);
});
it("saves a real copy separately, reuses it and refuses changed bytes without replacing the saved choice", async () => {
  const root = fixture();
  const source = path.join(root, "source");
  write(source, "bin/x64/Cyberpunk2077.exe", "unchanged game executable");
  write(source, "archive/pc/content.archive", "real fixture payload");
  const authCache = write(root, "login.json", "null");
  const setupFile = path.join(root, "setup.json");
  const options = {
    code: "C5" as const,
    dedicatedWindowsAccount: true as const,
    cleanSource: true as const,
    source,
    authCache,
    owner: `setup-test-${path.basename(root)}`,
    setupFile,
    snapshotRoot: path.join(root, "snapshots"),
  };
  const collection = await prepareCollection(options);
  expect(collection.url).toContain("/revisions/94");
  expect(collection.gameFixture).not.toBe(source);
  expect(fs.readFileSync(path.join(source, "archive/pc/content.archive"), "utf8")).toBe(
    "real fixture payload",
  );
  expect(readBenchmarkSetup(setupFile).snapshots).toHaveLength(1);
  expect(await prepareCollection({ ...options, source: undefined })).toEqual(collection);
  expect(readBenchmarkSetup(setupFile).snapshots).toHaveLength(1);
  expect(preparedCollections(setupFile).C5).toEqual(preparedCollection("C5", setupFile));
  const saved = fs.readFileSync(setupFile, "utf8");
  fs.writeFileSync(path.join(collection.gameFixture, "archive/pc/content.archive"), "changed");
  await expect(prepareCollection({ ...options, source: undefined })).rejects.toThrow(
    "bytes differ",
  );
  expect(fs.readFileSync(setupFile, "utf8")).toBe(saved);
});
it("uses an explicit new source even when the previously saved snapshot is damaged", async () => {
  const root = fixture();
  const source = path.join(root, "source-a");
  const updatedSource = path.join(root, "source-b");
  write(source, "bin/x64/Cyberpunk2077.exe", "old game bytes");
  write(updatedSource, "bin/x64/Cyberpunk2077.exe", "updated game bytes");
  const options = {
    code: "C5" as const,
    dedicatedWindowsAccount: true as const,
    cleanSource: true as const,
    source,
    authCache: path.join(root, "login.json"),
    owner: `setup-test-${path.basename(root)}`,
    setupFile: path.join(root, "setup.json"),
    snapshotRoot: path.join(root, "snapshots"),
  };
  const first = await prepareCollection(options);
  fs.writeFileSync(path.join(first.gameFixture, "bin/x64/Cyberpunk2077.exe"), "damaged");
  const second = await prepareCollection({ ...options, source: updatedSource });
  expect(second.gameFixture).not.toBe(first.gameFixture);
  expect(fs.readFileSync(path.join(second.gameFixture, "bin/x64/Cyberpunk2077.exe"), "utf8")).toBe(
    "updated game bytes",
  );
  expect(preparedCollection("C5", options.setupFile)).toEqual(second);
  expect(await prepareCollection({ ...options, source: undefined })).toEqual(second);
  expect(readBenchmarkSetup(options.setupFile).snapshots).toHaveLength(2);
  const saved = fs.readFileSync(options.setupFile, "utf8");
  await expect(prepareCollection({ ...options, snapshot: first.gameFixture })).rejects.toThrow(
    "not both",
  );
  expect(fs.readFileSync(options.setupFile, "utf8")).toBe(saved);
});
it("blocks absent acknowledgements and dirty sources before persisting a configuration", async () => {
  const root = fixture();
  const source = path.join(root, "source");
  write(source, "bin/x64/Cyberpunk2077.exe");
  write(source, "vortex.deployment.json", "{}");
  const options = {
    code: "C5" as const,
    dedicatedWindowsAccount: true as const,
    cleanSource: true as const,
    source,
    authCache: path.join(root, "login.json"),
    owner: `setup-test-${path.basename(root)}`,
    setupFile: path.join(root, "setup.json"),
    snapshotRoot: path.join(root, "snapshots"),
  };
  await expect(
    prepareCollection({ ...options, cleanSource: false as unknown as true }),
  ).rejects.toThrow("Confirm");
  await expect(prepareCollection(options)).rejects.toThrow("deployment manifest");
  expect(fs.existsSync(options.setupFile)).toBe(false);
});
