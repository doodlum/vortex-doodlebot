# Configuration

This page lists the settings that change how doodlebot runs: flags, environment variables, and
the files it keeps. You rarely need them; the commands choose sensible defaults, and you can ask
the agent for a setting in plain words, such as "use the released Vortex" or "use port 3801".

## Where settings come from

The agent passes flags to `doodlebot` commands. Environment variables apply to every command in
the agent's session. The workspace file `<workspace>/harness/.env`, when present, supplies
private local values and is ignored by Git. An empty value counts as unset.

Use the same target, game, cache and port settings for every command on one profile.

## Paths

- Path flags such as `--dev-dir`, `--exe`, `--game-path`, `--cache-dir` and `--out` are resolved
  against the folder the command is run from, so a relative path works from any folder.
- Relative paths in environment variables, and the defaults below, are resolved against the
  workspace.
- Arguments after `doodlebot test <suite>` are passed to the suite unchanged and resolved
  against the workspace.

## Target selection

An explicit `--dev-dir` chooses that source checkout. Otherwise `--installed` or
`VORTEX_AI_INSTALLED=1` selects released Vortex, and `--exe` or `VORTEX_AI_EXE` names its
executable. Without those choices, a configured source directory or the managed
`<workspace>/.vortex-src` can take precedence over an installed Vortex, so name the target
explicitly for checks you want to repeat.

A `--dev-dir` that is not a built Vortex checkout fails with
`--dev-dir <path> is not a built Vortex checkout: <reason>`. `doodlebot doctor` reports the
same error as a failing `Vortex` check.

`doodlebot doctor` reports the baseline for the flags you give it. With `--no-game` its
`Profile cache` and `Sandbox baseline` lines describe the no-game baseline, which is separate
from the sandbox one.

## Defaults

| Setting         | Default                          | Override                               |
| --------------- | -------------------------------- | -------------------------------------- |
| Profile cache   | `<workspace>/harness/.cache`     | `--cache-dir` or `VORTEX_AI_CACHE_DIR` |
| Reports         | `<workspace>/harness/.artifacts` | `VORTEX_AI_ARTIFACT_DIR`               |
| MCP port        | 3701                             | `--port` or `VORTEX_MCP_PORT`          |
| CDP port        | 9222                             | `--cdp-port` or `VORTEX_AI_CDP_PORT`   |
| Instance record | `~/.doodlebot/instance.json`     | None                                   |

Change a cache or port only when the default conflicts with something on your machine. Whatever
cache you choose, the running test Vortex is recorded in `~/.doodlebot/instance.json`; see
[One test Vortex at a time](../concepts/one-test-vortex.md).

## Environment variables

| Variable                                    | Purpose and default                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------- |
| `VORTEX_AI_INSTALLED`                       | Prefer installed Vortex when true                                                     |
| `VORTEX_AI_EXE`                             | Explicit released executable                                                          |
| `VORTEX_AI_DEV_DIR`                         | Explicit source checkout                                                              |
| `VORTEX_AI_SOURCE_DIR`                      | Managed source location; default `.vortex-src` in the workspace                       |
| `VORTEX_AI_GITHUB_USER`                     | GitHub user whose Vortex fork `doodlebot source` clones                               |
| `VORTEX_AI_VORTEX_REPO`                     | Explicit source repository as `owner/name`                                            |
| `VORTEX_AI_PNPM`                            | A pnpm of the Vortex checkout's pinned version, used instead of `pnpm dlx`            |
| `VORTEX_MCP_TOKEN`                          | Bearer token for the MCP server; doodlebot creates a private one if unset             |
| `VORTEX_MCP_PORT`                           | MCP port; default 3701                                                                |
| `VORTEX_AI_CDP_PORT`                        | CDP port; default 9222                                                                |
| `VORTEX_AI_GAME_ID`                         | Game ID; default `fallout4`; `--sandbox` chooses the sandbox game                     |
| `VORTEX_AI_GAME_PATH`                       | Explicit game folder                                                                  |
| `VORTEX_AI_CACHE_DIR`                       | Profile, baseline and login cache; default `harness/.cache` in the workspace          |
| `VORTEX_AI_ARTIFACT_DIR`                    | Screenshots, reports and other outputs; default `harness/.artifacts` in the workspace |
| `VORTEX_AI_HEADLESS`                        | Hide the window; off by default. Screenshots may be blank                             |
| `VORTEX_AI_PRODUCTION`                      | Require production mode for a source build                                            |
| `VORTEX_AI_NEXUS_API_KEY` / `NEXUS_API_KEY` | Optional legacy API key; not a login for collections                                  |
| `VORTEX_AI_KIT`                             | Set by `doodlebot script` for the script it runs                                      |
| `DOODLEBOT_DOCS_PYTHON`                     | Python executable for building this documentation                                     |
| `DOODLEBOT_DOCS_BASE`                       | Git base revision for the documentation pairing check                                 |

Both ports must be distinct integers between 1 and 65535.

## Common flags

| Flag                                                   | Effect                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| `--installed`, `--exe <path>`, `--dev-dir <path>`      | Choose the Vortex to run                                                  |
| `--cache-dir`, `--port`, `--cdp-port`                  | Choose the profile cache and ports                                        |
| `--sandbox`                                            | The disposable sandbox game                                               |
| `--bethesda-sandbox`                                   | A fake Fallout 4 with private per-user folders; source builds only        |
| `--isolate-user-folders`                               | Private per-user game folders for any game; source builds only            |
| `--game <id>`, `--game-path <dir>`, `--no-game`        | Manage a chosen game, or open only the global UI                          |
| `--with-api-key`                                       | Seed the legacy API key in a sandbox; normally withheld                   |
| `--headless`, `--production`                           | Hide the window; require production mode for a source build               |
| `--fresh`, `--rebuild-snapshot`, `--rebuild-extension` | Reset the working profile, rebuild the baseline, or rebuild the extension |

Flags vary by command. The [doodlebot CLI](cli.md) reference lists the commands.

## Files doodlebot keeps

| Path                             | Contents                                                  |
| -------------------------------- | --------------------------------------------------------- |
| `~/.doodlebot/instance.json`     | The record of the running test Vortex                     |
| `<workspace>/harness/.cache`     | Test profiles, baselines and saved logins                 |
| `<workspace>/harness/.artifacts` | Run reports, benchmark reports, designs and other outputs |
| `<workspace>/harness/.env`       | Optional private local configuration                      |
| `<workspace>/dist/`              | The built doodlebot extension                             |
| `<workspace>/.vortex-src/`       | The managed Vortex source clone                           |

Git ignores these paths in the workspace, but logs, screenshots and reports still need a privacy
check before you share them. See [Security and privacy](../security.md).

## What's next

- [Troubleshooting](../troubleshooting.md).
- [doodlebot CLI](cli.md).
