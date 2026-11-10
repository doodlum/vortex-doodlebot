import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadConfig, MCP_EXTENSION_ID, type HarnessConfig } from "./config";
import { watchAndReload, type HotReloadEvent, type WatchOptions } from "./hotReload";
import type { VortexMcpClient } from "./mcpClient";
import type { runEvidenceProcess } from "./processRunner";

const pass: Awaited<ReturnType<typeof runEvidenceProcess>> = {
  code: 0,
  signal: null,
  output: "",
  stdout: "",
  aborted: false,
};
let dir: string;
let source: string;
let liveDir: string;
let config: HarnessConfig;
let controller: AbortController;
let pending: Promise<void> | undefined;
let cleanup: (() => void)[];
let events: HotReloadEvent[];
let runtime: string;
let runner: ReturnType<typeof vi.fn<typeof runEvidenceProcess>>;
let reload: ReturnType<typeof vi.fn<() => Promise<void>>>;
let mcp: Pick<VortexMcpClient, "call">;

beforeEach(() => {
  vi.useFakeTimers();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "doodlebot source watch "));
  source = path.join(dir, "extension");
  liveDir = path.join(dir, "cache", "live");
  fs.mkdirSync(path.join(source, "src"), { recursive: true });
  fs.writeFileSync(path.join(source, "src", "index.ts"), "initial");
  fs.writeFileSync(path.join(source, "info.json"), '{"id":"doodlebot"}');
  for (const file of ["tsup.config.ts", "tsconfig.json", "package.json", "pnpm-lock.yaml"])
    fs.writeFileSync(path.join(source, file), "{}");
  config = loadConfig({
    target: { kind: "installed", executable: "unused.exe", args: [], appName: "Vortex" },
    cacheDir: path.join(dir, "cache"),
  });
  controller = new AbortController();
  pending = undefined;
  cleanup = [];
  events = [];
  runtime = "runtime-0";
  runner = vi.fn<typeof runEvidenceProcess>(async (options) => {
    writeOutput(fs.readFileSync(path.join(options.cwd, "src", "index.ts"), "utf8"), options.cwd);
    return pass;
  });
  reload = vi.fn(async () => {
    runtime += "-new";
  });
  mcp = {
    call: vi.fn(async (name: string) => {
      if (name === "automation_status")
        return { runtimeId: runtime, userDataDir: path.join(liveDir, "userData") };
      if (name === "ui_reload_renderer") return reload();
      throw new Error("unexpected tool: " + name);
    }),
  } as unknown as Pick<VortexMcpClient, "call">;
});

afterEach(async () => {
  controller.abort();
  cleanup.forEach((release) => release());
  await vi.advanceTimersByTimeAsync(200);
  await pending?.catch(() => undefined);
  vi.useRealTimers();
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeOutput(content: string, root = source): void {
  fs.mkdirSync(path.join(root, "dist"), { recursive: true });
  fs.writeFileSync(path.join(root, "dist", "index.js"), content);
}

function installed(): string {
  return fs.readFileSync(
    path.join(liveDir, "userData", "plugins", MCP_EXTENSION_ID, "index.js"),
    "utf8",
  );
}

function edit(content: string): void {
  fs.writeFileSync(path.join(source, "src", "index.ts"), content);
}

function gate(): { promise: Promise<void>; release(): void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  cleanup.push(release);
  return { promise, release };
}

function start(options: Partial<WatchOptions> = {}): Promise<void> {
  pending = watchAndReload(mcp, config, {
    source,
    liveDir,
    signal: controller.signal,
    pollMs: 10,
    debounceMs: 20,
    reloadTimeoutMs: 80,
    reloadPollMs: 10,
    buildRunner: runner,
    onEvent: (event) => events.push(event),
    ...options,
  });
  // Some tests deliberately let the fake-clock deadline pass before examining the rejection.
  void pending.catch(() => undefined);
  return pending;
}

function loaded(): number {
  return events.filter((event) => event.type === "reloaded").length;
}

it("builds initial source, detects added/deleted files, and ignores output and test changes", async () => {
  start();
  await vi.advanceTimersByTimeAsync(60);
  expect(installed()).toBe("initial");
  expect(loaded()).toBe(1);
  writeOutput("external output");
  fs.writeFileSync(path.join(source, "src", "ignored.test.ts"), "test-only");
  await vi.advanceTimersByTimeAsync(100);
  expect(runner).toHaveBeenCalledTimes(1);
  fs.writeFileSync(path.join(source, "src", "added.ts"), "new module");
  await vi.advanceTimersByTimeAsync(60);
  expect(runner).toHaveBeenCalledTimes(2);
  fs.unlinkSync(path.join(source, "src", "added.ts"));
  await vi.advanceTimersByTimeAsync(60);
  expect(runner).toHaveBeenCalledTimes(3);
  fs.writeFileSync(path.join(source, "info.json"), '{"id":"doodlebot","version":"2"}');
  await vi.advanceTimersByTimeAsync(60);
  expect(runner).toHaveBeenCalledTimes(4);
  expect(loaded()).toBe(4);
});

it("debounces rapid edits and detects changed bytes even when timestamps and lengths match", async () => {
  start();
  await vi.advanceTimersByTimeAsync(60);
  const file = path.join(source, "src", "index.ts");
  const stamp = fs.statSync(file);
  edit("changed");
  fs.utimesSync(file, stamp.atime, stamp.mtime);
  await vi.advanceTimersByTimeAsync(10);
  edit("latest!");
  await vi.advanceTimersByTimeAsync(10);
  expect(runner).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(40);
  expect(runner).toHaveBeenCalledTimes(2);
  expect(installed()).toBe("latest!");
});

it("discards a build whose inputs changed, then loads the latest source", async () => {
  const compiling = gate();
  runner.mockImplementationOnce(async (options) => {
    const captured = fs.readFileSync(path.join(options.cwd, "src", "index.ts"), "utf8");
    await compiling.promise;
    writeOutput(captured, options.cwd);
    return pass;
  });
  start();
  await vi.advanceTimersByTimeAsync(30);
  edit("edited during build");
  compiling.release();
  await vi.advanceTimersByTimeAsync(0);
  expect(reload).not.toHaveBeenCalled();
  expect(fs.existsSync(liveDir)).toBe(false);
  await vi.advanceTimersByTimeAsync(80);
  expect(runner).toHaveBeenCalledTimes(2);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(installed()).toBe("edited during build");
});

it("retains edits made during reload", async () => {
  const reloading = gate();
  reload.mockImplementationOnce(async () => {
    edit("edited during reload");
    await reloading.promise;
    runtime = "runtime-1";
  });
  start();
  await vi.advanceTimersByTimeAsync(30);
  expect(installed()).toBe("initial");
  reloading.release();
  await vi.advanceTimersByTimeAsync(80);
  expect(loaded()).toBe(2);
  expect(installed()).toBe("edited during reload");
  await vi.advanceTimersByTimeAsync(100);
  expect(runner).toHaveBeenCalledTimes(2);
});

it("does not copy a build if source changes while obtaining the pre-reload identity", async () => {
  const call = mcp.call;
  let changedSource = false;
  mcp.call = vi.fn(async (name: string) => {
    if (name === "automation_status" && !changedSource) {
      changedSource = true;
      edit("edited during status");
    }
    return call(name);
  }) as typeof mcp.call;
  start();
  await vi.advanceTimersByTimeAsync(30);
  expect(reload).not.toHaveBeenCalled();
  expect(fs.existsSync(liveDir)).toBe(false);
  await vi.advanceTimersByTimeAsync(80);
  expect(runner).toHaveBeenCalledTimes(2);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(installed()).toBe("edited during status");
});

it.each(["failed compiler", "missing output"])(
  "does not copy %s and waits for a corrective source edit",
  async (failure) => {
    runner.mockImplementationOnce(async (options) => {
      if (failure === "failed compiler") writeOutput("partial failed output", options.cwd);
      return { ...pass, code: failure === "failed compiler" ? 1 : 0 };
    });
    start();
    await vi.advanceTimersByTimeAsync(200);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    expect(fs.existsSync(liveDir)).toBe(false);
    expect(events.filter((event) => event.type === "error")).toHaveLength(1);
    edit("corrected");
    await vi.advanceTimersByTimeAsync(60);
    expect(installed()).toBe("corrected");
    expect(loaded()).toBe(1);
  },
);

it("cancels debounce without building", async () => {
  const watching = start();
  await vi.advanceTimersByTimeAsync(10);
  controller.abort();
  await vi.advanceTimersByTimeAsync(0);
  await watching;
  expect(runner).not.toHaveBeenCalled();
});

it("awaits a cancelled compiler's exit and never copies its output", async () => {
  const exited = gate();
  runner.mockImplementationOnce(async (options) => {
    await exited.promise;
    return { ...pass, aborted: options.signal?.aborted === true };
  });
  let settled = false;
  const watching = start().finally(() => {
    settled = true;
  });
  await vi.advanceTimersByTimeAsync(30);
  controller.abort();
  await vi.advanceTimersByTimeAsync(100);
  expect(settled).toBe(false);
  exited.release();
  await vi.advanceTimersByTimeAsync(0);
  await watching;
  expect(reload).not.toHaveBeenCalled();
  expect(fs.existsSync(liveDir)).toBe(false);
});

it("finishes bounded runtime verification after cancellation without spinning or starting another cycle", async () => {
  reload.mockImplementationOnce(async () => {
    edit("pending after cancel");
    controller.abort();
  });
  const watching = start();
  await vi.advanceTimersByTimeAsync(40);
  expect(loaded()).toBe(0);
  expect(vi.mocked(mcp.call).mock.calls.length).toBeLessThan(8);
  runtime = "runtime-after-cancel";
  await vi.advanceTimersByTimeAsync(10);
  await watching;
  expect(loaded()).toBe(1);
  expect(runner).toHaveBeenCalledTimes(1);
});

it.each(["unchanged", "missing", "invalid"])(
  "rejects a reload with %s runtime identity",
  async (identity) => {
    let requested = false;
    mcp.call = vi.fn(async (name: string) => {
      if (name === "ui_reload_renderer") {
        requested = true;
        return;
      }
      if (requested && identity === "missing")
        return { userDataDir: path.join(liveDir, "userData") };
      if (requested && identity === "invalid") return null;
      return { runtimeId: "same-runtime", userDataDir: path.join(liveDir, "userData") };
    }) as typeof mcp.call;
    const watching = start();
    await vi.advanceTimersByTimeAsync(200);
    await expect(watching).rejects.toThrow(
      identity === "invalid" ? /expected isolated profile/ : /new runtime/,
    );
    expect(loaded()).toBe(0);
  },
);

it("requires an initial runtime identity before copying or requesting reload", async () => {
  mcp.call = vi.fn(async () => ({
    userDataDir: path.join(liveDir, "userData"),
  })) as typeof mcp.call;
  const watching = start();
  await vi.advanceTimersByTimeAsync(60);
  await expect(watching).rejects.toThrow(/no runtime identity/);
  expect(vi.mocked(mcp.call).mock.calls.map(([name]) => name)).toEqual(["automation_status"]);
  expect(fs.existsSync(liveDir)).toBe(false);
  expect(loaded()).toBe(0);
});

it.each([1, 2, 3, 4])("refuses a foreign profile at status boundary %s", async (foreignAt) => {
  let statusCalls = 0;
  mcp.call = vi.fn(async (name: string) => {
    if (name === "ui_reload_renderer") return reload();
    statusCalls++;
    return {
      runtimeId: runtime,
      userDataDir: path.join(
        statusCalls >= foreignAt ? path.join(dir, "foreign") : liveDir,
        "userData",
      ),
    };
  }) as typeof mcp.call;
  const watching = start();
  await vi.advanceTimersByTimeAsync(100);
  await expect(watching).rejects.toThrow(/expected isolated profile/);
  expect(loaded()).toBe(0);
  if (foreignAt === 1) expect(runner).not.toHaveBeenCalled();
  if (foreignAt <= 2) expect(fs.existsSync(liveDir)).toBe(false);
  expect(reload).toHaveBeenCalledTimes(foreignAt === 4 ? 1 : 0);
});

it("an edit and Undo during compilation cannot load transient source bytes", async () => {
  runner.mockImplementationOnce(async ({ cwd }) => {
    edit("transient edit");
    writeOutput(fs.readFileSync(path.join(cwd, "src", "index.ts"), "utf8"), cwd);
    edit("initial");
    return pass;
  });
  start();
  await vi.advanceTimersByTimeAsync(200);
  expect(installed()).toBe("initial");
  expect(loaded()).toBe(1);
  expect(runner).toHaveBeenCalledTimes(1);
});
