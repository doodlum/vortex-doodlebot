import { afterEach, expect, it, vi } from "vitest";
import { BenchmarkSession } from "./session";
import { BenchmarkBlocked, type RunManifest } from "./types";
import type { HarnessConfig } from "../src/config";
import type { VortexInstance } from "../src/instance";
import type { RendererHandle } from "../src/cdp";

afterEach(() => {
  vi.doUnmock("../src/collections");
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each([
  "gap",
  "projection",
  "setup",
  "install-error",
  "observer-setup",
  "observer-stop",
  "install-error-observer-stop",
])(
  "keeps installation independent from invalid timing and never publishes partial timings: %s",
  async (mode) => {
    vi.useFakeTimers();
    const mod = {
      type: "collection",
      state: "installed",
      attributes: { collectionSlug: "fixture", revisionNumber: 2 },
      rules: [{ type: "requires" }],
    };
    let observed = false;
    const call = vi.fn(async (tool: string, args: Record<string, unknown>) => {
      if (tool === "watch_state_changes" || tool === "vortex_dispatch") {
        if (mode === "setup") throw new Error("Timing subscription unavailable");
        return { listenerId: "unit" };
      }
      if (tool === "poll_listener") {
        if (args.since === undefined) return { entries: [], lastSeq: 0 };
        if (mode === "projection") throw new Error("State transition observation failed");
        return { entries: [{ seq: 2, receivedAt: 1, args: [{}, {}] }], lastSeq: 2 };
      }
      if (tool === "collection_status")
        return [{ collectionModId: "collection", complete: true, required: 1, satisfied: 1 }];
      return mod;
    });
    const install = vi.fn(
      async (
        _mcp: unknown,
        _url: string,
        options: {
          verifyProgress?: () => void;
          verifyCompletion: (id: string, remaining: number) => Promise<void>;
        },
      ) => {
        expect(options).not.toHaveProperty("recovery");
        options.verifyProgress?.();
        if (mode.startsWith("install-error"))
          throw new Error("Vortex failed to install dependency");
        await options.verifyCompletion("collection", 1000);
        observed = true;
        return {
          modId: "collection",
          complete: true,
          modCount: 1,
          expectedModCount: 1,
          answeredDialogs: [],
        };
      },
    );
    vi.doMock("../src/collections", () => ({
      installCollection: install,
      parseCollectionRef: () => ({ gameId: "skyrimse", slug: "fixture", revision: 2 }),
    }));
    const page = {
      evaluate: vi.fn(async (expression: string) => {
        if (typeof expression === "string" && expression.includes("__doodleCollectionWait")) {
          const teardown = expression.includes("data.observer.disconnect()");
          if (
            (mode === "observer-setup" && !teardown) ||
            (mode.endsWith("observer-stop") && teardown)
          )
            throw new Error("Wait observer failed");
          return [];
        }
        return {
          collectionModId: "collection",
          viewVisible: true,
          driver: { step: "review", installDone: true, postprocessing: false },
          progress: { visible: false, statuses: {} },
        };
      }),
    };
    const session = new BenchmarkSession(
      { gameId: "skyrimse" } as HarnessConfig,
      { mcp: { call } } as unknown as VortexInstance,
      { page } as unknown as RendererHandle,
      {
        collection: {
          url: "nxm://skyrimspecialedition/collections/fixture/revisions/2",
          expectedMods: 1,
        },
      } as RunManifest,
      "real",
    );
    (session as unknown as { prepared: boolean }).prepared = true;
    const ready = vi.spyOn(session, "verifyReady").mockResolvedValue(undefined);
    const outcome = session
      .collectionMeasure(async () => {
        await vi.advanceTimersByTimeAsync(100);
        await session.addCollection();
      })
      .then(
        () => undefined,
        (error) => error,
      );
    const error = await outcome;
    if (mode.startsWith("install-error")) {
      expect(String(error)).toContain("Vortex failed to install dependency");
      expect(error).not.toBeInstanceOf(BenchmarkBlocked);
      expect(ready).not.toHaveBeenCalled();
      expect(session.evidence).toContainEqual(
        expect.objectContaining({
          operation: "real Nexus collection install",
          outcome: "failed",
          reason: "Vortex failed to install dependency",
        }),
      );
    } else {
      expect(error).toBeInstanceOf(BenchmarkBlocked);
      expect(observed).toBe(true);
      expect(ready).toHaveBeenCalledOnce();
      expect(session.evidence).toContainEqual({
        operation: "collection verification",
        verified: true,
      });
    }
    expect(session.evidence).toContainEqual(
      expect.objectContaining({ operation: "collection timing", valid: false }),
    );
    expect(session.measurements).toEqual([]);
    expect(session.phases).toEqual([]);
    expect(install).toHaveBeenCalledOnce();
  },
);
