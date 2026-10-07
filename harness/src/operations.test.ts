import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as leases from "./lease";
import { runUnderLease } from "./leaseCommand";
import { acquireLease, readLease, processAlive, addInstancePid, checkoutResource } from "./lease";
import {
  claimOperations,
  inheritedOperation,
  operationResource,
  withOperations,
  CONTEXT_ENV,
  trackOperationChild,
  ChildRegistrationError,
} from "./operations";
import { withLiveOperation } from "./liveOperation";
import { loadConfig } from "./config";
import { withCheckoutOperation } from "./checkoutOperation";
import { extensionOutputResource } from "./extensionBuild";
import { installMcpExtension } from "./instance";

let dir: string;
const exec = promisify(execFile);
const tsx = path.resolve("node_modules/tsx/dist/cli.mjs");
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "doodlebot operations "));
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

it("requires a named owner and rejects independent same-owner operations", async () => {
  expect(() => claimOperations(["test"], "anonymous", { leaseEnv: { dir } })).toThrow(
    /named owner/,
  );
  const hold = claimOperations(["test"], "author", { leaseEnv: { dir } });
  try {
    await expect(
      withOperations(["test"], "author", { leaseEnv: { dir } }, async () => "wrong"),
    ).rejects.toThrow(/overlapping/);
    await expect(
      withOperations(
        ["test"],
        "author",
        { context: hold.context, leaseEnv: { dir } },
        async () => "nested",
      ),
    ).resolves.toBe("nested");
    expect(readLease(operationResource("test"), { dir })?.live).toBe(true);
  } finally {
    hold.release();
  }
  expect(readLease(operationResource("test"), { dir })).toBeUndefined();
});

it("describes operation conflicts without suggesting UUID owners or guard bypasses", () => {
  const operation = claimOperations(["shared"], "author", { leaseEnv: { dir } });
  try {
    let message = "";
    try {
      claimOperations(["shared"], "author", { leaseEnv: { dir } });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("same named owner");
    expect(message).toContain("recorded child processes");
    expect(message).not.toContain(operation.context.id);
    expect(message).not.toContain("lease release");
    expect(message).not.toContain("--force");
  } finally {
    operation.release();
  }
});

it("nested lease runners refuse contention without waiting or retaining extra reservations", async () => {
  const leaseEnv = { dir };
  const parent = claimOperations(["a"], "author", { leaseEnv });
  const conflicting = claimOperations(["b"], "author", { leaseEnv });
  const onWaiting = vi.fn();
  try {
    await expect(
      runUnderLease({
        command: process.execPath,
        args: ["-e", "throw new Error('must not run')"],
        shell: false,
        owner: "author",
        resources: ["a", "b"],
        context: parent.context,
        leaseEnv,
        waitMs: 60_000,
        onWaiting,
      }),
    ).rejects.toThrow(/overlapping/);
    expect(onWaiting).not.toHaveBeenCalled();
    expect(readLease("a", leaseEnv)).toBeUndefined();
    expect(readLease("b", leaseEnv)).toBeUndefined();
    expect(readLease(operationResource("a"), leaseEnv)?.live).toBe(true);
  } finally {
    conflicting.release();
    parent.release();
  }
});

it("keeps partial child registration until confirmed-close cleanup", () => {
  const leaseEnv = { dir, isAlive: () => true };
  const operation = claimOperations(["a", "b"], "author", { leaseEnv });
  const original = leases.addHolder;
  let count = 0;
  vi.spyOn(leases, "addHolder").mockImplementation((identity, pid, env) => {
    if (++count === 2) throw new Error("registration write failed");
    original(identity, pid, env);
  });
  try {
    let error: unknown;
    try {
      trackOperationChild(operation.context, 1001, [], leaseEnv);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ChildRegistrationError);
    expect(readLease(operationResource("a"), leaseEnv)?.lease.holders).toContain(1001);
    (error as ChildRegistrationError).release();
    expect(readLease(operationResource("a"), leaseEnv)?.lease.holders).toEqual([process.pid]);
  } finally {
    operation.release();
  }
});

it("cleans partial acquisition and rejects stale execution contexts", () => {
  const hold = claimOperations(["z"], "other", { leaseEnv: { dir } });
  try {
    expect(() => claimOperations(["a", "z"], "author", { leaseEnv: { dir } })).toThrow(
      /overlapping/,
    );
    expect(readLease(operationResource("a"), { dir })).toBeUndefined();
  } finally {
    hold.release();
  }
  expect(() =>
    inheritedOperation("other", { [CONTEXT_ENV]: JSON.stringify(hold.context) }, { dir }),
  ).toThrow(/no longer active/);
});

it("a refused live snapshot/action callback does not run", async () => {
  const config = loadConfig({
    target: { kind: "installed", executable: "Vortex.exe", args: [], appName: "Vortex" },
    cacheDir: path.join(dir, "profile"),
    owner: "other",
  });
  let refs = ["current-ref"];
  await withLiveOperation(
    config,
    "author snapshot",
    async () => {
      await expect(
        withLiveOperation(
          { ...config, owner: "qa" },
          "snapshot",
          async () => {
            refs = [];
          },
          { leaseEnv: { dir } },
        ),
      ).rejects.toThrow(/held by/);
      await expect(
        withLiveOperation(
          config,
          "independent same-owner click",
          async () => {
            refs = [];
          },
          { leaseEnv: { dir } },
        ),
      ).rejects.toThrow(/overlapping/);
      expect(refs).toEqual(["current-ref"]);
    },
    { leaseEnv: { dir } },
  );
});

it("build/launch exclusion lasts through cleanup and live apps block rewriting even for their owner", async () => {
  const checkout = path.join(dir, "source");
  const env = { dir };
  await withCheckoutOperation(
    checkout,
    "author",
    "build",
    { leaseEnv: env, rewriting: true },
    async (context) => {
      await expect(
        withCheckoutOperation(checkout, "author", "launch", { leaseEnv: env }, async () => "bad"),
      ).rejects.toThrow(/overlapping/);
      await withCheckoutOperation(
        checkout,
        "author",
        "nested build",
        { leaseEnv: env, context },
        async () => "good",
      );
    },
  );
  const resource = checkoutResource(checkout);
  const reservation = acquireLease(resource, "author", { ...env, mode: "explicit", ttlMinutes: 1 });
  addInstancePid(reservation.lease, process.pid, env);
  await expect(
    withCheckoutOperation(
      checkout,
      "author",
      "install",
      { leaseEnv: env, rewriting: true },
      async () => "bad",
    ),
  ).rejects.toThrow(/is running from/);
});

it("an extension copying reader cannot copy partial output during a build", () => {
  const source = path.join(dir, "kit");
  const profile = path.join(dir, "profile");
  const hold = claimOperations([extensionOutputResource(source)], "builder", { leaseEnv: { dir } });
  try {
    expect(() =>
      installMcpExtension(profile, source, { owner: "author", leaseEnv: { dir } }),
    ).toThrow(/overlapping/);
    expect(fs.existsSync(profile)).toBe(false);
  } finally {
    hold.release();
  }
});

it("two real processes sharing an owner cannot join without an explicit context", async () => {
  const hold = claimOperations(["shared"], "author", { leaseEnv: { dir } });
  const file = path.join(dir, "contender.mts");
  fs.writeFileSync(
    file,
    `import { withOperations, inheritedOperation } from ${JSON.stringify(pathToFileURL(path.resolve("harness/src/operations.ts")).href)};
await withOperations(['shared'], 'author', {leaseEnv:{dir:process.env.VORTEX_AI_LEASE_DIR},context:inheritedOperation('author')}, async()=>console.log('joined'));`,
  );
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, VORTEX_AI_LEASE_DIR: dir };
    delete env[CONTEXT_ENV];
    await expect(exec(process.execPath, [tsx, file], { env })).rejects.toThrow(/overlapping/);
    const nested = await exec(process.execPath, [tsx, file], {
      env: { ...env, [CONTEXT_ENV]: JSON.stringify(hold.context) },
    });
    expect(nested.stdout.trim()).toBe("joined");
  } finally {
    hold.release();
  }
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("process fixture timed out");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

it("an interrupted wrapper leaves its known surviving child protected until exit", async () => {
  const marker = path.join(dir, "child-pid");
  const file = path.join(dir, "wrapper.mts");
  const childCode = `require('fs').writeFileSync(${JSON.stringify(marker)},String(process.pid)); setInterval(()=>{},1000);`;
  fs.writeFileSync(
    file,
    `import { spawn } from 'node:child_process';
import { holdLease } from ${JSON.stringify(pathToFileURL(path.resolve("harness/src/lease.ts")).href)};
import { claimOperations, trackOperationChild } from ${JSON.stringify(pathToFileURL(path.resolve("harness/src/operations.ts")).href)};
const env={dir:${JSON.stringify(dir)}};
holdLease('shared','author',env);
const operation=claimOperations(['shared'],'author',{leaseEnv:env});
const child=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{detached:true,stdio:'ignore'});
trackOperationChild(operation.context,child.pid,['shared'],env);
child.unref();
setTimeout(()=>process.exit(42),500);`,
  );
  let wrapper: ChildProcess | undefined;
  let childPid: number | undefined;
  try {
    wrapper = spawn(process.execPath, ["--import", "tsx", file], {
      stdio: "ignore",
      cwd: process.cwd(),
    });
    await waitFor(() => fs.existsSync(marker));
    childPid = Number(fs.readFileSync(marker, "utf8"));
    expect(processAlive(childPid), `known child ${childPid} before wrapper exit`).toBe(true);
    await waitFor(() => wrapper!.exitCode !== null || wrapper!.signalCode !== null);
    expect(processAlive(childPid)).toBe(true);
    expect(readLease("shared", { dir })?.live).toBe(true);
    expect(() => claimOperations(["shared"], "author", { leaseEnv: { dir } })).toThrow(
      /overlapping/,
    );
    process.kill(childPid, "SIGKILL");
    await waitFor(() => !processAlive(childPid!));
    const recovered = claimOperations(["shared"], "new-author", { leaseEnv: { dir } });
    recovered.release();
  } finally {
    if (childPid !== undefined && processAlive(childPid)) process.kill(childPid, "SIGKILL");
    wrapper?.kill("SIGKILL");
  }
}, 20_000);
