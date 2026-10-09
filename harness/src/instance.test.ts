import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadConfig, type HarnessConfig } from "./config";
import { instanceResource } from "./slots";
import {
  attachedLeaseResources,
  buildInstanceEnv,
  claimInstanceLease,
  forgetLaunchedPid,
  instanceLeaseResources,
  launchStdio,
  recordLaunchedPid,
  registerLaunchedProcess,
} from "./instance";
import {
  LeaseHeldError,
  acquireLease,
  checkoutResource,
  processAlive,
  readLease,
  releaseLease,
  type LeaseEnv,
} from "./lease";
import { claimOperations, operationResource } from "./operations";

let dir: string;
let checkout: string;
let alive: Set<number>;
let env: LeaseEnv;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-instance-test-"));
  checkout = path.join(dir, "vx-ab");
  fs.mkdirSync(checkout);
  alive = new Set([process.pid, 1001, 1002, 4242]);
  env = { dir: path.join(dir, "leases"), isAlive: (pid) => alive.has(pid) };
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

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
    owner: "kit-agent2",
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

describe("the leases a running Vortex needs", () => {
  // Each cache's instance has a lease of its own (slots.ts); these configs share one cache.
  const instance = (): string => instanceResource(installedConfig().cacheDir);

  it("are the instance alone for a released build, and the checkout too for a source build", () => {
    expect(instanceLeaseResources(installedConfig())).toEqual([instance()]);
    expect(instanceLeaseResources(devConfig())).toEqual([instance(), checkoutResource(checkout)]);
  });

  it("refuse a launch from a checkout another owner has locked, holding nothing", () => {
    // The observed hole: one agent rebuilt vx-ab while another ran Vortex from it.
    acquireLease(checkoutResource(checkout), "rebuilder", { ...env, pid: 1001 });
    expect(() => claimInstanceLease(devConfig(), "launch Vortex", env)).toThrow(LeaseHeldError);
    // The instance it took first was given back.
    expect(readLease(instance(), env)).toBeUndefined();
  });

  it("lock the checkout while Vortex runs from it, after the launching command exits", () => {
    const config = devConfig();
    const hold = claimInstanceLease(config, "launch Vortex", env);
    recordLaunchedPid(hold.identities, 4242, env);
    hold.release();
    // `up` has exited; its Vortex still holds both.
    for (const resource of [instance(), checkoutResource(checkout)]) {
      expect(readLease(resource, env)).toMatchObject({
        live: true,
        lease: { owner: "kit-agent2" },
      });
    }
    expect(() =>
      acquireLease(checkoutResource(checkout), "rebuilder", { ...env, pid: 1002 }),
    ).toThrow(/held by "kit-agent2"/);
    forgetLaunchedPid(hold.identities, 4242, env);
    expect(readLease(checkoutResource(checkout), env)).toBeUndefined();
    expect(readLease(instance(), env)).toBeUndefined();
  });

  it.each(["kit-agent2", "other"])(
    "launch bookkeeping retains its acquisition across replacement by %s",
    (owner) => {
      const config = devConfig();
      const original = claimInstanceLease(config, "old launch", env);
      for (const identity of original.identities)
        releaseLease(identity.resource, identity.owner, { ...env, force: true });
      const successor = claimInstanceLease(devConfig({ owner }), "new launch", env);
      recordLaunchedPid(successor.identities, 4242, env);
      const before = successor.identities.map(({ resource }) => readLease(resource, env)!.lease);
      expect(() => recordLaunchedPid(original.identities, 1001, env)).toThrow(
        /Lost .* acquisition/,
      );
      forgetLaunchedPid(original.identities, 4242, env);
      original.release();
      expect(successor.identities.map(({ resource }) => readLease(resource, env)!.lease)).toEqual(
        before,
      );
      forgetLaunchedPid(successor.identities, 4242, env);
      successor.release();
    },
  );

  it("awaits an exact child after partial registration fails and preserves the successor", async () => {
    env = { dir: path.join(dir, "leases"), isAlive: processAlive };
    const config = devConfig();
    const original = claimInstanceLease(config, "launch", env);
    const operation = claimOperations(instanceLeaseResources(config), config.owner!, {
      leaseEnv: env,
    });
    const resource = checkoutResource(checkout);
    releaseLease(resource, config.owner!, { ...env, force: true });
    const successor = acquireLease(resource, "successor", env).lease;
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
      windowsHide: true,
    });
    try {
      await expect(
        registerLaunchedProcess(child, original.identities, {
          leaseEnv: env,
          context: operation.context,
        }),
      ).rejects.toThrow(/Lost .* acquisition/);
      expect(processAlive(child.pid!)).toBe(false);
      expect(readLease(resource, env)!.lease).toEqual(successor);
      expect(readLease(instance(), env)!.lease.instancePids).toEqual([]);
      for (const guarded of operation.context.resources)
        expect(readLease(operationResource(guarded), env)!.lease.holders).toEqual([process.pid]);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited;
      }
      operation.release();
      original.release();
    }
  });

  it("settles the exact child before rejecting a failed spawn observer", async () => {
    env = { dir: path.join(dir, "leases"), isAlive: processAlive };
    const config = devConfig();
    const hold = claimInstanceLease(config, "observed launch", env);
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
      windowsHide: true,
    });
    try {
      await expect(
        registerLaunchedProcess(child, hold.identities, {
          leaseEnv: env,
          onProcessSpawn: () => {
            throw new Error("shared game lease registration failed");
          },
        }),
      ).rejects.toThrow("shared game lease registration failed");
      expect(processAlive(child.pid!)).toBe(false);
      for (const identity of hold.identities)
        expect(readLease(identity.resource, env)!.lease.instancePids).toEqual([]);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGKILL");
        await exited;
      }
      hold.release();
    }
  });

  it("for a command attaching to a running Vortex, are its checkout, not the configured one", () => {
    const config = installedConfig();
    expect(attachedLeaseResources(config)).toEqual([instance()]);
    // Written by the launch: this process stands in for the running Vortex.
    fs.mkdirSync(config.cacheDir, { recursive: true });
    fs.writeFileSync(
      path.join(config.cacheDir, "instance.json"),
      JSON.stringify({ pid: process.pid, sourceDir: checkout }),
    );
    expect(attachedLeaseResources(config)).toEqual([instance(), checkoutResource(checkout)]);
    acquireLease(checkoutResource(checkout), "rebuilder", { ...env, pid: 1001 });
    expect(() =>
      claimInstanceLease(config, "ai:test:collection-scale", env, { attach: true }),
    ).toThrow(LeaseHeldError);
    // A Vortex that has exited no longer ties the command to its checkout.
    fs.writeFileSync(
      path.join(config.cacheDir, "instance.json"),
      JSON.stringify({ pid: 2 ** 30, sourceDir: checkout }),
    );
    expect(attachedLeaseResources(config)).toEqual([instance()]);
  });

  it("join a checkout lock the same owner already holds, and take the instance with it", () => {
    acquireLease(checkoutResource(checkout), "kit-agent2", {
      ...env,
      mode: "explicit",
      ttlMinutes: 60,
    });
    const hold = claimInstanceLease(devConfig(), "launch Vortex", env);
    expect(hold.joined).toBe(false);
    expect(readLease(instance(), env)?.lease.owner).toBe("kit-agent2");
    // A second owner is now refused the instance as well as the checkout.
    expect(() => claimInstanceLease(devConfig({ owner: "other" }), "launch Vortex", env)).toThrow(
      LeaseHeldError,
    );
    hold.release();
    expect(readLease(checkoutResource(checkout), env)?.lease.mode).toBe("explicit");
  });

  it("let two caches, two agents' slots, run a Vortex each without refusing one another", () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-ai-slot-"));
    try {
      const mine = claimInstanceLease(installedConfig({ owner: "kit-agent2" }), "up", env);
      const theirs = claimInstanceLease(
        installedConfig({ owner: "other", cacheDir: other }),
        "up",
        env,
      );
      expect(readLease(instance(), env)?.lease.owner).toBe("kit-agent2");
      expect(readLease(instanceResource(other), env)?.lease.owner).toBe("other");
      theirs.release();
      mine.release();
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
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
