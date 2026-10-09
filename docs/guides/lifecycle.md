# Manage a test app

For a script or test, use `withVortex()`. It starts a released Vortex with an isolated profile, prepares a disposable local game, and closes the app when the callback returns or throws.

```typescript title="session.mts"
import { withVortex } from "./harness/benchmarks/index";

await withVortex({}, async (vortex) => {
  await vortex.seedMods(150);
  await vortex.openPage("Mods");
  console.log(await vortex.call("list_mods"));
});
```

Run `pnpm exec tsx session.mts`. A successful run removes its disposable workspace. A failed run preserves the workspace for diagnosis and reports its path.

## Start fresh for a comparison

Each `runBenchmarks()` repeat starts a fresh session. Put your starting state in the case: generated rows, installed collection, cached archives, or deployed files. Do not depend on clicks from a previous run.

For real collection work, supply a read-only source game fixture in the manifest. The runner deploys into a private copy. Use a QA-only Windows account or test machine because game-support extensions may also write that account's Documents and LocalAppData. Confirm this with `collection.dedicatedWindowsAccount: true`; the SDK does not clean those folders. A separate profile alone would not protect a normal mod setup.

## Advanced: keep a session open

For a long interactive reproduction, the lower-level launcher can leave Vortex open between scripts. Set a consistent owner, then run `pnpm run ai -- setup --installed --sandbox`. Execute attachment scripts through `pnpm run ai -- script file.mts --installed --sandbox`, and finish with `pnpm run ai -- down --installed --sandbox`.

Those scripts import `loadConfig()` and `clientFor()` from `./harness/src/kit`. Use the same instance settings each time. `bootstrap` restores the prepared working profile and discards changes left by the previous session.

Most tests can use the wrapper without this manual setup.
