/**
 * `doodlebot inventory [--json]`: everything doodlebot could test against on this machine, and
 * the content choice the commands make from it (design 4.5).
 *
 * Each item has an `id`, a `kind`, `ready` and, when not ready, `next`: the exact command that
 * makes it ready. Reading the inventory never launches Vortex and never writes: it reads
 * content.json, the default cache's snapshot markers and login files, Steam's manifests and the
 * managed source checkout.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { SNAPSHOT_SCHEMA_VERSION, readMarker } from "./bootstrap";
import { findInstalledVortex } from "./config";
import { readContent, type Content } from "./content";
import { normalizeVersionResource } from "./releaseFetch";
import { ConfigError } from "./errors";
import { KNOWN_GAMES, USER_FOLDERS, findGamePath } from "./gameSetup";
import { sharedLoginDir, usesSharedLogin } from "./login";
import { CONTENT_FILE, DEFAULT_CACHE_DIR, normalizedPath } from "./paths";
import { gitBranch } from "./runningVortex";
import { hasVortexSource, missingBuildOutputs, vortexSourceDir } from "./source";

export const INVENTORY_KINDS = [
  "build",
  "game",
  "snapshot",
  "sandbox",
  "collection",
  "login",
] as const;

export const inventoryItemSchema = z.object({
  /** Stable within a machine: `release:2.8.0`, `copy:fallout4:<path>`, `sandbox:fallout4`, ... */
  id: z.string(),
  kind: z.enum(INVENTORY_KINDS),
  ready: z.boolean(),
  /**
   * The exact command that makes a not-ready item ready. Present exactly when `ready` is false,
   * except for a store install (`store:<id>`) whose game already has a registered copy on disk:
   * the store install stays unusable, and there is nothing to do (`details.copy` names the copy).
   */
  next: z.string().optional(),
  /** One line for people. */
  label: z.string(),
  /** The game an item is or holds (games, snapshots, sandboxes, collections). */
  gameId: z.string().optional(),
  /** The folder or executable it is. */
  path: z.string().optional(),
  sizeBytes: z.number().optional(),
  /** Free-form facts: the release version, the branch and head, the login captured. */
  details: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
});

export const inventorySchema = z.object({ items: z.array(inventoryItemSchema) });

export type InventoryKind = (typeof INVENTORY_KINDS)[number];
export type InventoryItem = z.infer<typeof inventoryItemSchema>;
export type Inventory = z.infer<typeof inventorySchema>;

export const LOGIN_NEXT = "doodlebot setup --oauth --installed";

export interface SourceInfo {
  built: boolean;
  branch?: string;
  head?: string;
}

export interface InventoryDeps {
  contentFile?: string;
  /** The cache whose snapshots and login are listed; the default cache unless given. */
  cacheDir?: string;
  /**
   * Where the login of a shared-login cache (the default one) is: `~/.doodlebot/login` unless
   * given. Every other cache's login is in the cache itself (login.ts).
   */
  sharedLoginDir?: string;
  installedVortex?: () => string | undefined;
  /** The managed source checkout, or undefined when there is none. */
  source?: () => { dir: string; info: SourceInfo } | undefined;
  /** The store install of a game. */
  storePath?: (gameId: string) => string | undefined;
  exists?: (file: string) => boolean;
}

function managedSource(): { dir: string; info: SourceInfo } | undefined {
  const dir = vortexSourceDir();
  if (!hasVortexSource(dir)) return undefined;
  let head: string | undefined;
  try {
    head = execFileSync("git", ["-C", dir, "rev-parse", "--short=10", "HEAD"], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    head = undefined;
  }
  const branch = gitBranch(dir);
  return {
    dir,
    info: {
      built: missingBuildOutputs(dir).length === 0,
      ...(branch === undefined ? {} : { branch }),
      ...(head === undefined || head === "" ? {} : { head }),
    },
  };
}

const storePathOf = (gameId: string): string | undefined => {
  const game = KNOWN_GAMES[gameId];
  return game === undefined ? undefined : findGamePath(game);
};

/** A command-line argument, quoted when it holds a space. */
const arg = (value: string): string => (/\s/.test(value) ? `"${value}"` : value);

const inside = (child: string, parent: string): boolean => {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

/**
 * A Nexus login is present when an `oauth-*.json` in the folder (the shared login folder, or a
 * cache of its own) holds a login, not the null tombstone.
 */
export function loginPresent(cacheDir: string): boolean {
  let names: string[];
  try {
    names = fs.readdirSync(cacheDir);
  } catch {
    return false;
  }
  return names
    .filter((name) => /^oauth-.*\.json$/i.test(name))
    .some((name) => {
      try {
        const value: unknown = JSON.parse(fs.readFileSync(path.join(cacheDir, name), "utf8"));
        return value !== null && typeof value === "object";
      } catch {
        return false;
      }
    });
}

function buildItems(content: Content, deps: InventoryDeps): InventoryItem[] {
  const exists = deps.exists ?? fs.existsSync;
  const items: InventoryItem[] = content.releases.map((release) => {
    const ready = exists(release.exe);
    return {
      id: `release:${release.version}`,
      kind: "build",
      ready,
      ...(ready ? {} : { next: `doodlebot release get ${release.version}` }),
      label: `Vortex ${release.version} (official release)${ready ? "" : ", missing on disk"}`,
      path: release.exe,
      details: { version: release.version, flag: `--release ${release.version}` },
    };
  });
  const installed = (deps.installedVortex ?? findInstalledVortex)();
  if (installed !== undefined)
    items.push({
      id: "installed",
      kind: "build",
      ready: true,
      label: "the installed Vortex (read-only: never launched while your own Vortex runs)",
      path: installed,
      details: { flag: "--installed" },
    });
  const source = (deps.source ?? managedSource)();
  if (source === undefined)
    items.push({
      id: "source",
      kind: "build",
      ready: false,
      next: "doodlebot source",
      label: "a Vortex source checkout (.vortex-src): not cloned",
    });
  else
    items.push({
      id: "source",
      kind: "build",
      ready: source.info.built,
      ...(source.info.built ? {} : { next: `doodlebot build --checkout ${arg(source.dir)}` }),
      label: [
        `Vortex source at ${source.dir}`,
        ...(source.info.branch === undefined ? [] : [`branch ${source.info.branch}`]),
        ...(source.info.head === undefined ? [] : [`head ${source.info.head}`]),
        ...(source.info.built ? [] : ["not built"]),
      ].join(", "),
      path: source.dir,
      details: {
        built: source.info.built,
        ...(source.info.branch === undefined ? {} : { branch: source.info.branch }),
        ...(source.info.head === undefined ? {} : { head: source.info.head }),
        flag: `--dev-dir ${arg(source.dir)}`,
      },
    });
  return items;
}

/** The games the kit can copy and protect: on Steam and in USER_FOLDERS. */
const copyableGames = (): string[] =>
  Object.keys(KNOWN_GAMES).filter(
    (id) => KNOWN_GAMES[id]?.steamDir !== undefined && USER_FOLDERS[id] !== undefined,
  );

function gameItems(content: Content, deps: InventoryDeps): InventoryItem[] {
  const exists = deps.exists ?? fs.existsSync;
  const items: InventoryItem[] = [];
  const storePath = deps.storePath ?? storePathOf;
  for (const gameId of copyableGames()) {
    const store = storePath(gameId);
    if (store === undefined) continue;
    const executable = KNOWN_GAMES[gameId]!.executable;
    // A registered copy still on disk already makes this game testable: nothing to do.
    const copy = content.games.find(
      (game) => game.gameId === gameId && exists(path.join(game.path, executable)),
    );
    items.push({
      id: `store:${gameId}`,
      kind: "game",
      ready: false,
      ...(copy === undefined ? { next: copyCommand(gameId, content) } : {}),
      label:
        `${KNOWN_GAMES[gameId]!.name}, Steam install: not usable (a store install is never managed)` +
        (copy === undefined ? "" : `; a copy is registered (${copy.path})`),
      gameId,
      path: store,
      ...(copy === undefined ? {} : { details: { copy: copy.path } }),
    });
  }
  for (const registered of content.games) {
    // A copy registered before versions were normalized holds the raw resource text.
    const gameVersion = normalizeVersionResource(registered.gameVersion);
    const copy = { ...registered, ...(gameVersion === undefined ? {} : { gameVersion }) };
    const executable = KNOWN_GAMES[copy.gameId]?.executable;
    const ready = executable === undefined || exists(path.join(copy.path, executable));
    items.push({
      id: `copy:${copy.gameId}:${normalizedPath(copy.path)}`,
      kind: "game",
      ready,
      ...(ready ? {} : { next: copyCommand(copy.gameId, content) }),
      label:
        `${KNOWN_GAMES[copy.gameId]?.name ?? copy.gameId} copy at ${copy.path}` +
        `${copy.gameVersion === undefined ? "" : `, version ${copy.gameVersion}`}` +
        `${ready ? "" : ", missing on disk"}`,
      gameId: copy.gameId,
      path: copy.path,
      sizeBytes: copy.sizeBytes,
      details: {
        flag: `--game ${copy.gameId} --game-path ${arg(copy.path)}`,
        ...(copy.gameVersion === undefined ? {} : { version: copy.gameVersion }),
      },
    });
  }
  return items;
}

/** `game copy <id>`, with `--to <folder>` until a copy folder is stored (copyGame needs one). */
function copyCommand(gameId: string, content: Content): string {
  return content.copyFolder === undefined
    ? `doodlebot game copy ${gameId} --to <folder>`
    : `doodlebot game copy ${gameId}`;
}

/** The flags that select the build a snapshot was made with; empty for an old marker. */
function buildFlags(build: string | undefined, content: Content): string {
  if (build === undefined) return "";
  const release = content.releases.find((r) => normalizedPath(r.exe) === normalizedPath(build));
  if (release !== undefined) return ` --release ${release.version}`;
  return /\.exe$/i.test(build) ? ` --exe ${arg(build)}` : ` --dev-dir ${arg(build)}`;
}

function gameFlags(
  marker: { gameId: string; gamePath: string; gameSkipped?: boolean },
  cacheDir: string,
): string {
  if (marker.gameSkipped === true) return " --no-game";
  if (marker.gameId === "vortexaisandbox") return " --sandbox";
  if (
    marker.gameId === "fallout4" &&
    inside(marker.gamePath, path.join(cacheDir, "bethesda-sandbox"))
  )
    return " --bethesda-sandbox";
  return ` --game ${marker.gameId} --game-path ${arg(marker.gamePath)}`;
}

function snapshotItems(content: Content, deps: InventoryDeps): InventoryItem[] {
  const exists = deps.exists ?? fs.existsSync;
  const cacheDir = deps.cacheDir ?? DEFAULT_CACHE_DIR;
  let names: string[];
  try {
    names = fs
      .readdirSync(cacheDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("snapshot-"))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
  const cacheFlag =
    normalizedPath(cacheDir) === normalizedPath(DEFAULT_CACHE_DIR)
      ? ""
      : ` --cache-dir ${arg(cacheDir)}`;
  return names.map((name): InventoryItem => {
    const dir = path.join(cacheDir, name);
    const marker = readMarker(dir);
    if (marker === undefined)
      return {
        id: `snapshot:${name}`,
        kind: "snapshot",
        ready: false,
        next: `Remove-Item -Recurse ${arg(dir)}`,
        label: `${name}: no marker (an interrupted cold start); delete it, the next start rebuilds it`,
        path: dir,
      };
    const problems = [
      ...(marker.schemaVersion === SNAPSHOT_SCHEMA_VERSION ? [] : ["an older snapshot format"]),
      ...(marker.gameSkipped === true || exists(marker.gamePath)
        ? []
        : [`its game folder ${marker.gamePath} is gone`]),
      ...(marker.build === undefined || exists(marker.build)
        ? []
        : [`its build ${marker.build} is gone`]),
    ];
    const ready = problems.length === 0;
    const flags = `${buildFlags(marker.build, content)}${gameFlags(marker, cacheDir)}${cacheFlag}`;
    return {
      id: `snapshot:${name}`,
      kind: "snapshot",
      ready,
      ...(ready ? {} : { next: `doodlebot up${flags} --rebuild-snapshot` }),
      label:
        `${name}: ${marker.gameSkipped === true ? "no game" : `${marker.gameId} at ${marker.gamePath}`}` +
        `${marker.build === undefined ? ", build not recorded" : `, build ${marker.build}`}` +
        `${marker.loginCaptured === true ? ", login captured" : ""}` +
        `${ready ? "" : ` (stale: ${problems.join("; ")})`}`,
      gameId: marker.gameId,
      path: dir,
      details: {
        createdAt: marker.createdAt,
        loginCaptured: marker.loginCaptured === true,
        flags: flags.trim(),
        ...(marker.build === undefined ? {} : { build: marker.build }),
      },
    };
  });
}

function sandboxItems(): InventoryItem[] {
  return [
    {
      id: "sandbox",
      kind: "sandbox",
      ready: true,
      label: "the fake game (a disposable folder in the cache; install, deploy, purge)",
      gameId: "vortexaisandbox",
      details: { flag: "--sandbox" },
    },
    {
      id: "sandbox:fallout4",
      kind: "sandbox",
      ready: true,
      label:
        "the fake Fallout 4 (plugins, LOOT, Missing Masters); backs up the real Fallout 4 user folders",
      gameId: "fallout4",
      details: { flag: "--bethesda-sandbox" },
    },
  ];
}

function collectionAndLoginItems(content: Content, deps: InventoryDeps): InventoryItem[] {
  const cacheDir = deps.cacheDir ?? DEFAULT_CACHE_DIR;
  const loggedIn = loginPresent(
    usesSharedLogin({ cacheDir }) ? (deps.sharedLoginDir ?? sharedLoginDir()) : cacheDir,
  );
  return [
    {
      id: "collection:offline",
      kind: "collection",
      ready: true,
      label: "offline collections the kit generates (offlineCollection.ts); no account needed",
    },
    ...content.collections.map((collection): InventoryItem => ({
      id: `collection:nexus:${collection.gameId}/${collection.slug}`,
      kind: "collection",
      ready: loggedIn,
      ...(loggedIn ? {} : { next: LOGIN_NEXT }),
      label:
        `Nexus collection ${collection.gameId}/${collection.slug}` +
        `${collection.revision === undefined ? "" : ` revision ${String(collection.revision)}`}` +
        `${loggedIn ? "" : " (needs a Nexus login)"}`,
      gameId: collection.gameId,
    })),
    {
      id: "login",
      kind: "login",
      ready: loggedIn,
      ...(loggedIn ? {} : { next: LOGIN_NEXT }),
      label: loggedIn ? "a Nexus login is cached" : "no Nexus login cached",
    },
  ];
}

/** Everything doodlebot could test against, read without launching or writing anything. */
export function readInventory(deps: InventoryDeps = {}): Inventory {
  const content = readContent(deps.contentFile ?? CONTENT_FILE);
  return {
    items: [
      ...buildItems(content, deps),
      ...gameItems(content, deps),
      ...snapshotItems(content, deps),
      ...sandboxItems(),
      ...collectionAndLoginItems(content, deps),
    ],
  };
}

export function formatInventory(inventory: Inventory): string {
  const lines: string[] = [];
  for (const kind of INVENTORY_KINDS) {
    const items = inventory.items.filter((item) => item.kind === kind);
    if (items.length === 0) continue;
    lines.push(`${kind}:`);
    for (const item of items) {
      lines.push(`  ${item.ready ? "ready    " : "not ready"}  ${item.id}`);
      lines.push(`             ${item.label}`);
      if (item.next !== undefined) lines.push(`             next: ${item.next}`);
      else if (!item.ready && item.details?.copy !== undefined)
        lines.push(`             a copy is registered: ${String(item.details.copy)}`);
    }
  }
  return lines.join("\n");
}

/** `doodlebot inventory [--json]`. */
export function inventoryCommand(
  flags: Record<string, string | boolean>,
  deps: InventoryDeps = {},
): string {
  const inventory = readInventory({
    ...deps,
    ...(typeof flags["cache-dir"] === "string" ? { cacheDir: flags["cache-dir"] } : {}),
  });
  return flags.json === true ? JSON.stringify(inventory, null, 2) : formatInventory(inventory);
}

// ---------------------------------------------------------------------------
// The choice
// ---------------------------------------------------------------------------

/**
 * A need names an inventory kind and quality, never a named game or collection:
 * `sandbox` (either fake game, the plain one first), `sandbox:fallout4`, `game` (any game the kit
 * may manage: a sandbox, then a registered copy), `game:<id>` (a registered copy of that game),
 * `collection` (offline first), `collection:offline`, `collection:nexus`, and `login`.
 */
const NEED =
  /^(?:sandbox|sandbox:fallout4|game|game:[a-z0-9]+|collection(?::offline|:nexus)?|login)$/;

export function isKnownNeed(need: string): boolean {
  return NEED.test(need);
}

export interface Chosen {
  need: string;
  item: InventoryItem;
  /** Why this item, for the report's "Tested against" line. */
  why: string;
}

export interface Unmet {
  need: string;
  /** The command that would meet it. */
  next: string;
  reason: string;
}

export interface Choice {
  /** True when every need is met; otherwise the run is "not tested". */
  met: boolean;
  chosen: Chosen[];
  unmet: Unmet[];
}

const bySize = (a: InventoryItem, b: InventoryItem): number =>
  (a.sizeBytes ?? Number.MAX_SAFE_INTEGER) - (b.sizeBytes ?? Number.MAX_SAFE_INTEGER);

const isCopy = (item: InventoryItem): boolean =>
  item.kind === "game" && item.id.startsWith("copy:");

/** Every item that could meet `need`, cheapest first (4.5's order), ready or not. */
function candidates(need: string, items: InventoryItem[]): InventoryItem[] {
  const sandboxes = items.filter((item) => item.kind === "sandbox");
  const copies = (gameId?: string) =>
    items.filter((item) => isCopy(item) && (gameId === undefined || item.gameId === gameId));
  const readyFirst = (list: InventoryItem[]) => [
    ...list.filter((item) => item.ready).sort(bySize),
    ...list.filter((item) => !item.ready),
  ];
  const offline = items.filter((item) => item.id === "collection:offline");
  const nexus = items.filter((item) => item.id.startsWith("collection:nexus:"));
  if (need === "sandbox") return sandboxes;
  if (need === "sandbox:fallout4") return sandboxes.filter((item) => item.gameId === "fallout4");
  if (need === "game") return [...sandboxes, ...readyFirst(copies())];
  if (need.startsWith("game:")) return readyFirst(copies(need.slice("game:".length)));
  if (need === "collection") return [...offline, ...nexus];
  if (need === "collection:offline") return offline;
  if (need === "collection:nexus") return nexus;
  if (need === "login") return items.filter((item) => item.kind === "login");
  return [];
}

function unmetFor(need: string, options: InventoryItem[], items: InventoryItem[]): Unmet {
  const blocked = options.find((item) => item.next !== undefined);
  if (blocked !== undefined)
    return { need, next: blocked.next!, reason: `${blocked.id} is not ready: ${blocked.label}` };
  if (need.startsWith("game:")) {
    const gameId = need.slice("game:".length);
    const store = items.find((item) => item.id === `store:${gameId}`);
    if (store !== undefined)
      return { need, next: store.next!, reason: `no registered copy of ${gameId}` };
    return {
      need,
      next: `doodlebot game register ${gameId} <dir>`,
      reason: `no registered copy of ${gameId}, and no Steam install to copy`,
    };
  }
  if (need === "collection:nexus") {
    const login = items.find((item) => item.kind === "login");
    if (login !== undefined && !login.ready)
      return { need, next: LOGIN_NEXT, reason: "no Nexus login, and no Nexus collection recorded" };
    return {
      need,
      next: "doodlebot collection <collection-url>",
      reason: "no Nexus collection is recorded in content.json",
    };
  }
  if (need === "login") return { need, next: LOGIN_NEXT, reason: "no Nexus login cached" };
  return { need, next: "doodlebot inventory", reason: `nothing in the inventory meets ${need}` };
}

/**
 * The content a run uses: for each need, the cheapest ready item that meets it (sandbox, then a
 * registered copy, the smallest first; an offline collection before a Nexus one). A need nothing
 * meets is listed with the command that would meet it, and the run is then "not tested".
 */
export function chooseContent(needs: string[], inventory: Inventory): Choice {
  const chosen: Chosen[] = [];
  const unmet: Unmet[] = [];
  for (const need of needs) {
    if (!isKnownNeed(need)) throw new ConfigError(`Unknown need "${need}".`);
    const options = candidates(need, inventory.items);
    const item = options.find((candidate) => candidate.ready);
    if (item === undefined) {
      unmet.push(unmetFor(need, options, inventory.items));
      continue;
    }
    const skipped = options.indexOf(item);
    chosen.push({
      need,
      item,
      why:
        options.length === 1
          ? `the only item that meets ${need}`
          : skipped === 0
            ? `the cheapest of ${String(options.length)} items that meet ${need}`
            : `the cheapest ready item that meets ${need} (${String(skipped)} cheaper not ready)`,
    });
  }
  return { met: unmet.length === 0, chosen, unmet };
}
