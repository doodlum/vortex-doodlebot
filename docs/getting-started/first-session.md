# Your first TypeScript test

After [installation](installation.md), save this as `first-test.mts` at the repository root:

```typescript title="first-test.mts"
import assert from "node:assert/strict";
import { withVortex } from "./harness/benchmarks/index";

await withVortex({}, async (vortex) => {
  const gameId = await vortex.call<string | null>("vortex_query", {
    selector: "activeGameId",
  });
  assert.ok(gameId, "Expected a managed test game");

  await vortex.seedMods(3);
  await vortex.openPage("Mods");
  await vortex.page.locator("#table-mods").waitFor();
  console.log("Vortex opened its Mods page for", gameId);
});
```

Run it in PowerShell:

```powershell
pnpm exec tsx first-test.mts
```

Vortex opens in a separate test profile, the test generates three local mods and checks that a game is active and the Mods table is visible, and the app closes. An assertion or Playwright failure makes the script exit unsuccessfully.

`withVortex(options, test)` manages the app's lifetime. Empty options select a released Vortex and an anonymous disposable game. An empty Mods page has no table, so this test seeds three tiny local mods before checking it. The callback receives `vortex.call()` for app operations and `vortex.page` for normal Playwright checks. `openPage("Mods")` opens the Mods page.

Use `.mts` for scripts so you can use imports and top-level `await`. Examples in these guides assume a file at the repository root; adjust relative imports if you put it elsewhere.

Next, [install a local archive and check its files](../guides/mod-workflows.md), or [run a timed benchmark](../testing/benchmarks.md). For suites of automated checks, use the [Playwright fixtures](../testing/integration.md).
