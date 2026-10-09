import { describe, expect, it, vi } from "vitest";
import { maximizeDownloadThreads } from "./collections";
import type { VortexMcpClient } from "./mcpClient";

function client(premium: unknown, ignored = false) {
  let threads = 1;
  const call = vi.fn(async (tool: string, args: Record<string, unknown>) => {
    if (tool === "vortex_dispatch") {
      if (!ignored) threads = (args.args as number[])[0]!;
      return;
    }
    return (args.path as string[]).at(-1) === "isPremium" ? premium : threads;
  });
  return { mcp: { call } as unknown as VortexMcpClient, call };
}

describe("account-supported download concurrency", () => {
  it.each([true, false])("respects the actual Premium entitlement: %s", async (premium) => {
    const { mcp, call } = client(premium);
    expect(await maximizeDownloadThreads(mcp)).toEqual({
      previous: 1,
      threads: premium ? 10 : 1,
      premium,
    });
    expect(call).toHaveBeenCalledWith("vortex_dispatch", {
      action: "type:SET_MAX_DOWNLOADS",
      args: [premium ? 10 : 1],
    });
  });
  it("refuses an unknown entitlement without dispatching a setting", async () => {
    const { mcp, call } = client(undefined);
    await expect(maximizeDownloadThreads(mcp)).rejects.toThrow("membership status is unavailable");
    expect(call.mock.calls.some(([tool]) => tool === "vortex_dispatch")).toBe(false);
  });
  it("fails when the running Vortex does not apply the setting", async () => {
    const { mcp } = client(true, true);
    await expect(maximizeDownloadThreads(mcp)).rejects.toThrow("did not apply 10 download threads");
  });
});
