import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_CDP_PORT, DEFAULT_MCP_PORT, loadConfig } from "./config";
import { DEFAULT_ARTIFACT_DIR, DEFAULT_CACHE_DIR } from "./paths";

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

  it("refuses invalid or shared ports", () => {
    expect(() => loadConfig({ mcpPort: 0 })).toThrow(/integers from 1 to 65535/);
    process.env.VORTEX_AI_CDP_PORT = "not a port";
    expect(() => loadConfig()).toThrow(/integers from 1 to 65535/);
    delete process.env.VORTEX_AI_CDP_PORT;
    expect(() => loadConfig({ mcpPort: 9222 })).toThrow(/different ports/);
  });
});
