import { afterEach, expect, it, vi } from "vitest";
import { installCollection, parseOptionalMods } from "./collections";
import type { VortexMcpClient } from "./mcpClient";

vi.mock("./uiDriver", async (original) => ({
  ...(await original<typeof import("./uiDriver")>()),
  clickByName: vi.fn(async () => undefined),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each(
  (["skip", "install"] as const).flatMap((choice) =>
    (["none", "before-repair", "after-repair"] as const).map((drift) => ({ choice, drift })),
  ),
)(
  "preserves $choice optional selection after regenerated rules (drift=$drift)",
  async ({ choice, drift }) => {
    vi.useFakeTimers();
    const required = { type: "requires", reference: { tag: "required" } };
    const mod = {
      id: "pinned",
      type: "collection",
      attributes: { collectionSlug: "wanted", revisionNumber: 2 },
      rules: [
        required,
        {
          type: "recommends",
          reference: { tag: "optional" },
          ignored: undefined as boolean | undefined,
        },
      ] as { type: string; reference: { tag: string }; ignored?: boolean }[],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            collection: {
              id: 1,
              name: "Pinned collection",
              currentRevision: { id: 22, revisionNumber: 2, modCount: 2 },
            },
            requested: { id: 22, revisionNumber: 2, modCount: 2 },
          },
        }),
      ),
    );
    let polls = 0;
    let refreshed = false;
    let running = false;
    const call = vi.fn(async (tool: string, args?: Record<string, unknown>) => {
      if (tool === "nexus_auth_status") return { oauthPresent: true, oauthRefreshable: true };
      if (tool === "list_notifications") return [];
      if (tool === "collection_download_failures") return [];
      if (tool === "collection_install_state")
        return {
          session: null,
          driver: {
            found: true,
            preparing: false,
            step: running ? "installing" : "prepare",
            collectionId: running ? "pinned" : undefined,
            installDone: false,
          },
        };
      if (tool === "vortex_query") {
        if (args?.selector === "activeGameId") return "skyrimse";
        const query = ((args?.path ?? []) as string[]).join("/");
        if (query.endsWith("isPremium")) return true;
        if (query.endsWith("maxParallelDownloads")) return 10;
        if (query.endsWith("/pinned")) {
          if (drift === "before-repair")
            mod.rules.push(
              { type: "requires", reference: { tag: "extra-required" } },
              { type: "recommends", reference: { tag: "extra-optional" } },
            );
          return mod;
        }
        return { pinned: mod };
      }
      if (tool === "vortex_dispatch") {
        if (args?.action === "resume-collection") {
          running = true;
          mod.rules = mod.rules.map(({ ignored: _ignored, ...rule }) => rule);
          refreshed = true;
        }
        if (args?.action === "addModRule") {
          const selected = (args.args as unknown[])[2] as (typeof mod.rules)[number];
          mod.rules = mod.rules.map((rule) =>
            rule.reference.tag === selected.reference.tag ? selected : rule,
          );
        }
        return;
      }
      if (tool === "collection_status") {
        polls++;
        const optional = mod.rules[1]!;
        const changed = drift !== "none" && polls > 1;
        return [
          {
            collectionModId: "pinned",
            name: "Pinned collection",
            required: changed ? 2 : 1,
            satisfied: changed ? 2 : polls > 2 ? 1 : 0,
            complete: changed || polls > 2,
            unsatisfied: [],
            optional: changed ? 2 : 1,
            optionalSatisfied: choice === "install" ? (changed ? 2 : 1) : 0,
            optionalIgnored: Number(optional.ignored === true) * (changed ? 2 : 1),
            optionalSelected: Number(optional.ignored === false) * (changed ? 2 : 1),
            optionalUnsatisfied: [],
          },
        ];
      }
      throw new Error(`Unexpected tool ${tool}`);
    });
    let progressChecks = 0;
    const result = installCollection({ call } as unknown as VortexMcpClient, "skyrimse/wanted", {
      autoAnswer: false,
      optionalMods: choice,
      timeoutMs: 60_000,
      verifyProgress: () => {
        progressChecks++;
        if (progressChecks > 1) {
          expect(refreshed).toBe(true);
          expect(mod.rules[1]!.ignored).toBe(choice === "skip");
        }
      },
      verifyCompletion: async () => {
        expect(mod.rules[0]).toEqual(required);
        expect(mod.rules[1]!.ignored).toBe(choice === "skip");
      },
    });
    // Attach the failure handler before advancing timers, including for the control.
    const outcome = result.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(9_100);
    const completed = await outcome;
    if (drift !== "none") {
      expect(completed).toHaveProperty("error");
      if ("error" in completed) expect(String(completed.error)).toContain("member counts changed");
      if (drift === "before-repair")
        expect(call.mock.calls.filter(([, args]) => args?.action === "addModRule")).toHaveLength(1);
      return;
    }
    if ("error" in completed) throw completed.error;
    expect(completed.value).toMatchObject({ complete: true, optionalMods: choice });
    expect(progressChecks).toBe(2);
    expect(call.mock.calls.filter(([, args]) => args?.action === "addModRule")).toHaveLength(2);
  },
);

it("parses --optionals, refusing anything but skip, install or vortex", () => {
  expect(parseOptionalMods(undefined)).toBe("skip");
  expect(parseOptionalMods("vortex")).toBe("vortex");
  expect(parseOptionalMods("install")).toBe("install");
  expect(() => parseOptionalMods("all")).toThrow(/skip, install or vortex/);
  expect(() => parseOptionalMods(true)).toThrow(/skip, install or vortex/);
});

it("leaves optional members to Vortex: writes no rule, and waits for the one it did not skip", async () => {
  vi.useFakeTimers();
  type Rule = { type: string; reference: { tag: string }; ignored?: boolean };
  const mod = {
    id: "pinned",
    type: "collection",
    attributes: { collectionSlug: "wanted", revisionNumber: 2 },
    rules: [
      { type: "requires", reference: { tag: "required" } },
      { type: "recommends", reference: { tag: "skipped" } },
      { type: "recommends", reference: { tag: "missed" } },
    ] as Rule[],
  };
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        data: {
          collection: {
            id: 1,
            name: "Pinned collection",
            currentRevision: { id: 22, revisionNumber: 2, modCount: 3 },
          },
          requested: { id: 22, revisionNumber: 2, modCount: 3 },
        },
      }),
    ),
  );
  let polls = 0;
  let running = false;
  const call = vi.fn(async (tool: string, args?: Record<string, unknown>) => {
    if (tool === "nexus_auth_status") return { oauthPresent: true, oauthRefreshable: true };
    if (tool === "list_notifications") return [];
    if (tool === "collection_download_failures") return [];
    if (tool === "collection_install_state")
      return {
        session: null,
        driver: {
          found: true,
          preparing: false,
          step: running ? "installing" : "prepare",
          collectionId: running ? "pinned" : undefined,
          installDone: false,
        },
      };
    if (tool === "vortex_query") {
      if (args?.selector === "activeGameId") return "skyrimse";
      const query = ((args?.path ?? []) as string[]).join("/");
      if (query.endsWith("isPremium")) return true;
      if (query.endsWith("maxParallelDownloads")) return 10;
      if (query.endsWith("/pinned")) return mod;
      return { pinned: mod };
    }
    if (tool === "vortex_dispatch") {
      if (args?.action === "resume-collection") {
        running = true;
        // Vortex's own default skip, missing one optional (the LAZ-958 shape).
        mod.rules[1] = { ...mod.rules[1]!, ignored: true };
      }
      if (args?.action === "addModRule") throw new Error("the harness wrote an optional rule");
      return;
    }
    if (tool === "collection_status") {
      polls++;
      const optional = mod.rules.filter((rule) => rule.type === "recommends");
      return [
        {
          collectionModId: "pinned",
          name: "Pinned collection",
          required: 1,
          satisfied: polls > 1 ? 1 : 0,
          complete: polls > 1,
          unsatisfied: [],
          optional: 2,
          // The optional Vortex did not skip installs one poll after the required member.
          optionalSatisfied: polls > 2 ? 1 : 0,
          optionalIgnored: optional.filter((rule) => rule.ignored === true).length,
          optionalSelected: optional.filter((rule) => rule.ignored === false).length,
          optionalUnsatisfied: [],
        },
      ];
    }
    throw new Error(`Unexpected tool ${tool}`);
  });
  const result = installCollection({ call } as unknown as VortexMcpClient, "skyrimse/wanted", {
    autoAnswer: false,
    optionalMods: "vortex",
    timeoutMs: 60_000,
    verifyCompletion: async () => undefined,
  });
  const outcome = result.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await vi.advanceTimersByTimeAsync(20_000);
  const completed = await outcome;
  if ("error" in completed) throw completed.error;
  expect(completed.value).toMatchObject({
    complete: true,
    optionalMods: "vortex",
    optionalCount: 2,
    optionalIgnored: 1,
    optionalSatisfied: 1,
  });
  expect(polls).toBeGreaterThanOrEqual(3);
  expect(call.mock.calls.some(([, args]) => args?.action === "addModRule")).toBe(false);
  expect(mod.rules[2]!.ignored).toBeUndefined();
});
