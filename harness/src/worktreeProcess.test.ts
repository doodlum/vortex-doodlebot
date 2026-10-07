import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";

it("registers worktree mutation children against the store and checkout guards", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "worktree-child-"));
  const source = path.join(root, ".vortex-src");
  const leaseEnv = { dir: path.join(root, "leases") };
  vi.resetModules();
  vi.doMock("./paths", () => ({
    REPO_ROOT: root,
    HARNESS_ROOT: path.join(root, "harness"),
    DEFAULT_CACHE_DIR: path.join(root, "harness", ".cache"),
    DEFAULT_ARTIFACT_DIR: path.join(root, "harness", ".artifacts"),
    SLOTS_DIR: path.join(root, "harness", ".slots"),
  }));
  vi.stubEnv("VORTEX_AI_LEASE_DIR", leaseEnv.dir);
  try {
    fs.mkdirSync(path.join(source, "src", "main"), { recursive: true });
    fs.writeFileSync(path.join(source, "src", "main", "package.json"), "{}");
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: source, windowsHide: true, stdio: "pipe" });
    git("init", "-q");
    git("add", ".");
    git("-c", "user.name=test", "-c", "user.email=test@example.test", "commit", "-qm", "fixture");
    const operations = await import("./operations");
    const leases = await import("./lease");
    const worktrees = await import("./worktree");
    const track = operations.trackOperationChild;
    const protectedChildren: string[][] = [];
    vi.spyOn(operations, "trackOperationChild").mockImplementation(
      (context, pid, persistent, env) => {
        const release = track(context, pid, persistent, env);
        protectedChildren.push([...context.resources]);
        for (const resource of context.resources)
          expect(
            leases.readLease(operations.operationResource(resource), leaseEnv)?.lease.holders,
          ).toContain(pid);
        return release;
      },
    );
    const created = await worktrees.addWorktree({
      owner: "fixture",
      name: "sample",
      base: "HEAD",
      install: false,
    });
    expect(created.dir).toBe(path.join(root, ".vortex-worktrees", "sample"));
    await worktrees.removeWorktree("sample", false, "fixture");
    expect(protectedChildren).toHaveLength(2);
    for (const resources of protectedChildren) {
      expect(resources.some((resource) => resource.startsWith("worktree-store:"))).toBe(true);
      expect(resources).toContain(leases.checkoutResource(created.dir));
    }
    expect(leases.listLeases(leaseEnv)).toEqual([]);
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.doUnmock("./paths");
    vi.resetModules();
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
