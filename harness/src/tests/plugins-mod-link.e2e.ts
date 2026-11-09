/**
 * Opt-in check of the Plugins page's Mod column link against the fake Fallout 4:
 * pnpm run ai:test:plugins-mod-link (instance started with
 * `up --dev-dir <checkout> --bethesda-sandbox`).
 *
 * Clicking a plugin's mod name opens the Mods page scrolled to that mod, with it
 * highlighted. That is how users find which mod a plugin came from. On 2.7 the page opened at
 * the top instead: the mods table moved to a sticky header, whose rows the page scrolls, and
 * the table went on scrolling its own pane, which moves nothing.
 *
 * This seeds mods with one plugin each, filters the plugin list to the one whose mod sorts
 * last, clicks its mod name like a user and checks that mod's row ends up on screen, then
 * does the same for the first mod, which the page has to scroll back up to.
 *
 *   --mods <n>   mods with one plugin each (default 300)
 */
import path from "node:path";

import { attachToRenderer } from "../cdp";
import { bethesdaSandboxPaths, pluginBytes } from "../bethesdaSandbox";
import { loadConfig } from "../config";
import { deployMods } from "../deployment";
import { fillFilterScript, seedLibrary } from "../largeLibrary";
import { VortexMcpClient } from "../mcpClient";

const flag = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};
const count = Number(flag("mods") ?? 300);
const PLUGINS = "gamebryo-plugins";
const MODS = "mods";

const config = loadConfig();
const mcp = new VortexMcpClient({ port: config.mcpPort, token: config.mcpToken });
await mcp.waitUntilReady();
const status = await mcp.call<{ paths?: { documents: string | null } }>("automation_status");
if (
  (await mcp.call<string | null>("vortex_query", { selector: "activeGameId" })) !== "fallout4" ||
  path.resolve(status.paths?.documents ?? "").toLowerCase() !==
    path.resolve(bethesdaSandboxPaths(config.cacheDir).documents).toLowerCase()
) {
  throw new Error(
    "This check needs the fake Fallout 4: `doodlebot up --dev-dir <checkout> --bethesda-sandbox`.",
  );
}

const { modIds } = await seedLibrary(mcp, {
  count,
  filesPerMod: 1,
  plugin: (modId) => ({
    name: `${modId}.esp`,
    bytes: pluginBytes({ name: `${modId}.esp`, masters: ["Fallout4.esm"] }),
  }),
});
await deployMods(mcp, "fallout4", { timeoutMs: 30 * 60 * 1000 });

// The mods are named "Library Mod 00000" upwards: sorted ascending, the last one is far
// below the fold. Following its link and then the first one's checks both directions; the
// second must not leave the row under the sticky header.
const targets = [modIds[modIds.length - 1], modIds[0]].filter(
  (id): id is string => id !== undefined,
);
await mcp.call("vortex_dispatch", { action: "setAttributeSort", args: [MODS, "name", "asc"] });
// the Mod column, which holds the link, is hidden by default
await mcp.call("vortex_dispatch", {
  action: "setAttributeVisible",
  args: [PLUGINS, "modName", true],
});

const handle = await attachToRenderer(config);
const { page } = handle;
const failures: string[] = [];
// The classic layout's Mods table has no sticky header and never had this bug.
const modern = await mcp.call<boolean>("vortex_query", {
  path: ["settings", "window", "useModernLayout"],
});
const result: Record<string, unknown> = {
  mods: count,
  layout: modern === false ? "classic" : "modern",
  placements: {},
};

/** Click the Plugins page's link to `target`, then report where the mod's row is. */
async function followLink(target: string) {
  await mcp.call("vortex_dispatch", {
    action: "setOpenMainPage",
    args: ["gamebryo-plugins", false],
  });
  await page.waitForSelector(`#table-${PLUGINS} tr[data-rowid]`, { timeout: 120_000 });
  await page.evaluate(fillFilterScript(PLUGINS, `${target}.esp`));
  const link = page.locator(`#table-${PLUGINS} a[data-modid="${target}"]`);
  await link.waitFor({ state: "visible", timeout: 30_000 });
  // Pages mount on their first visit, so straight after a start the link has to open a
  // Mods page that doesn't exist yet.
  const modsMounted = (await page.locator(`#table-${MODS}`).count()) > 0;
  await link.click();

  // The link waits 200ms for the page to change, and the table retries a row it can't
  // find yet after 2s: give it both.
  const row = `#table-${MODS} tr[data-rowid="${target}"]`;
  await page.waitForSelector(row, { state: "attached", timeout: 30_000 });
  await page.waitForTimeout(3_000);

  const placement = await page.evaluate(
    ({ selector, table }) => {
      const element = document.querySelector(selector);
      if (element === null) return null;
      const box = element.getBoundingClientRect();
      const header = document.querySelector(`#table-${table} .table-main-pane .xthead`);
      return {
        top: Math.round(box.top),
        bottom: Math.round(box.bottom),
        // what is on screen: below the sticky header, above the window's bottom
        // (the classic layout's pane scrolls its own header out of the window)
        visibleTop: Math.max(0, Math.round(header?.getBoundingClientRect().bottom ?? 0)),
        visibleBottom: window.innerHeight,
      };
    },
    { selector: row, table: MODS },
  );
  (result.placements as Record<string, unknown>)[target] = { modsMounted, ...placement };
  if (placement === null) {
    failures.push(`the Mods page has no row for ${target}`);
  } else if (placement.top < placement.visibleTop || placement.bottom > placement.visibleBottom) {
    failures.push(
      `the Mods page did not scroll to ${target}: its row is at ${String(placement.top)}-` +
        `${String(placement.bottom)}px, outside ${String(placement.visibleTop)}-` +
        `${String(placement.visibleBottom)}px`,
    );
  }
}

try {
  // Cleared in state rather than on the page, which would mount the Mods page early.
  await mcp.call("vortex_dispatch", {
    action: "setAttributeFilter",
    args: [MODS, "name", undefined],
  });
  for (const target of targets) await followLink(target);
} finally {
  // the Plugins page is no longer mounted, so clear its filter in state
  await mcp
    .call("vortex_dispatch", { action: "setAttributeFilter", args: [PLUGINS, "name", undefined] })
    .catch(() => undefined);
  await handle.close();
}

console.log(JSON.stringify(result, null, 2));
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log("PASS: the plugins' mod links scrolled the Mods page to each mod.");
