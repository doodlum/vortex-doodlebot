import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({ dir: "" }));
const image = vi.hoisted(() => ({ name: "electron.exe" as string | undefined }));

vi.mock("./paths", async (original) => ({
  ...(await original<typeof import("./paths")>()),
  get DEFAULT_CACHE_DIR() {
    return cache.dir;
  },
}));
vi.mock("./processes", async (original) => ({
  ...(await original<typeof import("./processes")>()),
  processImageName: () => {
    if (image.name === "lookup fails") throw new Error("tasklist is blocked");
    return image.name;
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
    cache.dir = fs.mkdtempSync(path.join(os.tmpdir(), "running-vortex-"));
    image.name = "electron.exe";
  });
  afterEach(() => fs.rmSync(cache.dir, { recursive: true, force: true }));

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
    m.writeInstanceRecord({ ...record(process.pid), sourceDir: path.join(cache.dir, "src") });
    expect(() => m.assertNoHarnessVortex("the core suite")).toThrow(
      `A harness Vortex is running (pid ${process.pid}, cache C:/cache); run \`pnpm run ai -- down\` before the core suite.`,
    );
    const checkout = path.join(cache.dir, "src");
    expect(() => m.assertNoVortexRunningFrom(checkout, "building it")).toThrow(
      `A harness Vortex is running from ${checkout} (pid ${process.pid}); run \`pnpm run ai -- down\` before building it.`,
    );
    expect(() =>
      m.assertNoVortexRunningFrom(path.join(cache.dir, "other"), "building it"),
    ).not.toThrow();
  });
});
