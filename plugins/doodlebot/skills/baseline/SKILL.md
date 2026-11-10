---
name: baseline
description: "Doodlebot: Create or refresh a baseline profile for the sandbox, a copy of a real game, or a source build; use when fresh starts should begin from a new clean state."
argument-hint: "[sandbox | <game id> <game folder> | source <checkout>]"
disable-model-invocation: true
---

# Create or refresh a baseline

A baseline is the clean profile that a fresh start (`/doodlebot:start` with `fresh`)
restores. Each target, game and game folder has its own. Refreshing it keeps the cached Nexus login.

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

## Pick the flags

| The person wants                   | Flags                                                    |
| ---------------------------------- | -------------------------------------------------------- |
| The sandbox game (default)         | `--installed --sandbox`                                  |
| A real game                        | `--installed --game <id> --game-path <copy of the game>` |
| A source build with the sandbox    | `--dev-dir <checkout> --sandbox`                         |
| A source build with fake Fallout 4 | `--dev-dir <checkout> --bethesda-sandbox`                |

For a real game, `--game-path` must be a **copy** of the game folder that the person made
for testing. Doodlebot never copies the game; it deploys into the folder you give, so pass
a disposable copy, never the person's real installation. Ask for the copy's path if they
have not given one.

## Steps

1. Run `doodlebot status`. If MCP is `answering`, ask whether to stop the running test
   Vortex; run `doodlebot down` on a yes, otherwise stop.
2. Run `doodlebot up <flags> --rebuild-snapshot` (for the sandbox:
   `doodlebot up --installed --sandbox --rebuild-snapshot`) **in the background** with a
   log, because it launches Vortex:

   ```powershell
   New-Item -ItemType Directory -Force <workspace>/harness/.artifacts/runs | Out-Null
   $log = "<workspace>/harness/.artifacts/runs/<UTC time>-baseline.log"
   $p = Start-Process -FilePath <shim> -ArgumentList 'up','--installed','--sandbox','--rebuild-snapshot' -RedirectStandardOutput $log -RedirectStandardError "$log.err" -NoNewWindow -PassThru
   ```

   In Bash: `nohup <shim> up <flags> --rebuild-snapshot > <log> 2>&1 &`.

3. Wait for that process to exit: note its pid (print `$p.Id` in the same call, or
   `echo $!` in Bash; the shell does not keep `$p` between calls) and check every 10
   seconds whether it still runs (`Get-Process -Id <pid>` in PowerShell, `kill -0 <pid>` in
   Bash). The launch is done when it has exited and its log has the line `Vortex is up in`. A cold start launches Vortex up to three times on the same port, so
   `doodlebot status` answering is only a liveness hint, not completion. If it exited without
   that line, show the log's last lines and stop. Read the `target:` line in the log
   and check it is the target the person asked for.
4. Run `doodlebot down`, so no Vortex is left running.
5. Run `doodlebot doctor <flags>` and read its `Sandbox baseline` check (for the sandbox
   flags it must start with `present`).

## Finish

Tell the person which baseline was rebuilt (target, game, folder), that no test Vortex is
running, and that `/doodlebot:start` with the same choice now starts from it.
