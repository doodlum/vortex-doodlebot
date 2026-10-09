import { describe, expect, it, vi } from "vitest";
import { nexusCollectionDomain, vortexCollectionGameId } from "./collectionIdentity";
import { installCollection, parseCollectionRef, resolveCollection, toNxmUrl } from "./collections";
import type { VortexMcpClient } from "./mcpClient";

describe("Nexus domains and Vortex game IDs", () => {
  it.each(["skyrimse", "skyrimspecialedition"])(
    "accepts %s URLs while using canonical API and nxm domain",
    async (domain) => {
      const ref = parseCollectionRef(
        `https://www.nexusmods.com/games/${domain}/collections/fixture/revisions/2`,
      );
      expect(ref).toEqual({ gameId: "skyrimse", slug: "fixture", revision: 2 });
      expect(toNxmUrl(ref)).toBe("nxm://skyrimspecialedition/collections/fixture/revisions/2");
      const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              collection: { id: 1, name: "fixture" },
              requested: { id: 22, revisionNumber: 2, modCount: 3 },
            },
          }),
          { status: 200 },
        ),
      );
      try {
        expect(await resolveCollection(ref)).toMatchObject({
          gameId: "skyrimse",
          revisionId: 22,
          revisionNumber: 2,
        });
        const body = JSON.parse(String(fetcher.mock.calls[0]![1]!.body)) as {
          variables: { game: string };
        };
        expect(body.variables.game).toBe("skyrimspecialedition");
      } finally {
        fetcher.mockRestore();
      }
    },
  );
  it("recognizes the active Vortex game for a public domain URL before fetching metadata", async () => {
    const mcp = {
      call: vi.fn(async (tool: string, args?: Record<string, unknown>) =>
        tool === "nexus_auth_status"
          ? { oauthPresent: true, oauthRefreshable: true }
          : args?.selector === "activeGameId"
            ? "skyrimse"
            : [],
      ),
    } as unknown as VortexMcpClient;
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("deliberate API boundary"));
    try {
      await expect(
        installCollection(mcp, "nxm://skyrimspecialedition/collections/fixture/revisions/2", {
          autoAnswer: false,
        }),
      ).rejects.toThrow("deliberate API boundary");
    } finally {
      fetcher.mockRestore();
    }
  });
  it("preserves games whose identifiers already match", () => {
    expect(vortexCollectionGameId("fallout4")).toBe("fallout4");
    expect(nexusCollectionDomain("cyberpunk2077")).toBe("cyberpunk2077");
  });
  it.each([
    { revisionNumber: 2, expected: 4, reason: "listed count differs" },
    { revisionNumber: 3, expected: 3, reason: "requested pin" },
  ])(
    "rejects stale metadata before requesting a download: %j",
    async ({ revisionNumber, expected, reason }) => {
      const call = vi.fn(async (tool: string, args?: Record<string, unknown>) =>
        tool === "nexus_auth_status"
          ? { oauthPresent: true, oauthRefreshable: true }
          : args?.selector === "activeGameId"
            ? "skyrimse"
            : [],
      );
      const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              collection: { id: 1, name: "fixture" },
              requested: { id: 22, revisionNumber, modCount: 3 },
            },
          }),
          { status: 200 },
        ),
      );
      try {
        await expect(
          installCollection(
            { call } as unknown as VortexMcpClient,
            "nxm://skyrimspecialedition/collections/fixture/revisions/2",
            { autoAnswer: false, expectedListedMods: expected },
          ),
        ).rejects.toThrow(reason);
        expect(call.mock.calls.some(([tool]) => tool === "vortex_dispatch")).toBe(false);
      } finally {
        fetcher.mockRestore();
      }
    },
  );
});
