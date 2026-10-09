import { afterEach, expect, it, vi } from "vitest";
import { installCollection } from "./collections";
import type { VortexMcpClient } from "./mcpClient";
import { clickByName } from "./uiDriver";

vi.mock("./uiDriver", async (original) => ({
  ...(await original<typeof import("./uiDriver")>()),
  clickByName: vi.fn(async () => undefined),
}));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.mocked(clickByName).mockReset();
});

it.each([
  "query",
  "start",
  "installing",
  "disclaimer",
  "review",
  "idle",
  "preparing",
  "fresh",
  "fresh-unclaimed",
  "foreign",
  "foreign-review",
  "dispatch-error",
  "click-error",
  "changed-owner",
  "unknown-preparation",
  "missing-preparation",
  "collectionless-start",
  "closed-review",
  "preparation-changes",
  "preparation-unobservable",
  "query-vanishes",
])("starts the exact collection once without hiding failures: %s", async (mode) => {
  vi.useFakeTimers();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        data: {
          collection: {
            id: 1,
            name: "Fixture",
            currentRevision: { id: 2, revisionNumber: 2, modCount: 1 },
          },
          requested: { id: 2, revisionNumber: 2, modCount: 1 },
        },
      }),
    ),
  );
  const fresh = mode.startsWith("fresh");
  let added = !fresh;
  let warning = false;
  let observations = 0;
  const idle = [
    "idle",
    "dispatch-error",
    "preparing",
    "fresh",
    "fresh-unclaimed",
    "unknown-preparation",
    "missing-preparation",
    "collectionless-start",
    "closed-review",
  ].includes(mode);
  const foreign = mode.startsWith("foreign");
  const driver = {
    found: true,
    collectionId: idle ? undefined : foreign ? "other" : "pinned",
    lastCollectionId: "pinned",
    preparing:
      mode === "unknown-preparation"
        ? null
        : mode === "missing-preparation"
          ? undefined
          : mode === "preparing" || mode === "fresh",
    step: idle
      ? "prepare"
      : foreign ||
          [
            "click-error",
            "changed-owner",
            "preparation-changes",
            "preparation-unobservable",
            "query-vanishes",
          ].includes(mode)
        ? "query"
        : mode,
    installDone: mode === "review" || mode === "foreign-review" || mode === "closed-review",
  };
  if (mode === "collectionless-start") driver.step = "start";
  if (mode === "closed-review") driver.step = "review";
  if (mode === "preparation-changes")
    setTimeout(() => {
      driver.preparing = false;
    }, 6000);
  if (driver.preparing)
    setTimeout(() => {
      driver.preparing = false;
      driver.collectionId = "pinned";
      driver.step = "query";
    }, 500);
  const mod = {
    id: "pinned",
    type: "collection",
    attributes: { collectionSlug: "wanted", revisionNumber: 2 },
    rules: [{ type: "requires", reference: { tag: "member" } }],
  };
  const call = vi.fn(async (tool: string, args?: Record<string, unknown>) => {
    if (tool === "nexus_auth_status") return { oauthPresent: true, oauthRefreshable: true };
    if (tool === "list_notifications")
      return warning
        ? [{ id: "duplicate", type: "warning", message: "Already installing a collection" }]
        : [];
    if (tool === "collection_download_failures") return [];
    if (tool === "collection_install_state") {
      observations++;
      if (observations === 3) {
        if (mode === "preparation-changes") driver.preparing = true;
        if (mode === "preparation-unobservable") driver.preparing = null;
        if (mode === "query-vanishes") driver.step = "installing";
      }
      if (mode === "changed-owner" && observations >= 3) driver.collectionId = "other";
      return { driver, session: null };
    }
    if (tool === "vortex_query") {
      if (args?.selector === "activeGameId") return "skyrimse";
      const route = ((args?.path ?? []) as string[]).join("/");
      if (route.endsWith("isPremium")) return true;
      if (route.endsWith("maxParallelDownloads")) return 10;
      return added ? { pinned: mod } : {};
    }
    if (tool === "vortex_dispatch") {
      if (args?.action === "start-download") {
        added = true;
        return;
      }
      if (args?.action === "resume-collection") {
        if (mode === "dispatch-error")
          throw new Error("Already installing a collection: transport rejected dispatch");
        if (driver.collectionId !== undefined) {
          warning = true;
          return;
        }
        driver.collectionId = "pinned";
        driver.step = "start";
      }
      return;
    }
    if (tool === "collection_status")
      return [
        {
          collectionModId: "pinned",
          required: 1,
          satisfied: 1,
          complete: true,
          optional: 0,
          optionalSelected: 0,
          optionalIgnored: 0,
          optionalSatisfied: 0,
        },
      ];
    throw new Error(`Unexpected tool ${tool}`);
  });
  vi.mocked(clickByName).mockImplementation(async () => {
    if (mode === "click-error") throw new Error("Native click rejected");
    driver.step = "installing";
    return {} as never;
  });
  const outcome = installCollection(
    { call } as unknown as VortexMcpClient,
    "nxm://skyrimspecialedition/collections/wanted/revisions/2",
    {
      autoAnswer: false,
      warningsAsErrors: true,
      timeoutMs: 12_000,
      verifyCompletion: async () => undefined,
    },
  ).then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  await vi.advanceTimersByTimeAsync(13_000);
  const result = await outcome;
  const fails = [
    "foreign",
    "foreign-review",
    "dispatch-error",
    "click-error",
    "changed-owner",
    "fresh-unclaimed",
    "unknown-preparation",
    "missing-preparation",
    "collectionless-start",
    "preparation-unobservable",
  ].includes(mode);
  expect(result).toHaveProperty(
    fails ? "error" : "value.complete",
    fails ? expect.any(Error) : true,
  );
  const resumes = call.mock.calls.filter(([, args]) => args?.action === "resume-collection");
  expect(resumes).toHaveLength(["idle", "dispatch-error", "closed-review"].includes(mode) ? 1 : 0);
  expect(clickByName).toHaveBeenCalledTimes(
    ["query", "preparing", "fresh", "click-error", "preparation-changes"].includes(mode) ? 1 : 0,
  );
  if ("value" in result) expect(result.value.warnings).toEqual([]);
  if (mode === "dispatch-error" && "error" in result)
    expect(result.error.message).toContain("transport rejected dispatch");
  if (mode === "click-error" && "error" in result)
    expect(result.error.message).toBe("Native click rejected");
  if (mode === "fresh-unclaimed")
    expect(call.mock.calls.filter(([, args]) => args?.action === "view-collection")).toHaveLength(
      1,
    );
});
