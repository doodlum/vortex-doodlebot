import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { removePersistedOAuthBeforeLaunch } from "./oauthProfile";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "doodlebot-oauth-startup-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const cacheDir = path.join(root, "cache");
  const dataDir = path.join(cacheDir, "live", "userData");
  const stateDir = path.join(dataDir, "state.v2");
  const state = path.join(stateDir, "mock-state.json");
  const oauth = path.join(root, "oauth.json");
  const cli = path.join(root, "state-command.cjs");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(state, JSON.stringify({ oauth: "spent-snapshot", apiKey: "unrelated-fixture" }));
  fs.writeFileSync(oauth, JSON.stringify({ refreshToken: "current-shared-cache" }));
  fs.writeFileSync(
    cli,
    `const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const [, , dataFlag, dir, deleteFlag, key] = process.argv;
assert.equal(dataFlag, "--user-data");
assert.equal(dir, process.env.ELECTRON_USERDATA);
assert.equal(deleteFlag, "--del");
assert.equal(key, "confidential.account.nexus.OAuthCredentials");
assert.equal(process.env.VORTEX_AI_AUTH_CACHE, undefined);
assert.equal(process.env.VORTEX_MCP_TOKEN, undefined);
const stateFile = path.join(dir, "state.v2", "mock-state.json");
const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
delete state.oauth;
fs.writeFileSync(stateFile, JSON.stringify(state));`,
  );
  const config = {
    cacheDir,
    target: {
      kind: "dev" as const,
      executable: process.execPath,
      args: [cli, "--game", "fallout4"],
      appName: "test",
    },
  };
  const env = {
    ELECTRON_USERDATA: dataDir,
    VORTEX_AI_AUTH_CACHE: oauth,
    VORTEX_MCP_TOKEN: "mcp-fixture",
  };
  const readState = () => JSON.parse(fs.readFileSync(state, "utf8"));
  return { config, env, oauth, cli, readState };
}

it("clears the snapshot token before normal startup and leaves the shared cache intact", async () => {
  const { config, env, oauth, readState } = fixture();
  expect(readState().oauth).toBe("spent-snapshot");
  await removePersistedOAuthBeforeLaunch(config, env);
  expect(readState()).toEqual({ apiKey: "unrelated-fixture" });
  expect(JSON.parse(fs.readFileSync(oauth, "utf8"))).toEqual({
    refreshToken: "current-shared-cache",
  });
});

it("honours a signed-out cache while leaving a legacy profile alone if there is no cache", async () => {
  const { config, env, oauth, readState } = fixture();
  fs.rmSync(oauth);
  await removePersistedOAuthBeforeLaunch(config, env);
  expect(readState().oauth).toBe("spent-snapshot");
  fs.writeFileSync(oauth, "null");
  await removePersistedOAuthBeforeLaunch(config, env);
  expect(readState().oauth).toBeUndefined();
  expect(fs.readFileSync(oauth, "utf8")).toBe("null");
});

it("rejects a database outside the isolated cache", async () => {
  const { config, env, readState } = fixture();
  const other = path.join(root, "other");
  fs.mkdirSync(other);
  await expect(
    removePersistedOAuthBeforeLaunch({ ...config, cacheDir: other }, env),
  ).rejects.toThrow("inside the test cache");
  expect(readState().oauth).toBe("spent-snapshot");
});

it("rejects a junction to a different database even inside the cache root", async () => {
  const { config, env, readState } = fixture();
  const redirect = path.join(config.cacheDir, "redirect");
  fs.symlinkSync(
    env.ELECTRON_USERDATA,
    redirect,
    process.platform === "win32" ? "junction" : "dir",
  );
  await expect(
    removePersistedOAuthBeforeLaunch(config, { ...env, ELECTRON_USERDATA: redirect }),
  ).rejects.toThrow("redirected test database");
  expect(readState().oauth).toBe("spent-snapshot");
});

it("fails startup without printing helper diagnostics if Vortex could not delete the key", async () => {
  const { config, env, cli, readState } = fixture();
  fs.writeFileSync(cli, 'process.stderr.write("fixture confidential diagnostic");');
  const result = removePersistedOAuthBeforeLaunch(config, env);
  await expect(result).rejects.toThrow("Could not clear copied OAuth credentials");
  await expect(result).rejects.not.toThrow("fixture confidential diagnostic");
  expect(readState().oauth).toBe("spent-snapshot");
});
