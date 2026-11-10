import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertFakeFallout4Active,
  bethesdaSandboxConfig,
  bethesdaSandboxPaths,
  deterministicLoadOrder,
  ensureBethesdaSandbox,
  ensureFallout4Inis,
  isBethesdaSandbox,
  pluginBytes,
  setDeterministicLoadOrder,
} from "./bethesdaSandbox";
import type { HarnessConfig } from "./config";
import type { VortexMcpClient } from "./mcpClient";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const tempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bethesda-sandbox-"));
  dirs.push(dir);
  return dir;
};

/** Read a plugin's TES4 header the way a Bethesda header reader does. */
function readHeader(bytes: Buffer): { flags: number; masters: string[]; records: number } {
  expect(bytes.toString("ascii", 0, 4)).toBe("TES4");
  const size = bytes.readUInt32LE(4);
  const flags = bytes.readUInt32LE(8);
  const masters: string[] = [];
  let records = -1;
  for (let at = 24; at < 24 + size;) {
    const tag = bytes.toString("ascii", at, at + 4);
    const length = bytes.readUInt16LE(at + 4);
    const data = bytes.subarray(at + 6, at + 6 + length);
    if (tag === "MAST") masters.push(data.toString("latin1", 0, data.length - 1));
    if (tag === "HEDR") records = data.readUInt32LE(4);
    at += 6 + length;
  }
  expect(24 + size).toBe(bytes.length);
  return { flags, masters, records };
}

describe("pluginBytes", () => {
  it("writes masters in order, each with its DATA", () => {
    const bytes = pluginBytes({ name: "A.esp", masters: ["Fallout4.esm", "B.esm"] });
    expect(readHeader(bytes)).toEqual({ flags: 0, masters: ["Fallout4.esm", "B.esm"], records: 1 });
    expect(bytes.includes(Buffer.from("DATA"))).toBe(true);
  });

  it("flags masters and light plugins from the extension", () => {
    expect(readHeader(pluginBytes({ name: "B.esm" })).flags).toBe(0x1);
    expect(readHeader(pluginBytes({ name: "C.esl" })).flags).toBe(0x201);
    expect(readHeader(pluginBytes({ name: "D.esp", light: true })).flags).toBe(0x201);
  });
});

describe("ensureBethesdaSandbox", () => {
  it("creates the game and its master inside the cache, and keeps existing files", () => {
    const cache = tempDir();
    const sandbox = ensureBethesdaSandbox(cache);
    expect(fs.existsSync(path.join(sandbox.gamePath, "Fallout4.exe"))).toBe(true);
    const master = path.join(sandbox.dataPath, "Fallout4.esm");
    expect(readHeader(fs.readFileSync(master)).flags).toBe(1);
    fs.writeFileSync(master, "kept");
    ensureBethesdaSandbox(cache);
    expect(fs.readFileSync(master, "utf8")).toBe("kept");
    expect(fs.readdirSync(path.join(cache, "bethesda-sandbox", "fallout4"))).toEqual(["game"]);
  });

  it("points the config at the fake game, with no redirected folders", () => {
    const cache = tempDir();
    const config = bethesdaSandboxConfig({ cacheDir: cache } as HarnessConfig);
    expect(config.gameId).toBe("fallout4");
    expect(path.relative(cache, config.gamePath ?? "/elsewhere").startsWith("..")).toBe(false);
    expect(Object.keys(config)).not.toContain("profileRedirect");
    expect(isBethesdaSandbox(config)).toBe(true);
    expect(isBethesdaSandbox({ ...config, gamePath: path.join(cache, "elsewhere") })).toBe(false);
    expect(isBethesdaSandbox({ ...config, gameId: "skyrimse" })).toBe(false);
  });
});

describe("ensureFallout4Inis", () => {
  it("writes only the missing INI files, creating the folder", () => {
    const myGames = path.join(tempDir(), "My Games", "Fallout4");
    expect(ensureFallout4Inis(myGames)).toHaveLength(3);
    fs.writeFileSync(path.join(myGames, "Fallout4.ini"), "[Owner]\r\n");
    fs.rmSync(path.join(myGames, "Fallout4Custom.ini"));
    expect(ensureFallout4Inis(myGames)).toEqual([path.join(myGames, "Fallout4Custom.ini")]);
    expect(fs.readFileSync(path.join(myGames, "Fallout4.ini"), "utf8")).toBe("[Owner]\r\n");
  });
});

/** An MCP client reporting the active game and Fallout 4's discovered path. */
const mcp = (active: string | null, discovered: string | undefined) =>
  ({
    call: vi.fn(async (_tool: string, args: { selector?: string }) =>
      args.selector === "activeGameId"
        ? active
        : discovered === undefined
          ? null
          : { path: discovered },
    ),
  }) as unknown as VortexMcpClient;

describe("assertFakeFallout4Active", () => {
  it("accepts the fake game of this cache, in any case", async () => {
    const cache = tempDir();
    const gamePath = bethesdaSandboxPaths(cache).gamePath.toUpperCase();
    await expect(assertFakeFallout4Active(mcp("fallout4", gamePath), cache)).resolves.toBe(
      undefined,
    );
  });

  it("refuses another game, a real Fallout 4 and an unknown path", async () => {
    const cache = tempDir();
    const fake = bethesdaSandboxPaths(cache).gamePath;
    await expect(assertFakeFallout4Active(mcp("skyrimse", fake), cache)).rejects.toThrow(
      /--bethesda-sandbox/,
    );
    await expect(
      assertFakeFallout4Active(mcp("fallout4", "C:\\Games\\Fallout 4"), cache),
    ).rejects.toThrow(/fake Fallout 4/);
    await expect(assertFakeFallout4Active(mcp("fallout4", undefined), cache)).rejects.toThrow();
  });
});

describe("a deterministic load order", () => {
  // As Vortex left it after a deploy: discovery order, which differs run to run.
  const discovered = {
    "zeta.esp": { name: "Zeta.esp", enabled: true, loadOrder: 0 },
    "fallout4.esm": { name: "Fallout4.esm", enabled: true, loadOrder: 1 },
    "alpha.esp": { name: "alpha.esp", enabled: false, loadOrder: 2 },
    "light.esl": { name: "Light.esl", enabled: true, loadOrder: 3 },
    "master.esm": { name: "Master.esm", enabled: true, loadOrder: 4 },
    "dlcrobot.esm": { name: "DLCRobot.esm", enabled: true, loadOrder: 5 },
  };

  it("puts the natives first, then masters, light plugins and plugins by name", () => {
    const expected = [
      "Fallout4.esm",
      "DLCRobot.esm",
      "Master.esm",
      "Light.esl",
      "alpha.esp",
      "Zeta.esp",
    ];
    expect(deterministicLoadOrder(discovered)).toEqual(expected);
    // Any other discovery order gives the same.
    const shuffled = Object.fromEntries(Object.entries(discovered).toReversed());
    expect(deterministicLoadOrder(shuffled)).toEqual(expected);
  });

  it("turns autosort off, applies the order and checks that state reads back in it", async () => {
    let state: Record<string, { name?: string; enabled?: boolean; loadOrder?: number }> = {
      ...discovered,
    };
    const dispatched: unknown[] = [];
    const call = vi.fn(async (tool: string, args: Record<string, unknown>) => {
      if (tool === "vortex_query") return state;
      dispatched.push(args);
      if (args.action === "type:SET_PLUGIN_ORDER") {
        // The gamebryo reducer: replace the order, keeping enabled states.
        const { plugins } = (args.args as [{ plugins: string[] }])[0];
        state = Object.fromEntries(
          plugins.map((name, i) => [
            name.toLowerCase(),
            { name, enabled: state[name.toLowerCase()]?.enabled ?? true, loadOrder: i },
          ]),
        );
      }
      return {};
    });
    const result = await setDeterministicLoadOrder({ call } as unknown as VortexMcpClient);
    expect(result.applied).toBe(true);
    expect(dispatched[0]).toEqual({ action: "type:GAMEBRYO_SET_AUTOSORT_ENABLED", args: [false] });
    expect(state["alpha.esp"]).toMatchObject({ enabled: false, loadOrder: 4 });
  });
});
