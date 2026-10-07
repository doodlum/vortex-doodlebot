import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  INSTANCE_RESOURCE,
  LeaseHeldError,
  acquireLease,
  acquireLeases,
  addInstancePid,
  addHolder,
  checkoutResource,
  dropHolder,
  holdLease,
  listLeases,
  readLease,
  releaseLease,
  releaseOwnerLeases,
  removeInstancePid,
  resolveOwner,
  waitForLease,
  withLeases,
  withLeaseMutex,
  type LeaseEnv,
} from "./lease";
import { runUnderLease } from "./leaseCommand";
import { claimOperations } from "./operations";

let dir: string;
let alive: Set<number>;
let now: number;
let env: LeaseEnv;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-lease-test-"));
  alive = new Set([process.pid, 1001, 1002]);
  now = Date.parse("2026-09-24T10:00:00Z");
  env = { dir, isAlive: (pid) => alive.has(pid), now: () => now };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("acquireLease", () => {
  it("takes a free lease and records owner, holder and purpose", () => {
    const result = acquireLease(INSTANCE_RESOURCE, "qa", { ...env, pid: 1001, purpose: "A/B" });
    expect(result.joined).toBe(false);
    const state = readLease(INSTANCE_RESOURCE, env);
    expect(state?.live).toBe(true);
    expect(state?.lease).toMatchObject({ owner: "qa", holders: [1001], purpose: "A/B" });
  });

  it("refuses another live owner, naming the holder and how to release", () => {
    acquireLease(INSTANCE_RESOURCE, "orchestrator", { ...env, pid: 1001, purpose: "verify" });
    let error: unknown;
    try {
      acquireLease(INSTANCE_RESOURCE, "qa", { ...env, pid: 1002 });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(LeaseHeldError);
    const message = (error as Error).message;
    expect(message).toContain('held by "orchestrator" for "verify"');
    expect(message).toContain("lease release --owner orchestrator");
    expect(message).toContain("--wait");
    // The refusal changed nothing.
    expect(readLease(INSTANCE_RESOURCE, env)?.lease.holders).toEqual([1001]);
  });

  it("lets the same owner join, and the lease lives while either holder does", () => {
    acquireLease(INSTANCE_RESOURCE, "qa", { ...env, pid: 1001 });
    const joined = acquireLease(INSTANCE_RESOURCE, "qa", { ...env, pid: 1002 });
    expect(joined.joined).toBe(true);
    alive.delete(1001);
    expect(readLease(INSTANCE_RESOURCE, env)?.live).toBe(true);
    alive.delete(1002);
    expect(readLease(INSTANCE_RESOURCE, env)?.live).toBe(false);
  });

  it("reclaims a lease whose holder process died, and reports it", () => {
    acquireLease(INSTANCE_RESOURCE, "old-agent", { ...env, pid: 1001 });
    alive.delete(1001);
    const result = acquireLease(INSTANCE_RESOURCE, "qa", { ...env, pid: 1002 });
    expect(result.reclaimed?.lease.owner).toBe("old-agent");
    expect(result.reclaimed?.reason).toContain("1001 exited");
    expect(readLease(INSTANCE_RESOURCE, env)?.lease.owner).toBe("qa");
  });

  it("keeps an implicit lease live while its Vortex runs after the command exits", () => {
    acquireLease(INSTANCE_RESOURCE, "qa", { ...env, pid: 1001 });
    addInstancePid(readLease(INSTANCE_RESOURCE, env)!.lease, 1002, env);
    alive.delete(1001);
    dropHolder(INSTANCE_RESOURCE, 1001, env);
    const state = readLease(INSTANCE_RESOURCE, env);
    expect(state?.live).toBe(true);
    expect(state?.reason).toContain("Vortex pid 1002");
    expect(() => acquireLease(INSTANCE_RESOURCE, "other", { ...env, pid: 1001 })).toThrow(
      LeaseHeldError,
    );
    // `down`: the Vortex is gone and nothing else holds it, so the lease goes too.
    removeInstancePid(readLease(INSTANCE_RESOURCE, env)!.lease, 1002, env);
    expect(readLease(INSTANCE_RESOURCE, env)).toBeUndefined();
  });

  it("expires an explicit lease at its TTL and renews it on re-acquire", () => {
    acquireLease(INSTANCE_RESOURCE, "qa", { ...env, mode: "explicit", ttlMinutes: 30 });
    now += 20 * 60_000;
    acquireLease(INSTANCE_RESOURCE, "qa", { ...env, mode: "explicit", ttlMinutes: 30 });
    now += 20 * 60_000;
    expect(readLease(INSTANCE_RESOURCE, env)?.live).toBe(true);
    now += 11 * 60_000;
    const state = readLease(INSTANCE_RESOURCE, env);
    expect(state?.live).toBe(false);
    expect(state?.reason).toContain("expired");
    expect(acquireLease(INSTANCE_RESOURCE, "other", env).reclaimed?.lease.owner).toBe("qa");
  });

  it("keeps an explicit lease when its joiners and instances finish", () => {
    acquireLease(INSTANCE_RESOURCE, "qa", { ...env, mode: "explicit", ttlMinutes: 60 });
    acquireLease(INSTANCE_RESOURCE, "qa", { ...env, pid: 1001 });
    addInstancePid(readLease(INSTANCE_RESOURCE, env)!.lease, 1002, env);
    removeInstancePid(readLease(INSTANCE_RESOURCE, env)!.lease, 1002, env);
    dropHolder(INSTANCE_RESOURCE, 1001, env);
    const state = readLease(INSTANCE_RESOURCE, env);
    expect(state?.lease.mode).toBe("explicit");
    expect(state?.live).toBe(true);
  });

  it("binds an explicit lease to --pid", () => {
    acquireLease(INSTANCE_RESOURCE, "qa", { ...env, mode: "explicit", boundPid: 1001 });
    expect(readLease(INSTANCE_RESOURCE, env)?.live).toBe(true);
    alive.delete(1001);
    expect(readLease(INSTANCE_RESOURCE, env)?.reason).toContain("1001 exited");
  });

  it("keeps separate resources apart and names a checkout however it is spelled", () => {
    const checkout = fs.mkdtempSync(path.join(dir, "checkout-"));
    const spelled = `${checkout}${path.sep}.${path.sep}`;
    expect(checkoutResource(spelled)).toBe(checkoutResource(checkout));
    acquireLease(checkoutResource(checkout), "qa", { ...env, pid: 1001 });
    acquireLease(INSTANCE_RESOURCE, "other", { ...env, pid: 1002 });
    expect(() => acquireLease(checkoutResource(spelled), "other", { ...env, pid: 1002 })).toThrow(
      /The lease on .* is held by "qa"/,
    );
    expect(
      listLeases(env)
        .map((s) => s.lease.resource)
        .toSorted(),
    ).toEqual([INSTANCE_RESOURCE, checkoutResource(checkout)].toSorted());
  });
});

describe("releaseLease", () => {
  it("releases only for its owner unless forced", () => {
    acquireLease(INSTANCE_RESOURCE, "qa", { ...env, pid: 1001 });
    expect(releaseLease(INSTANCE_RESOURCE, "other", env).released).toBe(false);
    expect(releaseLease(INSTANCE_RESOURCE, "other", { ...env, force: true }).released).toBe(true);
    expect(readLease(INSTANCE_RESOURCE, env)).toBeUndefined();
  });

  it("preserves a live instance when its reservation is released", () => {
    acquireLease(INSTANCE_RESOURCE, "qa", { ...env, pid: 1001 });
    addInstancePid(readLease(INSTANCE_RESOURCE, env)!.lease, 1002, env);
    expect(releaseLease(INSTANCE_RESOURCE, "qa", env)).toMatchObject({
      released: true,
      stillRunning: [1002],
      keptForRunning: true,
    });
    expect(() => acquireLease(INSTANCE_RESOURCE, "other", env)).toThrow(LeaseHeldError);
    alive.delete(1002);
    expect(releaseLease(INSTANCE_RESOURCE, "qa", env).keptForRunning).toBeUndefined();
    expect(readLease(INSTANCE_RESOURCE, env)).toBeUndefined();
  });

  it("keeps a checkout locked while a Vortex runs from it, after its explicit hold is released", () => {
    const checkout = checkoutResource(fs.mkdtempSync(path.join(dir, "checkout-")));
    // `up` from the checkout recorded its Vortex; the owner then renewed and released.
    acquireLease(checkout, "qa", { ...env, pid: 1001 });
    addInstancePid(readLease(checkout, env)!.lease, 1002, env);
    acquireLease(checkout, "qa", { ...env, mode: "explicit", ttlMinutes: 60 });
    alive.delete(1001);
    expect(releaseLease(checkout, "qa", env)).toMatchObject({
      released: true,
      keptForRunning: true,
      stillRunning: [1002],
    });
    expect(readLease(checkout, env)).toMatchObject({ live: true, lease: { mode: "implicit" } });
    expect(() => acquireLease(checkout, "other", { ...env, pid: 1003 })).toThrow(/held by "qa"/);
    // Once that Vortex exits the lease is stale, and --force always clears it.
    alive.delete(1002);
    expect(readLease(checkout, env)?.live).toBe(false);
    alive.add(1002);
    addInstancePid(readLease(checkout, env)!.lease, 1002, env);
    expect(releaseLease(checkout, "qa", { ...env, force: true }).keptForRunning).toBeUndefined();
    expect(readLease(checkout, env)).toBeUndefined();
  });

  it("lets anyone clear a stale lease", () => {
    acquireLease(INSTANCE_RESOURCE, "qa", { ...env, pid: 1001 });
    alive.delete(1001);
    expect(releaseLease(INSTANCE_RESOURCE, "other", env).released).toBe(true);
  });
});

describe("a session's leases", () => {
  it("keeps an expired reservation protected while its launcher and known child run", () => {
    acquireLease(INSTANCE_RESOURCE, "launcher", { ...env, mode: "explicit", ttlMinutes: 1 });
    const launch = holdLease(INSTANCE_RESOURCE, "launcher", env);
    const operation = claimOperations([INSTANCE_RESOURCE], "launcher", { leaseEnv: env });
    try {
      now += 60_001;
      expect(readLease(INSTANCE_RESOURCE, env)?.live).toBe(true);
      expect(() => acquireLease(INSTANCE_RESOURCE, "successor", env)).toThrow(LeaseHeldError);
      addInstancePid(launch.lease, 1002, env);
      launch.release();
      expect(readLease(INSTANCE_RESOURCE, env)?.lease.instancePids).toEqual([1002]);
      expect(() => acquireLease(INSTANCE_RESOURCE, "successor", env)).toThrow(LeaseHeldError);
      alive.delete(1002);
      removeInstancePid(launch.lease, 1002, env);
      expect(acquireLease(INSTANCE_RESOURCE, "successor", env).lease.owner).toBe("successor");
    } finally {
      operation.release();
      launch.release();
    }
  });

  it.each(["launcher", "other"])("stale app callbacks cannot mutate a %s successor", (owner) => {
    const original = holdLease(INSTANCE_RESOURCE, "launcher", env);
    releaseLease(INSTANCE_RESOURCE, "launcher", { ...env, force: true });
    const successor = acquireLease(INSTANCE_RESOURCE, owner, env).lease;
    addInstancePid(successor, 1002, env);
    const before = readLease(INSTANCE_RESOURCE, env)!.lease;
    expect(() => addInstancePid(original.lease, 1001, env)).toThrow(/Lost .* acquisition/);
    removeInstancePid(original.lease, 1002, env);
    original.release();
    expect(readLease(INSTANCE_RESOURCE, env)!.lease).toEqual(before);
  });

  it("acquires the instance and a checkout together, or neither", () => {
    const checkout = checkoutResource(fs.mkdtempSync(path.join(dir, "checkout-")));
    const explicit = { ...env, mode: "explicit" as const, ttlMinutes: 60 };
    const taken = acquireLeases([INSTANCE_RESOURCE, checkout], "qa", explicit);
    expect(taken.map((r) => [r.lease.resource, r.joined])).toEqual([
      [INSTANCE_RESOURCE, false],
      [checkout, false],
    ]);
    expect(releaseOwnerLeases("qa", env).map((r) => r.resource)).toEqual([
      checkout,
      INSTANCE_RESOURCE,
    ]);
    // Someone else holds the checkout: the instance this call took is given back.
    acquireLease(checkout, "fixer", { ...env, pid: 1001 });
    expect(() => acquireLeases([INSTANCE_RESOURCE, checkout], "qa", explicit)).toThrow(
      LeaseHeldError,
    );
    expect(readLease(INSTANCE_RESOURCE, env)).toBeUndefined();
    // One it only renewed stays held.
    acquireLease(INSTANCE_RESOURCE, "qa", explicit);
    expect(() => acquireLeases([INSTANCE_RESOURCE, checkout], "qa", explicit)).toThrow(
      LeaseHeldError,
    );
    expect(readLease(INSTANCE_RESOURCE, env)?.lease.owner).toBe("qa");
  });

  it("releases every lease an owner holds and nobody else's", () => {
    const mine = checkoutResource(fs.mkdtempSync(path.join(dir, "mine-")));
    const theirs = checkoutResource(fs.mkdtempSync(path.join(dir, "theirs-")));
    acquireLease(INSTANCE_RESOURCE, "qa", { ...env, mode: "explicit", ttlMinutes: 60 });
    acquireLease(mine, "qa", { ...env, pid: 1001 });
    acquireLease(theirs, "fixer", { ...env, pid: 1002 });
    const released = releaseOwnerLeases("qa", env);
    expect(released.map((r) => [r.resource, r.released])).toEqual([
      [mine, true],
      [INSTANCE_RESOURCE, true],
    ]);
    expect(listLeases(env).map((s) => s.lease.resource)).toEqual([theirs]);
    expect(releaseOwnerLeases("qa", env)).toEqual([]);
  });

  it("leaves both a live instance and its checkout locked after owner release", () => {
    const checkout = checkoutResource(fs.mkdtempSync(path.join(dir, "checkout-")));
    acquireLease(checkout, "qa", { ...env, mode: "explicit", ttlMinutes: 60 });
    addInstancePid(readLease(checkout, env)!.lease, 1002, env);
    acquireLease(INSTANCE_RESOURCE, "qa", { ...env, mode: "explicit", ttlMinutes: 60 });
    addInstancePid(readLease(INSTANCE_RESOURCE, env)!.lease, 1002, env);
    expect(releaseOwnerLeases("qa", env)).toMatchObject([
      { resource: checkout, released: true, keptForRunning: true },
      { resource: INSTANCE_RESOURCE, released: true, keptForRunning: true },
    ]);
    expect(readLease(checkout, env)?.live).toBe(true);
    expect(() => acquireLease(INSTANCE_RESOURCE, "other", env)).toThrow(LeaseHeldError);
  });
});

describe("holding in this process", () => {
  it("nests holds, releasing only when the outer one ends", async () => {
    const outer = holdLease(INSTANCE_RESOURCE, "qa", env);
    await withLeases([INSTANCE_RESOURCE], "qa", env, async () => {
      expect(readLease(INSTANCE_RESOURCE, env)?.lease.holders).toEqual([process.pid]);
    });
    expect(readLease(INSTANCE_RESOURCE, env)?.live).toBe(true);
    outer.release();
    expect(readLease(INSTANCE_RESOURCE, env)).toBeUndefined();
  });

  it("releases after the work throws", async () => {
    await expect(
      withLeases([INSTANCE_RESOURCE], "qa", env, () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    expect(readLease(INSTANCE_RESOURCE, env)).toBeUndefined();
  });

  it("waits for another owner's lease to end", async () => {
    acquireLease(INSTANCE_RESOURCE, "other", { ...env, pid: 1001 });
    let waited = 0;
    const result = await waitForLease(
      () => acquireLease(INSTANCE_RESOURCE, "qa", { ...env, pid: 1002 }),
      1_000,
      () => {
        waited++;
        alive.delete(1001);
      },
      10,
    );
    expect(waited).toBe(1);
    expect(result.lease.owner).toBe("qa");
  });

  it("gives up waiting at the deadline with the holder's details", async () => {
    acquireLease(INSTANCE_RESOURCE, "other", { ...env, pid: 1001 });
    await expect(
      waitForLease(() => acquireLease(INSTANCE_RESOURCE, "qa", env), 30, undefined, 10),
    ).rejects.toThrow(/held by "other"/);
  });
});

describe("resolveOwner", () => {
  it("prefers the flag, then VORTEX_AI_OWNER, then anonymous", () => {
    const saved = process.env.VORTEX_AI_OWNER;
    try {
      process.env.VORTEX_AI_OWNER = "from-env";
      expect(resolveOwner("flag")).toBe("flag");
      expect(resolveOwner()).toBe("from-env");
      delete process.env.VORTEX_AI_OWNER;
      expect(resolveOwner()).toBe("anonymous");
    } finally {
      if (saved === undefined) delete process.env.VORTEX_AI_OWNER;
      else process.env.VORTEX_AI_OWNER = saved;
    }
  });
});

function node(script: string): { command: string; args: string[]; shell: false } {
  return { command: process.execPath, args: ["-e", script], shell: false };
}

describe("runUnderLease", () => {
  it("unwinds partial reservations before a root retry waits", async () => {
    vi.useFakeTimers();
    acquireLease("b", "other", { ...env, pid: 1001 });
    let waited = false;
    const pending = runUnderLease({
      ...node(""),
      owner: "qa",
      resources: ["a", "b"],
      leaseEnv: env,
      waitMs: 5_000,
      onWaiting: () => {
        waited = true;
        expect(readLease("a", env)).toBeUndefined();
      },
    });
    const rejected = expect(pending).rejects.toThrow(LeaseHeldError);
    await vi.advanceTimersByTimeAsync(5_000);
    await rejected;
    expect(waited).toBe(true);
    expect(readLease("a", env)).toBeUndefined();
  });
  it("holds the lease while the command runs, propagates its exit code and releases", async () => {
    const marker = path.join(dir, "seen.json");
    const code = await runUnderLease({
      ...node(
        `const fs=require("fs");const p=require("path");` +
          `const l=JSON.parse(fs.readFileSync(p.join(${JSON.stringify(dir)},"instance.json"),"utf8"));` +
          `fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({owner:l.owner,env:process.env.VORTEX_AI_OWNER}));` +
          `process.exit(7)`,
      ),
      owner: "qa",
      resources: [INSTANCE_RESOURCE],
      leaseEnv: env,
    });
    expect(code).toBe(7);
    expect(JSON.parse(fs.readFileSync(marker, "utf8"))).toEqual({ owner: "qa", env: "qa" });
    expect(readLease(INSTANCE_RESOURCE, env)).toBeUndefined();
  });

  it("refuses without running the command while another owner holds it", async () => {
    acquireLease(INSTANCE_RESOURCE, "other", { ...env, pid: 1001 });
    const marker = path.join(dir, "ran");
    await expect(
      runUnderLease({
        ...node(`require("fs").writeFileSync(${JSON.stringify(marker)}, "")`),
        owner: "qa",
        resources: [INSTANCE_RESOURCE],
        leaseEnv: env,
      }),
    ).rejects.toThrow(LeaseHeldError);
    expect(fs.existsSync(marker)).toBe(false);
    expect(readLease(INSTANCE_RESOURCE, env)?.lease.owner).toBe("other");
  });
});

describe("conservative lease recovery", () => {
  it("keeps a new checkout's resource identity stable across creation and removal", () => {
    const checkout = path.join(dir, "new", "checkout");
    const canonical = path.join(fs.realpathSync.native(dir), "new", "checkout");
    const before = checkoutResource(checkout);
    expect(before).toBe(checkoutResource(canonical));
    fs.mkdirSync(checkout, { recursive: true });
    expect(checkoutResource(checkout)).toBe(before);
    fs.rmdirSync(checkout);
    expect(checkoutResource(checkout)).toBe(before);
  });
  it("does not steal an old mutex and preserves a successor token", () => {
    const mutex = path.join(dir, ".mutex");
    const original = JSON.stringify({ pid: process.pid, id: "old-live-holder" });
    fs.writeFileSync(mutex, original);
    fs.utimesSync(mutex, new Date(0), new Date(0));
    vi.spyOn(Date, "now").mockReturnValueOnce(20_000).mockReturnValue(31_001);
    expect(() => withLeaseMutex(dir, () => "must not run")).toThrow(/explicit recovery/);
    expect(fs.readFileSync(mutex, "utf8")).toBe(original);
    vi.restoreAllMocks();
    fs.rmSync(mutex);
    const successor = JSON.stringify({ pid: process.pid, id: "replacement" });
    expect(() => withLeaseMutex(dir, () => fs.writeFileSync(mutex, successor))).toThrow(
      /Lost mutex/,
    );
    expect(fs.readFileSync(mutex, "utf8")).toBe(successor);
  });

  it("fails closed on corrupt expected leases while ignoring slots.json", () => {
    const file = path.join(dir, "instance.json");
    fs.writeFileSync(path.join(dir, "slots.json"), "not a lease");
    expect(listLeases(env)).toEqual([]);
    for (const corrupt of ["{", JSON.stringify({ resource: "instance", owner: "qa" })]) {
      fs.writeFileSync(file, corrupt);
      expect(() => readLease(INSTANCE_RESOURCE, env)).toThrow(/Invalid lease/);
      expect(() => acquireLease(INSTANCE_RESOURCE, "other", env)).toThrow(/Invalid lease/);
      expect(() => releaseLease(INSTANCE_RESOURCE, "qa", env)).toThrow(/Invalid lease/);
      expect(() => listLeases(env)).toThrow(/Invalid lease/);
      expect(fs.readFileSync(file, "utf8")).toBe(corrupt);
    }
  });

  it("registers children only on the expected owner and acquisition", () => {
    const first = acquireLease("child", "qa", env).lease;
    addHolder(first, 1001, env);
    expect(readLease("child", env)?.lease.holders).toContain(1001);
    releaseLease("child", "qa", env);
    expect(() => addHolder(first, 1002, env)).toThrow(/absent/);
    for (const owner of ["qa", "other"]) {
      const replacement = acquireLease("child", owner, env).lease;
      expect(() => addHolder(first, 1002, env)).toThrow(/Lost/);
      expect(readLease("child", env)?.lease).toEqual(replacement);
      releaseLease("child", owner, env);
    }
  });
});
