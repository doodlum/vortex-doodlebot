import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as operations from "./operations";
import { ChildRegistrationError, claimOperations } from "./operations";
import { checkoutResource, holdLease, listLeases, processAlive } from "./lease";
import { runEvidenceProcess } from "./processRunner";
import * as processes from "./processRunner";
import { runStreaming } from "./source";
import { runUnderLease } from "./leaseCommand";
import { buildCheckout, streamingRunner } from "./vortexBuild";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "process-recovery-"));
});
afterEach(() => {
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
  expect(
    await runUnderLease({
      command: "node",
      args: [],
      owner: "author",
      resources: ["fixture"],
      leaseEnv: { dir: path.join(root, "leases") },
      cwd: root,
    }),
  ).toBe(130);
});

it("rejects cleanup errors after close without stranding the process promise", async () => {
  const leaseEnv = { dir: path.join(root, "leases") };
  const ownership = holdLease("fixture", "author", leaseEnv);
  const operation = claimOperations(["fixture"], "author", { leaseEnv });
  const track = operations.trackOperationChild;
  let pid = 0;
  vi.spyOn(operations, "trackOperationChild").mockImplementation(
    (context, child, persistent, env) => {
      pid = child;
      const release = track(context, child, persistent, env);
      return () => {
        expect(processAlive(child)).toBe(false);
        release();
        throw new Error("cleanup failed after confirmed exit");
      };
    },
  );
  try {
    await expect(
      runEvidenceProcess({
        executable: process.execPath,
        args: ["-e", "process.exit(0)"],
        cwd: root,
        context: operation.context,
        persistentResources: ["fixture"],
        leaseEnv,
      }),
    ).rejects.toThrow(/cleanup failed after confirmed exit/);
    expect(pid).toBeGreaterThan(0);
    expect(processAlive(pid)).toBe(false);
  } finally {
    operation.release();
    ownership.release();
  }
});

it.each(["lease", "build"] as const)(
  "%s waits for a registration-failed child before cleanup",
  async (kind) => {
    const leaseEnv = { dir: path.join(root, "leases") };
    const checkout = path.join(root, "checkout");
    fs.mkdirSync(path.join(checkout, "src", "main"), { recursive: true });
    fs.mkdirSync(path.join(checkout, "etc"));
    fs.writeFileSync(
      path.join(checkout, "package.json"),
      JSON.stringify({ packageManager: "pnpm@11.0.0" }),
    );
    const generated = path.join(checkout, "etc", "vortex.api.md");
    fs.writeFileSync(generated, "original");
    const resource = checkoutResource(checkout);
    const track = operations.trackOperationChild;
    let pid = 0;
    vi.spyOn(operations, "trackOperationChild").mockImplementation(
      (context, child, persistent, env) => {
        pid = child;
        const release = track(context, child, persistent, env);
        if (kind === "build") fs.writeFileSync(generated, "partial output");
        throw new ChildRegistrationError(new Error("injected registration failure"), () => {
          expect(processAlive(child)).toBe(false);
          if (kind === "build") expect(fs.readFileSync(generated, "utf8")).toBe("partial output");
          release();
        });
      },
    );
    const args = ["-e", "setInterval(()=>{},1000)"];
    const pending =
      kind === "lease"
        ? runUnderLease({
            command: process.execPath,
            args,
            shell: false,
            owner: "author",
            resources: [resource],
            leaseEnv,
            cwd: checkout,
          })
        : buildCheckout({
            checkout,
            owner: "author",
            production: false,
            installedPnpm: "11.0.0",
            leaseEnv,
            runner: (_command, _args, options) => streamingRunner(process.execPath, args, options),
          });
    await expect(pending).rejects.toThrow(/Child registration failed/);
    expect(processAlive(pid)).toBe(false);
    expect(fs.readFileSync(generated, "utf8")).toBe("original");
    expect(listLeases(leaseEnv)).toEqual([]);
  },
);
