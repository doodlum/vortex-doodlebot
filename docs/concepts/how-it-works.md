# How doodlebot works

This page explains the parts of doodlebot and how a command in your agent reaches the test
Vortex.

## Before you begin

Read the [Overview](../index.md) for what doodlebot does.

## From a command to Vortex

```text
 Claude Code / Codex window
   /doodlebot:*   /vortex:*   /benchmark:*      (plugins from the doodlebot marketplace)
          |            |            |
          +------------+-----+------+
                             v
                doodlebot  (shim on the PATH)
                             v
          node <workspace>/bin/doodlebot.cjs
                             v
   workspace (clone of the doodlebot repository): harness, built extension, caches, releases
                             v         (Vortex source: the Vortex checkout your session is in)
       one isolated test Vortex per machine (record: ~/.doodlebot/instance.json)
```

1. **The plugins** hold the commands. Each command is a skill: written instructions the agent
   follows. They contain no program code of their own.
2. **The `doodlebot` command** is how every skill acts. `/doodlebot:setup` writes a shim for it:
   `doodlebot.cmd` for PowerShell and cmd, and an extensionless `doodlebot` script for Git Bash,
   which Claude Code uses on Windows. Both run `<workspace>/bin/doodlebot.cjs` with Node.js.
3. **The workspace** is a clone of the doodlebot repository with its dependencies installed. It
   holds the harness that launches and drives Vortex, the built doodlebot extension, and the
   caches, profiles, saved logins and reports. Vortex's own source is not in the workspace: work
   on Vortex's code happens in the Vortex checkout (or worktree) you open your session in. The
   plugins and the workspace are separate, so a plugin update never replaces code under a
   running Vortex.
4. **The test Vortex** is your released Vortex, or a source build, started with its own private
   profile. Doodlebot installs its extension into that profile only. Your own Vortex profile is
   not touched.
5. **The doodlebot extension** runs inside the test Vortex as an MCP server on the local
   machine. It exposes Vortex's state and its UI as tools: read state, call Vortex actions, take
   a snapshot of the window, click, type, read the console. [MCP tools](../reference/mcp-tools.md)
   lists them. The agent calls them with `doodlebot call <tool>` and shortcuts such as
   `doodlebot snapshot` and `doodlebot click`.

The extension works with a stock, released Vortex. Nothing in doodlebot needs a patched Vortex.

## Versions and updates

The plugins and the workspace each have a version. Every command except `/doodlebot:setup` first
runs `doodlebot version --json`, which reports the workspace's version, commit and folder.
A failed lookup triggers read-only command preflight: missing shims, sandbox access denial
and runtime execution failures need different remedies. A recorded workspace and absolute
shim help a fresh context recover the command without another installation. If
the plugin's version differs, the agent suggests `/doodlebot:setup --update`.

`/doodlebot:setup --update` runs `doodlebot update --ref v<plugin version>`, falling back to `main` when
that tag does not exist. The update checks out the ref and runs `pnpm install --frozen-lockfile`
and `pnpm run build`. It refuses while a test Vortex runs, and when the workspace has local
changes. It counts the workspace as up to date only when its commit matches the plugin's (the
commit Claude Code installed the plugin from, or the `v<plugin version>` tag), not when the
version numbers merely match. It also writes `~/.doodlebot/workspace.json` when that record is
missing.

## Where work happens

| Kind            | Command                                                     | Agent during the run   | Result             |
| --------------- | ----------------------------------------------------------- | ---------------------- | ------------------ |
| Regression test | `/doodlebot:fix`, in the Vortex PR                          | None                   | Vortex test report |
| Driven run      | `/doodlebot:try`, `/doodlebot:investigate`, `/doodlebot:qa` | `vortex-driver`        | Run report         |
| Benchmark       | `/doodlebot:measure`                                        | Orchestrates only      | Benchmark report   |
| Design review   | `/egm:egm-review-loop`                                      | EGM and the Goldfishes | Approved design    |

In Claude Code, `vortex-driver` and every design reviewer run on Sonnet, a lower-cost model, and
the reviewers run as read-only agents. In Codex, the plugin ships no agents: the driver's
procedure runs in your session, and reviewers run as general-purpose subagents on GPT-6.1 Terra.

## What's next

- [One test Vortex at a time](one-test-vortex.md).
- [Commands](../reference/commands.md) and the [doodlebot CLI](../reference/cli.md).
