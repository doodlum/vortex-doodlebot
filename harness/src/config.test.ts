import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ConfigError,
  DEFAULT_CDP_PORT,
  DEFAULT_MCP_PORT,
  REPO_ROOT,
  loadConfig,
  resolveTarget,
  resolveTargetSafely,
} from "./config";
import { DEFAULT_ARTIFACT_DIR, DEFAULT_CACHE_DIR } from "./paths";

/** A checkout with src/main/package.json and a resolvable fake electron module. */
function fakeCheckout(dir: string): string {
  fs.mkdirSync(path.join(dir, "src", "main"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "main", "package.json"), '{"name":"@vortex/main"}');
  const electron = path.join(dir, "node_modules", "electron");
  fs.mkdirSync(electron, { recursive: true });
  fs.writeFileSync(path.join(electron, "package.json"), '{"name":"electron","main":"index.js"}');
  fs.writeFileSync(path.join(electron, "index.js"), "module.exports = 'electron.exe';\n");
  return dir;
}

function clearTargetVariables(): void {
  for (const name of [
    "VORTEX_AI_INSTALLED",
    "VORTEX_AI_EXE",
    "VORTEX_AI_SOURCE_DIR",
    "VORTEX_AI_DEV_DIR",
  ])
    vi.stubEnv(name, undefined);
}

const VARIABLES = [
  "VORTEX_AI_CACHE_DIR",
  "VORTEX_AI_ARTIFACT_DIR",
  "VORTEX_MCP_PORT",
  "VORTEX_AI_CDP_PORT",
] as const;

let saved: Partial<Record<(typeof VARIABLES)[number], string>>;

beforeEach(() => {
  saved = {};
  for (const name of VARIABLES) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of VARIABLES) {
    const value = saved[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("loadConfig", () => {
  it("defaults to the one cache, artifacts folder and ports", () => {
    expect(DEFAULT_MCP_PORT).toBe(3701);
    expect(DEFAULT_CDP_PORT).toBe(9222);
    const config = loadConfig();
    expect(config.cacheDir).toBe(path.resolve(DEFAULT_CACHE_DIR));
    expect(config.artifactDir).toBe(path.resolve(DEFAULT_ARTIFACT_DIR));
    expect(config.mcpPort).toBe(3701);
    expect(config.cdpPort).toBe(9222);
    expect(config).not.toHaveProperty("owner");
    expect(config).not.toHaveProperty("slot");
  });

  it("treats an empty variable as unset", () => {
    for (const name of VARIABLES) process.env[name] = "";
    const config = loadConfig();
    expect(config.cacheDir).toBe(path.resolve(DEFAULT_CACHE_DIR));
    expect(config.mcpPort).toBe(DEFAULT_MCP_PORT);
    expect(config.cdpPort).toBe(DEFAULT_CDP_PORT);
  });

  it("takes the cache, artifacts folder and ports from their variables", () => {
    process.env.VORTEX_AI_CACHE_DIR = path.join("some", "cache");
    process.env.VORTEX_AI_ARTIFACT_DIR = path.join("some", "artifacts");
    process.env.VORTEX_MCP_PORT = "4701";
    process.env.VORTEX_AI_CDP_PORT = "10222";
    const config = loadConfig();
    expect(config.cacheDir).toBe(path.resolve("some", "cache"));
    expect(config.artifactDir).toBe(path.resolve("some", "artifacts"));
    expect(config.mcpPort).toBe(4701);
    expect(config.cdpPort).toBe(10222);
  });

  it("lets --cache-dir, --port and --cdp-port win over their variables", () => {
    process.env.VORTEX_AI_CACHE_DIR = path.join("from", "env");
    process.env.VORTEX_MCP_PORT = "4701";
    process.env.VORTEX_AI_CDP_PORT = "10222";
    const config = loadConfig({
      cacheDir: path.join("from", "flag"),
      mcpPort: 5701,
      cdpPort: 11222,
    });
    expect(config.cacheDir).toBe(path.resolve("from", "flag"));
    expect(config.mcpPort).toBe(5701);
    expect(config.cdpPort).toBe(11222);
  });

  it("resolves a relative VORTEX_AI_SOURCE_DIR against the workspace root", () => {
    const fixture = fakeCheckout(
      path.join(
        REPO_ROOT,
        "harness",
        ".cache",
        `tmp-relsrc-${crypto.randomBytes(4).toString("hex")}`,
      ),
    );
    const previous = process.cwd();
    clearTargetVariables();
    try {
      process.chdir(os.tmpdir());
      vi.stubEnv("VORTEX_AI_SOURCE_DIR", path.relative(REPO_ROOT, fixture));
      const target = resolveTarget();
      expect(target.kind).toBe("dev");
      expect(fs.realpathSync.native(target.sourceDir!)).toBe(fs.realpathSync.native(fixture));
    } finally {
      process.chdir(previous);
      vi.unstubAllEnvs();
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("refuses an explicit --dev-dir that is not a built checkout, even through the safe resolver", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "not-built-"));
    clearTargetVariables();
    try {
      fs.mkdirSync(path.join(dir, "src", "main"), { recursive: true });
      fs.writeFileSync(path.join(dir, "src", "main", "package.json"), "{}");
      const expected = `--dev-dir ${dir} is not a built Vortex checkout: `;
      expect(() => resolveTarget({ devDir: dir })).toThrow(ConfigError);
      expect(() => resolveTarget({ devDir: dir })).toThrow(expected);
      expect(() => resolveTargetSafely({ devDir: dir })).toThrow(expected);
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the safe fallback for the same folder given through VORTEX_AI_DEV_DIR", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "not-built-"));
    clearTargetVariables();
    try {
      fs.mkdirSync(path.join(dir, "src", "main"), { recursive: true });
      fs.writeFileSync(path.join(dir, "src", "main", "package.json"), "{}");
      vi.stubEnv("VORTEX_AI_DEV_DIR", dir);
      expect(() => resolveTargetSafely()).not.toThrow();
      expect(resolveTargetSafely().kind).toBe("installed");
      expect(() => loadConfig()).not.toThrow();
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses invalid or shared ports", () => {
    expect(() => loadConfig({ mcpPort: 0 })).toThrow(/integers from 1 to 65535/);
    process.env.VORTEX_AI_CDP_PORT = "not a port";
    expect(() => loadConfig()).toThrow(/integers from 1 to 65535/);
    delete process.env.VORTEX_AI_CDP_PORT;
    expect(() => loadConfig({ mcpPort: 9222 })).toThrow(/different ports/);
  });
});
