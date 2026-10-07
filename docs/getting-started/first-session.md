# Your first session

This walkthrough opens released Vortex with a disposable fake game, reads its state and
saves a screenshot. It needs no installed game or Nexus account.

## Open the sandbox

Run from the Doodlebot repository root in PowerShell:

```powershell
$env:VORTEX_AI_OWNER = 'operator'
$env:VORTEX_AI_INSTALLED = '1'
pnpm run ai -- doctor --installed --sandbox
pnpm run ai -- setup --installed --sandbox
```

Setup creates a reusable baseline profile, installs the Doodlebot extension in it and
opens Vortex with the fake `vortexaisandbox` game. Setup prints the MCP endpoint; `up` also
prints connection instructions containing the bearer token. Keep that token private.
The default ports are MCP 3701 and CDP 9222; slots use other ports.

The first launch can take several minutes while the harness prepares the profile and
activates the game. Once the MCP endpoint responds, you can inspect the app. If a fatal
dialog appears, keep the logs and use [troubleshooting](../troubleshooting.md), even if the
endpoint responds: the dialog may reveal a startup failure elsewhere in Vortex.

## Inspect the app

```powershell
pnpm run ai -- status --installed --sandbox
pnpm run ai -- tools --json --installed --sandbox
pnpm run ai -- snapshot --installed --sandbox
pnpm run ai -- call list_profiles --installed --sandbox
pnpm run ai -- screenshot --label first-session --installed --sandbox
```

`tools` lists the tools and input schemas available in this running app. `snapshot`
returns visible UI nodes with references, roles, labels and values. `list_profiles` returns
structured profile information. `screenshot` prints the saved image path.

If you want to click an element, first inspect the current snapshot and use its real ref:

```powershell
pnpm run ai -- click --ref '<ref-from-the-current-snapshot>' --installed --sandbox
pnpm run ai -- snapshot --installed --sandbox
```

Replace the placeholder with a reference from your snapshot. References can expire after a
new snapshot or renderer reload. See [UI automation](../guides/ui-automation.md) for more
about keeping each inspection and action together.

## Stop and reopen

```powershell
pnpm run ai -- down --installed --sandbox
pnpm run ai -- up --installed --sandbox
pnpm run ai -- down --installed --sandbox
```

`down` waits for confirmed app exit. `up` reuses the working profile when it still matches.
Keep the same owner, target, game and slot/cache across commands. Wait for confirmed app exit
before deleting a profile or releasing ownership, so a running process cannot keep writing to it.

## Decide what to do next

- [Install a local test mod](../guides/mod-workflows.md) and inspect its deployed bytes.
- [Write a real-app test](../testing/integration.md) to make the workflow repeatable.
- [Connect an assistant](../llms/connecting.md) to explore or debug the app with you.
- [Run a benchmark](../testing/benchmarks.md) with a reproducible workload.

A disposable profile isolates app data. It does not by itself guarantee an anonymous account:
a new slot or non-default cache may copy an existing saved login. The core test fixtures
explicitly prevent that. Read [accounts and login](authentication.md) when account isolation matters.
