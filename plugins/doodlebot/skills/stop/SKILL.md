---
name: stop
description: "Doodlebot: Stop the running test Vortex cleanly; use when you are done, before starting another profile, or before tests, builds and updates."
disable-model-invocation: true
---

# Stop the test Vortex

## Before you begin

1. Run `doodlebot version --json`. It prints `{version, commit, dirty, workspace}`.
   - If `doodlebot` is not found, stop and tell the person: "doodlebot is not set up on
     this machine yet. Run `/doodlebot:setup` first."
2. Compare its `version` with this plugin's version, `version` in
   `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` (Claude Code) or
   `<plugin root>/.codex-plugin/plugin.json` (Codex; three folders above this `SKILL.md`).
   If they differ, say so and suggest `/doodlebot:update`, then continue.

## Steps

1. Run `doodlebot down`. It needs no flags: it follows the machine-wide instance record
   `~/.doodlebot/instance.json`, asks the running test Vortex to quit and waits up to 30
   seconds for a clean exit.
2. Read what it printed:
   - `Vortex exited cleanly.`: done.
   - `Nothing is running.`: there was no test Vortex.
   - It reports an instance that did not exit: tell the person to close that test Vortex
     window themselves, then run `/doodlebot:stop` again. Never kill the process.
   - "A harness Vortex from an older doodlebot is running": a Vortex started by an older
     doodlebot is still open; ask the person to close its window.

## Finish

Tell the person in one line whether a test Vortex was stopped. Their own Vortex, if open,
is never touched.
