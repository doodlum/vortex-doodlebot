import { describe, expect, it } from "vitest";

import {
  assertNoOwnVortex,
  ownVortexProcesses,
  parseProcessList,
  windowsOnlyWarning,
  type ProcessInfo,
} from "./ownVortex";

describe("off Windows", () => {
  it("warns that the own-Vortex, game and nxm handler protections are Windows-only", () => {
    expect(windowsOnlyWarning("win32")).toBeUndefined();
    for (const platform of ["linux", "darwin"] as const)
      expect(windowsOnlyWarning(platform)).toBe(
        `warning: on ${platform} doodlebot cannot see your own Vortex, a running game or the ` +
          "nxm:// link handler; these protections are Windows-only. Close your own Vortex and " +
          "the game yourself before a run.",
      );
  });
});

const installed: ProcessInfo = {
  pid: 100,
  ppid: 4,
  name: "Vortex.exe",
  exe: "C:\\Program Files\\Black Tree Gaming Ltd\\Vortex\\Vortex.exe",
  commandLine: '"C:\\Program Files\\Black Tree Gaming Ltd\\Vortex\\Vortex.exe"',
};
const devBuild: ProcessInfo = {
  pid: 200,
  ppid: 4,
  name: "electron.exe",
  exe: "D:\\work\\Vortex\\node_modules\\electron\\dist\\electron.exe",
  commandLine:
    '"D:\\work\\Vortex\\node_modules\\electron\\dist\\electron.exe" D:\\work\\Vortex\\src\\main',
};
const handStartedSource: ProcessInfo = {
  pid: 300,
  ppid: 4,
  name: "electron.exe",
  exe: "C:\\dev\\Vortex-worktrees\\fix-123\\node_modules\\electron\\dist\\electron.exe",
  commandLine:
    '"C:\\dev\\Vortex-worktrees\\fix-123\\node_modules\\electron\\dist\\electron.exe" C:\\dev\\Vortex-worktrees\\fix-123\\src\\main',
};
const releaseOutsideTree: ProcessInfo = {
  pid: 400,
  ppid: 4,
  name: "Vortex.exe",
  exe: "C:\\Users\\me\\.doodlebot\\releases\\2.8.0\\app\\Vortex.exe",
  commandLine: '"C:\\Users\\me\\.doodlebot\\releases\\2.8.0\\app\\Vortex.exe"',
};

/** The harness Vortex (pid 500) and the helpers Electron starts under it. */
const harnessTree: ProcessInfo[] = [
  {
    pid: 500,
    ppid: 77,
    name: "Vortex.exe",
    exe: "C:\\Users\\me\\.doodlebot\\releases\\2.8.0\\app\\Vortex.exe",
    commandLine:
      '"C:\\Users\\me\\.doodlebot\\releases\\2.8.0\\app\\Vortex.exe" --remote-debugging-port=9222',
  },
  { pid: 501, ppid: 500, name: "Vortex.exe", commandLine: "Vortex.exe --type=gpu-process" },
  { pid: 502, ppid: 500, name: "Vortex.exe", commandLine: "Vortex.exe --type=renderer" },
  { pid: 503, ppid: 502, name: "Vortex.exe", commandLine: "Vortex.exe --type=utility" },
];

describe("the owner's own Vortex", () => {
  it.each([
    ["an installed Vortex.exe", installed],
    ["an electron dev build", devBuild],
    ["a hand-started worktree build", handStartedSource],
    ["a registered release outside the recorded tree", releaseOutsideTree],
  ])("refuses %s", (_label, process) => {
    expect(ownVortexProcesses([...harnessTree, process], 500)).toEqual([process]);
    expect(() => assertNoOwnVortex(500, () => [...harnessTree, process])).toThrow(
      `Your own Vortex is running (pid ${String(process.pid)}). Close it, then retry.`,
    );
  });

  it("does not refuse the harness's own process tree", () => {
    expect(ownVortexProcesses(harnessTree, 500)).toEqual([]);
    expect(() => assertNoOwnVortex(500, () => harnessTree)).not.toThrow();
  });

  it("counts the harness tree as the owner's when no instance is recorded", () => {
    expect(ownVortexProcesses(harnessTree).map((p) => p.pid)).toEqual([500]);
  });

  it("ignores Electron helpers and unrelated Electron apps", () => {
    const helperLeft: ProcessInfo = {
      pid: 600,
      ppid: 1,
      name: "Vortex.exe",
      commandLine: '"C:\\Vortex\\Vortex.exe" --type=crashpad-handler --database=x',
    };
    const otherApp: ProcessInfo = {
      pid: 601,
      ppid: 1,
      name: "electron.exe",
      exe: "C:\\proj\\notes\\node_modules\\electron\\dist\\electron.exe",
      commandLine: '"C:\\proj\\notes\\node_modules\\electron\\dist\\electron.exe" .',
    };
    expect(ownVortexProcesses([helperLeft, otherApp])).toEqual([]);
  });

  it("reads PowerShell's JSON for one process and for several", () => {
    const one = JSON.stringify({
      ProcessId: 9,
      ParentProcessId: 1,
      Name: "Vortex.exe",
      ExecutablePath: "C:\\V\\Vortex.exe",
      CommandLine: null,
    });
    expect(parseProcessList(one)).toEqual([
      { pid: 9, ppid: 1, name: "Vortex.exe", exe: "C:\\V\\Vortex.exe" },
    ]);
    expect(parseProcessList(`[${one},${one}]`)).toHaveLength(2);
    expect(parseProcessList("[]")).toEqual([]);
    expect(parseProcessList("")).toEqual([]);
  });
});
