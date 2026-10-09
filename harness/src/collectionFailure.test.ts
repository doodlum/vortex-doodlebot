import { afterEach, expect, it, vi } from "vitest";
import { installCollection, type CollectionWarning } from "./collections";
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
  [
    "failed-before-action",
    "failed-optional",
    "unsatisfied-optional",
    "success",
    "already-satisfied",
    "satisfied-session-failure",
  ].flatMap((mode) =>
    (mode === "satisfied-session-failure" ? [true, false] : [true]).map((autoAnswer) => ({
      mode,
      autoAnswer,
    })),
  ),
)(
  "the real dialog watcher never restarts or dismisses failed optional rounds: $mode auto=$autoAnswer",
  async ({ mode, autoAnswer }) => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            collection: {
              id: 1,
              name: "Fixture",
              currentRevision: { id: 2, revisionNumber: 2, modCount: 2 },
            },
            requested: { id: 2, revisionNumber: 2, modCount: 2 },
          },
        }),
      ),
    );
    const mod = {
      id: "pinned",
      type: "collection",
      attributes: { collectionSlug: "wanted", revisionNumber: 2 },
      rules: [
        { type: "requires", reference: { tag: "required" } },
        { type: "recommends", reference: { tag: "optional" }, ignored: false },
      ],
    };
    let running = false,
      optionalClicks = 0,
      doneClicks = 0;
    const failed = () =>
      mode === "failed-before-action" || mode === "satisfied-session-failure"
        ? Date.now() >= started + 1_000
        : mode === "failed-optional" && optionalClicks > 0;
    const ready = () =>
      (mode === "success" && optionalClicks > 0) ||
      (mode === "already-satisfied" && Date.now() >= started + 1_000) ||
      (mode === "satisfied-session-failure" && Date.now() >= started + 1_000);
    const started = Date.now();
    const call = vi.fn(async (tool: string, args?: Record<string, unknown>) => {
      if (tool === "nexus_auth_status") return { oauthPresent: true, oauthRefreshable: true };
      if (tool === "list_notifications" || tool === "collection_download_failures") return [];
      if (tool === "vortex_query") {
        if (args?.selector === "activeGameId") return "skyrimse";
        const route = ((args?.path ?? []) as string[]).join("/");
        if (route.endsWith("isPremium")) return true;
        if (route.endsWith("maxParallelDownloads")) return 10;
        return { pinned: mod };
      }
      if (tool === "vortex_dispatch") {
        if (args?.action === "resume-collection") running = true;
        return;
      }
      if (tool === "collection_status")
        return [
          {
            collectionModId: "pinned",
            required: 1,
            satisfied: 1,
            complete: true,
            optional: 1,
            optionalSelected: 1,
            optionalIgnored: 0,
            optionalSatisfied: ready() ? 1 : 0,
          },
        ];
      if (tool === "collection_install_state")
        return {
          driver: {
            found: true,
            step: running ? "review" : "prepare",
            collectionId: running ? "pinned" : undefined,
            lastCollectionId: "pinned",
            preparing: false,
            postprocessing: false,
            installDone: ready(),
          },
          session: {
            collectionId: "pinned",
            gameId: "skyrimse",
            statusCounts: failed()
              ? { installed: 1, failed: 1 }
              : optionalClicks > 0
                ? { installed: 2 }
                : { installed: 1, pending: 1 },
            outstanding: failed() ? [{ id: "optional", type: "recommends", status: "failed" }] : [],
          },
          dialogs:
            running && doneClicks === 0
              ? [
                  {
                    collectionId: "pinned",
                    via: "driver",
                    step: "review",
                    text: "Collection installation complete",
                  },
                ]
              : [],
        };
      const dialogs = running && doneClicks === 0 ? ["Collection installation complete"] : [];
      if (tool === "ui_active_dialogs") return dialogs;
      if (tool === "ui_snapshot") {
        const isModal =
          !String(args?.selector).includes("fomod-nav") &&
          (!args?.selector ||
            String(args.selector).includes("dialog") ||
            String(args.selector).includes("modal"));
        const tree =
          isModal && dialogs.length
            ? [
                { ref: "optional", role: "button", name: "Install optional mods" },
                { ref: "done", role: "button", name: "Done" },
              ]
            : [];
        return {
          generation: 1,
          title: "Fixture",
          viewport: { width: 800, height: 600 },
          nodeCount: tree.length,
          truncated: false,
          activeDialogs: dialogs,
          rootText: dialogs[0] ?? "",
          tree,
        };
      }
      if (tool === "ui_click") {
        if (args?.ref === "optional") {
          optionalClicks++;
          return { name: "Install optional mods", role: "button" };
        }
        if (args?.ref === "done") {
          doneClicks++;
          return { name: "Done", role: "button" };
        }
      }
      throw new Error(`Unexpected tool ${tool}`);
    });
    const reported: CollectionWarning[] = [];
    const verifyCompletion = vi.fn(async () => undefined);
    const outcome = installCollection(
      { call } as unknown as VortexMcpClient,
      "nxm://skyrimspecialedition/collections/wanted/revisions/2",
      {
        autoAnswer,
        warningsAsErrors: false,
        optionalMods: "install",
        timeoutMs: 6_500,
        onWarning: (warning) => reported.push(warning),
        verifyCompletion,
      },
    ).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(12_000);
    const result = await outcome;
    expect(optionalClicks).toBe(
      ["failed-before-action", "satisfied-session-failure", "already-satisfied"].includes(mode)
        ? 0
        : 1,
    );
    const succeeds = mode === "success" || mode === "already-satisfied";
    expect(doneClicks).toBe(succeeds ? 1 : 0);
    expect(verifyCompletion).toHaveBeenCalledTimes(succeeds ? 1 : 0);
    expect(call.mock.calls.filter(([, args]) => args?.action === "resume-collection")).toHaveLength(
      1,
    );
    if (succeeds) expect(result).toHaveProperty("value.complete", true);
    else {
      expect(result).toHaveProperty("error");
      if (mode.startsWith("failed") || mode === "satisfied-session-failure") {
        expect(String("error" in result && result.error)).toMatch(/does not retry/);
        expect(reported.some((warning) => warning.source === "session")).toBe(true);
      }
    }
  },
);

it.each(
  [
    "notification",
    "message-only",
    "required",
    "optional",
    "completion-error",
    "installer-session",
    "foreign-session",
    "driver-error",
    "existing-failure",
    "success",
    "native-warning",
    "no-verifier-ready",
    "no-verifier-incomplete",
    "terminal-incomplete",
    "terminal-optional",
  ].flatMap((mode) => [false, true].map((strict) => ({ mode, strict }))),
)(
  "keeps warnings, requires final functionality and never retries: $mode strict=$strict",
  async ({ mode, strict }) => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            collection: {
              id: 1,
              name: "Fixture",
              currentRevision: { id: 2, revisionNumber: 2, modCount: 2 },
            },
            requested: { id: 2, revisionNumber: 2, modCount: 2 },
          },
        }),
      ),
    );
    const mod = {
      id: "pinned",
      type: "collection",
      attributes: { collectionSlug: "wanted", revisionNumber: 2 },
      rules: [
        { type: "requires", reference: { tag: "required" } },
        { type: "recommends", reference: { tag: "optional" }, ignored: false },
      ],
    };
    let running = false,
      completed = false;
    const call = vi.fn(async (tool: string, args?: Record<string, unknown>) => {
      if (tool === "nexus_auth_status") return { oauthPresent: true, oauthRefreshable: true };
      if (tool === "list_notifications") {
        if (
          (running && (mode === "notification" || mode.startsWith("no-verifier"))) ||
          (completed && mode === "completion-error")
        )
          return [
            {
              id: "error",
              type: "error",
              title: "Collection Download Failed",
              message: "Content-Length mismatch",
            },
          ];
        if (running && mode === "message-only")
          return [{ id: "error", type: "error", message: "Failed to install dependency" }];
        if (running && mode === "native-warning")
          return [{ id: "warning", type: "warning", message: "Collection download warning" }];
        return [];
      }
      if (tool === "collection_download_failures")
        return (running && (mode === "required" || mode === "optional")) ||
          mode === "existing-failure"
          ? [{ downloadId: "failed", reference: mode + " member" }]
          : [];
      if (tool === "collection_install_state")
        return {
          driver: {
            found: true,
            step: running ? "review" : "prepare",
            installDone:
              running &&
              !["no-verifier-incomplete", "terminal-incomplete", "terminal-optional"].includes(
                mode,
              ),
            collectionId: running ? "pinned" : undefined,
            preparing: false,
            postprocessing: false,
            lastCollectionId: "pinned",
          },
          session: {
            collectionId: mode === "foreign-session" ? "other" : "pinned",
            gameId: "skyrimse",
            statusCounts: {
              failed:
                running &&
                [
                  "installer-session",
                  "foreign-session",
                  "terminal-incomplete",
                  "terminal-optional",
                ].includes(mode)
                  ? 72
                  : 0,
            },
            outstanding:
              mode === "terminal-optional"
                ? [{ id: "optional", type: "recommends", status: "failed" }]
                : [],
          },
          dialogs:
            running && mode === "terminal-incomplete"
              ? [
                  {
                    collectionId: "pinned",
                    via: "driver",
                    step: "review",
                    text: "Collection installation incomplete",
                  },
                ]
              : [],
        };
      if (tool === "vortex_query") {
        if (args?.selector === "activeGameId") return "skyrimse";
        const route = ((args?.path ?? []) as string[]).join("/");
        if (route.endsWith("isPremium")) return true;
        if (route.endsWith("maxParallelDownloads")) return 10;
        return { pinned: mod };
      }
      if (tool === "vortex_dispatch") {
        if (args?.action === "resume-collection") {
          running = true;
          if (mode === "driver-error") throw new Error("Collection driver rejected installation");
        }
        return;
      }
      if (tool === "collection_status")
        return [
          {
            collectionModId: "pinned",
            required: 1,
            satisfied: mode === "terminal-incomplete" ? 0 : 1,
            complete: mode !== "terminal-incomplete",
            optional: 1,
            optionalSelected: 1,
            optionalIgnored: 0,
            optionalSatisfied: mode === "terminal-optional" ? 0 : 1,
          },
        ];
      throw new Error(`Unexpected tool ${tool}`);
    });
    const verifyCompletion = vi.fn(async () => {
      completed = true;
    });
    const reported: CollectionWarning[] = [];
    const outcome = installCollection(
      { call } as unknown as VortexMcpClient,
      "nxm://skyrimspecialedition/collections/wanted/revisions/2",
      {
        autoAnswer: false,
        warningsAsErrors: strict,
        onWarning: (warning) => reported.push(warning),
        optionalMods: "install",
        timeoutMs: 60_000,
        verifyCompletion: mode.startsWith("no-verifier") ? undefined : verifyCompletion,
      },
    ).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await outcome;
    const passes =
      mode === "success" ||
      mode === "foreign-session" ||
      (!strict &&
        ["notification", "message-only", "completion-error", "native-warning"].includes(mode));
    if (passes) {
      expect(result).toHaveProperty("value.complete", true);
      if ("value" in result) expect(result.value.warnings).toEqual(reported);
    } else {
      expect(result).toHaveProperty("error");
      if ("error" in result)
        expect(String(result.error)).toMatch(
          mode === "driver-error"
            ? /driver rejected/
            : mode.startsWith("no-verifier") && !strict
              ? /no final functional\/UI completion verifier/
              : /does not retry/,
        );
    }
    expect(verifyCompletion).toHaveBeenCalledTimes(
      mode.startsWith("no-verifier") ||
        mode === "driver-error" ||
        mode.startsWith("terminal-") ||
        ["required", "optional", "installer-session", "existing-failure"].includes(mode)
        ? 0
        : !strict || mode === "success" || mode === "foreign-session" || mode === "completion-error"
          ? 1
          : 0,
    );
    if (!["success", "foreign-session", "driver-error"].includes(mode))
      expect(reported.length).toBeGreaterThan(0);
    expect(call.mock.calls.filter(([, args]) => args?.action === "resume-collection")).toHaveLength(
      mode === "existing-failure" && strict ? 0 : 1,
    );
    expect(call.mock.calls.some(([tool]) => tool === "ui_click")).toBe(false);
    expect(mod.rules[0]).toEqual({ type: "requires", reference: { tag: "required" } });
  },
);
