import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertRealModeSupported,
  assertRealModeTarget,
  errorNotifications,
  protectProtocolRegistration,
  realModeArgs,
  realModeEnv,
  rendererCrashes,
} from "./realMode";

describe("realModeEnv", () => {
  it("drops harness-only switches and isolates the Electron profile", () => {
    const env = realModeEnv(
      {
        PATH: "/usr/bin",
        VORTEX_E2E: "1",
        ELECTRON_USERDATA: "/cache/userData",
        VORTEX_MCP_TOKEN: "secret",
        NODE_ENV: "test",
        XDG_CONFIG_HOME: "/home/user/.config",
      },
      "/cache/real-mode/config",
      "production",
    );
    expect(env).toEqual({
      PATH: "/usr/bin",
      NODE_ENV: "production",
      XDG_CONFIG_HOME: "/cache/real-mode/config",
      XDG_DATA_HOME: path.join("/cache/real-mode/config", "data"),
    });
  });

  it("leaves NODE_ENV unset for an installed build", () => {
    expect(realModeEnv({ NODE_ENV: "development" }, "/c", undefined)).toEqual({
      XDG_CONFIG_HOME: "/c",
      XDG_DATA_HOME: path.join("/c", "data"),
    });
  });
});

it("supports Linux and Windows, where the profile and link registration stay private", () => {
  expect(() => assertRealModeSupported("darwin")).toThrow(/Linux and Windows/);
  expect(() => assertRealModeSupported("linux")).not.toThrow();
  expect(() => assertRealModeSupported("win32")).not.toThrow();
});

it("keeps Electron's whole profile inside the run's folder", () => {
  expect(realModeArgs("/cache/real-mode/config", "win32")).toEqual([
    `--user-data-dir=${path.join("/cache/real-mode/config", "Vortex")}`,
  ]);
  expect(realModeArgs("/cache/real-mode/config", "linux")).toEqual([]);
});

it("needs a packaged or installed Vortex on Windows", () => {
  expect(() => assertRealModeTarget("dev", "win32")).toThrow(/packaged or installed/);
  expect(() => assertRealModeTarget("installed", "win32")).not.toThrow();
  expect(() => assertRealModeTarget("dev", "linux")).not.toThrow();
});

it("only touches the nxm registration on Windows", () => {
  const restore = protectProtocolRegistration("/unused", "linux");
  expect(restore).not.toThrow();
});

it("finds renderer crashes and error notifications in Vortex's log", () => {
  const log = [
    '2026-10-22T21:02:58Z [INFO] [RENDERER] found game {"name":"Stardew Valley"}',
    '2026-10-22T21:03:03Z [ERRO] [MAIN] [diag] render-process-gone {"exitCode":139,"reason":"crashed"}',
    '2026-10-22T21:03:03Z [ERRO] [MAIN] render process gone {"exitCode":139,"reason":"crashed"}',
    '2026-10-22T21:06:04Z [WARN] [RENDERER] error notification {"message":"Mods can\'t be deployed."}',
    '2026-10-22T21:06:05Z [WARN] [RENDERER] warning notification {"message":"SKSE64 not installed"}',
  ].join("\n");
  expect(rendererCrashes(log).map(({ line }) => line)).toEqual([2, 3]);
  expect(errorNotifications(log)).toEqual(["Mods can't be deployed."]);
});
