/**
 * Does the AI automation stack actually work against a real Vortex?
 *
 * Each test drives Vortex the way an agent does — through the MCP `ui_*` tools —
 * and then verifies the result through Playwright, which has its own independent
 * view of the DOM. That separation is deliberate: asserting an MCP tool's effect
 * with the same MCP tools would pass even if both sides were wrong together.
 */

import { clickByName, findNodes, flatten, snapshot, waitForNode } from "../uiDriver";
import { expect, test } from "./fixtures";

test.describe("MCP surface", () => {
  test("exposes the UI tools, with writes unlocked", async ({ mcp }) => {
    const tools = await mcp.listTools();
    const names = tools.map((t) => t.name);

    // Reads are always registered.
    expect(names).toContain("ui_snapshot");
    expect(names).toContain("ui_detect_layout_issues");
    // Writes only exist when VORTEX_MCP_TOKEN was set at launch — if these are
    // missing, the instance came up read-only and every later test would fail
    // for that one reason.
    expect(names).toContain("ui_click");
    expect(names).toContain("ui_set_viewport");
  });
});

test.describe("snapshot", () => {
  test("describes what is actually rendered", async ({ mcp, vortexWindow }) => {
    const snap = await snapshot(mcp);

    expect(snap.nodeCount).toBeGreaterThan(0);
    expect(snap.generation).toBeGreaterThan(0);

    // Every named button in the snapshot must really be in the DOM. This is the
    // check that would have caught the aria-hidden bug, where an open modal made
    // the whole snapshot come back empty.
    const buttons = findNodes(snap, { role: "button" }).filter((b) => (b.name ?? "") !== "");
    expect(buttons.length).toBeGreaterThan(0);

    const first = buttons[0];
    await expect(
      vortexWindow.getByRole("button", { name: first?.name ?? "", exact: true }).first(),
    ).toBeAttached();
  });

  test("invalidates refs from the previous generation", async ({ mcp }) => {
    const first = await snapshot(mcp);
    const ref = flatten(first.tree)[0]?.ref;
    expect(ref).toBeDefined();

    const second = await snapshot(mcp);
    expect(second.generation).toBeGreaterThan(first.generation);
    await expect(mcp.call("ui_click", { ref })).rejects.toThrow(/stale or unknown ref/i);
  });
});

test.describe("acting on the UI", () => {
  test("a click through MCP changes what Playwright sees", async ({ mcp, vortexWindow }) => {
    // Settings is a stable, side-effect-free destination in the global spine.
    await clickByName(mcp, { role: "button", name: "Settings" });

    // Playwright, not another snapshot, confirms the navigation happened.
    await expect(vortexWindow.getByRole("heading", { name: /settings/i }).first()).toBeVisible();
  });

  test("refuses to click a disabled control instead of silently no-opping", async ({
    mcp,
    vortexWindow,
  }) => {
    await vortexWindow.evaluate(() => {
      const button = document.createElement("button");
      button.id = "automation-disabled";
      button.textContent = "Disabled fixture";
      button.disabled = true;
      button.style.cssText = "position:fixed;top:150px;left:400px;z-index:99999";
      document.body.append(button);
    });
    try {
      await expect(mcp.call("ui_click", { selector: "#automation-disabled" })).rejects.toThrow(
        /disabled/i,
      );
    } finally {
      await vortexWindow.locator("#automation-disabled").evaluate((el) => el.remove());
    }
  });
});

test.describe("viewport", () => {
  test("resizes the real window and restores it", async ({ mcp, vortexWindow }) => {
    const before = await mcp.call<{ window: { width: number; height: number } }>("ui_get_viewport");

    try {
      const result = await mcp.call<{ actual: { width: number; height: number } }>(
        "ui_set_viewport",
        { width: 1280, height: 800 },
      );
      // Fractional Windows display scaling can round a requested DIP by one pixel.
      expect(Math.abs(result.actual.width - 1280)).toBeLessThanOrEqual(2);
      expect(Math.abs(result.actual.height - 800)).toBeLessThanOrEqual(2);

      const after = await mcp.call<{ inner: { width: number } }>("ui_get_viewport");
      expect(after.inner.width).toBe(await vortexWindow.evaluate(() => window.innerWidth));
      expect(after.inner.width).toBeGreaterThan(400);
    } finally {
      await mcp.call("ui_set_viewport", before.window);
    }
    const restored = await mcp.call<{ window: { width: number; height: number } }>(
      "ui_get_viewport",
    );
    expect(Math.abs(restored.window.width - before.window.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(restored.window.height - before.window.height)).toBeLessThanOrEqual(2);
  });

  test("the extension sweep changes real dimensions and restores both axes", async ({ mcp }) => {
    const before = await mcp.call<{ window: { width: number; height: number } }>("ui_get_viewport");

    const sweep = await mcp.call<{
      restored: { width: number; height: number };
      results: {
        viewport: { width: number };
        inner: { width: number; height: number };
        issues: unknown[];
      }[];
    }>(
      "ui_responsive_sweep",
      {
        viewports: [
          { width: 1024, height: 720 },
          { width: 1600, height: 900 },
        ],
      },
      300_000,
    );

    expect(sweep.results).toHaveLength(2);
    expect(sweep.results[1]!.inner.width).toBeGreaterThan(sweep.results[0]!.inner.width);
    expect(sweep.results[1]!.inner.height).toBeGreaterThan(sweep.results[0]!.inner.height);

    const after = await mcp.call<{ window: { width: number; height: number } }>("ui_get_viewport");
    expect(Math.abs(after.window.width - before.window.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(after.window.height - before.window.height)).toBeLessThanOrEqual(2);
  });
});

test.describe("diagnostics", () => {
  test("captures renderer console output", async ({ mcp, vortexWindow }) => {
    const mark = await mcp.call<{ lastSeq: number }>("ui_read_console");
    const needle = `ai-harness-probe-${String(Date.now())}`;

    await vortexWindow.evaluate((text: string) => {
      console.warn(text);
    }, needle);

    const after = await mcp.call<{ entries: { text: string; level: string }[] }>(
      "ui_read_console",
      {
        since: mark.lastSeq,
      },
    );
    expect(after.entries.some((e) => e.text.includes(needle))).toBe(true);
  });

  test("layout scan detects a known offscreen control", async ({ mcp, vortexWindow }) => {
    await vortexWindow.evaluate(() => {
      const button = document.createElement("button");
      button.id = "layout-probe";
      button.textContent = "Offscreen layout probe";
      button.style.cssText = "position:fixed;left:-200px;top:200px;width:100px;height:40px";
      document.body.prepend(button);
    });
    try {
      const result = await mcp.call<{
        viewport: { width: number };
        issues: { kind: string; selector: string }[];
      }>("ui_detect_layout_issues", { maxIssues: 500 });

      expect(result.viewport.width).toBeGreaterThan(0);
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "offscreen", selector: "button#layout-probe" }),
        ]),
      );
    } finally {
      await vortexWindow.locator("#layout-probe").evaluate((el) => el.remove());
    }
  });
});

test.describe("game management", () => {
  test("brings the configured game up as active", async ({ mcp, managedGame }) => {
    expect(managedGame.gamePath).not.toBe("");

    const active = await mcp.call<string | null>("vortex_query", { selector: "activeGameId" });
    expect(active).toBe(managedGame.gameId);

    // And the UI agrees — the per-game workspace is what a user would see.
    await waitForNode(mcp, { name: "Mods" }, 60_000);
  });
});
