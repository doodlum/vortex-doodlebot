---
name: pr
description: "Vortex: Prepare a Vortex pull request: run the preflight checks, write the description with the doodlebot footer and check the PR's CI; use when a fix or feature is verified and ready to submit."
argument-hint: "[branch or checkout] [PR number, once it exists]"
---

# Prepare a Vortex pull request

This command prepares the PR. It never commits, pushes or opens a PR unless the person
asks for that step.

## Before you begin

1. Run `doodlebot version --json`. It prints `{version, commit, dirty, workspace}`.
   - If `doodlebot` is not found, stop and tell the person: "doodlebot is not set up on
     this machine yet. Run `/doodlebot:setup` first."
   - `<workspace>` below is its `workspace`.
2. Compare its `version` with this plugin's version, `version` in
   `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` (Claude Code) or
   `<plugin root>/.codex-plugin/plugin.json` (Codex; three folders above this `SKILL.md`).
   If they differ, say so and suggest `/doodlebot:update`, then continue.
3. Read `<workspace>/harness/PULL-REQUESTS.md` (titles, description template, footer,
   review lessons) and the Vortex checkout's `CONTRIBUTING.md`.
4. Check the change was tested: the person's own reported scenario must have been run on the
   base and on the fix (`/vortex:fix`), and a feature needs its approved design and
   `/vortex:qa`. If not, say what is missing and stop; never open a PR, draft included,
   before that.

## Steps

1. **Checkout.** `<checkout>` is the branch's checkout (default `<workspace>/.vortex-src`).
   The branch must not be `master`, and its changes must be committed: preflight reads the
   committed head.
2. **Stop the test Vortex** if it runs from that checkout: `doodlebot down`.
3. **Preflight.** `doodlebot pr-preflight --checkout <checkout> --base upstream/master`
   (add `--test <path>` and `--revert <file>` for the intended-assertion control). It
   prints PASS, WARN, FAIL or SKIP per check and exits 1 on a FAIL or INCONCLUSIVE.
   - Read every WARN list (callers outside the diff, readers of changed state, reducer
     dispatchers) and say in the description how each was checked.
   - A size WARN means the change may need splitting or maintainer agreement first.
   - An INCONCLUSIVE revert check needs its failing assertion read: is it the intended one?
4. **Description.** Write it from the template in `<workspace>/harness/PULL-REQUESTS.md`:
   a Conventional Commit title of at most 72 characters, every required section, the head
   sha, what was run and its results (never "Not run"), the reported scenario before and
   after, and the doodlebot footer at the end. Save it as
   `<workspace>/harness/.artifacts/pr/<branch>.md` and show it to the person.
5. **Publish, only when asked.** On the person's go-ahead: push the branch to their fork
   (`origin`) and open the PR against `Nexus-Mods/Vortex` with `gh pr create --body-file`
   (draft unless they say otherwise). Then run
   `doodlebot pr-preflight --checkout <checkout> --base upstream/master --pr <number>` to
   check the published description.
6. **CI.** `doodlebot pr-checks <number>` reports the head's checks, with failed jobs
   expanded to their failed steps. It exits nonzero while any check is pending or failed;
   wait and run it again. A test failure and an upload failure are different problems.

## Finish

Tell the person the preflight result, the description's path (or the PR link), the CI
status and anything still to do, such as maintainer agreement or a pending check.
