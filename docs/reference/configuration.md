# Configuration reference

Run commands from the repository root. You can configure them with flags and environment
variables; without either, the defaults below apply. `harness/.env` supplies private local
values when present and is ignored by Git. The loader's explicit environment-value helper
treats empty values as unset, so use a valid setting rather than an empty string when you
need an override.

## Target selection

An explicit source `--dev-dir` chooses that checkout. Otherwise `--installed` or
`VORTEX_AI_INSTALLED=1` selects released Vortex. An explicit executable bypasses managed-source
discovery. Without those choices, a configured developer directory or managed `.vortex-src`
can take precedence over an installed app. Select the runtime explicitly when checking compatibility.

## Defaults

Doodlebot runs one Vortex at a time. Without overrides it uses:

| Setting       | Default              | Override                               |
| ------------- | -------------------- | -------------------------------------- |
| Profile cache | `harness/.cache`     | `--cache-dir` or `VORTEX_AI_CACHE_DIR` |
| Task outputs  | `harness/.artifacts` | `VORTEX_AI_ARTIFACT_DIR`               |
| MCP port      | 3701                 | `--port` or `VORTEX_MCP_PORT`          |
| CDP port      | 9222                 | `--cdp-port` or `VORTEX_AI_CDP_PORT`   |

Change these only when a default conflicts with something on your machine, and then use the
same values for every command on that session. Whatever cache you choose, the running instance
is recorded in `harness/.cache/instance.json`, so every command can tell whether a Doodlebot
Vortex is already running. See [troubleshooting](../troubleshooting.md#a-harness-vortex-is-running)
if a command refuses because one is.

## Environment settings

| Setting                                     | Purpose and default                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `VORTEX_AI_INSTALLED`                       | Prefer installed Vortex when true                                                       |
| `VORTEX_AI_EXE`                             | Explicit released executable path                                                       |
| `VORTEX_AI_DEV_DIR`                         | Explicit source target                                                                  |
| `VORTEX_AI_SOURCE_DIR`                      | Managed source location; default `.vortex-src`                                          |
| `VORTEX_AI_GITHUB_USER`                     | GitHub identity used by source fork discovery                                           |
| `VORTEX_AI_VORTEX_REPO`                     | Explicit source repository as `owner/name`                                              |
| `VORTEX_AI_PNPM`                            | Override for Vortex's own pinned pnpm; does not change the kit's pin                    |
| `VORTEX_MCP_TOKEN`                          | Bearer token; the harness creates a persisted private default if unset                  |
| `VORTEX_MCP_PORT`                           | MCP port; default 3701                                                                  |
| `VORTEX_AI_CDP_PORT`                        | CDP port; default 9222                                                                  |
| `VORTEX_AI_GAME_ID`                         | Game ID before fixture selection; default `fallout4`; `--sandbox` chooses the fake game |
| `VORTEX_AI_GAME_PATH`                       | Explicit game install path                                                              |
| `VORTEX_AI_CACHE_DIR`                       | Profile/baseline/OAuth cache; default `harness/.cache`                                  |
| `VORTEX_AI_ARTIFACT_DIR`                    | Screenshots, reports and other task outputs; default `harness/.artifacts`               |
| `VORTEX_AI_HEADLESS`                        | Hide the window; off by default                                                         |
| `VORTEX_AI_PRODUCTION`                      | Require production mode for a source runtime                                            |
| `VORTEX_AI_NEXUS_API_KEY` / `NEXUS_API_KEY` | Optional legacy API key; not OAuth for collections                                      |
| `DOODLEBOT_DOCS_PYTHON`                     | Python executable for documentation build/serve only                                    |
| `DOODLEBOT_DOCS_BASE`                       | Git base revision for paired-documentation checks in CI/review                          |

Both debug ports must be distinct integers between 1 and 65535. Flags override their
configured values for that command; keep overrides consistent for every command on the session.

## Important flags

| Flag                                                   | Effect                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| `--installed`, `--exe`, `--dev-dir`                    | Choose the runtime                                                        |
| `--cache-dir`, `--port`, `--cdp-port`                  | Choose the profile cache and endpoints                                    |
| `--sandbox`                                            | Disposable local-install/deployment game                                  |
| `--bethesda-sandbox`                                   | Fake Bethesda game with private per-user folders; requires source runtime |
| `--isolate-user-folders`                               | Source-only per-game folder redirection                                   |
| `--game`, `--game-path`, `--no-game`                   | Manage a chosen game or open only global UI                               |
| `--with-api-key`                                       | Deliberately seed the legacy key in a sandbox; normally withheld          |
| `--headless`, `--production`                           | Window visibility and source React mode                                   |
| `--fresh`, `--rebuild-snapshot`, `--rebuild-extension` | Working-profile reset, baseline rebuild or extension rebuild              |

Flags vary by command. The [CLI reference](cli.md) gives current built-in
help; task guides show combinations. TypeScript `loadConfig(overrides)` uses a configuration
object. `pnpm run ai -- script` passes the target, cache and port settings to your script; keep
the environment it gives you.

## Private and generated files

| Path                 | Contents                                                                 |
| -------------------- | ------------------------------------------------------------------------ |
| `harness/.cache`     | Default app profile, reusable baselines, saved login and `instance.json` |
| `harness/.artifacts` | Default generated task outputs and local tools                           |
| `harness/.env`       | Optional private local configuration                                     |
| `dist/`              | Built Doodlebot extension                                                |
| `.vortex-src/`       | Managed Vortex checkout                                                  |

Git ignores the standard private storage paths, but custom paths, logs, backup files and
screenshots still need privacy review before publication. A new cache directory can import the
default saved OAuth; use the core fixtures for deliberately anonymous checks. See
[security](../security.md).
