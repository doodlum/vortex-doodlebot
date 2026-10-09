# Sign in for real collections

Local tests, generated tables, screenshots and local archives need no account. Real Nexus collections use OAuth; a personal API key alone is insufficient.

## Guided login

Run `pnpm run setup` and choose **Prepare a real collection**. Setup finds an unambiguous saved kit login or opens an isolated Vortex for you to sign in. Complete the browser flow yourself. It keeps credentials in the private local cache and passes their location to subsequent runs; you do not need to find the file or put its path in TypeScript.

Setup checks that a fresh profile can restore the saved credentials and records the account state Vortex reports. The actual collection run checks account and download access. These observations do not prove every file is available forever.

```powershell
pnpm run setup -- --status
```

The offline summary distinguishes missing, signed-out, unreadable and cached credentials. Cached presence and a dated Premium observation are not a current server-access check.

## Collection prerequisites

The current unattended real-collection benchmark runner requires Premium. Its account profile for an approved performance baseline still needs agreement; that does not make free accounts eligible for this runner. Lower-level interactive Vortex operations can have different download flows.

Prepare a clean game snapshot and enough disk space. Use a QA-only Windows account/test machine because game support can write Documents and AppData. [Setup](setup.md) keeps these steps together and saves your choices. Login, captcha, unavailable files and account restrictions remain prerequisites; they cannot be bypassed by a test.

## Lower-level login setup

For an existing integration using the app CLI:

```powershell
$env:VORTEX_AI_OWNER = 'my-tests'
pnpm run ai -- setup --installed --oauth
```

Click **Log in** in the isolated Vortex, finish the browser login, and wait for `Setup complete`. Use the same cache settings for later commands. For normal collection benchmarks, prefer guided setup so cache locations are managed for you.

Do not copy credentials into source, reports or chat. See [security and privacy](../security.md).
