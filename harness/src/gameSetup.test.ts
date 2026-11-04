import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as childProcess from "node:child_process";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ensureGameManaged, findGamePath, KNOWN_GAMES, steamLibraryRoots } from "./gameSetup";
import type { HarnessConfig } from "./config";
import type { VortexMcpClient } from "./mcpClient";

vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFileSync: vi.fn(),
}));

const hostPlatform = process.platform;
let home: string;

beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "doodlebot-steam-roots-")));
  vi.spyOn(os, "homedir").mockReturnValue(home);
  vi.stubGlobal("process", {
    ...process,
    platform: "linux",
    env: { ...process.env, XDG_DATA_HOME: undefined },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});

function client(relative: string) {
  const root = path.join(home, relative);
  fs.mkdirSync(path.join(root, "steamapps"), { recursive: true });
  return root;
}

it.each(["stardewvalley", "standalone-wine-game"])(
  "does not label an unregistered manual %s installation as Steam",
  async (gameId) => {
    const directory = path.join(home, "WinePrefix", "drive_c", "Game");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "Stardew Valley.exe"), "fixture");
    const call = vi.fn(async (_name: string, _args?: unknown) => null);
    await ensureGameManaged({ call } as unknown as VortexMcpClient, gameId, {
      gamePath: directory,
      activate: false,
      config: {} as HarnessConfig,
    });
    const registration = call.mock.calls.find(([name]) => name === "vortex_dispatch")?.[1] as {
      args: [{ result: { store?: string } }];
    };
    expect(registration.args[0].result.store).toBeUndefined();
  },
);

it("keeps Steam identity only for the manifest's actual installation, including secondary libraries", async () => {
  const root = client(".local/share/Steam");
  const extra = client("Secondary Library");
  libraryList(root, "steamapps", [root, extra]);
  const directory = path.join(extra, "steamapps", "common", "Renamed Stardew");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "Stardew Valley.exe"), "fixture");
  fs.writeFileSync(
    path.join(extra, "steamapps", "appmanifest_413150.acf"),
    '"AppState" { "installdir" "Renamed Stardew" }',
  );
  const unrelated = path.join(home, "Copied Stardew");
  fs.mkdirSync(unrelated);
  fs.writeFileSync(path.join(unrelated, "Stardew Valley.exe"), "fixture");
  for (const explicit of [undefined, directory, unrelated]) {
    const call = vi.fn(async (_name: string, _args?: unknown) => null);
    await ensureGameManaged({ call } as unknown as VortexMcpClient, "stardewvalley", {
      gamePath: explicit,
      activate: false,
      config: {} as HarnessConfig,
    });
    const registration = call.mock.calls.find(([name]) => name === "vortex_dispatch")?.[1] as {
      args: [{ result: { store?: string } }];
    };
    expect(registration.args[0].result.store).toBe(explicit === unrelated ? undefined : "steam");
  }
});

it("does not transfer an existing Steam store to a newly selected manual path", async () => {
  const old = path.join(home, "Old Steam Install");
  const directory = path.join(home, "Standalone Install");
  for (const dir of [old, directory]) {
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "Stardew Valley.exe"), "fixture");
  }
  const call = vi.fn(async (name: string, _args?: unknown) =>
    name === "vortex_query" ? { path: old, store: "steam" } : null,
  );
  await ensureGameManaged({ call } as unknown as VortexMcpClient, "stardewvalley", {
    gamePath: directory,
    activate: false,
    config: {} as HarnessConfig,
  });
  const registration = call.mock.calls.find(([name]) => name === "vortex_dispatch")?.[1] as {
    args: [{ result: { store?: string; path: string } }];
  };
  expect(registration.args[0].result.path).toBe(directory);
  expect(registration.args[0].result.store).toBeUndefined();
});

it("preserves an existing non-Steam store while repairing its executable", async () => {
  const directory = path.join(home, "GOG Stardew");
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "Stardew Valley.exe"), "fixture");
  const call = vi.fn(async (name: string, _args?: unknown) =>
    name === "vortex_query" ? { path: directory, store: "gog" } : null,
  );
  await ensureGameManaged({ call } as unknown as VortexMcpClient, "stardewvalley", {
    gamePath: directory,
    activate: false,
    config: {} as HarnessConfig,
  });
  expect(call).toHaveBeenCalledWith("vortex_dispatch", {
    action: "type:ADD_DISCOVERED_GAME",
    args: [{ id: "stardewvalley", result: { executable: "Stardew Valley.exe" } }],
  });
});

it.each([false, true])(
  "records the Windows game executable on Linux (already known: %s)",
  async (alreadyKnown) => {
    const directory = path.join(home, "Windows Stardew");
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, "Stardew Valley.exe"), "Windows game fixture");
    const call = vi.fn(async (name: string, _args?: unknown) =>
      name === "vortex_query" && alreadyKnown ? { path: directory } : null,
    );
    await ensureGameManaged({ call } as unknown as VortexMcpClient, "stardewvalley", {
      gamePath: directory,
      activate: false,
      config: {} as HarnessConfig,
    });
    expect(call).toHaveBeenCalledWith("vortex_dispatch", {
      action: "type:ADD_DISCOVERED_GAME",
      args: [
        expect.objectContaining({
          id: "stardewvalley",
          result: expect.objectContaining({ executable: "Stardew Valley.exe" }),
        }),
      ],
    });
    if (alreadyKnown) {
      expect(call.mock.calls.find(([name]) => name === "vortex_dispatch")?.[1]).toEqual({
        action: "type:ADD_DISCOVERED_GAME",
        args: [{ id: "stardewvalley", result: { executable: "Stardew Valley.exe" } }],
      });
    }
  },
);

it("preserves an explicit executable override in an existing Linux profile", async () => {
  const directory = path.join(home, "Custom Stardew");
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "Stardew Valley.exe"), "Windows game fixture");
  const call = vi.fn(async (_name: string, _args?: unknown) => ({
    path: directory,
    executable: "CustomLauncher.exe",
  }));
  await ensureGameManaged({ call } as unknown as VortexMcpClient, "stardewvalley", {
    gamePath: directory,
    activate: false,
    config: {} as HarnessConfig,
  });
  expect(call).not.toHaveBeenCalledWith("vortex_dispatch", expect.anything());
});

it("does not assign a missing Windows executable to a native Linux installation", async () => {
  const directory = path.join(home, "Native Stardew");
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "StardewValley"), "native game fixture");
  const call = vi.fn(async (_name: string, _args?: unknown) => ({ path: directory }));
  await ensureGameManaged({ call } as unknown as VortexMcpClient, "stardewvalley", {
    activate: false,
    config: {} as HarnessConfig,
  });
  expect(call).not.toHaveBeenCalledWith("vortex_dispatch", expect.anything());
});

it.each(["StardewValley", "Stardew Valley"])(
  "accepts an explicit native Linux installation containing %s",
  async (executable) => {
    const directory = path.join(home, "Native Stardew");
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, executable), "native game fixture");
    const call = vi.fn(async (_name: string, _args?: unknown) => null);
    const managed = await ensureGameManaged(
      { call } as unknown as VortexMcpClient,
      "stardewvalley",
      { gamePath: directory, activate: false, config: {} as HarnessConfig },
    );
    expect(managed.gamePath).toBe(directory);
    expect(call).toHaveBeenCalledWith("vortex_dispatch", {
      action: "type:ADD_DISCOVERED_GAME",
      args: [
        {
          id: "stardewvalley",
          result: {
            path: directory,
            pathSetManually: true,
            timestamp: expect.any(Number),
          },
        },
      ],
    });
  },
);

it.each(["missing", "directory", "windows-native-only"])(
  "rejects an invalid explicit path without falling back to an installed game: %s",
  async (kind) => {
    const root = client(".local/share/Steam");
    const installed = path.join(root, "steamapps", "common", "Stardew Valley");
    fs.mkdirSync(installed, { recursive: true });
    fs.writeFileSync(path.join(installed, "Stardew Valley.exe"), "installed game fixture");
    fs.writeFileSync(
      path.join(root, "steamapps", "appmanifest_413150.acf"),
      '"AppState" { "installdir" "Stardew Valley" }',
    );
    const directory = path.join(home, "Invalid Stardew");
    fs.mkdirSync(directory);
    if (kind === "directory") {
      for (const executable of ["Stardew Valley.exe", "StardewValley", "Stardew Valley"]) {
        fs.mkdirSync(path.join(directory, executable));
      }
    } else if (kind === "windows-native-only") {
      vi.stubGlobal("process", { ...process, platform: "win32" });
      fs.writeFileSync(path.join(directory, "StardewValley"), "native game fixture");
    }
    const call = vi.fn(async (_name: string, _args?: unknown) => ({ path: installed }));
    await expect(
      ensureGameManaged({ call } as unknown as VortexMcpClient, "stardewvalley", {
        gamePath: directory,
        activate: false,
        config: {} as HarnessConfig,
      }),
    ).rejects.toThrow("Invalid explicit game path");
    expect(call).not.toHaveBeenCalled();
  },
);

it("registers a manual Windows installation without inventing its store", async () => {
  vi.stubGlobal("process", { ...process, platform: "win32" });
  const directory = path.join(home, "Windows host Stardew");
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "Stardew Valley.exe"), "Windows game fixture");
  const call = vi.fn(async (_name: string, _args?: unknown) => null);
  await ensureGameManaged({ call } as unknown as VortexMcpClient, "stardewvalley", {
    gamePath: directory,
    activate: false,
    config: {} as HarnessConfig,
  });
  const dispatched = call.mock.calls.find(([name]) => name === "vortex_dispatch")?.[1];
  expect(dispatched).toEqual({
    action: "type:ADD_DISCOVERED_GAME",
    args: [
      {
        id: "stardewvalley",
        result: {
          path: directory,
          pathSetManually: true,
          timestamp: expect.any(Number),
        },
      },
    ],
  });
});

function libraryList(root: string, directory: string, libraries: string[]) {
  fs.mkdirSync(path.join(root, directory), { recursive: true });
  fs.writeFileSync(
    path.join(root, directory, "libraryfolders.vdf"),
    '"libraryfolders"\n{\n' +
      libraries
        .map((library, index) => `"${index}" { "path" ${JSON.stringify(library)} }`)
        .join("\n") +
      "\n}",
  );
}

it.each([
  ".local/share/Steam",
  ".steam/debian-installation",
  ".steam/steam",
  ".steam/root",
  "snap/steam/common/.local/share/Steam",
  ".var/app/com.valvesoftware.Steam/data/Steam",
  ".var/app/com.valvesoftware.Steam/.local/share/Steam",
])("finds the Linux Steam installation at %s", (relative) => {
  const root = client(relative);
  expect(steamLibraryRoots()).toEqual([root]);
});

it("searches absolute XDG data before the default installation and reads extra libraries", () => {
  const custom = client("custom data/Steam");
  const standard = client(".local/share/Steam");
  process.env.XDG_DATA_HOME = path.dirname(custom);
  const extra = path.join(home, "Library with spaces");
  libraryList(custom, "steamapps", [custom, extra]);
  libraryList(standard, "config", [extra]);
  expect(steamLibraryRoots()).toEqual([custom, standard, extra]);
});

it("ignores a relative XDG data setting", () => {
  const standard = client(".local/share/Steam");
  process.env.XDG_DATA_HOME = "relative-data";
  expect(steamLibraryRoots()).toEqual([standard]);
});

it("deduplicates Steam directory aliases by their real installation", () => {
  const actual = client("snap/steam/common/.local/share/Steam");
  const alias = path.join(home, ".steam", "debian-installation");
  fs.mkdirSync(path.dirname(alias), { recursive: true });
  fs.symlinkSync(actual, alias, hostPlatform === "win32" ? "junction" : "dir");
  expect(steamLibraryRoots()).toEqual([actual]);
});

it("deduplicates aliases reintroduced by libraryfolders.vdf", () => {
  const actual = client("snap/steam/common/.local/share/Steam");
  const alias = path.join(home, ".steam", "steam");
  fs.mkdirSync(path.dirname(alias), { recursive: true });
  fs.symlinkSync(actual, alias, hostPlatform === "win32" ? "junction" : "dir");
  libraryList(actual, "steamapps", [alias, actual]);
  expect(steamLibraryRoots()).toEqual([actual]);
});

it("continues to other clients when a library file is unreadable", () => {
  const native = client(".local/share/Steam");
  const snap = client("snap/steam/common/.local/share/Steam");
  const extra = path.join(home, "External Library");
  libraryList(snap, "steamapps", [extra]);
  const read = fs.readFileSync;
  vi.spyOn(fs, "readFileSync").mockImplementation((...args: Parameters<typeof fs.readFileSync>) => {
    if (args[0] === path.join(native, "steamapps", "libraryfolders.vdf")) {
      throw Object.assign(new Error("unreadable client"), { code: "EACCES" });
    }
    return read(...args);
  });
  expect(steamLibraryRoots()).toEqual([native, snap, extra]);
});

it("finds Proton Stardew from Snap manifests and rejects leftover uninstalled directories", () => {
  const root = client("snap/steam/common/.local/share/Steam");
  const game = path.join(root, "steamapps", "common", "Stardew Valley");
  fs.mkdirSync(game, { recursive: true });
  fs.writeFileSync(path.join(game, "Stardew Valley.exe"), "fixture executable");
  expect(findGamePath(KNOWN_GAMES.stardewvalley!)).toBeUndefined();
  fs.writeFileSync(
    path.join(root, "steamapps", "appmanifest_413150.acf"),
    '"AppState" { "installdir" "Stardew Valley" }',
  );
  expect(findGamePath(KNOWN_GAMES.stardewvalley!)).toBe(game);
});

it.each(["StardewValley", "Stardew Valley"])(
  "finds native Stardew containing %s only with its Steam manifest",
  (executable) => {
    const root = client(".local/share/Steam");
    const game = path.join(root, "steamapps", "common", "Stardew Valley");
    fs.mkdirSync(game, { recursive: true });
    fs.writeFileSync(path.join(game, executable), "native game fixture");
    expect(findGamePath(KNOWN_GAMES.stardewvalley!, [root])).toBeUndefined();
    fs.writeFileSync(
      path.join(root, "steamapps", "appmanifest_413150.acf"),
      '"AppState" { "installdir" "Stardew Valley" }',
    );
    expect(findGamePath(KNOWN_GAMES.stardewvalley!, [root])).toBe(game);
    vi.stubGlobal("process", { ...process, platform: "win32" });
    expect(findGamePath(KNOWN_GAMES.stardewvalley!, [root])).toBeUndefined();
  },
);

it("rejects directories named like executables during Steam lookup", () => {
  const root = client(".local/share/Steam");
  const game = path.join(root, "steamapps", "common", "Stardew Valley");
  for (const executable of ["Stardew Valley.exe", "StardewValley", "Stardew Valley"]) {
    fs.mkdirSync(path.join(game, executable), { recursive: true });
  }
  fs.writeFileSync(
    path.join(root, "steamapps", "appmanifest_413150.acf"),
    '"AppState" { "installdir" "Stardew Valley" }',
  );
  expect(findGamePath(KNOWN_GAMES.stardewvalley!, [root])).toBeUndefined();
});

it("rejects an app manifest without the expected game executable", () => {
  const root = client("snap/steam/common/.local/share/Steam");
  fs.mkdirSync(path.join(root, "steamapps", "common", "Stardew Valley"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "steamapps", "appmanifest_413150.acf"),
    '"AppState" { "installdir" "Stardew Valley" }',
  );
  expect(findGamePath(KNOWN_GAMES.stardewvalley!)).toBeUndefined();
});

it.each(["EACCES", "EPERM", "ENOENT"])(
  "continues to the Snap install after an earlier manifest read fails with %s",
  (code) => {
    const native = client(".local/share/Steam");
    const snap = client("snap/steam/common/.local/share/Steam");
    const manifestName = "appmanifest_413150.acf";
    for (const root of [native, snap]) {
      fs.mkdirSync(path.join(root, "steamapps", "common", "Stardew Valley"), { recursive: true });
      fs.writeFileSync(
        path.join(root, "steamapps", manifestName),
        '"AppState" { "installdir" "Stardew Valley" }',
      );
    }
    const game = path.join(snap, "steamapps", "common", "Stardew Valley");
    fs.writeFileSync(path.join(game, "Stardew Valley.exe"), "fixture executable");
    const read = fs.readFileSync;
    vi.spyOn(fs, "readFileSync").mockImplementation(
      (...args: Parameters<typeof fs.readFileSync>) => {
        if (args[0] === path.join(native, "steamapps", manifestName)) {
          throw Object.assign(new Error("earlier manifest unavailable"), { code });
        }
        return read(...args);
      },
    );
    expect(findGamePath(KNOWN_GAMES.stardewvalley!)).toBe(game);
  },
);

it("reports an unexpected manifest I/O failure", () => {
  const root = client(".local/share/Steam");
  const manifest = path.join(root, "steamapps", "appmanifest_413150.acf");
  fs.writeFileSync(manifest, "fixture");
  const read = fs.readFileSync;
  vi.spyOn(fs, "readFileSync").mockImplementation((...args: Parameters<typeof fs.readFileSync>) => {
    if (args[0] === manifest)
      throw Object.assign(new Error("manifest I/O failure"), { code: "EIO" });
    return read(...args);
  });
  expect(() => findGamePath(KNOWN_GAMES.stardewvalley!)).toThrow("manifest I/O failure");
});

it("retains the Windows registry installation and escaped external library paths", () => {
  vi.stubGlobal("process", {
    ...process,
    platform: "win32",
    env: {
      ...process.env,
      "ProgramFiles(x86)": path.join(home, "pf86"),
      ProgramFiles: path.join(home, "pf"),
    },
  });
  const registered = client("Registered Steam");
  const fallback = client("pf86/Steam");
  vi.mocked(childProcess.execFileSync).mockReturnValue(`SteamPath    REG_SZ    ${registered}\r\n`);
  const extra = "D:\\Steam Library";
  libraryList(registered, "steamapps", [extra]);
  expect(steamLibraryRoots()).toEqual([registered, fallback, extra]);
});
