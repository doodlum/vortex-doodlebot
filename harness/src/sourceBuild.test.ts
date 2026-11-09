import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildVortexSource } from "./source";
import { runEvidenceProcess } from "./processRunner";
import { clearInstanceRecord, INSTANCE_RECORD, writeInstanceRecord } from "./runningVortex";

vi.mock("./processRunner", async (original) => ({
  ...(await original<typeof import("./processRunner")>()),
  runEvidenceProcess: vi.fn(),
}));
vi.mock("node:child_process", async (original) => {
  const { promisify } = await import("node:util");
  return {
    ...(await original<typeof import("node:child_process")>()),
    execFile: Object.assign(vi.fn(), {
      [promisify.custom]: async () => ({ stdout: "9.15.0", stderr: "" }),
    }),
  };
});
// The instance record lives in a private cache, and this process counts as a running Vortex.
vi.mock("./paths", async (original) => {
  const nodeFs = await import("node:fs");
  const nodeOs = await import("node:os");
  const nodePath = await import("node:path");
  return {
    ...(await original<typeof import("./paths")>()),
    DEFAULT_CACHE_DIR: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "source-build-cache-")),
  };
});
vi.mock("./processes", async (original) => ({
  ...(await original<typeof import("./processes")>()),
  processImageName: () => "electron.exe",
}));

let root: string;
const success = { code: 0, signal: null, aborted: false, output: "", stdout: "" };
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "source-build-"));
  const main = path.join(root, "src", "main");
  fs.mkdirSync(path.join(main, "build"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ packageManager: "pnpm@9.15.0" }),
  );
  fs.writeFileSync(path.join(main, "package.json"), "{}");
  for (const file of ["main.cjs", "renderer.js"])
    fs.writeFileSync(path.join(main, "build", file), "synthetic output");
  vi.mocked(runEvidenceProcess).mockReset().mockResolvedValue(success);
});
afterEach(() => {
  clearInstanceRecord();
  fs.rmSync(root, { recursive: true, force: true });
});
afterAll(() => fs.rmSync(path.dirname(INSTANCE_RECORD), { recursive: true, force: true }));

it.each(["cancelled", "signal", "missing-exit", "rejected"])(
  "propagates %s build failure without starting fallback",
  async (failure) => {
    const runner = vi.mocked(runEvidenceProcess).mockResolvedValueOnce(success);
    if (failure === "cancelled") runner.mockResolvedValueOnce({ ...success, aborted: true });
    else if (failure === "signal")
      runner.mockResolvedValueOnce({ ...success, code: null, signal: "SIGTERM" });
    else if (failure === "missing-exit") runner.mockResolvedValueOnce({ ...success, code: null });
    else
      runner.mockRejectedValueOnce(
        new AggregateError([new Error("kill failed")], "Child exited with process errors"),
      );
    const progress: string[] = [];
    await expect(
      buildVortexSource({ dir: root, onProgress: (message) => progress.push(message) }),
    ).rejects.toThrow();
    expect(runner).toHaveBeenCalledTimes(2);
    expect(progress).not.toContain("build complete");
    expect(runner.mock.calls.some(([options]) => options.args.includes("./build.mjs"))).toBe(false);
  },
);
it("falls back after an ordinary nonzero Nx exit and checks the required outputs", async () => {
  const runner = vi
    .mocked(runEvidenceProcess)
    .mockResolvedValueOnce(success)
    .mockResolvedValueOnce({ ...success, code: 1 });
  await buildVortexSource({ dir: root });
  expect(runner).toHaveBeenCalledTimes(3);
  expect(runner.mock.calls[2]![0]).toMatchObject({
    executable: "node",
    args: ["./build.mjs"],
    cwd: path.join(root, "src", "main"),
  });
});
it("refuses to install or build while the harness Vortex runs from the checkout", async () => {
  const record = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    cacheDir: path.join(root, "cache"),
    userDataDir: path.join(root, "cache", "userData"),
    mcpPort: 3701,
  };
  writeInstanceRecord({ ...record, sourceDir: root });
  await expect(buildVortexSource({ dir: root })).rejects.toThrow(
    `A harness Vortex is running from ${root} (pid ${process.pid}); run \`pnpm run ai -- down\` before building it.`,
  );
  await expect(buildVortexSource({ dir: root, installOnly: true })).rejects.toThrow(
    /before installing it/,
  );
  expect(runEvidenceProcess).not.toHaveBeenCalled();
  // One that runs from another checkout, or an installed Vortex, does not stop it.
  writeInstanceRecord({ ...record, sourceDir: path.join(root, "other") });
  await buildVortexSource({ dir: root });
  writeInstanceRecord(record);
  await buildVortexSource({ dir: root, installOnly: true });
});
it("refuses the build step when the harness Vortex started from the checkout during install", async () => {
  vi.mocked(runEvidenceProcess).mockImplementationOnce(async () => {
    writeInstanceRecord({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      cacheDir: path.join(root, "cache"),
      userDataDir: path.join(root, "cache", "userData"),
      mcpPort: 3701,
      sourceDir: root,
    });
    return success;
  });
  await expect(buildVortexSource({ dir: root })).rejects.toThrow(/before building it\./);
  expect(runEvidenceProcess).toHaveBeenCalledTimes(1);
});
