import { describe, expect, it, vi } from "vitest";

import { modsStillInstalling } from "./deployment";
import type { VortexMcpClient } from "./mcpClient";
import {
  findCollectionMod,
  parseCollectionRef,
  resolveCollection,
  throwOnCollectionErrors,
  selectOptionalMembers,
} from "./collections";

describe("collection identity", () => {
  it.each([
    [
      { tag: "same", description: "required" },
      { tag: "same", description: "optional", fileSize: 2 },
    ],
    [
      { repo: { gameId: "skyrimse", fileId: 1 }, description: "required" },
      { repo: { fileId: 1, gameId: "skyrimse" }, description: "optional" },
    ],
    [
      { id: "same", archiveId: "a" },
      { id: "same", tag: "extra" },
    ],
  ])(
    "rejects stock-equivalent helper, nested-order and ID references before mutation",
    async (required, optional) => {
      const mod = {
        id: "pinned",
        rules: [
          { type: "requires", reference: required },
          { type: "recommends", reference: optional },
        ],
      };
      const call = vi.fn();
      await expect(
        selectOptionalMembers(
          { call } as unknown as VortexMcpClient,
          { gameId: "skyrimse", slug: "wanted", revision: 2 },
          mod,
          "skip",
        ),
      ).rejects.toThrow("overlaps a required reference");
      expect(call).not.toHaveBeenCalled();
    },
  );
  it("rejects a required/optional shared reference before any mutation", async () => {
    const reference = { description: "same" };
    const mod = {
      id: "pinned",
      rules: [
        { type: "requires", reference },
        { type: "recommends", reference },
      ],
    };
    const call = vi.fn();
    await expect(
      selectOptionalMembers(
        { call } as unknown as VortexMcpClient,
        { gameId: "skyrimse", slug: "wanted", revision: 2 },
        mod,
        "skip",
      ),
    ).rejects.toThrow("overlaps a required reference");
    expect(call).not.toHaveBeenCalled();
  });
  it.each(["skip", "install"] as const)(
    "persists only the optional rules and preserves their references: %s",
    async (choice) => {
      const required = {
        type: "requires",
        reference: { description: "required", tag: "required" },
      };
      const optional = {
        type: "recommends",
        reference: { description: "paid optional", tag: "optional" },
        ignored: choice === "install",
        extra: "curator data",
      };
      const mod = {
        id: "pinned",
        type: "collection",
        attributes: { collectionSlug: "wanted", revisionNumber: 2 },
        rules: [required, optional],
      };
      const call = vi.fn(async (tool: string, args: Record<string, unknown>) => {
        if (tool === "vortex_dispatch") {
          Object.assign(optional, (args.args as unknown[])[2]);
          return;
        }
        return { pinned: mod };
      });
      const count = await selectOptionalMembers(
        { call } as unknown as VortexMcpClient,
        { gameId: "skyrimse", slug: "wanted", revision: 2 },
        mod,
        choice,
      );
      expect(count).toBe(1);
      expect(call).toHaveBeenCalledWith("vortex_dispatch", {
        action: "addModRule",
        args: ["skyrimse", "pinned", { ...optional, ignored: choice === "skip" }],
      });
      expect(required).not.toHaveProperty("ignored");
      expect(optional.extra).toBe("curator data");
    },
  );
  it("refuses a policy whose state write did not persist", async () => {
    const mod = {
      id: "pinned",
      type: "collection",
      attributes: { collectionSlug: "wanted", revisionNumber: 2 },
      rules: [{ type: "recommends", reference: {} }],
    };
    const mcp = { call: vi.fn(async () => ({ pinned: mod })) } as unknown as VortexMcpClient;
    await expect(
      selectOptionalMembers(mcp, { gameId: "skyrimse", slug: "wanted", revision: 2 }, mod, "skip"),
    ).rejects.toThrow("did not persist");
  });
  it("fails on new dependency errors while ignoring stale notifications", async () => {
    const mcp = {
      call: vi.fn(async () => [
        { id: "old", type: "error", title: "Failed to look up dependency", message: "old failure" },
      ]),
    } as unknown as VortexMcpClient;
    const previous = new Set([
      JSON.stringify(["old", "error", "Failed to look up dependency", "old failure"]),
    ]);
    await expect(throwOnCollectionErrors(mcp, previous)).resolves.toBeUndefined();
    vi.mocked(mcp.call).mockResolvedValueOnce([
      { id: "old", type: "error", title: "Failed to look up dependency", message: "new failure" },
    ]);
    await expect(throwOnCollectionErrors(mcp, previous)).rejects.toThrow("new failure");
    await expect(throwOnCollectionErrors(mcp, new Set())).rejects.toThrow(
      /profile and downloads are preserved/,
    );
  });
  it("rejects lookalike domains and malformed slugs", () => {
    expect(() =>
      parseCollectionRef("https://evilnexusmods.com/fallout4/collections/test"),
    ).toThrow();
    expect(() => parseCollectionRef('nxm://fallout4/collections/x"}')).toThrow();
    expect(
      parseCollectionRef("https://www.nexusmods.com/games/fallout4/collections/pmmttm/revisions/2"),
    ).toEqual({ gameId: "fallout4", slug: "pmmttm", revision: 2 });
  });
  it("does not resume a different collection or revision", async () => {
    const mcp = {
      call: vi.fn(async () => ({
        wrong: {
          id: "wrong",
          type: "collection",
          attributes: { collectionSlug: "other", revisionNumber: 2 },
        },
        old: {
          id: "old",
          type: "collection",
          attributes: { collectionSlug: "wanted", revisionNumber: 1 },
        },
        correct: {
          id: "correct",
          type: "collection",
          attributes: { collectionSlug: "wanted", revisionNumber: 2 },
        },
      })),
    } as unknown as VortexMcpClient;
    expect(
      (await findCollectionMod(mcp, { gameId: "fallout4", slug: "wanted", revision: 2 }))?.id,
    ).toBe("correct");
  });
  it("uses the requested revision's id as well as its revision number", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            collection: {
              id: 1,
              name: "test",
              currentRevision: { id: 99, revisionNumber: 9, modCount: 99 },
            },
            requested: { id: 22, revisionNumber: 2, modCount: 3 },
          },
        }),
        { status: 200 },
      ),
    );
    try {
      expect(
        await resolveCollection({ gameId: "fallout4", slug: "wanted", revision: 2 }),
      ).toMatchObject({ revisionId: 22, revisionNumber: 2, modCount: 3 });
    } finally {
      fetcher.mockRestore();
    }
  });
});

function mcpWithMods(
  mods: Record<string, { id: string; name?: string; state?: string; type?: string }>,
) {
  return {
    call: vi.fn(async () => mods),
  } as unknown as VortexMcpClient;
}

describe("modsStillInstalling", () => {
  it("reports mods whose installer has not finished", async () => {
    // A mod is in state from the moment its install STARTS. It sits at
    // "installing" — archive filename, disabled — until its installer
    // completes, which for a FOMOD means until someone answers the wizard.
    // Treating its presence as success is what let a collection report itself
    // complete while four installers were still open.
    const mcp = mcpWithMods({
      a: { id: "a", name: "FallUI - Map", state: "installed" },
      b: { id: "b", name: "FallUI - HUD-51813-1-7-1", state: "installing" },
      c: { id: "c", name: "FIS - Item Sorter-60580", state: "installing" },
    });

    const pending = await modsStillInstalling(mcp, "fallout4");

    expect(pending.map((m) => m.name)).toEqual([
      "FallUI - HUD-51813-1-7-1",
      "FIS - Item Sorter-60580",
    ]);
  });

  it("is empty once everything has finished", async () => {
    const mcp = mcpWithMods({
      a: { id: "a", state: "installed" },
      b: { id: "b", state: "installed", type: "collection" },
    });
    await expect(modsStillInstalling(mcp, "fallout4")).resolves.toEqual([]);
  });

  it("refuses to certify installation when state cannot be read", async () => {
    const mcp = {
      call: vi.fn(async () => {
        throw new Error("nope");
      }),
    } as unknown as VortexMcpClient;
    await expect(modsStillInstalling(mcp, "fallout4")).rejects.toThrow("nope");
  });
});
