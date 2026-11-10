---
name: status
description: "Doodlebot: Report whether doodlebot is set up, whether the test Vortex is running and signed in, and whether its baseline exists; use when asked if doodlebot is ready."
argument-hint: "[doctor] [same target flags as start]"
---

# Doodlebot status

Read-only: this command starts and stops nothing.

## Steps

1. Run `doodlebot version --json`. It prints `{version, commit, dirty, workspace}`.
   - If `doodlebot` is not found, stop and tell the person: "doodlebot is not set up on
     this machine yet. Run `/doodlebot:setup` first."
   - Compare its `version` with this plugin's version, `version` in
     `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` (Claude Code) or
     `<plugin root>/.codex-plugin/plugin.json` (Codex; three folders above this
     `SKILL.md`). If they differ, suggest `/doodlebot:update`.
2. Run `doodlebot status` (with the person's target and game flags, if they gave any). It
   reports whether the MCP port is `answering`, the game, whether an API key is set, the
   baseline snapshot and the working profile.
3. Only when it reports MCP `answering`, run `doodlebot auth-status`. It prints booleans
   for the Nexus login, never secrets.
4. When the person asks for a full check (or says "doctor"), run `doodlebot doctor` with
   the same flags, for example `doodlebot doctor --installed --sandbox`.

## Finish

Summarize in plain words, a line each:

- doodlebot version, commit and workspace, and whether the workspace has local changes
  (`dirty`) or needs `/doodlebot:update`;
- whether a test Vortex is running (and if so whether it is signed in to Nexus Mods);
- whether the baseline exists (the next start is warm or cold);
- for a doctor run, each failing or advisory check and what fixes it (for example
  `/doodlebot:setup`, `/doodlebot:login` or `/doodlebot:baseline`).
