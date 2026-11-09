import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processAlive } from "./processes";
import { callerCwd, runInteractive } from "./processRunner";
import * as processes from "./processRunner";
import { runStreaming } from "./source";
import { streamingRunner } from "./vortexBuild";

// A test can substitute the next spawned child; every other spawn is real.
const fake = vi.hoisted(() => ({ next: undefined as undefined | (() => unknown) }));
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      const make = fake.next;
      fake.next = undefined;
      return make === undefined ? actual.spawn(...args) : make();
    },
  };
});

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "process-recovery-"));
});
afterEach(() => {
  fake.next = undefined;
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

it("does not report a gracefully exited cancelled command as success", async () => {
  vi.spyOn(processes, "runEvidenceProcess").mockResolvedValue({
    code: 0,
    signal: null,
    output: "",
    stdout: "",
    aborted: true,
  });
  await expect(runStreaming("node", [], { cwd: root, label: "fixture" })).rejects.toThrow(
    /interrupted/,
  );
  expect(await streamingRunner("node", [], { cwd: root, env: {} })).toBe(130);
});

describe("callerCwd", () => {
  it("runs a command where the caller was, not in the kit's root", () => {
    // `pnpm run ai -- …` starts the CLI in the kit; pnpm keeps the caller's directory
    expect(callerCwd(undefined, { INIT_CWD: "J:/vortex/checkout" })).toBe("J:/vortex/checkout");
  });

  it("prefers an explicit directory, and falls back to this process's", () => {
    expect(callerCwd("J:/elsewhere", { INIT_CWD: "J:/kit" })).toBe("J:/elsewhere");
    expect(callerCwd(undefined, {})).toBe(process.cwd());
    expect(callerCwd(undefined, { INIT_CWD: "" })).toBe(process.cwd());
  });
});

describe("runInteractive", { timeout: 30_000 }, () => {
  const interruptListeners = (): Array<(...args: unknown[]) => void> =>
    process.listeners("SIGINT") as Array<(...args: unknown[]) => void>;

  it("resolves to the child's exit code in the given directory and environment", async () => {
    const out = path.join(root, "seen.json");
    const before = interruptListeners();
    const code = await runInteractive(
      process.execPath,
      [
        "-e",
        `require("node:fs").writeFileSync(${JSON.stringify(out)}, JSON.stringify({cwd:process.cwd(),marker:process.env.RUN_INTERACTIVE_MARKER})); process.exit(7)`,
      ],
      { cwd: root, env: { ...process.env, RUN_INTERACTIVE_MARKER: "seen" } },
    );
    expect(code).toBe(7);
    const seen = JSON.parse(fs.readFileSync(out, "utf8")) as { cwd: string; marker: string };
    expect(seen.marker).toBe("seen");
    expect(fs.realpathSync.native(seen.cwd)).toBe(fs.realpathSync.native(root));
    // Its signal handlers are gone once it resolves.
    expect(interruptListeners()).toEqual(before);
  });

  it("kills the child tree on an interrupt, waits for it and resolves 130", async () => {
    const before = new Set(interruptListeners());
    const pidFile = path.join(root, "pid");
    const pending = runInteractive(
      process.execPath,
      [
        "-e",
        `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(()=>{},1000)`,
      ],
      { cwd: root, env: process.env },
    );
    const added = interruptListeners().filter((listener) => !before.has(listener));
    expect(added).toHaveLength(1);
    await vi.waitFor(() => expect(fs.existsSync(pidFile)).toBe(true), { timeout: 15_000 });
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    expect(processAlive(pid)).toBe(true);
    // As Ctrl+C would, without signalling the test process itself.
    added[0]!("SIGINT");
    expect(await pending).toBe(130);
    expect(processAlive(pid)).toBe(false);
    expect(interruptListeners().filter((listener) => !before.has(listener))).toEqual([]);
  });

  it("resolves 128 plus the signal number when the child died from a signal", async () => {
    const child = Object.assign(new EventEmitter(), {
      pid: 4242,
      exitCode: null,
      signalCode: "SIGTERM",
    });
    fake.next = () => {
      setImmediate(() => child.emit("close", null, "SIGTERM"));
      return child as unknown as ChildProcess;
    };
    expect(await runInteractive("vortex", [], { cwd: root, env: process.env })).toBe(
      128 + os.constants.signals.SIGTERM,
    );
  });

  it("resolves 1 when the child reports neither a code nor a signal", async () => {
    const child = Object.assign(new EventEmitter(), {
      pid: 4242,
      exitCode: null,
      signalCode: null,
    });
    fake.next = () => {
      setImmediate(() => child.emit("close", null, null));
      return child as unknown as ChildProcess;
    };
    expect(await runInteractive("vortex", [], { cwd: root, env: process.env })).toBe(1);
  });
});
