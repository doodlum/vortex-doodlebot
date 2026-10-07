import { describe, expect, it, vi } from "vitest";
import { deployMods, purgeGame } from "./deployment";
import type { VortexMcpClient } from "./mcpClient";

describe("deployment operations", () => {
  it("refuses unfinished installs before dispatching or answering any dialog", async () => {
    const call = vi.fn(async () => ({
      a: { id: "a", name: "Pending FOMOD", state: "installing" },
    }));
    await expect(deployMods({ call } as unknown as VortexMcpClient, "sandbox")).rejects.toThrow(
      "Pending FOMOD",
    );
    expect(call).toHaveBeenCalledExactlyOnceWith("vortex_query", {
      path: ["persistent", "mods", "sandbox"],
    });
  });

  it("does not dispatch when install state cannot be read", async () => {
    const call = vi.fn().mockRejectedValue(new Error("renderer disconnected"));
    await expect(deployMods({ call } as unknown as VortexMcpClient, "sandbox")).rejects.toThrow(
      "renderer disconnected",
    );
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("leaves destructive external-change defaults unanswered during deployment", async () => {
    vi.useFakeTimers();
    const progress: string[] = [];
    const call = vi.fn(async (tool: string) => {
      if (tool === "vortex_query") return {};
      if (tool === "ui_active_dialogs") return ["External changes: Links were deleted"];
      if (tool === "vortex_dispatch")
        return new Promise<void>((_resolve, reject) => {
          setTimeout(() => reject(new Error("waiting for user decision")), 2_000);
        });
      throw new Error(`Unsafe tool call: ${tool}`);
    });
    try {
      const operation = deployMods({ call } as unknown as VortexMcpClient, "sandbox", {
        onProgress: (message) => progress.push(message),
      });
      const rejected = expect(operation).rejects.toThrow("waiting for user decision");
      await vi.advanceTimersByTimeAsync(2_000);
      await rejected;
      expect(progress.some((message) => message.includes("staging files"))).toBe(true);
      expect(call.mock.calls.some(([tool]) => tool === "ui_click" || tool === "ui_snapshot")).toBe(
        false,
      );
      await vi.runOnlyPendingTimersAsync();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["deploy", "purge"])(
    "%s cancels a foreign purge instead of accepting it",
    async (operation) => {
      vi.useFakeTimers();
      let finish: (() => void) | undefined;
      const clicked: string[] = [];
      const call = vi.fn(async (tool: string, args?: Record<string, unknown>) => {
        if (tool === "vortex_query") return {};
        if (tool === "vortex_dispatch")
          return new Promise<void>((_resolve, reject) => {
            finish = () => reject(new Error("foreign deployment cancelled"));
          });
        if (tool === "ui_active_dialogs") return ["Purge files from different instance?"];
        if (tool === "ui_snapshot")
          return {
            generation: 1,
            nodeCount: 3,
            truncated: false,
            rootText: "Purge files from different instance?",
            activeDialogs: [],
            tree: [
              {
                ref: "dialog",
                role: "dialog",
                text: "Purge files from different instance?",
                children: [
                  { ref: "cancel", role: "button", name: "Cancel" },
                  { ref: "purge", role: "button", name: "Purge" },
                ],
              },
            ],
          };
        if (tool === "ui_click") {
          clicked.push(String(args?.ref));
          finish?.();
          return {};
        }
        throw new Error(`Unexpected ${tool}`);
      });
      const mcp = { call } as unknown as VortexMcpClient;
      try {
        const result = operation === "deploy" ? deployMods(mcp, "sandbox") : purgeGame(mcp);
        const rejected = expect(result).rejects.toThrow("foreign deployment cancelled");
        await vi.advanceTimersByTimeAsync(1_000);
        await rejected;
        expect(clicked).toEqual(["cancel"]);
        await vi.runOnlyPendingTimersAsync();
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );
});
