---
name: start
description: "Doodlebot: Start the isolated test Vortex for an installed or source build with the sandbox, the Bethesda sandbox or a real game copy; use before driving or testing Vortex by hand."
argument-hint: "[installed | source <checkout>] [sandbox | bethesda-sandbox | <game id> <game copy>] [fresh]"
---

# Start the test Vortex

Only one doodlebot Vortex runs on a machine at a time. It uses its own profile, never the
person's own Vortex profile.

## Before you begin

1. Run `doodlebot version --json`. It prints `{version, commit, dirty, workspace}`.
   - If `doodlebot` is not found, stop and tell the person: "doodlebot is not set up on
     this machine yet. Run `/doodlebot:setup` first."
   - `<workspace>` below is its `workspace`.
2. Compare its `version` with this plugin's version, `version` in
   `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` (Claude Code) or
   `<plugin root>/.codex-plugin/plugin.json` (Codex; three folders above this `SKILL.md`).
   If they differ, say so and suggest `/doodlebot:update`, then continue.
3. `<shim>` is the absolute path of the `doodlebot` command: on Windows the first line
   ending in `.cmd` that `where.exe doodlebot` prints (never PowerShell's `where`);
   elsewhere `command -v doodlebot`.

## Name the target

Always pass the target and game explicitly, and keep the same flags for every later command
on this profile.

| Choice                        | Flags                                                          |
| ----------------------------- | -------------------------------------------------------------- |
| Released Vortex (default)     | `--installed`                                                  |
| A specific executable         | `--exe <path to Vortex.exe>`                                   |
| A source build                | `--dev-dir <checkout>` (default `<workspace>/.vortex-src`)     |
| Source build, production mode | `--dev-dir <checkout> --production` (after a production build) |
| Sandbox game (default)        | `--sandbox`                                                    |
| Fake Fallout 4 (source only)  | `--bethesda-sandbox`                                           |
| A copy of a real game         | `--game <id> --game-path <copy>`                               |
| No game                       | `--no-game`                                                    |
| Reset to the baseline         | add `--fresh`                                                  |

## Steps

1. Run `doodlebot status`. If MCP is already `answering`, tell the person a test Vortex is
   running and ask whether to restart it with the new choice. A different profile needs
   `doodlebot down` first.
2. Run `doodlebot up <flags>` (for example `doodlebot up --installed --sandbox`) **in the
   background** with a log. It launches Vortex, which can keep a captured output open so
   the command never returns:

   ```powershell
   New-Item -ItemType Directory -Force <workspace>/harness/.artifacts/runs | Out-Null
   $log = "<workspace>/harness/.artifacts/runs/<UTC time>-up.log"
   $p = Start-Process -FilePath <shim> -ArgumentList 'up','--installed','--sandbox' -RedirectStandardOutput $log -RedirectStandardError "$log.err" -NoNewWindow -PassThru
   ```

   ```bash
   mkdir -p <workspace>/harness/.artifacts/runs
   nohup <shim> up --installed --sandbox > <workspace>/harness/.artifacts/runs/<UTC time>-up.log 2>&1 &
   ```

3. Poll `doodlebot status` with the same flags every 10 seconds until it reports MCP
   `answering`, or the process exits with an error. A first start of a profile can take a
   few minutes. On an error, show the last lines of the log and its `.err` file.
   - "A harness Vortex is running": another test Vortex runs; offer `/doodlebot:stop`.
   - A missing Vortex or checkout: the log says which; suggest `/doodlebot:setup` or
     `/doodlebot:source`.
4. Read the log: the `target:` line (kind and executable), the `MCP:` line and the `Game:`
   line.

## Finish

Tell the person the target and game that started, and the MCP endpoint from the `MCP:`
line. Do not repeat the bearer token in chat; it is in the log if they need to connect
another client. Suggest `/vortex:drive` to work in it and `/doodlebot:stop` when done.
