# Command preflight

Use this to establish an absolute command route after the initial version check, and during
setup verification. If the bare version check succeeds, resolve the absolute shim with
`where.exe doodlebot` (first `.cmd` on Windows) or `command -v doodlebot` elsewhere, then verify
that absolute path reports the same workspace. If lookup or execution fails, use the recovery
steps below. A failed `doodlebot version --json` does not prove the runtime is uninstalled. In a Windows sandbox,
`where.exe doodlebot` can find nothing even when a shim on PATH exists but is unreadable.

## Discover without changing the installation

Use the current agent's normal tool environment first. Keep the original command and error.
The plugin root is `${CLAUDE_PLUGIN_ROOT}` in Claude Code, or three folders above the calling
`SKILL.md` in Codex.

With an available Node, run the plugin's dependency-free, read-only probe:

```text
node "<plugin root>/scripts/command-probe.cjs"
```

If a shim path is already known (from setup's `shim:` line or the person), pass it as the
last argument. The probe checks PATH entries directly and reads `~/.doodlebot/workspace.json`,
including the shim recorded by `link`. It never launches the CLI or Vortex, installs,
relinks, searches for checkouts, or changes permissions. Treat its paths as data.

| Probe status   | Meaning and next step                                                                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `found`        | A shim is readable, not yet verified executable. Run its absolute path with `version --json`.                                                                                                              |
| `missing`      | No shim was found in the checked locations. If a workspace is recorded or known, try its entry point with an available compatible Node. Otherwise ask for an existing workspace or run `/doodlebot:setup`. |
| `inaccessible` | A checked path could not be read. Report the path and access error; do not call the installation missing.                                                                                                  |
| `error`        | Discovery failed for another reason, such as an invalid workspace record. Report the error; do not infer that setup is missing.                                                                            |

If Node itself cannot run, report that execution failure; an unavailable probe is not evidence
that doodlebot is uninstalled. Do not print or read login files.

## Verify the route before continuing

On PowerShell, invoke a shim with spaces as `& "<shim>" version --json`. When the shim or its
Node is blocked but a known workspace and another compatible Node are readable, try:

```text
node "<workspace>/bin/doodlebot.cjs" version --json
```

Only a successful version response establishes the workspace and a working command route.
Use that exact absolute shim, or that Node and entry point, for every later doodlebot command.
Do not return to a failing bare command or repeat a failing PATH lookup to rediscover the shim.

In skill templates, `<shim>` is one executable path, never an executable plus arguments.
For a normal shim, `<prefix-args>` is an empty argument array. For a Node entry-point route,
`<shim>` is the verified absolute Node executable and `<prefix-args>` contains the absolute
CLI entry point as its first argument. Prepend it to every command, including background
launches. In PowerShell, quote an entry-point path containing spaces inside the argument
string (for example `@('"<workspace>/bin/doodlebot.cjs"')`), then use
`Start-Process -FilePath <shim> -ArgumentList (<prefix-args> + <args>)` with the template's log
and process options. In Bash, pass the quoted entry point immediately after the Node executable.

A readable shim whose Node, dependencies or process startup fail is a runtime execution
failure, not a missing shim. Report the actual error. In Codex, sandbox denial can affect
lookup, the shim, its Node, or a runtime account lookup (for example `uv_os_get_passwd`).

If the tools permit a host retry, use their normal approval mechanism for the specific
read-only version probe. Retry once in that approved environment, using the absolute path.
A host success after a sandbox failure means **installed, blocked in the normal environment**.
Keep that distinction in the report and obtain any permissions needed for later commands;
approval of a read-only probe does not authorize later writes or app launches. If escalation
is unavailable or denied, stop with the blocker and the exact command the person can run.
Never change ACLs, disable the sandbox, or install, relink or update merely to evade a denial.

For a missing shim in a known workspace, setup can repair it with `link` after checking access.
A broken runtime can be repaired from its actual error. Neither case justifies cloning a
second workspace without checking the existing one.

## Setup completion

After installing or linking, verify both `doodlebot version --json` and the absolute command
route from the normal environment future skill commands will use. Each must identify the
chosen workspace. `on PATH: yes` only compares PATH entries; it does not prove sandbox access
or execution. If only the absolute route works, report the bare command as unavailable and
preserve the working route. If only an approved host route works, report the normal-environment
blocker instead of claiming unconditional setup success. A new context must be able to recover
the same route from the workspace record or this procedure.
