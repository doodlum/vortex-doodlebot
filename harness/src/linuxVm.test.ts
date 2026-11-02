import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";
import * as processRunner from "./processRunner";
import { parseArgs } from "./cliArgs";
import {
  deployLinuxVm,
  linuxVmCommand,
  linuxDesktopCommand,
  runLinuxDesktop,
  shellQuote,
  sshArgs,
  validateLinuxVm,
} from "./linuxVm";
import { listLeases } from "./lease";
import { linuxDisplayArgs } from "./instance";

const options = { host: "dev@linux-vm", directory: "/home/dev/doodlebot", owner: "linux-qa" };
const temporary: string[] = [];
afterEach(() =>
  temporary.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })),
);

afterEach(() => vi.restoreAllMocks());

function mockDeployment(failure?: "existing" | "interrupted") {
  return vi.spyOn(processRunner, "runEvidenceProcess").mockImplementation(async (request) => {
    if (request.args[0] === "bundle") fs.writeFileSync(request.args[2]!, "bundle fixture");
    if (request.args[0] === "diff") {
      const output = request.args.find((arg) => arg.startsWith("--output="))!;
      fs.writeFileSync(output.slice("--output=".length), "");
    }
    const refuses = failure === "existing" && request.executable === "ssh";
    const aborted = failure === "interrupted" && request.executable === "scp";
    return {
      code: refuses ? 1 : aborted ? null : 0,
      signal: null,
      output: "",
      stdout: "",
      aborted,
    };
  });
}

describe("deployment orchestration", () => {
  it("does not upload or extract into an existing guest destination", async () => {
    const runner = mockDeployment("existing");
    await expect(deployLinuxVm(options)).rejects.toThrow(/ssh failed/);
    expect(runner.mock.calls.some(([request]) => request.executable === "scp")).toBe(false);
    expect(runner.mock.calls.filter(([request]) => request.executable === "ssh")).toHaveLength(1);
  });

  it("refuses ignored/nonlisted include files before contacting the guest", async () => {
    const runner = mockDeployment();
    await expect(deployLinuxVm({ ...options, include: ["harness/.env"] })).rejects.toThrow(
      /--include/,
    );
    expect(runner.mock.calls.every(([request]) => request.executable === "git")).toBe(true);
  });

  it("does not start guest extraction after interrupted transfer", async () => {
    const runner = mockDeployment("interrupted");
    await expect(deployLinuxVm(options)).rejects.toThrow(/scp failed/);
    expect(runner.mock.calls.filter(([request]) => request.executable === "ssh")).toHaveLength(1);
  });

  it("uploads only the bundle and patch by default and requires a verified fresh directory", async () => {
    const runner = mockDeployment();
    let archive: Record<string, Uint8Array> = {};
    const implementation = runner.getMockImplementation()!;
    runner.mockImplementation(async (request) => {
      if (request.executable === "scp") archive = unzipSync(fs.readFileSync(request.args.at(-2)!));
      return implementation(request);
    });
    await expect(deployLinuxVm(options)).resolves.toBe(0);
    expect(Object.keys(archive).sort()).toEqual(["source.bundle", "working.patch"]);
    const remote = runner.mock.calls.filter(([request]) => request.executable === "ssh");
    expect(remote).toHaveLength(2);
    expect(remote[1]![0].args.at(-1)).toContain("sha256sum -c -");
    expect(remote[1]![0].args.at(-1)).toContain("mkdir");
    expect(remote[1]![0].args.at(-1)).not.toContain("mkdir -p");
  });
});

describe("Linux VM transport", () => {
  it("forwards a desktop session through stdin without exporting an operation context", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-lease-"));
    temporary.push(dir);
    const runner = vi.spyOn(processRunner, "runEvidenceProcess").mockResolvedValue({
      code: 7,
      signal: null,
      output: "",
      stdout: "",
      aborted: false,
    });
    expect(await runLinuxDesktop({ ...options, leaseEnv: { dir } })).toBe(7);
    const request = runner.mock.calls[0]![0];
    expect(request.input).toBe(process.stdin);
    expect(request.stdin).toBeUndefined();
    expect(request.args[0]).toBe("-T");
    expect(request.context?.owner).toBe(options.owner);
    expect(request.context?.resources).toEqual([`vm-desktop:${options.host}`]);
    expect(request.args.at(-1)).toContain("unset VORTEX_AI_OPERATION_CONTEXT");
    expect(request.args.at(-1)).toContain("harness/linux_desktop.py");
    expect(request.args).toContain("StrictHostKeyChecking=yes");
    expect(listLeases({ dir }).filter((entry) => entry.live)).toEqual([]);
  });

  it("reports cancellation even when the desktop child closes with zero", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-cancel-"));
    temporary.push(dir);
    vi.spyOn(processRunner, "runEvidenceProcess").mockResolvedValue({
      code: 0,
      signal: null,
      output: "",
      stdout: "",
      aborted: true,
    });
    expect(await runLinuxDesktop({ ...options, leaseEnv: { dir } })).toBe(130);
    expect(listLeases({ dir }).filter((entry) => entry.live)).toEqual([]);
  });

  it("validates the guest-only desktop cache before opening SSH", async () => {
    const runner = vi.spyOn(processRunner, "runEvidenceProcess");
    await expect(runLinuxDesktop({ ...options, desktopCacheDir: "/tmp/cache;id" })).rejects.toThrow(
      /directory/,
    );
    expect(runner).not.toHaveBeenCalled();
    expect(
      linuxDesktopCommand({ ...options, desktopCacheDir: "/home/dev/.cache/private" }),
    ).toContain("--cache-dir");
  });

  it("parses the desktop subcommand and its guest cache without swallowing host flags", () => {
    const parsed = parseArgs([
      "vm",
      "desktop",
      "--host",
      options.host,
      "--owner",
      options.owner,
      "--directory",
      options.directory,
      "--desktop-cache-dir",
      "/home/dev/.cache/private",
    ]);
    expect(parsed.positional).toEqual(["desktop"]);
    expect(parsed.flags["desktop-cache-dir"]).toBe("/home/dev/.cache/private");
    expect(parsed.flags.host).toBe(options.host);
  });

  it("preserves harness flags after the command separator", () => {
    const parsed = parseArgs([
      "vm",
      "run",
      "--host",
      options.host,
      "--directory",
      options.directory,
      "--owner",
      options.owner,
      "--",
      "up",
      "--sandbox",
      "--slot",
      "auto",
    ]);
    expect(parsed.positional).toEqual(["run"]);
    expect(parsed.passthrough).toEqual(["up", "--sandbox", "--slot", "auto"]);
    expect(parsed.flags.owner).toBe(options.owner);
  });

  it.each(["-oProxyCommand=oops", "dev@host;echo oops", "host\nother", "dev@host:22"])(
    "rejects SSH option injection %s",
    (host) => {
      expect(() => validateLinuxVm({ ...options, host })).toThrow(/--host/);
    },
  );

  it.each(["/", "~/kit", "/home/dev/../other", "/home/dev/./kit", "/tmp/kit;id"])(
    "rejects unsafe guest path %s",
    (directory) => {
      expect(() => validateLinuxVm({ ...options, directory })).toThrow(/--directory/);
    },
  );

  it("quotes all remote arguments and leaves SSH host-key checks enabled", () => {
    expect(shellQuote("a'b $(id);\nnext")).toBe("'a'\\''b $(id);\nnext'");
    const command = linuxVmCommand(options, [
      "call",
      "ui_snapshot",
      "--args",
      '{"text":"$(touch /tmp/nope)"}',
    ]);
    expect(command).toContain("unset VORTEX_AI_OPERATION_CONTEXT");
    expect(command).toContain("VORTEX_AI_OWNER=");
    expect(sshArgs(options.host, command)).toEqual([
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "ConnectTimeout=10",
      options.host,
      command,
    ]);
    expect(() => shellQuote("bad\0arg")).toThrow(/NUL/);
  });

  it("selects a native backend only on Linux", () => {
    expect(linuxDisplayArgs("linux", "wayland")).toEqual(["--ozone-platform=wayland"]);
    expect(linuxDisplayArgs("linux", "x11")).toEqual(["--ozone-platform=x11"]);
    expect(linuxDisplayArgs("win32", "wayland")).toEqual([]);
    expect(linuxDisplayArgs("linux", "")).toEqual([]);
    expect(() => linuxDisplayArgs("linux", "--no-sandbox")).toThrow(/wayland or x11/);
  });

  it("reconstructs committed source plus binary edits without a remote branch or commit", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "doodlebot-vm-bundle-"));
    temporary.push(root);
    const source = path.join(root, "source");
    const guest = path.join(root, "guest");
    fs.mkdirSync(source);
    fs.mkdirSync(guest);
    const git = (cwd: string, args: string[]) =>
      execFileSync("git", args, { cwd, encoding: "utf8" });
    git(source, ["init", "-q"]);
    fs.writeFileSync(path.join(source, "binary.dat"), Buffer.from([0, 1, 2]));
    fs.writeFileSync(path.join(source, "removed.txt"), "remove me");
    git(source, ["add", "."]);
    git(source, [
      "-c",
      "user.name=fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "fixture",
    ]);
    fs.writeFileSync(path.join(source, "binary.dat"), Buffer.from([0, 255, 17]));
    fs.unlinkSync(path.join(source, "removed.txt"));
    const bundle = path.join(root, "source.bundle");
    const patch = path.join(root, "working.patch");
    git(source, ["bundle", "create", bundle, "HEAD"]);
    git(source, [
      "diff",
      "HEAD",
      "--binary",
      "--no-ext-diff",
      "--no-textconv",
      `--output=${patch}`,
    ]);
    git(guest, ["init", "-q"]);
    git(guest, ["fetch", "-q", bundle, "HEAD"]);
    git(guest, ["checkout", "-q", "--detach", "FETCH_HEAD"]);
    git(guest, ["apply", "--allow-empty", "--binary", patch]);
    expect(fs.readFileSync(path.join(guest, "binary.dat"))).toEqual(Buffer.from([0, 255, 17]));
    expect(fs.existsSync(path.join(guest, "removed.txt"))).toBe(false);
    expect(git(guest, ["rev-parse", "HEAD"])).toBe(git(source, ["rev-parse", "HEAD"]));
  });
});
