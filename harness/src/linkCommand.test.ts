import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  NO_BIN_DIR,
  WORKSPACE_RECORD,
  binDirCandidates,
  chooseBinDir,
  formatLink,
  link,
  onPath,
  shimContents,
  type LinkEnvironment,
} from "./linkCommand";

let temp: string;
beforeEach(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "doodlebot-link-"));
});
afterEach(() => fs.rmSync(temp, { recursive: true, force: true }));

function windows(overrides: Partial<LinkEnvironment> = {}): LinkEnvironment {
  return {
    platform: "win32",
    env: {},
    execPath: "C:\\nvm\\v24\\node.exe",
    writable: () => true,
    realpath: (file) => {
      throw new Error(`no such folder ${file}`);
    },
    ...overrides,
  };
}

function linux(overrides: Partial<LinkEnvironment> = {}): LinkEnvironment {
  return {
    platform: "linux",
    env: {},
    execPath: "/opt/node/bin/node",
    writable: () => true,
    realpath: (file) => {
      throw new Error(`no such folder ${file}`);
    },
    ...overrides,
  };
}

describe("shim contents", () => {
  it("runs bin/doodlebot.cjs with this Node, in cmd and in sh", () => {
    const { cmd, sh } = shimContents("C:\\Users\\me\\doodlebot", "C:\\nvm\\v24\\node.exe");
    expect(cmd).toBe(
      '@"C:\\nvm\\v24\\node.exe" "C:\\Users\\me\\doodlebot\\bin\\doodlebot.cjs" %*\r\n',
    );
    expect(sh).toBe(
      '#!/bin/sh\nexec "C:/nvm/v24/node.exe" "C:/Users/me/doodlebot/bin/doodlebot.cjs" "$@"\n',
    );
    expect(shimContents("/home/me/doodlebot", "/usr/bin/node").sh).toBe(
      '#!/bin/sh\nexec "/usr/bin/node" "/home/me/doodlebot/bin/doodlebot.cjs" "$@"\n',
    );
  });

  it("writes doodlebot.cmd and the extensionless script on Windows, and prints the .cmd", () => {
    const bin = path.join(temp, "bin");
    const root = path.join(temp, "workspace");
    const environment = windows({ env: { Path: `C:\\Windows;${bin}` } });
    const result = link({ binDir: bin, root }, environment);
    const cmd = path.join(bin, "doodlebot.cmd");
    const script = path.join(bin, "doodlebot");
    expect(result).toEqual({ shim: cmd, files: [cmd, script], onPath: true });
    expect(fs.readFileSync(cmd, "utf8")).toBe(shimContents(root, environment.execPath).cmd);
    expect(fs.readFileSync(script, "utf8")).toBe(shimContents(root, environment.execPath).sh);
    expect(formatLink(result)).toBe(`shim: ${cmd}\non PATH: yes`);
  });

  it("writes only the extensionless script elsewhere, and says when the folder is not on the PATH", () => {
    const bin = path.join(temp, "bin").replace(/\\/g, "/");
    const environment = linux({ env: { PATH: "/usr/bin:/bin" } });
    const result = link({ binDir: bin, root: "/home/me/doodlebot" }, environment);
    expect(result.files).toHaveLength(1);
    expect(result.shim).toBe(result.files[0]);
    expect(path.basename(result.shim)).toBe("doodlebot");
    expect(fs.existsSync(path.join(temp, "bin", "doodlebot.cmd"))).toBe(false);
    expect(fs.readFileSync(result.shim, "utf8")).toBe(
      shimContents("/home/me/doodlebot", "/opt/node/bin/node").sh,
    );
    expect(formatLink(result)).toBe(`shim: ${result.shim}\non PATH: no`);
  });

  it("records the workspace in workspace.json for the plugin's SessionStart hook", () => {
    const bin = path.join(temp, "bin");
    const root = path.join(temp, "workspace");
    const stateDir = path.join(temp, "state");
    const result = link({ binDir: bin, root }, windows({ stateDir }));
    const record = path.join(stateDir, WORKSPACE_RECORD);
    expect(result.record).toBe(record);
    expect(JSON.parse(fs.readFileSync(record, "utf8"))).toEqual({
      workspace: root,
      shim: result.shim,
    });
    expect(formatLink(result)).toContain(`workspace record: ${record}`);
    // Linking another workspace takes over, as the shims do.
    link({ binDir: bin, root: path.join(temp, "other") }, windows({ stateDir }));
    expect(JSON.parse(fs.readFileSync(record, "utf8"))).toEqual({
      workspace: path.join(temp, "other"),
      shim: result.shim,
    });
  });
});

describe("the default folder", () => {
  it("prefers npm_config_prefix on Windows, then %APPDATA%\\npm, then Node's own folder", () => {
    const all = windows({
      env: {
        npm_config_prefix: "D:\\npm-prefix",
        APPDATA: "C:\\Users\\me\\AppData\\Roaming",
        PATH: "D:\\npm-prefix;C:\\Users\\me\\AppData\\Roaming\\npm;C:\\nvm\\v24",
      },
    });
    expect(binDirCandidates(all)).toEqual([
      "D:\\npm-prefix",
      "C:\\Users\\me\\AppData\\Roaming\\npm",
      "C:\\nvm\\v24",
    ]);
    expect(chooseBinDir(all)).toBe("D:\\npm-prefix");
    expect(chooseBinDir({ ...all, env: { ...all.env, npm_config_prefix: undefined } })).toBe(
      "C:\\Users\\me\\AppData\\Roaming\\npm",
    );
    expect(chooseBinDir({ ...all, env: { PATH: "C:\\nvm\\v24" } })).toBe("C:\\nvm\\v24");
  });

  it("uses the prefix's bin folder, then Node's prefix bin folder, elsewhere", () => {
    const environment = linux({
      env: {
        npm_config_prefix: "/home/me/.npm-global",
        PATH: "/home/me/.npm-global/bin:/opt/node/bin",
      },
    });
    expect(binDirCandidates(environment)).toEqual(["/home/me/.npm-global/bin", "/opt/node/bin"]);
    expect(chooseBinDir(environment)).toBe("/home/me/.npm-global/bin");
    expect(chooseBinDir(linux({ env: { PATH: "/usr/bin:/opt/node/bin" } }))).toBe("/opt/node/bin");
  });

  it("skips a candidate that is not on the PATH or not writable", () => {
    const env = { APPDATA: "C:\\Roaming", PATH: "C:\\Roaming\\npm;C:\\nvm\\v24" };
    expect(chooseBinDir(windows({ env, writable: (dir) => dir !== "C:\\Roaming\\npm" }))).toBe(
      "C:\\nvm\\v24",
    );
    expect(chooseBinDir(windows({ env: { APPDATA: "C:\\Roaming", PATH: "C:\\nvm\\v24" } }))).toBe(
      "C:\\nvm\\v24",
    );
  });

  it("fails when no candidate qualifies", () => {
    expect(() => chooseBinDir(windows({ env: { PATH: "C:\\Windows" } }))).toThrow(NO_BIN_DIR);
    expect(() =>
      chooseBinDir(linux({ env: { PATH: "/opt/node/bin" }, writable: () => false })),
    ).toThrow("No writable folder on the PATH for the doodlebot shim; pass --bin-dir <folder>.");
  });

  it("writes into the chosen folder without --bin-dir", () => {
    const bin = path.join(temp, "global");
    fs.mkdirSync(bin);
    const result = link(
      { root: path.join(temp, "workspace") },
      windows({ env: { npm_config_prefix: bin, PATH: bin } }),
    );
    expect(result.shim).toBe(path.join(bin, "doodlebot.cmd"));
    expect(result.onPath).toBe(true);
  });
});

describe("PATH detection", () => {
  const real = (file: string) => fs.realpathSync.native(file);

  it("compares real paths, case-insensitively on Windows", () => {
    const bin = path.join(temp, "Bin");
    fs.mkdirSync(bin);
    const environment = windows({
      realpath: real,
      env: { PATH: `C:\\Windows;${bin.toUpperCase()}` },
    });
    expect(onPath(bin, environment)).toBe(true);
    expect(onPath(bin.toLowerCase(), environment)).toBe(true);
    expect(onPath(path.join(temp, "other"), environment)).toBe(false);
    // Case matters elsewhere.
    expect(onPath("/opt/Node/bin", linux({ env: { PATH: "/opt/node/bin" } }))).toBe(false);
  });

  it("ignores trailing separators and quotes", () => {
    const bin = path.join(temp, "bin");
    fs.mkdirSync(bin);
    expect(onPath(bin, windows({ realpath: real, env: { PATH: `${bin}\\` } }))).toBe(true);
    expect(onPath(`${bin}\\\\`, windows({ realpath: real, env: { PATH: `"${bin}"` } }))).toBe(true);
    expect(onPath("/opt/node/bin/", linux({ env: { PATH: "/usr/bin:/opt/node/bin//" } }))).toBe(
      true,
    );
  });

  it("follows a folder's real path", () => {
    const target = path.join(temp, "target");
    fs.mkdirSync(target);
    const linkDir = path.join(temp, "alias");
    fs.symlinkSync(target, linkDir, "junction");
    expect(onPath(linkDir, windows({ realpath: real, env: { PATH: target } }))).toBe(
      process.platform === "win32",
    );
  });
});
