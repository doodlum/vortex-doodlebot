# Sign in for real collections

Local archives, generated mod lists, UI checks, and screenshots work without an account. Real Nexus collections need OAuth login. A personal API key alone does not authenticate collections.

## Save a login

```powershell
$env:VORTEX_AI_OWNER = 'my-tests'
pnpm run ai -- setup --installed --oauth
```

In the isolated Vortex window, click **Log in** and complete the browser login yourself. Setup waits for the login, caches it locally, and verifies that a fresh test profile can restore it. Wait for `Setup complete` before running collection tests.

You can check the result in TypeScript:

```typescript
import assert from "node:assert/strict";
import { clientFor, loadConfig } from "./harness/src/kit";

const vortex = clientFor(loadConfig());
const auth = await vortex.call<{
  oauthPresent: boolean;
  oauthRefreshable: boolean;
}>("nexus_auth_status");
assert.ok(auth.oauthPresent && auth.oauthRefreshable, "Complete OAuth setup first");
```

## Before an unattended collection run

Check that the collection revision is pinned and available, you have access to every required download, and your account supports the download flow you intend to measure. The performance proposal suggests Premium for unattended runs; the agreed account profile is still **TBD**.

You also need an appropriate game fixture and enough space for downloads, staging, and deployment. A generated local mod list cannot stand in for a real collection or engine-specific installer.

Run real game cases in a QA-only Windows account or test machine. The runner copies the game fixture and isolates the Vortex profile, but a released game's support extension may still write that account's Documents and LocalAppData. Confirm that condition with `collection.dedicatedWindowsAccount: true`. The default session leaves those per-user folders in place. `cleanStart: true` or `restartCollectionBenchmark()` backs up and resets only the supported allowlisted settings files; saves and purchased-content catalogs remain. See [clean restart](../testing/benchmarks.md#restart-a-real-collection-from-scratch).

Browser login, unavailable downloads, and account restrictions are prerequisites to resolve. If they prevent a run, record it as blocked with the reason instead of treating it as a Vortex timing result.

Keep credentials in the local cache or the gitignored `harness/.env`. Do not copy them into test source or reports. See [security and privacy](../security.md).

## Use the cache in a manifest

After setup completes, find the cached OAuth file for the installed app:

```typescript title="login-cache.mts"
import { loadConfig, resolveTarget } from "./harness/src/config";
import { authCacheFile } from "./harness/src/instance";

const config = loadConfig({ target: resolveTarget({ preferInstalled: true }) });
console.log(authCacheFile(config));
```

Run `pnpm exec tsx login-cache.mts` with the same cache settings as login setup. Put the printed path in your real collection manifest's `authCache`. This prints the file's location, not the credentials. Keep the file private.
