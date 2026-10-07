# Configuration reference

Run commands from the repository root. You can configure them with flags, environment
variables and slot defaults. `harness/.env` supplies private local values when present and
is ignored by Git. The loader's explicit environment-value helper treats empty values as
unset, so use a valid setting rather than an empty string when you need an override.

## Target selection

An explicit source `--dev-dir`/`--worktree` chooses that checkout. Otherwise `--installed` or
`VORTEX_AI_INSTALLED=1` selects released Vortex. An explicit executable bypasses managed-source
discovery. Without those choices, a configured developer directory or managed `.vortex-src`
can take precedence over an installed app. Select the runtime explicitly when checking compatibility.

## Environment settings

| Setting                                     | Purpose and default                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `VORTEX_AI_OWNER`                           | Named operator/task; required by live/provisioning commands                             |
| `VORTEX_AI_SLOT`                            | `0`, another nonnegative slot or `auto`; default 0                                      |
| `VORTEX_AI_INSTALLED`                       | Prefer installed Vortex when true                                                       |
| `VORTEX_AI_EXE`                             | Explicit released executable path                                                       |
| `VORTEX_AI_DEV_DIR`                         | Explicit source target                                                                  |
| `VORTEX_AI_SOURCE_DIR`                      | Managed source location; default `.vortex-src`                                          |
| `VORTEX_AI_GITHUB_USER`                     | GitHub identity used by source fork discovery                                           |
| `VORTEX_AI_VORTEX_REPO`                     | Explicit source repository as `owner/name`                                              |
| `VORTEX_AI_PNPM`                            | Override for Vortex's own pinned pnpm; does not change the kit's pin                    |
| `VORTEX_MCP_TOKEN`                          | Bearer token; the harness creates a persisted private default if unset                  |
| `VORTEX_MCP_PORT`                           | MCP port; slot 0 defaults to 3701                                                       |
| `VORTEX_AI_CDP_PORT`                        | CDP port; slot 0 defaults to 9222                                                       |
| `VORTEX_AI_GAME_ID`                         | Game ID before fixture selection; default `fallout4`; `--sandbox` chooses the fake game |
| `VORTEX_AI_GAME_PATH`                       | Explicit game install path                                                              |
| `VORTEX_AI_CACHE_DIR`                       | Profile/baseline/OAuth cache; default depends on slot                                   |
| `VORTEX_AI_ARTIFACT_DIR`                    | Screenshots, reports and other task outputs                                             |
| `VORTEX_AI_HEADLESS`                        | Hide the window; off by default                                                         |
| `VORTEX_AI_PRODUCTION`                      | Require production mode for a source runtime                                            |
| `VORTEX_AI_NEXUS_API_KEY` / `NEXUS_API_KEY` | Optional legacy API key; not OAuth for collections                                      |
| `DOODLEBOT_DOCS_PYTHON`                     | Python executable for documentation build/serve only                                    |
| `DOODLEBOT_DOCS_BASE`                       | Git base revision for paired-documentation checks in CI/review                          |

Both debug ports must be distinct integers between 1 and 65535. Slot n uses `3701 + 10n`
and `9222 + 10n` before overrides. Flags override their configured values for that command;
keep overrides consistent for every operation on the session.

## Important flags

| Flag                                                       | Effect                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| `--installed`, `--exe`, `--dev-dir`, `--worktree`          | Choose the runtime; choose one source directory form                      |
| `--owner`, `--slot`, `--cache-dir`, `--port`, `--cdp-port` | Choose ownership, profile and endpoints                                   |
| `--sandbox`                                                | Disposable local-install/deployment game                                  |
| `--bethesda-sandbox`                                       | Fake Bethesda game with private per-user folders; requires source runtime |
| `--isolate-user-folders`                                   | Source-only per-game folder redirection                                   |
| `--game`, `--game-path`, `--no-game`                       | Manage a chosen game or open only global UI                               |
| `--with-api-key`                                           | Deliberately seed the legacy key in a sandbox; normally withheld          |
| `--headless`, `--production`                               | Window visibility and source React mode                                   |
| `--fresh`, `--rebuild-snapshot`, `--rebuild-extension`     | Working-profile reset, baseline rebuild or extension rebuild              |

Flags vary by command. The [CLI reference](cli.md) gives current built-in
help; task guides show combinations. TypeScript `loadConfig(overrides)` uses a configuration
object; scratch scripts should retain the inherited target/owner/slot environment.

## Private and generated files

| Path                                 | Contents                                                |
| ------------------------------------ | ------------------------------------------------------- |
| `harness/.cache`                     | Default app profile, reusable baselines and saved login |
| `harness/.slots/<n>`                 | Other slot caches, artifacts and endpoints              |
| `harness/.artifacts`                 | Default generated task outputs and local tools          |
| `harness/.env`                       | Optional private local configuration                    |
| `dist/`                              | Built Doodlebot extension                               |
| `.vortex-src/`, `.vortex-worktrees/` | Managed Vortex checkout and source worktrees            |

Git ignores the standard private storage paths, but custom paths, logs, backup files and
screenshots still need privacy review before publication. New slots can import the default saved OAuth; use the core
fixtures for deliberately anonymous checks. See [security](../security.md).
