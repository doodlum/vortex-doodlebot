---
name: source
description: "Doodlebot: Clone and build Vortex in the workspace (the person's fork, or Nexus-Mods/Vortex when they have none) and cut a branch from upstream for one piece of work; use before changing Vortex's own code."
argument-hint: "[branch name] [--update]"
---

# Prepare the Vortex source

Doodlebot's `source` command finds the person's GitHub fork of Vortex, clones it into
`<workspace>/.vortex-src` and builds it with the checkout's pinned toolchain. The Nexus
repository is always the remote `upstream`; the fork, when there is one, is `origin`. Without a
fork it clones `Nexus-Mods/Vortex` alone, which is enough to build, try and test; pushing a fix
needs a fork. It never searches the disk for another checkout. Every piece of work gets its own
branch, cut from `upstream`.

## Before you begin

1. Run `doodlebot version --json`. It prints `{version, commit, dirty, workspace}`.
   - If `doodlebot` is not found, stop and tell the person: "doodlebot is not set up on
     this machine yet. Run `/doodlebot:setup` first."
   - `<workspace>` below is its `workspace`.
2. Compare its `version` with this plugin's version, `version` in
   `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` (Claude Code) or
   `<plugin root>/.codex-plugin/plugin.json` (Codex; three folders above this `SKILL.md`).
   If they differ, say so and suggest `/doodlebot:update`, then continue.
3. Confirm the person wants Vortex source work: it clones their fork (or upstream) and builds
   it. If they already have a checkout of their own, use it with `--dev-dir <checkout>`
   instead and stop.

## Steps

1. Run `doodlebot status`. A test Vortex launched from `<workspace>/.vortex-src` blocks
   building it; if MCP is `answering`, ask to stop it and run `doodlebot down` on a yes.
2. Run `doodlebot source --no-build`. It clones or reuses the checkout without building. With
   `--update`, run `doodlebot source --no-build --update` instead, which also fetches an
   existing clone's remotes (and adds a missing `upstream`) before you branch. If it found no
   fork, tell the person what it printed: building and testing work as they are, and pushing
   a fix later needs a fork (`/doodlebot:pr` offers to make one).
3. Make the branch from upstream's default branch (name it after the task, for example
   `fix-123`): `doodlebot source --no-build --branch <branch>`. It fetches `upstream` and cuts
   the branch from `upstream/<default branch>`, never from the fork's own default branch.

   If the branch exists, it refuses: ask whether to switch to it instead, with
   `git -C <workspace>/.vortex-src switch <branch>`. Never commit to `master`.

4. **Several branches at once.** Another Claude session can work on another branch in its own
   worktree: `git -C <workspace>/.vortex-src worktree add <dir> <branch>`, then
   `doodlebot build --checkout <dir>` and `--dev-dir <dir>` on every command. Each worktree is
   a full build of several GB. Only one test Vortex runs at a time on the machine; never
   `doodlebot down` an instance another session started from another checkout: wait, or tell
   the person.

5. Run `doodlebot source` to install and build the checkout. It can take 10 minutes or more:
   run it in the background with its output in
   `<workspace>/harness/.artifacts/runs/<UTC time>-source.log`, and wait for it to exit.
6. Run `doodlebot source --where` to confirm the path.

## Finish

Tell the person the checkout path, the branch and whether the build succeeded. Explain the
next steps: `/doodlebot:start source` starts it, `/doodlebot:fix` works on a bug in it, and
after a change `doodlebot build --checkout <workspace>/.vortex-src` rebuilds it (with the
test Vortex stopped first).
