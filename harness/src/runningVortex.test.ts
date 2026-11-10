import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ dir: "" }));
const image = vi.hoisted(() => ({ name: "electron.exe" as string | undefined }));

vi.mock("./paths", async (original) => ({
  ...(await original<typeof import("./paths")>()),
  get USER_STATE_DIR() {
    return state.dir;
  },
}));
vi.mock("./processes", async (original) => ({
  ...(await original<typeof import("./processes")>()),
  processImageName: () => {
    if (image.name === "lookup fails") throw new Error("tasklist is blocked");
    return image.name;
  },
}));

const nxm = vi.hoisted(() => ({ restored: [] as unknown[] }));
vi.mock("./nxmHandler", async (original) => ({
  ...(await original<typeof import("./nxmHandler")>()),
  restoreNxmHandlerOrWarn: (saved: unknown) => {
    nxm.restored.push(saved);
  },
}));

async function load() {
  vi.resetModules();
  return import("./runningVortex");
}

function record(pid: number, extra: Record<string, unknown> = {}) {
  return {
    pid,
    startedAt: "2026-01-01T00:00:00.000Z",
    cacheDir: "C:/cache",
    userDataDir: "C:/cache/live",
    mcpPort: 3701,
    ...extra,
  };
}

describe("the instance record", () => {
  beforeEach(() => {
    state.dir = fs.mkdtempSync(path.join(os.tmpdir(), "running-vortex-"));
    image.name = "electron.exe";
  });
  afterEach(() => fs.rmSync(state.dir, { recursive: true, force: true }));

  it("lives in the per-user state folder, ~/.doodlebot/instance.json", async () => {
    const m = await load();
    expect(m.INSTANCE_RECORD).toBe(path.join(state.dir, "instance.json"));
    const real = await vi.importActual<typeof import("./paths")>("./paths");
    expect(real.USER_STATE_DIR).toBe(path.join(os.homedir(), ".doodlebot"));
  });

  it("has no running Vortex without a record, and clears an invalid one", async () => {
    const m = await load();
    expect(m.runningVortex()).toBeUndefined();
    fs.writeFileSync(m.INSTANCE_RECORD, "{ not json");
    expect(m.runningVortex()).toBeUndefined();
    expect(fs.existsSync(m.INSTANCE_RECORD)).toBe(false);
  });

  it("reports a live Vortex and tolerates unknown fields", async () => {
    const m = await load();
    m.writeInstanceRecord({ ...record(process.pid), sourceDir: "C:/src" });
    const raw = JSON.parse(fs.readFileSync(m.INSTANCE_RECORD, "utf8"));
    fs.writeFileSync(m.INSTANCE_RECORD, JSON.stringify({ ...raw, leases: [] }));
    expect(m.runningVortex()).toEqual({ ...record(process.pid), sourceDir: "C:/src" });
  });

  it("clears a record whose pid is dead or now belongs to another program", async () => {
    const m = await load();
    m.writeInstanceRecord(record(2 ** 30));
    expect(m.runningVortex()).toBeUndefined();
    expect(fs.existsSync(m.INSTANCE_RECORD)).toBe(false);
    image.name = "node.exe";
    m.writeInstanceRecord(record(process.pid));
    expect(m.runningVortex()).toBeUndefined();
    expect(fs.existsSync(m.INSTANCE_RECORD)).toBe(false);
  });

  it("keeps a live pid's record when the image lookup itself fails", async () => {
    const m = await load();
    m.writeInstanceRecord(record(process.pid));
    image.name = "lookup fails";
    expect(() => m.runningVortex()).toThrow("tasklist is blocked");
    expect(m.readInstanceRecord()?.pid).toBe(process.pid);
  });

  it("clears only the named pid's record", async () => {
    const m = await load();
    m.writeInstanceRecord(record(process.pid));
    m.clearInstanceRecord(process.pid + 1);
    expect(m.readInstanceRecord()?.pid).toBe(process.pid);
    m.clearInstanceRecord(process.pid);
    expect(m.readInstanceRecord()).toBeUndefined();
  });

  it("throws when the record cannot be written", async () => {
    const m = await load();
    fs.mkdirSync(m.INSTANCE_RECORD);
    expect(() => m.writeInstanceRecord(record(process.pid))).toThrow();
  });

  it("refuses with exact messages", async () => {
    const m = await load();
    expect(() => m.assertNoHarnessVortex("the core suite")).not.toThrow();
    m.writeInstanceRecord({ ...record(process.pid), sourceDir: path.join(state.dir, "src") });
    expect(() => m.assertNoHarnessVortex("the core suite")).toThrow(
      `A harness Vortex is running (pid ${process.pid}, cache C:/cache); run \`doodlebot down\` before the core suite.`,
    );
    const checkout = path.join(state.dir, "src");
    expect(() => m.assertNoVortexRunningFrom(checkout, "building it")).toThrow(
      `A harness Vortex is running from ${checkout} (pid ${process.pid}); run \`doodlebot down\` before building it.`,
    );
    expect(() =>
      m.assertNoVortexRunningFrom(path.join(state.dir, "other"), "building it"),
    ).not.toThrow();
  });

  it("keeps the build and nxm handler, and writes the handler back when the record goes", async () => {
    const m = await load();
    nxm.restored = [];
    const saved = { command: '"C:\\Vortex\\Vortex.exe" -d "%1"' };
    m.writeInstanceRecord({
      ...record(process.pid),
      exe: "C:/Vortex/Vortex.exe",
      nxmHandler: saved,
    });
    expect(m.runningVortex()).toEqual({
      ...record(process.pid),
      exe: "C:/Vortex/Vortex.exe",
      nxmHandler: saved,
    });
    expect(nxm.restored).toEqual([]);
    // A Vortex that died keeps the value until the next command finds the record stale.
    image.name = "node.exe";
    expect(m.runningVortex()).toBeUndefined();
    expect(nxm.restored).toEqual([saved]);
    m.writeInstanceRecord({ ...record(process.pid), nxmHandler: { absent: true } });
    m.clearInstanceRecord(process.pid);
    expect(nxm.restored).toEqual([saved, { absent: true }]);
  });
});

describe("restarting a leftover (no cross-session stop)", () => {
  beforeEach(() => {
    state.dir = fs.mkdtempSync(path.join(os.tmpdir(), "running-vortex-"));
  });
  afterEach(() => fs.rmSync(state.dir, { recursive: true, force: true }));

  it("restarts only a leftover of the same build", async () => {
    const m = await load();
    const worktreeA = path.join(state.dir, "worktree-a");
    const worktreeB = path.join(state.dir, "worktree-b");
    const branchOf = (dir: string) => (dir === worktreeA ? "fix-a" : undefined);
    const fromA = { ...record(4321), sourceDir: worktreeA };
    expect(m.leftoverRefusal(fromA, `${worktreeA}${path.sep}`, branchOf)).toBeUndefined();
    expect(m.leftoverRefusal(fromA, worktreeB, branchOf)).toBe(
      `A harness Vortex of another build is running from ${worktreeA} (branch fix-a) (pid 4321); run \`doodlebot down\` before starting Vortex.`,
    );
    const release = { ...record(4321), exe: "C:/releases/2.8.0/app/Vortex.exe" };
    expect(m.leftoverRefusal(release, "C:\\releases\\2.8.0\\app\\Vortex.exe")).toBeUndefined();
    expect(m.leftoverRefusal(release, "C:/releases/2.7.1/app/Vortex.exe")).toContain(
      "running from C:/releases/2.8.0/app/Vortex.exe (pid 4321)",
    );
    expect(m.leftoverRefusal(record(4321), "C:/Vortex/Vortex.exe")).toContain(
      "running from an unrecorded build",
    );
  });

  it("names a launch's build by its checkout, or its executable", async () => {
    const m = await load();
    expect(m.buildOf({ kind: "dev", executable: "C:/src/electron.exe", sourceDir: "C:/src" })).toBe(
      "C:/src",
    );
    expect(m.buildOf({ kind: "installed", executable: "C:/Vortex/Vortex.exe" })).toBe(
      "C:/Vortex/Vortex.exe",
    );
  });
});
