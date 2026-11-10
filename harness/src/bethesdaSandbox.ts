/**
 * A fake Fallout 4 for testing Vortex's Bethesda-game support without the game.
 *
 * Plugins, LOOT sorting and the Missing Masters check only exist for Bethesda games,
 * and the generic sandbox game has none of them. This builds a disposable game
 * directory that Vortex's own Fallout 4 support accepts. It holds a stand-in
 * executable and generated plugin files with real TES4 headers, so masters parse.
 *
 * A Bethesda game also writes outside its directory: plugins.txt under
 * `%LOCALAPPDATA%\Fallout4`, and INI files and their backups under
 * `Documents\My Games\Fallout4`. Nothing redirects those on a released Vortex, so every launch
 * of the fake Fallout 4 backs up the real folders and `down` restores them (userFolders.ts),
 * as for a registered copy of the game.
 */
import fs from "node:fs";
import path from "node:path";

import type { HarnessConfig } from "./config";
import type { VortexMcpClient } from "./mcpClient";

export interface PluginSpec {
  /** Filename, e.g. "A.esp". */
  name: string;
  /** Plugin filenames this one depends on, in order. */
  masters?: string[];
  /** Set the ESM flag. Implied for a `.esm`. */
  master?: boolean;
  /** Set the ESL (light) flag. Implied for a `.esl`. */
  light?: boolean;
  author?: string;
}

const MASTER_FLAG = 0x1;
const LIGHT_FLAG = 0x200;

function subrecord(tag: string, data: Buffer): Buffer {
  const header = Buffer.alloc(6);
  header.write(tag, 0, 4, "ascii");
  header.writeUInt16LE(data.length, 4);
  return Buffer.concat([header, data]);
}

const zstring = (value: string): Buffer => Buffer.from(`${value}\0`, "latin1");

/**
 * The bytes of a plugin holding only its TES4 header record, which is all Vortex's
 * header reader and LOOT need to know its flags and masters.
 *
 * Layout: a 24-byte record header (`TES4`, data size, flags, form id, version
 * control, form version, unknown), then subrecords of `tag[4] size[2] data`. HEDR
 * is version, record count and next object id; a record count of 0 would mark the
 * plugin as a dummy. Each MAST is followed by an 8-byte DATA, as the game writes it.
 */
export function pluginBytes(spec: PluginSpec): Buffer {
  const ext = path.extname(spec.name).toLowerCase();
  let flags = 0;
  if (spec.master === true || ext === ".esm") flags |= MASTER_FLAG;
  if (spec.light === true || ext === ".esl") flags |= LIGHT_FLAG | MASTER_FLAG;

  const hedr = Buffer.alloc(12);
  hedr.writeFloatLE(1.0, 0);
  hedr.writeUInt32LE(1, 4);
  hedr.writeUInt32LE(0x800, 8);
  const parts = [subrecord("HEDR", hedr), subrecord("CNAM", zstring(spec.author ?? "vortex-mcp"))];
  for (const master of spec.masters ?? []) {
    parts.push(subrecord("MAST", zstring(master)), subrecord("DATA", Buffer.alloc(8)));
  }
  const data = Buffer.concat(parts);

  const header = Buffer.alloc(24);
  header.write("TES4", 0, 4, "ascii");
  header.writeUInt32LE(data.length, 4);
  header.writeUInt32LE(flags, 8);
  header.writeUInt32LE(0, 12);
  header.writeUInt32LE(0, 16);
  header.writeUInt16LE(131, 20); // Fallout 4's form version
  header.writeUInt16LE(0, 22);
  return Buffer.concat([header, data]);
}

export function writePlugin(dir: string, spec: PluginSpec): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, spec.name);
  fs.writeFileSync(file, pluginBytes(spec));
  return file;
}

export interface BethesdaSandbox {
  gameId: "fallout4";
  gamePath: string;
  dataPath: string;
}

/** The sandbox's layout, without creating anything. */
export function bethesdaSandboxPaths(cacheDir: string): BethesdaSandbox {
  const gamePath = path.join(cacheDir, "bethesda-sandbox", "fallout4", "game");
  return { gameId: "fallout4", gamePath, dataPath: path.join(gamePath, "Data") };
}

/**
 * Create the fake game. Idempotent: an existing file is left alone, so mods deployed into it
 * survive a restart.
 */
export function ensureBethesdaSandbox(cacheDir: string): BethesdaSandbox {
  const sandbox = bethesdaSandboxPaths(cacheDir);
  fs.mkdirSync(sandbox.dataPath, { recursive: true });

  const exe = path.join(sandbox.gamePath, "Fallout4.exe");
  if (!fs.existsSync(exe)) fs.writeFileSync(exe, "Vortex automation fixture; not executable.\n");
  // The game's own master: Vortex treats it as always enabled, and LOOT loads its header
  // before sorting anything.
  if (!fs.existsSync(path.join(sandbox.dataPath, "Fallout4.esm"))) {
    writePlugin(sandbox.dataPath, { name: "Fallout4.esm", author: "Bethesda (fixture)" });
  }
  return sandbox;
}

export const FALLOUT4_INI_FILES = ["Fallout4.ini", "Fallout4Prefs.ini", "Fallout4Custom.ini"];

/**
 * Write the Fallout 4 INI files missing from `myGames` (the real `Documents\My Games\Fallout4`).
 * Vortex refuses to activate the game's profile without them. Call it only after that folder
 * is backed up: the files are then the run's, and `down` removes them again. Existing files are
 * left alone. Returns the files written.
 */
export function ensureFallout4Inis(myGames: string): string[] {
  const written: string[] = [];
  for (const ini of FALLOUT4_INI_FILES) {
    const file = path.join(myGames, ini);
    if (fs.existsSync(file)) continue;
    fs.mkdirSync(myGames, { recursive: true });
    fs.writeFileSync(file, "[General]\r\n");
    written.push(file);
  }
  return written;
}

/** Harness config for the fake Fallout 4. */
export function bethesdaSandboxConfig(config: HarnessConfig): HarnessConfig {
  const sandbox = ensureBethesdaSandbox(config.cacheDir);
  return { ...config, gameId: sandbox.gameId, gamePath: sandbox.gamePath };
}

const samePath = (a: string, b: string): boolean =>
  path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/** Whether the config manages the fake Fallout 4 of its cache. */
export function isBethesdaSandbox(config: HarnessConfig): boolean {
  return (
    config.gameId === "fallout4" &&
    config.gamePath !== undefined &&
    samePath(config.gamePath, bethesdaSandboxPaths(config.cacheDir).gamePath)
  );
}

/**
 * Throw unless the running instance's active game is the fake Fallout 4 of `cacheDir`, so a
 * check never seeds plugins into a real game.
 */
export async function assertFakeFallout4Active(
  mcp: VortexMcpClient,
  cacheDir: string,
): Promise<void> {
  const active = await mcp.call<string | null>("vortex_query", { selector: "activeGameId" });
  const discovered = await mcp.call<{ path?: string } | null>("vortex_query", {
    path: ["settings", "gameMode", "discovered", "fallout4"],
  });
  if (
    active !== "fallout4" ||
    discovered?.path === undefined ||
    !samePath(discovered.path, bethesdaSandboxPaths(cacheDir).gamePath)
  ) {
    throw new Error("This check needs the fake Fallout 4: `doodlebot up --bethesda-sandbox`.");
  }
}

// ---------------------------------------------------------------------------
// A deterministic load order
// ---------------------------------------------------------------------------

/** Fallout 4's own plugins, which always load first and in this order. */
export const FALLOUT4_NATIVES = [
  "fallout4.esm",
  "dlcrobot.esm",
  "dlcworkshop01.esm",
  "dlccoast.esm",
  "dlcworkshop02.esm",
  "dlcworkshop03.esm",
  "dlcnukaworld.esm",
  "dlcultrahighresolution.esm",
];

/** An entry of Vortex's `state.loadOrder`, keyed by lower-case plugin id. */
export interface LoadOrderEntry {
  name?: string;
  enabled?: boolean;
  loadOrder?: number;
}

const kindRank = (name: string): number => {
  const ext = path.extname(name).toLowerCase();
  return ext === ".esm" ? 0 : ext === ".esl" ? 1 : 2;
};

/**
 * A load order that depends only on which plugins exist: the game's natives first, then the
 * other masters, light plugins and plugins, each by name. Vortex's own order after a deploy
 * follows the order the files were found, which differs between runs, so the Plugins page's
 * displayed values (index, load order column) could not be compared across builds.
 */
export function deterministicLoadOrder(
  loadOrder: Record<string, LoadOrderEntry>,
  natives: string[] = FALLOUT4_NATIVES,
): string[] {
  const entries = Object.entries(loadOrder).map(([id, entry]) => ({
    id,
    name: entry.name ?? id,
  }));
  const native = (id: string): number => natives.indexOf(id.toLowerCase());
  return entries
    .toSorted((a, b) => {
      const na = native(a.id);
      const nb = native(b.id);
      if (na !== -1 || nb !== -1) return (na === -1 ? Infinity : na) - (nb === -1 ? Infinity : nb);
      return (
        kindRank(a.name) - kindRank(b.name) ||
        a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
        a.id.localeCompare(b.id)
      );
    })
    .map((e) => e.name);
}

export interface LoadOrderResult {
  /** The order applied, by plugin name. */
  order: string[];
  /** Whether `state.loadOrder` reads back in exactly that order. */
  applied: boolean;
}

/**
 * Put the active game's plugins in `deterministicLoadOrder`, with LOOT's automatic sorting off
 * so it stays that way, and check that Vortex's state reads back in that order. Call it after
 * the deploy that registers the plugins. Enabled states are kept (`SET_PLUGIN_ORDER`).
 */
export async function setDeterministicLoadOrder(
  mcp: VortexMcpClient,
  natives: string[] = FALLOUT4_NATIVES,
): Promise<LoadOrderResult> {
  const read = async (): Promise<Record<string, LoadOrderEntry>> =>
    (await mcp.call<Record<string, LoadOrderEntry> | null>("vortex_query", {
      path: ["loadOrder"],
    })) ?? {};
  await mcp.call("vortex_dispatch", {
    action: "type:GAMEBRYO_SET_AUTOSORT_ENABLED",
    args: [false],
  });
  const order = deterministicLoadOrder(await read(), natives);
  await mcp.call("vortex_dispatch", {
    action: "type:SET_PLUGIN_ORDER",
    args: [{ plugins: order, defaultEnable: true }],
  });
  const now = await read();
  const actual = Object.values(now)
    .toSorted((a, b) => (a.loadOrder ?? 0) - (b.loadOrder ?? 0))
    .map((e) => e.name ?? "");
  return {
    order,
    applied: actual.length === order.length && actual.every((name, i) => name === order[i]),
  };
}
