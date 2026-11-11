import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  bootstrap,
  buildChanged,
  captureLogin,
  liveDir,
  loginDir,
  readLastBuild,
  readMarker,
  snapshotDir,
} from "./bootstrap";
import { assertNoOwnVortex, windowsOnlyWarning } from "./ownVortex";
import { assertGamePathAllowed } from "./gameCommand";
import { protectUserFolders, settlePendingRestores, userFoldersOf } from "./userFolders";
import { bethesdaSandboxPaths } from "./bethesdaSandbox";
import type { HarnessConfig } from "./config";
import { requireOAuth } from "./auth";
import { authCacheFile, launchVortex, stopStaleInstance } from "./instance";
import { ensureGameManaged, waitForGameStartup } from "./gameSetup";
import { USER_STATE_DIR } from "./paths";
import { INSTANCE_RECORD, readInstanceRecord, writeInstanceRecord } from "./runningVortex";
import { checkoutBuildIdentity, clearBuildRecord, writeBuildRecord } from "./productionMode";

// The one instance record lives in ~/.doodlebot; keep it in a temporary folder, and let this
// process stand in for a running Vortex.
vi.mock("./paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./paths")>();
  const nodeFs = await import("node:fs");
  const nodeOs = await import("node:os");
  const nodePath = await import("node:path");
  return {
    ...actual,
    USER_STATE_DIR: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "bootstrap-state-")),
  };
});
vi.mock("./processes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./processes")>()),
  processImageName: vi.fn(() => "electron.exe"),
}));

vi.mock("./gameSetup", () => ({
  ensureGameManaged: vi.fn(
    async (_mcp: unknown, gameId: string, { gamePath }: { gamePath: string }) => ({
      gameId,
      gamePath,
      activated: true,
      alreadyKnown: false,
    }),
  ),
  waitForGameStartup: vi.fn(async () => true),
}));

// The protections reach the machine (its processes, the owner's folders, content.json); their
// own tests cover them. Here only their place in the launch is checked.
vi.mock("./ownVortex", () => ({
  assertNoOwnVortex: vi.fn(),
  windowsOnlyWarning: vi.fn((): string | undefined => undefined),
}));
vi.mock("./gameCommand", () => ({ assertGamePathAllowed: vi.fn() }));
vi.mock("./userFolders", () => ({
  protectUserFolders: vi.fn(async () => undefined),
  settlePendingRestores: vi.fn(async () => undefined),
  userFolderRoots: vi.fn(() => ({ documents: "", localAppData: "", roamingAppData: "" })),
  userFoldersOf: vi.fn(() => []),
}));

vi.mock("./auth", () => ({
  requireOAuth: vi.fn(async () => ({ oauthPresent: true, oauthRefreshable: true })),
}));

// captureLogin stops the running instance before copying, because Vortex only
// flushes state on a clean close. Nothing is running in a unit test, so the
// stop is stubbed out; what is under test is what ends up in the snapshot.
vi.mock("./instance", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./instance")>()),
  stopStaleInstance: vi.fn(async () => false),
  ensureExtensionBuilt: vi.fn(async () => "unit fixture"),
  installMcpExtension: vi.fn(),
  launchVortex: vi.fn(async ({ config }: { config: HarnessConfig }) => ({
    mcp: {
      call: vi.fn(async (_tool: string, args: { path?: string[] }) =>
        args?.path?.includes("discovered") ? { path: config.gamePath } : { oauthPresent: true },
      ),
    },
    stop: vi.fn(async () => undefined),
  })),
}));

const roots: string[] = [];

function fakeConfig(): HarnessConfig {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-ai-bootstrap-"));
  roots.push(cacheDir);
  const config = {
    cacheDir,
    gameId: "fallout4",
    gamePath: "C:/Games/Fallout 4",
    apiKey: "test-key",
    target: { kind: "installed", appName: "Vortex", executable: "C:/Vortex/Vortex.exe", args: [] },
  } as unknown as HarnessConfig;
  fs.mkdirSync(liveDir(config), { recursive: true });
  fs.writeFileSync(
    path.join(liveDir(config), ".vortex-ai-snapshot.json"),
    JSON.stringify({ snapshotKey: path.basename(snapshotDir(config, "test-key")) }),
  );
  return config;
}

afterEach(() => {
  vi.clearAllMocks();
  fs.rmSync(INSTANCE_RECORD, { force: true });
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
afterAll(() => fs.rmSync(USER_STATE_DIR, { recursive: true, force: true }));

function liveRecord(cacheDir: string, exe = "C:/Vortex/Vortex.exe") {
  return {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    cacheDir,
    userDataDir: path.join(cacheDir, "live"),
    mcpPort: 3701,
    exe,
  };
}

describe("one harness Vortex per machine", () => {
  it("refuses while another cache's Vortex runs, before stopping or launching anything", async () => {
    const config = fakeConfig();
    const otherCache = path.join(os.tmpdir(), "another-workspace", "harness", ".cache");
    const other = liveRecord(otherCache);
    writeInstanceRecord(other);
    await expect(bootstrap(config, { fresh: true })).rejects.toThrow(
      `A harness Vortex is running (pid ${String(process.pid)}, cache ${otherCache}); run \`doodlebot down\` before starting Vortex.`,
    );
    expect(stopStaleInstance).not.toHaveBeenCalled();
    expect(launchVortex).not.toHaveBeenCalled();
    expect(readInstanceRecord()).toEqual(other);
  });

  it("restarts this cache's own running Vortex as before", async () => {
    const config = fakeConfig();
    // The same cache spelled differently still counts as the same.
    writeInstanceRecord(liveRecord(`${config.cacheDir}${path.sep}`));
    const result = await bootstrap(config, { fresh: true });
    expect(stopStaleInstance).toHaveBeenCalledWith(config);
    expect(launchVortex).toHaveBeenCalled();
    await result.instance.stop();
  });

  it("refuses to stop this cache's leftover of another build, naming it", async () => {
    const config = fakeConfig();
    const other = liveRecord(config.cacheDir, "C:/releases/2.7.1/app/Vortex.exe");
    writeInstanceRecord(other);
    await expect(bootstrap(config, { fresh: true })).rejects.toThrow(
      `A harness Vortex of another build is running from C:/releases/2.7.1/app/Vortex.exe (pid ${String(process.pid)}); run \`doodlebot down\` before starting Vortex.`,
    );
    expect(stopStaleInstance).not.toHaveBeenCalled();
    expect(readInstanceRecord()).toEqual(other);
  });

  it("checks the game, restores the leftover's folders, then checks for the owner's Vortex, then backs up", async () => {
    const config = fakeConfig();
    writeInstanceRecord(liveRecord(config.cacheDir));
    const progress: string[] = [];
    // Off Windows the launch says the protections are Windows-only (the mock plays Linux).
    vi.mocked(windowsOnlyWarning).mockReturnValueOnce(
      "warning: on linux doodlebot cannot see your own Vortex",
    );
    const result = await bootstrap(config, { fresh: true, onProgress: (m) => progress.push(m) });
    expect(progress).toContain("warning: on linux doodlebot cannot see your own Vortex");
    const order = (mock: unknown) => vi.mocked(mock as () => void).mock.invocationCallOrder[0]!;
    expect(order(assertGamePathAllowed)).toBeLessThan(order(stopStaleInstance));
    expect(order(stopStaleInstance)).toBeLessThan(order(settlePendingRestores));
    expect(settlePendingRestores).toHaveBeenCalledWith(expect.objectContaining({ clean: true }));
    expect(order(settlePendingRestores)).toBeLessThan(order(assertNoOwnVortex));
    expect(order(assertNoOwnVortex)).toBeLessThan(order(protectUserFolders));
    expect(order(protectUserFolders)).toBeLessThan(order(launchVortex));
    await result.instance.stop();
  });

  it("backs up the fake Fallout 4's real folders on a released build, then writes its INI files", async () => {
    const config = fakeConfig();
    const fake = { ...config, gamePath: bethesdaSandboxPaths(config.cacheDir).gamePath };
    const myGames = path.join(config.cacheDir, "real", "My Games", "Fallout4");
    vi.mocked(userFoldersOf).mockReturnValueOnce([myGames, path.join(config.cacheDir, "local")]);
    vi.mocked(protectUserFolders).mockImplementationOnce(async (gameId) => {
      expect(fs.existsSync(myGames)).toBe(false);
      return { gameId, backupDir: path.join(config.cacheDir, "backup"), startedAt: "now" };
    });
    const result = await bootstrap(fake, { fresh: true });
    expect(protectUserFolders).toHaveBeenCalledWith("fallout4", config.cacheDir);
    expect(fs.readdirSync(myGames).toSorted()).toEqual(
      ["Fallout4.ini", "Fallout4Custom.ini", "Fallout4Prefs.ini"].toSorted(),
    );
    expect(vi.mocked(protectUserFolders).mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(launchVortex).mock.invocationCallOrder[0]!,
    );
    await result.instance.stop();
  });

  it("settles a dead leftover's restore as unclean", async () => {
    const config = fakeConfig();
    await bootstrap(config, { fresh: true });
    expect(settlePendingRestores).toHaveBeenCalledWith(expect.objectContaining({ clean: false }));
  });

  it("starts fresh when the build differs from the last launch on this cache", async () => {
    const config = fakeConfig();
    await bootstrap(config, { fresh: true });
    expect(readLastBuild(config.cacheDir)).toBe("C:/Vortex/Vortex.exe");
    expect(buildChanged(readLastBuild(config.cacheDir), "C:\\Vortex\\Vortex.exe")).toBe(false);
    expect(buildChanged(readLastBuild(config.cacheDir), "C:/releases/2.8.0/Vortex.exe")).toBe(true);
    expect(buildChanged(undefined, "C:/Vortex/Vortex.exe")).toBe(false);
    const messages: string[] = [];
    await bootstrap(
      { ...config, target: { ...config.target, executable: "C:/releases/2.8.0/Vortex.exe" } },
      { onProgress: (m) => messages.push(m) },
    );
    expect(messages).toContain(
      "the build changed since the last launch on this cache (C:/Vortex/Vortex.exe); starting fresh",
    );
    expect(messages).toContain("seeding the working directory from the snapshot");
  });
});

describe("a stale source build (stale-build-refused)", { timeout: 60_000 }, () => {
  /** A built git checkout of Vortex whose build record matches it. */
  function builtCheckout(): string {
    const checkout = fs.mkdtempSync(path.join(os.tmpdir(), "bootstrap-checkout-"));
    roots.push(checkout);
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8", windowsHide: true });
    git("init", "-q", "-b", "master");
    git("config", "core.autocrlf", "false");
    fs.writeFileSync(path.join(checkout, ".gitignore"), "src/main/build/\n");
    fs.mkdirSync(path.join(checkout, "src", "main", "build"), { recursive: true });
    fs.writeFileSync(path.join(checkout, "src", "main", "index.ts"), "export {};\n");
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-qm", "base");
    const identity = checkoutBuildIdentity(checkout)!;
    for (const name of ["main.cjs", "renderer.js"])
      fs.writeFileSync(path.join(checkout, "src", "main", "build", name), "built\n");
    writeBuildRecord(checkout, identity, "development");
    return checkout;
  }
  function devConfig(checkout: string): HarnessConfig {
    const config = fakeConfig();
    config.target = {
      kind: "dev",
      executable: "electron.exe",
      args: [path.join(checkout, "src", "main")],
      appName: "@vortex/main",
      sourceDir: checkout,
    };
    return config;
  }

  it("launches a build whose record matches, without a warning", async () => {
    const progress: string[] = [];
    const result = await bootstrap(devConfig(builtCheckout()), {
      fresh: true,
      onProgress: (m) => progress.push(m),
    });
    expect(progress.filter((m) => /build record|stale/.test(m))).toEqual([]);
    await result.instance.stop();
  });

  it("refuses an edit after the build, naming the file, before launching anything", async () => {
    const checkout = builtCheckout();
    fs.writeFileSync(path.join(checkout, "src", "main", "index.ts"), "export const x = 1;\n");
    await expect(bootstrap(devConfig(checkout), { fresh: true })).rejects.toThrow(
      /the checkout has changed since \(1 file, for example src\/main\/index\.ts\)\. Run `doodlebot build --checkout /,
    );
    expect(launchVortex).not.toHaveBeenCalled();
  });

  it("launches it with --stale-ok and says so", async () => {
    const checkout = builtCheckout();
    fs.writeFileSync(path.join(checkout, "src", "main", "index.ts"), "export const x = 1;\n");
    const progress: string[] = [];
    const result = await bootstrap(devConfig(checkout), {
      fresh: true,
      staleOk: true,
      onProgress: (m) => progress.push(m),
    });
    expect(progress).toContainEqual(
      expect.stringMatching(/^warning: launching a stale build \(--stale-ok\): The build is from/),
    );
    expect(launchVortex).toHaveBeenCalled();
    await result.instance.stop();
  });

  it("warns, and launches, when there is no build record", async () => {
    const checkout = builtCheckout();
    clearBuildRecord(checkout);
    const progress: string[] = [];
    const result = await bootstrap(devConfig(checkout), {
      fresh: true,
      onProgress: (m) => progress.push(m),
    });
    expect(progress).toContainEqual(expect.stringContaining("has no doodlebot build record"));
    expect(launchVortex).toHaveBeenCalled();
    await result.instance.stop();
  });
});
describe("cold game management", () => {
  beforeEach(() => {
    vi.mocked(waitForGameStartup).mockResolvedValue(true);
  });

  it("flushes the registered private path before canonical startup, waits, and leaves target args unchanged", async () => {
    const config = fakeConfig();
    const result = await bootstrap(config, { fresh: true });
    const launches = vi.mocked(launchVortex).mock.calls;
    expect(launches).toHaveLength(3);
    expect(vi.mocked(ensureGameManaged).mock.calls[0]![2].activate).toBe(false);
    const first = await vi.mocked(launchVortex).mock.results[0]!.value;
    expect(vi.mocked(first.stop).mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(launchVortex).mock.invocationCallOrder[1]!,
    );
    expect(launches[1]![0].config.target.args).toEqual(["--game", "fallout4"]);
    expect(vi.mocked(waitForGameStartup).mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(ensureGameManaged).mock.invocationCallOrder[1]!,
    );
    expect(config.target.args).toEqual([]);
    expect(readMarker(snapshotDir(config, "test-key"))?.gameId).toBe("fallout4");
    // The marker names the build it was made with, for the inventory.
    expect(readMarker(snapshotDir(config, "test-key"))?.build).toBe("C:/Vortex/Vortex.exe");
    await result.instance.stop();
  });

  it.each(["--game=other", "--profile", "--game"])(
    "rejects conflicting %s before launching",
    async (arg) => {
      const config = fakeConfig();
      config.target.args = [arg];
      await expect(bootstrap(config, { fresh: true })).rejects.toThrow(/cannot override/);
      expect(launchVortex).not.toHaveBeenCalled();
    },
  );

  it("does not publish a snapshot or start a live session when activation fails", async () => {
    const config = fakeConfig();
    vi.mocked(waitForGameStartup).mockRejectedValueOnce(new Error("activation failed"));
    await expect(bootstrap(config, { fresh: true })).rejects.toThrow("activation failed");
    expect(launchVortex).toHaveBeenCalledTimes(2);
    expect(readMarker(snapshotDir(config, "test-key"))).toBeUndefined();
    const second = await vi.mocked(launchVortex).mock.results[1]!.value;
    expect(second.stop).toHaveBeenCalledTimes(1);
  });

  it("does not enter the normal management path or publish a snapshot before native activation finishes", async () => {
    const config = fakeConfig();
    let activate!: (value: boolean) => void;
    const pendingActivation = new Promise<boolean>((resolve) => {
      activate = resolve;
    });
    vi.mocked(waitForGameStartup).mockImplementationOnce(() => pendingActivation);
    const starting = bootstrap(config, { fresh: true });
    await vi.waitFor(() => expect(waitForGameStartup).toHaveBeenCalledTimes(1));
    expect(ensureGameManaged).toHaveBeenCalledTimes(1);
    expect(readMarker(snapshotDir(config, "test-key"))).toBeUndefined();
    activate(true);
    const result = await starting;
    expect(ensureGameManaged).toHaveBeenCalledTimes(2);
    expect(readMarker(snapshotDir(config, "test-key"))).toBeDefined();
    await result.instance.stop();
  });

  it("does not start the management phase after a failed registration-phase shutdown", async () => {
    const config = fakeConfig();
    const normalLaunch = vi.mocked(launchVortex).getMockImplementation()!;
    vi.mocked(launchVortex).mockImplementationOnce(async (options) => {
      const instance = await normalLaunch(options);
      vi.mocked(instance.stop).mockRejectedValueOnce(new Error("still running"));
      return instance;
    });
    await expect(bootstrap(config, { fresh: true })).rejects.toThrow("still running");
    expect(launchVortex).toHaveBeenCalledTimes(1);
    expect(waitForGameStartup).not.toHaveBeenCalled();
    expect(readMarker(snapshotDir(config, "test-key"))).toBeUndefined();
  });

  it("retains registration and shutdown errors and never launches the management phase", async () => {
    const config = fakeConfig();
    const original = new Error("registration failed");
    const cleanup = new Error("shutdown failed");
    vi.mocked(ensureGameManaged).mockRejectedValueOnce(original);
    vi.mocked(launchVortex).mockResolvedValueOnce({
      mcp: { call: vi.fn(async () => ({ oauthPresent: true })) },
      stop: vi.fn(async () => {
        throw cleanup;
      }),
    } as never);
    const failure = await bootstrap(config, { fresh: true }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([original, cleanup]);
    expect((failure as Error).cause).toBe(original);
    expect(launchVortex).toHaveBeenCalledTimes(1);
    expect(readMarker(snapshotDir(config, "test-key"))).toBeUndefined();
  });

  it("rejects a game activated at a different path without correcting it or caching it", async () => {
    const config = fakeConfig();
    const normalLaunch = vi.mocked(launchVortex).getMockImplementation()!;
    vi.mocked(launchVortex)
      .mockImplementationOnce(normalLaunch)
      .mockImplementationOnce(async (options) => {
        const instance = await normalLaunch(options);
        vi.mocked(instance.mcp.call).mockResolvedValue({ path: "C:/Wrong/Real Game" });
        return instance;
      });
    await expect(bootstrap(config, { fresh: true })).rejects.toThrow(/different game path/);
    expect(ensureGameManaged).toHaveBeenCalledTimes(1);
    expect(readMarker(snapshotDir(config, "test-key"))).toBeUndefined();
  });

  it("keeps no-game bootstrap to one cold launch and one live launch", async () => {
    const config = fakeConfig();
    const result = await bootstrap(config, { fresh: true, skipGame: true });
    expect(launchVortex).toHaveBeenCalledTimes(2);
    expect(waitForGameStartup).not.toHaveBeenCalled();
    expect(ensureGameManaged).not.toHaveBeenCalled();
    expect(readMarker(snapshotDir(config, "test-key", true))?.gameSkipped).toBe(true);
    await result.instance.stop();
  });
});

describe("the Nexus login of a cache", () => {
  it("never seeds a test cache: it starts with no login, and the shared login is untouched", async () => {
    const config = fakeConfig();
    const sharedDir = path.join(USER_STATE_DIR, "login");
    fs.mkdirSync(sharedDir, { recursive: true });
    const sharedFile = path.join(sharedDir, path.basename(authCacheFile(config)));
    fs.writeFileSync(sharedFile, JSON.stringify({ token: "t", refreshToken: "r" }));
    try {
      expect(authCacheFile(config)).toBe(path.join(config.cacheDir, path.basename(sharedFile)));
      const result = await bootstrap(config, { fresh: true });
      expect(fs.existsSync(authCacheFile(config))).toBe(false);
      expect(fs.readFileSync(sharedFile, "utf8")).toBe(
        JSON.stringify({ token: "t", refreshToken: "r" }),
      );
      await result.instance.stop();
    } finally {
      fs.rmSync(sharedDir, { recursive: true, force: true });
    }
  });

  it("puts a test cache's signed-out marker in that cache only", () => {
    const config = fakeConfig();
    fs.writeFileSync(authCacheFile(config), "null");
    expect(fs.readdirSync(config.cacheDir)).toContain(path.basename(authCacheFile(config)));
    expect(fs.existsSync(path.join(USER_STATE_DIR, "login"))).toBe(false);
  });
});

describe("real copied game preservation", () => {
  it.each([false, true])(
    "preserveGameFixture=%s retains masters only when explicitly requested",
    async (preserveGameFixture) => {
      const config = fakeConfig();
      config.gamePath = path.join(config.cacheDir, "game");
      const data = path.join(config.gamePath, "Data");
      fs.mkdirSync(data, { recursive: true });
      fs.writeFileSync(path.join(data, "Skyrim.esm"), "copied game master fixture bytes");
      fs.writeFileSync(
        path.join(data, "Skyrim - Textures.bsa"),
        "copied game archive fixture bytes",
      );
      fs.writeFileSync(authCacheFile(config), "null");
      await bootstrap(config, { fresh: true, preserveGameFixture });
      expect(fs.existsSync(path.join(data, "Skyrim.esm"))).toBe(preserveGameFixture);
      expect(fs.existsSync(path.join(data, "Skyrim - Textures.bsa"))).toBe(preserveGameFixture);
      if (preserveGameFixture)
        expect(fs.readFileSync(path.join(data, "Skyrim.esm"), "utf8")).toBe(
          "copied game master fixture bytes",
        );
    },
  );
});

describe("captureLogin", () => {
  it("promotes the working directory and records that a login was captured", async () => {
    const config = fakeConfig();
    const live = liveDir(config);
    fs.mkdirSync(path.join(live, "userData"), { recursive: true });
    // Stands in for whatever Vortex wrote — the point is that it is copied
    // wholesale, never read, so the credential stays opaque to this code.
    fs.writeFileSync(path.join(live, "userData", "state.db"), "opaque-bytes");

    await captureLogin(config);

    const snapshot = snapshotDir(config, "test-key");
    expect(fs.readFileSync(path.join(snapshot, "userData", "state.db"), "utf8")).toBe(
      "opaque-bytes",
    );
    expect(readMarker(snapshot)?.loginCaptured).toBe(true);
    expect(readMarker(loginDir(config))?.loginCaptured).toBe(true);
  });

  it("replaces an earlier snapshot rather than merging into it", async () => {
    // A merge would leave files from the pre-login snapshot behind, which is
    // how a "captured" login ends up half-applied and failing much later.
    const config = fakeConfig();
    const snapshot = snapshotDir(config, "test-key");
    fs.mkdirSync(path.join(snapshot, "userData"), { recursive: true });
    fs.writeFileSync(path.join(snapshot, "userData", "stale.txt"), "from the old snapshot");

    const live = liveDir(config);
    fs.mkdirSync(path.join(live, "userData"), { recursive: true });
    fs.writeFileSync(path.join(live, "userData", "fresh.txt"), "signed in");

    await captureLogin(config);

    expect(fs.existsSync(path.join(snapshot, "userData", "fresh.txt"))).toBe(true);
    expect(fs.existsSync(path.join(snapshot, "userData", "stale.txt"))).toBe(false);
  });

  it("refuses when there is no working directory to capture", async () => {
    await expect(captureLogin(fakeConfig())).rejects.toThrow(/no working directory/i);
  });

  it("does not stop or copy an unsigned profile", async () => {
    const config = fakeConfig();
    fs.mkdirSync(path.join(liveDir(config), "userData"));
    vi.mocked(requireOAuth).mockRejectedValueOnce(new Error("OAuth setup incomplete"));
    await expect(captureLogin(config)).rejects.toThrow("OAuth setup incomplete");
    expect(stopStaleInstance).not.toHaveBeenCalled();
    expect(fs.existsSync(loginDir(config))).toBe(false);
  });

  it("refuses while another cache's Vortex runs, before asking it for a login or stopping it", async () => {
    const config = fakeConfig();
    fs.mkdirSync(path.join(liveDir(config), "userData"));
    const otherCache = path.join(os.tmpdir(), "another-workspace", "harness", ".cache");
    const other = liveRecord(otherCache);
    writeInstanceRecord(other);
    await expect(captureLogin(config)).rejects.toThrow(
      `A harness Vortex is running (pid ${String(process.pid)}, cache ${otherCache}); run \`doodlebot down\` before saving the login.`,
    );
    expect(requireOAuth).not.toHaveBeenCalled();
    expect(stopStaleInstance).not.toHaveBeenCalled();
    expect(fs.existsSync(loginDir(config))).toBe(false);
    expect(readInstanceRecord()).toEqual(other);
  });

  it("saves the login of this cache's own running Vortex", async () => {
    const config = fakeConfig();
    fs.mkdirSync(path.join(liveDir(config), "userData"));
    writeInstanceRecord(liveRecord(`${config.cacheDir}${path.sep}`));
    await captureLogin(config);
    expect(stopStaleInstance).toHaveBeenCalledWith(config);
    expect(readMarker(loginDir(config))?.loginCaptured).toBe(true);
  });

  it("preserves the previous login when clean shutdown fails", async () => {
    const config = fakeConfig();
    fs.mkdirSync(path.join(liveDir(config), "userData"));
    fs.mkdirSync(loginDir(config));
    fs.writeFileSync(path.join(loginDir(config), "sentinel"), "previous login");
    vi.mocked(stopStaleInstance).mockRejectedValueOnce(new Error("did not exit cleanly"));
    await expect(captureLogin(config)).rejects.toThrow("did not exit cleanly");
    expect(fs.readFileSync(path.join(loginDir(config), "sentinel"), "utf8")).toBe("previous login");
  });
});
