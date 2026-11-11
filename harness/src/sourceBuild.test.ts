import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { installVortexDeps } from "./source";
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
// The instance record lives in a private state folder, and this process counts as a running Vortex.
vi.mock("./paths", async (original) => {
  const nodeFs = await import("node:fs");
  const nodeOs = await import("node:os");
  const nodePath = await import("node:path");
  return {
    ...(await original<typeof import("./paths")>()),
    USER_STATE_DIR: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "source-build-cache-")),
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
  fs.mkdirSync(main, { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ packageManager: "pnpm@9.15.0" }),
  );
  fs.writeFileSync(path.join(main, "package.json"), "{}");
  vi.mocked(runEvidenceProcess).mockReset().mockResolvedValue(success);
});
afterEach(() => {
  clearInstanceRecord();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
afterAll(() => fs.rmSync(path.dirname(INSTANCE_RECORD), { recursive: true, force: true }));

it("installs with the pinned pnpm and --frozen-lockfile, and nothing else", async () => {
  await installVortexDeps(root);
  expect(runEvidenceProcess).toHaveBeenCalledTimes(1);
  const call = vi.mocked(runEvidenceProcess).mock.calls[0]![0];
  expect([call.executable, ...call.args].join(" ")).toContain("install --frozen-lockfile");
});

it("refuses to install while the harness Vortex runs from the checkout", async () => {
  const record = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    cacheDir: path.join(root, "cache"),
    userDataDir: path.join(root, "cache", "userData"),
    mcpPort: 3701,
  };
  writeInstanceRecord({ ...record, sourceDir: root });
  await expect(installVortexDeps(root)).rejects.toThrow(
    `A harness Vortex is running from ${root} (pid ${process.pid}); run \`doodlebot down\` before installing it.`,
  );
  expect(runEvidenceProcess).not.toHaveBeenCalled();
  // One that runs from another checkout, or an installed Vortex, does not stop it.
  writeInstanceRecord({ ...record, sourceDir: path.join(root, "other") });
  await installVortexDeps(root);
  writeInstanceRecord(record);
  await installVortexDeps(root);
});

it("live-C: refuses with the fix when VORTEX_AI_PNPM names a missing file", async () => {
  const missing = path.join(root, "no-such", "pnpm.cmd");
  vi.stubEnv("VORTEX_AI_PNPM", missing);
  await expect(installVortexDeps(root)).rejects.toThrow(
    `VORTEX_AI_PNPM names ${missing}, which does not exist.`,
  );
  expect(runEvidenceProcess).not.toHaveBeenCalled();
});
