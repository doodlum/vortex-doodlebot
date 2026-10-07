import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildVortexSource } from "./source";
import { runEvidenceProcess } from "./processRunner";
import { ChildRegistrationError } from "./operations";

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

let root: string;
const success = { code: 0, signal: null, aborted: false, output: "", stdout: "" };
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "source-build-"));
  vi.stubEnv("VORTEX_AI_LEASE_DIR", path.join(root, "leases"));
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
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

it.each(["cancelled", "signal", "missing-exit", "registration", "cleanup"])(
  "propagates %s build failure without starting fallback",
  async (failure) => {
    const runner = vi.mocked(runEvidenceProcess).mockResolvedValueOnce(success);
    if (failure === "cancelled") runner.mockResolvedValueOnce({ ...success, aborted: true });
    else if (failure === "signal")
      runner.mockResolvedValueOnce({ ...success, code: null, signal: "SIGTERM" });
    else if (failure === "missing-exit") runner.mockResolvedValueOnce({ ...success, code: null });
    else
      runner.mockRejectedValueOnce(
        failure === "registration"
          ? new ChildRegistrationError(new Error("lost ownership"), () => {})
          : new AggregateError([new Error("failed release")], "cleanup failed"),
      );
    const progress: string[] = [];
    await expect(
      buildVortexSource({
        dir: root,
        owner: "source-test",
        onProgress: (message) => progress.push(message),
      }),
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
  await buildVortexSource({ dir: root, owner: "source-test" });
  expect(runner).toHaveBeenCalledTimes(3);
  expect(runner.mock.calls[2]![0]).toMatchObject({
    executable: "node",
    args: ["./build.mjs"],
    cwd: path.join(root, "src", "main"),
  });
});
