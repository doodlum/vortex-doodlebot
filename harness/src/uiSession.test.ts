import { describe, expect, it } from "vitest";
import type { VortexMcpClient } from "./mcpClient";
import { withUiLock } from "./uiSession";

describe("UI transactions", () => {
  it("rejects an aborted nested acquisition without releasing its enclosing transaction", async () => {
    const client = {} as VortexMcpClient;
    const controller = new AbortController();
    const reason = new DOMException("expired", "TimeoutError");
    const events: string[] = [];
    controller.abort(reason);
    await Promise.all([
      withUiLock(client, async () => {
        await expect(
          withUiLock(client, async () => events.push("expired snapshot"), controller.signal),
        ).rejects.toBe(reason);
        await withUiLock(client, async () => events.push("current snapshot"));
        events.push("current click");
      }),
      withUiLock(client, async () => events.push("watcher")),
    ]);
    expect(events).toEqual(["current snapshot", "current click", "watcher"]);
  });

  it("holds an admitted transaction until its action settles after signal cancellation", async () => {
    const client = {} as VortexMcpClient;
    const controller = new AbortController();
    let release!: () => void;
    let acquired!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const entered = new Promise<void>((resolve) => (acquired = resolve));
    const events: string[] = [];
    const action = withUiLock(
      client,
      async () => {
        acquired();
        await gate;
        events.push("click");
        return "complete";
      },
      controller.signal,
    );
    await entered;
    const watcher = withUiLock(client, async () => events.push("watcher"));
    controller.abort();
    await new Promise((resolve) => setImmediate(resolve));
    expect(events).toEqual([]);
    release();
    await expect(action).resolves.toBe("complete");
    await watcher;
    expect(events).toEqual(["click", "watcher"]);
  });

  it("allows nested snapshots and keeps a watcher behind the action", async () => {
    const client = {} as VortexMcpClient;
    const events: string[] = [];
    await Promise.all([
      withUiLock(client, async () => {
        await withUiLock(client, async () => {
          events.push("snapshot");
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        events.push("click");
      }),
      withUiLock(client, async () => {
        events.push("watcher snapshot");
      }),
    ]);
    expect(events).toEqual(["snapshot", "click", "watcher snapshot"]);
  });

  it("releases after failure so recovery can snapshot again", async () => {
    const client = {} as VortexMcpClient;
    await expect(
      withUiLock(client, async () => {
        throw new Error("stale");
      }),
    ).rejects.toThrow("stale");
    await expect(withUiLock(client, async () => "recovered")).resolves.toBe("recovered");
  });
});
