# Write real-app tests

Write a real-app test for MCP transport, React input handling, archive installation,
deployment, startup/shutdown or renderer reload. These behaviors need a running Vortex app.
Exercise the interface you are testing, then check the result independently—for example,
install through MCP and read the deployed file from disk.

## Use the existing fixtures

Tests under `harness/src/tests/` import `test` and `expect` from `./fixtures`, not a separately
launched personal app. Worker-scoped fixtures supply:

| Fixture        | What it gives you                                            |
| -------------- | ------------------------------------------------------------ |
| `config`       | Isolated anonymous cache, unique debug ports and named owner |
| `mcp`          | Client for that app's Doodlebot tools                        |
| `vortexWindow` | Playwright renderer page for independent visible assertions  |
| `vortexApp`    | Electron application handle                                  |
| `managedGame`  | Fake game ID and private game path                           |

The fixtures launch Electron, install the built extension, explicitly suppress imported OAuth,
check app health at lifecycle boundaries and clean up only after exit. Use them instead of
an unowned `up` call, and read a failed fixture's logs before removing it.

## Test installation against real bytes

Save as `harness/src/tests/my-local-install.spec.ts`:

```typescript title="Runnable deployment test"
import fs from "node:fs";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { installLocalMod } from "../localMod";
import { deployMods, purgeGame } from "../deployment";
import { expect, test } from "./fixtures";

test("a local archive deploys the expected bytes and purges them", async ({
  config,
  managedGame,
  mcp,
}) => {
  const payload = "doodlebot regression fixture\n";
  const archive = path.join(config.cacheDir, "example.zip");
  fs.writeFileSync(archive, zipSync({ "textures/example.txt": strToU8(payload) }));
  expect(await mcp.call("vortex_query", { selector: "activeGameId" })).toBe(managedGame.gameId);
  const profileId = await mcp.call<string | null>("vortex_query", { selector: "activeProfileId" });
  if (!profileId) throw new Error("The fixture has no active profile.");
  const { modId } = await installLocalMod(mcp, archive);
  const deployed = path.join(managedGame.gamePath, "Data", "textures", "example.txt");
  try {
    await mcp.call("set_mods_enabled", {
      modIds: [modId],
      enabled: true,
      expectedActiveProfileId: profileId,
    });
    await deployMods(mcp, managedGame.gameId, { timeoutMs: 90_000 });
    expect(fs.readFileSync(deployed, "utf8")).toBe(payload);
    await purgeGame(mcp, { timeoutMs: 90_000 });
    expect(fs.existsSync(deployed)).toBe(false);
  } finally {
    await mcp.call("set_mods_enabled", {
      modIds: [modId],
      enabled: false,
      expectedActiveProfileId: profileId,
    });
  }
});
```

The assertion reads filesystem bytes independently of the install tool's success message.
Give each test a distinctive deployed path to avoid collisions. A cleanup failure should
fail the run, so a still-running app or dirty fixture remains visible in the results.

## Run the example

```powershell
$env:VORTEX_AI_OWNER = 'example-check'
$env:VORTEX_AI_SLOT = 'auto'
$env:VORTEX_AI_INSTALLED = '1'
pnpm run build
pnpm exec playwright test --config harness/playwright.config.ts my-local-install.spec.ts
```

The default config includes `.spec.ts` except OAuth restore, so adding this file to that
directory also adds it to the core gate. Scenarios that need a service, special game or large
workload must be explicitly opt-in to keep the core account-free.

## UI tests

Use MCP for the action, then a Playwright locator for the effect:

```typescript
await mcp.call("ui_click", { selector: '[data-testid="your-existing-control"]' });
await expect(vortexWindow.getByRole("dialog", { name: "Your actual dialog title" })).toBeVisible();
```

Those placeholder labels must be replaced with selectors observed in the affected app state.
Check disabled/hidden controls, ambiguity, keyboard focus, repeated entry and cancellation
where relevant. Restore viewport and DOM changes in `finally`. A screenshot can supplement
the assertion; it does not establish a deployed file or persisted state outcome by itself.

Include the check that fails without a fix, original failures, skips and selection limits in the report.
Run the complete applicable core after scoped checks, then [record evidence](../guides/evidence.md).
