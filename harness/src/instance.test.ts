import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadConfig, type HarnessConfig } from "./config";
import {
  buildInstanceEnv,
  launchStdio,
  launchVortex,
  registerLaunchedProcess,
  stdioLogFile,
  stopInstance,
  stopRunningInstance,
  stopStaleInstance,
} from "./instance";
import { VortexMcpClient } from "./mcpClient";
import { DEFAULT_CACHE_DIR, USER_STATE_DIR } from "./paths";
import { processAlive } from "./processes";
import {
  INSTANCE_RECORD,
  readInstanceRecord,
  writeInstanceRecord,
  type InstanceRecord,
} from "./runningVortex";

// The one instance record lives in ~/.doodlebot, and an older kit's in the default cache: keep
// both in temporary folders.
vi.mock("./paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./paths")>();
  const nodeFs = await import("node:fs");
  const nodeOs = await import("node:os");
  const nodePath = await import("node:path");
  return {
    ...actual,
    USER_STATE_DIR: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "doodlebot-record-")),
    DEFAULT_CACHE_DIR: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "doodlebot-cache-")),
  };
});
// Node children stand in for Vortex, so they must pass the image check.
vi.mock("./processes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./processes")>()),
  processImageName: vi.fn(() => "electron.exe"),
}));

let dir: string;
let checkout: string;
const children: ChildProcess[] = [];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-instance-test-"));
  checkout = path.join(dir, "vx-ab");
  fs.mkdirSync(checkout);
});

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
  }
  fs.rmSync(INSTANCE_RECORD, { recursive: true, force: true });
  fs.rmSync(LEGACY_RECORD, { force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(USER_STATE_DIR, { recursive: true, force: true });
  fs.rmSync(DEFAULT_CACHE_DIR, { recursive: true, force: true });
});

/** Where the one record lived before it moved to ~/.doodlebot. */
const LEGACY_RECORD = path.join(DEFAULT_CACHE_DIR, "instance.json");

function devConfig(overrides: Partial<HarnessConfig> = {}): HarnessConfig {
  return loadConfig({
    target: {
      kind: "dev",
      executable: path.join(checkout, "electron.exe"),
      args: [path.join(checkout, "src", "main")],
      appName: "@vortex/main",
      sourceDir: checkout,
    },
    cacheDir: path.join(dir, "cache"),
    ...overrides,
  });
}

function installedConfig(overrides: Partial<HarnessConfig> = {}): HarnessConfig {
  return loadConfig({
    target: { kind: "installed", executable: "Vortex.exe", args: [], appName: "Vortex" },
    cacheDir: path.join(dir, "cache"),
    ...overrides,
  });
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** A config whose "Vortex" is a Node process that idles, writing its pid to `pidFile`. */
async function nodeLaunchConfig(pidFile: string): Promise<HarnessConfig> {
  const script = `require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
  return installedConfig({
    target: {
      kind: "installed",
      executable: process.execPath,
      // "--" keeps the --remote-debugging-port the launcher appends away from Node's options.
      args: ["-e", script, "--"],
      appName: "Vortex",
    },
    gameId: "fallout4",
    mcpPort: await freePort(),
    cdpPort: await freePort(),
  });
}

function idleChild(): ChildProcess {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
    windowsHide: true,
  });
  children.push(child);
  return child;
}

function record(
  pid: number,
  cacheDir: string,
  extra: Partial<InstanceRecord> = {},
): InstanceRecord {
  return {
    pid,
    startedAt: new Date().toISOString(),
    cacheDir,
    userDataDir: path.join(cacheDir, "live"),
    mcpPort: 3701,
    ...extra,
  };
}

const noMcp = { call: vi.fn(async () => undefined) } as unknown as VortexMcpClient;

describe("buildInstanceEnv", () => {
  it("launches a --production source build with NODE_ENV=production, not without one", () => {
    // A plain `pnpm run build` inlines "development" into main.cjs, so main never sets
    // production itself; deleting NODE_ENV left the renderer on React's development build.
    const previous = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      expect(buildInstanceEnv(dir, devConfig({ production: true })).NODE_ENV).toBe("production");
      expect(buildInstanceEnv(dir, devConfig({ production: false })).NODE_ENV).toBe("development");
      process.env.NODE_ENV = "development";
      expect(buildInstanceEnv(dir, devConfig({ production: true })).NODE_ENV).toBe("production");
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it("leaves a released build's NODE_ENV alone", () => {
    const previous = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      expect(buildInstanceEnv(dir, installedConfig({ production: true })).NODE_ENV).toBeUndefined();
    } finally {
      if (previous !== undefined) process.env.NODE_ENV = previous;
    }
  });

  it("keeps the API key out of Vortex's environment unless it is in use", () => {
    const saved = {
      a: process.env.VORTEX_AI_NEXUS_API_KEY,
      b: process.env.NEXUS_API_KEY,
    };
    process.env.VORTEX_AI_NEXUS_API_KEY = "secret-from-harness-env";
    process.env.NEXUS_API_KEY = "secret-too";
    try {
      // A sandbox run withholds the key (localOnlyConfig); harness/.env still loaded it.
      const withheld = buildInstanceEnv(
        dir,
        devConfig({ apiKey: undefined, apiKeyWithheld: true }),
      );
      expect(withheld.VORTEX_AI_NEXUS_API_KEY).toBeUndefined();
      expect(withheld.NEXUS_API_KEY).toBeUndefined();
      expect(Object.values(withheld)).not.toContain("secret-from-harness-env");
      // --with-api-key (or a non-sandbox run) keeps it.
      const kept = buildInstanceEnv(dir, devConfig({ apiKey: "secret-from-harness-env" }));
      expect(kept.VORTEX_AI_NEXUS_API_KEY).toBe("secret-from-harness-env");
    } finally {
      for (const [key, value] of [
        ["VORTEX_AI_NEXUS_API_KEY", saved.a],
        ["NEXUS_API_KEY", saved.b],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe("the instance record at launch", () => {
  it("is written right after spawn, before readiness, and cleared when a failed launch's child has exited", async () => {
    const pidFile = path.join(dir, "child.pid");
    const config = await nodeLaunchConfig(pidFile);
    const userDataDir = path.join(config.cacheDir, "live");
    let seen: InstanceRecord | undefined;
    let spawnedPid: number | undefined;
    await expect(
      launchVortex({
        userDataDir,
        config,
        onProcessSpawn: (child) => {
          spawnedPid = child.pid;
          seen = readInstanceRecord();
          throw new Error("observer failed");
        },
      }),
    ).rejects.toThrow("observer failed");
    expect(seen).toMatchObject({
      pid: spawnedPid,
      cacheDir: config.cacheDir,
      userDataDir,
      mcpPort: config.mcpPort,
      // A released build is recorded by its executable, so a restart can tell builds apart.
      exe: process.execPath,
    });
    expect(seen).not.toHaveProperty("sourceDir");
    expect(processAlive(spawnedPid!)).toBe(false);
    expect(readInstanceRecord()).toBeUndefined();
  });

  it("fails the launch, stopping the child, when the record cannot be written", async () => {
    // A folder where the record belongs makes the write throw.
    fs.mkdirSync(INSTANCE_RECORD, { recursive: true });
    const pidFile = path.join(dir, "child.pid");
    const config = await nodeLaunchConfig(pidFile);
    const observer = vi.fn();
    await expect(
      launchVortex({
        userDataDir: path.join(config.cacheDir, "live"),
        config,
        onProcessSpawn: observer,
      }),
    ).rejects.toThrow();
    expect(observer).not.toHaveBeenCalled();
    // The child has exited by the time the launch rejects, whether or not it got as far as
    // writing its pid.
    if (fs.existsSync(pidFile))
      expect(processAlive(Number(fs.readFileSync(pidFile, "utf8")))).toBe(false);
  });

  it("refuses a launch while another harness Vortex runs, before spawning anything", async () => {
    writeInstanceRecord(record(process.pid, path.join(dir, "other-cache")));
    const config = await nodeLaunchConfig(path.join(dir, "child.pid"));
    const userDataDir = path.join(config.cacheDir, "live");
    await expect(launchVortex({ userDataDir, config })).rejects.toThrow(
      `A harness Vortex is running (pid ${String(process.pid)}, cache ${path.join(dir, "other-cache")}); run \`doodlebot down\` before starting Vortex.`,
    );
    expect(fs.existsSync(stdioLogFile(userDataDir))).toBe(false);
    expect(readInstanceRecord()?.pid).toBe(process.pid);
  });

  it("settles the exact child before rejecting a failed spawn observer", async () => {
    const child = idleChild();
    writeInstanceRecord(record(child.pid!, path.join(dir, "cache")));
    await expect(
      registerLaunchedProcess(child, {
        onProcessSpawn: () => {
          throw new Error("shared game registration failed");
        },
      }),
    ).rejects.toThrow("shared game registration failed");
    expect(processAlive(child.pid!)).toBe(false);
    expect(readInstanceRecord()).toBeUndefined();
  });
});

describe("stopping", () => {
  it("clears the record after a confirmed exit of the launched child", async () => {
    const child = idleChild();
    writeInstanceRecord(record(child.pid!, path.join(dir, "cache")));
    await stopInstance(child, noMcp, { force: true, timeoutMs: 100 });
    expect(processAlive(child.pid!)).toBe(false);
    expect(readInstanceRecord()).toBeUndefined();
  });

  it("keeps the record when the child does not exit, or the record names another launch", async () => {
    const child = idleChild();
    writeInstanceRecord(record(child.pid!, path.join(dir, "cache")));
    await expect(stopInstance(child, noMcp, { timeoutMs: 100 })).rejects.toThrow(
      /did not exit cleanly/,
    );
    expect(readInstanceRecord()?.pid).toBe(child.pid);

    writeInstanceRecord(record(process.pid, path.join(dir, "cache")));
    await stopInstance(child, noMcp, { force: true, timeoutMs: 100 });
    expect(readInstanceRecord()?.pid).toBe(process.pid);
  });

  it("down waits for this cache's recorded Vortex without signalling it, then clears the record", async () => {
    const config = installedConfig({ mcpPort: await freePort() });
    const child = idleChild();
    writeInstanceRecord(record(child.pid!, config.cacheDir));
    const stopping = stopStaleInstance(config);
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(processAlive(child.pid!)).toBe(true);
    expect(readInstanceRecord()?.pid).toBe(child.pid);
    // Its window is closed by hand.
    child.kill("SIGKILL");
    await expect(stopping).resolves.toBe(false);
    expect(readInstanceRecord()).toBeUndefined();
  }, 15_000);

  it("up's stop of its own cache leaves another cache's running Vortex and its record alone", async () => {
    const config = installedConfig({ mcpPort: await freePort() });
    writeInstanceRecord(record(process.pid, path.join(dir, "other-cache")));
    await expect(stopStaleInstance(config)).resolves.toBe(false);
    expect(readInstanceRecord()?.pid).toBe(process.pid);
  });

  it("up never quits another live cache's Vortex, even one whose cache lies inside its own", async () => {
    const config = installedConfig({ mcpPort: await freePort() });
    const nested = path.join(config.cacheDir, "zoom-signed-out");
    writeInstanceRecord(record(process.pid, nested));
    const ping = vi.spyOn(VortexMcpClient.prototype, "ping").mockResolvedValue(true);
    const call = vi
      .spyOn(VortexMcpClient.prototype, "call")
      .mockImplementation(async (name: string) =>
        name === "automation_status" ? { userDataDir: path.join(nested, "live") } : undefined,
      );
    try {
      await expect(stopStaleInstance(config)).rejects.toThrow(
        /belongs to a different Vortex profile/,
      );
      expect(call.mock.calls.map(([name]) => name)).toEqual(["automation_status"]);
      expect(readInstanceRecord()?.pid).toBe(process.pid);
    } finally {
      ping.mockRestore();
      call.mockRestore();
    }
  });

  it("down follows the record to another cache and port, saying so, then clears it", async () => {
    const config = installedConfig({ mcpPort: await freePort() });
    const otherCache = path.join(dir, "other-cache");
    const otherPort = await freePort();
    const child = idleChild();
    writeInstanceRecord(record(child.pid!, otherCache, { mcpPort: otherPort }));
    const messages: string[] = [];
    const stopping = stopRunningInstance(config, (message) => messages.push(message));
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(messages).toEqual([
      `Stopping the harness Vortex from an unrecorded build (pid ${String(child.pid)}).`,
      `Stopping the harness Vortex of cache ${otherCache} (MCP port ${String(otherPort)}).`,
    ]);
    // It waits on that cache's pid without signalling it.
    expect(processAlive(child.pid!)).toBe(true);
    child.kill("SIGKILL");
    await expect(stopping).resolves.toBe(false);
    expect(readInstanceRecord()).toBeUndefined();
  }, 15_000);

  it("down names the checkout the running Vortex comes from before stopping it", async () => {
    const config = installedConfig({ mcpPort: await freePort() });
    const child = idleChild();
    writeInstanceRecord(record(child.pid!, config.cacheDir, { sourceDir: checkout }));
    const messages: string[] = [];
    const stopping = stopRunningInstance(config, (message) => messages.push(message));
    await new Promise((resolve) => setTimeout(resolve, 500));
    child.kill("SIGKILL");
    await stopping;
    // Not a git checkout, so no branch is named.
    expect(messages).toEqual([
      `Stopping the harness Vortex from ${checkout} (pid ${String(child.pid)}).`,
    ]);
  }, 15_000);

  it("down without a live record stops only this cache, silently", async () => {
    const config = installedConfig({ mcpPort: await freePort() });
    const messages: string[] = [];
    await expect(stopRunningInstance(config, (m) => messages.push(m))).resolves.toBe(false);
    expect(messages).toEqual([]);
  });

  it("down clears a stale record", async () => {
    const config = installedConfig({ mcpPort: await freePort() });
    writeInstanceRecord(record(2 ** 30, config.cacheDir));
    await expect(stopStaleInstance(config)).resolves.toBe(false);
    expect(fs.existsSync(INSTANCE_RECORD)).toBe(false);
  });

  it("deletes the legacy per-cache instance.pid and instance.json", async () => {
    const config = installedConfig({ mcpPort: await freePort() });
    fs.mkdirSync(config.cacheDir, { recursive: true });
    const legacyPid = path.join(config.cacheDir, "instance.pid");
    const legacyRecord = path.join(config.cacheDir, "instance.json");
    fs.writeFileSync(legacyPid, String(2 ** 30));
    fs.writeFileSync(legacyRecord, JSON.stringify({ pid: 2 ** 30, leases: [] }));
    await stopStaleInstance(config);
    expect(fs.existsSync(legacyPid)).toBe(false);
    expect(fs.existsSync(legacyRecord)).toBe(false);

    // The default cache's instance.json was the one record of an older kit; an old-format one goes.
    fs.writeFileSync(LEGACY_RECORD, JSON.stringify({ pid: 2 ** 30, leases: [] }));
    await stopStaleInstance(
      installedConfig({ cacheDir: DEFAULT_CACHE_DIR, mcpPort: config.mcpPort }),
    );
    expect(fs.existsSync(LEGACY_RECORD)).toBe(false);
  });
});

describe("the record of an older doodlebot in the default cache", () => {
  it("is the per-user record's predecessor, not the record itself", () => {
    expect(INSTANCE_RECORD).toBe(path.join(USER_STATE_DIR, "instance.json"));
    expect(LEGACY_RECORD).not.toBe(INSTANCE_RECORD);
  });

  it("is deleted when stale (stopStaleInstance, as up and bootstrap call it)", async () => {
    const config = installedConfig({ mcpPort: await freePort() });
    fs.writeFileSync(LEGACY_RECORD, JSON.stringify(record(2 ** 30, DEFAULT_CACHE_DIR)));
    await expect(stopStaleInstance(config)).resolves.toBe(false);
    expect(fs.existsSync(LEGACY_RECORD)).toBe(false);
  });

  it("refuses a launch while it names a running Vortex (launchVortex)", async () => {
    fs.writeFileSync(LEGACY_RECORD, JSON.stringify(record(process.pid, DEFAULT_CACHE_DIR)));
    const config = await nodeLaunchConfig(path.join(dir, "child.pid"));
    const userDataDir = path.join(config.cacheDir, "live");
    await expect(launchVortex({ userDataDir, config })).rejects.toThrow(
      `A harness Vortex from an older doodlebot is running (pid ${String(process.pid)}); stop it before starting Vortex.`,
    );
    expect(fs.existsSync(stdioLogFile(userDataDir))).toBe(false);
    expect(fs.existsSync(LEGACY_RECORD)).toBe(true);
    expect(readInstanceRecord()).toBeUndefined();
  });

  it("refuses down while it names a running Vortex (stopRunningInstance)", async () => {
    fs.writeFileSync(LEGACY_RECORD, JSON.stringify(record(process.pid, DEFAULT_CACHE_DIR)));
    const config = installedConfig({ mcpPort: await freePort() });
    await expect(stopRunningInstance(config, () => undefined)).rejects.toThrow(
      `A harness Vortex from an older doodlebot is running (pid ${String(process.pid)}); stop it before stopping Vortex.`,
    );
    expect(fs.existsSync(LEGACY_RECORD)).toBe(true);
  });
});

describe("launching detached", () => {
  it("never hands Vortex this process's stdio", () => {
    expect(launchStdio(undefined)).toEqual({
      stdio: ["ignore", "ignore", "ignore"],
      detached: true,
      windowsHide: false,
    });
    expect(launchStdio(7).stdio).toEqual(["ignore", 7, 7]);
  });

  it("lets a caller reading the launcher's output finish while the launched process runs", async () => {
    // The launcher spawns a long-lived child the way launchVortex does, then exits. Whoever
    // reads the launcher's stdout (a shell with `*>`, a tool) must see it close at once.
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-launch-"));
    const log = path.join(work, "child.log");
    const launcher = path.join(work, "launcher.mjs");
    fs.writeFileSync(
      launcher,
      `import { spawn } from "node:child_process";
import fs from "node:fs";
const fd = fs.openSync(${JSON.stringify(log)}, "w");
const shape = ${JSON.stringify(launchStdio(-1))};
shape.stdio = shape.stdio.map((s) => (s === -1 ? fd : s));
const child = spawn(process.execPath, ["-e", "console.log('child up'); setTimeout(() => {}, 20000)"], shape);
fs.closeSync(fd);
child.unref();
console.log(String(child.pid));
`,
    );
    const started = Date.now();
    const parent = spawn(process.execPath, [launcher], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    parent.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    // "close" fires only when every holder of the pipe's write end has gone.
    await new Promise<void>((resolve) => parent.stdout.once("close", () => resolve()));
    const childPid = Number(out.trim());
    try {
      expect(Date.now() - started).toBeLessThan(10_000);
      expect(() => process.kill(childPid, 0)).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(fs.readFileSync(log, "utf8")).toContain("child up");
    } finally {
      try {
        process.kill(childPid);
      } catch {
        // already gone
      }
    }
  }, 20_000);
});
