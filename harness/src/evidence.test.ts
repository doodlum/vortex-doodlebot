import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureCheckoutIdentity,
  collectCommandEvidence,
  hashBytes,
  resolveEvidenceCommand,
  runEvidenceProcess,
  sameIdentity,
} from "./evidence";
import { processAlive } from "./processes";
import { runPreflight } from "./prPreflight";
import { REPO_ROOT } from "./paths";
import { clearInstanceRecord, INSTANCE_RECORD, writeInstanceRecord } from "./runningVortex";

// The instance record lives in a private cache, and this process counts as a running Vortex.
vi.mock("./paths", async (original) => {
  const nodeFs = await import("node:fs");
  const nodeOs = await import("node:os");
  const nodePath = await import("node:path");
  return {
    ...(await original<typeof import("./paths")>()),
    DEFAULT_CACHE_DIR: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "evidence-cache-")),
  };
});
vi.mock("./processes", async (original) => ({
  ...(await original<typeof import("./processes")>()),
  processImageName: () => "electron.exe",
}));

afterAll(() => fs.rmSync(path.dirname(INSTANCE_RECORD), { recursive: true, force: true }));

describe("recorded process and checkout boundaries", { timeout: 60_000 }, () => {
  let root: string;
  let repo: string;
  let base: string;
  const runningFrom = (sourceDir: string): void =>
    writeInstanceRecord({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      cacheDir: path.join(root, "cache"),
      userDataDir: path.join(root, "cache", "userData"),
      mcpPort: 3701,
      sourceDir,
    });
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
  afterEach(() => {
    clearInstanceRecord();
    fs.rmSync(root, { recursive: true, force: true });
  });
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
  it("uses exactly the supplied environment and cwd, adding nothing", async () => {
    write("nested/.keep", "");
    const result = await runEvidenceProcess({
      executable: process.execPath,
      args: [
        "-e",
        "console.log(JSON.stringify({cwd:process.cwd(),pin:process.env.npm_execpath,kit:Object.keys(process.env).filter(k=>k.startsWith('VORTEX_AI_'))}))",
      ],
      cwd: path.join(repo, "nested"),
      env: { SystemRoot: process.env.SystemRoot },
    });
    const seen = JSON.parse(result.output) as { cwd: string };
    // No npm pin and no kit variable is added to the supplied environment.
    expect(seen).toEqual({ cwd: expect.any(String), kit: [] });
    expect(fs.realpathSync.native(seen.cwd)).toBe(
      fs.realpathSync.native(path.join(repo, "nested")),
    );
  });
  it("records an actual CLI command without loading an app and preserves its output", async () => {
    const out = path.join(root, "command.json");
    const env: NodeJS.ProcessEnv = { ...process.env };
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
  it("preflight refuses its revert check while the harness Vortex runs from the checkout", async () => {
    const options = {
      checkout: repo,
      base,
      runner: async () => {
        throw new Error("runner must not start");
      },
    };
    runningFrom(repo);
    await expect(runPreflight(options)).rejects.toThrow(
      `A harness Vortex is running from ${path.resolve(repo)} (pid ${process.pid}); run \`pnpm run ai -- down\` before reverting it.`,
    );
    // Without the revert check nothing is changed, so nothing is refused.
    await expect(runPreflight({ ...options, skipRevert: true })).resolves.toBeDefined();
  });
  it("evidence run refuses before running while the harness Vortex runs from the checkout", async () => {
    runningFrom(repo);
    const out = path.join(root, "refused.json");
    await expect(
      collectCommandEvidence({
        checkout: repo,
        base,
        cwd: repo,
        command: ["node", "-e", "require('node:fs').writeFileSync('value.ts','changed')"],
        out,
      }),
    ).rejects.toThrow(
      `A harness Vortex is running from ${repo} (pid ${process.pid}); run \`pnpm run ai -- down\` before recording evidence in it.`,
    );
    expect(fs.readFileSync(path.join(repo, "value.ts"), "utf8")).toBe("export const value = 2;\n");
    expect(fs.existsSync(out)).toBe(false);
    // A Vortex running from another checkout does not stop it.
    runningFrom(path.join(root, "other"));
    const result = await collectCommandEvidence({
      checkout: repo,
      base,
      cwd: repo,
      command: ["node", "-e", "console.log('ran')"],
      out,
    });
    expect(result.code).toBe(0);
  });
  it("cancels a real negative-control child before restoring its checkout", async () => {
    const controller = new AbortController();
    let calls = 0;
    let pid: number | undefined;
    const before = fs.readFileSync(path.join(repo, "value.ts"), "utf8");
    await expect(
      runPreflight({
        checkout: repo,
        base,
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
  });
  it("records source changes during a successful command instead of claiming stable evidence", async () => {
    const result = await collectCommandEvidence({
      checkout: repo,
      base,
      cwd: repo,
      command: ["node", "-e", "require('node:fs').writeFileSync('value.ts','changed')"],
      out: path.join(root, "changed.json"),
    });
    expect(result.code).toBe(0);
    expect(sameIdentity(result.before, result.after)).toBe(false);
  });
});
