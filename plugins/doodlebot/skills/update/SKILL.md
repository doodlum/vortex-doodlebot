---
name: update
description: "Doodlebot: Update the doodlebot workspace to match this plugin's version, then reinstall and rebuild it; use when another command reports a version mismatch."
argument-hint: "[--ref <tag or branch>]"
disable-model-invocation: true
---

# Update doodlebot

The plugins and the workspace are updated separately. This command moves the workspace to
the release that matches the installed plugin, so the commands and the CLI agree.

## Before you begin

1. Run `doodlebot version --json`. It prints `{version, commit, dirty, workspace}`.
   - If `doodlebot` is not found, stop and tell the person: "doodlebot is not set up on
     this machine yet. Run `/doodlebot:setup` first."
   - `<workspace>` below is its `workspace`.
2. Read this plugin's version, `version` in
   `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` (Claude Code) or
   `<plugin root>/.codex-plugin/plugin.json` (Codex; three folders above this `SKILL.md`).
   When it equals the workspace's `version` and the person named no ref, say the workspace
   is already up to date and stop.

## Steps

1. If `dirty` is true, tell the person the workspace has local changes, which the update
   refuses to overwrite; ask them to commit or remove them first, and stop.
2. Run `doodlebot status`. If MCP is `answering`, ask whether to stop the test Vortex; run
   `doodlebot down` on a yes, otherwise stop.
3. Run `doodlebot update --ref v<plugin version>` (or the person's `--ref`). It fetches the
   tag or branch, checks it out detached, then runs `pnpm install --frozen-lockfile` and
   `pnpm run build`. Allow up to 10 minutes; if your tool times out sooner, run it in the
   background with its output in `<workspace>/harness/.artifacts/runs/<UTC time>-update.log`
   and wait for it to exit.
4. Read the result:
   - `No tag or branch v<plugin version> on origin.` with the default ref: run
     `doodlebot update --ref main` instead.
   - `A harness Vortex is running; run doodlebot down before updating.`: go back to step 2.
   - `The workspace has local changes; commit or remove them before updating.`: see step 1.
   - Any other error: show its last lines and stop.
5. Run `doodlebot version --json` again and compare `version` and `commit` with before.

## Finish

Tell the person the old and new version and commit. If the new version still differs from
the plugin's, say that the plugin itself may need updating (in Claude Code,
`/plugin marketplace update doodlebot`) and that `main` was used when no release tag existed.
