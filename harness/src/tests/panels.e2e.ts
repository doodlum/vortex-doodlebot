/** Live regression for the header-driven, right-hand split view. */
import { expect } from "@playwright/test";

import { attachToRenderer, captureScreenshot } from "../cdp";
import { loadConfig } from "../config";
import { VortexMcpClient } from "../mcpClient";
import { clickByName } from "../uiDriver";

interface Workspace {
  root: unknown;
  panels: Record<string, { id: string; pageId: string }>;
  nextId: number;
}

const onePanel = (pageId: string): Workspace => ({
  root: { kind: "panel", id: "panel-1" },
  panels: { "panel-1": { id: "panel-1", pageId } },
  nextId: 2,
});

const config = loadConfig();
const mcp = new VortexMcpClient({ port: config.mcpPort, token: config.mcpToken });
await mcp.waitUntilReady();
expect(await mcp.call("vortex_query", { selector: "activeGameId" })).toBe("fallout4");
const handle = await attachToRenderer(config);
const { page } = handle;
const click = (name: string) => clickByName(mcp, { role: "button", name });
const saved = (scope: string, pageId: string) =>
  mcp.call<Workspace | undefined>("vortex_query", {
    path: ["settings", "panels", "layouts", scope, pageId],
  });
const setWorkspace = (scope: string, pageId: string, workspace: Workspace) =>
  mcp.call("vortex_dispatch", {
    action: "type:SET_PANEL_WORKSPACE",
    args: [{ scope, layoutKey: pageId, workspace }],
  });
const removeWorkspace = (scope: string, pageId: string) =>
  mcp.call("vortex_dispatch", {
    action: "type:REMOVE_PANEL_WORKSPACE",
    args: [{ scope, layoutKey: pageId }],
  });
const selectPage = (pageId: string) =>
  mcp.call("vortex_dispatch", { action: "setOpenMainPage", args: [pageId, false] });
const panes = page.locator("[data-panel-id]");
const toggle = page.locator("[data-split-view-toggle]");
const separator = page.getByRole("separator", { name: "Resize panel columns" });
const choose = async (id: string) => {
  const choice = page.locator(`[data-panel-choice="${id}"]`);
  await expect(choice).toBeVisible();
  await choice.click();
};
const originalViewport = page.viewportSize();
let originalMods: Workspace | undefined;
let originalPlugins: Workspace | undefined;
let originalHome: Workspace | undefined;

try {
  await click("Fallout 4");
  originalMods = await saved("fallout4", "Mods");
  originalPlugins = await saved("fallout4", "gamebryo-plugins");
  await mcp.call("ui_set_viewport", { width: 1920, height: 1080 });
  await setWorkspace("fallout4", "Mods", onePanel("Mods"));
  await setWorkspace("fallout4", "gamebryo-plugins", onePanel("gamebryo-plugins"));
  await selectPage("Mods");
  await expect(panes).toHaveCount(1);
  await expect(toggle).toHaveAttribute("aria-label", "Enter split view");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("[data-panel-plain-header-actions]")).toHaveCount(0);
  const inactiveBackground = await toggle.evaluate(
    (button) => getComputedStyle(button).backgroundColor,
  );

  const opening = await page.evaluate(async () => {
    const sidebar = [...document.querySelectorAll<HTMLElement>("[class]")].find((element) =>
      element.classList.contains("transition-[width]"),
    );
    const sidebarDuration = sidebar ? getComputedStyle(sidebar).transitionDuration : "";
    document.querySelector<HTMLButtonElement>("[data-split-view-toggle]")?.click();
    const widths: number[] = [];
    let splitDuration = "";
    for (let frame = 0; frame < 20; frame++) {
      await new Promise(requestAnimationFrame);
      const second = document.querySelector<HTMLElement>("[data-panel-split-second]");
      widths.push(Math.round(second?.getBoundingClientRect().width ?? 0));
      if (second) splitDuration = getComputedStyle(second).transitionDuration;
    }
    return { widths, sidebarDuration, splitDuration };
  });
  const finalWidth = Math.max(...opening.widths);
  expect(opening.widths[0]).toBe(0);
  expect(opening.widths.some((width) => width > 0 && width < finalWidth)).toBe(true);
  expect(opening.splitDuration).toBe(opening.sidebarDuration);
  expect(finalWidth).toBeGreaterThan(650);
  await expect(panes).toHaveCount(2);
  await expect(toggle).toHaveCount(1);
  await expect(toggle).toHaveAttribute("aria-label", "Close new panel");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(await toggle.evaluate((button) => getComputedStyle(button).backgroundColor)).not.toBe(
    inactiveBackground,
  );
  await expect(page.locator("[data-panel-chooser]")).toBeVisible();
  const centers = await page.locator("[data-panel-chooser]").evaluate((chooser) => {
    const outer = chooser.getBoundingClientRect();
    const inner = chooser.firstElementChild?.getBoundingClientRect();
    if (!inner) throw new Error("Missing new-panel choices");
    return {
      x: Math.abs(outer.x + outer.width / 2 - inner.x - inner.width / 2),
      y: Math.abs(outer.y + outer.height / 2 - inner.y - inner.height / 2),
    };
  });
  expect(centers.x).toBeLessThan(2);
  expect(centers.y).toBeLessThan(2);
  expect(await page.locator("[data-panel-choice]").count()).toBeGreaterThan(0);
  await expect(page.locator("[data-panel-choice='Mods']")).toHaveCount(0);
  await expect(page.locator("[data-panel-chooser] header")).toHaveCount(0);
  await captureScreenshot(config, { label: "split-view-chooser", handle });

  for (const [width, height] of [
    [1280, 720],
    [1280, 1000],
  ]) {
    await mcp.call("ui_set_viewport", { width, height });
    await expect(page.locator("[data-panel-chooser]")).toBeVisible();
    await expect(toggle).toBeVisible();
    await captureScreenshot(config, {
      label: `split-view-${String(width)}x${String(height)}`,
      handle,
    });
  }
  await mcp.call("ui_set_viewport", { width: 1920, height: 1080 });

  await choose("gamebryo-plugins");
  await expect(page.getByRole("region", { name: "Plugins panel", exact: true })).toBeVisible();
  await expect(toggle).toHaveCount(1);
  await expect(toggle).toHaveAttribute("aria-label", "Close Plugins");
  expect(
    Object.values((await saved("fallout4", "Mods"))?.panels ?? {}).map((panel) => panel.pageId),
  ).toEqual(["Mods", "gamebryo-plugins"]);
  await click("Plugins");
  await expect(panes).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Plugins", exact: true })).toBeVisible();
  await click("Mods");
  await expect(panes).toHaveCount(2);
  await expect(toggle).toHaveAttribute("aria-label", "Close Plugins");
  await expect(page.getByRole("region", { name: "Plugins panel", exact: true })).toBeVisible();
  await expect(page.locator("[data-panel-plain-header-actions]")).toHaveCount(0);
  const closing = await page.evaluate(async () => {
    document.querySelector<HTMLButtonElement>("[data-split-view-toggle]")?.click();
    const widths: Array<number | null> = [];
    for (let frame = 0; frame < 18; frame++) {
      await new Promise(requestAnimationFrame);
      const second = document.querySelector<HTMLElement>("[data-panel-split-second]");
      widths.push(second ? Math.round(second.getBoundingClientRect().width) : null);
    }
    return widths;
  });
  expect(closing.some((width) => width !== null && width > 0 && width < finalWidth)).toBe(true);
  expect(closing).toContain(null);
  await expect(panes).toHaveCount(1);
  await expect(toggle).toHaveAttribute("aria-label", "Enter split view");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  await toggle.click();
  await expect(page.locator("[data-panel-chooser]")).toBeVisible();
  await choose("tools_page");
  await expect(page.getByRole("region", { name: "Tools panel", exact: true })).toBeVisible();
  await expect(toggle).toHaveCount(1);
  await expect(page.locator("[data-panel-split-second] [data-split-view-toggle]")).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-label", "Close Tools");
  await toggle.click();
  await expect(panes).toHaveCount(1);
  await toggle.click();
  await expect(page.locator("[data-panel-chooser]")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator("[data-panel-split-second]")
        .evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBeGreaterThan(650);
  expect(
    Object.values((await saved("fallout4", "Mods"))?.panels ?? {}).map((panel) => panel.pageId),
  ).toEqual(["Mods", ""]);
  await choose("gamebryo-plugins");
  await expect(page.getByRole("region", { name: "Plugins panel", exact: true })).toBeVisible();
  await separator.focus();
  await separator.press("ArrowLeft");
  await expect(separator).toHaveAttribute("aria-valuenow", "45");
  await separator.dblclick();
  await expect(separator).toHaveAttribute("aria-valuenow", "50");
  await mcp.call("ui_set_viewport", { width: 1536, height: 960 });
  for (let press = 0; press < 10; press++) await separator.press("ArrowRight");
  const paneWidths = await page.locator("[data-panel-split]").evaluate((split) => ({
    first: split.querySelector<HTMLElement>("[data-panel-split-first]")?.getBoundingClientRect()
      .width,
    second: split.querySelector<HTMLElement>("[data-panel-split-second]")?.getBoundingClientRect()
      .width,
  }));
  expect(paneWidths.first).toBeGreaterThanOrEqual(439);
  expect(paneWidths.second).toBeGreaterThanOrEqual(439);
  expect(Number(await separator.getAttribute("aria-valuenow"))).toBeLessThan(80);
  const pluginHeader = await page
    .locator("[data-panel-split-second] .mainpage-header")
    .evaluate((header) => {
      header.scrollLeft = header.scrollWidth;
      const scrollLeft = header.scrollLeft;
      header.scrollLeft = 0;
      return {
        overflowX: getComputedStyle(header).overflowX,
        scrollLeft,
        clientWidth: header.clientWidth,
        scrollWidth: header.scrollWidth,
      };
    });
  expect(pluginHeader.overflowX).toBe("auto");
  expect(pluginHeader.scrollWidth).toBeGreaterThan(pluginHeader.clientWidth);
  expect(pluginHeader.scrollLeft).toBeGreaterThan(0);
  const currentSplit = await saved("fallout4", "Mods");
  if (!currentSplit) throw new Error("Missing saved Mods split");
  await setWorkspace("fallout4", "Mods", {
    ...currentSplit,
    root: { ...(currentSplit.root as object), ratio: 80 },
  });
  await expect
    .poll(
      async () =>
        ((await saved("fallout4", "Mods"))?.root as { ratio: number } | undefined)?.ratio ?? 100,
    )
    .toBeLessThan(80);
  await expect
    .poll(() =>
      page
        .locator("[data-panel-split-second]")
        .evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBeGreaterThanOrEqual(439);
  await captureScreenshot(config, { label: "split-view-plugins-min-width", handle });
  await mcp.call("ui_set_viewport", { width: 1920, height: 1080 });
  await separator.dblclick();
  await expect(separator).toHaveAttribute("aria-valuenow", "50");
  const divider = await separator.boundingBox();
  const split = await page.locator("[data-panel-split]").boundingBox();
  if (!divider || !split) throw new Error("Cannot measure split divider");
  await separator.hover();
  await page.mouse.down();
  await page.mouse.move(split.x + split.width - 1, divider.y + divider.height / 2, {
    steps: 6,
  });
  await page.mouse.up();
  await expect(panes).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Mods", exact: true })).toBeVisible();

  await toggle.click();
  await choose("gamebryo-plugins");
  await expect
    .poll(() =>
      page
        .locator("[data-panel-split-second]")
        .evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBeGreaterThan(650);
  const otherDivider = await separator.boundingBox();
  const otherSplit = await page.locator("[data-panel-split]").boundingBox();
  if (!otherDivider || !otherSplit) throw new Error("Cannot measure the reopened divider");
  await separator.hover();
  await page.mouse.down();
  await page.mouse.move(otherSplit.x + 1, otherDivider.y + otherDivider.height / 2, {
    steps: 6,
  });
  await page.mouse.up();
  await expect(panes).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Plugins", exact: true })).toBeVisible();
  await click("Mods");
  await expect(toggle).toHaveAttribute("aria-label", "Enter split view");

  // A narrow content area closes the partner with the same width transition.
  await setWorkspace("fallout4", "Mods", onePanel("Mods"));
  await selectPage("Mods");
  await mcp.call("ui_set_viewport", { width: 960, height: 720 });
  await expect(toggle).toHaveCount(0);
  await mcp.call("ui_set_viewport", { width: 1920, height: 1080 });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await choose("tools_page");
  await expect
    .poll(() =>
      page
        .locator("[data-panel-split-second]")
        .evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBeGreaterThan(650);
  const resizingFrames = page.evaluate(async () => {
    const widths: Array<number | null> = [];
    const toggleOpacities: Array<number | null> = [];
    for (let frame = 0; frame < 35; frame++) {
      await new Promise(requestAnimationFrame);
      const second = document.querySelector<HTMLElement>("[data-panel-split-second]");
      const button = document.querySelector<HTMLElement>("[data-responsive-split-button]");
      widths.push(second ? Math.round(second.getBoundingClientRect().width) : null);
      toggleOpacities.push(button ? Number(getComputedStyle(button).opacity) : null);
    }
    return { widths, toggleOpacities };
  });
  await mcp.call("ui_set_viewport", { width: 960, height: 720 });
  const { widths, toggleOpacities } = await resizingFrames;
  expect(widths.some((width) => width !== null && width > 0 && width < finalWidth)).toBe(true);
  expect(toggleOpacities.some((opacity) => opacity !== null && opacity > 0 && opacity < 1)).toBe(
    true,
  );
  await expect(panes).toHaveCount(1);
  await expect(toggle).toHaveCount(0);
  expect((await saved("fallout4", "Mods"))?.root).toMatchObject({ kind: "panel" });
  await captureScreenshot(config, { label: "split-view-too-narrow", handle });
  const appearingFrames = page.evaluate(async () => {
    const opacities: Array<number | null> = [];
    for (let frame = 0; frame < 35; frame++) {
      await new Promise(requestAnimationFrame);
      const button = document.querySelector<HTMLElement>("[data-responsive-split-button]");
      opacities.push(button ? Number(getComputedStyle(button).opacity) : null);
    }
    return opacities;
  });
  await mcp.call("ui_set_viewport", { width: 1920, height: 1080 });
  expect(
    (await appearingFrames).some((opacity) => opacity !== null && opacity > 0 && opacity < 1),
  ).toBe(true);
  await expect(toggle).toHaveAttribute("aria-label", "Enter split view");
  await expect(panes).toHaveCount(1);

  await click("Home");
  originalHome = await saved("__home", "application_settings");
  // Home's Settings page has the modern header control; Dashboard is legacy.
  await setWorkspace("__home", "application_settings", onePanel("application_settings"));
  await selectPage("application_settings");
  await expect(toggle).toHaveAttribute("aria-label", "Enter split view");
  await toggle.click();
  await expect(page.locator("[data-panel-chooser]")).toBeVisible();
  const homeChoices = await page
    .locator("[data-panel-choice]")
    .evaluateAll((items) => items.map((item) => item.getAttribute("data-panel-choice")));
  expect(homeChoices).toContain("Games");
  expect(homeChoices).toContain("Extensions");
  expect(homeChoices).not.toContain("Mods");
  await choose("Games");
  await expect(page.getByRole("region", { name: "Games panel", exact: true })).toBeVisible();
  await expect(toggle).toHaveCount(1);
  await expect(toggle).toHaveAttribute("aria-label", "Close Games");
  await captureScreenshot(config, { label: "split-view-home", handle });
  console.log(
    "Per-sidebar persistence, split animation, narrow close, chooser, labels, and Home scope passed.",
  );
} finally {
  if (originalHome) await setWorkspace("__home", "application_settings", originalHome);
  else await removeWorkspace("__home", "application_settings");
  await click("Fallout 4");
  if (originalPlugins) await setWorkspace("fallout4", "gamebryo-plugins", originalPlugins);
  else await removeWorkspace("fallout4", "gamebryo-plugins");
  if (originalMods) await setWorkspace("fallout4", "Mods", originalMods);
  else await removeWorkspace("fallout4", "Mods");
  await selectPage("Mods");
  if (originalViewport) await mcp.call("ui_set_viewport", originalViewport);
  await handle.close();
}
