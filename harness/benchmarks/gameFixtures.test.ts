import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createGameSnapshot, verifyGameSnapshot, gameSnapshotManifest } from "./gameFixtures";
import { resetGameSettings } from "./gameSettings";
import { gameSettingsResource } from "./gameSettings";
import { holdLease, addInstancePid, removeInstancePid } from "../src/lease";

const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "doodlebot-game-reset-test-"));
  roots.push(root);
  const source = path.join(root, "source");
  fs.mkdirSync(path.join(source, "Data"), { recursive: true });
  fs.writeFileSync(path.join(source, "Data/game.esm"), "original game bytes");
  return { root, source, destination: path.join(root, "snapshot") };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it("copies genuine bytes, records exclusions, and leaves its source untouched", async () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.source, "Data/partial.esl"), "partial creation");
  const result = await createGameSnapshot({ ...f, exclude: ["Data/partial.esl"] });
  expect(result.files).toHaveLength(1);
  expect(result.excluded).toEqual(["Data/partial.esl"]);
  expect(fs.readFileSync(path.join(f.source, "Data/partial.esl"), "utf8")).toBe("partial creation");
  await expect(verifyGameSnapshot(f.destination)).resolves.toEqual(result);
  await expect(createGameSnapshot(f)).rejects.toThrow("already exists");
});
it.each(["extra", "missing", "corrupt"])("rejects a %s game copy before reuse", async (change) => {
  const f = fixture();
  await createGameSnapshot(f);
  const target = path.join(f.destination, "Data/game.esm");
  if (change === "extra") fs.writeFileSync(path.join(f.destination, "mod.dll"), "mod");
  else if (change === "missing") fs.unlinkSync(target);
  else fs.writeFileSync(target, "corrupt game bytes!");
  await expect(verifyGameSnapshot(f.destination)).rejects.toThrow(
    /inventory differs|bytes differ|cannot be empty/,
  );
});
it("rejects deployed games and nested destinations before making a copy", async () => {
  const f = fixture();
  await expect(
    createGameSnapshot({ source: f.source, destination: path.join(f.source, "..snapshot") }),
  ).rejects.toThrow("outside source");
  fs.writeFileSync(path.join(f.source, "Data/vortex.deployment.json"), "deployment");
  await expect(createGameSnapshot(f)).rejects.toThrow("deployment manifest");
  expect(fs.existsSync(f.destination)).toBe(false);
});
it("does not certify a partial copy after a write failure", async () => {
  const f = fixture();
  vi.spyOn(fs, "copyFileSync").mockImplementation(() => {
    throw new Error("disk full");
  });
  await expect(createGameSnapshot(f)).rejects.toThrow("disk full");
  expect(fs.existsSync(gameSnapshotManifest(f.destination))).toBe(false);
  expect(fs.readFileSync(path.join(f.source, "Data/game.esm"), "utf8")).toBe("original game bytes");
});
it.each(["../escape", "Data/../escape", "C:/escape", "Data\\..\\escape"])(
  "rejects traversal in a snapshot manifest: %s",
  async (relative) => {
    const f = fixture();
    await createGameSnapshot(f);
    const marker = gameSnapshotManifest(f.destination);
    const manifest = JSON.parse(fs.readFileSync(marker, "utf8"));
    manifest.files[0].relative = relative;
    fs.writeFileSync(marker, JSON.stringify(manifest));
    await expect(verifyGameSnapshot(f.destination)).rejects.toThrow("relative paths");
  },
);

function settingsFixture() {
  const f = fixture();
  const dirs = {
    documents: path.join(f.root, "Documents"),
    localAppData: path.join(f.root, "Local"),
  };
  const ini = path.join(dirs.documents, "My Games/Skyrim Special Edition/Skyrim.ini");
  const save = path.join(path.dirname(ini), "Saves/my.ess");
  const plugins = path.join(dirs.localAppData, "Skyrim Special Edition/Plugins.txt");
  const catalog = path.join(path.dirname(plugins), "ContentCatalog.txt");
  for (const [file, bytes] of [
    [ini, "modded ini"],
    [save, "precious save"],
    [plugins, "*old-mod.esp"],
    [catalog, "purchased creations"],
  ]) {
    fs.mkdirSync(path.dirname(file!), { recursive: true });
    fs.writeFileSync(file!, bytes!);
  }
  const options = {
    gameId: "skyrimse",
    owner: `reset-${path.basename(f.root)}`,
    dedicatedWindowsAccount: true as const,
    backupDir: path.join(f.root, "backups"),
    userDirectories: dirs,
  };
  return { ...f, options, ini, save, plugins, catalog };
}
it("backs up and resets only settings, preserving saves and Creation purchases", async () => {
  const f = settingsFixture();
  const backup = await resetGameSettings(f.options);
  expect(backup.files).toHaveLength(2);
  expect(fs.existsSync(f.ini)).toBe(false);
  expect(fs.existsSync(f.plugins)).toBe(false);
  expect(fs.readFileSync(f.save, "utf8")).toBe("precious save");
  expect(fs.readFileSync(f.catalog, "utf8")).toBe("purchased creations");
  expect(
    fs.readFileSync(
      path.join(backup.directory, "documents/My Games/Skyrim Special Edition/Skyrim.ini"),
      "utf8",
    ),
  ).toBe("modded ini");
  expect(fs.existsSync(path.join(backup.directory, "backup.json"))).toBe(true);
});
it("preserves originals if any backup fails", async () => {
  const f = settingsFixture();
  const original = fs.copyFileSync;
  vi.spyOn(fs, "copyFileSync").mockImplementation((...args) => {
    if (String(args[0]).endsWith("Plugins.txt")) throw new Error("disk full");
    original(...args);
  });
  await expect(resetGameSettings(f.options)).rejects.toThrow("disk full");
  expect(fs.readFileSync(f.ini, "utf8")).toBe("modded ini");
  expect(fs.readFileSync(f.plugins, "utf8")).toBe("*old-mod.esp");
});
it("rolls back earlier removals when a reset fails", async () => {
  const f = settingsFixture();
  const original = fs.unlinkSync;
  vi.spyOn(fs, "unlinkSync").mockImplementation((file) => {
    if (String(file) === f.plugins) throw new Error("locked file");
    original(file);
  });
  await expect(resetGameSettings(f.options)).rejects.toThrow("locked file");
  expect(fs.readFileSync(f.ini, "utf8")).toBe("modded ini");
  expect(fs.readFileSync(f.plugins, "utf8")).toBe("*old-mod.esp");
});
it("requires test account consent and a supported game", async () => {
  const f = settingsFixture();
  await expect(
    resetGameSettings({ ...f.options, dedicatedWindowsAccount: false as unknown as true }),
  ).rejects.toThrow("dedicatedWindowsAccount");
  await expect(resetGameSettings({ ...f.options, gameId: "unknown" })).rejects.toThrow(
    "No game settings reset adapter",
  );
  expect(fs.existsSync(f.ini)).toBe(true);
});
it("refuses to reset settings used by a running owned Vortex", async () => {
  const f = settingsFixture();
  const hold = holdLease(gameSettingsResource("skyrimse"), f.options.owner);
  addInstancePid(hold.lease, process.pid);
  try {
    await expect(resetGameSettings(f.options)).rejects.toThrow("while Vortex is running");
    expect(fs.readFileSync(f.ini, "utf8")).toBe("modded ini");
  } finally {
    removeInstancePid(hold.lease, process.pid);
    hold.release();
  }
});
it("excludes concurrent resets even when callers copy the same owner", async () => {
  const f = settingsFixture();
  const first = resetGameSettings(f.options);
  const second = resetGameSettings(f.options);
  try {
    await expect(second).rejects.toThrow(/independent operation/);
  } finally {
    await first;
  }
});
it("rejects a linked ancestor of a snapshot without touching the real source", async () => {
  const f = fixture();
  const alias = path.join(f.root, "alias");
  fs.symlinkSync(f.source, alias, "junction");
  await expect(
    createGameSnapshot({ source: path.join(alias, "Data"), destination: f.destination }),
  ).rejects.toThrow("linked game path");
  expect(fs.readFileSync(path.join(f.source, "Data/game.esm"), "utf8")).toBe("original game bytes");
});
