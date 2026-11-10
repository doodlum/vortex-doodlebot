---
name: fix
description: "Doodlebot: Reproduce a Vortex bug on the base, fix it on a branch of the source checkout and verify the reported scenario with evidence; use for a bug report or broken Vortex behavior."
argument-hint: "<bug report, issue link or symptom>"
---

# Fix a Vortex bug

Features and refactors are not fixes: they start with a design written and reviewed with EGM
(`/egm:egm-draft`, `/egm:egm-review`; see `<workspace>/AGENTS.md`). A fix needs no design unless
the person supplies or asks for one.

## Before you begin

1. Run `doodlebot version --json`. It prints `{version, commit, dirty, workspace}`.
   - If `doodlebot` is not found, stop and tell the person: "doodlebot is not set up on
     this machine yet. Run `/doodlebot:setup` first."
   - `<workspace>` below is its `workspace`.
2. Compare its `version` with this plugin's version, `version` in
   `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` (Claude Code) or
   `<plugin root>/.codex-plugin/plugin.json` (Codex; three folders above this `SKILL.md`).
   If they differ, say so and suggest `/doodlebot:update`, then continue.
3. Establish the scope. Permission to change doodlebot does not authorize Vortex source
   edits, and a read-only source constraint also excludes temporary patches, revert controls
   and builds that rewrite the checkout. Report a missing permission when it blocks the fix.
4. Read `<workspace>/harness/AGENT-WORKFLOW.md`, then the sources
   `<workspace>/harness/KNOWLEDGE-ROUTES.md` names for the area. Search what doodlebot has
   learned with `doodlebot knowledge search <symptom words>`, following
   `${CLAUDE_PLUGIN_ROOT}/resources/knowledge.md`, and check any match against the current
   source; a familiar symptom is not proof of its old cause. In the Vortex checkout read its
   `AGENTS.md`, nested instructions, `CLAUDE.md` when present, `CONTRIBUTING.md` and
   `docs/README.md`: they govern the submission.

Commands that launch Vortex or run long (`doodlebot up`, `setup`, `test`, `install`, and
`doodlebot source`) run in the background with a log, as
`${CLAUDE_PLUGIN_ROOT}/skills/drive/SKILL.md` describes under "Commands that block". Only one test Vortex runs at a time; stop it with `doodlebot down`
before building or changing the checkout.

## Steps

1. **Source.** Use the person's checkout if they name one (pass it as `--dev-dir <checkout>`
   and `--checkout <checkout>`). Otherwise use `<workspace>/.vortex-src`; if
   `doodlebot source --where` shows none, follow `/doodlebot:source`. `<checkout>` below is
   whichever you use.
2. **Reproduce on the base.** Stop the test Vortex first, then put the checkout on its base:
   `git -C <checkout> fetch upstream` and `git -C <checkout> switch --detach upstream/master`
   (or the base the report names). Build with `doodlebot build --checkout <checkout>`, start it with
   `doodlebot up --dev-dir <checkout> --sandbox` (or the fixture the report needs: a real
   game copy, `--bethesda-sandbox`, a collection), and carry out the person's own scenario
   with `/doodlebot:drive`'s loop. Record the symptom you observe (screenshot, state, log
   lines). If it does not reproduce, say so with what you tried, and stop: a fix for an
   unreproduced bug is a guess. Then `doodlebot down`.
3. **Branch.** `git -C <checkout> switch -c fix-<topic> upstream/master` (never `master`).
4. **Fix.** Change the source on the branch, following Vortex's guidance. Rebuild with
   `doodlebot build --checkout <checkout>` (after a dependency change, run
   `doodlebot source` again). For release-like timing use `--production` on both `build`
   and `up`.
5. **Test.** Add an assertion that fails without the fix: a Vortex unit test, run from its
   project folder (`pnpm exec vitest run <test-path>` in `<checkout>/src/renderer`), or a
   doodlebot regression test (`/doodlebot:ui-test`). Prove it fails on the base, for example
   with `doodlebot pr-preflight --checkout <checkout> --base upstream/master --test <test> --revert <file>`;
   a reverted failure is inconclusive until you read its assertion. That control diffs the
   committed `HEAD` and refuses uncommitted changes, so it needs the fix and test committed:
   ask the person whether you may make a local commit on the `fix-<topic>` branch
   (`git -C <checkout> commit`, never a push). Without that permission, skip the control and
   report the revert check as not run.
6. **Verify the reported scenario.** Start the fixed build
   (`doodlebot up --dev-dir <checkout> --sandbox`, or the report's fixture) and repeat the
   person's exact scenario. Observe the result independently (UI, deployed files, state,
   `doodlebot log --level warn`): a tool returning success is not an observation. Take
   `doodlebot screenshot --label after` where it helps. For UI fixes check the relevant
   widths and heights independently (`<workspace>/harness/WORKFLOWS.md` has the state
   matrix). Then `doodlebot down`.
7. **Gates.** Run the scoped checks first, then Vortex's own `pnpm run verify` in the
   checkout (with the test Vortex stopped). Keep failures, and say whether each is a
   regression, a known base failure or an external blocker. Never call a blocked gate
   passed. Run Vortex's E2E only when asked, with Vortex's own scripts in the checkout.
8. **Evidence.** Keep the base and fixed observations, screenshots, test output and
   preflight report under `<workspace>/harness/.artifacts/` for the PR.

## Finish

Report: the symptom on the base, the cause, the change (files), the failing-then-passing
test, the reported scenario's result on the fix, the gates and their results, and anything
not verified, and whether you made the local commit on `fix-<topic>` for the control. If
the confirmed cause would have saved real time, record it with `doodlebot knowledge add` as
`${CLAUDE_PLUGIN_ROOT}/resources/knowledge.md` describes, and name its id. Then
offer `/doodlebot:pr`. Apart from that local commit, made only with the person's permission,
never commit, push or open a PR unless the person asks, and never open one before the
person's own scenario passed on the fix.
