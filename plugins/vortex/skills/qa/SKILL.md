---
name: qa
description: "Vortex: Run independent QA of a Vortex change from a fresh profile against its acceptance criteria and return a run report; use after the author has finished and stopped the test Vortex."
argument-hint: "<change, branch or design> [acceptance criteria]"
---

# Independent QA

Independent QA checks a change the way a new tester would: from a fresh profile, against
the change's acceptance criteria, without the author's state or conclusions. It uses the
run report defined in `/vortex:drive`.

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
   ending in `.cmd` that `where.exe doodlebot` prints; elsewhere `command -v doodlebot`.

## Steps

1. **Collect the criteria.** From the approved design (its `## Acceptance Criteria`), the
   bug report's reported scenario, or the person's list. Each criterion becomes a scenario
   step with an observation that would fail if the criterion were false. If there are none,
   ask the person for them.
2. **Fix the subject.** The checkout and head under review (`git -C <checkout> rev-parse HEAD`)
   or the executable. Build a source checkout first with
   `doodlebot build --checkout <checkout>` (add `--production` for release-like behavior).
   Never edit the checkout.
3. **Make sure the author's instance is gone.** Run `doodlebot status`; if MCP is
   `answering`, ask the person to confirm the author is done, then run `doodlebot down`.
   QA never reuses a running instance.
4. **Delegate.** In Claude Code, dispatch a fresh `vortex:vortex-driver` with a brief that
   holds only: the criteria as scenario steps, the target and game flags, "start with
   `doodlebot up --fresh` and these flags, in the background", `<workspace>`, `<shim>`, the
   run folder `<workspace>/harness/.artifacts/runs/<UTC time>-qa-<slug>/`, and "do not
   reuse an instance". Do not pass the author's reasoning or results. In Codex (no plugin
   agents), run `/vortex:drive`'s report procedure inline, starting with
   `doodlebot up --fresh`.
5. **Read the report** and check each criterion has an observation, not just a tool's
   success. Re-run a check yourself only to confirm a surprising claim, and say so.
6. **Stop.** The driver runs `doodlebot down`; confirm with `doodlebot status`.

## Finish

Give the person the report path, the Outcome, and a line per criterion: passed (with its
observation), failed (with what happened) or not checked (with why). A missing login, game
or network is Blocked, not passed.
