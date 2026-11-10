import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { type VortexTarget, loadConfig } from "./config";
import { authCacheFile } from "./instance";
import {
  aclPrincipals,
  checkLoginAcl,
  describeMigration,
  loginFileFor,
  loginState,
  migrateDefaultLogin,
  sharedLoginDir,
  usesSharedLogin,
} from "./login";
import { DEFAULT_CACHE_DIR, USER_STATE_DIR } from "./paths";

const dirs: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "login-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const LOGIN = JSON.stringify({ token: "t", refreshToken: "r" });
const installed: VortexTarget = { kind: "installed", executable: "", args: [], appName: "Vortex" };

describe("which login a cache uses", () => {
  it("is the shared ~/.doodlebot/login file for the default cache, per target", () => {
    const config = loadConfig({ cacheDir: DEFAULT_CACHE_DIR, target: installed });
    const file = authCacheFile(config);
    expect(path.dirname(file)).toBe(path.join(USER_STATE_DIR, "login"));
    expect(path.basename(file)).toMatch(/^oauth-[0-9a-f]{16}\.json$/);
    const source = loadConfig({
      cacheDir: DEFAULT_CACHE_DIR,
      target: { kind: "dev", executable: "", args: [], appName: "@vortex/main" },
    });
    expect(authCacheFile(source)).not.toBe(file);
    expect(path.dirname(authCacheFile(source))).toBe(sharedLoginDir());
  });

  it("is the shared file for a cache that opts in, and the cache's own for any other", () => {
    const cache = tempDir();
    const own = loadConfig({ cacheDir: cache, target: installed });
    expect(usesSharedLogin(own)).toBe(false);
    expect(path.dirname(authCacheFile(own))).toBe(cache);
    const nexusSmoke = loadConfig({
      cacheDir: path.join(cache, "nexus-smoke"),
      target: installed,
      sharedLogin: true,
    });
    expect(usesSharedLogin(nexusSmoke)).toBe(true);
    expect(authCacheFile(nexusSmoke)).toBe(
      authCacheFile(loadConfig({ cacheDir: DEFAULT_CACHE_DIR, target: installed })),
    );
    // The default cache spelled another way is still the default cache.
    expect(usesSharedLogin({ cacheDir: `${DEFAULT_CACHE_DIR}${path.sep}` })).toBe(true);
    expect(loginFileFor({ cacheDir: cache }, "oauth-x.json", "/state")).toBe(
      path.join(cache, "oauth-x.json"),
    );
    expect(loginFileFor({ cacheDir: DEFAULT_CACHE_DIR }, "oauth-x.json", "/state")).toBe(
      path.join("/state", "login", "oauth-x.json"),
    );
  });

  it("reads a file as a login, signed out, invalid or missing", () => {
    const dir = tempDir();
    const file = (name: string, text: string): string => {
      fs.writeFileSync(path.join(dir, name), text);
      return path.join(dir, name);
    };
    expect(loginState(file("a.json", LOGIN))).toBe("login");
    expect(loginState(file("b.json", "null"))).toBe("signed-out");
    expect(loginState(file("c.json", "{"))).toBe("invalid");
    expect(loginState(path.join(dir, "none.json"))).toBe("missing");
  });
});

describe("the one-time move from the default cache", () => {
  function setup() {
    const root = tempDir();
    const fromDir = path.join(root, "harness", ".cache");
    const stateDir = path.join(root, "state");
    fs.mkdirSync(fromDir, { recursive: true });
    return { fromDir, stateDir, running: () => undefined };
  }

  it("moves a login once, leaving signed-out markers where they are", () => {
    const deps = setup();
    fs.writeFileSync(path.join(deps.fromDir, "oauth-aaaa.json"), LOGIN);
    fs.writeFileSync(path.join(deps.fromDir, "oauth-bbbb.json"), "null");
    const result = migrateDefaultLogin(deps);
    const moved = path.join(deps.stateDir, "login", "oauth-aaaa.json");
    expect(result.moved).toEqual([moved]);
    expect(fs.readFileSync(moved, "utf8")).toBe(LOGIN);
    expect(fs.existsSync(path.join(deps.fromDir, "oauth-aaaa.json"))).toBe(false);
    expect(fs.readFileSync(path.join(deps.fromDir, "oauth-bbbb.json"), "utf8")).toBe("null");
    expect(result.left.map((left) => path.basename(left.file))).toEqual(["oauth-bbbb.json"]);
    expect(describeMigration(result)).toContain("moved the Nexus login");
    expect(migrateDefaultLogin(deps).moved).toEqual([]);
  });

  it("never overwrites an existing shared login", () => {
    const deps = setup();
    fs.mkdirSync(path.join(deps.stateDir, "login"), { recursive: true });
    fs.writeFileSync(path.join(deps.stateDir, "login", "oauth-aaaa.json"), "first workspace");
    fs.writeFileSync(path.join(deps.fromDir, "oauth-aaaa.json"), LOGIN);
    const result = migrateDefaultLogin(deps);
    expect(result.moved).toEqual([]);
    expect(result.left[0]?.reason).toContain("already holds the shared login");
    expect(fs.readFileSync(path.join(deps.stateDir, "login", "oauth-aaaa.json"), "utf8")).toBe(
      "first workspace",
    );
    expect(fs.readFileSync(path.join(deps.fromDir, "oauth-aaaa.json"), "utf8")).toBe(LOGIN);
  });

  it("refuses while a harness Vortex runs", () => {
    const deps = { ...setup(), running: () => ({ pid: 42 }) };
    fs.writeFileSync(path.join(deps.fromDir, "oauth-aaaa.json"), LOGIN);
    const result = migrateDefaultLogin(deps);
    expect(result.refused).toContain("pid 42");
    expect(result.moved).toEqual([]);
    expect(fs.existsSync(path.join(deps.stateDir, "login"))).toBe(false);
    expect(describeMigration(result)).toMatch(/^login not moved yet/);
  });

  it("does nothing without a default cache", () => {
    expect(migrateDefaultLogin({ fromDir: path.join(tempDir(), "absent") })).toEqual({
      moved: [],
      left: [],
    });
  });
});

describe("the login folder's ACL", () => {
  const dir = "C:\\Users\\ada\\.doodlebot\\login";
  const output = (...extra: string[]): string =>
    [
      `${dir} NT AUTHORITY\\SYSTEM:(I)(OI)(CI)(F)`,
      "                                BUILTIN\\Administrators:(I)(OI)(CI)(F)",
      "                                ADA-PC\\ada:(I)(OI)(CI)(F)",
      ...extra.map((line) => `                                ${line}`),
      "",
      "Successfully processed 1 files; Failed processing 0 files",
    ].join("\r\n");

  it("reads the principals of icacls output", () => {
    expect(aclPrincipals(output(), dir)).toEqual([
      "NT AUTHORITY\\SYSTEM",
      "BUILTIN\\Administrators",
      "ADA-PC\\ada",
    ]);
  });

  it("passes for the user, SYSTEM and Administrators, and reports anyone else with the fix", () => {
    const folder = tempDir();
    const check = (text: string) =>
      checkLoginAcl(folder, {
        platform: "win32",
        user: "ada",
        icacls: () => text.replace(dir, folder),
      });
    expect(check(output())).toMatchObject({ ok: true, others: [] });
    const open = check(output("BUILTIN\\Users:(I)(OI)(CI)(RX)", "Everyone:(R)"));
    expect(open.ok).toBe(false);
    expect(open.others).toEqual(["BUILTIN\\Users", "Everyone"]);
    expect(open.fix).toContain(`icacls "${folder}" /inheritance:r /grant:r "ada:(OI)(CI)F"`);
  });

  it("passes when there is no shared login folder yet", () => {
    expect(checkLoginAcl(path.join(tempDir(), "none"), { platform: "win32" }).ok).toBe(true);
  });
});
