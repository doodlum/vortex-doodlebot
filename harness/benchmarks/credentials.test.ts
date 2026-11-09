import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { beginOAuthCache } from "./credentials";
import { BenchmarkSession } from "./session";
import { runInSession } from "./lifecycle";
import type { HarnessConfig } from "../src/config";
import type { VortexInstance } from "../src/instance";
import type { RendererHandle } from "../src/cdp";

const roots: string[] = [];
function fixture() {
  const base = path.resolve("harness/.artifacts/benchmark-unit-fixtures");
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, "doodlebot-benchmark-auth-"));
  roots.push(root);
  const canonical = path.join(root, "canonical.json");
  const local = path.join(root, "local.json");
  fs.writeFileSync(canonical, "opaque initial unit credential bytes");
  return { root, canonical, local };
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
describe("private OAuth rotation persistence", () => {
  it("copies the latest opaque rotation back before the next sequential session", () => {
    const { canonical, local } = fixture();
    const lease = beginOAuthCache(canonical, local);
    fs.writeFileSync(local, "opaque rotated unit credential bytes");
    lease.finish();
    expect(fs.readFileSync(canonical, "utf8")).toBe("opaque rotated unit credential bytes");
    const next = `${local}.next`;
    const nextLease = beginOAuthCache(canonical, next);
    expect(fs.readFileSync(next, "utf8")).toBe("opaque rotated unit credential bytes");
    nextLease.finish();
  });
  it("preserves logout tombstones instead of resurrecting older credentials", () => {
    const { canonical, local } = fixture();
    const lease = beginOAuthCache(canonical, local);
    fs.writeFileSync(local, "null");
    lease.finish();
    expect(fs.readFileSync(canonical, "utf8")).toBe("null");
  });
  it("keeps both caches when external credential use changes canonical input", () => {
    const { canonical, local } = fixture();
    const lease = beginOAuthCache(canonical, local);
    fs.writeFileSync(local, "unit benchmark rotation");
    fs.writeFileSync(canonical, "unit external rotation");
    expect(() => lease.finish()).toThrow("changed during this benchmark");
    expect(fs.readFileSync(canonical, "utf8")).toBe("unit external rotation");
    expect(fs.readFileSync(local, "utf8")).toBe("unit benchmark rotation");
  });
  it("saves final rotation even when the callback fails and its fixture is retained", async () => {
    const { root, canonical, local } = fixture();
    const lease = beginOAuthCache(canonical, local);
    const session = new BenchmarkSession(
      { cacheDir: root } as HarnessConfig,
      {
        process: { exitCode: 0, signalCode: null },
        stop: vi.fn(async () => {
          fs.writeFileSync(local, "unit rotation during shutdown");
        }),
      } as unknown as VortexInstance,
      { close: vi.fn(async () => undefined) } as unknown as RendererHandle,
      undefined,
      "real",
      lease,
    );
    await expect(
      runInSession(session, async () => {
        throw new Error("deliberate callback failure");
      }),
    ).rejects.toThrow("deliberate callback failure");
    expect(fs.readFileSync(canonical, "utf8")).toBe("unit rotation during shutdown");
    expect(fs.existsSync(root)).toBe(true);
  });
  it("does not save the rotation without confirmed app exit", async () => {
    const { root, canonical, local } = fixture();
    const lease = beginOAuthCache(canonical, local);
    fs.writeFileSync(local, "unflushed unit rotation");
    const session = new BenchmarkSession(
      { cacheDir: root } as HarnessConfig,
      {
        process: { exitCode: null, signalCode: null },
        stop: vi.fn(async () => undefined),
      } as unknown as VortexInstance,
      { close: vi.fn(async () => undefined) } as unknown as RendererHandle,
      undefined,
      "real",
      lease,
    );
    await expect(session.close()).rejects.toThrow("Could not confirm Vortex exit");
    expect(fs.readFileSync(canonical, "utf8")).toBe("opaque initial unit credential bytes");
    expect(fs.existsSync(root)).toBe(true);
  });
});
