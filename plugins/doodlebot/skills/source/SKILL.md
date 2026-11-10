---
name: source
description: "Doodlebot: Clone and build the person's Vortex fork in the workspace and make a branch for one piece of work; use before changing Vortex's own code."
argument-hint: "[branch name] [--update]"
---

# Prepare the Vortex source

Doodlebot's `source` command finds the person's GitHub fork of Vortex, clones it into
`<workspace>/.vortex-src` and builds it with the checkout's pinned toolchain. It never
searches the disk for another checkout. Every piece of work gets its own branch.

## Before you begin

1. Run `doodlebot version --json`. It prints `{version, commit, dirty, workspace}`.
   - If `doodlebot` is not found, stop and tell the person: "doodlebot is not set up on
     this machine yet. Run `/doodlebot:setup` first."
   - `<workspace>` below is its `workspace`.
2. Compare its `version` with this plugin's version, `version` in
   `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` (Claude Code) or
   `<plugin root>/.codex-plugin/plugin.json` (Codex; three folders above this `SKILL.md`).
   If they differ, say so and suggest `/doodlebot:update`, then continue.
3. Confirm the person wants Vortex source work: it clones their fork and builds it. If they
   already have a checkout of their own, use it with `--dev-dir <checkout>` instead and stop.

## Steps

1. Run `doodlebot status`. A test Vortex launched from `<workspace>/.vortex-src` blocks
   building it; if MCP is `answering`, ask to stop it and run `doodlebot down` on a yes.
2. Run `doodlebot source --no-build`. It clones or reuses the fork without building. If it
   cannot find a fork, tell the person to fork `Nexus-Mods/Vortex` on GitHub (and sign in
   to `gh` if it asks), then run this command again.
3. Make the branch from the current upstream base (name it after the task, for example
   `fix-123`):
   1. `git -C <workspace>/.vortex-src fetch upstream`
   2. `git -C <workspace>/.vortex-src switch -c <branch> upstream/master`

   If the branch exists, ask whether to switch to it instead, with
   `git -C <workspace>/.vortex-src switch <branch>`. Never commit to `master`.

4. Run `doodlebot source` to install and build the checkout. It can take 10 minutes or more:
   run it in the background with its output in
   `<workspace>/harness/.artifacts/runs/<UTC time>-source.log`, and wait for it to exit.
   With `--update`, pass `doodlebot source --update` to refresh the clone first.
5. Run `doodlebot source --where` to confirm the path.

## Finish

Tell the person the checkout path, the branch and whether the build succeeded. Explain the
next steps: `/doodlebot:start source` starts it, `/vortex:fix` works on a bug in it, and
after a change `doodlebot build --checkout <workspace>/.vortex-src` rebuilds it (with the
test Vortex stopped first).
