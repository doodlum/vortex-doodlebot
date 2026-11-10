import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./paths";

/** Identifiers of the removed multi-instance machinery (designs/egm-workflow.md, item 10). */
const REMOVED = [
  "lease.ts",
  "leaseCommand",
  "operations.ts",
  "checkoutOperation",
  "liveOperation",
  "kitLock",
  "slots.ts",
  "worktree.ts",
  "requireNamedOwner",
  "resolveOwner",
  "withOperation",
  "withLiveOperation",
  "withCheckoutOperation",
  "OperationOptions",
  "CONTEXT_ENV",
  "acquireLease",
  "claimInstanceLease",
  "slotPaths",
  "VORTEX_AI_OWNER",
  "VORTEX_AI_SLOT",
  "VORTEX_AI_LEASE_DIR",
  "--owner",
  "--slot",
  "--worktree",
  "--checkout-only",
  "ai:lease",
  "ai:test:parallel-sessions",
  "kit lock",
  "instance lease",
  ".vortex-worktrees/<",
];
const ALLOWED = new Set([
  "designs/egm-workflow.md",
  "harness/src/singleInstance.test.ts",
  ".gitignore",
  "harness/.gitignore",
  "docs/troubleshooting.md",
]);
const BINARY = /\.(?:png|jpe?g|gif|ico|ttf|woff2?|zip|7z|exe|dll)$/i;

/** Tracked and untracked non-ignored files that exist on disk. */
function repositoryFiles(): string[] {
  return execFileSync(
    "git",
    ["-C", REPO_ROOT, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\0")
    .filter((file) => file !== "" && !BINARY.test(file))
    .filter((file) => fs.existsSync(path.join(REPO_ROOT, file)));
}

describe("one doodlebot instance", () => {
  it("leaves no reference to the removed multi-instance machinery", () => {
    const hits: string[] = [];
    for (const file of repositoryFiles()) {
      if (ALLOWED.has(file)) continue;
      const text = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
      for (const identifier of REMOVED)
        if (text.includes(identifier)) hits.push(`${file}: ${identifier}`);
    }
    expect(hits).toEqual([]);
  });

  it("scans a real listing that skips files deleted from disk but still in the index", () => {
    const files = repositoryFiles();
    // An empty or wrong listing would make the scan above pass vacuously.
    expect(files).toEqual(expect.arrayContaining(["harness/src/instance.ts", "harness/AGENTS.md"]));
    expect(files.every((file) => fs.existsSync(path.join(REPO_ROOT, file)))).toBe(true);
  });
});
