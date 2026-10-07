import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadConfig, MCP_EXTENSION_ID, type HarnessConfig } from "./config";
import { extensionOutputResource } from "./extensionBuild";
import {
  assertStandaloneWatch,
  watchAndReload,
  type HotReloadEvent,
  type WatchOptions,
} from "./hotReload";
import { instanceLeaseResources } from "./instance";
import { readLease } from "./lease";
import { withLiveOperation } from "./liveOperation";
import type { VortexMcpClient } from "./mcpClient";
import { claimOperations, CONTEXT_ENV, operationResource } from "./operations";
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
let leaseEnv: { dir: string };
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
  leaseEnv = { dir: path.join(dir, "leases") };
  fs.mkdirSync(path.join(source, "src"), { recursive: true });
  fs.writeFileSync(path.join(source, "src", "index.ts"), "initial");
  fs.writeFileSync(path.join(source, "info.json"), '{"id":"doodlebot"}');
  for (const file of ["tsup.config.ts", "tsconfig.json", "package.json", "pnpm-lock.yaml"])
    fs.writeFileSync(path.join(source, file), "{}");
  config = loadConfig({
    target: { kind: "installed", executable: "unused.exe", args: [], appName: "Vortex" },
    cacheDir: path.join(dir, "cache"),
    owner: "watcher",
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
    leaseEnv,
    signal: controller.signal,
    pollMs: 10,
    debounceMs: 20,
    retryMs: 30,
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

async function assertIdle(): Promise<void> {
  await expect(
    withLiveOperation(config, "foreground command", async () => true, { leaseEnv }),
  ).resolves.toBe(true);
  const hold = claimOperations([extensionOutputResource(source)], "another-builder", { leaseEnv });
  hold.release();
}

it("builds initial source, detects added/deleted files, and ignores output and test changes", async () => {
  start();
  await vi.advanceTimersByTimeAsync(60);
  expect(installed()).toBe("initial");
  expect(loaded()).toBe(1);
  await assertIdle();
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
  await assertIdle();
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

it.each(["instance", "output"])(
  "retains pending edits after same-owner %s contention and releases partial holds",
  async (resource) => {
    const instance = instanceLeaseResources(config)[0]!;
    const output = extensionOutputResource(source);
    const hold = claimOperations([resource === "instance" ? instance : output], "watcher", {
      leaseEnv,
    });
    try {
      start();
      await vi.advanceTimersByTimeAsync(100);
      expect(runner).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
      expect(events.filter((event) => event.type === "waiting")).toHaveLength(1);
      expect(readLease(instance, leaseEnv)).toBeUndefined();
      expect(
        readLease(operationResource(resource === "instance" ? output : instance), leaseEnv),
      ).toBeUndefined();
    } finally {
      hold.release();
    }
    await vi.advanceTimersByTimeAsync(60);
    expect(installed()).toBe("initial");
    expect(loaded()).toBe(1);
    await assertIdle();
  },
);

it("holds the full cycle, discards a build whose inputs changed, then loads the latest source", async () => {
  const compiling = gate();
  runner.mockImplementationOnce(async (options) => {
    const captured = fs.readFileSync(path.join(options.cwd, "src", "index.ts"), "utf8");
    await compiling.promise;
    writeOutput(captured, options.cwd);
    return pass;
  });
  start();
  await vi.advanceTimersByTimeAsync(30);
  await expect(
    withLiveOperation(config, "overlap", async () => true, { leaseEnv }),
  ).rejects.toThrow(/overlapping/);
  expect(() => claimOperations([extensionOutputResource(source)], "watcher", { leaseEnv })).toThrow(
    /overlapping/,
  );
  edit("edited during build");
  compiling.release();
  await vi.advanceTimersByTimeAsync(0);
  expect(reload).not.toHaveBeenCalled();
  expect(fs.existsSync(liveDir)).toBe(false);
  await vi.advanceTimersByTimeAsync(80);
  expect(runner).toHaveBeenCalledTimes(2);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(installed()).toBe("edited during build");
  await assertIdle();
});

it("retains edits made during reload and allows foreground commands between completed cycles", async () => {
  const reloading = gate();
  reload.mockImplementationOnce(async () => {
    edit("edited during reload");
    await reloading.promise;
    runtime = "runtime-1";
  });
  start();
  await vi.advanceTimersByTimeAsync(30);
  expect(installed()).toBe("initial");
  await expect(
    withLiveOperation(config, "overlap", async () => true, { leaseEnv }),
  ).rejects.toThrow(/overlapping/);
  expect(() => claimOperations([extensionOutputResource(source)], "watcher", { leaseEnv })).toThrow(
    /overlapping/,
  );
  reloading.release();
  await vi.advanceTimersByTimeAsync(80);
  expect(loaded()).toBe(2);
  expect(installed()).toBe("edited during reload");
  await assertIdle();
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
  await assertIdle();
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
    await assertIdle();
    edit("corrected");
    await vi.advanceTimersByTimeAsync(60);
    expect(installed()).toBe("corrected");
    expect(loaded()).toBe(1);
  },
);

it("cancels debounce without building and keeps an idle watcher free of operation holds", async () => {
  const watching = start();
  await vi.advanceTimersByTimeAsync(10);
  await assertIdle();
  controller.abort();
  await vi.advanceTimersByTimeAsync(0);
  await watching;
  expect(runner).not.toHaveBeenCalled();
  await assertIdle();
});

it("keeps guards until a cancelled compiler confirms exit and never copies its output", async () => {
  const exited = gate();
  runner.mockImplementationOnce(async (options) => {
    await exited.promise;
    return { ...pass, aborted: options.signal?.aborted === true };
  });
  const watching = start();
  await vi.advanceTimersByTimeAsync(30);
  controller.abort();
  await vi.advanceTimersByTimeAsync(0);
  expect(() => claimOperations([extensionOutputResource(source)], "watcher", { leaseEnv })).toThrow(
    /overlapping/,
  );
  exited.release();
  await vi.advanceTimersByTimeAsync(0);
  await watching;
  expect(reload).not.toHaveBeenCalled();
  expect(fs.existsSync(liveDir)).toBe(false);
  await assertIdle();
});

it("finishes bounded runtime verification after cancellation without spinning or starting another cycle", async () => {
  reload.mockImplementationOnce(async () => {
    edit("pending after cancel");
    controller.abort();
  });
  const watching = start();
  await vi.advanceTimersByTimeAsync(40);
  expect(loaded()).toBe(0);
  expect(() => claimOperations([extensionOutputResource(source)], "watcher", { leaseEnv })).toThrow(
    /overlapping/,
  );
  expect(vi.mocked(mcp.call).mock.calls.length).toBeLessThan(8);
  runtime = "runtime-after-cancel";
  await vi.advanceTimersByTimeAsync(10);
  await watching;
  expect(loaded()).toBe(1);
  expect(runner).toHaveBeenCalledTimes(1);
  await assertIdle();
});

it.each(["unchanged", "missing", "invalid"])(
  "rejects a reload with %s runtime identity and releases its guards",
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
    await assertIdle();
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
  await assertIdle();
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
  await assertIdle();
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
  await assertIdle();
});

it("rejects explicit and inherited long-lived execution contexts before touching the app", async () => {
  const hold = claimOperations(["parent"], "watcher", { leaseEnv });
  try {
    await expect(start({ context: hold.context })).rejects.toThrow(/Run watch directly/);
    vi.stubEnv(CONTEXT_ENV, JSON.stringify(hold.context));
    expect(() => assertStandaloneWatch()).toThrow(/Run watch directly/);
    await expect(watchAndReload(mcp, config, { liveDir })).rejects.toThrow(/Run watch directly/);
    expect(mcp.call).not.toHaveBeenCalled();
    expect(runner).not.toHaveBeenCalled();
  } finally {
    hold.release();
  }
});
