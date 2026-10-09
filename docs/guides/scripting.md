# Write a TypeScript script

Save small scripts as `.mts` files at the repository root. Import `withVortex` from `./harness/benchmarks/index` and run the file with `pnpm exec tsx file.mts`.

```typescript title="inspect-game.mts"
import { withVortex } from "./harness/benchmarks/index";

await withVortex({}, async (vortex) => {
  console.log(await vortex.call("vortex_query", { selector: "activeGameId" }));
});
```

The callback receives a live app connection, a Playwright page, and helpers for fixtures and measurements. When it returns or throws, the wrapper closes Vortex. A failed run preserves its disposable fixture for diagnosis; a successful run removes it.

Use `node:assert/strict` or Playwright's `expect` for checks that must fail the run. Keep changing inputs in a separate TypeScript configuration file. [Benchmarks](../testing/adding-benchmarks.md) add repeats and reports to this pattern.

## Advanced: attach to an existing app

For a long interactive reproduction, you can [keep a session open](lifecycle.md) and use the lower-level `kit` helpers. Save the script as `.mts` and run it through `pnpm run ai -- script file.mts` with the same instance options as setup.

`loadConfig()` and `clientFor(config)` then connect to that existing app. Scripts outside the repository can dynamically import `process.env.VORTEX_AI_KIT`, which the runner sets to the helper module URL.

Most tests can use `withVortex()` without this connection setup. The [helper reference](../reference/script-api.md) is available when you need lower-level control.
