import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ForkError,
  commandEnv,
  missingBuildOutputs,
  nestedPath,
  needsShell,
  parsePnpmVersion,
  runStreaming,
  selectPnpmCommand,
} from "./source";

it("preserves source paths containing spaces when invoking git", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vortex source "));
  try {
    await runStreaming("git", ["init", "--bare", path.join(dir, "source repo")], {
      label: "Initialize source fixture",
    });
    expect(fs.existsSync(path.join(dir, "source repo", "HEAD"))).toBe(true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("Vortex source package manager", () => {
  it("reads the exact version while ignoring a Corepack integrity suffix", () => {
    expect(parsePnpmVersion("pnpm@11.10.0+sha512.deadbeef")).toBe("11.10.0");
    expect(parsePnpmVersion("pnpm@11.10.0")).toBe("11.10.0");
  });

  it("rejects an absent or floating package-manager declaration", () => {
    expect(() => parsePnpmVersion(undefined)).toThrow(ForkError);
    expect(() => parsePnpmVersion("pnpm@latest")).toThrow("exact pnpm version");
  });

  it("uses pnpm directly only when its version matches the source checkout", () => {
    expect(selectPnpmCommand("11.10.0", "11.10.0")).toEqual({
      cmd: "pnpm",
      args: [],
      version: "11.10.0",
      exact: true,
    });
  });

  it("uses VORTEX_AI_PNPM instead of pnpm dlx when PATH has another pnpm", () => {
    expect(selectPnpmCommand("11.10.0", "9.15.0", "J:/tools/node22/pnpm.cmd")).toEqual({
      cmd: "J:/tools/node22/pnpm.cmd",
      args: [],
      version: "11.10.0",
      exact: true,
    });
    // a matching pnpm on PATH still wins, and an empty override is no override
    expect(selectPnpmCommand("11.10.0", "11.10.0", "C:/x/pnpm.cmd").cmd).toBe("pnpm");
    expect(selectPnpmCommand("11.10.0", "9.15.0", " ").args).toEqual(["dlx", "pnpm@11.10.0"]);
  });

  it.runIf(process.platform === "win32")("runs pnpm and .cmd shims through a shell", () => {
    expect(needsShell("pnpm")).toBe(true);
    expect(needsShell("J:/tools/node22/pnpm.CMD")).toBe(true);
    expect(needsShell("git")).toBe(false);
  });

  it("bootstraps the checkout's exact version when PATH has another pnpm", () => {
    expect(selectPnpmCommand("11.10.0", "9.15.0", undefined)).toEqual({
      cmd: "pnpm",
      args: ["dlx", "pnpm@11.10.0"],
      version: "11.10.0",
      exact: false,
    });
  });
});

it("finds every worker main's build script bundles that a build left out", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-build-"));
  try {
    const main = path.join(dir, "src", "main");
    fs.mkdirSync(path.join(main, "build"), { recursive: true });
    fs.writeFileSync(
      path.join(main, "build.mjs"),
      `await bundleWorker("./src/bsdiff/worker.ts", "bsdiff-worker.cjs");\n` +
        `await bundleWorker('./src/hash/worker.ts', 'hash-worker.cjs');\n`,
    );
    for (const name of ["main.cjs", "renderer.js", "bsdiff-worker.cjs"])
      fs.writeFileSync(path.join(main, "build", name), "");
    // An nx cache hit restored everything @vortex/main declares, and it didn't declare this.
    expect(missingBuildOutputs(dir)).toEqual(["hash-worker.cjs"]);
    fs.writeFileSync(path.join(main, "build", "hash-worker.cjs"), "");
    expect(missingBuildOutputs(dir)).toEqual([]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it("gives a checkout's own scripts its pnpm, not the kit's", () => {
  const sep = path.delimiter;
  const repo = path.resolve("/kit");
  const PATH = [
    path.join(repo, "node_modules", ".bin"),
    path.resolve("/Users/me/AppData/Local/npm-cache/_npx/abc/node_modules/.bin"),
    path.resolve("/Windows/system32"),
  ].join(sep);
  expect(nestedPath(PATH, undefined, repo)).toBe(path.resolve("/Windows/system32"));
  expect(nestedPath(PATH, path.resolve("/tools/node22/pnpm.cmd"), repo)).toBe(
    [path.resolve("/tools/node22"), path.resolve("/Windows/system32")].join(sep),
  );
});

it("leaves a kit command's environment alone, and cleans a Vortex command's", () => {
  const repo = path.resolve("/kit");
  const PATH = [path.join(repo, "node_modules", ".bin"), path.resolve("/Windows")].join(
    path.delimiter,
  );
  const base = {
    PATH,
    npm_config_user_agent: "pnpm/9.15.0",
    VORTEX_AI_PNPM: path.resolve("/node22/pnpm.cmd"),
  };
  expect(commandEnv(path.join(repo, "harness"), base, repo)).toEqual(base);
  const vortex = commandEnv(path.join(repo, ".vortex-worktrees", "fix-a"), base, repo);
  expect(vortex.npm_config_user_agent).toBeUndefined();
  expect(vortex.PATH).toBe(
    [path.resolve("/node22"), path.resolve("/Windows")].join(path.delimiter),
  );
  expect(commandEnv(path.resolve("/elsewhere"), base, repo).npm_config_user_agent).toBeUndefined();
});

it.runIf(process.platform === "win32")(
  "runs the selected manager with the intended Node and without parent pnpm overrides",
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vortex manager "));
    const shim = path.join(dir, "pnpm.cmd");
    const output = path.join(dir, "observed.json");
    fs.writeFileSync(shim, '@echo off\r\nnode "%~dp0probe.cjs" %*\r\n');
    fs.writeFileSync(
      path.join(dir, "probe.cjs"),
      `
require('fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify({
  executable: process.execPath, version: process.version, args: process.argv.slice(2),
  parentManager: process.env.npm_config_user_agent, parentOverride: process.env.PNPM_TEST_OVERRIDE
}));
`,
    );
    const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
    vi.stubEnv(
      pathKey,
      `${path.dirname(process.execPath)}${path.delimiter}${process.env[pathKey] ?? ""}`,
    );
    vi.stubEnv("VORTEX_AI_PNPM", shim);
    vi.stubEnv("npm_config_user_agent", "pnpm/9.15.0");
    vi.stubEnv("PNPM_TEST_OVERRIDE", "wrong-parent");
    try {
      const manager = selectPnpmCommand("11.10.0", "9.15.0");
      await runStreaming(manager.cmd, [...manager.args, "install"], {
        cwd: dir,
        label: "Runtime probe",
      });
      expect(JSON.parse(fs.readFileSync(output, "utf8"))).toEqual({
        executable: process.execPath,
        version: process.version,
        args: ["install"],
      });
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
