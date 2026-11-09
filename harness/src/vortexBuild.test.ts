import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearInstanceRecord, INSTANCE_RECORD, writeInstanceRecord } from "./runningVortex";
import { buildCheckout, buildEnvironment, restoreChanged, saveFiles } from "./vortexBuild";

// The instance record lives in a private cache, and this process counts as a running Vortex.
vi.mock("./paths", async (original) => {
  const nodeFs = await import("node:fs");
  const nodeOs = await import("node:os");
  const nodePath = await import("node:path");
  return {
    ...(await original<typeof import("./paths")>()),
    DEFAULT_CACHE_DIR: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "vortex-build-cache-")),
  };
});
vi.mock("./processes", async (original) => ({
  ...(await original<typeof import("./processes")>()),
  processImageName: () => "electron.exe",
}));

let dir: string;
let checkout: string;

afterAll(() => fs.rmSync(path.dirname(INSTANCE_RECORD), { recursive: true, force: true }));

beforeEach(() => {
  // an operator's own pnpm override would change which command runs
  vi.stubEnv("VORTEX_AI_PNPM", "");
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-build-test-"));
  checkout = path.join(dir, "vortex");
  fs.mkdirSync(path.join(checkout, "src", "main", "build"), { recursive: true });
  fs.mkdirSync(path.join(checkout, "etc"), { recursive: true });
  fs.writeFileSync(
    path.join(checkout, "package.json"),
    JSON.stringify({ packageManager: "pnpm@11.10.0+sha512.abc" }),
  );
  fs.writeFileSync(path.join(checkout, "etc", "vortex.api.md"), "api v1\n");
});

afterEach(() => {
  clearInstanceRecord();
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the build environment", () => {
  it("sets NODE_ENV only for a production build and never passes the caller's on", () => {
    const caller = { PATH: "p", NODE_ENV: "development", Node_Env: "x", npm_config_x: "1" };
    expect(buildEnvironment(caller, true)).toEqual({ CI: "1", PATH: "p", NODE_ENV: "production" });
    expect(buildEnvironment(caller, false)).toEqual({ CI: "1", PATH: "p" });
  });

  it("puts back only the generated files the build changed", () => {
    const saved = saveFiles(checkout, ["etc/vortex.api.md", "etc/Dependency Report.md"]);
    fs.writeFileSync(path.join(checkout, "etc", "vortex.api.md"), "api v2\n");
    fs.writeFileSync(path.join(checkout, "etc", "Dependency Report.md"), "new\n");
    expect(restoreChanged(checkout, saved)).toEqual([
      "etc/vortex.api.md",
      "etc/Dependency Report.md",
    ]);
    expect(fs.readFileSync(path.join(checkout, "etc", "vortex.api.md"), "utf8")).toBe("api v1\n");
    expect(fs.existsSync(path.join(checkout, "etc", "Dependency Report.md"))).toBe(false);
    expect(restoreChanged(checkout, saved)).toEqual([]);
  });
});

const mustNotRun = async (): Promise<number> => {
  throw new Error("must not run");
};

describe("building a checkout", () => {
  it("runs the pinned pnpm and restores what the build rewrote", async () => {
    const runs: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
    const report = await buildCheckout({
      checkout,
      production: true,
      installedPnpm: "9.15.0",
      runner: async (command, args, options) => {
        runs.push({ command, args, env: options.env });
        fs.writeFileSync(path.join(checkout, "etc", "vortex.api.md"), "rewritten\n");
        return 0;
      },
    });
    expect(runs[0]?.command).toBe("pnpm");
    expect(runs[0]?.args).toEqual(["dlx", "pnpm@11.10.0", "run", "build"]);
    expect(runs[0]?.env.NODE_ENV).toBe("production");
    expect(report).toMatchObject({ exitCode: 0, restored: ["etc/vortex.api.md"] });
    expect(fs.readFileSync(path.join(checkout, "etc", "vortex.api.md"), "utf8")).toBe("api v1\n");
  });

  it("builds main directly when the build left out a worker main's build script bundles", async () => {
    const main = path.join(checkout, "src", "main");
    fs.writeFileSync(
      path.join(main, "build.mjs"),
      `await bundleWorker("./src/hash/worker.ts", "hash-worker.cjs");
`,
    );
    const runs: Array<{ command: string; cwd: string }> = [];
    const report = await buildCheckout({
      checkout,
      production: false,
      installedPnpm: "11.10.0",
      runner: async (command, _args, options) => {
        runs.push({ command, cwd: options.cwd });
        // nx restored main from cache: main.cjs and the renderer, but not the worker
        for (const name of command === "node" ? ["hash-worker.cjs"] : ["main.cjs", "renderer.js"])
          fs.writeFileSync(path.join(main, "build", name), "");
        return 0;
      },
    });
    expect(runs.map((r) => r.command)).toEqual(["pnpm", "node"]);
    expect(runs[1]?.cwd).toBe(main);
    expect(report.exitCode).toBe(0);
  });

  it("uses the pnpm on PATH when it is the pinned version, and restores after a failed build", async () => {
    const report = await buildCheckout({
      checkout,
      production: false,
      installedPnpm: "11.10.0",
      runner: async (_command, args, options) => {
        expect(args).toEqual(["run", "build"]);
        expect(options.env.NODE_ENV).toBeUndefined();
        fs.writeFileSync(path.join(checkout, "etc", "vortex.api.md"), "half\n");
        return 2;
      },
    });
    expect(report).toMatchObject({
      exitCode: 2,
      restored: ["etc/vortex.api.md"],
      nodeEnv: "unset",
    });
  });

  it("refuses while the harness Vortex runs from the checkout, before running anything", async () => {
    const record = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      cacheDir: path.join(dir, "cache"),
      userDataDir: path.join(dir, "cache", "userData"),
      mcpPort: 3701,
    };
    writeInstanceRecord({ ...record, sourceDir: checkout });
    await expect(
      buildCheckout({ checkout, production: true, installedPnpm: "11.10.0", runner: mustNotRun }),
    ).rejects.toThrow(
      `A harness Vortex is running from ${checkout} (pid ${process.pid}); run \`pnpm run ai -- down\` before building it.`,
    );
    expect(fs.readFileSync(path.join(checkout, "etc", "vortex.api.md"), "utf8")).toBe("api v1\n");
    // One running from another checkout, or an installed Vortex, does not stop the build.
    const runs: string[] = [];
    const runner = async (command: string): Promise<number> => {
      runs.push(command);
      return 0;
    };
    writeInstanceRecord({ ...record, sourceDir: path.join(dir, "other") });
    await buildCheckout({ checkout, production: true, installedPnpm: "11.10.0", runner });
    writeInstanceRecord(record);
    await buildCheckout({ checkout, production: true, installedPnpm: "11.10.0", runner });
    expect(runs).toEqual(["pnpm", "pnpm"]);
  });

  it("refuses a directory that is not a Vortex checkout", async () => {
    await expect(buildCheckout({ checkout: dir, production: true })).rejects.toThrow(
      /not a Vortex checkout/,
    );
  });
});
