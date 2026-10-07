import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as operations from "./operations";
import {
  captureCheckoutIdentity,
  collectCommandEvidence,
  hashBytes,
  resolveEvidenceCommand,
  runEvidenceProcess,
  sameIdentity,
} from "./evidence";
import {
  addInstancePid,
  checkoutResource,
  holdLease,
  listLeases,
  processAlive,
  readLease,
} from "./lease";
import { claimOperations, CONTEXT_ENV } from "./operations";
import { runPreflight } from "./prPreflight";
import { REPO_ROOT } from "./paths";

describe("recorded process and checkout boundaries", { timeout: 60_000 }, () => {
  let root: string;
  let repo: string;
  let base: string;
  let leaseEnv: { dir: string };
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", windowsHide: true }).trim();
  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), content);
  };
  const commit = () => {
    git("add", ".");
    git("-c", "user.name=test", "-c", "user.email=test@example.test", "commit", "-qm", "fixture");
  };
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-process-"));
    repo = path.join(root, "repo");
    leaseEnv = { dir: path.join(root, "leases") };
    fs.mkdirSync(repo);
    git("init", "-q");
    git("config", "core.autocrlf", "false");
    write("package.json", JSON.stringify({ packageManager: "pnpm@11.0.0" }));
    write("value.ts", "export const value = 1;\n");
    commit();
    base = git("rev-parse", "HEAD");
    write("value.ts", "export const value = 2;\n");
    write("value.test.ts", "test fixture\n");
    commit();
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  it("captures local content, staged state and untracked files, including Windows path aliases", () => {
    const first = captureCheckoutIdentity(repo, base);
    expect(first.checkout).toBe(fs.realpathSync.native(repo));
    write("value.ts", "changed\n");
    const unstaged = captureCheckoutIdentity(repo, base);
    expect(sameIdentity(first, unstaged)).toBe(false);
    git("add", "value.ts");
    expect(sameIdentity(unstaged, captureCheckoutIdentity(repo, base))).toBe(false);
    write("new.txt", "untracked");
    expect(captureCheckoutIdentity(repo, base).changedFiles).toContain("new.txt");
  });
  it("selects the subject's pinned pnpm and never falls back to the kit's version or an install", () => {
    const pnpm = (version: string) => {
      const dir = path.join(root, version, "pnpm");
      fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
      fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "pnpm", version }));
      const script = path.join(dir, "bin", "pnpm.cjs");
      fs.writeFileSync(script, "");
      return script;
    };
    const old = pnpm("9.15.0");
    const wanted = pnpm("11.0.0");
    const env = { npm_execpath: old, VORTEX_AI_PNPM: wanted, PATH: "" };
    expect(resolveEvidenceCommand(repo, ["pnpm", "run", "verify"], env).args).toEqual([
      wanted,
      "run",
      "verify",
    ]);
    expect(() =>
      resolveEvidenceCommand(repo, ["pnpm", "run", "verify"], { ...env, VORTEX_AI_PNPM: old }),
    ).toThrow(/Pinned pnpm 11/);
  });
  it("uses complete supplied environment and the held root even when cwd is a subproject", async () => {
    write("nested/.keep", "");
    const resource = checkoutResource(repo);
    const ownership = holdLease(resource, "test", leaseEnv);
    const operation = claimOperations([resource], "test", { leaseEnv });
    try {
      const result = await runEvidenceProcess({
        executable: process.execPath,
        args: [
          "-e",
          "console.log(JSON.stringify({pin:process.env.npm_execpath,lease:process.env.VORTEX_AI_LEASE_DIR,owner:process.env.VORTEX_AI_OWNER}))",
        ],
        cwd: path.join(repo, "nested"),
        env: { SystemRoot: process.env.SystemRoot },
        context: operation.context,
        leaseEnv,
      });
      expect(JSON.parse(result.output)).toEqual({ lease: leaseEnv.dir, owner: "test" });
      expect(readLease(resource, leaseEnv)?.lease.holders).toContain(process.pid);
    } finally {
      operation.release();
      ownership.release();
    }
  });
  it("records an actual CLI command without loading an app and preserves its output", async () => {
    const out = path.join(root, "command.json");
    const env: NodeJS.ProcessEnv = { ...process.env, VORTEX_AI_LEASE_DIR: leaseEnv.dir };
    delete env[CONTEXT_ENV];
    const result = await runEvidenceProcess({
      executable: process.execPath,
      args: [
        "--import",
        "tsx",
        path.join(REPO_ROOT, "harness/src/cli.ts"),
        "evidence",
        "run",
        "--checkout",
        repo,
        "--base",
        base,
        "--owner",
        "cli-evidence",
        "--out",
        out,
        "--",
        "node",
        "-e",
        "console.log('actual child')",
      ],
      cwd: REPO_ROOT,
      env,
    });
    expect(result.code, result.output).toBe(0);
    const receipt = JSON.parse(fs.readFileSync(out, "utf8"));
    expect(receipt.command.cwd).toBe(fs.realpathSync.native(repo));
    expect(fs.readFileSync(receipt.output.path, "utf8")).toContain("actual child");
  });
  it("actual CLI mutation paths refuse independent same-owner operations before changing source", async () => {
    const resource = checkoutResource(repo);
    const operation = claimOperations([resource], "same", { leaseEnv });
    const before = fs.readFileSync(path.join(repo, "value.ts"), "utf8");
    try {
      for (const command of ["pr-preflight", "vortex-e2e"]) {
        const env: NodeJS.ProcessEnv = { ...process.env, VORTEX_AI_LEASE_DIR: leaseEnv.dir };
        delete env[CONTEXT_ENV];
        const result = await runEvidenceProcess({
          executable: process.execPath,
          args: [
            "--import",
            "tsx",
            path.join(REPO_ROOT, "harness/src/cli.ts"),
            command,
            "--checkout",
            repo,
            "--base",
            base,
            "--owner",
            "same",
            "--artifact-dir",
            path.join(root, "artifacts"),
          ],
          cwd: REPO_ROOT,
          env,
        });
        expect(result.code).not.toBe(0);
        expect(result.output).toMatch(/independent operation.*checkout:.*refusing overlapping/s);
        expect(fs.readFileSync(path.join(repo, "value.ts"), "utf8")).toBe(before);
      }
    } finally {
      operation.release();
    }
  });
  it("preflight rejects anonymous owners and its owner's live app before invoking a runner", async () => {
    const options = {
      checkout: repo,
      base,
      leaseEnv,
      runner: async () => {
        throw new Error("runner must not start");
      },
    };
    await expect(runPreflight({ ...options, owner: "anonymous" })).rejects.toThrow(/named owner/);
    const resource = checkoutResource(repo);
    const hold = holdLease(resource, "same", leaseEnv);
    addInstancePid(hold.lease, process.pid, leaseEnv);
    try {
      await expect(runPreflight({ ...options, owner: "same" })).rejects.toThrow(/running from/);
    } finally {
      const { removeInstancePid } = await import("./lease");
      removeInstancePid(hold.lease, process.pid, leaseEnv);
      hold.release();
    }
  });
  it("cancels a real negative-control child before restoring and releasing its checkout", async () => {
    const controller = new AbortController();
    let calls = 0;
    let pid: number | undefined;
    const before = fs.readFileSync(path.join(repo, "value.ts"), "utf8");
    await expect(
      runPreflight({
        checkout: repo,
        base,
        owner: "cancel",
        leaseEnv,
        signal: controller.signal,
        handleSignals: false,
        runner: async (cwd, _tests, options) => {
          if (++calls === 1) {
            const json = JSON.stringify({
              numTotalTests: 1,
              numPassedTests: 1,
              numFailedTests: 0,
              numPendingTests: 0,
              numTodoTests: 0,
              testResults: [{ assertionResults: [{ status: "passed" }] }],
            });
            return { code: 0, output: "passed", reporter: { json, sha256: hashBytes(json) } };
          }
          expect(fs.readFileSync(path.join(repo, "value.ts"), "utf8")).not.toBe(before);
          const result = await runEvidenceProcess({
            ...options,
            executable: process.execPath,
            args: ["-e", "console.log(process.pid); setInterval(()=>{},1000)"],
            cwd,
            onOutput: (chunk) => {
              pid = Number(chunk.toString().trim());
              controller.abort();
            },
          });
          expect(processAlive(pid!)).toBe(false);
          expect(fs.readFileSync(path.join(repo, "value.ts"), "utf8")).not.toBe(before);
          return result;
        },
      }),
    ).rejects.toThrow(/interrupted/);
    expect(calls).toBe(2);
    expect(pid).toBeDefined();
    expect(processAlive(pid!)).toBe(false);
    expect(fs.readFileSync(path.join(repo, "value.ts"), "utf8")).toBe(before);
    expect(readLease(checkoutResource(repo), leaseEnv)).toBeUndefined();
    expect(listLeases(leaseEnv)).toEqual([]);
  });
  it("records source changes during a successful command instead of claiming stable evidence", async () => {
    const result = await collectCommandEvidence({
      checkout: repo,
      base,
      cwd: repo,
      owner: "mutate",
      leaseEnv,
      command: ["node", "-e", "require('node:fs').writeFileSync('value.ts','changed')"],
      out: path.join(root, "changed.json"),
    });
    expect(result.code).toBe(0);
    expect(sameIdentity(result.before, result.after)).toBe(false);
  });
  it("waits for a spawned child to exit even if lease registration throws", async () => {
    const resource = checkoutResource(repo);
    const ownership = holdLease(resource, "registration", leaseEnv);
    const operation = claimOperations([resource], "registration", { leaseEnv });
    let pid: number | undefined;
    const spy = vi
      .spyOn(operations, "trackOperationChild")
      .mockImplementation((_context, child) => {
        pid = child;
        expect(processAlive(child)).toBe(true);
        throw new Error("registration failed");
      });
    try {
      await expect(
        runEvidenceProcess({
          executable: process.execPath,
          args: ["-e", "setInterval(()=>{},1000)"],
          cwd: repo,
          context: operation.context,
          leaseEnv,
        }),
      ).rejects.toThrow("registration failed");
      expect(pid).toBeDefined();
      expect(processAlive(pid!)).toBe(false);
    } finally {
      spy.mockRestore();
      operation.release();
      ownership.release();
    }
  });
});
