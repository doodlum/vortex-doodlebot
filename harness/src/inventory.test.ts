import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SNAPSHOT_SCHEMA_VERSION, markerFile } from "./bootstrap";
import { updateContent } from "./content";
import {
  LOGIN_NEXT,
  chooseContent,
  formatInventory,
  inventorySchema,
  isKnownNeed,
  readInventory,
  type Inventory,
  type InventoryDeps,
  type InventoryItem,
} from "./inventory";

let root: string;
let cacheDir: string;
let deps: InventoryDeps & { contentFile: string; cacheDir: string };

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "inventory-"));
  cacheDir = path.join(root, "cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  deps = {
    contentFile: path.join(root, "content.json"),
    cacheDir,
    installedVortex: () => undefined,
    source: () => undefined,
    storePath: () => undefined,
  };
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const byId = (inventory: Inventory, id: string): InventoryItem | undefined =>
  inventory.items.find((item) => item.id === id);

/** inventory-next-step: every item that is not ready says exactly what makes it ready. */
function expectNextOnEveryNotReady(inventory: Inventory): void {
  expect(inventorySchema.parse(inventory)).toEqual(inventory);
  for (const item of inventory.items) {
    if (item.ready) expect(item.next, item.id).toBeUndefined();
    else expect(item.next, item.id).toMatch(/^(doodlebot |Remove-Item )/);
  }
}

function writeSnapshot(name: string, marker: Record<string, unknown>): string {
  const dir = path.join(cacheDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(markerFile(dir), JSON.stringify(marker));
  return dir;
}

describe("the inventory", () => {
  it("with no games, no login and nothing registered: the sandboxes and offline collections are ready", () => {
    const inventory = readInventory(deps);
    expectNextOnEveryNotReady(inventory);
    expect(inventory.items.filter((item) => item.kind === "game")).toEqual([]);
    expect(byId(inventory, "sandbox")).toMatchObject({ ready: true, gameId: "vortexaisandbox" });
    expect(byId(inventory, "sandbox:fallout4")).toMatchObject({ ready: true, gameId: "fallout4" });
    expect(byId(inventory, "collection:offline")?.ready).toBe(true);
    expect(byId(inventory, "login")).toMatchObject({ ready: false, next: LOGIN_NEXT });
    expect(byId(inventory, "source")).toMatchObject({ ready: false, next: "doodlebot source" });
    expect(formatInventory(inventory)).toContain(`next: ${LOGIN_NEXT}`);
  });

  it("counts a login only when an oauth file holds one, never the null tombstone", () => {
    fs.writeFileSync(path.join(cacheDir, "oauth-abc.json"), "null");
    expect(byId(readInventory(deps), "login")?.ready).toBe(false);
    fs.writeFileSync(path.join(cacheDir, "oauth-def.json"), JSON.stringify({ token: "x" }));
    const inventory = readInventory(deps);
    expect(byId(inventory, "login")).toEqual({
      id: "login",
      kind: "login",
      ready: true,
      label: "a Nexus login is cached",
    });
  });

  it("lists a store install as not usable, with the copy command, and a registered copy as usable", () => {
    const store = path.join(root, "SteamLibrary", "steamapps", "common", "Fallout 4");
    deps.storePath = (gameId) => (gameId === "fallout4" ? store : undefined);
    let inventory = readInventory(deps);
    expectNextOnEveryNotReady(inventory);
    expect(inventory.items.filter((item) => item.kind === "game")).toEqual([
      expect.objectContaining({
        id: "store:fallout4",
        ready: false,
        next: "doodlebot game copy fallout4 --to <folder>",
        path: store,
      }),
    ]);

    const copy = path.join(root, "copies", "fallout4");
    fs.mkdirSync(copy, { recursive: true });
    fs.writeFileSync(path.join(copy, "Fallout4.exe"), "exe");
    updateContent((content) => {
      content.copyFolder = path.join(root, "copies");
      content.games.push({
        gameId: "fallout4",
        path: copy,
        sizeBytes: 3,
        registeredAt: "2026-11-10T10:00:00.000Z",
      });
    }, deps.contentFile);
    inventory = readInventory(deps);
    expectNextOnEveryNotReady(inventory);
    expect(byId(inventory, "store:fallout4")?.next).toBe("doodlebot game copy fallout4");
    expect(inventory.items.find((item) => item.id.startsWith("copy:fallout4:"))).toMatchObject({
      ready: true,
      gameId: "fallout4",
      path: copy,
    });
  });

  it("reads snapshots through their marker; a stale one says how to rebuild it, an old one has no build", () => {
    const exe = path.join(root, "Vortex", "Vortex.exe");
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    fs.writeFileSync(exe, "");
    const sandboxGame = path.join(cacheDir, "sandbox", "game");
    fs.mkdirSync(sandboxGame, { recursive: true });
    const base = {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      createdAt: "2026-11-01T00:00:00.000Z",
      apiKeyFingerprint: "f",
    };
    writeSnapshot("snapshot-good", {
      ...base,
      gameId: "vortexaisandbox",
      gamePath: sandboxGame,
      build: exe,
      loginCaptured: true,
    });
    // Written before the build was recorded: tolerated, and ready.
    writeSnapshot("snapshot-old", { ...base, gameId: "vortexaisandbox", gamePath: sandboxGame });
    // Its game folder is gone.
    const gone = path.join(root, "copies", "fallout4");
    writeSnapshot("snapshot-stale", {
      ...base,
      gameId: "fallout4",
      gamePath: gone,
      build: exe,
    });
    fs.mkdirSync(path.join(cacheDir, "snapshot-nomarker"));

    const inventory = readInventory(deps);
    expectNextOnEveryNotReady(inventory);
    expect(byId(inventory, "snapshot:snapshot-good")).toMatchObject({
      ready: true,
      gameId: "vortexaisandbox",
      details: { build: exe, loginCaptured: true },
    });
    expect(byId(inventory, "snapshot:snapshot-good")?.label).toContain("login captured");
    expect(byId(inventory, "snapshot:snapshot-old")).toMatchObject({ ready: true });
    expect(byId(inventory, "snapshot:snapshot-old")?.label).toContain("build not recorded");
    expect(byId(inventory, "snapshot:snapshot-stale")).toMatchObject({
      ready: false,
      next: `doodlebot up --exe ${exe} --game fallout4 --game-path ${gone} --cache-dir ${cacheDir} --rebuild-snapshot`,
    });
    expect(byId(inventory, "snapshot:snapshot-stale")?.label).toContain("is gone");
    expect(byId(inventory, "snapshot:snapshot-nomarker")?.ready).toBe(false);
  });

  it("names a registered release by --release and a missing one by release get", () => {
    updateContent((content) => {
      content.releases.push({
        version: "2.8.0",
        path: path.join(root, "releases", "2.8.0", "app"),
        exe: path.join(root, "releases", "2.8.0", "app", "Vortex.exe"),
        sha256: "0".repeat(64),
        registeredAt: "2026-11-10T10:00:00.000Z",
      });
    }, deps.contentFile);
    deps.source = () => ({
      dir: path.join(root, ".vortex-src"),
      info: { built: false, branch: "fix/x", head: "acb3d86210" },
    });
    const inventory = readInventory(deps);
    expectNextOnEveryNotReady(inventory);
    expect(byId(inventory, "release:2.8.0")).toMatchObject({
      ready: false,
      next: "doodlebot release get 2.8.0",
    });
    expect(byId(inventory, "source")).toMatchObject({
      ready: false,
      next: `doodlebot build --checkout ${path.join(root, ".vortex-src")}`,
      details: { branch: "fix/x", head: "acb3d86210", built: false },
    });
  });

  it("lists a Nexus collection as ready only with a login", () => {
    updateContent((content) => {
      content.collections.push({
        gameId: "stardewvalley",
        slug: "abc123",
        revision: 1,
        installedAt: "2026-11-10T10:00:00.000Z",
      });
    }, deps.contentFile);
    expect(byId(readInventory(deps), "collection:nexus:stardewvalley/abc123")).toMatchObject({
      ready: false,
      next: LOGIN_NEXT,
    });
    fs.writeFileSync(path.join(cacheDir, "oauth-a.json"), "{}");
    expect(byId(readInventory(deps), "collection:nexus:stardewvalley/abc123")?.ready).toBe(true);
  });
});

describe("the choice", () => {
  const item = (fields: Partial<InventoryItem> & { id: string }): InventoryItem => ({
    kind: "game",
    ready: true,
    label: fields.id,
    ...fields,
  });
  const inventory = (items: InventoryItem[]): Inventory => ({ items });
  const sandboxes = [
    item({ id: "sandbox", kind: "sandbox", gameId: "vortexaisandbox" }),
    item({ id: "sandbox:fallout4", kind: "sandbox", gameId: "fallout4" }),
  ];

  it("takes the cheapest: a sandbox before a copy, the smallest copy, offline before Nexus", () => {
    const items = [
      ...sandboxes,
      item({ id: "copy:fallout4:big", gameId: "fallout4", sizeBytes: 90 }),
      item({ id: "copy:fallout4:small", gameId: "fallout4", sizeBytes: 30 }),
      item({ id: "collection:nexus:fallout4/x", kind: "collection" }),
      item({ id: "collection:offline", kind: "collection" }),
      item({ id: "login", kind: "login" }),
    ];
    const choice = chooseContent(
      ["sandbox", "sandbox:fallout4", "game", "game:fallout4", "collection", "collection:nexus"],
      inventory(items),
    );
    expect(choice.met).toBe(true);
    expect(choice.chosen.map((c) => [c.need, c.item.id])).toEqual([
      ["sandbox", "sandbox"],
      ["sandbox:fallout4", "sandbox:fallout4"],
      ["game", "sandbox"],
      ["game:fallout4", "copy:fallout4:small"],
      ["collection", "collection:offline"],
      ["collection:nexus", "collection:nexus:fallout4/x"],
    ]);
    expect(choice.chosen[0]?.why).toMatch(/cheapest/);
  });

  it("missing-need-not-tested: an unmet need is listed with the command that meets it", () => {
    const items = [
      ...sandboxes,
      item({
        id: "store:skyrimse",
        gameId: "skyrimse",
        ready: false,
        next: "doodlebot game copy skyrimse",
      }),
      item({
        id: "collection:nexus:skyrimse/y",
        kind: "collection",
        ready: false,
        next: LOGIN_NEXT,
      }),
      item({ id: "login", kind: "login", ready: false, next: LOGIN_NEXT }),
    ];
    const choice = chooseContent(
      ["sandbox", "game:skyrimse", "game:starfield", "collection:nexus", "login"],
      inventory(items),
    );
    expect(choice.met).toBe(false);
    expect(choice.chosen.map((c) => c.need)).toEqual(["sandbox"]);
    expect(choice.unmet).toEqual([
      expect.objectContaining({ need: "game:skyrimse", next: "doodlebot game copy skyrimse" }),
      expect.objectContaining({
        need: "game:starfield",
        next: "doodlebot game register starfield <dir>",
      }),
      expect.objectContaining({ need: "collection:nexus", next: LOGIN_NEXT }),
      expect.objectContaining({ need: "login", next: LOGIN_NEXT }),
    ]);
    // With the need met, it is chosen.
    const met = chooseContent(["login"], inventory([item({ id: "login", kind: "login" })]));
    expect(met).toMatchObject({ met: true, unmet: [] });
  });

  it("works on a real inventory with nothing registered", () => {
    const choice = chooseContent(["sandbox:fallout4", "collection:offline", "login"], {
      items: readInventory(deps).items,
    });
    expect(choice.chosen.map((c) => c.item.id)).toEqual(["sandbox:fallout4", "collection:offline"]);
    expect(choice.unmet).toEqual([expect.objectContaining({ need: "login", next: LOGIN_NEXT })]);
  });

  it("knows its needs and refuses others", () => {
    for (const need of [
      "sandbox",
      "sandbox:fallout4",
      "game:skyrimse",
      "collection:offline",
      "login",
    ])
      expect(isKnownNeed(need)).toBe(true);
    expect(isKnownNeed("skyrim")).toBe(false);
    expect(() => chooseContent(["my-skyrim"], { items: [] })).toThrow(/Unknown need/);
  });
});
