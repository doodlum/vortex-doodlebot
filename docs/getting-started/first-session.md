# Your first TypeScript test

This test creates three tiny local mods, searches the Mods list, and checks that clearing the search restores all three rows. It uses a disposable game and a separate Vortex profile: no installed game or Nexus account is needed.

After [installation](installation.md), save this as `first-test.mts` in the folder you cloned:

```typescript title="first-test.mts"
import { expect } from "@playwright/test";
import { withVortex } from "./harness/benchmarks/index";

await withVortex({}, async (vortex) => {
  await vortex.seedMods(3);
  await vortex.openPage("Mods");
  const search = vortex.page.locator("#table-mods .header-name input");
  const rows = vortex.page.locator("#table-mods tr[data-rowid]");
  await expect(rows).toHaveCount(3);

  await search.fill("no-matching-mod");
  await expect(rows).toHaveCount(0);

  await search.fill("");
  await expect(rows).toHaveCount(3);
});
console.log("Passed: the Mods search filters and restores three rows.");
```

```powershell
pnpm exec tsx first-test.mts
```

Vortex opens, the script checks the list, and Vortex closes. Success prints `Passed` and exits with code `0`. An assertion or cleanup failure exits unsuccessfully. Keep any reported workspace path for diagnosis. This script reports in the terminal; it does not write a benchmark report.

`withVortex` starts and closes the app. `vortex.page` is its Playwright window; `expect` waits for the visible result. Your test sets up data, operates the app, and checks what changed. `.mts` allows imports and top-level `await`; these examples assume files at the repository root.

## See a failure

Change the assertion after `search.fill("no-matching-mod")` from `toHaveCount(0)` to `toHaveCount(1)` and run again. The row count should fail. Restore `0` before continuing. This checks the actual search result, not just whether the input accepted text.

## Choose your next step

| I want to…                               | Use                                                                          |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| Reproduce one UI behavior                | A standalone script, like this one; [UI recipes](../guides/ui-automation.md) |
| Check installation and deployment        | [A local mod workflow](../guides/mod-workflows.md)                           |
| Maintain named tests with an HTML report | [Playwright fixtures](../testing/integration.md)                             |
| Compare repeated timings                 | [The benchmark runner](../testing/benchmarks.md)                             |
| Install real Nexus collections           | [Guided setup](setup.md)                                                     |

The [API reference](../reference/index.md) explains method options and results.
