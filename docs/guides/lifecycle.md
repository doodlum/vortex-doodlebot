# Manage app sessions

Continue an investigation with `up`, or repeat it from a known baseline with `up --fresh`.
Each instance has a target, owner, cache, game and debug ports; keep those consistent from
setup through shutdown. `--slot auto` selects a stable slot for your owner.

## Understand the three kinds of start

| Start                  | What happens                                                                      | Use it for                                                 |
| ---------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Cold baseline creation | Provision the profile, game and extension, then capture a reusable baseline       | First setup, changed game setup or rebuilding the baseline |
| Warm `up`              | Reuse a matching working profile and its current app state                        | Continue the same investigation                            |
| Fresh `up --fresh`     | Restore the working profile from its baseline while retaining current saved OAuth | Repeat a workflow from a known app baseline                |

Saved OAuth survives a fresh start because baseline restore and login persistence are separate.
`--rebuild-snapshot` rebuilds the baseline, while `--rebuild-extension` forces an extension
build. Those are different from simply reopening an existing working profile.

```powershell
pnpm run ai -- up --installed --sandbox --owner operator
pnpm run ai -- down --installed --sandbox --owner operator
pnpm run ai -- up --installed --sandbox --owner operator --fresh
pnpm run ai -- down --installed --sandbox --owner operator
```

## A global UI session

Use `--no-game` when inspecting global settings rather than a managed game:

```powershell
pnpm run ai -- up --installed --no-game --owner settings-check
pnpm run ai -- snapshot --installed --no-game --owner settings-check
pnpm run ai -- down --installed --no-game --owner settings-check
```

## Targets and fixtures

- `--installed` selects released Vortex even if a managed source checkout exists.
- `--exe` selects a specific executable; `--dev-dir` and `--worktree` select source targets.
- `--sandbox` uses the disposable fake game for local install/deploy workflows.
- `--bethesda-sandbox` supplies a fake Fallout 4 fixture with private user folders.
- `--game` and `--game-path` select an actual game; use a disposable copy for mutation tests.

Bethesda sandbox and `--isolate-user-folders` need a source build: packaged Vortex ignores
the preload responsible for folder redirection. The harness refuses that combination to
protect your real Documents and LocalAppData folders.

## Confirm cleanup

`down` asks the owned app to quit and waits for exit. On failure, inspect the recorded PID,
ownership and logs, including any child processes still running. Wait for confirmed exit
before removing its profile, releasing ownership or overwriting source build output.
Keep the original failure and evidence before retrying.

See [parallel sessions](parallel-sessions.md) for leases and [configuration](../reference/configuration.md)
for environment values and paths.
