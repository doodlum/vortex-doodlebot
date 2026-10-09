# Get started

This walkthrough installs Doodlebot and runs a test that searches three local mods. It needs no Nexus account, commercial game or LLM.

## Install

You need Windows, a released Vortex installation, Git, Node.js **20.19 or newer**, and **pnpm 9.15.0**. Run UI tests on a visible desktop.

In PowerShell:

```powershell
git clone https://github.com/doodlum/vortex-doodlebot.git
cd vortex-doodlebot
pnpm install
pnpm run setup
```

Choose **Local test**. Setup creates `my-first-test.mts` in the repository root. It leaves an existing file untouched.

## Run your test

```powershell
pnpm exec tsx my-first-test.mts
```

Vortex opens with a disposable game and separate profile, the script checks the Mods search, and Vortex closes. Success prints `Passed: the Mods search filters and restores three rows.` and exits with code `0`. An assertion or cleanup failure exits unsuccessfully; keep any reported workspace path for diagnosis. This test reports in the terminal rather than writing a benchmark report.

## Edit the test

Open `my-first-test.mts`. The generated code is:

```typescript title="my-first-test.mts"
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

`withVortex()` manages the app. Inside its callback, set up data, perform an action and check the result. `vortex.page` is the Playwright window; `expect` waits for the visible result. Keep these `.mts` examples at the repository root so their imports resolve.

To see a failure, change the assertion after the missing-mod search from `toHaveCount(0)` to `toHaveCount(1)` and run again. Restore `0` afterward.

Next, adapt the test using [UI actions](../guides/ui-automation.md) or [mod installation and deployment](../guides/mod-workflows.md). For repeated measurements and a saved report, [write a benchmark](../testing/adding-benchmarks.md). The [reference](../reference/index.md) explains the available methods.

If Vortex cannot be found or a run fails, see [troubleshooting](../troubleshooting.md).
