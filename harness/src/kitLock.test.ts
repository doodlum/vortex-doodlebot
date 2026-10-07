import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LeaseHeldError,
  acquireLease,
  readLease,
  releaseLease,
  renewLease,
  type LeaseEnv,
} from "./lease";
import {
  type GitRunner,
  kitLockHolder,
  lockKit,
  pushKit,
  requireKitLock,
  syncKit,
  unlockKit,
} from "./kitLock";

let dir: string;
let env: LeaseEnv;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-ai-kitlock-"));
  env = { dir };
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A git that answers from a script and records every call. */
function fakeGit(answers: Record<string, string> = {}): { git: GitRunner; calls: string[] } {
  const calls: string[] = [];
  const git: GitRunner = async (args) => {
    const line = args.join(" ");
    calls.push(line);
    const key = Object.keys(answers).find((k) => line.startsWith(k));
    return key === undefined ? "" : answers[key]!;
  };
  return { git, calls };
}

describe("the kit lock", () => {
  it("lets one owner change the kit at a time", () => {
    const acquisition = lockKit("session-a", env).lease.acquisitionId;
    expect(kitLockHolder(env)).toBe("session-a");
    expect(() => lockKit("session-b", env)).toThrow(LeaseHeldError);
    // taking it again renews it
    expect(lockKit("session-a", env).joined).toBe(true);
    unlockKit("session-a", { ...env, acquisitionId: acquisition });
    expect(kitLockHolder(env)).toBeUndefined();
    expect(lockKit("session-b", env).joined).toBe(false);
  });

  it("needs an owner", () => {
    expect(() => lockKit("anonymous", env)).toThrow(/needs a name/);
  });

  it("requires the original acquisition and leaves a same-owner successor untouched", () => {
    const original = lockKit("session-a", env).lease;
    expect(() => unlockKit("session-a", env)).toThrow(/requires --acquisition/);
    expect(unlockKit("session-a", { ...env, force: true }).released).toBe(true);
    const successor = lockKit("session-a", env).lease;
    expect(unlockKit("session-a", { ...env, acquisitionId: original.acquisitionId })).toMatchObject(
      { released: false, reason: expect.stringContaining("lost kit acquisition") },
    );
    expect(readLease("kit", env)?.lease).toEqual(successor);
    expect(
      unlockKit("session-a", { ...env, acquisitionId: successor.acquisitionId }).released,
    ).toBe(true);
  });

  it("refuses kit work without the lock, naming who holds it", () => {
    expect(() => requireKitLock("session-a", env)).toThrow(/Take the kit lock first/);
    lockKit("session-b", env);
    expect(() => requireKitLock("session-a", env)).toThrow(/held by "session-b"/);
    expect(() => requireKitLock("session-b", env)).not.toThrow();
  });
});

describe("kit push", () => {
  const clean = {
    "status --porcelain": "",
    "rev-parse --abbrev-ref HEAD": "main",
    "rev-parse HEAD": "abc1234def",
  };

  it("rebases onto the remote, then pushes, under the lock", async () => {
    lockKit("session-a", env);
    const { git, calls } = fakeGit(clean);
    expect(await pushKit({ owner: "session-a", git, repo: dir, ...env })).toBe("abc1234def");
    expect(calls.filter((c) => !c.startsWith("status") && !c.startsWith("rev-parse"))).toEqual([
      "fetch origin main",
      "rebase origin/main",
      "push origin main:main",
    ]);
  });

  it("keeps a changed rebased HEAD but refuses to publish until it is revalidated", async () => {
    lockKit("session-a", env);
    let head = "reviewed-head";
    const calls: string[] = [];
    const git: GitRunner = async (args) => {
      const line = args.join(" ");
      calls.push(line);
      if (line === "rev-parse --abbrev-ref HEAD") return "main";
      if (line === "rev-parse HEAD") return head;
      if (line.startsWith("rebase")) head = "rebased-head";
      return "";
    };
    await expect(pushKit({ owner: "session-a", git, repo: dir, ...env })).rejects.toThrow(
      /rerun checks and review/,
    );
    expect(head).toBe("rebased-head");
    expect(calls.some((line) => line.startsWith("push"))).toBe(false);
    expect(await pushKit({ owner: "session-a", git, repo: dir, ...env })).toBe("rebased-head");
    expect(calls.filter((line) => line.startsWith("push"))).toHaveLength(1);
  });

  it("refuses without the lock, with uncommitted changes, or off main", async () => {
    const { git, calls } = fakeGit(clean);
    await expect(pushKit({ owner: "session-a", git, repo: dir, ...env })).rejects.toThrow(
      /Take the kit lock first/,
    );
    expect(calls).toEqual([]);

    lockKit("session-a", env);
    const dirty = fakeGit({ ...clean, "status --porcelain": " M KNOWLEDGE.md" });
    await expect(
      pushKit({ owner: "session-a", git: dirty.git, repo: dir, ...env }),
    ).rejects.toThrow(/uncommitted changes/);
    expect(dirty.calls.some((c) => c.startsWith("push"))).toBe(false);

    const branch = fakeGit({ ...clean, "rev-parse --abbrev-ref HEAD": "fix/x" });
    await expect(
      pushKit({ owner: "session-a", git: branch.git, repo: dir, ...env }),
    ).rejects.toThrow(/Merge your work into main first/);
  });
});

describe("kit sync", () => {
  it("fast-forwards main to the remote, under the lock", async () => {
    lockKit("session-a", env);
    const { git, calls } = fakeGit({
      "status --porcelain": "",
      "rev-parse --abbrev-ref HEAD": "fix/old",
      "rev-parse HEAD": "fedcba9",
    });
    expect(await syncKit({ owner: "session-a", git, repo: dir, ...env })).toBe("fedcba9");
    expect(calls).toContain("switch main");
    expect(calls).toContain("merge --ff-only origin/main");
  });
});

it("conditional renewal never reacquires expired or replaced acquisitions", () => {
  let now = Date.now();
  env.now = () => now;
  const initial = lockKit("author", { ...env, ttlMinutes: 1 }).lease;
  now += 60_001;
  expect(() => renewLease("kit", "author", initial.acquisitionId!, 30, env)).toThrow(/Lost/);
  expect(unlockKit("author", { ...env, acquisitionId: initial.acquisitionId }).released).toBe(
    false,
  );
  expect(readLease("kit", env)?.lease.acquisitionId).toBe(initial.acquisitionId);
  releaseLease("kit", "author", env);
  const replacement = lockKit("author", env).lease;
  expect(replacement.acquisitionId).not.toBe(initial.acquisitionId);
  expect(() => renewLease("kit", "author", initial.acquisitionId!, 30, env)).toThrow(/Lost/);
  expect(readLease("kit", env)?.lease.acquisitionId).toBe(replacement.acquisitionId);
});

it("ownership replacement during fetch prevents subsequent rebase/push", async () => {
  lockKit("author", env);
  const calls: string[] = [];
  await expect(
    pushKit({
      owner: "author",
      ...env,
      repo: dir,
      git: async (args) => {
        const line = args.join(" ");
        calls.push(line);
        if (line === "rev-parse --abbrev-ref HEAD") return "main";
        if (line.startsWith("fetch")) {
          // Simulate an out-of-band replacement; supported lock paths refuse this.
          releaseLease("kit", "author", env);
          acquireLease("kit", "replacement", { ...env, mode: "explicit", ttlMinutes: 30 });
        }
        return "";
      },
    }),
  ).rejects.toThrow(/Lost/);
  expect(calls.some((line) => /^(rebase|push)/.test(line))).toBe(false);
  expect(readLease("kit", env)?.lease.owner).toBe("replacement");
});

it("untracked files block Git mutations and ignored files are excluded by git", async () => {
  lockKit("author", env);
  const { git, calls } = fakeGit({ "status --porcelain": "?? new-source.ts" });
  await expect(syncKit({ ...env, owner: "author", repo: dir, git })).rejects.toThrow(
    /uncommitted changes/,
  );
  expect(calls).toEqual(["status --porcelain --untracked-files=all"]);
});

it("keeps ownership alive during a long Git operation and stops its heartbeat afterward", async () => {
  vi.useFakeTimers();
  lockKit("author", env);
  let finishFetch!: () => void;
  const fetch = new Promise<void>((resolve) => {
    finishFetch = resolve;
  });
  const started = pushKit({
    ...env,
    owner: "author",
    repo: dir,
    git: async (args) => {
      if (args[0] === "fetch") await fetch;
      if (args.join(" ") === "rev-parse --abbrev-ref HEAD") return "main";
      return "";
    },
  });
  await vi.advanceTimersByTimeAsync(35 * 60_000);
  expect(kitLockHolder(env)).toBe("author");
  finishFetch();
  await started;
  expect(vi.getTimerCount()).toBe(0);
});
