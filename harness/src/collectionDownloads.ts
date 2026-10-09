import type { VortexMcpClient } from "./mcpClient";
import { maximizeDownloadThreads } from "./collections";

interface Download {
  state?: string;
  received?: number;
}
export interface DownloadProgress {
  total: number;
  active: number;
  paused: number;
  finished: number;
  receivedBytes: number;
}
/** Summarize the actual owned profile's queue without exposing archive URLs. */
export async function downloadProgress(mcp: VortexMcpClient): Promise<DownloadProgress> {
  const records = await mcp.call<Record<string, Download>>("vortex_query", {
    path: ["persistent", "downloads", "files"],
  });
  const files = Object.values(records ?? {});
  return {
    total: files.length,
    active: files.filter((file) => ["init", "started"].includes(file.state ?? "")).length,
    paused: files.filter((file) => file.state === "paused").length,
    finished: files.filter((file) => file.state === "finished").length,
    receivedBytes: files.reduce((sum, file) => sum + (file.received ?? 0), 0),
  };
}
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
export interface CollectionDownloadControlOptions {
  gameId: string;
  collectionModId: string;
  /** This operation controls the whole download queue. Use an exclusively owned benchmark profile. */
  exclusiveProfile: true;
  timeoutMs?: number;
}
export interface PausedCollectionDownloads {
  collectionModId: string;
  paused: number;
  active: 0;
  growing: 0;
  filesRetained: true;
}
async function assertCollection(
  mcp: VortexMcpClient,
  options: CollectionDownloadControlOptions,
): Promise<void> {
  if (options.exclusiveProfile !== true)
    throw new Error("Download control requires an exclusively owned benchmark profile");
  const active = await mcp.call<string | null>("vortex_query", { selector: "activeGameId" });
  const mod = await mcp.call<{ type?: string } | null>("vortex_query", {
    path: ["persistent", "mods", options.gameId, options.collectionModId],
  });
  if (active !== options.gameId || mod?.type !== "collection")
    throw new Error("Download control requires a collection in the active managed game");
}

/** Stop collection scheduling and transfers, then verify a stable queue. Does not delete archives. */
export async function pauseCollectionDownloads(
  mcp: VortexMcpClient,
  options: CollectionDownloadControlOptions,
): Promise<PausedCollectionDownloads> {
  await assertCollection(mcp, options);
  const until = Date.now() + (options.timeoutMs ?? 30_000);
  const read = () =>
    mcp.call<Record<string, Download>>("vortex_query", {
      path: ["persistent", "downloads", "files"],
    });
  await mcp.call("vortex_dispatch", {
    action: "pause-collection",
    args: [options.gameId, options.collectionModId, "user"],
  });
  while (Date.now() < until) {
    const before = await read();
    for (const [id, file] of Object.entries(before)) {
      if (["init", "started"].includes(file.state ?? ""))
        await mcp.call("vortex_dispatch", { action: "pause-download", args: [id, "__CALLBACK__"] });
    }
    await delay(1500);
    const first = await read();
    await delay(1500);
    const second = await read();
    const active = Object.values(second).some((file) =>
      ["init", "started"].includes(file.state ?? ""),
    );
    const growing = Object.entries(second).some(
      ([id, file]) => (file.received ?? 0) > (first[id]?.received ?? 0),
    );
    if (!active && !growing)
      return {
        collectionModId: options.collectionModId,
        paused: Object.values(second).filter((file) => file.state === "paused").length,
        active: 0,
        growing: 0,
        filesRetained: true,
      };
  }
  throw new Error("Collection downloads did not reach a stable paused state");
}

/** Resume the collection's own driver with the account's maximum download threads. */
export async function resumeCollectionDownloads(
  mcp: VortexMcpClient,
  options: CollectionDownloadControlOptions,
): Promise<Awaited<ReturnType<typeof maximizeDownloadThreads>>> {
  await assertCollection(mcp, options);
  const threads = await maximizeDownloadThreads(mcp);
  await mcp.call("vortex_dispatch", {
    action: "resume-collection",
    args: [options.gameId, options.collectionModId],
  });
  return threads;
}
