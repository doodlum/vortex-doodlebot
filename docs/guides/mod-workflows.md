# Install, deploy and test mods

Install a local archive, enable it and check the files Vortex deploys. This walkthrough
uses the fake game, so it needs no account and keeps deployment out of an installed game.

## Install a local archive

```powershell
$env:VORTEX_AI_OWNER = 'mod-check'
$env:VORTEX_AI_INSTALLED = '1'
pnpm run ai -- setup --installed --sandbox
pnpm run ai -- install 'C:\test-data\example.zip' --installed --sandbox
pnpm run ai -- call list_mods --installed --sandbox
```

The archive must exist. ZIP and supported local archive formats go through Vortex's actual
installation path. The harness monitors known dialogs and FOMOD navigation. If it cannot
handle an interaction or its policy refuses it, installation is reported as failed.

Read the returned mod ID and active game/profile before changing enabled state. Write
`enable.json` with IDs actually observed in this instance:

```json
{
  "modIds": ["<observed-mod-id>"],
  "enabled": true,
  "expectedActiveProfileId": "<observed-active-profile-id>"
}
```

```powershell
pnpm run ai -- call set_mods_enabled --args-file enable.json
pnpm run ai -- deploy --installed --sandbox
```

## Check real bytes

Check the sandbox game path and compare the deployed file contents with the archive payload.
This catches problems that an installed-mod listing alone cannot reveal. Repeat
with the mod disabled, then verify the file is absent. `purge` removes files recorded by
Vortex's deployment manifest; it is not a general cleanup command for unknown game files.

```powershell
pnpm run ai -- purge --installed --sandbox
pnpm run ai -- down --installed --sandbox
```

Use `deploy --purge` only when permitting replacement of a foreign deployment in an explicitly
disposable game. To automate the file-content check, follow [the integration test recipe](../testing/integration.md).

## Collections and downloads

`collection <url>` installs the selected Nexus collection revision using cached OAuth.
`e2e <collection>` orchestrates fresh start, install, verify, deploy and optional real-game
launch. `--no-launch` stops at installation/deployment; `--runs`, `--keep` and `--purge` change
repetition and cleanup. Choose the actual game and deployment target before using these
commands. Their account and real-game effects are larger than a local sandbox experiment.

```powershell
pnpm run ai -- collection '<exact-collection-revision-url>' --owner collection-check --slot auto
```

Check [login prerequisites](../getting-started/authentication.md), revision availability,
download entitlement and service responses. Use `collection_status` and
`collection_install_state` to inspect completion, including stages a mod count alone cannot reveal.

`slow-download` uses throttled local files to exercise the real download UI without Nexus.
For large offline collection workloads, use [collection-scale benchmarks](../testing/benchmarks.md).
Offline fixtures make the workload reproducible; live-service behavior needs a separate check.

## Conflicts and dependencies

Inventory and diagnostic tools can find candidate conflicts, duplicate mods, missing masters,
undeployed files or orphans. Use those findings to investigate and choose which mod should
win, which files can safely be deleted and what the load order should be. Record the evidence
and intended behavior before applying a rule or deleting files.
