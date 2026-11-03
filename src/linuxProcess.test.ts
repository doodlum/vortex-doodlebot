import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { constants } from "node:fs";
import { copyFile, chmod, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { linuxProcessMatches, linuxProcessRunning } from "./linuxProcess";

type HostExec = (
  command: string,
  args: string[],
  options: Record<string, unknown>,
  callback: (error: Error | null, stdout: string, stderr: string) => void,
) => void;
const { hostExec } = vi.hoisted(() => ({ hostExec: vi.fn<HostExec>() }));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFile: hostExec,
}));
beforeEach(() => {
  vi.stubEnv("FLATPAK_ID", "");
  vi.stubEnv("IS_FLATPAK", "");
});
afterEach(() => {
  hostExec.mockReset();
  vi.unstubAllEnvs();
});

describe("Linux game process identity", () => {
  it.each(["FLATPAK_ID", "IS_FLATPAK"])(
    "queries the host through %s with a literal image argument",
    async (flag) => {
      vi.stubEnv(flag, flag === "IS_FLATPAK" ? "true" : "com.example.ProcessProbe");
      const image = "Long quote'$(literal) game.exe";
      hostExec.mockImplementation((_command, _args, _options, callback) =>
        callback(null, "true\n", ""),
      );
      expect(await linuxProcessRunning(image)).toBe(true);
      expect(hostExec).toHaveBeenCalledWith(
        "flatpak-spawn",
        ["--host", "python3", "-c", expect.any(String), image],
        expect.objectContaining({ timeout: 5000, maxBuffer: 1024, encoding: "utf8" }),
        expect.any(Function),
      );
    },
  );
  it("accepts an explicit host absence response", async () => {
    vi.stubEnv("FLATPAK_ID", "com.example.ProcessProbe");
    hostExec.mockImplementation((_command, _args, _options, callback) =>
      callback(null, "false\n", ""),
    );
    expect(await linuxProcessRunning("absent.exe")).toBe(false);
  });
  it.each(["command failure", "malformed response"])(
    "keeps %s as an observation error rather than absence",
    async (kind) => {
      vi.stubEnv("FLATPAK_ID", "com.example.ProcessProbe");
      hostExec.mockImplementation((_command, _args, _options, callback) =>
        callback(
          kind === "command failure" ? new Error("host access denied") : null,
          "unrecognized response",
          "",
        ),
      );
      await expect(linuxProcessRunning("game.exe")).rejects.toThrow(
        "Could not inspect host processes from Flatpak",
      );
    },
  );
  it.skipIf(process.platform !== "linux")(
    "finds a native executable after its main thread changes its name",
    async () => {
      const directory = await mkdtemp(path.join(os.tmpdir(), "doodlebot-native-image-"));
      const image = `doodlebot-native-${process.pid}`;
      const executable = path.join(directory, image);
      let child: ReturnType<typeof spawn> | undefined;
      try {
        await copyFile(process.execPath, executable, constants.COPYFILE_FICLONE);
        await chmod(executable, 0o755);
        child = spawn(
          executable,
          [
            "-e",
            'process.title = "renamed-thread"; process.send("ready"); setInterval(() => {}, 1000);',
          ],
          { stdio: ["ignore", "ignore", "ignore", "ipc"] },
        );
        await once(child, "message");
        expect(await linuxProcessRunning(image)).toBe(true);
        expect(await linuxProcessRunning(image.toUpperCase())).toBe(false);
      } finally {
        if (child !== undefined && child.exitCode === null && child.signalCode === null) {
          const exited = once(child, "exit");
          child.kill("SIGTERM");
          await exited;
        }
        await rm(directory, { recursive: true, force: true });
      }
    },
    20_000,
  );
  it("matches a truncated Wine name against its full Windows argv", () => {
    expect(
      linuxProcessMatches(
        "Stardew Valley.exe",
        "Stardew Valley.",
        "Z:\\Steam\\Stardew Valley\\Stardew Valley.exe\0",
      ),
    ).toBe(true);
  });
  it("rejects a different full image with the same comm prefix", () => {
    expect(
      linuxProcessMatches(
        "Stardew Valley.exe",
        "Stardew Valley.",
        "/games/Stardew Valley.other.exe\0",
      ),
    ).toBe(false);
  });
  it("does not match an unrelated process merely mentioning the requested image", () => {
    expect(
      linuxProcessMatches(
        "Stardew Valley.exe",
        "python3",
        "python3\0proton\0run\0/games/Stardew Valley.exe\0",
      ),
    ).toBe(false);
  });
  it("folds Windows executable names while keeping native Linux case", () => {
    expect(linuxProcessMatches("Game.exe", "game.exe", "")).toBe(true);
    expect(linuxProcessMatches("Game.sh", "game.sh", "")).toBe(false);
    expect(linuxProcessMatches("Game.sh", "Game.sh", "")).toBe(true);
  });
});
