# Accounts and login

You can inspect the UI, install local archives and test deployment without a Nexus account.
For live collections, sign in through Nexus OAuth. An API key cannot replace that login.

## Sign in once

```powershell
$env:VORTEX_AI_OWNER = 'operator'
$env:VORTEX_AI_INSTALLED = '1'
pnpm run ai -- setup --installed --sandbox --oauth
```

Complete the browser login yourself, including any MFA or captcha. The command waits for
credentials, saves them and verifies they survive a fresh start. Service access is a
separate check: a saved login may still be rejected by a Nexus endpoint. If you use
`--no-wait`, the command returns while login is pending. Finish later with:

```powershell
pnpm run ai -- auth-status --installed --sandbox
pnpm run ai -- save-login --installed --sandbox
```

`auth-status` prints presence booleans rather than credentials. `save-login` verifies OAuth,
stops the app cleanly and captures the baseline. Reopen with `up` afterward.

## What gets cached

The private cache contains a baseline profile, a working profile and saved OAuth. The baseline
is reusable app/game setup; the saved OAuth is maintained separately so fresh restores can
retain newer credentials. Vortex performs token refresh; Doodlebot saves observed rotations.
Logout removes the saved credentials rather than silently restoring them at the next launch.

Do not commit private caches, copy credentials into prompts or publish raw profile backups.
The normal cache directories are ignored by Git; you must protect custom paths yourself.

## Reuse a login deliberately

```powershell
pnpm run ai -- login-import --from 'C:\path\to\source-cache' --cache-dir 'C:\path\to\destination-cache' --owner operator
```

Pass a source cache directory. Existing destination credentials are preserved unless you
explicitly pass `--force`. Stop the destination app before changing its saved login.

**New slots and non-default cache directories may inherit the default cache's saved login**
when they have no OAuth cache file. A slot is not an account boundary. Subsequent refreshes
belong to each copy and can diverge. For account-free automated tests, use the supplied core
fixtures: they write a null OAuth cache before bootstrap. Do not assume a new directory is logged out.

## Live collections

Unattended Nexus downloads require the appropriate account entitlement, normally Premium,
as well as network access and cached OAuth. A collection URL selects a specific revision.
Check download dialogs and service responses when deciding whether an install completed.
Account requirements and service errors can prevent it. See [mod workflows](../guides/mod-workflows.md).

## Verify persistence separately from service access

`pnpm run ai:test:oauth` checks credential persistence with the operator's sandbox login and
leaves that instance running. `pnpm run ai:test:nexus` is the separate live-service collection
check. Neither belongs in the account-free fast gate. See [running checks](../testing/running.md).
