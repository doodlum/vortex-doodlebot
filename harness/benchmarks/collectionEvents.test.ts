import { afterEach, expect, it, vi } from "vitest";
import { CollectionRecorder } from "./collectionEvents";
import type { BenchmarkSession } from "./session";

afterEach(() => vi.useRealTimers());
it("wires projected observers, drains bounded pages and preserves the final emission timestamp", async () => {
  vi.useFakeTimers();
  const queues = new Map<string, { seq: number; receivedAt: number; args: unknown[] }[]>();
  const call = vi.fn(async (tool: string, args: Record<string, unknown>) => {
    if (tool === "watch_state_changes" || tool === "vortex_dispatch") {
      const id =
        tool === "watch_state_changes"
          ? (args.path as string[]).at(-1)!
          : (args.args as string[])[0]!;
      queues.set(id, []);
      return { listenerId: id };
    }
    const entries = queues
      .get(args.listenerId as string)!
      .filter((e) => e.seq > ((args.since as number) ?? 0))
      .slice(0, (args.limit as number) ?? 500);
    return { entries, lastSeq: entries.at(-1)?.seq ?? args.since ?? 0 };
  });
  const recorder = new CollectionRecorder(
    { gameId: "test", evidence: [], call } as unknown as BenchmarkSession,
    false,
  );
  await recorder.start();
  recorder.markAdd();
  const at = Date.now() + 1;
  const add = (id: string, args: unknown[], delta: number) => {
    const queue = queues.get(id)!;
    queue.push({ seq: queue.length + 1, receivedAt: at + delta, args });
  };
  add("test", [{}, { collection: { state: "installed", type: "collection" } }], 0);
  for (let i = 0; i < 20; i++) {
    add("files", [{}, { [i]: { state: "started" } }], i);
    add("files", [{ [i]: { state: "started" } }, { [i]: { state: "finished" } }], 30 + i);
    add("test", [{}, { [i]: { state: "installing", type: "" } }], i);
    add(
      "test",
      [{ [i]: { state: "installing", type: "" } }, { [i]: { state: "installed", type: "" } }],
      50 + i,
    );
  }
  add("will-deploy", [], 70);
  add("did-deploy", [], 80);
  await recorder.stop();
  expect(recorder.seenDownloads.size).toBe(20);
  expect(recorder.phases.find((e) => e.phase === "install" && e.edge === "end")!.at).toBe(at + 69);
  expect(call).toHaveBeenCalledWith(
    "watch_state_changes",
    expect.objectContaining({
      path: ["persistent", "downloads", "files"],
      fields: { state: ["state"], collectionId: ["modInfo", "nexus", "ids", "collectionId"] },
    }),
  );
  expect(call).toHaveBeenCalledWith("poll_listener", expect.objectContaining({ limit: 128 }));
});
it("surfaces a listener failure during installation, before the stop boundary", async () => {
  vi.useFakeTimers();
  const call = vi.fn(async (tool: string, args: Record<string, unknown>) => {
    if (tool !== "poll_listener") return { listenerId: "unit" };
    if (args.since !== undefined) throw new Error("projected listener overflow");
    return { entries: [], lastSeq: 0 };
  });
  const recorder = new CollectionRecorder(
    { gameId: "test", evidence: [], call } as unknown as BenchmarkSession,
    false,
  );
  await recorder.start();
  await vi.advanceTimersByTimeAsync(100);
  expect(() => recorder.assertHealthy()).toThrow("projected listener overflow");
  await expect(recorder.stop()).rejects.toThrow("projected listener overflow");
});

it("drains a nearly full ring in one scheduled cycle before new events can overwrite it", async () => {
  vi.useFakeTimers();
  const queue: { seq: number; receivedAt: number; args: unknown[] }[] = [];
  const call = vi.fn(async (tool: string, args: Record<string, unknown>) => {
    if (tool !== "poll_listener")
      return {
        listenerId:
          tool === "watch_state_changes"
            ? (args.path as string[]).at(-1)
            : (args.args as string[])[0],
      };
    const entries =
      args.listenerId === "files"
        ? queue
            .filter((e) => e.seq > ((args.since as number) ?? 0))
            .slice(0, (args.limit as number) ?? 500)
        : [];
    return { entries, lastSeq: entries.at(-1)?.seq ?? args.since ?? 0 };
  });
  const recorder = new CollectionRecorder(
    { gameId: "test", evidence: [], call } as unknown as BenchmarkSession,
    false,
  );
  await recorder.start();
  for (let i = 0; i < 240; i++) {
    queue.push({
      seq: queue.length + 1,
      receivedAt: i * 2,
      args: [{}, { [i]: { state: "started" } }],
    });
    queue.push({
      seq: queue.length + 1,
      receivedAt: i * 2 + 1,
      args: [{ [i]: { state: "started" } }, { [i]: { state: "finished" } }],
    });
  }
  await vi.advanceTimersByTimeAsync(100);
  expect(recorder.seenDownloads.size).toBe(240);
  expect(() => recorder.assertHealthy()).not.toThrow();
  // The fixture deliberately has no install/deploy phase; stop remains strict.
  await expect(recorder.stop()).rejects.toThrow("Missing valid add");
});

it("keeps a failed transfer as a failure even if the same ID later finishes", async () => {
  const recorder = new CollectionRecorder(
    { gameId: "test", evidence: [], call: vi.fn() } as unknown as BenchmarkSession,
    false,
  );
  const consume = (before: unknown, after: unknown, at: number) =>
    (recorder as unknown as { consume(kind: string, entry: unknown): void }).consume("downloads", {
      seq: at,
      receivedAt: at,
      args: [{ member: before }, { member: after }],
    });
  consume(null, { state: "started" }, 1);
  consume({ state: "started" }, { state: "failed" }, 2);
  consume({ state: "failed" }, { state: "started" }, 3);
  consume({ state: "started" }, { state: "finished" }, 4);
  await expect(recorder.stop()).rejects.toThrow("Collection member download failed");
});

it.each([false, true])(
  "only accepts historical failures as warnings after a verified lenient completion: %s",
  async (verified) => {
    const warnings: unknown[] = [];
    const recorder = new CollectionRecorder(
      { gameId: "test", evidence: [] } as unknown as BenchmarkSession,
      false,
      { warningsAsErrors: false, onWarning: (warning) => warnings.push(warning) },
    );
    const consume = (kind: string, before: unknown, after: unknown, at: number) =>
      (recorder as unknown as { consume(kind: string, entry: unknown): void }).consume(kind, {
        seq: at,
        receivedAt: at,
        args: [before, after],
      });
    recorder.markAdd();
    const start = Date.now();
    consume("mods", {}, { collection: { type: "collection", state: "installed" } }, start + 1);
    consume("downloads", {}, { failed: { state: "started" } }, start + 2);
    consume(
      "downloads",
      { failed: { state: "started" } },
      { failed: { state: "failed" } },
      start + 3,
    );
    consume("downloads", {}, { finished: { state: "started" } }, start + 4);
    consume(
      "downloads",
      { finished: { state: "started" } },
      { finished: { state: "finished" } },
      start + 5,
    );
    consume("mods", {}, { member: { state: "installing" } }, start + 6);
    consume(
      "mods",
      { member: { state: "installing" } },
      { member: { state: "installed" } },
      start + 7,
    );
    consume("will-deploy", {}, {}, start + 8);
    consume("did-deploy", {}, {}, start + 9);
    expect(warnings).toEqual([
      expect.objectContaining({
        source: "download",
        id: "failed",
        originalSeverity: "error",
        at: start + 3,
      }),
    ]);
    if (verified) await recorder.stop(true);
    else await expect(recorder.stop(false)).rejects.toThrow("Collection member download failed");
  },
);
