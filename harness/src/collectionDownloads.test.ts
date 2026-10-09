import { afterEach, expect, it, vi } from "vitest";
import type { VortexMcpClient } from "./mcpClient";
import {
  pauseCollectionDownloads,
  resumeCollectionDownloads,
  downloadProgress,
} from "./collectionDownloads";
vi.mock("./collections", () => ({
  maximizeDownloadThreads: vi.fn(async () => ({ previous: 1, threads: 10, premium: true })),
}));
const options = {
  gameId: "skyrimse",
  collectionModId: "collection",
  exclusiveProfile: true as const,
};
it("reports the actual queue counts and bytes without inferring installation completion", async () => {
  const { mcp } = client([
    {
      a: { state: "init", received: 0 },
      b: { state: "started", received: 10 },
      c: { state: "paused", received: 20 },
      d: { state: "finished", received: 30 },
      e: { state: "failed", received: 5 },
    },
  ]);
  await expect(downloadProgress(mcp)).resolves.toEqual({
    total: 5,
    active: 2,
    paused: 1,
    finished: 1,
    receivedBytes: 65,
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
function client(queues: unknown[], game = "skyrimse") {
  const call = vi.fn(async (tool: string, args: Record<string, unknown>) => {
    if (tool === "vortex_dispatch") return undefined;
    if (args.selector === "activeGameId") return game;
    const key = (args.path as string[]).at(-1);
    if (key === "collection") return { type: "collection" };
    return queues.length > 1 ? queues.shift() : queues[0];
  });
  return { mcp: { call } as unknown as VortexMcpClient, call };
}
it("pauses scheduling and active transfers, then proves byte counts stable", async () => {
  vi.useFakeTimers();
  const { mcp, call } = client([
    { a: { state: "started", received: 10 } },
    { a: { state: "paused", received: 12 } },
    { a: { state: "paused", received: 12 } },
  ]);
  const promise = pauseCollectionDownloads(mcp, options);
  await vi.runAllTimersAsync();
  await expect(promise).resolves.toMatchObject({
    paused: 1,
    active: 0,
    growing: 0,
    filesRetained: true,
  });
  const operations = call.mock.calls
    .filter(([tool]) => tool === "vortex_dispatch")
    .map(([, args]) => args);
  expect(operations).toEqual([
    { action: "pause-collection", args: ["skyrimse", "collection", "user"] },
    { action: "pause-download", args: ["a", "__CALLBACK__"] },
  ]);
});
it("does not declare a growing paused transfer stopped", async () => {
  vi.useFakeTimers();
  const { mcp } = client([
    { a: { state: "paused", received: 10 } },
    { a: { state: "paused", received: 10 } },
    { a: { state: "paused", received: 11 } },
  ]);
  const promise = pauseCollectionDownloads(mcp, { ...options, timeoutMs: 2000 });
  const assertion = expect(promise).rejects.toThrow("stable paused state");
  await vi.runAllTimersAsync();
  await assertion;
});
it("refuses to control a different game or a shared profile", async () => {
  const { mcp, call } = client([], "cyberpunk2077");
  await expect(pauseCollectionDownloads(mcp, options)).rejects.toThrow("active managed game");
  await expect(
    resumeCollectionDownloads(mcp, { ...options, exclusiveProfile: false as unknown as true }),
  ).rejects.toThrow("exclusively owned");
  expect(call.mock.calls.some(([tool]) => tool === "vortex_dispatch")).toBe(false);
});
it("uses the collection driver to resume at maximum account threads", async () => {
  const { mcp, call } = client([]);
  await expect(resumeCollectionDownloads(mcp, options)).resolves.toMatchObject({ threads: 10 });
  expect(call).toHaveBeenCalledWith("vortex_dispatch", {
    action: "resume-collection",
    args: ["skyrimse", "collection"],
  });
});
